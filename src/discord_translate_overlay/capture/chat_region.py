from __future__ import annotations

import numpy as np

from ..models import Rect


def detect_chat_region(frame_bgr: np.ndarray) -> Rect:
    """Infer Discord's message pane from stable vertical panel boundaries.

    Discord themes use large, nearly solid panels. Median column colors suppress
    avatars, text and attachments, leaving the channel/chat boundary and optional
    member-list divider visible without relying on DOM or client internals.
    """
    height, width = frame_bgr.shape[:2]
    body = frame_bgr[max(1, int(height * 0.06)) : max(2, int(height * 0.94))].astype(np.int16)
    horizontal_delta = np.linalg.norm(body[:, 1:] - body[:, :-1], axis=2)
    # Panel boundaries span almost the entire client height. Attachment/card edges
    # only span part of it, even if they dominate a median color profile.
    persistence = (horizontal_delta > 6).mean(axis=0)

    # Compact/channel sidebars can occupy only about 10% on wide or high-DPI
    # Discord windows. Start after the server-icon rail, not at a desktop-like
    # fixed 16%, or the real channel/chat divider is excluded from the search.
    left_start, left_end = int(width * 0.06), int(width * 0.46)
    strong_left = np.flatnonzero(persistence[left_start:left_end] >= 0.80) + left_start
    if len(strong_left):
        # The first strong edge is often the server rail/channel-list divider;
        # the rightmost *near-solid* edge is the channel-list/message-pane
        # divider. A long announcement can also create an 80%-persistent text
        # indent, so prefer near-solid panel edges before taking the rightmost.
        near_solid = strong_left[persistence[strong_left] >= 0.94]
        candidates = near_solid if len(near_solid) else strong_left
        left = int(candidates[-1]) + 1
    else:
        left = round(width * 0.29)

    right_start, right_end = max(left + 100, int(width * 0.60)), int(width * 0.94)
    right_index = int(np.argmax(persistence[right_start:right_end])) + right_start
    right_score = float(persistence[right_index])
    right = right_index + 1
    if right_score < 0.80:
        right = round(width * 0.985)

    top = round(height * 0.044)
    bottom = round(height * 0.965)
    if right - left < width * 0.28:
        right = round(width * 0.985)
    return Rect(left, top, right, bottom)
