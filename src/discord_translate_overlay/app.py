from __future__ import annotations

import argparse
import copy
import ctypes
import logging
import os
import sys
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

from PySide6.QtCore import QTimer
from PySide6.QtGui import QAction, QActionGroup, QCursor
from PySide6.QtWidgets import QApplication, QDialog, QMenu, QMessageBox, QSystemTrayIcon

from .accessibility import DiscordUiaReader
from .branding import PRODUCT_NAME
from .cache import TranslationCache
from .capture.chat_region import detect_chat_region
from .capture.discord_window import DiscordWindowLocator, is_foreground_or_related
from .capture.dxgi import DxgiCapture
from .channels import ChannelNameProcessor, ChannelNameResult, detect_channel_regions
from .config import AppConfig, load_config, save_config
from .env import load_local_env
from .models import Language, OverlayStyle, Rect
from .ocr.paddle_dual import PaddleDualOcr
from .pipeline import PipelineResult, TranslationPipeline
from .theme import detect_theme
from .translation.base import Translator
from .translation.deepl import DeepLTranslator
from .translation.hymt import HyMtTranslator
from .translation.mock import MockTranslator, OriginalTranslator
from .translation.subscription_cli import SubscriptionCliTranslator
from .ui.hotkeys import GlobalHotkeys
from .ui.overlay import TranslationOverlay
from .ui.region_selector import RegionSelector
from .ui.settings_dialog import SettingsDialog, bring_dialog_to_front
from .ui.update_coordinator import UpdateCoordinator
from .ui.visuals import (
    app_icon,
    configure_tray_menu,
    menu_stylesheet,
    translation_status_icon,
)

LOGGER = logging.getLogger("discord_translate_overlay")


@dataclass(frozen=True, slots=True)
class _FrameResult:
    chat: PipelineResult | None
    channels: ChannelNameResult | None


class OverlayController:
    def __init__(self, app: QApplication, config: AppConfig) -> None:
        self.app = app
        self.config = config
        self.overlay = TranslationOverlay(base_font_size=15)
        self.channel_sidebar_overlay = TranslationOverlay(
            base_font_size=12, constrain_to_source_width=True, single_line=True
        )
        self.channel_header_overlay = TranslationOverlay(
            base_font_size=12, constrain_to_source_width=True, single_line=True
        )
        self.capture = DxgiCapture()
        self.uia = DiscordUiaReader()
        self.cache = TranslationCache()
        self.ocr = PaddleDualOcr(device=config.ocr_device)
        self.translator = self._make_translator(config.translator)
        self.pipeline = TranslationPipeline(
            self.ocr, self.translator, self.cache, config.target_language
        )
        self.channel_processor = ChannelNameProcessor(
            self.ocr, self.translator, self.cache, config.target_language
        )
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="ocr")
        self.future: Future[_FrameResult | PipelineResult | None] | None = None
        self.current_region: Rect | None = None
        self.current_client_rect: Rect | None = None
        self.current_dpi = 96
        self.current_style = OverlayStyle((49, 51, 56), (219, 222, 225))
        self.last_error = ""
        self._region_selector: RegionSelector | None = None
        self._auto_region_key: tuple[int, int, int] | None = None
        self._auto_region: Rect | None = None
        self._pending_frame = None
        self._pending_channel_frame = None
        self._channel_result: ChannelNameResult | None = None
        self._closing = False
        self._local_warmup_translator: Translator | None = None
        self._settings_dialog: SettingsDialog | None = None
        self._last_region_probe = 0.0
        self._last_channel_probe = 0.0
        self._future_started_at = 0.0
        self._future_sequence = 0
        self._slow_future_logged = False
        self._current_geometry_signature: tuple[int, int, int, int] | None = None
        self._future_geometry_signature: tuple[int, int, int, int] | None = None
        self._force_next_frame = True

        self.tray = QSystemTrayIcon(app_icon(enabled=config.enabled), app)
        self.tray.setToolTip(PRODUCT_NAME)
        self.tray.setContextMenu(self._tray_menu())
        self.tray.activated.connect(self._tray_activated)
        self.tray.show()

        self.hotkeys = GlobalHotkeys()
        app.installNativeEventFilter(self.hotkeys)
        if not self._bind_hotkeys():
            self.tray.showMessage(
                "단축키 등록 실패",
                "설정한 단축키 중 하나를 다른 프로그램이 사용 중이야. 설정에서 바꿔줘.",
                QSystemTrayIcon.MessageIcon.Warning,
                5000,
            )
        self.hotkey_timer = QTimer()
        self.hotkey_timer.timeout.connect(self.hotkeys.poll)
        self.hotkey_timer.start(30)

        self.timer = QTimer()
        self.timer.timeout.connect(self.tick)
        self.timer.start(max(50, round(1000 / config.capture_fps)))
        self._manual_hidden = False

        self.updater = UpdateCoordinator(
            config,
            notify=self._notify_update,
            ready=self._update_ready,
        )
        self.updater.start()

        self._notify_translator()
        if self.config.keep_local_model_warm:
            self._start_local_model_warmup()

    def _notify_translator(self) -> None:
        if self.translator.sends_text_externally:
            if isinstance(self.translator, SubscriptionCliTranslator):
                readiness_error = self.translator.readiness_error()
                if readiness_error:
                    self.tray.showMessage(
                        f"{self.translator.display_name} 준비 필요",
                        readiness_error,
                        QSystemTrayIcon.MessageIcon.Warning,
                        7000,
                    )
                    return
            self.tray.showMessage(
                f"{self.translator.display_name} 번역 사용 중",
                "화면 이미지는 전송하지 않고 추출한 메시지 텍스트만 외부 번역 서비스로 보내.",
                QSystemTrayIcon.MessageIcon.Information,
                5000,
            )
        elif isinstance(self.translator, HyMtTranslator):
            self.tray.showMessage(
                "Hy-MT2 로컬 번역",
                "OCR 텍스트는 PC 밖으로 보내지 않아. 첫 번역 때 선택한 공식 모델을 받아.",
                QSystemTrayIcon.MessageIcon.Information,
                6000,
            )

    def _make_translator(self, name: str) -> Translator:
        if name == "mock":
            return MockTranslator()
        if name == "original":
            return OriginalTranslator()
        if name in {"chatgpt", "claude", "gemini"}:
            return SubscriptionCliTranslator(
                name,
                speech_style=self.config.speech_style,
            )
        if name in {"hymt_1_8b", "hymt_7b"}:
            return HyMtTranslator(
                "7b" if name == "hymt_7b" else "1.8b",
                device=self.config.hymt_device,
                speech_style=self.config.speech_style,
            )
        try:
            return DeepLTranslator()
        except RuntimeError:
            LOGGER.warning("DEEPL_API_KEY가 없어 원문 표시 모드로 시작해.")
            self.config.translator = "original"
            return OriginalTranslator()

    def tick(self) -> None:
        window = DiscordWindowLocator.find()
        if window is None:
            self._current_geometry_signature = None
            self._finish_processing()
            self._hide_overlays()
            self.current_region = None
            self.current_client_rect = None
            return
        if (
            not self.config.enabled
            or self._manual_hidden
            or not is_foreground_or_related(window.hwnd)
        ):
            self._current_geometry_signature = None
            self._finish_processing()
            self._hide_overlays()
            self.current_region = None
            self.current_client_rect = None
            return
        region = self._resolve_chat_region(window.client_rect, window.hwnd)
        self.current_region = region
        self.current_client_rect = window.client_rect
        self.current_dpi = window.dpi
        signature = _frame_geometry_signature(window.hwnd, region, window.dpi)
        if signature != self._current_geometry_signature:
            if self._current_geometry_signature is not None:
                # OCR coordinates are local to the captured frame. A pure screen
                # move can reuse them, but a size/DPI change cannot.
                self._hide_overlays()
            self._current_geometry_signature = signature
            self._force_next_frame = True
        self.overlay.set_target_rect(region, window.dpi)
        self._position_channel_overlays()
        self._probe_channel_frame(window.client_rect)
        self._finish_processing()
        if self.future is not None:
            elapsed = time.monotonic() - self._future_started_at
            if elapsed >= 30 and not self._slow_future_logged:
                LOGGER.warning(
                    "OCR frame %d is still processing after %.1fs",
                    self._future_sequence,
                    elapsed,
                )
                self._slow_future_logged = True
            return
        try:
            if self._pending_frame is not None:
                frame, self._pending_frame = self._pending_frame, None
            else:
                frame = self.capture.capture(region)
        except Exception as exc:
            self._report_error(f"화면 캡처 실패: {exc}")
            return
        if frame is None or frame.size == 0:
            return
        detected = detect_theme(frame, self.config.theme)
        background = _parse_hex_color(self.config.background_color) or detected.background_rgb
        foreground = _parse_hex_color(self.config.text_color) or detected.foreground_rgb
        self.current_style = OverlayStyle(
            background,
            foreground,
            self.config.overlay_opacity,
        )
        self._future_sequence += 1
        self._future_started_at = time.monotonic()
        self._slow_future_logged = False
        force = self._force_next_frame
        self._force_next_frame = False
        self._future_geometry_signature = signature
        channel_frame, self._pending_channel_frame = self._pending_channel_frame, None
        chat_local = region.translated(-window.client_rect.left, -window.client_rect.top)
        self.future = self.executor.submit(
            self._process_frame,
            frame,
            force,
            channel_frame,
            chat_local,
            window.dpi,
            window.hwnd,
            window.client_rect,
            region,
        )

    def _process_frame(
        self,
        chat_frame,
        force: bool,
        channel_frame,
        chat_local: Rect,
        dpi: int,
        hwnd: int = 0,
        client_screen: Rect | None = None,
        chat_screen: Rect | None = None,
    ) -> _FrameResult:
        snapshot = None
        if hwnd and client_screen is not None and chat_screen is not None:
            if channel_frame is not None:
                channel_regions = detect_channel_regions(channel_frame, chat_local, dpi)
                sidebar_screen = channel_regions.sidebar.translated(
                    client_screen.left, client_screen.top
                )
                header_screen = channel_regions.header.translated(
                    client_screen.left, client_screen.top
                )
            else:
                sidebar_screen = Rect(0, 0, 0, 0)
                header_screen = Rect(0, 0, 0, 0)
            snapshot = self.uia.read(
                hwnd,
                chat_screen,
                sidebar_screen,
                header_screen,
            )
        use_uia_messages = bool(
            snapshot is not None and snapshot.available and snapshot.visible_message_rows
        )
        chat = self.pipeline.process(
            chat_frame,
            force=force,
            accessibility_messages=snapshot.messages if snapshot is not None else None,
            accessibility_available=use_uia_messages,
        )
        channels = (
            self.channel_processor.process(
                channel_frame,
                chat_local,
                dpi,
                force=force,
                accessibility_sidebar=(
                    snapshot.sidebar_messages if snapshot is not None else None
                ),
                accessibility_header=(
                    snapshot.header_messages if snapshot is not None else None
                ),
                accessibility_available=bool(snapshot is not None and snapshot.available),
            )
            if channel_frame is not None
            else None
        )
        return _FrameResult(chat, channels)

    def _finish_processing(self) -> None:
        if self.future is None or not self.future.done():
            return
        future, self.future = self.future, None
        completed_signature = self._future_geometry_signature
        self._future_geometry_signature = None
        try:
            completed = future.result()
        except Exception as exc:
            LOGGER.exception("OCR/번역 파이프라인 실패")
            # The change detector may already have consumed this frame before
            # OCR or translation failed. Force and reset ensure the unchanged
            # startup screen is retried without requiring a user scroll.
            self._force_next_frame = True
            self.pipeline.change_detector.reset()
            self._report_error(f"OCR 또는 번역 실패: {exc}")
            return
        if completed_signature != self._current_geometry_signature:
            LOGGER.info(
                "Discarding OCR result from stale Discord geometry %s (current=%s)",
                completed_signature,
                self._current_geometry_signature,
            )
            self._force_next_frame = True
            return
        if isinstance(completed, _FrameResult):
            result = completed.chat
            channel_result = completed.channels
        else:
            # Keep the helper tolerant of already-completed test futures and
            # older queued work during a source-reload development run.
            result = completed
            channel_result = None
        if result is not None:
            LOGGER.info(
                "OCR frame %d completed in %.2fs (messages=%d, cache=%d, translated=%d)",
                self._future_sequence,
                time.monotonic() - self._future_started_at,
                len(result.messages),
                result.used_cache,
                result.translated,
            )
            self.overlay.set_messages(
                result.messages,
                self.current_style,
                font_scale=self.config.font_scale,
                show_original=self.config.show_original,
            )
        if channel_result is not None:
            LOGGER.info(
                "Channel OCR completed (sidebar=%d, header=%d, cache=%d, translated=%d)",
                len(channel_result.sidebar_messages),
                len(channel_result.header_messages),
                channel_result.used_cache,
                channel_result.translated,
            )
            self._channel_result = channel_result
            self._apply_channel_result(channel_result)
        self._show_available_overlays()
        if result is not None and result.messages:
            debug_snapshot = os.getenv("DISCORD_TRANSLATE_DEBUG_SNAPSHOT")
            if debug_snapshot:
                QTimer.singleShot(250, lambda: self.overlay.grab().save(debug_snapshot))

    def _report_error(self, message: str) -> None:
        if message == self.last_error:
            return
        self.last_error = message
        LOGGER.error(message)
        self.tray.showMessage(
            f"{PRODUCT_NAME} 오류", message, QSystemTrayIcon.MessageIcon.Warning, 5000
        )

    def _probe_channel_frame(self, client: Rect) -> None:
        now = time.monotonic()
        if self._pending_channel_frame is not None or now - self._last_channel_probe < 2.0:
            return
        try:
            frame = self.capture.capture(client)
        except Exception as exc:
            self._report_error(f"채널 목록 캡처 실패: {exc}")
            return
        if frame is not None and frame.size:
            self._pending_channel_frame = frame
            self._last_channel_probe = now

    def _resolve_chat_region(self, client: Rect, hwnd: int) -> Rect:
        if not self.config.chat_region.auto:
            return _chat_region(client, self.config)
        key = (hwnd, client.width, client.height)
        now = time.monotonic()
        should_probe = (
            key != self._auto_region_key
            or self._auto_region is None
            or now - self._last_region_probe >= 2.0
        )
        if should_probe:
            self._last_region_probe = now
            frame = self.capture.capture(client)
            if frame is None:
                return _chat_region(client, self.config)
            self._pending_channel_frame = frame
            self._last_channel_probe = now
            detected = detect_chat_region(frame)
            changed = self._auto_region is None or _rect_distance(self._auto_region, detected) > 8
            self._auto_region = detected
            if changed:
                local = self._auto_region
                self._pending_frame = frame[
                    local.top : local.bottom, local.left : local.right
                ].copy()
                self._force_next_frame = True
            self._auto_region_key = key
        return self._auto_region.translated(client.left, client.top)

    def _position_channel_overlays(self) -> None:
        if self._channel_result is None or self.current_client_rect is None:
            return
        origin = self.current_client_rect
        regions = self._channel_result.regions
        if regions.sidebar.area:
            self.channel_sidebar_overlay.set_target_rect(
                regions.sidebar.translated(origin.left, origin.top), self.current_dpi
            )
        if regions.header.area:
            self.channel_header_overlay.set_target_rect(
                regions.header.translated(origin.left, origin.top), self.current_dpi
            )

    def _apply_channel_result(self, result: ChannelNameResult) -> None:
        self._position_channel_overlays()
        sidebar_style = _configured_style(result.sidebar_style, self.config)
        header_style = _configured_style(result.header_style, self.config)
        self.channel_sidebar_overlay.set_messages(
            result.sidebar_messages,
            sidebar_style,
            font_scale=self.config.font_scale,
            show_original=self.config.show_original,
        )
        self.channel_header_overlay.set_messages(
            result.header_messages,
            header_style,
            font_scale=self.config.font_scale,
            show_original=self.config.show_original,
        )

    def _hide_overlays(self) -> None:
        self.overlay.hide()
        for name in ("channel_sidebar_overlay", "channel_header_overlay"):
            overlay = getattr(self, name, None)
            if overlay is not None:
                overlay.hide()

    def _show_available_overlays(self) -> None:
        if not self.config.enabled or self._manual_hidden:
            return
        if self.overlay.has_visible_text:
            self.overlay.show()
        if self.channel_sidebar_overlay.has_visible_text:
            self.channel_sidebar_overlay.show()
        if self.channel_header_overlay.has_visible_text:
            self.channel_header_overlay.show()

    def _tray_menu(self) -> QMenu:
        menu = QMenu()
        configure_tray_menu(menu, self.config.ui_theme)
        menu.addAction(f"{PRODUCT_NAME} 열기", self.show_settings)
        menu.addSeparator()
        self.enabled_action = QAction("번역 켜기", menu)
        self.enabled_action.setIcon(translation_status_icon(enabled=self.config.enabled))
        self.enabled_action.triggered.connect(
            lambda _checked=False: self.set_enabled(not self.config.enabled)
        )
        menu.addAction(self.enabled_action)

        language_menu = menu.addMenu("표시 언어")
        language_group = QActionGroup(language_menu)
        language_group.setExclusive(True)
        for label, language in (
            ("한국어", Language.KOREAN),
            ("日本語", Language.JAPANESE),
            ("English", Language.ENGLISH),
            ("简体中文", Language.CHINESE_SIMPLIFIED),
            ("繁體中文", Language.CHINESE_TRADITIONAL),
        ):
            action = QAction(label, language_menu, checkable=True)
            action.setChecked(language == self.config.target_language)
            action.triggered.connect(lambda checked=False, value=language: self.set_language(value))
            language_group.addAction(action)
            language_menu.addAction(action)

        menu.addAction("원문/번역 전환", self.toggle_original)
        menu.addSeparator()
        self.restart_update_action = QAction("재시작하여 업데이트", menu)
        self.restart_update_action.setVisible(False)
        self.restart_update_action.triggered.connect(self._install_update)
        menu.addAction(self.restart_update_action)
        menu.addAction("설정", self.show_settings)
        menu.addAction("종료", self.close)
        return menu

    def _tray_activated(self, reason) -> None:
        if reason in (
            QSystemTrayIcon.ActivationReason.Trigger,
            QSystemTrayIcon.ActivationReason.DoubleClick,
        ):
            QTimer.singleShot(0, self.show_settings)

    def set_enabled(self, enabled: bool) -> None:
        self.config.enabled = enabled
        self.enabled_action.setIcon(translation_status_icon(enabled=enabled))
        self.tray.setIcon(app_icon(enabled=enabled))
        if not enabled:
            self._hide_overlays()
        else:
            self._show_available_overlays()
        if self.config.keep_local_model_warm:
            self._start_local_model_warmup()
        elif not enabled:
            self._release_local_model_when_idle()
        self._save()

    def _start_local_model_warmup(self) -> None:
        if (
            not self.config.translator.startswith("hymt_")
            or not self.config.keep_local_model_warm
            or getattr(self, "_closing", False)
        ):
            return
        translator = self.translator
        prepare = getattr(translator, "prepare", None)
        if not callable(prepare) or getattr(self, "_local_warmup_translator", None) is translator:
            return
        self._local_warmup_translator = translator

        def warm_in_background() -> None:
            try:
                if (
                    translator is self.translator
                    and self.config.keep_local_model_warm
                    and not getattr(self, "_closing", False)
                ):
                    prepare()
                    LOGGER.info("로컬 번역 모델 예열 완료")
            except Exception:
                LOGGER.exception("로컬 번역 모델 예열 실패")
            finally:
                if getattr(self, "_local_warmup_translator", None) is translator:
                    self._local_warmup_translator = None

        threading.Thread(
            target=warm_in_background,
            name="warm-local-translator",
            daemon=True,
        ).start()

    def _release_local_model_when_idle(self) -> None:
        if (
            self.config.enabled
            or self.config.keep_local_model_warm
            or not self.config.translator.startswith("hymt_")
            or getattr(self, "_closing", False)
        ):
            return
        if self.future is not None:
            QTimer.singleShot(100, self._release_local_model_when_idle)
            return
        self.translator.close()
        LOGGER.info("로컬 번역 모델 해제: VRAM 반환 요청 완료")

    def toggle_enabled(self) -> None:
        self.set_enabled(not self.config.enabled)

    def toggle_hidden(self) -> None:
        self._manual_hidden = not self._manual_hidden
        if self._manual_hidden:
            self._hide_overlays()
        else:
            self._show_available_overlays()

    def toggle_original(self) -> None:
        self.config.show_original = not self.config.show_original
        self.overlay.set_messages(
            self.pipeline.messages,
            self.current_style,
            font_scale=self.config.font_scale,
            show_original=self.config.show_original,
        )
        if self._channel_result is not None:
            self._apply_channel_result(self._channel_result)
        self._show_available_overlays()
        self._save()

    def set_language(self, language: Language) -> None:
        if language == self.config.target_language:
            return
        self.config.target_language = language
        self.pipeline.set_target(language)
        self.channel_processor.set_target(language)
        self._channel_result = None
        self._pending_channel_frame = None
        self._last_channel_probe = 0.0
        self._force_next_frame = True
        self._hide_overlays()
        self._save()

    def copy_current(self) -> None:
        messages = self.pipeline.messages
        if not messages:
            return
        selected = messages[-1]
        if self.current_region is not None:
            cursor = QCursor.pos()
            local_y = cursor.y() - self.current_region.top
            selected = min(
                messages, key=lambda item: abs((item.bbox.top + item.bbox.bottom) // 2 - local_y)
            )
        self.app.clipboard().setText(selected.translated_text or selected.source_text)
        self.tray.showMessage(
            "복사 완료", "현재 메시지의 번역문을 클립보드에 복사했어.", msecs=1500
        )

    def select_region(self) -> None:
        window = DiscordWindowLocator.find()
        if window is None:
            self.tray.showMessage("Discord를 찾지 못했어", "Discord 창을 열고 다시 시도해줘.")
            return
        self._hide_overlays()
        selector = RegionSelector(window.client_rect, window.dpi)
        selector.selected.connect(
            lambda rect: self._apply_selected_region(rect, window.client_rect)
        )
        selector.destroyed.connect(lambda: setattr(self, "_region_selector", None))
        self._region_selector = selector
        selector.show()

    def use_auto_region(self) -> None:
        self.config.chat_region.auto = True
        self._auto_region = None
        self._auto_region_key = None
        self._pending_frame = None
        self._pending_channel_frame = None
        self._last_channel_probe = 0.0
        self.pipeline.change_detector.reset()
        self._hide_overlays()
        self._save()
        self.tray.showMessage(
            "OCR 영역 자동 감지",
            "Discord 채팅 본문 전체를 다시 찾도록 초기화했어.",
            msecs=2000,
        )

    def _apply_selected_region(self, local: Rect, client: Rect) -> None:
        self.config.chat_region.auto = False
        self.config.chat_region.left_ratio = local.left / client.width
        self.config.chat_region.top_ratio = local.top / client.height
        self.config.chat_region.right_ratio = local.right / client.width
        self.config.chat_region.bottom_ratio = local.bottom / client.height
        self.pipeline.change_detector.reset()
        self._save()

    def show_settings(self) -> None:
        existing = getattr(self, "_settings_dialog", None)
        if existing is not None:
            bring_dialog_to_front(existing)
            return
        previous_hotkeys = copy.deepcopy(self.config.hotkeys)
        dialog = SettingsDialog(self.config)
        self._settings_dialog = dialog
        dialog.finished.connect(
            lambda result, current=dialog, hotkeys=previous_hotkeys: (
                self._finish_settings_dialog(current, result, hotkeys)
            )
        )
        bring_dialog_to_front(dialog)

    def _finish_settings_dialog(
        self,
        dialog: SettingsDialog,
        result: int,
        previous_hotkeys: object,
    ) -> None:
        if self._settings_dialog is dialog:
            self._settings_dialog = None
        try:
            if result != QDialog.DialogCode.Accepted:
                return
            self._apply_settings_dialog(dialog, previous_hotkeys)
        finally:
            dialog.deleteLater()

    def _apply_settings_dialog(
        self,
        dialog: SettingsDialog,
        previous_hotkeys: object,
    ) -> None:
        old_translator = self.config.translator
        old_hymt_device = self.config.hymt_device
        old_speech_style = self.config.speech_style
        dialog.apply()
        if not self._bind_hotkeys():
            self.config.hotkeys = previous_hotkeys
            self._bind_hotkeys()
            QMessageBox.warning(
                None,
                "단축키를 사용할 수 없어",
                "선택한 단축키 중 하나를 다른 프로그램이 사용 중이야. "
                "기존 설정을 유지할게.",
            )
        hymt_device = self.config.hymt_device
        style_aware = self.config.translator.startswith("hymt_") or (
            self.config.translator in {"chatgpt", "claude", "gemini"}
        )
        if old_translator != self.config.translator or (
            (
                self.config.translator.startswith("hymt_")
                and old_hymt_device != hymt_device
            )
            or (style_aware and old_speech_style != self.config.speech_style)
        ):
            previous = self.translator
            self.translator = self._make_translator(self.config.translator)
            self.pipeline.translator = self.translator
            self.channel_processor.translator = self.translator
            if self.future is None:
                previous.close()
            self._notify_translator()
        self.pipeline.set_target(self.config.target_language)
        self.channel_processor.set_target(self.config.target_language)
        self.timer.setInterval(max(50, round(1000 / self.config.capture_fps)))
        if self._channel_result is not None:
            self._apply_channel_result(self._channel_result)
        self.tray.contextMenu().setStyleSheet(menu_stylesheet(self.config.ui_theme))
        self.set_enabled(self.config.enabled)
        self._save()

    def toggle_settings(self) -> None:
        existing = getattr(self, "_settings_dialog", None)
        if (
            existing is not None
            and existing.isVisible()
            and not existing.isMinimized()
        ):
            existing.hide()
            return
        self.show_settings()

    def _bind_hotkeys(self) -> bool:
        self.hotkeys.clear()
        bindings = (
            (self.config.hotkeys.toggle_translation, self.toggle_enabled),
            (self.config.hotkeys.toggle_original, self.toggle_original),
            (self.config.hotkeys.hide_overlay, self.toggle_hidden),
            (self.config.hotkeys.copy_current, self.copy_current),
        )
        for shortcut, callback in bindings:
            if not self.hotkeys.register(shortcut, callback):
                self.hotkeys.clear()
                return False
        return True

    def _notify_update(self, title: str, message: str) -> None:
        self.tray.showMessage(title, message, QSystemTrayIcon.MessageIcon.Information, 5000)

    def _update_ready(self, _staged: object) -> None:
        self.restart_update_action.setVisible(True)
        self._notify_update(
            "업데이트 준비 완료", "트레이 메뉴에서 재시작하여 업데이트를 눌러줘."
        )

    def _install_update(self) -> None:
        if self.updater.install_and_restart():
            self.close()

    def _save(self) -> None:
        save_config(self.config)

    def close(self) -> None:
        if self._closing:
            return
        self._closing = True
        self.timer.stop()
        self.hotkey_timer.stop()
        self.updater.close()
        self._hide_overlays()
        self.hotkeys.close()
        self.capture.close()
        self.executor.shutdown(wait=False, cancel_futures=True)
        self.translator.close()
        self.cache.close()
        self.tray.hide()
        self.app.quit()


def _chat_region(client: Rect, config: AppConfig) -> Rect:
    region = config.chat_region
    return Rect(
        client.left + round(client.width * region.left_ratio),
        client.top + round(client.height * region.top_ratio),
        client.left + round(client.width * region.right_ratio),
        client.top + round(client.height * region.bottom_ratio),
    )


def _rect_distance(first: Rect, second: Rect) -> int:
    return max(
        abs(first.left - second.left),
        abs(first.top - second.top),
        abs(first.right - second.right),
        abs(first.bottom - second.bottom),
    )


def _frame_geometry_signature(hwnd: int, region: Rect, dpi: int) -> tuple[int, int, int, int]:
    """Identify coordinate systems while allowing no-cost screen movement."""
    return hwnd, region.width, region.height, dpi


def _parse_hex_color(value: str) -> tuple[int, int, int] | None:
    normalized = value.strip().removeprefix("#")
    if not normalized:
        return None
    if len(normalized) != 6:
        return None
    try:
        return tuple(int(normalized[index : index + 2], 16) for index in (0, 2, 4))
    except ValueError:
        return None


def _configured_style(detected: OverlayStyle, config: AppConfig) -> OverlayStyle:
    return OverlayStyle(
        _parse_hex_color(config.background_color) or detected.background_rgb,
        _parse_hex_color(config.text_color) or detected.foreground_rgb,
        config.overlay_opacity,
    )


def _set_per_monitor_dpi_awareness() -> None:
    try:
        ctypes.windll.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
    except Exception:
        pass


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=f"{PRODUCT_NAME} for Discord")
    parser.add_argument("--config", type=Path, help="설정 JSON 경로")
    parser.add_argument("--log-level", default="INFO")
    parser.add_argument("--log-file", type=Path, help="실행 로그 경로")
    return parser


def _configure_logging(level: str, requested_path: Path | None) -> Path:
    log_path = requested_path
    if log_path is None:
        base = Path(os.getenv("LOCALAPPDATA", Path.home())) / "NudeTranslator"
        log_path = base / "overlay.log"
    log_path = log_path.expanduser().resolve()
    log_path.parent.mkdir(parents=True, exist_ok=True)
    handlers: list[logging.Handler] = [
        logging.FileHandler(log_path, encoding="utf-8"),
    ]
    if sys.stderr is not None:
        handlers.append(logging.StreamHandler())
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=handlers,
        force=True,
    )
    return log_path


def main() -> int:
    args = build_parser().parse_args()
    load_local_env()
    _configure_logging(args.log_level, args.log_file)
    if args.config:
        os.environ["DISCORD_TRANSLATE_CONFIG"] = str(args.config.resolve())
    _set_per_monitor_dpi_awareness()
    app = QApplication(sys.argv)
    app.setApplicationName(PRODUCT_NAME)
    app.setApplicationDisplayName(PRODUCT_NAME)
    app.setWindowIcon(app_icon())
    app.setQuitOnLastWindowClosed(False)
    try:
        controller = OverlayController(app, load_config(args.config))
    except Exception as exc:
        LOGGER.exception("시작 실패")
        QMessageBox.critical(None, f"{PRODUCT_NAME} 시작 실패", str(exc))
        return 1
    app.aboutToQuit.connect(controller.close)
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())
