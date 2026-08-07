from __future__ import annotations

import cv2
import numpy as np

from discord_translate_overlay.experimental_dom.image_translation import (
    IMAGE_UI_SCRIPT,
    ImageTranslationProcessor,
    apply_image_result_script,
    fetch_image_data_script,
    image_capture_info_script,
    restore_images_script,
)
from discord_translate_overlay.models import Language, Rect, TextLine


class FakeOcr:
    def __init__(self) -> None:
        self.calls = 0

    def recognize(self, image_bgr: np.ndarray) -> list[TextLine]:
        self.calls += 1
        polygon = np.array([[10, 8], [118, 8], [118, 38], [10, 38]], dtype=np.float32)
        return [
            TextLine(
                polygon=polygon,
                bbox=Rect(10, 8, 118, 38),
                text="こんにちは",
                confidence=0.94,
                language=Language.JAPANESE,
            )
        ]


def _png_bytes() -> bytes:
    image = np.full((80, 160, 3), 232, dtype=np.uint8)
    cv2.rectangle(image, (10, 8), (118, 38), (30, 30, 30), thickness=-1)
    ok, encoded = cv2.imencode(".png", image)
    assert ok
    return encoded.tobytes()


def test_image_processor_replaces_text_and_reuses_render_cache(tmp_path) -> None:
    ocr = FakeOcr()
    translated: list[str] = []

    def translate(text: str, target: Language) -> str:
        translated.append(text)
        assert target is Language.KOREAN
        return "안녕하세요"

    processor = ImageTranslationProcessor(lambda: ocr, cache_dir=tmp_path)
    source = _png_bytes()

    first = processor.process(
        source,
        Language.KOREAN,
        translator_namespace="test-translator:v1",
        translate=translate,
    )
    second = processor.process(
        source,
        Language.KOREAN,
        translator_namespace="test-translator:v1",
        translate=translate,
    )

    assert first.translated_count == 1
    assert first.png_bytes != source
    assert first.used_cache is False
    assert second.png_bytes == first.png_bytes
    assert second.used_cache is True
    assert ocr.calls == 1
    assert translated == ["こんにちは"]


def test_image_processor_keeps_original_when_ocr_finds_nothing(tmp_path) -> None:
    class EmptyOcr:
        def recognize(self, _image_bgr: np.ndarray) -> list[TextLine]:
            return []

    processor = ImageTranslationProcessor(lambda: EmptyOcr(), cache_dir=tmp_path)
    source = _png_bytes()
    result = processor.process(
        source,
        Language.KOREAN,
        translator_namespace="test-translator:v1",
        translate=lambda text, _target: text,
    )

    assert result.png_bytes == source
    assert result.translated_count == 0
    assert result.used_cache is False


def test_image_dom_scripts_replace_the_img_without_external_overlay() -> None:
    assert "const uiVersion = 'image-ui-v6'" in IMAGE_UI_SCRIPT
    assert "data-dto-image-id" in IMAGE_UI_SCRIPT
    assert "closest('[id^=\"chat-messages-\"]')" in IMAGE_UI_SCRIPT
    assert "function isMediaViewerImage" in IMAGE_UI_SCRIPT
    assert "document.querySelectorAll('img')" in IMAGE_UI_SCRIPT
    assert "이미지 번역" in IMAGE_UI_SCRIPT
    assert "window.__dtoImageTranslationRequests" in IMAGE_UI_SCRIPT
    assert "번역이 꺼져 있습니다" in IMAGE_UI_SCRIPT
    assert "if (!window.__dtoImageTranslationEnabled) return false" not in IMAGE_UI_SCRIPT
    assert "window.__dtoImageUiVersion" in IMAGE_UI_SCRIPT
    assert "new AbortController()" in IMAGE_UI_SCRIPT
    assert "dto-image-translate-button')?.remove()" in IMAGE_UI_SCRIPT
    assert "document.querySelectorAll('img[data-dto-original-src]')" in IMAGE_UI_SCRIPT
    assert "window.__dtoTranslatedImageBySource = {};" in IMAGE_UI_SCRIPT
    assert "document.elementsFromPoint(x, y)" in IMAGE_UI_SCRIPT
    assert "'pointermove'" in IMAGE_UI_SCRIPT
    assert "window.__dtoTranslatedImageBySource" in IMAGE_UI_SCRIPT
    assert "imageSourceKey" in IMAGE_UI_SCRIPT
    assert "Math.min(innerHeight, rect.bottom)" in IMAGE_UI_SCRIPT
    assert "button.offsetHeight" in IMAGE_UI_SCRIPT
    assert "updateButton(img);\n      button.style.display = 'none';" not in IMAGE_UI_SCRIPT

    capture = image_capture_info_script("dto-image-7")
    assert 'data-dto-image-id="${CSS.escape(imageId)}"' in capture
    assert "fullyVisible" in capture

    fetched = fetch_image_data_script("dto-image-7")
    assert "await fetch(" in fetched
    assert "FileReader" in fetched

    applied = apply_image_result_script("dto-image-7", "data:image/png;base64,AAAA")
    assert "img.src = translatedSrc" in applied
    assert "data:image/png;base64,AAAA" in applied
    assert "createElement('canvas')" not in applied
    assert "await preload.decode()" in applied
    assert "window.__dtoTranslatedImageBySource" in applied
    assert "button.textContent = '원문 보기'" in applied

    restored = restore_images_script(discard=False)
    assert "dtoOriginalSrc" in restored
    assert "dtoImageStatus = 'paused'" in restored

    discarded = restore_images_script(discard=True)
    assert "delete img.dataset.dtoTranslatedSrc" in discarded
    assert "window.__dtoTranslatedImageBySource = {}" in discarded
    assert "__dtoImageUiInstalled = false" not in discarded
    assert "dto-image-translate-button')?.remove" not in discarded
