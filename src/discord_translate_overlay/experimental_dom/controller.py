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
from ..translation.base import Translator
from ..translation.deepl import DeepLTranslator
from ..translation.hymt import HyMtTranslator
from ..translation.mock import OriginalTranslator
from ..translation.protected_text import protect_text
from ..translation.subscription_cli import SubscriptionCliTranslator
from ..ui.hotkeys import GlobalHotkeys
from ..ui.settings_dialog import SettingsDialog
from ..ui.update_coordinator import UpdateCoordinator
from ..ui.visuals import app_icon, menu_stylesheet
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
    "original": "원문 표시",
}
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
        if _translator_needs_download(desired_translator):
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
        self.notices: queue.Queue[str] = queue.Queue()
        self.stop_event = threading.Event()
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
            self._consume_controls()
            self._consume_hotkey()
            try:
                self.connect()
                self._drain_results()
                self._drain_image_results()
                if self.enabled:
                    self._scan()
                    self._scan_images()
            except Exception:
                LOGGER.exception("DOM 처리 중 오류")
                if self.client is not None:
                    self.client.close()
                    self.client = None
                time.sleep(1.0)
            time.sleep(0.25)

    def stop(self, *_: object) -> None:
        self.stop_event.set()

    def request_toggle(self) -> None:
        self.toggle_requested.set()

    def request_enabled(self, enabled: bool) -> None:
        self.controls.put(("enabled", enabled))

    def request_target(self, language: Language) -> None:
        self.controls.put(("target", language))

    def request_translator(self, name: str) -> None:
        self.controls.put(("translator", name))

    def request_speech_style(self, style: str) -> None:
        self.controls.put(("speech_style", style))

    def request_config(self, config: AppConfig) -> None:
        self.controls.put(("config", copy.deepcopy(config)))

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
            job = self.jobs.get()
            if job is None:
                return
            if job.generation != self.translation_generation:
                continue
            try:
                with self.service_lock:
                    if job.generation != self.translation_generation:
                        continue
                    translated = self.service.translate(job.part.text, job.target)
                self.results.put(
                    TranslationResult(job.part, job.target, job.generation, translated)
                )
            except Exception as exc:
                self.results.put(
                    TranslationResult(
                        job.part,
                        job.target,
                        job.generation,
                        job.part.text,
                        str(exc),
                    )
                )

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
            self.restore()
        else:
            self._restored = False

    def _apply_config(self, updated: AppConfig) -> None:
        runtime_changed = (
            updated.translator != self.config.translator
            or updated.hymt_device != self.config.hymt_device
            or updated.speech_style != self.config.speech_style
        )
        target_changed = updated.target_language != self.config.target_language
        enabled_changed = updated.enabled != self.enabled
        for field_info in fields(AppConfig):
            if field_info.name in {
                "enabled",
                "target_language",
                "translator",
                "hymt_device",
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
        self.config.speech_style = updated.speech_style
        if runtime_changed:
            self._set_translator(updated.translator, force=True)
        if enabled_changed:
            self._set_enabled(updated.enabled)
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
        try:
            replacement = make_translator(self.config, name=name)
        except Exception as exc:
            message = f"번역 모델을 바꾸지 못했어: {exc}"
            LOGGER.exception(message)
            self.notices.put(message)
            return
        self.config.translator = name
        save_config(self.config)
        label = TRANSLATOR_LABELS[name]
        prepare = getattr(replacement, "prepare", None)
        if callable(prepare):
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
        if callable(prepare):
            self._start_translator_preparation(name, replacement)
        else:
            self._activate_translator(name, replacement)
        label = SPEECH_STYLE_LABELS[style]
        LOGGER.info("번역 말투 변경: %s", label)
        self.notices.put(f"번역 말투를 '{label}'(으)로 바꿨어.")

    def _start_translator_preparation(self, name: str, replacement: Translator) -> None:
        self.preparation_generation += 1
        generation = self.preparation_generation
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
        self._activate_translator(name, replacement)
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
        self.config.translator = self.active_translator_name
        save_config(self.config)
        message = f"{TRANSLATOR_LABELS[name]} 준비 실패: {error}"
        LOGGER.error(message)
        self.notices.put(message)

    def _activate_translator(self, name: str, replacement: Translator) -> None:
        self._reset_translation_state()
        with self.service_lock:
            previous = self.translator
            self.translator = replacement
            self.service = TranslationService(replacement, self.cache)
            self.active_translator_name = name
        _close_translator(previous)
        LOGGER.info("번역 모델 변경: %s", TRANSLATOR_LABELS[name])

    def _reset_translation_state(self) -> None:
        self.restore(discard_images=True)
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
        self._restored = False

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
    return OriginalTranslator()


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
    from PySide6.QtWidgets import QApplication, QMenu, QMessageBox, QSystemTrayIcon

    app = QApplication(sys.argv)
    app.setApplicationName(PRODUCT_NAME)
    app.setApplicationDisplayName(PRODUCT_NAME)
    app.setWindowIcon(app_icon())
    app.setQuitOnLastWindowClosed(False)

    tray = QSystemTrayIcon(app_icon(enabled=controller.enabled), app)
    tray.setToolTip(f"{PRODUCT_NAME} · 실험적 DOM 모드")
    menu = QMenu()
    menu.setStyleSheet(menu_stylesheet(controller.config.ui_theme))

    open_action = QAction(f"{PRODUCT_NAME} 열기", menu)
    menu.addAction(open_action)
    menu.addSeparator()

    toggle_action = QAction("번역 켜기", menu)
    toggle_action.setCheckable(True)
    toggle_action.setChecked(controller.enabled)
    toggle_action.triggered.connect(lambda _checked=False: controller.request_toggle())
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
        return hotkeys.register(shortcut, controller.request_toggle)

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

    def update_ready(_staged: object) -> None:
        restart_update_action.setVisible(True)
        notify("업데이트 준비 완료", "트레이 메뉴에서 재시작하여 업데이트를 눌러줘.")

    updater = UpdateCoordinator(controller.config, notify=notify, ready=update_ready)
    updater.start()

    def show_settings() -> None:
        previous_shortcut = controller.config.hotkeys.toggle_translation
        draft = copy.deepcopy(controller.config)
        dialog = SettingsDialog(draft)
        if not dialog.exec():
            return
        dialog.apply()
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
        lambda reason: show_settings()
        if reason == QSystemTrayIcon.ActivationReason.Trigger
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
        nonlocal last_enabled
        toggle_action.setChecked(controller.enabled)
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
