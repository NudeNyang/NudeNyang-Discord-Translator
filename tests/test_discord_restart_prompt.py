from PySide6.QtCore import QTimer
from PySide6.QtWidgets import QApplication, QMessageBox

from discord_translate_overlay.ui.discord_restart_prompt import (
    CONSENT_MESSAGE,
    ask_auto_restart_consent,
    ask_restart_countdown,
)


def test_first_enable_notice_explains_restart_and_user_risk() -> None:
    assert "15초" in CONSENT_MESSAGE
    assert "작성 중인 메시지" in CONSENT_MESSAGE
    assert "통화" in CONSENT_MESSAGE


def test_first_enable_notice_can_be_cancelled() -> None:
    app = QApplication.instance() or QApplication([])

    def cancel() -> None:
        box = app.activeModalWidget()
        assert isinstance(box, QMessageBox)
        box.reject()

    QTimer.singleShot(0, cancel)
    assert not ask_auto_restart_consent("light")


def test_countdown_automatically_accepts_when_time_expires() -> None:
    app = QApplication.instance() or QApplication([])

    assert app is not None
    assert ask_restart_countdown("dark", seconds=1)
