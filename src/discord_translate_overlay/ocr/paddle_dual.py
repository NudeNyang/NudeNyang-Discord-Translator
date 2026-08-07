from __future__ import annotations

import os
import site
import sys
from typing import Any

import cv2
import numpy as np

from ..language import CandidateSelector
from ..models import RecognitionCandidate, Rect, TextLine
from .base import OcrEngine

_DLL_HANDLES: list[Any] = []


def _result_payload(result: Any) -> dict[str, Any]:
    """Normalize PaddleX result objects across PaddleOCR 3.x patch releases."""
    if isinstance(result, dict):
        return result.get("res", result)
    json_value = getattr(result, "json", None)
    if callable(json_value):
        json_value = json_value()
    if isinstance(json_value, dict):
        return json_value.get("res", json_value)
    data = getattr(result, "res", None)
    if isinstance(data, dict):
        return data
    try:
        mapped = dict(result)
        return mapped.get("res", mapped)
    except (TypeError, ValueError):
        raise TypeError(f"Unsupported PaddleOCR result type: {type(result)!r}") from None


def _perspective_crop(image: np.ndarray, polygon: np.ndarray) -> np.ndarray:
    points = np.asarray(polygon, dtype=np.float32).reshape(4, 2)
    width = max(
        int(np.linalg.norm(points[0] - points[1])),
        int(np.linalg.norm(points[2] - points[3])),
        2,
    )
    height = max(
        int(np.linalg.norm(points[0] - points[3])),
        int(np.linalg.norm(points[1] - points[2])),
        2,
    )
    target = np.array([[0, 0], [width, 0], [width, height], [0, height]], dtype=np.float32)
    matrix = cv2.getPerspectiveTransform(points, target)
    return cv2.warpPerspective(
        image,
        matrix,
        (width, height),
        flags=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_REPLICATE,
    )


class PaddleDualOcr(OcrEngine):
    """One PP-OCRv6 detector feeding v6-small and Korean-v5 recognizers."""

    def __init__(
        self,
        device: str = "cpu",
        *,
        model_source: str = "BOS",
        enhance_colored_text: bool = False,
    ) -> None:
        # BOS is more reliable from Windows networks and is an official model mirror.
        os.environ.setdefault("PADDLE_PDX_MODEL_SOURCE", model_source)
        os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
        _configure_nvidia_dlls()
        try:
            from paddleocr import TextDetection, TextRecognition
        except ImportError as exc:
            raise RuntimeError(
                "PaddleOCR이 없어. GPU는 'uv sync --extra ocr-gpu', "
                "CPU는 'uv sync --extra ocr-cpu'를 실행해줘."
            ) from exc

        # Paddle 3.3.1's Windows oneDNN executor cannot convert an array attribute
        # used by PP-OCRv6. Regular CPU kernels are stable on the same model.
        resolved_device = None if device == "auto" else device
        common = {"device": resolved_device, "enable_mkldnn": False}
        # Paddle's 960px default shrinks a 2040px-wide Discord chat enough to
        # completely miss normal 16-20px message rows. 1536 keeps small text
        # detectable while staying materially cheaper than full-resolution OCR.
        self.detector = TextDetection(
            model_name="PP-OCRv6_small_det",
            limit_side_len=1536,
            **common,
        )
        self.v6_recognizer = TextRecognition(model_name="PP-OCRv6_small_rec", **common)
        self.ko_recognizer = TextRecognition(model_name="korean_PP-OCRv5_mobile_rec", **common)
        self.selector = CandidateSelector()
        self.enhance_colored_text = enhance_colored_text

    def recognize(self, image_bgr: np.ndarray) -> list[TextLine]:
        primary = self._recognize_once(image_bgr)
        if not self.enhance_colored_text:
            return primary
        channel_range = image_bgr.max(axis=2) - image_bgr.min(axis=2)
        if float(np.mean(channel_range >= 45)) < 0.01:
            return primary
        minimum_channel = image_bgr.min(axis=2).astype(np.uint8)
        enhanced = cv2.cvtColor(minimum_channel, cv2.COLOR_GRAY2BGR)
        secondary = self._recognize_once(enhanced)
        return _merge_text_lines(primary, secondary)

    def _recognize_once(self, image_bgr: np.ndarray) -> list[TextLine]:
        detection_results = list(self.detector.predict(input=image_bgr, batch_size=1))
        if not detection_results:
            return []
        payload = _result_payload(detection_results[0])
        polygons = [np.asarray(p, dtype=np.float32) for p in payload.get("dt_polys", [])]
        detection_scores = list(payload.get("dt_scores", [1.0] * len(polygons)))
        if not polygons:
            return []
        ordered = sorted(
            zip(polygons, detection_scores, strict=True),
            key=lambda item: (float(item[0][:, 1].min()), float(item[0][:, 0].min())),
        )
        polygons = [item[0] for item in ordered]
        detection_scores = [item[1] for item in ordered]

        crops = [_perspective_crop(image_bgr, p) for p in polygons]
        v6_results = list(self.v6_recognizer.predict(input=crops, batch_size=min(16, len(crops))))
        ko_results = list(self.ko_recognizer.predict(input=crops, batch_size=min(16, len(crops))))

        lines: list[TextLine] = []
        for polygon, det_score, v6_raw, ko_raw in zip(
            polygons, detection_scores, v6_results, ko_results, strict=True
        ):
            v6 = _result_payload(v6_raw)
            ko = _result_payload(ko_raw)
            candidates = [
                RecognitionCandidate(
                    "PP-OCRv6-small",
                    str(v6.get("rec_text", "")),
                    float(v6.get("rec_score", 0.0)),
                ),
                RecognitionCandidate(
                    "korean_PP-OCRv5-mobile",
                    str(ko.get("rec_text", "")),
                    float(ko.get("rec_score", 0.0)),
                ),
            ]
            best, language = self.selector.choose(candidates)
            xs, ys = polygon[:, 0], polygon[:, 1]
            bbox = Rect(int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()))
            lines.append(
                TextLine(
                    polygon=polygon,
                    bbox=bbox,
                    text=best.text.strip(),
                    confidence=min(float(det_score), best.confidence),
                    language=language,
                    candidates=tuple(candidates),
                )
            )
        return sorted(lines, key=lambda line: (line.bbox.top, line.bbox.left))


def _polygon_overlap_ratio(smaller: TextLine, larger: TextLine) -> float:
    small_polygon = np.asarray(smaller.polygon, dtype=np.float32).reshape(-1, 2)
    large_polygon = np.asarray(larger.polygon, dtype=np.float32).reshape(-1, 2)
    small_area = abs(float(cv2.contourArea(small_polygon)))
    if small_area <= 0:
        return 0.0
    intersection, _ = cv2.intersectConvexConvex(small_polygon, large_polygon)
    return max(0.0, float(intersection)) / small_area


def _merge_text_lines(
    primary: list[TextLine],
    enhanced: list[TextLine],
) -> list[TextLine]:
    merged = list(primary)
    for candidate in enhanced:
        candidate_area = abs(float(cv2.contourArea(candidate.polygon)))
        duplicate = False
        for existing in merged:
            existing_area = abs(float(cv2.contourArea(existing.polygon)))
            area_ratio = min(candidate_area, existing_area) / max(
                candidate_area,
                existing_area,
                1.0,
            )
            smaller, larger = (
                (candidate, existing)
                if candidate_area <= existing_area
                else (existing, candidate)
            )
            overlap = _polygon_overlap_ratio(smaller, larger)
            same_detection = overlap >= 0.72 and area_ratio >= 0.55
            contained_candidate = candidate_area <= existing_area and overlap >= 0.72
            if same_detection or contained_candidate:
                duplicate = True
                break
        if not duplicate:
            merged.append(candidate)

    kept: list[TextLine] = []
    for candidate in merged:
        candidate_area = abs(float(cv2.contourArea(candidate.polygon)))
        nested = False
        for other in merged:
            if other is candidate:
                continue
            other_area = abs(float(cv2.contourArea(other.polygon)))
            candidate_units = sum(character.isalnum() for character in candidate.text)
            other_units = sum(character.isalnum() for character in other.text)
            if (
                other_area >= candidate_area * 1.8
                and _polygon_overlap_ratio(candidate, other) >= 0.72
                and (
                    other.confidence >= candidate.confidence
                    or candidate_units <= max(2, round(other_units * 0.42))
                )
            ):
                nested = True
                break
            if (
                candidate_area >= other_area * 1.8
                and _polygon_overlap_ratio(other, candidate) >= 0.72
                and other.confidence >= candidate.confidence + 0.08
                and other_units >= candidate_units
            ):
                nested = True
                break
        if not nested:
            kept.append(candidate)
    return sorted(
        kept,
        key=lambda line: (
            float(np.mean(np.asarray(line.polygon)[:, 1])),
            float(np.mean(np.asarray(line.polygon)[:, 0])),
        ),
    )


def _configure_nvidia_dlls() -> None:
    """Expose pip-installed CUDA runtime DLLs to Paddle on Windows."""
    if os.name != "nt" or not hasattr(os, "add_dll_directory"):
        return
    roots = [*site.getsitepackages(), site.getusersitepackages()]
    if getattr(sys, "frozen", False):
        roots.extend(
            [
                str(getattr(sys, "_MEIPASS", "")),
                os.path.dirname(sys.executable),
            ]
        )
    packages = ("cublas", "cuda_runtime", "cuda_nvrtc", "cudnn")
    for root in roots:
        for package in packages:
            directory = os.path.join(root, "nvidia", package, "bin")
            if os.path.isdir(directory):
                _DLL_HANDLES.append(os.add_dll_directory(directory))
                os.environ["PATH"] = directory + os.pathsep + os.environ.get("PATH", "")
