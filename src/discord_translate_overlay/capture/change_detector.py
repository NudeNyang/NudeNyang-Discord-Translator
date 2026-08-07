from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from ..models import Rect


@dataclass(frozen=True, slots=True)
class ChangeResult:
    changed: bool
    ratio: float
    regions: tuple[Rect, ...]
    perceptual_hash: str


class ChangeDetector:
    def __init__(self, threshold: float = 0.015, pixel_delta: int = 18) -> None:
        self.threshold = threshold
        self.pixel_delta = pixel_delta
        self._previous_gray: np.ndarray | None = None

    def compare(self, frame_bgr: np.ndarray) -> ChangeResult:
        gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
        small = cv2.resize(gray, (max(16, gray.shape[1] // 4), max(16, gray.shape[0] // 4)))
        digest = self._dhash(small)
        if self._previous_gray is None or self._previous_gray.shape != small.shape:
            self._previous_gray = small
            return ChangeResult(
                True, 1.0, (Rect(0, 0, frame_bgr.shape[1], frame_bgr.shape[0]),), digest
            )

        diff = cv2.absdiff(self._previous_gray, small)
        mask = (diff >= self.pixel_delta).astype(np.uint8) * 255
        ratio = float(np.count_nonzero(mask)) / mask.size
        self._previous_gray = small
        if ratio < self.threshold:
            return ChangeResult(False, ratio, (), digest)

        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 3))
        merged = cv2.dilate(mask, kernel, iterations=2)
        contours, _ = cv2.findContours(merged, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        scale_x = frame_bgr.shape[1] / small.shape[1]
        scale_y = frame_bgr.shape[0] / small.shape[0]
        regions: list[Rect] = []
        for contour in contours:
            x, y, width, height = cv2.boundingRect(contour)
            if width * height < 12:
                continue
            regions.append(
                Rect(
                    int(x * scale_x),
                    int(y * scale_y),
                    min(frame_bgr.shape[1], int((x + width) * scale_x)),
                    min(frame_bgr.shape[0], int((y + height) * scale_y)),
                )
                .expanded(12)
                .clipped(frame_bgr.shape[1], frame_bgr.shape[0])
            )
        return ChangeResult(True, ratio, tuple(regions), digest)

    @staticmethod
    def _dhash(gray: np.ndarray) -> str:
        sample = cv2.resize(gray, (17, 16), interpolation=cv2.INTER_AREA)
        bits = sample[:, 1:] > sample[:, :-1]
        packed = np.packbits(bits.flatten())
        return packed.tobytes().hex()

    def reset(self) -> None:
        self._previous_gray = None
