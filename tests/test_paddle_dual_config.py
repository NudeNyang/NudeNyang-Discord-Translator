import sys
from types import ModuleType

import numpy as np

from discord_translate_overlay.models import Language, Rect, TextLine
from discord_translate_overlay.ocr.paddle_dual import PaddleDualOcr, _merge_text_lines


def test_detector_preserves_small_discord_text_on_wide_chat_frames(monkeypatch) -> None:
    calls: list[tuple[str, dict[str, object]]] = []

    def text_detection(*, model_name: str, **kwargs):
        calls.append((model_name, kwargs))
        return object()

    def text_recognition(*, model_name: str, **kwargs):
        calls.append((model_name, kwargs))
        return object()

    paddleocr = ModuleType("paddleocr")
    paddleocr.TextDetection = text_detection
    paddleocr.TextRecognition = text_recognition
    monkeypatch.setitem(sys.modules, "paddleocr", paddleocr)

    PaddleDualOcr(device="cpu")

    detector_name, detector_options = calls[0]
    assert detector_name == "PP-OCRv6_small_det"
    assert detector_options["limit_side_len"] == 1536


def _line(text: str, polygon: list[list[float]], confidence: float) -> TextLine:
    points = np.asarray(polygon, dtype=np.float32)
    xs, ys = points[:, 0], points[:, 1]
    return TextLine(
        points,
        Rect(int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())),
        text,
        confidence,
        Language.JAPANESE,
    )


def test_enhanced_ocr_merge_keeps_parallel_missing_line_and_drops_duplicate() -> None:
    primary = _line(
        "ねこねこVRアイドル！",
        [[10, 150], [355, 3], [376, 51], [31, 198]],
        0.78,
    )
    duplicate = _line(
        "ねこねこVRアイドル!",
        [[8, 149], [356, 0], [378, 52], [30, 201]],
        0.80,
    )
    missing_parallel_line = _line(
        "ねこーっっ",
        [[20, 80], [205, 14], [222, 62], [37, 129]],
        0.61,
    )
    nested_fragment = _line(
        "一",
        [[100, 62], [167, 42], [173, 62], [106, 82]],
        0.49,
    )

    merged = _merge_text_lines(
        [primary, nested_fragment],
        [duplicate, missing_parallel_line],
    )

    assert [line.text for line in merged] == ["ねこーっっ", "ねこねこVRアイドル！"]


def test_enhanced_ocr_merge_prefers_complete_high_confidence_nested_line() -> None:
    oversized_wrong = _line(
        "隔遍金日",
        [[280, 640], [690, 640], [690, 830], [280, 830]],
        0.49,
    )
    tiny_fragment = _line(
        "金",
        [[430, 675], [560, 675], [560, 765], [430, 765]],
        0.50,
    )
    complete = _line(
        "隔週金曜日",
        [[310, 720], [665, 720], [665, 810], [310, 810]],
        0.65,
    )

    merged = _merge_text_lines([oversized_wrong, tiny_fragment, complete], [])

    assert [line.text for line in merged] == ["隔週金曜日"]
