from PySide6.QtCore import QEvent, QPoint, QPointF, Qt
from PySide6.QtGui import QColor, QHoverEvent, QWheelEvent
from PySide6.QtWidgets import (
    QAbstractButton,
    QAbstractSpinBox,
    QApplication,
    QComboBox,
    QKeySequenceEdit,
    QLabel,
    QPlainTextEdit,
    QPushButton,
    QSpinBox,
)

from discord_translate_overlay.branding import DEFAULT_UPDATE_REPOSITORY
from discord_translate_overlay.config import AppConfig
from discord_translate_overlay.ui.settings_dialog import SettingsDialog
from discord_translate_overlay.ui.visuals import DARK, LIGHT, app_icon, settings_stylesheet


def test_settings_window_uses_product_name_and_saves_new_controls() -> None:
    app = QApplication.instance() or QApplication([])
    config = AppConfig()
    dialog = SettingsDialog(config)
    try:
        assert dialog.windowTitle() == "Nude Translator 설정"
        dialog.toggle_shortcut.setKeySequence("Ctrl+Alt+T")
        dialog.ui_theme.setCurrentIndex(dialog.ui_theme.findData("dark"))
        assert not dialog.local_model_warm_row.isHidden()
        dialog.keep_local_model_warm.setChecked(False)
        dialog.apply()

        assert config.hotkeys.toggle_translation == "Ctrl+Alt+T"
        assert config.ui_theme == "dark"
        assert config.auto_update
        assert config.update_repository == DEFAULT_UPDATE_REPOSITORY
        assert not config.keep_local_model_warm
    finally:
        dialog.close()
        app.processEvents()


def test_local_model_warm_setting_is_only_shown_for_local_models() -> None:
    app = QApplication.instance() or QApplication([])
    dialog = SettingsDialog(AppConfig(translator="chatgpt"))
    try:
        assert dialog.local_model_warm_row.isHidden()
        dialog.translator.setCurrentIndex(dialog.translator.findData("hymt_7b"))
        assert not dialog.local_model_warm_row.isHidden()
    finally:
        dialog.close()
        app.processEvents()


def test_settings_window_can_be_toggled_from_the_windows_taskbar() -> None:
    app = QApplication.instance() or QApplication([])
    dialog = SettingsDialog(AppConfig())
    try:
        assert dialog.windowFlags() & Qt.WindowType.WindowMinimizeButtonHint
    finally:
        dialog.close()
        app.processEvents()


def test_footer_buttons_have_the_same_size() -> None:
    app = QApplication.instance() or QApplication([])
    dialog = SettingsDialog(AppConfig())
    try:
        buttons = {button.text(): button for button in dialog.findChildren(QPushButton)}

        assert buttons["취소"].sizeHint() == buttons["저장"].sizeHint()
        assert buttons["취소"].minimumWidth() == 68
        assert buttons["저장"].minimumWidth() == 68
        assert buttons["취소"].maximumWidth() == 68
        assert buttons["저장"].maximumWidth() == 68
    finally:
        dialog.close()
        app.processEvents()


def test_selects_ignore_mouse_wheel_changes_even_with_focus() -> None:
    app = QApplication.instance() or QApplication([])
    dialog = SettingsDialog(AppConfig())
    try:
        dialog.show()
        app.processEvents()
        for combo in dialog.findChildren(QComboBox):
            combo.setCurrentIndex(0)
            combo.setFocus()
            app.processEvents()
            assert combo.hasFocus()
            event = QWheelEvent(
                QPointF(10, 10),
                QPointF(10, 10),
                QPoint(),
                QPoint(0, -120),
                Qt.MouseButton.NoButton,
                Qt.KeyboardModifier.NoModifier,
                Qt.ScrollPhase.ScrollUpdate,
                False,
            )

            QApplication.sendEvent(combo, event)

            assert combo.currentIndex() == 0
            assert not event.isAccepted()
    finally:
        dialog.close()
        app.processEvents()


def test_capture_frequency_ignores_mouse_wheel_changes_even_with_focus() -> None:
    app = QApplication.instance() or QApplication([])
    dialog = SettingsDialog(AppConfig(capture_fps=10))
    try:
        dialog.show()
        dialog.fps.setFocus()
        app.processEvents()
        event = QWheelEvent(
            QPointF(10, 10),
            QPointF(10, 10),
            QPoint(),
            QPoint(0, 120),
            Qt.MouseButton.NoButton,
            Qt.KeyboardModifier.NoModifier,
            Qt.ScrollPhase.ScrollUpdate,
            False,
        )

        QApplication.sendEvent(dialog.fps, event)

        assert dialog.fps.value() == 10
        assert not event.isAccepted()
    finally:
        dialog.close()
        app.processEvents()


def test_clickable_buttons_use_the_pointing_hand_cursor() -> None:
    app = QApplication.instance() or QApplication([])
    dialog = SettingsDialog(AppConfig())
    try:
        buttons = dialog.findChildren(QAbstractButton)

        assert buttons
        assert all(
            button.cursor().shape() == Qt.CursorShape.PointingHandCursor
            for button in buttons
        )
    finally:
        dialog.close()
        app.processEvents()


def test_dom_only_settings_hide_legacy_overlay_controls() -> None:
    app = QApplication.instance() or QApplication([])
    dialog = SettingsDialog(AppConfig())
    try:
        labels = {label.text() for label in dialog.findChildren(QLabel)}
        assert {
            "Discord 테마",
            "배경색",
            "글자색",
            "배경 불투명도",
            "글자 크기 배율",
            "원문·번역 전환",
            "오버레이 숨기기",
            "현재 번역문 복사",
            "GitHub 저장소",
            "캐시와 외부 전송",
            "DOM 모드 주의",
        }.isdisjoint(labels)
        assert len(dialog.findChildren(QKeySequenceEdit)) == 1
    finally:
        dialog.close()
        app.processEvents()


def test_app_info_card_has_sentory_style_actions() -> None:
    app = QApplication.instance() or QApplication([])
    dialog = SettingsDialog(AppConfig())
    try:
        labels = {label.text() for label in dialog.findChildren(QLabel)}
        buttons = {button.text(): button for button in dialog.findChildren(QPushButton)}

        assert "앱 정보" in labels
        assert "자동 업데이트" in labels
        assert "GNU GPL v3에 따라 이용 가능하며 별도 보증은 제공되지 않습니다." in labels
        assert {"NudeNyang", "GitHub", "지금 확인", "라이선스 보기"} <= buttons.keys()
        assert buttons["NudeNyang"].property("link")
        assert buttons["GitHub"].property("link")
        assert buttons["지금 확인"].width() == buttons["라이선스 보기"].width() == 104
    finally:
        dialog.close()
        app.processEvents()


def test_header_does_not_duplicate_the_app_version() -> None:
    app = QApplication.instance() or QApplication([])
    dialog = SettingsDialog(AppConfig())
    try:
        labels = dialog.findChildren(QLabel)

        assert not any(label.objectName() == "versionBadge" for label in labels)
        assert any(label.text().startswith("버전 ") for label in labels)
    finally:
        dialog.close()
        app.processEvents()


def test_header_is_raised_and_keeps_a_fixed_gap_above_scrolling_content() -> None:
    app = QApplication.instance() or QApplication([])
    dialog = SettingsDialog(AppConfig())
    try:
        dialog.resize(720, 780)
        dialog.show()
        app.processEvents()
        title = next(
            label
            for label in dialog.findChildren(QLabel)
            if label.objectName() == "pageTitle" and label.text() == "설정"
        )
        description = next(
            label
            for label in dialog.findChildren(QLabel)
            if label.objectName() == "pageDescription"
            and label.text().startswith("Discord DOM")
        )
        description_bottom = description.mapTo(
            dialog, description.rect().bottomLeft()
        ).y()

        assert title.mapTo(dialog, QPoint()).y() <= 20
        assert dialog.settings_scroll.geometry().top() - description_bottom - 1 >= 12
    finally:
        dialog.close()
        app.processEvents()


def test_light_theme_gives_all_input_controls_a_visible_hover_state() -> None:
    stylesheet = settings_stylesheet("light")

    assert "QSpinBox:hover" in stylesheet
    assert "QDoubleSpinBox:hover" in stylesheet
    assert f"background: {LIGHT['popup_hover']};" in stylesheet


def test_light_select_hover_uses_a_stronger_dedicated_highlight() -> None:
    stylesheet = settings_stylesheet("light")

    assert "QComboBox:hover {" in stylesheet
    assert f"border: 2px solid {LIGHT['accent']};" in stylesheet
    assert f"background: {LIGHT['control_hover']};" in stylesheet
    assert "QComboBox::drop-down:hover" in stylesheet


def test_open_select_items_have_explicit_hover_and_selected_highlights() -> None:
    stylesheet = settings_stylesheet("light")

    assert "QComboBox QAbstractItemView::item:hover" in stylesheet
    assert "QComboBox QAbstractItemView::item:selected" in stylesheet
    assert f"background: {LIGHT['control_hover']};" in stylesheet
    assert "border-left: 3px" not in stylesheet
    assert "outline: none;" in stylesheet


def test_dark_select_popup_highlight_is_clearly_distinct_from_its_surface() -> None:
    surface = QColor(DARK["surface"])
    highlight = QColor(DARK["control_hover"])

    assert highlight.lightness() - surface.lightness() >= 20


def test_open_select_tracks_the_hovered_row_without_changing_its_value() -> None:
    app = QApplication.instance() or QApplication([])
    dialog = SettingsDialog(AppConfig(ui_theme="light"))
    try:
        dialog.show()
        app.processEvents()
        combo = dialog.hymt_device
        combo.setCurrentIndex(0)
        combo.showPopup()
        app.processEvents()
        view = combo.view()
        second_row = view.model().index(1, 0)

        second_position = QPointF(view.visualRect(second_row).center())
        event = QHoverEvent(
            QEvent.Type.HoverMove,
            second_position,
            QPointF(view.viewport().mapToGlobal(second_position.toPoint())),
            QPointF(0, 0),
        )
        QApplication.sendEvent(view.viewport(), event)
        app.processEvents()

        assert view.currentIndex().row() == 1
        assert combo.currentIndex() == 0
    finally:
        dialog.hymt_device.hidePopup()
        dialog.close()
        app.processEvents()


def test_app_icon_uses_a_cat_paw_mark() -> None:
    _app = QApplication.instance() or QApplication([])
    image = app_icon(size=64).pixmap(64, 64).toImage()

    for x, y in ((18, 24), (27, 18), (37, 18), (46, 24), (32, 42)):
        color = image.pixelColor(x, y)
        assert color.red() >= 245
        assert color.green() >= 245
        assert color.blue() >= 245


def test_capture_frequency_uses_a_clean_buttonless_input() -> None:
    app = QApplication.instance() or QApplication([])
    dialog = SettingsDialog(AppConfig(capture_fps=20))
    try:
        spinbox = dialog.findChild(QSpinBox)

        assert spinbox is dialog.fps
        assert spinbox.buttonSymbols() == QAbstractSpinBox.ButtonSymbols.NoButtons
        assert spinbox.suffix() == " 회/초"
    finally:
        dialog.close()
        app.processEvents()


def test_translation_model_does_not_offer_original_display() -> None:
    app = QApplication.instance() or QApplication([])
    dialog = SettingsDialog(AppConfig())
    try:
        assert dialog.translator.findData("original") == -1
        assert "원문 표시" not in {
            dialog.translator.itemText(index)
            for index in range(dialog.translator.count())
        }
    finally:
        dialog.close()
        app.processEvents()


def test_license_action_opens_bundled_notices() -> None:
    app = QApplication.instance() or QApplication([])
    dialog = SettingsDialog(AppConfig())
    try:
        dialog._show_license()
        app.processEvents()

        assert dialog._license_dialog is not None
        license_text = dialog._license_dialog.findChild(QPlainTextEdit)
        assert license_text is not None
        assert "GNU GENERAL PUBLIC LICENSE" in license_text.toPlainText()
        assert "Third-party notices" in license_text.toPlainText()
        assert "Hy-MT2-1.8B-GGUF is licensed under the Apache License" in license_text.toPlainText()
        assert "Hy-MT2-7B-GGUF is licensed under the Apache License" in license_text.toPlainText()
    finally:
        if dialog._license_dialog is not None:
            dialog._license_dialog.close()
        dialog.close()
        app.processEvents()
