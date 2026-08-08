from __future__ import annotations

from PySide6.QtCore import Qt, QTimer
from PySide6.QtWidgets import QMessageBox, QWidget

from .visuals import apply_window_theme, settings_stylesheet

CONSENT_TITLE = "Discord 자동 재시작을 허용할까요?"
CONSENT_MESSAGE = (
    "실시간 번역을 켜면 Discord가 디버그 렌더러 모드로 실행되지 않았을 때 "
    "15초 안내 후 자동으로 다시 시작합니다.\n\n"
    "재시작하면 작성 중인 메시지가 사라지거나 통화가 종료될 수 있습니다."
)
COUNTDOWN_TITLE = "Discord 번역 연결을 준비할게요"


def ask_auto_restart_consent(theme: str, parent: QWidget | None = None) -> bool:
    box = _message_box(theme, parent)
    box.setWindowTitle(CONSENT_TITLE)
    box.setIcon(QMessageBox.Icon.Information)
    box.setText(CONSENT_MESSAGE)
    accept = box.addButton("동의하고 켜기", QMessageBox.ButtonRole.AcceptRole)
    cancel = box.addButton("취소", QMessageBox.ButtonRole.RejectRole)
    box.setDefaultButton(cancel)
    box.exec()
    return box.clickedButton() is accept


def ask_restart_countdown(
    theme: str,
    *,
    seconds: int = 15,
    parent: QWidget | None = None,
) -> bool:
    remaining = max(1, int(seconds))
    box = _message_box(theme, parent)
    box.setWindowTitle(COUNTDOWN_TITLE)
    box.setIcon(QMessageBox.Icon.Information)
    restart = box.addButton("지금 재시작", QMessageBox.ButtonRole.AcceptRole)
    cancel = box.addButton("취소", QMessageBox.ButtonRole.RejectRole)
    box.setDefaultButton(cancel)
    auto_accepted = False

    def update_message() -> None:
        box.setText(
            "Discord 디버그 렌더러에 연결할 수 없습니다.\n"
            "작성 중인 메시지가 사라지거나 통화가 종료될 수 있습니다.\n\n"
            f"{remaining}초 후 Discord를 자동으로 다시 시작합니다."
        )

    def tick() -> None:
        nonlocal remaining, auto_accepted
        remaining -= 1
        if remaining <= 0:
            auto_accepted = True
            box.accept()
            return
        update_message()

    update_message()
    timer = QTimer(box)
    timer.timeout.connect(tick)
    timer.start(1000)
    box.exec()
    timer.stop()
    return auto_accepted or box.clickedButton() is restart


def _message_box(theme: str, parent: QWidget | None) -> QMessageBox:
    box = QMessageBox(parent)
    box.setWindowFlag(Qt.WindowType.WindowStaysOnTopHint, True)
    box.setTextFormat(Qt.TextFormat.PlainText)
    box.setStyleSheet(settings_stylesheet(theme))
    apply_window_theme(box, theme)
    return box


__all__ = [
    "CONSENT_MESSAGE",
    "CONSENT_TITLE",
    "COUNTDOWN_TITLE",
    "ask_auto_restart_consent",
    "ask_restart_countdown",
]
