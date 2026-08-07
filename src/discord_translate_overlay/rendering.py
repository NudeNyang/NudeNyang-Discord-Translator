from __future__ import annotations

import numpy as np

from .models import Message, Rect, RenderInlineMedia
from .ocr.message_grouper import COMPOSED_INLINE_MEDIA_ENGINE


def attach_message_surfaces(frame_bgr: np.ndarray, messages: list[Message]) -> None:
    """Attach the local Discord surface color used behind every text group.

    Discord uses different colors for the normal chat surface, hovered rows and
    embeds. A single theme color therefore leaves visible rectangular patches.
    Sampling narrow strips around the glyph box preserves the actual local
    surface without treating bright text pixels as background.
    """

    for message in messages:
        sampled = _sample_surface(frame_bgr, message.bbox)
        if sampled is not None:
            message.render_background_rgb = sampled
        message.render_inline_media = _capture_inline_media(frame_bgr, message)


def _capture_inline_media(
    frame_bgr: np.ndarray,
    message: Message,
) -> tuple[RenderInlineMedia, ...]:
    if frame_bgr.size == 0:
        return ()
    height, width = frame_bgr.shape[:2]
    snapshots: list[RenderInlineMedia] = []
    seen: set[tuple[int, int, int, int]] = set()
    for line in message.lines:
        for candidate in line.candidates:
            if candidate.engine != COMPOSED_INLINE_MEDIA_ENGINE:
                continue
            coordinates, _separator, alt_text = candidate.text.partition("|")
            try:
                left, top, right, bottom = (
                    int(value) for value in coordinates.split(",", maxsplit=3)
                )
            except (TypeError, ValueError):
                continue
            box = Rect(left, top, right, bottom).clipped(width, height)
            key = (box.left, box.top, box.right, box.bottom)
            if not box.area or key in seen:
                continue
            # Inline emoji are small. Reject large image/link rectangles if a
            # future Discord accessibility class happens to be misclassified.
            if box.width > 128 or box.height > 128:
                continue
            pixels = np.ascontiguousarray(
                frame_bgr[box.top : box.bottom, box.left : box.right, :3]
            )
            if not pixels.size:
                continue
            seen.add(key)
            snapshots.append(
                RenderInlineMedia(
                    bbox=box,
                    width=box.width,
                    height=box.height,
                    bgr=pixels.tobytes(),
                    alt_text=alt_text,
                )
            )
    snapshots.sort(key=lambda item: (item.bbox.top, item.bbox.left))
    return tuple(snapshots)


def _sample_surface(
    frame_bgr: np.ndarray, bbox: Rect
) -> tuple[int, int, int] | None:
    if frame_bgr.size == 0:
        return None
    height, width = frame_bgr.shape[:2]
    box = bbox.clipped(width, height)
    if not box.area:
        box = bbox.expanded(10, 8).clipped(width, height)
    if not box.area:
        return None

    strips = [
        Rect(box.right + 2, box.top, box.right + 14, box.bottom).clipped(width, height),
        Rect(box.left - 14, box.top, box.left - 2, box.bottom).clipped(width, height),
        Rect(box.left, box.top - 5, box.right, box.top - 1).clipped(width, height),
        Rect(box.left, box.bottom + 1, box.right, box.bottom + 5).clipped(width, height),
    ]
    samples = [
        frame_bgr[item.top : item.bottom, item.left : item.right].reshape(-1, 3)
        for item in strips
        if item.area
    ]
    if not samples:
        samples = [frame_bgr[box.top : box.bottom, box.left : box.right].reshape(-1, 3)]
    pixels = np.concatenate(samples, axis=0)
    if not len(pixels):
        return None

    # Discord surfaces are nearly flat. A 4-level color bucket finds that mode
    # while rejecting antialiased glyphs, emoji colors and display noise.
    buckets = pixels.astype(np.uint32) // 4
    packed = buckets[:, 0] * 4096 + buckets[:, 1] * 64 + buckets[:, 2]
    keys, counts = np.unique(packed, return_counts=True)
    dominant = keys[int(np.argmax(counts))]
    selected = pixels[packed == dominant]
    bgr = np.median(selected, axis=0).round().astype(int)
    return int(bgr[2]), int(bgr[1]), int(bgr[0])
