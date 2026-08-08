from __future__ import annotations

import ctypes
import queue
import sys
import threading
from pathlib import Path

from PySide6.QtCore import QEvent, Qt, QTimer, QUrl
from PySide6.QtGui import QDesktopServices, QKeySequence, QWheelEvent
from PySide6.QtWidgets import (
    QAbstractButton,
    QAbstractScrollArea,
    QAbstractSpinBox,
    QCheckBox,
    QComboBox,
    QDialog,
    QFrame,
    QHBoxLayout,
    QKeySequenceEdit,
    QLabel,
    QMessageBox,
    QPlainTextEdit,
    QPushButton,
    QScrollArea,
    QSpinBox,
    QVBoxLayout,
    QWidget,
)

from .. import __version__
from ..branding import (
    AUTHOR_PROFILE_URL,
    DEFAULT_UPDATE_REPOSITORY,
    PRODUCT_NAME,
    SOURCE_REPOSITORY_URL,
)
from ..config import AppConfig
from ..models import Language
from ..updater import GitHubReleaseClient, ReleaseInfo
from .hotkeys import normalize_shortcut
from .overlay_scroll_indicator import OverlayScrollIndicatorController
from .toggle_switch import ToggleSwitch
from .visuals import app_icon, apply_window_theme, palette_for, settings_stylesheet


def bring_dialog_to_front(dialog: QDialog) -> None:
    if dialog.isMinimized():
        dialog.showNormal()
    else:
        dialog.show()
    dialog.raise_()
    dialog.activateWindow()
    if sys.platform == "win32":
        try:
            hwnd = int(dialog.winId())
            ctypes.windll.user32.ShowWindow(hwnd, 9)
            ctypes.windll.user32.SetForegroundWindow(hwnd)
        except (AttributeError, OSError, TypeError, ValueError):
            pass


class ScrollSafeComboBox(QComboBox):
    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._popup_view = self.view()
        self._popup_view.setMouseTracking(True)
        self._popup_view.viewport().setMouseTracking(True)
        self._popup_view.viewport().installEventFilter(self)

    def wheelEvent(self, event: QWheelEvent) -> None:
        event.ignore()

    def eventFilter(self, watched, event) -> bool:
        if watched is self._popup_view.viewport():
            if event.type() in (QEvent.Type.MouseMove, QEvent.Type.HoverMove):
                index = self._popup_view.indexAt(event.position().toPoint())
                if index.isValid() and index != self._popup_view.currentIndex():
                    self._popup_view.setCurrentIndex(index)
                    self._popup_view.viewport().update()
            elif event.type() == QEvent.Type.Leave:
                selected = self.model().index(self.currentIndex(), 0)
                if selected.isValid():
                    self._popup_view.setCurrentIndex(selected)
        return super().eventFilter(watched, event)


class ScrollSafeSpinBox(QSpinBox):
    def wheelEvent(self, event: QWheelEvent) -> None:
        event.ignore()


def _use_pointing_hand_for_buttons(root: QWidget) -> None:
    for button in root.findChildren(QAbstractButton):
        button.setCursor(Qt.CursorShape.PointingHandCursor)


def _bundled_document(name: str) -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent / name
    project_root = Path(__file__).resolve().parents[3]
    return project_root / ("LICENSE" if name == "LICENSE.txt" else name)


class LicenseDialog(QDialog):
    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setWindowTitle(f"{PRODUCT_NAME} 라이선스")
        self.setWindowIcon(app_icon())
        self.resize(680, 620)
        self.setMinimumSize(520, 440)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(20, 20, 20, 20)
        layout.setSpacing(12)
        title = QLabel("라이선스 및 제3자 고지")
        title.setObjectName("pageTitle")
        layout.addWidget(title)
        description = QLabel("배포 조건과 포함된 오픈소스 구성요소를 확인할 수 있습니다.")
        description.setObjectName("pageDescription")
        layout.addWidget(description)

        documents = []
        for filename in (
            "LICENSE.txt",
            "THIRD_PARTY_NOTICES.md",
            "licenses/Hy-MT2-1.8B-GGUF-LICENSE.txt",
            "licenses/Hy-MT2-7B-GGUF-LICENSE.txt",
        ):
            path = _bundled_document(filename)
            try:
                documents.append(path.read_text(encoding="utf-8"))
            except OSError:
                documents.append(f"{filename} 문서를 찾지 못했습니다.")
        text = QPlainTextEdit("\n\n".join(documents))
        text.setObjectName("licenseText")
        text.setReadOnly(True)
        layout.addWidget(text, 1)

        close_button = QPushButton("닫기")
        close_button.setFixedWidth(68)
        close_button.clicked.connect(self.accept)
        footer = QHBoxLayout()
        footer.addStretch()
        footer.addWidget(close_button)
        layout.addLayout(footer)
        _use_pointing_hand_for_buttons(self)


class SettingsDialog(QDialog):
    def __init__(self, config: AppConfig, parent=None) -> None:
        super().__init__(parent)
        self.setWindowFlag(Qt.WindowType.WindowMinimizeButtonHint, True)
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
        _use_pointing_hand_for_buttons(self)
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

        self.language = ScrollSafeComboBox()
        for label, value in (
            ("한국어", "ko"),
            ("日本語", "ja"),
            ("English", "en"),
            ("简体中文", "zh"),
            ("繁體中文", "zh-Hant"),
        ):
            self.language.addItem(label, value)
        self.language.setCurrentIndex(self.language.findData(self.config.target_language.value))

        self.translator = ScrollSafeComboBox()
        self.translator.addItem("Hy-MT2 1.8B Q4 (로컬·기본)", "hymt_1_8b")
        self.translator.addItem("Hy-MT2 7B Q4 (로컬·품질 우선)", "hymt_7b")
        self.translator.addItem("ChatGPT Plus/Pro (Codex CLI)", "chatgpt")
        self.translator.addItem("Claude Pro/Max (Claude Code)", "claude")
        self.translator.addItem("Gemini Pro/Ultra (Antigravity CLI)", "gemini")
        self.translator.addItem("DeepL (API 키·외부 전송)", "deepl")
        self.translator.addItem("Mock 테스트", "mock")
        self.translator.setCurrentIndex(max(0, self.translator.findData(self.config.translator)))

        self.hymt_device = ScrollSafeComboBox()
        self.hymt_device.addItem("자동 (GPU 우선, CPU 대체)", "auto")
        self.hymt_device.addItem("CPU", "cpu")
        self.hymt_device.setCurrentIndex(
            max(0, self.hymt_device.findData(self.config.hymt_device))
        )

        self.keep_local_model_warm = ToggleSwitch("유지", theme_provider)
        self.keep_local_model_warm.setChecked(self.config.keep_local_model_warm)

        self.speech_style = ScrollSafeComboBox()
        self.speech_style.addItem("원문 말투 유지 (자동)", "auto")
        self.speech_style.addItem("항상 존댓말·격식체", "polite")
        self.speech_style.addItem("항상 반말·비격식체", "casual")
        self.speech_style.setCurrentIndex(
            max(0, self.speech_style.findData(self.config.speech_style))
        )

        self.ui_theme = ScrollSafeComboBox()
        self.ui_theme.addItem("시스템 설정 따르기", "system")
        self.ui_theme.addItem("라이트", "light")
        self.ui_theme.addItem("다크", "dark")
        self.ui_theme.setCurrentIndex(max(0, self.ui_theme.findData(self.config.ui_theme)))

        self.fps = ScrollSafeSpinBox()
        self.fps.setRange(2, 20)
        self.fps.setValue(self.config.capture_fps)
        self.fps.setButtonSymbols(QAbstractSpinBox.ButtonSymbols.NoButtons)
        self.fps.setSuffix(" 회/초")
        self.fps.setToolTip("숫자를 직접 입력하거나 키보드 ↑/↓로 조절할 수 있어요.")

        self.toggle_shortcut = self._shortcut_edit(self.config.hotkeys.toggle_translation)
        self.check_update_button = QPushButton("지금 확인")
        self.check_update_button.setFixedWidth(104)
        self.check_update_button.clicked.connect(self._update_action)
        self.update_status = QLabel("GitHub Release가 게시되면 여기에서 확인할 수 있습니다.")
        self.update_status.setObjectName("muted")
        self.update_status.setWordWrap(True)

        self.author_link = self._link_button("NudeNyang", AUTHOR_PROFILE_URL, "제작자 링크")
        self.github_link = self._link_button("GitHub", SOURCE_REPOSITORY_URL, "GitHub 링크")
        self.license_button = QPushButton("라이선스 보기")
        self.license_button.setFixedWidth(104)
        self.license_button.clicked.connect(self._show_license)
        self._license_dialog: LicenseDialog | None = None

    @staticmethod
    def _shortcut_edit(value: str) -> QKeySequenceEdit:
        edit = QKeySequenceEdit(QKeySequence(value))
        edit.setMaximumSequenceLength(1)
        edit.setClearButtonEnabled(True)
        return edit

    def _link_button(self, text: str, url: str, pending_label: str) -> QPushButton:
        button = QPushButton(text)
        button.setObjectName("appAuthorLink" if text == "NudeNyang" else "appGithubLink")
        button.setProperty("link", True)
        button.setCursor(Qt.CursorShape.PointingHandCursor)
        button.setToolTip(url or f"{pending_label} 주소 추가 예정")
        button.clicked.connect(lambda _checked=False: self._open_external_url(url))
        return button

    def _build_interface(self) -> None:
        root = QVBoxLayout(self)
        root.setContentsMargins(28, 18, 20, 20)
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
            "Discord DOM 번역과 로컬 모델 설정을 한곳에서 조절할 수 있습니다. "
            "변경 내용은 저장 후 적용됩니다."
        )
        description.setObjectName("pageDescription")
        description.setWordWrap(True)
        title_stack.addWidget(heading)
        title_stack.addWidget(description)
        header.addLayout(title_stack, 1)
        root.addLayout(header)
        root.addSpacing(14)

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
        (
            self.local_model_warm_row,
            self.local_model_warm_separator,
        ) = self._add_setting_row(
            general_layout,
            "로컬 모델 예열 유지",
            "번역을 꺼도 모델을 VRAM에 유지해 빠르게 다시 시작합니다. "
            "끄면 번역을 끌 때 VRAM을 반환합니다.",
            self.keep_local_model_warm,
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
            last=True,
        )
        content.addWidget(self.shortcuts_card)

        content.addWidget(self._section_label("앱 정보", top=22))
        app_info, app_info_layout = self._card()

        product_row = QWidget()
        product_row_layout = QHBoxLayout(product_row)
        product_row_layout.setContentsMargins(0, 2, 0, 2)
        product_row_layout.setSpacing(12)
        product_stack = QVBoxLayout()
        product_stack.setSpacing(3)
        product_name = QLabel(PRODUCT_NAME)
        product_name.setObjectName("appProductName")
        product_version = QLabel(f"버전 {__version__}")
        product_version.setObjectName("appVersion")
        product_stack.addWidget(product_name)
        product_stack.addWidget(product_version)
        product_row_layout.addLayout(product_stack, 1)
        links = QHBoxLayout()
        links.setSpacing(4)
        copyright_year = QLabel("© 2026")
        copyright_year.setObjectName("appMeta")
        link_separator_one = QLabel("·")
        link_separator_one.setObjectName("appMeta")
        link_separator_two = QLabel("·")
        link_separator_two.setObjectName("appMeta")
        links.addWidget(copyright_year)
        links.addWidget(link_separator_one)
        links.addWidget(self.author_link)
        links.addWidget(link_separator_two)
        links.addWidget(self.github_link)
        product_row_layout.addLayout(links)
        app_info_layout.addWidget(product_row)
        app_info_layout.addWidget(self._separator())

        update_row = QWidget()
        update_row_layout = QHBoxLayout(update_row)
        update_row_layout.setContentsMargins(0, 2, 0, 2)
        update_row_layout.setSpacing(12)
        update_stack = QVBoxLayout()
        update_stack.setSpacing(3)
        update_title = QLabel("자동 업데이트")
        update_title.setObjectName("settingTitle")
        self.update_status.setText(
            "새 버전을 자동으로 확인하고 설치 준비가 끝나면 알려드립니다."
        )
        self.update_status.setObjectName("settingDescription")
        update_stack.addWidget(update_title)
        update_stack.addWidget(self.update_status)
        update_row_layout.addLayout(update_stack, 1)
        update_row_layout.addWidget(self.check_update_button)
        app_info_layout.addWidget(update_row)
        app_info_layout.addWidget(self._separator())

        license_row = QWidget()
        license_row_layout = QHBoxLayout(license_row)
        license_row_layout.setContentsMargins(0, 2, 0, 2)
        license_row_layout.setSpacing(12)
        license_stack = QVBoxLayout()
        license_stack.setSpacing(3)
        copyright_label = QLabel("Copyright © 2026 Nude Translator contributors")
        copyright_label.setObjectName("appCopyright")
        license_summary = QLabel(
            "GNU GPL v3에 따라 이용 가능하며 별도 보증은 제공되지 않습니다."
        )
        license_summary.setObjectName("appLicenseSummary")
        license_stack.addWidget(copyright_label)
        license_stack.addWidget(license_summary)
        license_row_layout.addLayout(license_stack, 1)
        license_row_layout.addWidget(self.license_button)
        app_info_layout.addWidget(license_row)
        content.addWidget(app_info)
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
        cancel.setFixedWidth(68)
        save.setFixedWidth(68)
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
    ) -> tuple[QWidget, QFrame | None]:
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
        separator = None
        if not last:
            separator = self._separator()
            layout.addWidget(separator)
        return row, separator

    @staticmethod
    def _separator() -> QFrame:
        separator = QFrame()
        separator.setObjectName("separator")
        separator.setFrameShape(QFrame.Shape.HLine)
        return separator

    def _accept_if_valid(self) -> None:
        try:
            self._normalized_shortcut()
        except ValueError as exc:
            self.settings_scroll.ensureWidgetVisible(self.shortcuts_card, 0, 24)
            QMessageBox.warning(self, "단축키를 확인해 주세요", str(exc))
            return
        self.accept()

    def _normalized_shortcut(self) -> str:
        return normalize_shortcut(
            self.toggle_shortcut.keySequence().toString(
                QKeySequence.SequenceFormat.PortableText
            )
        )

    def apply(self) -> None:
        self.config.enabled = self.enabled.isChecked()
        self.config.target_language = Language(self.language.currentData())
        self.config.translator = str(self.translator.currentData())
        self.config.hymt_device = str(self.hymt_device.currentData())
        self.config.keep_local_model_warm = self.keep_local_model_warm.isChecked()
        self.config.speech_style = str(self.speech_style.currentData())
        self.config.ui_theme = str(self.ui_theme.currentData())
        self.config.capture_fps = self.fps.value()
        self.config.hotkeys.toggle_translation = self._normalized_shortcut()
        self.config.auto_update = True
        self.config.update_repository = DEFAULT_UPDATE_REPOSITORY

    def _apply_live_theme(self) -> None:
        preference = str(self.ui_theme.currentData() or self.config.ui_theme)
        self.setStyleSheet(settings_stylesheet(preference))
        apply_window_theme(self, preference)
        if hasattr(self, "_scroll_indicator"):
            self._scroll_indicator.track.update()
        self.enabled.update()
        self.keep_local_model_warm.update()

    def _update_engine_notice(self) -> None:
        if not hasattr(self, "privacy"):
            return
        selected = str(self.translator.currentData())
        is_hymt = selected.startswith("hymt_")
        self.hymt_device.setEnabled(is_hymt)
        self.keep_local_model_warm.setEnabled(is_hymt)
        self.local_model_warm_row.setVisible(is_hymt)
        if self.local_model_warm_separator is not None:
            self.local_model_warm_separator.setVisible(is_hymt)
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
        self.check_update_button.setEnabled(False)
        self.update_status.setText("GitHub에서 최신 릴리스를 확인하고 있습니다...")

        def worker() -> None:
            client = None
            try:
                client = GitHubReleaseClient(DEFAULT_UPDATE_REPOSITORY)
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

    @staticmethod
    def _open_external_url(url: str) -> None:
        if url:
            QDesktopServices.openUrl(QUrl(url))

    def _show_license(self) -> None:
        if self._license_dialog is not None:
            bring_dialog_to_front(self._license_dialog)
            return
        dialog = LicenseDialog(self)
        self._license_dialog = dialog
        dialog.setStyleSheet(settings_stylesheet(str(self.ui_theme.currentData())))
        apply_window_theme(dialog, str(self.ui_theme.currentData()))
        dialog.finished.connect(lambda _result: self._license_closed(dialog))
        bring_dialog_to_front(dialog)

    def _license_closed(self, dialog: LicenseDialog) -> None:
        if self._license_dialog is dialog:
            self._license_dialog = None
        dialog.deleteLater()
