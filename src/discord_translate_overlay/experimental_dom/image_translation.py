from __future__ import annotations

import colorsys
import json
import math
import os
import threading
from collections.abc import Callable
from dataclasses import dataclass, replace
from hashlib import sha256
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from platformdirs import user_cache_dir

from ..models import Language, Rect, TextLine
from ..ocr.base import OcrEngine

IMAGE_RENDER_VERSION = "poster-plates-v6"


IMAGE_UI_SCRIPT = r"""
(() => {
  const uiVersion = 'image-ui-v6';
  if (window.__dtoImageUiVersion !== uiVersion) {
    window.__dtoImageUiAbortController?.abort();
    document.getElementById('dto-image-translate-button')?.remove();
    document.getElementById('dto-image-translation-style')?.remove();
    document.querySelectorAll('img[data-dto-original-src]').forEach((img) => {
      img.src = img.dataset.dtoOriginalSrc;
      delete img.dataset.dtoTranslatedSrc;
      img.dataset.dtoImageStatus = 'original';
    });
    window.__dtoTranslatedImageBySource = {};
    window.__dtoImageTranslationVisibility = {};
    window.__dtoImageTranslationRequests = [];
    window.__dtoImageUiAbortController = new AbortController();
    window.__dtoImageUiVersion = uiVersion;
    window.__dtoImageUiInstalled = false;
  }
  window.__dtoImageTranslationRequests = window.__dtoImageTranslationRequests || [];
  window.__dtoImageSequence = window.__dtoImageSequence || 0;
  window.__dtoTranslatedImageBySource = window.__dtoTranslatedImageBySource || {};
  window.__dtoImageTranslationVisibility = window.__dtoImageTranslationVisibility || {};
  window.__dtoImageTranslationEnabled = true;

  function imageSourceKey(source) {
    if (!source) return '';
    try {
      const url = new URL(source, location.href);
      const attachment = url.pathname.match(/\/attachments\/[^?#]+/i);
      if (attachment) return `discord-attachment:${attachment[0]}`;
      return `${url.origin}${url.pathname}`;
    } catch (_) {
      return source.split(/[?#]/, 1)[0];
    }
  }
  window.__dtoImageSourceKey = imageSourceKey;

  function imageById(id) {
    return document.querySelector(`[data-dto-image-id="${CSS.escape(id)}"]`);
  }
  function isMediaViewerImage(img) {
    if (!(img instanceof HTMLImageElement)) return false;
    const dialog = img.closest('[role="dialog"]');
    if (!dialog) return false;
    const label = dialog.getAttribute('aria-label') || '';
    return /media|미디어|メディア|媒体/i.test(label) ||
      Boolean(dialog.querySelector('[class*="carousel"], [class*="modal"]'));
  }
  function isEligible(img) {
    if (!(img instanceof HTMLImageElement)) return false;
    if (img.dataset.dtoImageId) return true;
    const inMessage = Boolean(img.closest('[id^="chat-messages-"]'));
    const inMediaViewer = isMediaViewerImage(img);
    if (!inMessage && !inMediaViewer) return false;
    const rect = img.getBoundingClientRect();
    if (rect.width < 160 || rect.height < 90) return false;
    const intersectsViewport = rect.right > 0 && rect.bottom > 0 &&
      rect.left < innerWidth && rect.top < innerHeight;
    if (!intersectsViewport) return false;
    if (inMessage &&
        (rect.top < 0 || rect.left < 0 || rect.bottom > innerHeight || rect.right > innerWidth)) {
      return false;
    }
    const source = img.currentSrc || img.src || '';
    if (!source || source.startsWith('data:') || source.startsWith('blob:')) return false;
    if (/\.(gif)(?:\?|$)/i.test(source)) return false;
    if (/\/(?:avatars|icons|emojis|stickers|clan-badges|badge-icons)\//i.test(source)) {
      return false;
    }
    if (String(img.className).match(/avatar|emoji|sticker|icon|placeholder/i)) return false;
    return true;
  }
  function imageAtPoint(x, y) {
    for (const element of document.elementsFromPoint(x, y)) {
      if (element instanceof HTMLImageElement && isEligible(element)) return element;
    }
    return null;
  }
  function ensureId(img) {
    if (!img.dataset.dtoImageId) {
      window.__dtoImageSequence += 1;
      img.dataset.dtoImageId = `dto-image-${window.__dtoImageSequence}`;
    }
    if (!img.dataset.dtoOriginalSrc) {
      img.dataset.dtoOriginalSrc = img.getAttribute('src') || img.currentSrc;
      img.dataset.dtoOriginalSrcset = img.getAttribute('srcset') || '';
    }
    if (!img.dataset.dtoImageSourceKey) {
      img.dataset.dtoImageSourceKey = imageSourceKey(img.dataset.dtoOriginalSrc);
    }
    if (!img.dataset.dtoImageStatus) {
      img.dataset.dtoImageStatus = 'original';
    }
    return img.dataset.dtoImageId;
  }

  function reapplyRememberedTranslations() {
    for (const img of document.querySelectorAll('img')) {
      if (!isEligible(img)) continue;
      const status = img.dataset.dtoImageStatus || '';
      if (status === 'processing' || status === 'translated-hidden') continue;
      const original = img.dataset.dtoOriginalSrc ||
        img.getAttribute('src') || img.currentSrc || '';
      if (!original || original.startsWith('data:') || original.startsWith('blob:')) continue;
      const key = img.dataset.dtoImageSourceKey || imageSourceKey(original);
      const translated = window.__dtoTranslatedImageBySource[key] || '';
      if (!translated) continue;
      ensureId(img);
      img.dataset.dtoImageSourceKey = key;
      img.dataset.dtoTranslatedSrc = translated;
      if (window.__dtoImageTranslationVisibility[key] === 'hidden') {
        img.dataset.dtoImageStatus = 'translated-hidden';
        continue;
      }
      img.removeAttribute('srcset');
      if (img.src !== translated) img.src = translated;
      img.dataset.dtoImageStatus = 'translated';
    }
  }

  for (const img of document.querySelectorAll('img[data-dto-translated-src]')) {
    ensureId(img);
    const key = img.dataset.dtoImageSourceKey;
    if (!key) continue;
    window.__dtoTranslatedImageBySource[key] = img.dataset.dtoTranslatedSrc;
    window.__dtoImageTranslationVisibility[key] =
      img.dataset.dtoImageStatus === 'translated-hidden' ? 'hidden' : 'visible';
  }

  let style = document.getElementById('dto-image-translation-style');
  if (!style) {
    style = document.createElement('style');
    style.id = 'dto-image-translation-style';
    style.textContent = `
      #dto-image-translate-button {
        position: fixed; z-index: 2147483646; display: none;
        padding: 7px 11px; border: 1px solid rgba(121, 231, 224, .5);
        border-radius: 9px; color: #e8fffd; background: rgba(16, 31, 36, .94);
        box-shadow: 0 5px 18px rgba(0, 0, 0, .32);
        font: 600 12px/1.2 "Segoe UI", sans-serif; cursor: pointer;
        backdrop-filter: blur(10px);
      }
      #dto-image-translate-button:hover { background: rgba(28, 67, 70, .97); }
      #dto-image-translate-button:disabled { cursor: default; opacity: .84; }
      #dto-image-translate-button[data-dto-button-state="processing"]:disabled {
        cursor: wait;
      }
    `;
    document.head.appendChild(style);
  }

  let button = document.getElementById('dto-image-translate-button');
  if (!button) {
    button = document.createElement('button');
    button.id = 'dto-image-translate-button';
    button.type = 'button';
    button.setAttribute('aria-label', '이미지 번역');
    document.body.appendChild(button);
  }

  function translatedSource(img) {
    return img.dataset.dtoTranslatedSrc || '';
  }
  function updateButton(img) {
    const status = img.dataset.dtoImageStatus || 'original';
    if (!window.__dtoImageTranslationEnabled) {
      button.dataset.dtoButtonState = 'disabled';
      button.disabled = true;
      button.textContent = '번역이 꺼져 있습니다';
      button.title = '설정 또는 단축키에서 번역을 켜 주세요.';
      return;
    }
    button.dataset.dtoButtonState = status;
    button.disabled = status === 'processing';
    button.title = img.dataset.dtoImageError || '';
    if (status === 'translated') button.textContent = '원문 보기';
    else if (status === 'translated-hidden') button.textContent = '번역 보기';
    else if (status === 'processing') button.textContent = '번역 중…';
    else if (status === 'error') button.textContent = '다시 시도';
    else button.textContent = '이미지 번역';
  }
  function positionButton(img) {
    const rect = img.getBoundingClientRect();
    const visibleRight = Math.min(innerWidth - 8, rect.right);
    const visibleBottom = Math.min(innerHeight, rect.bottom);
    button.style.left = `${Math.max(8, visibleRight - button.offsetWidth - 8)}px`;
    button.style.top = `${Math.max(8, visibleBottom - button.offsetHeight - 8)}px`;
  }
  function showButton(img) {
    if (!isEligible(img)) return;
    ensureId(img);
    button.dataset.dtoTargetImage = img.dataset.dtoImageId;
    updateButton(img);
    button.style.display = 'block';
    positionButton(img);
  }
  function hideButtonSoon() {
    clearTimeout(window.__dtoImageButtonTimer);
    window.__dtoImageButtonTimer = setTimeout(() => {
      if (!button.matches(':hover')) button.style.display = 'none';
    }, 140);
  }

  if (!window.__dtoImageUiInstalled) {
    window.__dtoImageUiInstalled = true;
    const eventSignal = window.__dtoImageUiAbortController.signal;
    document.addEventListener('pointermove', event => {
      window.__dtoImagePointerPosition = {x: event.clientX, y: event.clientY};
      if (window.__dtoImagePointerFrame) return;
      window.__dtoImagePointerFrame = requestAnimationFrame(() => {
        window.__dtoImagePointerFrame = 0;
        const point = window.__dtoImagePointerPosition;
        const img = point ? imageAtPoint(point.x, point.y) : null;
        if (img) showButton(img);
        else if (!button.matches(':hover')) hideButtonSoon();
      });
    }, {capture: true, signal: eventSignal});
    document.addEventListener(
      'scroll',
      () => { button.style.display = 'none'; },
      {capture: true, signal: eventSignal},
    );
    button.addEventListener(
      'pointerenter',
      () => clearTimeout(window.__dtoImageButtonTimer),
      {signal: eventSignal},
    );
    button.addEventListener('pointerleave', hideButtonSoon, {signal: eventSignal});
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const id = button.dataset.dtoTargetImage || '';
      const img = imageById(id);
      if (!img) return;
      if (!window.__dtoImageTranslationEnabled) return;
      const translated = translatedSource(img);
      const status = img.dataset.dtoImageStatus || 'original';
      if (status === 'translated') {
        img.src = img.dataset.dtoOriginalSrc;
        if (img.dataset.dtoOriginalSrcset) img.srcset = img.dataset.dtoOriginalSrcset;
        else img.removeAttribute('srcset');
        img.dataset.dtoImageStatus = 'translated-hidden';
        window.__dtoImageTranslationVisibility[img.dataset.dtoImageSourceKey] = 'hidden';
        updateButton(img);
        return;
      }
      if (status === 'translated-hidden' && translated) {
        img.removeAttribute('srcset');
        img.src = translated;
        img.dataset.dtoImageStatus = 'translated';
        window.__dtoImageTranslationVisibility[img.dataset.dtoImageSourceKey] = 'visible';
        updateButton(img);
        return;
      }
      if (status === 'processing') return;
      img.dataset.dtoImageStatus = 'processing';
      delete img.dataset.dtoImageError;
      updateButton(img);
      window.__dtoImageTranslationRequests.push({
        id,
        sourceKey: img.dataset.dtoImageSourceKey || '',
      });
    }, {signal: eventSignal});
  }

  reapplyRememberedTranslations();
  for (const img of document.querySelectorAll('img[data-dto-image-status="translated"]')) {
    const translated = translatedSource(img);
    if (translated && img.src !== translated) {
      img.removeAttribute('srcset');
      img.src = translated;
    }
  }
  for (const img of document.querySelectorAll('img[data-dto-image-status="paused"]')) {
    const translated = translatedSource(img);
    if (translated) {
      img.removeAttribute('srcset');
      img.src = translated;
      img.dataset.dtoImageStatus = 'translated';
    }
  }
  return window.__dtoImageTranslationRequests.splice(0);
})()
"""


def image_capture_info_script(image_id: str) -> str:
    encoded = json.dumps(image_id, ensure_ascii=False)
    return rf"""
(() => {{
  const imageId = {encoded};
  const img = document.querySelector(
    `[data-dto-image-id="${{CSS.escape(imageId)}}"]`
  );
  if (!img) return null;
  const rect = img.getBoundingClientRect();
  const fullyVisible = rect.width >= 160 && rect.height >= 90 &&
    rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight;
  return {{
    id: imageId,
    x: rect.left + scrollX,
    y: rect.top + scrollY,
    width: rect.width,
    height: rect.height,
    fullyVisible,
  }};
}})()
"""


def fetch_image_data_script(image_id: str) -> str:
    encoded = json.dumps(image_id, ensure_ascii=False)
    return rf"""
(async () => {{
  const imageId = {encoded};
  const img = document.querySelector(
    `[data-dto-image-id="${{CSS.escape(imageId)}}"]`
  );
  if (!img) return null;
  const source = img.dataset.dtoOriginalSrc || img.currentSrc || img.src || '';
  if (!source || source.startsWith('data:') || source.startsWith('blob:')) return null;
  const response = await fetch(source, {{cache: 'force-cache', credentials: 'omit'}});
  if (!response.ok) throw new Error(`이미지 읽기 실패: HTTP ${{response.status}}`);
  const blob = await response.blob();
  const dataUrl = await new Promise((resolve, reject) => {{
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('이미지 읽기 실패'));
    reader.readAsDataURL(blob);
  }});
  const comma = dataUrl.indexOf(',');
  return {{
    base64: comma >= 0 ? dataUrl.slice(comma + 1) : '',
    mime: blob.type || '',
    source,
  }};
}})()
"""


def apply_image_result_script(
    image_id: str,
    translated_src: str,
    source_key: str = "",
) -> str:
    encoded_id = json.dumps(image_id, ensure_ascii=False)
    encoded_src = json.dumps(translated_src, ensure_ascii=False)
    encoded_key = json.dumps(source_key, ensure_ascii=False)
    return rf"""
(async () => {{
  const imageId = {encoded_id};
  const translatedSrc = {encoded_src};
  const requestedSourceKey = {encoded_key};
  const preload = new Image();
  preload.decoding = 'async';
  preload.src = translatedSrc;
  try {{ await preload.decode(); }} catch (_) {{}}
  const img = document.querySelector(
    `[data-dto-image-id="${{CSS.escape(imageId)}}"]`
  );
  const original = img?.dataset.dtoOriginalSrc || '';
  const sourceKey = requestedSourceKey || img?.dataset.dtoImageSourceKey ||
    window.__dtoImageSourceKey?.(original) || '';
  window.__dtoTranslatedImageBySource = window.__dtoTranslatedImageBySource || {{}};
  window.__dtoImageTranslationVisibility = window.__dtoImageTranslationVisibility || {{}};
  if (sourceKey) {{
    window.__dtoTranslatedImageBySource[sourceKey] = translatedSrc;
    window.__dtoImageTranslationVisibility[sourceKey] = 'visible';
  }}
  if (!img) return {{applied: false, remembered: Boolean(sourceKey)}};
  img.dataset.dtoTranslatedSrc = translatedSrc;
  if (sourceKey) img.dataset.dtoImageSourceKey = sourceKey;
  img.removeAttribute('srcset');
  img.src = translatedSrc;
  img.dataset.dtoImageStatus = 'translated';
  delete img.dataset.dtoImageError;
  const button = document.getElementById('dto-image-translate-button');
  if (button?.dataset.dtoTargetImage === imageId) {{
    button.dataset.dtoButtonState = 'translated';
    button.disabled = false;
    button.textContent = '원문 보기';
    button.title = '';
  }}
  return {{applied: true, remembered: Boolean(sourceKey)}};
}})()
"""


def apply_image_error_script(image_id: str, message: str) -> str:
    encoded_id = json.dumps(image_id, ensure_ascii=False)
    encoded_message = json.dumps(message, ensure_ascii=False)
    return rf"""
(() => {{
  const imageId = {encoded_id};
  const img = document.querySelector(
    `[data-dto-image-id="${{CSS.escape(imageId)}}"]`
  );
  if (!img) return {{applied: false}};
  img.dataset.dtoImageStatus = 'error';
  img.dataset.dtoImageError = {encoded_message};
  const button = document.getElementById('dto-image-translate-button');
  if (button?.dataset.dtoTargetImage === imageId) {{
    button.dataset.dtoButtonState = 'error';
    button.disabled = false;
    button.textContent = '다시 시도';
    button.title = {encoded_message};
  }}
  return {{applied: true}};
}})()
"""


def restore_images_script(*, discard: bool) -> str:
    discard_literal = "true" if discard else "false"
    return rf"""
(() => {{
  const discard = {discard_literal};
  window.__dtoImageTranslationEnabled = false;
  const button = document.getElementById('dto-image-translate-button');
  if (button) button.style.display = 'none';
  let restored = 0;
  for (const img of document.querySelectorAll('img[data-dto-image-id]')) {{
    if (img.dataset.dtoOriginalSrc) {{
      img.src = img.dataset.dtoOriginalSrc;
      if (img.dataset.dtoOriginalSrcset) img.srcset = img.dataset.dtoOriginalSrcset;
      else img.removeAttribute('srcset');
      restored++;
    }}
    if (discard) {{
      delete img.dataset.dtoTranslatedSrc;
      delete img.dataset.dtoImageError;
      img.dataset.dtoImageStatus = 'original';
    }} else if (img.dataset.dtoTranslatedSrc) {{
      img.dataset.dtoImageStatus = 'paused';
    }} else {{
      img.dataset.dtoImageStatus = 'original';
    }}
  }}
  if (discard) {{
    window.__dtoTranslatedImageBySource = {{}};
    window.__dtoImageTranslationVisibility = {{}};
    window.__dtoImageTranslationRequests = [];
  }}
  return {{restored}};
}})()
"""


@dataclass(frozen=True, slots=True)
class ImageTranslationOutcome:
    png_bytes: bytes
    translated_count: int
    used_cache: bool


class ImageTranslationProcessor:
    def __init__(
        self,
        ocr_factory: Callable[[], OcrEngine],
        *,
        cache_dir: Path | None = None,
    ) -> None:
        self.ocr_factory = ocr_factory
        self.cache_dir = cache_dir or (
            Path(user_cache_dir("DiscordTranslateOverlay", "LocalTools"))
            / "image-translations"
        )
        self._ocr: OcrEngine | None = None
        self._lock = threading.Lock()

    @property
    def ocr_ready(self) -> bool:
        return self._ocr is not None

    def process(
        self,
        png_bytes: bytes,
        target: Language,
        *,
        translator_namespace: str,
        translate: Callable[[str, Language], str],
    ) -> ImageTranslationOutcome:
        cache_key = sha256(
            b"\0".join(
                (
                    png_bytes,
                    target.value.encode("utf-8"),
                    translator_namespace.encode("utf-8"),
                    IMAGE_RENDER_VERSION.encode("ascii"),
                )
            )
        ).hexdigest()
        cache_path = self.cache_dir / f"{cache_key}.png"
        try:
            cached = cache_path.read_bytes()
        except FileNotFoundError:
            cached = b""
        if cached and _decode_png(cached) is not None:
            return ImageTranslationOutcome(cached, 1, True)

        image_bgr = _decode_png(png_bytes)
        if image_bgr is None:
            raise ValueError("이미지 데이터를 읽을 수 없습니다.")
        with self._lock:
            if self._ocr is None:
                self._ocr = self.ocr_factory()
            lines = self._ocr.recognize(image_bgr)

        height, width = image_bgr.shape[:2]
        lines = _group_dense_text_lines(lines, width, height)

        translated_lines: list[tuple[TextLine, str]] = []
        for line in lines:
            source = line.text.strip()
            if line.confidence < 0.35 or not source or line.bbox.area < 16:
                continue
            translated = translate(source, target).strip()
            if translated and translated != source:
                translated_lines.append((line, translated))
        if not translated_lines:
            return ImageTranslationOutcome(png_bytes, 0, False)

        rendered = _render_image(image_bgr, translated_lines, target)
        ok, encoded = cv2.imencode(".png", rendered)
        if not ok:
            raise RuntimeError("번역 이미지를 PNG로 만들 수 없습니다.")
        result = encoded.tobytes()
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        temporary = cache_path.with_suffix(".tmp")
        temporary.write_bytes(result)
        os.replace(temporary, cache_path)
        return ImageTranslationOutcome(result, len(translated_lines), False)


def _decode_png(data: bytes) -> np.ndarray | None:
    if not data:
        return None
    decoded = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if decoded is None or decoded.size == 0:
        return None
    return decoded


def _group_dense_text_lines(
    lines: list[TextLine],
    image_width: int,
    image_height: int,
) -> list[TextLine]:
    """Combine small neighbouring OCR rows into independent paragraph columns.

    Translating and rendering every 20-30 px OCR row independently makes Korean
    text shrink and collide.  Posters commonly place those rows in narrow columns,
    so keep large headings separate and merge only visually adjacent small rows.
    """
    maximum_line_height = max(18, int(round(image_height * 0.018)))
    minimum_line_width = max(42, int(round(image_width * 0.045)))
    candidates = [
        line
        for line in lines
        if (
            7 <= _line_geometry(line).height <= maximum_line_height
            and _line_geometry(line).width >= minimum_line_width
            and abs(_line_geometry(line).angle_degrees) <= 3.0
            and sum(character.isalnum() for character in line.text) >= 3
        )
    ]
    if len(candidates) < 2:
        return lines

    parent = list(range(len(candidates)))

    def find(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    def union(first: int, second: int) -> None:
        first_root = find(first)
        second_root = find(second)
        if first_root != second_root:
            parent[second_root] = first_root

    def belongs_to_same_paragraph(first: TextLine, second: TextLine) -> bool:
        if (
            first.language != second.language
            and Language.UNKNOWN not in {first.language, second.language}
        ):
            return False
        upper, lower = sorted((first, second), key=lambda line: line.bbox.top)
        first_geometry = _line_geometry(upper)
        second_geometry = _line_geometry(lower)
        height_ratio = max(first_geometry.height, second_geometry.height) / max(
            1, min(first_geometry.height, second_geometry.height)
        )
        if height_ratio > 1.45:
            return False
        vertical_gap = lower.bbox.top - upper.bbox.bottom
        if vertical_gap < -min(first_geometry.height, second_geometry.height) * 0.4:
            return False
        if vertical_gap > max(14, int(max(first_geometry.height, second_geometry.height) * 1.1)):
            return False
        overlap = max(
            0,
            min(first.bbox.right, second.bbox.right)
            - max(first.bbox.left, second.bbox.left),
        )
        overlap_ratio = overlap / max(1, min(first.bbox.width, second.bbox.width))
        center_distance = abs(first_geometry.center_x - second_geometry.center_x)
        return overlap_ratio >= 0.52 and center_distance <= max(
            first_geometry.width, second_geometry.width
        ) * 0.34

    for first_index, first in enumerate(candidates):
        for second_index in range(first_index + 1, len(candidates)):
            second = candidates[second_index]
            if second.bbox.top - first.bbox.bottom > maximum_line_height * 2:
                continue
            if belongs_to_same_paragraph(first, second):
                union(first_index, second_index)

    components: dict[int, list[TextLine]] = {}
    for index, line in enumerate(candidates):
        components.setdefault(find(index), []).append(line)
    merged_components = [
        sorted(component, key=lambda line: (line.bbox.top, line.bbox.left))
        for component in components.values()
        if len(component) >= 2
    ]
    if not merged_components:
        return lines

    consumed = {id(line) for component in merged_components for line in component}
    result = [line for line in lines if id(line) not in consumed]
    for component in merged_components:
        left = min(line.bbox.left for line in component)
        top = min(line.bbox.top for line in component)
        right = max(line.bbox.right for line in component)
        bottom = max(line.bbox.bottom for line in component)
        bbox = Rect(left, top, right, bottom)
        polygon = np.array(
            [[left, top], [right, top], [right, bottom], [left, bottom]],
            dtype=np.float32,
        )
        known_languages = [
            line.language for line in component if line.language != Language.UNKNOWN
        ]
        language = known_languages[0] if known_languages else Language.UNKNOWN
        result.append(
            TextLine(
                polygon=polygon,
                bbox=bbox,
                text="\n".join(line.text.strip() for line in component),
                confidence=sum(line.confidence for line in component) / len(component),
                language=language,
            )
        )
    return sorted(result, key=lambda line: (line.bbox.top, line.bbox.left))


@dataclass(frozen=True, slots=True)
class ImageTextStyle:
    family: str = "sans"
    bold: bool = False
    foreground_rgb: tuple[int, int, int] = (28, 31, 35)
    background_rgb: tuple[int, int, int] = (255, 255, 255)
    background_share: float = 1.0
    alignment: str = "left"
    rotation_degrees: float = 0.0

    @property
    def synthetic_bold_width(self) -> int:
        return 1 if self.bold and self.family == "serif" else 0


@dataclass(frozen=True, slots=True)
class LineGeometry:
    center_x: float
    center_y: float
    width: int
    height: int
    angle_degrees: float


def _line_geometry(line: TextLine) -> LineGeometry:
    points = np.asarray(line.polygon, dtype=np.float32).reshape(4, 2)
    top_width = float(np.linalg.norm(points[1] - points[0]))
    bottom_width = float(np.linalg.norm(points[2] - points[3]))
    left_height = float(np.linalg.norm(points[3] - points[0]))
    right_height = float(np.linalg.norm(points[2] - points[1]))
    angle = math.degrees(
        math.atan2(
            float(points[1, 1] - points[0, 1]),
            float(points[1, 0] - points[0, 0]),
        )
    )
    while angle > 90:
        angle -= 180
    while angle < -90:
        angle += 180
    center = np.mean(points, axis=0)
    return LineGeometry(
        center_x=float(center[0]),
        center_y=float(center[1]),
        width=max(2, int(round((top_width + bottom_width) / 2))),
        height=max(2, int(round((left_height + right_height) / 2))),
        angle_degrees=angle,
    )


def _oriented_crop(image_bgr: np.ndarray, line: TextLine) -> np.ndarray:
    points = np.asarray(line.polygon, dtype=np.float32).reshape(4, 2)
    geometry = _line_geometry(line)
    target = np.array(
        [
            [0, 0],
            [geometry.width - 1, 0],
            [geometry.width - 1, geometry.height - 1],
            [0, geometry.height - 1],
        ],
        dtype=np.float32,
    )
    matrix = cv2.getPerspectiveTransform(points, target)
    return cv2.warpPerspective(
        image_bgr,
        matrix,
        (geometry.width, geometry.height),
        flags=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_REPLICATE,
    )


def _palette(rgb: np.ndarray, *, colors: int = 6) -> list[tuple[tuple[int, int, int], float]]:
    image = Image.fromarray(rgb)
    if image.width * image.height > 60_000:
        scale = math.sqrt(60_000 / (image.width * image.height))
        image = image.resize(
            (max(1, int(image.width * scale)), max(1, int(image.height * scale))),
            Image.Resampling.BILINEAR,
        )
    quantized = image.quantize(colors=colors, method=Image.Quantize.MEDIANCUT)
    counts = quantized.getcolors() or []
    raw_palette = quantized.getpalette() or []
    total = max(1, image.width * image.height)
    result: list[tuple[tuple[int, int, int], float]] = []
    for count, index in sorted(counts, reverse=True):
        offset = int(index) * 3
        if offset + 2 >= len(raw_palette):
            continue
        color = tuple(int(value) for value in raw_palette[offset : offset + 3])
        result.append((color, float(count) / total))
    return result


def _select_foreground_color(
    palette: list[tuple[tuple[int, int, int], float]],
    background_rgb: tuple[int, int, int],
) -> tuple[int, int, int] | None:
    background = np.asarray(background_rgb, dtype=np.float32)
    groups: list[dict[str, object]] = []
    for color, share in palette:
        contrast = float(
            np.linalg.norm(np.asarray(color, dtype=np.float32) - background)
        )
        if share < 0.006 or contrast < 18:
            continue
        hue, saturation, _value = colorsys.rgb_to_hsv(
            color[0] / 255,
            color[1] / 255,
            color[2] / 255,
        )
        hue_key = None if saturation < 0.14 else hue
        matched: dict[str, object] | None = None
        for group in groups:
            group_hue = group["hue"]
            if hue_key is None or group_hue is None:
                if hue_key is group_hue:
                    matched = group
                    break
                continue
            distance = abs(float(group_hue) - hue_key)
            distance = min(distance, 1.0 - distance)
            if distance <= 0.09:
                matched = group
                break
        if matched is None:
            matched = {"hue": hue_key, "members": []}
            groups.append(matched)
        members = matched["members"]
        assert isinstance(members, list)
        members.append((color, share, contrast))
    if not groups:
        return None

    def group_score(group: dict[str, object]) -> float:
        members = group["members"]
        assert isinstance(members, list)
        return sum(float(share) * float(contrast) for _color, share, contrast in members)

    winner = max(groups, key=group_score)
    winner_members = winner["members"]
    assert isinstance(winner_members, list)
    return max(
        winner_members,
        key=lambda item: float(item[2]) * math.sqrt(float(item[1])),
    )[0]


def _estimate_text_style(image_bgr: np.ndarray, line: TextLine) -> ImageTextStyle:
    height, width = image_bgr.shape[:2]
    rect = line.bbox.clipped(width, height)
    if rect.width < 2 or rect.height < 2:
        return ImageTextStyle()
    geometry = _line_geometry(line)
    crop_bgr = _oriented_crop(image_bgr, line)
    crop_rgb = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2RGB)
    palette = _palette(crop_rgb)
    if palette:
        background_rgb, background_share = palette[0]
    else:
        background_rgb = (255, 255, 255)
        background_share = 1.0

    background = np.asarray(background_rgb, dtype=np.float32)
    differences = np.linalg.norm(crop_rgb.astype(np.float32) - background, axis=2)
    scaled = np.clip(differences, 0, 255).astype(np.uint8)
    otsu_threshold, _ = cv2.threshold(
        scaled,
        0,
        255,
        cv2.THRESH_BINARY | cv2.THRESH_OTSU,
    )
    threshold = max(18.0, float(otsu_threshold) * 0.82)
    ink_mask = differences >= threshold
    if int(np.count_nonzero(ink_mask)) < max(4, geometry.width * geometry.height // 80):
        ink_mask = differences >= max(12.0, float(np.percentile(differences, 82)))

    foreground_rgb: tuple[int, int, int] | None = None
    ink_pixels = crop_rgb[ink_mask]
    if ink_pixels.size:
        ink_palette = _palette(ink_pixels.reshape(1, -1, 3), colors=8)
        foreground_rgb = _select_foreground_color(ink_palette, background_rgb)
        if foreground_rgb is not None:
            background_share = 1.0 - float(np.mean(ink_mask))

    if foreground_rgb is None:
        margin = max(3, min(12, geometry.height // 4))
        outer = rect.expanded(margin).clipped(width, height)
        outer_crop = image_bgr[outer.top : outer.bottom, outer.left : outer.right]
        ring_mask = np.ones(outer_crop.shape[:2], dtype=bool)
        inner_left = rect.left - outer.left
        inner_top = rect.top - outer.top
        ring_mask[
            inner_top : inner_top + rect.height,
            inner_left : inner_left + rect.width,
        ] = False
        ring_pixels = outer_crop[ring_mask]
        if ring_pixels.size:
            ring_rgb = tuple(
                int(round(value)) for value in np.median(ring_pixels, axis=0)[::-1]
            )
        else:
            ring_rgb = tuple(255 - value for value in background_rgb)
        if float(
            np.linalg.norm(
                np.asarray(background_rgb, dtype=np.float32)
                - np.asarray(ring_rgb, dtype=np.float32)
            )
        ) >= 18:
            foreground_rgb = background_rgb
            background_rgb = ring_rgb
            background_share = 0.0
        else:
            foreground_rgb = tuple(255 - value for value in background_rgb)
        background = np.asarray(background_rgb, dtype=np.float32)
        differences = np.linalg.norm(crop_rgb.astype(np.float32) - background, axis=2)
        ink_mask = differences >= 18.0

    binary = ink_mask.astype(np.uint8)
    ink_density = float(np.mean(binary))
    if 0 < np.count_nonzero(binary) < binary.size:
        distance = cv2.distanceTransform(binary, cv2.DIST_L2, 5)
        local_maximum = cv2.dilate(distance, np.ones((3, 3), dtype=np.float32))
        radii = distance[(distance >= local_maximum - 1e-4) & (distance > 0.5)]
    else:
        radii = np.empty(0, dtype=np.float32)
    if radii.size >= 4 and float(np.mean(radii)) > 0:
        radius_variation = float(np.std(radii) / np.mean(radii))
        normalized_radius = float(np.mean(radii) / max(1, geometry.height))
    else:
        radius_variation = 0.0
        normalized_radius = 0.0
    family = "serif" if geometry.height >= 16 and radius_variation >= 0.27 else "sans"
    bold = normalized_radius >= 0.052 or ink_density >= 0.32

    centered = (
        geometry.width >= width * 0.30
        and abs(geometry.center_x - width / 2) <= width * 0.13
    )
    if centered:
        alignment = "center"
    elif rect.right >= width * 0.94 and rect.left >= width * 0.55:
        alignment = "right"
    else:
        alignment = "left"
    return ImageTextStyle(
        family=family,
        bold=bold,
        foreground_rgb=foreground_rgb,
        background_rgb=background_rgb,
        background_share=background_share,
        alignment=alignment,
        rotation_degrees=geometry.angle_degrees,
    )


def _harmonize_parallel_text_colors(
    styled_lines: list[tuple[TextLine, str, ImageTextStyle]],
) -> list[tuple[TextLine, str, ImageTextStyle]]:
    harmonized: list[tuple[TextLine, str, ImageTextStyle]] = []
    for line, translated, style in styled_lines:
        geometry = _line_geometry(line)
        nearby: list[tuple[ImageTextStyle, int]] = []
        for other_line, _other_text, other_style in styled_lines:
            other_geometry = _line_geometry(other_line)
            if abs(geometry.angle_degrees - other_geometry.angle_degrees) > 6:
                continue
            background_distance = float(
                np.linalg.norm(
                    np.asarray(style.background_rgb, dtype=np.float32)
                    - np.asarray(other_style.background_rgb, dtype=np.float32)
                )
            )
            if background_distance > 42:
                continue
            reach = max(geometry.height, other_geometry.height) * 2
            if not line.bbox.expanded(reach).intersects(other_line.bbox):
                continue
            nearby.append((other_style, other_geometry.width))
        if len(nearby) >= 2:
            def color_score(candidate: ImageTextStyle) -> float:
                foreground = np.asarray(candidate.foreground_rgb, dtype=np.float32)
                background = np.asarray(candidate.background_rgb, dtype=np.float32)
                saturation = float(np.max(foreground) - np.min(foreground))
                contrast = float(np.linalg.norm(foreground - background))
                return saturation * 0.72 + contrast * 0.28

            def hue_distance(first: ImageTextStyle, second: ImageTextStyle) -> float:
                first_hue, first_saturation, _ = colorsys.rgb_to_hsv(
                    *(value / 255 for value in first.foreground_rgb)
                )
                second_hue, second_saturation, _ = colorsys.rgb_to_hsv(
                    *(value / 255 for value in second.foreground_rgb)
                )
                if first_saturation < 0.14 or second_saturation < 0.14:
                    return 1.0 if (first_saturation < 0.14) != (second_saturation < 0.14) else 0.0
                distance = abs(first_hue - second_hue)
                return min(distance, 1.0 - distance)

            representative, _weight = max(
                nearby,
                key=lambda item: sum(
                    other_width
                    for other_style, other_width in nearby
                    if hue_distance(item[0], other_style) <= 0.09
                ),
            )
            same_hue = [
                candidate
                for candidate, _candidate_width in nearby
                if hue_distance(representative, candidate) <= 0.09
            ]
            best = max(same_hue, key=color_score)
            style = replace(style, foreground_rgb=best.foreground_rgb)
        harmonized.append((line, translated, style))
    return harmonized


def _render_image(
    image_bgr: np.ndarray,
    translated_lines: list[tuple[TextLine, str]],
    target: Language,
) -> np.ndarray:
    height, width = image_bgr.shape[:2]
    styled_lines = _harmonize_parallel_text_colors(
        [
            (line, translated, _estimate_text_style(image_bgr, line))
            for line, translated in translated_lines
        ]
    )
    restored = image_bgr.copy()
    for line, _translated, style in styled_lines:
        geometry = _line_geometry(line)
        polygon = np.asarray(line.polygon, dtype=np.int32).reshape(-1, 2)
        line_mask = np.zeros((height, width), dtype=np.uint8)
        cv2.fillPoly(line_mask, [polygon], 255)
        dilation = max(3, min(11, geometry.height // 8 * 2 + 1))
        line_mask = cv2.dilate(
            line_mask,
            np.ones((dilation, dilation), dtype=np.uint8),
            iterations=1,
        )
        background_bgr = np.full_like(
            restored,
            style.background_rgb[::-1],
            dtype=np.uint8,
        )
        feather = cv2.GaussianBlur(
            line_mask,
            (0, 0),
            sigmaX=max(0.8, min(2.0, geometry.height * 0.025)),
        ).astype(np.float32)
        alpha = (feather / 255.0)[:, :, None]
        restored = np.clip(
            restored.astype(np.float32) * (1.0 - alpha)
            + background_bgr.astype(np.float32) * alpha,
            0,
            255,
        ).astype(np.uint8)
    image_rgb = cv2.cvtColor(restored, cv2.COLOR_BGR2RGB)
    canvas = Image.fromarray(image_rgb)

    for line, translated, style in styled_lines:
        geometry = _line_geometry(line)
        if geometry.width < 4 or geometry.height < 4:
            continue
        if "\n" in line.text:
            style = replace(
                style,
                alignment="left",
                rotation_degrees=0.0,
                family="sans",
                bold=False,
            )
        _draw_oriented_text(canvas, translated, geometry, target, style)
    return cv2.cvtColor(np.asarray(canvas), cv2.COLOR_RGB2BGR)


def _draw_oriented_text(
    canvas: Image.Image,
    text: str,
    geometry: LineGeometry,
    target: Language,
    style: ImageTextStyle,
) -> None:
    padding = max(3, min(10, geometry.height // 5))
    patch = Image.new(
        "RGBA",
        (geometry.width + padding * 2, geometry.height + padding * 2),
        (0, 0, 0, 0),
    )
    draw = ImageDraw.Draw(patch)
    rect = Rect(
        padding,
        padding,
        padding + geometry.width,
        padding + geometry.height,
    )
    font, lines = _fit_text(draw, text, rect, target, style)
    stroke_width = style.synthetic_bold_width
    spacing = max(1, int(font.size * 0.14))
    boxes = [
        draw.textbbox((0, 0), value, font=font, stroke_width=stroke_width)
        for value in lines
    ]
    line_heights = [box[3] - box[1] for box in boxes]
    total_height = sum(line_heights) + spacing * max(0, len(lines) - 1)
    y = rect.top + max(0, (rect.height - total_height) // 2)
    for value, box, line_height in zip(lines, boxes, line_heights, strict=True):
        line_width = box[2] - box[0]
        if style.alignment == "center":
            visible_left = rect.left + max(0, (rect.width - line_width) // 2)
        elif style.alignment == "right":
            visible_left = rect.right - line_width
        else:
            visible_left = rect.left
        draw.text(
            (visible_left - box[0], y - box[1]),
            value,
            font=font,
            fill=(*style.foreground_rgb, 255),
            stroke_width=stroke_width,
            stroke_fill=(*style.foreground_rgb, 255),
        )
        y += line_height + spacing
    rotated = patch.rotate(
        -style.rotation_degrees,
        resample=Image.Resampling.BICUBIC,
        expand=True,
    )
    left = int(round(geometry.center_x - rotated.width / 2))
    top = int(round(geometry.center_y - rotated.height / 2))
    canvas.paste(rotated, (left, top), rotated)


def _fit_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    rect: Rect,
    target: Language,
    style: ImageTextStyle,
) -> tuple[ImageFont.FreeTypeFont, list[str]]:
    stroke_width = style.synthetic_bold_width
    maximum = max(9, min(96, int(rect.height * 1.08)))
    if _prefer_single_line(text) or abs(style.rotation_degrees) >= 3:
        for size in range(maximum, 7, -1):
            font = _font(target, size, style)
            box = draw.textbbox((0, 0), text, font=font, stroke_width=stroke_width)
            if box[2] - box[0] <= rect.width and box[3] - box[1] <= rect.height:
                return font, [text]
    for size in range(maximum, 7, -1):
        font = _font(target, size, style)
        lines = _wrap_text(draw, text, font, rect.width, stroke_width)
        spacing = max(1, int(size * 0.14))
        boxes = [
            draw.textbbox((0, 0), value, font=font, stroke_width=stroke_width)
            for value in lines
        ]
        width = max((box[2] - box[0] for box in boxes), default=0)
        height = sum(box[3] - box[1] for box in boxes) + spacing * max(0, len(lines) - 1)
        if width <= rect.width and height <= rect.height:
            return font, lines
    font = _font(target, 8, style)
    return font, _wrap_text(draw, text, font, rect.width, stroke_width)


def _prefer_single_line(text: str) -> bool:
    visible = [character for character in text if not character.isspace()]
    if not visible:
        return False
    digit_count = sum(character.isdigit() for character in visible)
    schedule_marks = sum(character in ":/~～〜-–—()（）" for character in visible)
    return digit_count >= 6 and (digit_count + schedule_marks) / len(visible) >= 0.34


def _wrap_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.FreeTypeFont,
    maximum_width: int,
    stroke_width: int = 0,
) -> list[str]:
    if not text:
        return [""]
    lines: list[str] = []
    for paragraph in text.splitlines() or [text]:
        if not paragraph:
            if lines and lines[-1] != "":
                lines.append("")
            continue
        units = paragraph.split(" ") if " " in paragraph else list(paragraph)
        separator = " " if " " in paragraph else ""
        current = ""
        for unit in units:
            candidate = unit if not current else f"{current}{separator}{unit}"
            box = draw.textbbox(
                (0, 0), candidate, font=font, stroke_width=stroke_width
            )
            if current and box[2] - box[0] > maximum_width:
                lines.append(current)
                current = unit
            else:
                current = candidate
        if current:
            lines.append(current)
    return lines or [text]


def _font(
    target: Language,
    size: int,
    style: ImageTextStyle | None = None,
) -> ImageFont.FreeTypeFont:
    windows = Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts"
    style = style or ImageTextStyle()
    if style.family == "serif":
        names = {
            Language.KOREAN: ("batang.ttc", "malgun.ttf"),
            Language.JAPANESE: ("simsun.ttc", "batang.ttc", "msgothic.ttc"),
            Language.CHINESE_SIMPLIFIED: ("simsun.ttc", "msyh.ttc"),
            Language.CHINESE_TRADITIONAL: ("simsun.ttc", "msjh.ttc"),
            Language.ENGLISH: (
                "timesbd.ttf" if style.bold else "times.ttf",
                "georgiab.ttf" if style.bold else "georgia.ttf",
            ),
        }.get(target, ("times.ttf", "segoeui.ttf"))
    else:
        names = {
            Language.KOREAN: (
                "malgunbd.ttf" if style.bold else "malgun.ttf",
                "gulim.ttc",
            ),
            Language.JAPANESE: (
                "YuGothB.ttc" if style.bold else "YuGothM.ttc",
                "meiryob.ttc" if style.bold else "meiryo.ttc",
            ),
            Language.CHINESE_SIMPLIFIED: (
                "msyhbd.ttc" if style.bold else "msyh.ttc",
                "simsun.ttc",
            ),
            Language.CHINESE_TRADITIONAL: ("msjh.ttc", "msyh.ttc"),
            Language.ENGLISH: (
                "segoeuib.ttf" if style.bold else "segoeui.ttf",
                "arialbd.ttf" if style.bold else "arial.ttf",
            ),
        }.get(target, ("segoeui.ttf", "arial.ttf"))
    for name in names:
        path = windows / name
        if path.is_file():
            return ImageFont.truetype(str(path), size=size)
    return ImageFont.truetype("arial.ttf", size=size)
