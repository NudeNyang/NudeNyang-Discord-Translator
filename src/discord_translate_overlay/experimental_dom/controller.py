from __future__ import annotations

import atexit
import base64
import copy
import json
import logging
import queue
import re
import signal
import sys
import threading
import time
from dataclasses import dataclass, fields
from hashlib import sha256
from pathlib import Path
from typing import Any

from platformdirs import user_log_dir

from ..branding import PRODUCT_NAME
from ..cache import TranslationCache
from ..config import AppConfig, load_config, save_config
from ..env import load_local_env
from ..language import LanguageDetector
from ..models import Language
from ..ocr.paddle_dual import PaddleDualOcr
from ..platforms import create_discord_debug_launcher
from ..translation.base import Translator
from ..translation.deepl import DeepLTranslator
from ..translation.hymt import HyMtTranslator
from ..translation.mock import MockTranslator, OriginalTranslator
from ..translation.protected_text import protect_text
from ..translation.subscription_cli import SubscriptionCliTranslator
from ..ui.discord_restart_prompt import (
    ask_auto_restart_consent,
    ask_restart_countdown,
)
from ..ui.hotkeys import GlobalHotkeys
from ..ui.settings_dialog import SettingsDialog, bring_dialog_to_front
from ..ui.update_coordinator import UpdateCoordinator
from ..ui.visuals import (
    app_icon,
    configure_tray_menu,
    menu_stylesheet,
    translation_status_icon,
)
from .cdp import CdpClient, discord_target
from .image_translation import (
    IMAGE_UI_SCRIPT,
    ImageTranslationProcessor,
    apply_image_error_script,
    apply_image_result_script,
    fetch_image_data_script,
    image_capture_info_script,
    restore_images_script,
)

LOGGER = logging.getLogger("discord_dom_translate")
TRANSLATOR_LABELS = {
    "hymt_1_8b": "Hy-MT2 1.8B Q4 (경량·기본)",
    "hymt_7b": "Hy-MT2 7B Q4 (품질·약 4.6GB)",
    "chatgpt": "ChatGPT 플랜 (Codex CLI)",
    "claude": "Claude 플랜 (Claude Code)",
    "gemini": "Gemini 플랜 (Antigravity CLI)",
    "deepl": "DeepL API",
    "mock": "Mock 테스트",
    "original": "원문 표시",
}
TRANSLATION_BATCH_DEBOUNCE_SECONDS = 0.12
TRANSLATION_BATCH_MAX_ITEMS = 32
MIN_CAPTURE_FPS = 2
MAX_CAPTURE_FPS = 20
SPEECH_STYLE_LABELS = {
    "auto": "원문 말투 유지 (자동)",
    "polite": "항상 존댓말·격식체",
    "casual": "항상 반말·비격식체",
}
JAPANESE_FRAGMENT_RE = re.compile(
    r"[A-Za-z0-9]*"
    r"[\u3040-\u30ff\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff]"
    r"[\u3040-\u30ff\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff"
    r"A-Za-z0-9（）()「」『』【】・ー〜～._-]*"
)


SNAPSHOT_SCRIPT = r"""
(() => {
  function isVisible(node) {
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight;
  }
  function eligibleTextNodes(root) {
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.nodeValue || !node.nodeValue.trim()) continue;
      const parent = node.parentElement;
      if (!parent) continue;
      const protectedParent = parent.closest(
        'a,button,[role="button"],code,pre,[contenteditable="true"],textarea,input'
      );
      if (protectedParent && root.contains(protectedParent)) continue;
      const hiddenParent = parent.closest('[class*="hiddenVisually"],[aria-hidden="true"]');
      if (hiddenParent && hiddenParent !== root) continue;
      nodes.push(node);
    }
    return nodes;
  }
  function ensureRootId(root, attribute, prefix) {
    let id = root.getAttribute(attribute);
    if (!id || !id.startsWith(`dto-${prefix}-`)) {
      window.__dtoRootSequence = (window.__dtoRootSequence || 0) + 1;
      id = `dto-${prefix}-${window.__dtoRootSequence}`;
      root.setAttribute(attribute, id);
    }
    return id;
  }
  function channelVisual(root) {
    return root.querySelector(
      'div[aria-hidden="true"] > span,' +
      '[class*="name__"][aria-hidden="true"] > div'
    );
  }
  function parts(kind, id, root) {
    return eligibleTextNodes(root).map((node, index) => ({
      kind, id, index, text: node.nodeValue,
    }));
  }

  const out = [];
  for (const root of document.querySelectorAll('[id^="message-content-"]')) {
    if (root.closest('[id^="message-reply-context-"]')) continue;
    if (!isVisible(root)) continue;
    const id = ensureRootId(root, 'data-dto-message-id', 'message');
    out.push(...parts('message', id, root));
  }

  for (const context of document.querySelectorAll('[id^="message-reply-context-"]')) {
    if (!isVisible(context)) continue;
    const root = context.querySelector('[class*="repliedTextPreview"] [id^="message-content-"]');
    if (!root) continue;
    const id = ensureRootId(root, 'data-dto-reply-id', 'reply');
    out.push(...parts('reply', id, root));
  }

  const embedSelector = [
    '[class*="embedTitle_"]', '[class*="embedDescription_"]',
    '[class*="embedFieldName_"]', '[class*="embedFieldValue_"]'
  ].join(',');
  for (const root of document.querySelectorAll(embedSelector)) {
    if (!isVisible(root)) continue;
    const id = ensureRootId(root, 'data-dto-root-id', 'embed');
    out.push(...parts('embed', id, root));
  }

  for (const channel of document.querySelectorAll('[data-list-item-id^="channels___"]')) {
    if (!isVisible(channel)) continue;
    const visual = channelVisual(channel);
    const itemId = channel.getAttribute('data-list-item-id');
    if (visual && itemId && visual.textContent?.trim()) {
      out.push({kind: 'channel', id: itemId, index: 0, text: visual.textContent});
    }
  }

  for (const category of document.querySelectorAll(
    '[data-list-item-id^="channels___"][role="button"][aria-label$="(카테고리)"]'
  )) {
    if (!isVisible(category)) continue;
    const visual = category.querySelector('h3 > div');
    const itemId = category.getAttribute('data-list-item-id');
    if (visual && itemId && visual.textContent?.trim()) {
      out.push({kind: 'category', id: itemId, index: 0, text: visual.textContent});
    }
  }

  for (const root of document.querySelectorAll('[class*="postTitleText"]')) {
    if (!isVisible(root)) continue;
    const id = ensureRootId(root, 'data-dto-forum-title-id', 'forum-title');
    out.push(...parts('forum-title', id, root));
  }

  const headingSelector = [
    'h1[class*="title__"]',
    'h2[class*="title__"]',
    'h3[aria-hidden="true"][data-text-variant^="heading-"]'
  ].join(',');
  for (const root of document.querySelectorAll(headingSelector)) {
    if (!isVisible(root)) continue;
    const id = ensureRootId(root, 'data-dto-heading-id', 'heading');
    out.push(...parts('heading', id, root));
  }

  const contextSelector = [
    '[class*="guildDropdown_"] h2',
    '[class*="topic_"][class*="expandable_"]',
    'div[id^="chat-messages-"][class*="container_"] > div[class*="description_"]',
    '[role="dialog"] [class*="headerSubtitle_"]',
    '[role="dialog"] main[class*="bodyInner_"] [class*="markup_"]'
  ].join(',');
  for (const root of document.querySelectorAll(contextSelector)) {
    if (!isVisible(root)) continue;
    const id = ensureRootId(root, 'data-dto-context-id', 'context');
    out.push(...parts('context', id, root));
  }
  return {url: location.href, title: document.title, parts: out};
})()
"""


def apply_script(changes: list[dict[str, Any]]) -> str:
    encoded = json.dumps(changes, ensure_ascii=False)
    return rf"""
(() => {{
  const changes = {encoded};
  function eligibleTextNodes(root) {{
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {{
      const node = walker.currentNode;
      if (!node.nodeValue || !node.nodeValue.trim()) continue;
      const parent = node.parentElement;
      if (!parent) continue;
      const protectedParent = parent.closest(
        'a,button,[role="button"],code,pre,[contenteditable="true"],textarea,input'
      );
      if (protectedParent && root.contains(protectedParent)) continue;
      const hiddenParent = parent.closest('[class*="hiddenVisually"],[aria-hidden="true"]');
      if (hiddenParent && hiddenParent !== root) continue;
      nodes.push(node);
    }}
    return nodes;
  }}
  let applied = 0;
  for (const change of changes) {{
    let root = null;
    if (change.kind === 'message') root = document.querySelector(
      `[data-dto-message-id="${{CSS.escape(change.id)}}"]`
    );
    else if (change.kind === 'reply') root = document.querySelector(
      `[data-dto-reply-id="${{CSS.escape(change.id)}}"]`
    );
    else if (change.kind === 'embed') root = document.querySelector(
      `[data-dto-root-id="${{CSS.escape(change.id)}}"]`
    );
    else if (change.kind === 'forum-title') root = document.querySelector(
      `[data-dto-forum-title-id="${{CSS.escape(change.id)}}"]`
    );
    else if (change.kind === 'heading') root = document.querySelector(
      `[data-dto-heading-id="${{CSS.escape(change.id)}}"]`
    );
    else if (change.kind === 'context') root = document.querySelector(
      `[data-dto-context-id="${{CSS.escape(change.id)}}"]`
    );
    else if (change.kind === 'channel') {{
      const channel = document.querySelector(
        `[data-list-item-id="${{CSS.escape(change.id)}}"]`
      );
      root = channel?.querySelector(
        'div[aria-hidden="true"] > span,' +
        '[class*="name__"][aria-hidden="true"] > div'
      ) || null;
      if (root) {{ root.textContent = change.text; applied++; continue; }}
    }}
    else if (change.kind === 'category') {{
      const category = document.querySelector(
        `[data-list-item-id="${{CSS.escape(change.id)}}"][role="button"]`
      );
      root = category?.querySelector('h3 > div') || null;
      if (root) {{ root.textContent = change.text; applied++; continue; }}
    }}
    if (!root) continue;
    const nodes = eligibleTextNodes(root);
    const node = nodes[change.index];
    if (!node) continue;
    node.nodeValue = change.text;
    applied++;
  }}
  return {{applied}};
}})()
"""


@dataclass(frozen=True, slots=True)
class DomPart:
    kind: str
    item_id: str
    index: int
    text: str

    @property
    def locator(self) -> tuple[str, str, int]:
        return self.kind, self.item_id, self.index


@dataclass(slots=True)
class PartState:
    original: str
    translated: str


@dataclass(frozen=True, slots=True)
class TranslationJob:
    part: DomPart
    target: Language
    generation: int


@dataclass(frozen=True, slots=True)
class TranslationResult:
    part: DomPart
    target: Language
    generation: int
    translated: str
    error: str = ""


@dataclass(frozen=True, slots=True)
class ImageTranslationJob:
    image_id: str
    source_key: str
    png_bytes: bytes
    target: Language
    generation: int
    translator_namespace: str


@dataclass(frozen=True, slots=True)
class ImageTranslationResult:
    image_id: str
    source_key: str
    target: Language
    generation: int
    png_bytes: bytes = b""
    translated_count: int = 0
    used_cache: bool = False
    error: str = ""


class TranslationService:
    def __init__(
        self,
        translator: Translator,
        cache: TranslationCache,
        detector: LanguageDetector | None = None,
    ) -> None:
        self.translator = translator
        self.cache = cache
        self.detector = detector or LanguageDetector()
        self.namespace = getattr(translator, "cache_namespace", translator.__class__.__name__)

    def translate(self, text: str, target: Language) -> str:
        protected = protect_text(text)
        if not protected.has_translatable_text:
            return text
        source = self.detector.detect(text)
        if source is target:
            return self._translate_japanese_fragments(text, target)
        if source is Language.UNKNOWN:
            return text
        return self._translate_known_source(text, protected, source, target)

    def translate_many(self, texts: list[str], target: Language) -> list[str]:
        if not texts:
            return []
        results: list[str | None] = [None] * len(texts)
        pending: list[tuple[int, str, Any, Language, str]] = []
        for index, text in enumerate(texts):
            protected = protect_text(text)
            if not protected.has_translatable_text:
                results[index] = text
                continue
            source = self.detector.detect(text)
            if source is target:
                results[index] = self._translate_japanese_fragments(text, target)
                continue
            if source is Language.UNKNOWN:
                results[index] = text
                continue
            source_hash = sha256(text.encode("utf-8")).hexdigest()
            cached = self.cache.get_message(
                source_hash,
                text,
                source,
                target,
                self.namespace,
                allow_fuzzy=False,
            )
            if cached is not None:
                results[index] = cached
                continue
            pending.append((index, text, protected, source, source_hash))

        if pending:
            translated_items = self.translator.translate_many(
                [(protected.masked, source) for _, _, protected, source, _ in pending],
                target,
            )
            if len(translated_items) != len(pending):
                raise RuntimeError("번역 엔진이 요청한 메시지 수와 다른 결과를 반환했어.")
            for item, translated in zip(pending, translated_items, strict=True):
                index, text, protected, source, source_hash = item
                restored = protected.restore(translated)
                self.cache.put(
                    source_hash,
                    text,
                    source,
                    target,
                    restored,
                    self.namespace,
                )
                results[index] = restored

        if any(result is None for result in results):
            raise RuntimeError("번역 엔진이 일부 메시지의 결과를 반환하지 않았어.")
        return [str(result) for result in results]

    def _translate_japanese_fragments(self, text: str, target: Language) -> str:
        if target is not Language.KOREAN:
            return text
        translated_parts: list[str] = []
        cursor = 0
        changed = False
        for match in JAPANESE_FRAGMENT_RE.finditer(text):
            fragment = match.group()
            if (
                self.detector.detect(fragment, remember=False)
                is not Language.JAPANESE
            ):
                continue
            translated_parts.append(text[cursor : match.start()])
            translated = self._translate_known_source(
                fragment,
                protect_text(fragment),
                Language.JAPANESE,
                target,
            )
            translated_parts.append(translated)
            cursor = match.end()
            changed = changed or translated != fragment
        if not changed:
            return text
        translated_parts.append(text[cursor:])
        return "".join(translated_parts)

    def _translate_known_source(
        self,
        text: str,
        protected: Any,
        source: Language,
        target: Language,
    ) -> str:
        source_hash = sha256(text.encode("utf-8")).hexdigest()
        cached = self.cache.get_message(
            source_hash,
            text,
            source,
            target,
            self.namespace,
            allow_fuzzy=False,
        )
        if cached is not None:
            return cached
        translated = self.translator.translate(protected.masked, source, target)
        restored = protected.restore(translated)
        self.cache.put(source_hash, text, source, target, restored, self.namespace)
        return restored


class DomTranslationController:
    def __init__(self, config: AppConfig) -> None:
        self.config = config
        self.enabled = config.enabled
        self.client: CdpClient | None = None
        self.cache = TranslationCache()
        desired_name = config.translator
        desired_translator = make_translator(config)
        startup_preparation: tuple[str, Translator] | None = None
        should_prepare_local = config.enabled or config.keep_local_model_warm
        if _translator_needs_download(desired_translator) and should_prepare_local:
            fallback_name, fallback = _startup_fallback(config, desired_name)
            self.translator = fallback
            self.active_translator_name = fallback_name
            startup_preparation = (desired_name, desired_translator)
        else:
            self.translator = desired_translator
            self.active_translator_name = desired_name
        self.service = TranslationService(self.translator, self.cache)
        self.service_lock = threading.RLock()
        self.preparation_generation = 0
        self.translation_generation = 0
        self.states: dict[tuple[str, str, int], PartState] = {}
        self.pending: set[tuple[int, str, str, int, str]] = set()
        self.jobs: queue.Queue[TranslationJob | None] = queue.Queue()
        self.results: queue.Queue[TranslationResult] = queue.Queue()
        self.image_processor = ImageTranslationProcessor(
            lambda: PaddleDualOcr(
                device=self.config.ocr_device,
                enhance_colored_text=True,
            )
        )
        self.image_pending: set[tuple[int, str]] = set()
        self.image_jobs: queue.Queue[ImageTranslationJob | None] = queue.Queue()
        self.image_results: queue.Queue[ImageTranslationResult] = queue.Queue()
        self.controls: queue.Queue[tuple[str, object | None]] = queue.Queue()
        self.control_event = threading.Event()
        self.notices: queue.Queue[str] = queue.Queue()
        self.connection_issues: queue.Queue[str] = queue.Queue()
        self.stop_event = threading.Event()
        self._consecutive_connection_failures = 0
        self._connection_issue_reported = False
        self._local_warmup_translator: Translator | None = None
        self.preparing_translator_name: str | None = None
        self.translator_error = ""
        self.worker = threading.Thread(target=self._worker, name="dom-translator", daemon=True)
        self.worker.start()
        self.image_worker = threading.Thread(
            target=self._image_worker,
            name="dom-image-translator",
            daemon=True,
        )
        self.image_worker.start()
        self.toggle_requested = threading.Event()
        self._restored = False
        atexit.register(self.restore)
        if startup_preparation is not None:
            self._start_translator_preparation(*startup_preparation)
        elif self.config.keep_local_model_warm:
            self._start_active_local_warmup()

    def connect(self) -> None:
        if self.client is not None:
            return
        target = discord_target()
        self.client = CdpClient(target.websocket_url)
        self.client.connect()
        LOGGER.info("Discord DOM 연결: %s (%s)", target.title, target.url)

    def close(self) -> None:
        self.restore(discard_images=True)
        self.stop_event.set()
        self.jobs.put(None)
        self.image_jobs.put(None)
        self.worker.join(timeout=3.0)
        self.image_worker.join(timeout=5.0)
        if self.client is not None:
            self.client.close()
        close = getattr(self.translator, "close", None)
        if callable(close):
            close()
        self.cache.close()

    def run(self) -> None:
        LOGGER.info("DOM 번역 시작. %s로 켜기/끄기", self.config.hotkeys.toggle_translation)
        while not self.stop_event.is_set():
            self.control_event.clear()
            started = time.monotonic()
            self._consume_controls()
            self._consume_hotkey()
            had_client = self.client is not None
            retry_delay: float | None = None
            try:
                self.connect()
                self._mark_connection_ready()
                self._drain_results()
                self._drain_image_results()
                if self.enabled:
                    self._scan()
                    self._scan_images()
            except Exception as exc:
                LOGGER.exception("DOM 처리 중 오류")
                if not had_client:
                    self._record_connection_failure(exc)
                if self.client is not None:
                    self.client.close()
                    self.client = None
                retry_delay = 1.0
            elapsed = time.monotonic() - started
            interval = retry_delay or _poll_interval_seconds(self.config.capture_fps)
            self.control_event.wait(max(0.0, interval - elapsed))

    def stop(self, *_: object) -> None:
        self.stop_event.set()
        self.control_event.set()

    def request_toggle(self) -> None:
        self.toggle_requested.set()

    def request_enabled(self, enabled: bool) -> None:
        self._queue_control("enabled", enabled)

    def request_target(self, language: Language) -> None:
        self._queue_control("target", language)

    def request_translator(self, name: str) -> None:
        self._queue_control("translator", name)

    def request_speech_style(self, style: str) -> None:
        self._queue_control("speech_style", style)

    def request_config(self, config: AppConfig) -> None:
        self._queue_control("config", copy.deepcopy(config))

    def _queue_control(self, command: str, value: object) -> None:
        self.controls.put((command, value))
        self.control_event.set()

    def _scan(self) -> None:
        assert self.client is not None
        payload = self.client.evaluate(SNAPSHOT_SCRIPT) or {}
        changes: list[dict[str, Any]] = []
        for raw in payload.get("parts", []):
            part = DomPart(
                kind=str(raw["kind"]),
                item_id=str(raw["id"]),
                index=int(raw["index"]),
                text=str(raw["text"]),
            )
            state = self.states.get(part.locator)
            if state is not None:
                if part.text == state.translated:
                    continue
                if part.text == state.original:
                    changes.append(_change(part, state.translated))
                    continue
            pending_key = (self.translation_generation, *part.locator, part.text)
            if pending_key in self.pending:
                continue
            self.pending.add(pending_key)
            self.jobs.put(
                TranslationJob(part, self.config.target_language, self.translation_generation)
            )
        if changes:
            self.client.evaluate(apply_script(changes))

    def _worker(self) -> None:
        while not self.stop_event.is_set():
            first_job = self.jobs.get()
            if first_job is None:
                return
            jobs = [first_job]
            stop_after_batch = False
            deadline = time.monotonic() + TRANSLATION_BATCH_DEBOUNCE_SECONDS
            while len(jobs) < TRANSLATION_BATCH_MAX_ITEMS:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                try:
                    queued = self.jobs.get(timeout=remaining)
                except queue.Empty:
                    break
                if queued is None:
                    stop_after_batch = True
                    break
                jobs.append(queued)
            active_jobs = [
                job for job in jobs if job.generation == self.translation_generation
            ]
            if not active_jobs:
                if stop_after_batch:
                    return
                continue
            try:
                translated_items: list[str] = []
                with self.service_lock:
                    active_jobs = [
                        job
                        for job in active_jobs
                        if job.generation == self.translation_generation
                    ]
                    if active_jobs:
                        target = active_jobs[0].target
                        translated_items = self.service.translate_many(
                            [job.part.text for job in active_jobs],
                            target,
                        )
                        if len(translated_items) != len(active_jobs):
                            raise RuntimeError(
                                "번역 서비스가 요청한 메시지 수와 다른 결과를 반환했어."
                            )
                if not active_jobs:
                    if stop_after_batch:
                        return
                    continue
                for job, translated in zip(active_jobs, translated_items, strict=True):
                    self.results.put(
                        TranslationResult(job.part, job.target, job.generation, translated)
                    )
            except Exception as exc:
                for job in active_jobs:
                    self.results.put(
                        TranslationResult(
                            job.part,
                            job.target,
                            job.generation,
                            job.part.text,
                            str(exc),
                        )
                    )
            if stop_after_batch:
                return

    def _scan_images(self) -> None:
        assert self.client is not None
        requests = self.client.evaluate(IMAGE_UI_SCRIPT) or []
        for raw in requests:
            image_id = str(raw.get("id", ""))
            source_key = str(raw.get("sourceKey", ""))
            pending_key = (self.translation_generation, image_id)
            if not image_id or pending_key in self.image_pending:
                continue
            info = self.client.evaluate(image_capture_info_script(image_id))
            if not info:
                continue
            encoded = ""
            try:
                fetched = self.client.evaluate(
                    fetch_image_data_script(image_id),
                    await_promise=True,
                )
                if fetched:
                    encoded = str(fetched.get("base64", ""))
            except Exception as exc:
                LOGGER.info("이미지 원본 읽기 실패, 화면 캡처 사용: %s", exc)
            if not encoded:
                if not bool(info.get("fullyVisible")):
                    self.client.evaluate(
                        apply_image_error_script(
                            image_id,
                            "원본을 읽을 수 없습니다. 이미지 전체가 보이도록 조정한 후 "
                            "다시 시도해 주세요.",
                        )
                    )
                    continue
                self.client.evaluate(
                    "(() => { const button = document.getElementById("
                    "'dto-image-translate-button'); if (!button) return ''; "
                    "const previous = button.style.visibility; "
                    "button.style.visibility = 'hidden'; return previous; })()"
                )
                try:
                    self.client.evaluate(
                        "new Promise(resolve => requestAnimationFrame(() => "
                        "requestAnimationFrame(resolve)))",
                        await_promise=True,
                    )
                    screenshot = self.client.call(
                        "Page.captureScreenshot",
                        {
                            "format": "png",
                            "fromSurface": True,
                            "captureBeyondViewport": False,
                            "clip": {
                                "x": float(info["x"]),
                                "y": float(info["y"]),
                                "width": float(info["width"]),
                                "height": float(info["height"]),
                                "scale": 1,
                            },
                        },
                    )
                    encoded = str(screenshot.get("data", ""))
                finally:
                    self.client.evaluate(
                        "(() => { const button = document.getElementById("
                        "'dto-image-translate-button'); if (button) "
                        "button.style.visibility = ''; })()"
                    )
            if not encoded:
                self.client.evaluate(
                    apply_image_error_script(image_id, "이미지를 캡처하지 못했습니다.")
                )
                continue
            if not self.image_processor.ocr_ready:
                self.notices.put(
                    "이미지 OCR 모델을 준비하고 있습니다. 최초 실행에는 시간이 걸릴 수 있습니다."
                )
            with self.service_lock:
                namespace = self.service.namespace
            self.image_pending.add(pending_key)
            self.image_jobs.put(
                ImageTranslationJob(
                    image_id=image_id,
                    source_key=source_key,
                    png_bytes=base64.b64decode(encoded),
                    target=self.config.target_language,
                    generation=self.translation_generation,
                    translator_namespace=namespace,
                )
            )

    def _image_worker(self) -> None:
        while not self.stop_event.is_set():
            job = self.image_jobs.get()
            if job is None:
                return
            if job.generation != self.translation_generation:
                continue
            def translate_image_text(
                text: str,
                target: Language,
                generation: int = job.generation,
            ) -> str:
                if generation != self.translation_generation:
                    return text
                with self.service_lock:
                    if generation != self.translation_generation:
                        return text
                    return self.service.translate(text, target)

            try:
                outcome = self.image_processor.process(
                    job.png_bytes,
                    job.target,
                    translator_namespace=job.translator_namespace,
                    translate=translate_image_text,
                )
                self.image_results.put(
                    ImageTranslationResult(
                        image_id=job.image_id,
                        source_key=job.source_key,
                        target=job.target,
                        generation=job.generation,
                        png_bytes=outcome.png_bytes,
                        translated_count=outcome.translated_count,
                        used_cache=outcome.used_cache,
                    )
                )
            except Exception as exc:
                self.image_results.put(
                    ImageTranslationResult(
                        image_id=job.image_id,
                        source_key=job.source_key,
                        target=job.target,
                        generation=job.generation,
                        error=str(exc),
                    )
                )

    def _drain_image_results(self) -> None:
        assert self.client is not None
        while True:
            try:
                result = self.image_results.get_nowait()
            except queue.Empty:
                return
            self.image_pending.discard((result.generation, result.image_id))
            if (
                result.target != self.config.target_language
                or result.generation != self.translation_generation
            ):
                continue
            if result.error:
                LOGGER.error("이미지 번역 실패 (%s): %s", result.image_id, result.error)
                self.client.evaluate(apply_image_error_script(result.image_id, result.error))
                self.notices.put(f"이미지 번역에 실패했습니다: {result.error}")
                continue
            if result.translated_count == 0:
                message = "번역할 텍스트를 찾지 못했습니다."
                self.client.evaluate(apply_image_error_script(result.image_id, message))
                self.notices.put(message)
                continue
            translated_src = (
                "data:image/png;base64," + base64.b64encode(result.png_bytes).decode("ascii")
            )
            applied = self.client.evaluate(
                apply_image_result_script(
                    result.image_id,
                    translated_src,
                    result.source_key,
                ),
                await_promise=True,
            )
            LOGGER.info(
                "이미지 번역 적용: id=%s lines=%d cache=%s result=%s",
                result.image_id,
                result.translated_count,
                result.used_cache,
                applied,
            )

    def _drain_results(self) -> None:
        assert self.client is not None
        changes: list[dict[str, Any]] = []
        while True:
            try:
                result = self.results.get_nowait()
            except queue.Empty:
                break
            pending_key = (result.generation, *result.part.locator, result.part.text)
            self.pending.discard(pending_key)
            if (
                result.target != self.config.target_language
                or result.generation != self.translation_generation
            ):
                continue
            if result.error:
                LOGGER.error("번역 실패 (%s): %s", result.part.item_id, result.error)
                continue
            self.states[result.part.locator] = PartState(result.part.text, result.translated)
            if result.translated != result.part.text and self.enabled:
                changes.append(_change(result.part, result.translated))
        if changes:
            applied = self.client.evaluate(apply_script(changes))
            LOGGER.info("DOM 번역 적용: %s", applied)

    def _consume_hotkey(self) -> None:
        if self.toggle_requested.is_set():
            self.toggle_requested.clear()
            self._set_enabled(not self.enabled)

    def _consume_controls(self) -> None:
        while True:
            try:
                command, value = self.controls.get_nowait()
            except queue.Empty:
                return
            if command == "enabled" and isinstance(value, bool):
                self._set_enabled(value)
            elif command == "target" and isinstance(value, Language):
                self._set_target(value)
            elif command == "translator" and isinstance(value, str):
                self._set_translator(value)
            elif command == "speech_style" and isinstance(value, str):
                self._set_speech_style(value)
            elif command == "config" and isinstance(value, AppConfig):
                self._apply_config(value)
            elif command == "translator_ready" and isinstance(value, tuple):
                self._finish_translator_preparation(*value)
            elif command == "translator_failed" and isinstance(value, tuple):
                self._fail_translator_preparation(*value)

    def _set_enabled(self, enabled: bool) -> None:
        if enabled == self.enabled:
            return
        self.enabled = enabled
        self.config.enabled = enabled
        save_config(self.config)
        LOGGER.info("번역 %s", "켜짐" if enabled else "꺼짐")
        if not enabled:
            self._consecutive_connection_failures = 0
            self._connection_issue_reported = False
            self.restore()
            self._cancel_pending_translation_work()
            if not self.config.keep_local_model_warm:
                self._release_local_model()
        else:
            self._restored = False
            if self.config.keep_local_model_warm:
                self._start_active_local_warmup()

    def _record_connection_failure(self, error: Exception) -> None:
        if not self.enabled or self._connection_issue_reported:
            return
        self._consecutive_connection_failures += 1
        if self._consecutive_connection_failures < 2:
            return
        self._connection_issue_reported = True
        self.connection_issues.put(str(error))

    def _mark_connection_ready(self) -> None:
        self._consecutive_connection_failures = 0
        self._connection_issue_reported = False

    def _apply_config(self, updated: AppConfig) -> None:
        runtime_changed = (
            updated.translator != self.config.translator
            or updated.hymt_device != self.config.hymt_device
            or updated.speech_style != self.config.speech_style
        )
        target_changed = updated.target_language != self.config.target_language
        enabled_changed = updated.enabled != self.enabled
        warm_mode_changed = (
            updated.keep_local_model_warm != self.config.keep_local_model_warm
        )
        for field_info in fields(AppConfig):
            if field_info.name in {
                "enabled",
                "target_language",
                "translator",
                "hymt_device",
                "keep_local_model_warm",
                "speech_style",
            }:
                continue
            setattr(
                self.config,
                field_info.name,
                copy.deepcopy(getattr(updated, field_info.name)),
            )
        if target_changed:
            self._set_target(updated.target_language)
        self.config.hymt_device = updated.hymt_device
        self.config.keep_local_model_warm = updated.keep_local_model_warm
        self.config.speech_style = updated.speech_style
        if runtime_changed:
            self._set_translator(updated.translator, force=True)
        if enabled_changed:
            self._set_enabled(updated.enabled)
        if warm_mode_changed and not runtime_changed:
            self._sync_local_model_warmth()
        save_config(self.config)

    def _set_target(self, language: Language) -> None:
        if language == self.config.target_language:
            return
        self._reset_translation_state()
        self.config.target_language = language
        save_config(self.config)
        LOGGER.info("표시 언어 변경: %s", language.value)

    def _set_translator(self, name: str, *, force: bool = False) -> None:
        if name not in TRANSLATOR_LABELS:
            return
        if not force and name == self.active_translator_name and name == self.config.translator:
            return
        self.preparation_generation += 1
        self.preparing_translator_name = None
        self.translator_error = ""
        try:
            replacement = make_translator(self.config, name=name)
        except Exception as exc:
            message = f"번역 모델을 바꾸지 못했어: {exc}"
            self.translator_error = message
            LOGGER.exception(message)
            self.notices.put(message)
            return
        self.config.translator = name
        save_config(self.config)
        label = TRANSLATOR_LABELS[name]
        prepare = getattr(replacement, "prepare", None)
        should_prepare = (
            not name.startswith("hymt_")
            or self.enabled
            or self.config.keep_local_model_warm
        )
        if callable(prepare) and should_prepare:
            self._start_translator_preparation(name, replacement)
            LOGGER.info("번역 모델 준비 시작: %s", label)
            self.notices.put(
                f"{label} 준비를 뒤에서 시작했어. 완료 전까지 현재 모델로 계속 번역해."
            )
            return
        self._activate_translator(name, replacement)

    def _set_speech_style(self, style: str) -> None:
        if style not in SPEECH_STYLE_LABELS or style == self.config.speech_style:
            return
        previous_style = self.config.speech_style
        self.preparation_generation += 1
        self.config.speech_style = style
        try:
            replacement = make_translator(self.config, name=self.config.translator)
        except Exception as exc:
            self.config.speech_style = previous_style
            message = f"번역 말투를 바꾸지 못했어: {exc}"
            LOGGER.exception(message)
            self.notices.put(message)
            return
        save_config(self.config)
        name = self.config.translator
        prepare = getattr(replacement, "prepare", None)
        should_prepare = (
            not name.startswith("hymt_")
            or self.enabled
            or self.config.keep_local_model_warm
        )
        if callable(prepare) and should_prepare:
            self._start_translator_preparation(name, replacement)
        else:
            self._activate_translator(name, replacement)
        label = SPEECH_STYLE_LABELS[style]
        LOGGER.info("번역 말투 변경: %s", label)
        self.notices.put(f"번역 말투를 '{label}'(으)로 바꿨어.")

    def _start_translator_preparation(self, name: str, replacement: Translator) -> None:
        self.preparation_generation += 1
        generation = self.preparation_generation
        self.preparing_translator_name = name
        self.translator_error = ""
        label = TRANSLATOR_LABELS[name]
        if _translator_needs_download(replacement):
            self.notices.put(
                f"{label} 첫 다운로드가 필요해. 뒤에서 받는 동안 현재 모델을 계속 사용할게."
            )

        def prepare_in_background() -> None:
            try:
                prepare = replacement.prepare
                prepare()
                self.controls.put(
                    ("translator_ready", (generation, name, replacement))
                )
            except Exception as exc:
                self.controls.put(
                    ("translator_failed", (generation, name, replacement, str(exc)))
                )

        threading.Thread(
            target=prepare_in_background,
            name=f"prepare-{name}",
            daemon=True,
        ).start()

    def _finish_translator_preparation(
        self,
        generation: int,
        name: str,
        replacement: Translator,
    ) -> None:
        if generation != self.preparation_generation or name != self.config.translator:
            _close_translator(replacement)
            return
        self.preparing_translator_name = None
        self._activate_translator(name, replacement)
        if name.startswith("hymt_") and not (
            self.enabled or self.config.keep_local_model_warm
        ):
            self._release_local_model()
        label = TRANSLATOR_LABELS[name]
        LOGGER.info("번역 모델 준비 완료: %s", label)
        self.notices.put(f"{label} 준비가 끝났고 지금부터 이 모델로 번역해.")

    def _fail_translator_preparation(
        self,
        generation: int,
        name: str,
        replacement: Translator,
        error: str,
    ) -> None:
        _close_translator(replacement)
        if generation != self.preparation_generation or name != self.config.translator:
            return
        self.preparing_translator_name = None
        self.config.translator = self.active_translator_name
        save_config(self.config)
        message = f"{TRANSLATOR_LABELS[name]} 준비 실패: {error}"
        self.translator_error = message
        LOGGER.error(message)
        self.notices.put(message)

    def _activate_translator(self, name: str, replacement: Translator) -> None:
        self._reset_translation_state()
        with self.service_lock:
            previous = self.translator
            self.translator = replacement
            self.service = TranslationService(replacement, self.cache)
            self.active_translator_name = name
            self.preparing_translator_name = None
            self.translator_error = ""
        _close_translator(previous)
        LOGGER.info("번역 모델 변경: %s", TRANSLATOR_LABELS[name])

    def _start_active_local_warmup(self) -> None:
        if (
            not self.active_translator_name.startswith("hymt_")
            or not self.config.keep_local_model_warm
        ):
            return
        translator = self.translator
        prepare = getattr(translator, "prepare", None)
        if not callable(prepare) or self._local_warmup_translator is translator:
            return
        self._local_warmup_translator = translator

        def warm_in_background() -> None:
            try:
                with self.service_lock:
                    if (
                        translator is not self.translator
                        or not self.config.keep_local_model_warm
                    ):
                        return
                    prepare()
                LOGGER.info("로컬 번역 모델 예열 완료")
            except Exception as exc:
                LOGGER.exception("로컬 번역 모델 예열 실패")
                self.notices.put(f"로컬 모델 예열에 실패했어: {exc}")
            finally:
                if self._local_warmup_translator is translator:
                    self._local_warmup_translator = None

        threading.Thread(
            target=warm_in_background,
            name="warm-local-translator",
            daemon=True,
        ).start()

    def _release_local_model(self) -> None:
        if not self.active_translator_name.startswith("hymt_"):
            return
        with self.service_lock:
            _close_translator(self.translator)
        LOGGER.info("로컬 번역 모델 해제: VRAM 반환 요청 완료")

    def _sync_local_model_warmth(self) -> None:
        if not self.active_translator_name.startswith("hymt_"):
            return
        if self.config.keep_local_model_warm:
            self._start_active_local_warmup()
        elif not self.enabled:
            self._release_local_model()

    def _reset_translation_state(self) -> None:
        self.restore(discard_images=True)
        self._cancel_pending_translation_work()
        self._restored = False

    def _cancel_pending_translation_work(self) -> None:
        self.translation_generation += 1
        self.states.clear()
        self.pending.clear()
        self.image_pending.clear()
        while True:
            try:
                queued = self.jobs.get_nowait()
            except queue.Empty:
                break
            if queued is None:
                self.jobs.put(None)
                break
        while True:
            try:
                self.results.get_nowait()
            except queue.Empty:
                break
        while True:
            try:
                queued_image = self.image_jobs.get_nowait()
            except queue.Empty:
                break
            if queued_image is None:
                self.image_jobs.put(None)
                break
        while True:
            try:
                self.image_results.get_nowait()
            except queue.Empty:
                break

    def restore(self, *, discard_images: bool = False) -> None:
        if self.client is None:
            return
        try:
            if not self._restored:
                changes = [
                    {"kind": kind, "id": item_id, "index": index, "text": state.original}
                    for (kind, item_id, index), state in self.states.items()
                ]
                if changes:
                    self.client.evaluate(apply_script(changes))
            self.client.evaluate(restore_images_script(discard=discard_images))
        except Exception:
            LOGGER.exception("원문 복원 실패")
        self._restored = True


def _change(part: DomPart, text: str) -> dict[str, Any]:
    return {"kind": part.kind, "id": part.item_id, "index": part.index, "text": text}


def make_translator(config: AppConfig, *, name: str | None = None) -> Translator:
    selected = name or config.translator
    if selected in {"hymt_1_8b", "hymt_7b"}:
        return HyMtTranslator(
            "7b" if selected == "hymt_7b" else "1.8b",
            device=config.hymt_device,
            speech_style=config.speech_style,
        )
    if selected in {"chatgpt", "claude", "gemini"}:
        return SubscriptionCliTranslator(
            selected,
            speech_style=config.speech_style,
        )
    if selected == "deepl":
        return DeepLTranslator()
    if selected == "mock":
        return MockTranslator()
    return OriginalTranslator()


def _poll_interval_seconds(capture_fps: int) -> float:
    normalized = max(MIN_CAPTURE_FPS, min(MAX_CAPTURE_FPS, int(capture_fps)))
    return 1.0 / normalized


def _translator_needs_download(translator: Translator) -> bool:
    ready = getattr(translator, "model_is_ready", None)
    return callable(ready) and not bool(ready())


def _startup_fallback(config: AppConfig, desired_name: str) -> tuple[str, Translator]:
    if desired_name != "hymt_1_8b":
        fallback = make_translator(config, name="hymt_1_8b")
        if not _translator_needs_download(fallback):
            return "hymt_1_8b", fallback
        _close_translator(fallback)
    return "original", OriginalTranslator()


def _close_translator(translator: Translator) -> None:
    close = getattr(translator, "close", None)
    if callable(close):
        close()


def configure_logging() -> None:
    log_path = Path(user_log_dir("NudeTranslator", "NudeNyang")) / "dom-translate.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[logging.FileHandler(log_path, encoding="utf-8")],
    )


def run_with_tray(controller: DomTranslationController) -> int:
    from PySide6.QtCore import QTimer
    from PySide6.QtGui import QAction, QActionGroup
    from PySide6.QtWidgets import (
        QApplication,
        QDialog,
        QMenu,
        QMessageBox,
        QSystemTrayIcon,
    )

    app = QApplication(sys.argv)
    app.setApplicationName(PRODUCT_NAME)
    app.setApplicationDisplayName(PRODUCT_NAME)
    app.setWindowIcon(app_icon())
    app.setQuitOnLastWindowClosed(False)

    discord_launcher = create_discord_debug_launcher()
    repair_results: queue.Queue[tuple[bool, str]] = queue.Queue()
    repair_in_progress = False
    restart_attempted_for_activation = False
    connection_prompt_active = False
    settings_dialog: SettingsDialog | None = None

    def ensure_auto_restart_consent() -> bool:
        if controller.config.discord_auto_restart_consent_granted:
            return True
        parent = settings_dialog if settings_dialog is not None else None
        if not ask_auto_restart_consent(controller.config.ui_theme, parent):
            return False
        controller.config.discord_auto_restart_consent_granted = True
        save_config(controller.config)
        return True

    def request_translation_enabled(enabled: bool, *, user_initiated: bool) -> None:
        nonlocal restart_attempted_for_activation
        if enabled == controller.enabled:
            return
        if enabled:
            if repair_in_progress:
                return
            if not ensure_auto_restart_consent():
                return
            if user_initiated:
                restart_attempted_for_activation = False
        controller.request_enabled(enabled)

    def request_translation_toggle() -> None:
        request_translation_enabled(not controller.enabled, user_initiated=True)

    tray = QSystemTrayIcon(app_icon(enabled=controller.enabled), app)
    tray.setToolTip(f"{PRODUCT_NAME} · 실험적 DOM 모드")
    menu = QMenu()
    configure_tray_menu(menu, controller.config.ui_theme)

    open_action = QAction(f"{PRODUCT_NAME} 열기", menu)
    menu.addAction(open_action)
    menu.addSeparator()

    toggle_action = QAction("번역 켜기", menu)
    toggle_action.setIcon(translation_status_icon(enabled=controller.enabled))
    toggle_action.triggered.connect(lambda _checked=False: request_translation_toggle())
    menu.addAction(toggle_action)

    language_menu = menu.addMenu("표시 언어")
    language_group = QActionGroup(language_menu)
    language_group.setExclusive(True)
    language_actions: dict[Language, QAction] = {}
    labels = {
        Language.KOREAN: "한국어",
        Language.ENGLISH: "English",
        Language.JAPANESE: "日本語",
        Language.CHINESE_SIMPLIFIED: "简体中文",
        Language.CHINESE_TRADITIONAL: "繁體中文",
    }
    for language, label in labels.items():
        action = QAction(label, language_menu)
        action.setCheckable(True)
        action.setChecked(language == controller.config.target_language)
        action.triggered.connect(
            lambda _checked=False, selected=language: controller.request_target(selected)
        )
        language_group.addAction(action)
        language_menu.addAction(action)
        language_actions[language] = action

    translator_menu = menu.addMenu("번역 모델")
    translator_group = QActionGroup(translator_menu)
    translator_group.setExclusive(True)
    translator_actions: dict[str, QAction] = {}
    for name, label in TRANSLATOR_LABELS.items():
        action = QAction(label, translator_menu)
        action.setCheckable(True)
        action.setChecked(name == controller.config.translator)
        action.triggered.connect(
            lambda _checked=False, selected=name: controller.request_translator(selected)
        )
        translator_group.addAction(action)
        translator_menu.addAction(action)
        translator_actions[name] = action

    speech_style_menu = menu.addMenu("번역 말투")
    speech_style_group = QActionGroup(speech_style_menu)
    speech_style_group.setExclusive(True)
    speech_style_actions: dict[str, QAction] = {}
    for style, label in SPEECH_STYLE_LABELS.items():
        action = QAction(label, speech_style_menu)
        action.setCheckable(True)
        action.setChecked(style == controller.config.speech_style)
        action.triggered.connect(
            lambda _checked=False, selected=style: controller.request_speech_style(selected)
        )
        speech_style_group.addAction(action)
        speech_style_menu.addAction(action)
        speech_style_actions[style] = action

    menu.addSeparator()
    restart_update_action = QAction("재시작하여 업데이트", menu)
    restart_update_action.setVisible(False)
    menu.addAction(restart_update_action)
    settings_action = QAction("설정", menu)
    menu.addAction(settings_action)
    menu.addSeparator()
    exit_action = QAction("종료", menu)
    menu.addAction(exit_action)

    hotkeys = GlobalHotkeys()
    app.installNativeEventFilter(hotkeys)

    def bind_toggle_hotkey(shortcut: str) -> bool:
        hotkeys.clear()
        if not hotkeys.available:
            return True
        return hotkeys.register(shortcut, request_translation_toggle)

    if not bind_toggle_hotkey(controller.config.hotkeys.toggle_translation):
        tray.showMessage(
            "단축키 등록 실패",
            f"{controller.config.hotkeys.toggle_translation}을 다른 프로그램이 사용 중이야.",
            QSystemTrayIcon.MessageIcon.Warning,
            5000,
        )

    hotkey_timer = QTimer()
    hotkey_timer.timeout.connect(hotkeys.poll)
    hotkey_timer.start(30)

    worker = threading.Thread(target=controller.run, name="dom-controller", daemon=True)
    worker.start()

    def notify(title: str, message: str) -> None:
        tray.showMessage(title, message, QSystemTrayIcon.MessageIcon.Information, 5000)

    def start_discord_repair(expected_process_id: int | None) -> None:
        nonlocal repair_in_progress, restart_attempted_for_activation
        repair_in_progress = True
        restart_attempted_for_activation = True
        controller.request_enabled(False)
        notify("Discord 재시작 중", "디버그 렌더러 모드로 다시 연결하고 있어.")

        def worker() -> None:
            try:
                discord_launcher.restart(
                    expected_process_id=expected_process_id,
                    port=9222,
                )
                deadline = time.monotonic() + 30.0
                last_error = "Discord 디버그 렌더러를 찾지 못했어."
                while time.monotonic() < deadline:
                    try:
                        discord_target()
                        repair_results.put((True, ""))
                        return
                    except Exception as exc:
                        last_error = str(exc)
                        time.sleep(0.5)
                raise RuntimeError(
                    "Discord를 다시 열었지만 30초 안에 디버그 렌더러가 준비되지 않았어. "
                    f"마지막 오류: {last_error}"
                )
            except Exception as exc:
                repair_results.put((False, str(exc)))

        threading.Thread(
            target=worker,
            name="discord-debug-restart",
            daemon=True,
        ).start()

    def handle_connection_issue(_message: str) -> None:
        nonlocal connection_prompt_active
        if (
            connection_prompt_active
            or repair_in_progress
            or not controller.enabled
            or controller.client is not None
        ):
            return
        if not ensure_auto_restart_consent():
            controller.request_enabled(False)
            notify(
                "자동 재시작 취소",
                "동의하지 않아 번역을 껐어. 다시 켜면 안내를 확인할 수 있어.",
            )
            return
        if restart_attempted_for_activation:
            controller.request_enabled(False)
            QMessageBox.warning(
                settings_dialog,
                "Discord 연결 실패",
                "이번 번역 실행에서 Discord 자동 재시작을 이미 한 번 시도했지만 "
                "디버그 렌더러에 연결하지 못했어. Discord를 직접 종료한 뒤 다시 켜줘.",
            )
            return
        if not discord_launcher.available:
            controller.request_enabled(False)
            QMessageBox.warning(
                settings_dialog,
                "Discord를 찾을 수 없어",
                "설치되었거나 실행 중인 Discord를 찾지 못해서 번역을 켤 수 없어.",
            )
            return

        current = discord_launcher.current_process()
        expected_process_id = current.process_id if current is not None else None
        connection_prompt_active = True
        try:
            confirmed = ask_restart_countdown(
                controller.config.ui_theme,
                seconds=15,
                parent=settings_dialog,
            )
        finally:
            connection_prompt_active = False
        if not confirmed:
            controller.request_enabled(False)
            notify(
                "Discord 자동 재시작 취소",
                "번역을 껐어. 통화나 작성 중인 내용을 정리한 뒤 다시 켜면 돼.",
            )
            return
        if controller.client is not None:
            return
        start_discord_repair(expected_process_id)

    def update_ready(_staged: object) -> None:
        restart_update_action.setVisible(True)
        notify("업데이트 준비 완료", "트레이 메뉴에서 재시작하여 업데이트를 눌러줘.")

    updater = UpdateCoordinator(controller.config, notify=notify, ready=update_ready)
    updater.start()

    def finish_settings(
        dialog: SettingsDialog,
        result: int,
        draft: AppConfig,
        previous_shortcut: str,
    ) -> None:
        nonlocal restart_attempted_for_activation, settings_dialog
        if settings_dialog is dialog:
            settings_dialog = None
        try:
            if result != QDialog.DialogCode.Accepted:
                return
            dialog.apply()
            if draft.enabled and not controller.enabled:
                if ensure_auto_restart_consent():
                    draft.discord_auto_restart_consent_granted = True
                    restart_attempted_for_activation = False
                else:
                    draft.enabled = False
            if not bind_toggle_hotkey(draft.hotkeys.toggle_translation):
                bind_toggle_hotkey(previous_shortcut)
                QMessageBox.warning(
                    None,
                    "단축키를 사용할 수 없어",
                    f"{draft.hotkeys.toggle_translation}은 다른 프로그램이 사용 중이야. "
                    f"기존 {previous_shortcut} 단축키를 유지할게.",
                )
                return
            controller.request_config(draft)
            menu.setStyleSheet(menu_stylesheet(draft.ui_theme))
            save_config(draft)
        finally:
            dialog.deleteLater()

    def show_settings() -> None:
        nonlocal settings_dialog
        if settings_dialog is not None:
            bring_dialog_to_front(settings_dialog)
            return
        previous_shortcut = controller.config.hotkeys.toggle_translation
        draft = copy.deepcopy(controller.config)
        dialog = SettingsDialog(draft)
        settings_dialog = dialog
        dialog.finished.connect(
            lambda result, current=dialog, current_draft=draft, shortcut=previous_shortcut: (
                finish_settings(current, result, current_draft, shortcut)
            )
        )
        bring_dialog_to_front(dialog)

    open_action.triggered.connect(show_settings)
    settings_action.triggered.connect(show_settings)

    def quit_application() -> None:
        controller.stop()
        app.quit()

    def install_update() -> None:
        if updater.install_and_restart():
            quit_application()

    restart_update_action.triggered.connect(install_update)
    exit_action.triggered.connect(quit_application)
    app.aboutToQuit.connect(controller.stop)
    tray.setContextMenu(menu)
    tray.activated.connect(
        lambda reason: QTimer.singleShot(0, show_settings)
        if reason
        in (
            QSystemTrayIcon.ActivationReason.Trigger,
            QSystemTrayIcon.ActivationReason.DoubleClick,
        )
        else None
    )
    tray.show()
    tray.showMessage(
        f"{PRODUCT_NAME} 실행 중",
        "트레이 아이콘을 누르면 설정이 열려. "
        f"{controller.config.hotkeys.toggle_translation}로 번역을 켜거나 끌 수 있어.",
        QSystemTrayIcon.MessageIcon.Information,
        4000,
    )

    sync_timer = QTimer()
    last_enabled = controller.enabled

    def sync_menu() -> None:
        nonlocal last_enabled, repair_in_progress
        toggle_action.setIcon(translation_status_icon(enabled=controller.enabled))
        if controller.enabled != last_enabled:
            tray.setIcon(app_icon(enabled=controller.enabled))
            last_enabled = controller.enabled
        for language, action in language_actions.items():
            action.setChecked(language == controller.config.target_language)
        for name, action in translator_actions.items():
            action.setChecked(name == controller.config.translator)
        for style, action in speech_style_actions.items():
            action.setChecked(style == controller.config.speech_style)
        while True:
            try:
                repaired, error = repair_results.get_nowait()
            except queue.Empty:
                break
            repair_in_progress = False
            if repaired:
                controller.request_enabled(True)
                notify("Discord 연결 완료", "디버그 렌더러가 준비되어 번역을 다시 켰어.")
            else:
                controller.request_enabled(False)
                QMessageBox.warning(
                    settings_dialog,
                    "Discord 자동 재시작 실패",
                    error,
                )
        while True:
            try:
                issue = controller.connection_issues.get_nowait()
            except queue.Empty:
                break
            handle_connection_issue(issue)
        while True:
            try:
                message = controller.notices.get_nowait()
            except queue.Empty:
                break
            tray.showMessage(
                PRODUCT_NAME,
                message,
                QSystemTrayIcon.MessageIcon.Information,
                5000,
            )

    sync_timer.timeout.connect(sync_menu)
    sync_timer.start(200)
    result = app.exec()
    updater.close()
    hotkey_timer.stop()
    hotkeys.close()
    controller.stop()
    worker.join(timeout=5.0)
    controller.close()
    return result


def main() -> None:
    configure_logging()
    load_local_env()
    config = load_config()
    controller = DomTranslationController(config)
    signal.signal(signal.SIGINT, lambda *_: controller.stop())
    signal.signal(signal.SIGTERM, lambda *_: controller.stop())
    raise SystemExit(run_with_tray(controller))


if __name__ == "__main__":
    main()
