from __future__ import annotations

import queue
import threading

from PySide6.QtCore import Qt, QTimer, QUrl
from PySide6.QtGui import QDesktopServices, QKeySequence
from PySide6.QtWidgets import (
    QAbstractScrollArea,
    QCheckBox,
    QComboBox,
    QDialog,
    QDoubleSpinBox,
    QFrame,
    QHBoxLayout,
    QKeySequenceEdit,
    QLabel,
    QLineEdit,
    QMessageBox,
    QPushButton,
    QScrollArea,
    QSpinBox,
    QVBoxLayout,
    QWidget,
)

from .. import __version__
from ..branding import PRODUCT_NAME
from ..config import AppConfig
from ..models import Language
from ..updater import GitHubReleaseClient, ReleaseInfo
from .hotkeys import normalize_shortcut
from .overlay_scroll_indicator import OverlayScrollIndicatorController
from .toggle_switch import ToggleSwitch
from .visuals import app_icon, apply_window_theme, palette_for, settings_stylesheet


class SettingsDialog(QDialog):
    def __init__(self, config: AppConfig, parent=None) -> None:
        super().__init__(parent)
        self.setObjectName("settingsRoot")
        self.setWindowTitle(f"{PRODUCT_NAME} 설정")
        self.setWindowIcon(app_icon())
        self.resize(720, 780)
        self.setMinimumSize(620, 620)
        self.config = config
        self._update_results: queue.Queue[tuple[ReleaseInfo | None, str]] = queue.Queue()
        self._available_release: ReleaseInfo | None = None

        self._create_controls()
        self._build_interface()
        self.ui_theme.currentIndexChanged.connect(self._apply_live_theme)
        self.translator.currentIndexChanged.connect(self._update_engine_notice)
        self._update_engine_notice()
        self._apply_live_theme()

        self._update_timer = QTimer(self)
        self._update_timer.timeout.connect(self._poll_update_result)
        self._update_timer.start(120)

    def _create_controls(self) -> None:
        def theme_provider() -> str:
            if hasattr(self, "ui_theme"):
                return str(self.ui_theme.currentData())
            return self.config.ui_theme

        self.enabled = ToggleSwitch("사용", theme_provider)
        self.enabled.setChecked(self.config.enabled)

        self.language = QComboBox()
        for label, value in (
            ("한국어", "ko"),
            ("日本語", "ja"),
            ("English", "en"),
            ("简体中文", "zh"),
            ("繁體中文", "zh-Hant"),
        ):
            self.language.addItem(label, value)
        self.language.setCurrentIndex(self.language.findData(self.config.target_language.value))

        self.translator = QComboBox()
        self.translator.addItem("Hy-MT2 1.8B Q4 (로컬·기본)", "hymt_1_8b")
        self.translator.addItem("Hy-MT2 7B Q4 (로컬·품질 우선)", "hymt_7b")
        self.translator.addItem("ChatGPT Plus/Pro (Codex CLI)", "chatgpt")
        self.translator.addItem("Claude Pro/Max (Claude Code)", "claude")
        self.translator.addItem("Gemini Pro/Ultra (Antigravity CLI)", "gemini")
        self.translator.addItem("DeepL (API 키·외부 전송)", "deepl")
        self.translator.addItem("원문 표시", "original")
        self.translator.addItem("Mock 테스트", "mock")
        self.translator.setCurrentIndex(max(0, self.translator.findData(self.config.translator)))

        self.hymt_device = QComboBox()
        self.hymt_device.addItem("자동 (GPU 우선, CPU 대체)", "auto")
        self.hymt_device.addItem("CPU", "cpu")
        self.hymt_device.setCurrentIndex(
            max(0, self.hymt_device.findData(self.config.hymt_device))
        )

        self.speech_style = QComboBox()
        self.speech_style.addItem("원문 말투 유지 (자동)", "auto")
        self.speech_style.addItem("항상 존댓말·격식체", "polite")
        self.speech_style.addItem("항상 반말·비격식체", "casual")
        self.speech_style.setCurrentIndex(
            max(0, self.speech_style.findData(self.config.speech_style))
        )

        self.ui_theme = QComboBox()
        self.ui_theme.addItem("시스템 설정 따르기", "system")
        self.ui_theme.addItem("라이트", "light")
        self.ui_theme.addItem("다크", "dark")
        self.ui_theme.setCurrentIndex(max(0, self.ui_theme.findData(self.config.ui_theme)))

        self.theme = QComboBox()
        self.theme.addItem("자동 감지", "auto")
        self.theme.addItem("다크", "dark")
        self.theme.addItem("라이트", "light")
        self.theme.setCurrentIndex(max(0, self.theme.findData(self.config.theme)))

        self.opacity = QDoubleSpinBox()
        self.opacity.setRange(0.5, 1.0)
        self.opacity.setSingleStep(0.05)
        self.opacity.setValue(self.config.overlay_opacity)
        self.font_scale = QDoubleSpinBox()
        self.font_scale.setRange(0.7, 1.6)
        self.font_scale.setSingleStep(0.05)
        self.font_scale.setValue(self.config.font_scale)
        self.background_color = QLineEdit(self.config.background_color)
        self.background_color.setPlaceholderText("자동 또는 #313338")
        self.text_color = QLineEdit(self.config.text_color)
        self.text_color.setPlaceholderText("자동 또는 #DBDEE1")
        self.fps = QSpinBox()
        self.fps.setRange(2, 20)
        self.fps.setValue(self.config.capture_fps)

        self.toggle_shortcut = self._shortcut_edit(self.config.hotkeys.toggle_translation)
        self.original_shortcut = self._shortcut_edit(self.config.hotkeys.toggle_original)
        self.hide_shortcut = self._shortcut_edit(self.config.hotkeys.hide_overlay)
        self.copy_shortcut = self._shortcut_edit(self.config.hotkeys.copy_current)

        self.auto_update = ToggleSwitch("자동 확인", theme_provider)
        self.auto_update.setChecked(self.config.auto_update)
        self.update_repository = QLineEdit(self.config.update_repository)
        self.check_update_button = QPushButton("지금 업데이트 확인")
        self.check_update_button.clicked.connect(self._update_action)
        self.update_status = QLabel("GitHub Release가 게시되면 여기에서 확인할 수 있습니다.")
        self.update_status.setObjectName("muted")
        self.update_status.setWordWrap(True)

    @staticmethod
    def _shortcut_edit(value: str) -> QKeySequenceEdit:
        edit = QKeySequenceEdit(QKeySequence(value))
        edit.setMaximumSequenceLength(1)
        edit.setClearButtonEnabled(True)
        return edit

    def _build_interface(self) -> None:
        root = QVBoxLayout(self)
        root.setContentsMargins(28, 24, 20, 20)
        root.setSpacing(0)

        header = QHBoxLayout()
        header.setSpacing(12)
        brand_icon = QLabel()
        brand_icon.setPixmap(app_icon().pixmap(38, 38))
        header.addWidget(brand_icon, 0, Qt.AlignmentFlag.AlignTop)
        title_stack = QVBoxLayout()
        title_stack.setSpacing(3)
        heading = QLabel("설정")
        heading.setObjectName("pageTitle")
        description = QLabel(
            "Discord 번역 방식과 화면 표시를 한곳에서 조절할 수 있습니다. "
            "변경 내용은 저장 후 적용됩니다."
        )
        description.setObjectName("pageDescription")
        description.setWordWrap(True)
        title_stack.addWidget(heading)
        title_stack.addWidget(description)
        header.addLayout(title_stack, 1)
        version = QLabel(f"v{__version__}")
        version.setObjectName("versionBadge")
        header.addWidget(version, 0, Qt.AlignmentFlag.AlignTop)
        root.addLayout(header)

        self.settings_scroll = QScrollArea()
        self.settings_scroll.setObjectName("settingsScroll")
        self.settings_scroll.setWidgetResizable(True)
        self.settings_scroll.setFrameShape(QFrame.Shape.NoFrame)
        self.settings_scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.settings_scroll.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.settings_scroll.setSizeAdjustPolicy(
            QAbstractScrollArea.SizeAdjustPolicy.AdjustIgnored
        )

        scroll_body = QWidget()
        scroll_body.setObjectName("scrollBody")
        content = QVBoxLayout(scroll_body)
        content.setContentsMargins(0, 22, 12, 24)
        content.setSpacing(0)

        content.addWidget(self._section_label("기본 번역"))
        general, general_layout = self._card()
        self._add_setting_row(
            general_layout,
            "실시간 번역",
            "Discord 메시지와 채널명을 선택한 언어로 번역하여 표시합니다.",
            self.enabled,
        )
        self._add_setting_row(
            general_layout,
            "표시 언어",
            "원문과 표시 언어가 같으면 번역하지 않고 원문을 유지합니다.",
            self.language,
        )
        self._add_setting_row(
            general_layout,
            "번역 모델",
            "로컬 모델과 외부 API 중 사용할 번역 엔진을 선택합니다.",
            self.translator,
        )
        self._add_setting_row(
            general_layout,
            "번역 말투",
            "존댓말과 반말을 원문에 맞추거나 원하는 말투로 고정할 수 있습니다.",
            self.speech_style,
        )
        self._add_setting_row(
            general_layout,
            "Hy-MT2 실행 장치",
            "자동 설정은 GPU를 먼저 사용하며 필요한 경우 CPU로 전환합니다.",
            self.hymt_device,
        )
        self._add_setting_row(
            general_layout,
            "화면 확인 빈도",
            "값을 높이면 반응 속도가 빨라지지만 CPU 사용량이 증가할 수 있습니다.",
            self.fps,
            last=True,
        )
        self.privacy = QLabel()
        self.privacy.setObjectName("inlineNotice")
        self.privacy.setWordWrap(True)
        general_layout.addWidget(self.privacy)
        content.addWidget(general)

        content.addWidget(self._section_label("화면", top=22))
        appearance, appearance_layout = self._card()
        self._add_setting_row(
            appearance_layout,
            "설정창 테마",
            "시스템 설정에 맞추거나 라이트 및 다크 모드를 직접 선택할 수 있습니다.",
            self.ui_theme,
        )
        self._add_setting_row(
            appearance_layout,
            "Discord 테마",
            "번역 배경과 글자색을 Discord 화면에 맞게 자동으로 감지합니다.",
            self.theme,
        )
        self._add_setting_row(
            appearance_layout,
            "배경색",
            "자동 감지가 정확하지 않을 경우 색상 값을 직접 입력할 수 있습니다.",
            self.background_color,
        )
        self._add_setting_row(
            appearance_layout,
            "글자색",
            "자동 또는 #RRGGBB 형식의 색상을 사용할 수 있습니다.",
            self.text_color,
        )
        self._add_setting_row(
            appearance_layout,
            "배경 불투명도",
            "원문을 가리는 번역 배경의 불투명도를 조절합니다.",
            self.opacity,
        )
        self._add_setting_row(
            appearance_layout,
            "글자 크기 배율",
            "Discord 원문과 번역문의 글자 크기가 다를 때 미세 조정합니다.",
            self.font_scale,
            last=True,
        )
        content.addWidget(appearance)

        content.addWidget(self._section_label("단축키", top=22))
        self.shortcuts_card, shortcuts_layout = self._card()
        self._add_setting_row(
            shortcuts_layout,
            "번역 켜기·끄기",
            "다른 프로그램을 사용 중인 경우에도 번역 상태를 전환할 수 있습니다.",
            self.toggle_shortcut,
        )
        self._add_setting_row(
            shortcuts_layout,
            "원문·번역 전환",
            "현재 화면에서 원문과 번역문을 번갈아 확인할 수 있습니다.",
            self.original_shortcut,
        )
        self._add_setting_row(
            shortcuts_layout,
            "오버레이 숨기기",
            "번역 기능은 유지한 상태로 화면 표시만 일시적으로 숨깁니다.",
            self.hide_shortcut,
        )
        self._add_setting_row(
            shortcuts_layout,
            "현재 번역문 복사",
            "마지막으로 선택한 번역문을 클립보드에 복사합니다.",
            self.copy_shortcut,
            last=True,
        )
        content.addWidget(self.shortcuts_card)

        content.addWidget(self._section_label("업데이트 및 개인정보", top=22))
        maintenance, maintenance_layout = self._card()
        self._add_setting_row(
            maintenance_layout,
            "자동 업데이트",
            "GitHub Release에 게시된 새 버전을 자동으로 확인합니다.",
            self.auto_update,
        )
        self._add_setting_row(
            maintenance_layout,
            "GitHub 저장소",
            "공개 릴리스 정보를 확인할 GitHub 저장소 주소입니다.",
            self.update_repository,
        )
        update_row = QWidget()
        update_row_layout = QHBoxLayout(update_row)
        update_row_layout.setContentsMargins(0, 2, 0, 2)
        update_row_layout.setSpacing(12)
        update_row_layout.addWidget(self.update_status, 1)
        update_row_layout.addWidget(self.check_update_button)
        maintenance_layout.addWidget(update_row)
        maintenance_layout.addWidget(self._separator())

        cache_title = QLabel("캐시와 외부 전송")
        cache_title.setObjectName("settingTitle")
        cache_description = QLabel(
            "최근 번역은 메모리에서 즉시 재사용하고 전체 기록은 사용자 AppData의 SQLite DB에 "
            "저장합니다. 외부 API를 사용할 때에도 화면 이미지는 전송하지 않으며, 추출한 "
            "텍스트만 전송합니다."
        )
        cache_description.setObjectName("settingDescription")
        cache_description.setWordWrap(True)
        maintenance_layout.addWidget(cache_title)
        maintenance_layout.addWidget(cache_description)
        maintenance_layout.addWidget(self._separator())

        warning_title = QLabel("DOM 모드 주의")
        warning_title.setObjectName("settingTitle")
        warning = QLabel(
            "Discord가 공식 지원하는 확장 방식이 아니어서 클라이언트 업데이트로 동작하지 "
            "않을 수 있습니다. 약관 위반 또는 계정 제재 가능성을 확인한 후 사용하시기 바랍니다."
        )
        warning.setObjectName("privacyWarning")
        warning.setWordWrap(True)
        maintenance_layout.addWidget(warning_title)
        maintenance_layout.addWidget(warning)
        maintenance_layout.addWidget(self._separator())

        diagnostics = QLabel(
            f"{PRODUCT_NAME} {__version__}  ·  Windows 10/11  ·  "
            "Discord API와 사용자 토큰을 사용하지 않습니다."
        )
        diagnostics.setObjectName("settingDescription")
        diagnostics.setWordWrap(True)
        maintenance_layout.addWidget(diagnostics)
        content.addWidget(maintenance)
        content.addStretch()

        self.settings_scroll.setWidget(scroll_body)
        self._scroll_indicator = OverlayScrollIndicatorController(
            self.settings_scroll,
            self,
            lambda: palette_for(
                str(self.ui_theme.currentData() or self.config.ui_theme)
            )["accent"],
        )
        self.finished.connect(self._scroll_indicator.dispose)
        root.addWidget(self.settings_scroll, 1)

        footer = QHBoxLayout()
        footer.setContentsMargins(0, 14, 8, 0)
        footer.addWidget(QLabel(f"{PRODUCT_NAME} · 설정은 이 PC에만 저장됩니다."))
        footer.itemAt(0).widget().setObjectName("footerNote")
        footer.addStretch()
        cancel = QPushButton("취소")
        save = QPushButton("저장")
        save.setProperty("primary", True)
        cancel.clicked.connect(self.reject)
        save.clicked.connect(self._accept_if_valid)
        footer.addWidget(cancel)
        footer.addWidget(save)
        root.addLayout(footer)

    @staticmethod
    def _section_label(text: str, *, top: int = 0) -> QLabel:
        label = QLabel(text)
        label.setObjectName("sectionLabel")
        label.setContentsMargins(2, top, 0, 8)
        return label

    @staticmethod
    def _card() -> tuple[QFrame, QVBoxLayout]:
        card = QFrame()
        card.setObjectName("card")
        layout = QVBoxLayout(card)
        layout.setContentsMargins(18, 14, 18, 14)
        layout.setSpacing(12)
        return card, layout

    def _add_setting_row(
        self,
        layout: QVBoxLayout,
        title: str,
        description: str,
        control: QWidget,
        *,
        last: bool = False,
    ) -> None:
        row = QWidget()
        row.setObjectName("settingRow")
        row_layout = QHBoxLayout(row)
        row_layout.setContentsMargins(0, 3, 0, 3)
        row_layout.setSpacing(24)
        copy = QVBoxLayout()
        copy.setSpacing(3)
        title_label = QLabel(title)
        title_label.setObjectName("settingTitle")
        detail = QLabel(description)
        detail.setObjectName("settingDescription")
        detail.setWordWrap(True)
        copy.addWidget(title_label)
        copy.addWidget(detail)
        row_layout.addLayout(copy, 1)
        if not isinstance(control, QCheckBox):
            control.setFixedWidth(238)
        row_layout.addWidget(control, 0, Qt.AlignmentFlag.AlignVCenter)
        layout.addWidget(row)
        if not last:
            layout.addWidget(self._separator())

    @staticmethod
    def _separator() -> QFrame:
        separator = QFrame()
        separator.setObjectName("separator")
        separator.setFrameShape(QFrame.Shape.HLine)
        return separator

    def _accept_if_valid(self) -> None:
        try:
            self._normalized_shortcuts()
        except ValueError as exc:
            self.settings_scroll.ensureWidgetVisible(self.shortcuts_card, 0, 24)
            QMessageBox.warning(self, "단축키를 확인해 주세요", str(exc))
            return
        self.accept()

    def _normalized_shortcuts(self) -> tuple[str, str, str, str]:
        return tuple(
            normalize_shortcut(edit.keySequence().toString(QKeySequence.SequenceFormat.PortableText))
            for edit in (
                self.toggle_shortcut,
                self.original_shortcut,
                self.hide_shortcut,
                self.copy_shortcut,
            )
        )

    def apply(self) -> None:
        shortcuts = self._normalized_shortcuts()
        self.config.enabled = self.enabled.isChecked()
        self.config.target_language = Language(self.language.currentData())
        self.config.translator = str(self.translator.currentData())
        self.config.hymt_device = str(self.hymt_device.currentData())
        self.config.speech_style = str(self.speech_style.currentData())
        self.config.ui_theme = str(self.ui_theme.currentData())
        self.config.theme = str(self.theme.currentData())
        self.config.background_color = self.background_color.text().strip()
        self.config.text_color = self.text_color.text().strip()
        self.config.overlay_opacity = self.opacity.value()
        self.config.font_scale = self.font_scale.value()
        self.config.capture_fps = self.fps.value()
        (
            self.config.hotkeys.toggle_translation,
            self.config.hotkeys.toggle_original,
            self.config.hotkeys.hide_overlay,
            self.config.hotkeys.copy_current,
        ) = shortcuts
        self.config.auto_update = self.auto_update.isChecked()
        self.config.update_repository = self.update_repository.text().strip()

    def _apply_live_theme(self) -> None:
        preference = str(self.ui_theme.currentData() or self.config.ui_theme)
        self.setStyleSheet(settings_stylesheet(preference))
        apply_window_theme(self, preference)
        if hasattr(self, "_scroll_indicator"):
            self._scroll_indicator.track.update()
        self.enabled.update()
        self.auto_update.update()

    def _update_engine_notice(self) -> None:
        if not hasattr(self, "privacy"):
            return
        selected = str(self.translator.currentData())
        is_hymt = selected.startswith("hymt_")
        self.hymt_device.setEnabled(is_hymt)
        if is_hymt:
            size = "약 4.62GB" if selected == "hymt_7b" else "약 1.13GB"
            self.privacy.setText(
                f"Hy-MT2 공식 모델 {size}를 사용자 캐시에 저장하고 PC에서 번역합니다. "
                "채팅 텍스트와 화면 이미지는 외부 번역 서비스로 전송되지 않습니다."
            )
        elif selected in {"chatgpt", "claude", "gemini"}:
            service = {
                "chatgpt": "ChatGPT",
                "claude": "Claude",
                "gemini": "Gemini",
            }[selected]
            self.privacy.setText(
                f"별도 API 키 없이 공식 CLI에 로그인된 {service} 플랜을 사용합니다. "
                "화면 이미지는 전송되지 않으며 추출한 메시지 텍스트만 외부로 전송됩니다."
            )
        elif selected == "deepl":
            self.privacy.setText(
                "화면 이미지는 전송되지 않으며 추출한 메시지 텍스트만 DeepL API로 전송됩니다."
            )
        else:
            self.privacy.setText("텍스트는 외부 번역 서비스로 전송되지 않습니다.")

    def _update_action(self) -> None:
        if self._available_release is not None:
            QDesktopServices.openUrl(QUrl(self._available_release.page_url))
            return
        repository = self.update_repository.text().strip()
        self.check_update_button.setEnabled(False)
        self.update_status.setText("GitHub에서 최신 릴리스를 확인하고 있습니다...")

        def worker() -> None:
            client = None
            try:
                client = GitHubReleaseClient(repository)
                release = client.check_for_update(__version__)
                self._update_results.put((release, ""))
            except Exception as exc:
                self._update_results.put((None, str(exc)))
            finally:
                if client is not None:
                    client.close()

        threading.Thread(target=worker, name="settings-update-check", daemon=True).start()

    def _poll_update_result(self) -> None:
        try:
            release, error = self._update_results.get_nowait()
        except queue.Empty:
            return
        self.check_update_button.setEnabled(True)
        if error:
            self.update_status.setText(f"업데이트 확인 실패: {error}")
            return
        if release is None:
            self.update_status.setText("현재 버전이 최신이거나 공개된 릴리스가 없습니다.")
            return
        self._available_release = release
        self.update_status.setText(f"새 버전 {release.version}을 사용할 수 있습니다.")
        self.check_update_button.setText("릴리스 페이지 열기")
