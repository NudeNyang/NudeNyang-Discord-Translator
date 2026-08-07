import numpy as np

from discord_translate_overlay.capture.change_detector import ChangeDetector


def test_only_changed_frames_are_reported() -> None:
    detector = ChangeDetector(threshold=0.01, pixel_delta=5)
    first = np.zeros((200, 300, 3), dtype=np.uint8)
    assert detector.compare(first).changed
    assert not detector.compare(first.copy()).changed
    changed = first.copy()
    changed[80:130, 100:250] = 255
    result = detector.compare(changed)
    assert result.changed
    assert result.ratio > 0.01
    assert result.regions


def test_hash_is_stable() -> None:
    detector = ChangeDetector()
    frame = np.full((64, 64, 3), 70, dtype=np.uint8)
    assert detector.compare(frame).perceptual_hash == detector.compare(frame).perceptual_hash
