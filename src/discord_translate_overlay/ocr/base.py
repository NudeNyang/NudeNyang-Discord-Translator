from __future__ import annotations

from abc import ABC, abstractmethod

import numpy as np

from ..models import TextLine


class OcrEngine(ABC):
    @abstractmethod
    def recognize(self, image_bgr: np.ndarray) -> list[TextLine]:
        """Detect and recognize every text line in an image."""
