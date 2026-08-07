from __future__ import annotations

import re
import unicodedata
from statistics import median

import numpy as np

from ..language import detect_explicit_language
from ..models import Language, Message, RecognitionCandidate, Rect, TextLine, union_rect

TIME_RE = re.compile(
    r"(?:today|yesterday|오늘|어제|本日|昨日|오전|오후|am|pm|午前|午後)?\s*"
    # OCR often reads Discord's ':' as ';' on small timestamp text.
    r"(?:at\s*)?\d{1,2}[:.;]\d{2}",
    re.IGNORECASE,
)
TIME_ONLY_RE = re.compile(
    r"^(?:(?:today|yesterday|오늘|어제|本日|昨日)\s*)?"
    r"(?:(?:at|오전|오후|am|pm|午前|午後)\s*)?\d{1,2}[:.;]\d{2}$",
    re.IGNORECASE,
)
DATE_RE = re.compile(r"(?:20\d{2}[-./년]\s*\d{1,2}[-./월]\s*\d{1,2}|\d{1,2}月\d{1,2}日)")
URL_RE = re.compile(r"(?:https?://|www\.)", re.IGNORECASE)
URL_TOKEN_RE = re.compile(r"(?:https?://|www\.)\S+", re.IGNORECASE)
LEADING_LATIN_MENTION_RE = re.compile(r"^@[A-Za-z0-9_.-]+")
PROTECTED_PREFIX_ENGINE = "layout-protected-prefix"
INLINE_MEDIA_ENGINE = "layout-inline-media"
COMPOSED_INLINE_MEDIA_ENGINE = f"{INLINE_MEDIA_ENGINE}:emoji"
PRESERVED_INLINE_ENGINE = "layout-preserved-inline"
CHAT_SURFACE_COLOR_DISTANCE = 34


def _looks_like_metadata(line: TextLine, image_width: int) -> bool:
    text = line.text.strip()
    if _looks_like_timestamp_line(text) or URL_RE.search(text) or text.startswith(("#", "@")):
        return True
    if not DATE_RE.search(text):
        return False

    # Discord's date separators are short and centered. A date at the start of a
    # normal left-aligned sentence is message content and must remain translatable.
    center = (line.bbox.left + line.bbox.right) / 2
    centered = abs(center - image_width / 2) <= max(30, image_width * 0.12)
    separator_sized = line.bbox.width <= image_width * 0.45
    return centered and separator_sized


def _looks_like_timestamp_line(text: str) -> bool:
    if TIME_ONLY_RE.fullmatch(text):
        return True
    # A Discord username/date row ends at its timestamp. Event announcements
    # can contain the same date and time in the middle of a normal sentence.
    return bool(
        DATE_RE.search(text)
        and TIME_RE.search(text)
        and re.search(
            r"(?:오전|오후|am|pm|午前|午後)?\s*\d{1,2}[:.;]\d{2}\s*$",
            text,
            re.IGNORECASE,
        )
    )


def group_message_lines(
    lines: list[TextLine], image_width: int, image_bgr: np.ndarray | None = None
) -> list[Message]:
    """Group OCR text lines while excluding likely usernames/timestamps.

    Discord does not expose message semantics to a screen-only application. This
    deliberately conservative heuristic only overlays body-like lines and leaves
    metadata untouched. The user-adjustable chat crop is the second safety rail.
    """
    # Preserve the actual clickable URL pixels, but keep a human-language label
    # immediately before one URL (for example "参加先 https://...") translatable.
    lines = [
        _text_prefix_before_url(_text_after_leading_mention(line)) for line in lines
    ]
    metadata_bands = []
    for line in lines:
        if not _looks_like_metadata(line, image_width):
            continue
        metadata_bands.append((line.bbox.top - 3, line.bbox.bottom + 3))
    background = _dominant_background(image_bgr) if image_bgr is not None else None
    content_left_candidates = [
        line.bbox.left
        for line in lines
        if line.text.strip()
        and line.confidence >= 0.35
        and line.bbox.width >= 8
        and not _looks_like_metadata(line, image_width)
        and (
            image_bgr is None
            or background is None
            or _on_chat_surface(line.bbox, image_bgr, background)
        )
    ]
    content_left = min(content_left_candidates) if content_left_candidates else 0
    usable = [
        line
        for line in lines
        if line.text.strip()
        and line.confidence >= 0.35
        and line.bbox.width >= 8
        and not _looks_like_metadata(line, image_width)
        and not any(
            top <= (line.bbox.top + line.bbox.bottom) / 2 <= bottom
            for top, bottom in metadata_bands
        )
        and (
            image_bgr is None
            or background is None
            or (
                _on_chat_surface(line.bbox, image_bgr, background)
                and not _is_colored_label(line.bbox, image_bgr, background)
            )
        )
    ]
    if not usable:
        return []

    usable = _merge_visual_rows(usable)
    typical_height = median(max(1, line.bbox.height) for line in usable)
    max_join_gap = max(5, int(typical_height * 0.75))
    indent_tolerance = max(24, image_width // 25)
    groups: list[list[TextLine]] = []
    for line in usable:
        if not groups:
            groups.append([line])
            continue
        previous = groups[-1][-1]
        vertical_gap = line.bbox.top - previous.bbox.bottom
        previous_indent = (
            content_left
            if previous.bbox.left - content_left > indent_tolerance
            else previous.bbox.left
        )
        line_indent = (
            content_left if line.bbox.left - content_left > indent_tolerance else line.bbox.left
        )
        same_indent = abs(line_indent - previous_indent) <= indent_tolerance
        if -3 <= vertical_gap <= max_join_gap and same_indent:
            groups[-1].append(line)
        else:
            groups.append([line])

    messages: list[Message] = []
    for group in groups:
        source_text = "\n".join(line.text for line in group)
        languages = [line.language for line in group if line.language is not Language.UNKNOWN]
        explicit_language = detect_explicit_language(source_text)
        language = (
            explicit_language
            if explicit_language is not Language.UNKNOWN
            else max(set(languages), key=languages.count)
            if languages
            else Language.UNKNOWN
        )
        bbox = union_rect(line.bbox for line in group).expanded(3, 2)
        stable_left = max(0, content_left - 3)
        protected_prefix = any(
            candidate.engine == PROTECTED_PREFIX_ENGINE
            for line in group
            for candidate in line.candidates
        )
        if not protected_prefix and bbox.left - stable_left > indent_tolerance:
            bbox = Rect(stable_left, bbox.top, bbox.right, bbox.bottom)
        message = Message(
            bbox=Rect(bbox.left, bbox.top, min(image_width, bbox.right), bbox.bottom),
            source_text=source_text,
            source_language=language,
            confidence=sum(line.confidence for line in group) / len(group),
            lines=group,
        )
        message.ensure_id()
        messages.append(message)
    return messages


def _text_prefix_before_url(line: TextLine) -> TextLine:
    text = line.text.strip()
    matches = list(URL_TOKEN_RE.finditer(text))
    if len(matches) != 1:
        return line
    match = matches[0]
    prefix = text[: match.start()].rstrip(" \t:：|｜-–—")
    suffix = text[match.end() :].strip(" \t,，.。")
    if not prefix or suffix or sum(character.isalpha() for character in prefix) < 2:
        return line

    total_units = max(1, _visual_units(text))
    prefix_units = _visual_units(text[: match.start()])
    right = min(
        line.bbox.right,
        line.bbox.left + max(8, round(line.bbox.width * prefix_units / total_units)),
    )
    bbox = Rect(line.bbox.left, line.bbox.top, right, line.bbox.bottom)
    polygon = np.array(
        [
            [bbox.left, bbox.top],
            [bbox.right, bbox.top],
            [bbox.right, bbox.bottom],
            [bbox.left, bbox.bottom],
        ]
    )
    return TextLine(
        polygon=polygon,
        bbox=bbox,
        text=prefix,
        confidence=line.confidence,
        language=line.language,
        candidates=line.candidates,
    )


def _text_after_leading_mention(line: TextLine) -> TextLine:
    text = line.text.strip()
    match = LEADING_LATIN_MENTION_RE.match(text)
    if match is None:
        return line
    body_start = match.end()
    while body_start < len(text) and text[body_start].isspace():
        body_start += 1
    body = text[body_start:]
    if sum(character.isalpha() for character in body) < 2:
        return line

    total_units = max(1, _visual_units(text))
    prefix_units = _visual_units(text[:body_start])
    left = min(
        line.bbox.right - 1,
        line.bbox.left + max(1, round(line.bbox.width * prefix_units / total_units)),
    )
    bbox = Rect(left, line.bbox.top, line.bbox.right, line.bbox.bottom)
    polygon = np.array(
        [
            [bbox.left, bbox.top],
            [bbox.right, bbox.top],
            [bbox.right, bbox.bottom],
            [bbox.left, bbox.bottom],
        ]
    )
    marker = RecognitionCandidate(PROTECTED_PREFIX_ENGINE, match.group(), 1.0)
    return TextLine(
        polygon=polygon,
        bbox=bbox,
        text=body,
        confidence=line.confidence,
        language=line.language,
        candidates=(*line.candidates, marker),
    )


def _visual_units(text: str) -> int:
    return sum(
        2 if unicodedata.east_asian_width(character) in {"W", "F"} else 1
        for character in text
    )


def _merge_visual_rows(lines: list[TextLine]) -> list[TextLine]:
    """Coalesce OCR fragments that occupy one rendered Discord text row."""
    ordered = sorted(lines, key=lambda line: (line.bbox.top, line.bbox.left))
    rows: list[list[TextLine]] = []
    for line in ordered:
        if not rows:
            rows.append([line])
            continue
        row_bbox = union_rect(fragment.bbox for fragment in rows[-1])
        overlap = min(row_bbox.bottom, line.bbox.bottom) - max(row_bbox.top, line.bbox.top)
        minimum_height = max(1, min(row_bbox.height, line.bbox.height))
        row_center = (row_bbox.top + row_bbox.bottom) / 2
        line_center = (line.bbox.top + line.bbox.bottom) / 2
        same_row = overlap >= minimum_height * 0.45 or abs(row_center - line_center) <= 3
        if same_row:
            rows[-1].append(line)
        else:
            rows.append([line])
    return [_merge_row_fragments(row) for row in rows]


def _merge_row_fragments(fragments: list[TextLine]) -> TextLine:
    ordered = sorted(fragments, key=lambda line: line.bbox.left)
    bbox = union_rect(line.bbox for line in ordered)
    language_scores: dict[Language, float] = {}
    total_weight = 0.0
    confidence_total = 0.0
    candidates = []
    typical_height = median(max(1, line.bbox.height) for line in ordered)
    inline_media_gap = max(18, round(typical_height * 1.15))
    for previous, following in zip(ordered, ordered[1:], strict=False):
        gap = following.bbox.left - previous.bbox.right
        if gap >= inline_media_gap:
            candidates.append(
                RecognitionCandidate(
                    INLINE_MEDIA_ENGINE,
                    (
                        f"{previous.bbox.right},{min(previous.bbox.top, following.bbox.top)},"
                        f"{following.bbox.left},{max(previous.bbox.bottom, following.bbox.bottom)}"
                    ),
                    1.0,
                )
            )
    for line in ordered:
        weight = max(1, line.bbox.width)
        total_weight += weight
        confidence_total += line.confidence * weight
        candidates.extend(line.candidates)
        if line.language is not Language.UNKNOWN:
            language_scores[line.language] = language_scores.get(line.language, 0.0) + weight
    language = (
        max(language_scores, key=language_scores.get) if language_scores else Language.UNKNOWN
    )
    polygon = np.array(
        [
            [bbox.left, bbox.top],
            [bbox.right, bbox.top],
            [bbox.right, bbox.bottom],
            [bbox.left, bbox.bottom],
        ]
    )
    return TextLine(
        polygon=polygon,
        bbox=bbox,
        text=" ".join(line.text.strip() for line in ordered if line.text.strip()),
        confidence=confidence_total / max(1.0, total_weight),
        language=language,
        candidates=tuple(candidates),
    )


def _dominant_background(image_bgr: np.ndarray) -> np.ndarray | None:
    if image_bgr.size == 0:
        return None
    pixels = image_bgr[::4, ::4].reshape(-1, 3).astype(np.int32)
    quantized = pixels // 4
    codes = quantized[:, 0] + (quantized[:, 1] << 6) + (quantized[:, 2] << 12)
    code = int(np.bincount(codes, minlength=64**3).argmax())
    return np.array([(code & 63) * 4 + 2, ((code >> 6) & 63) * 4 + 2, ((code >> 12) & 63) * 4 + 2])


def _on_chat_surface(bbox: Rect, image: np.ndarray, background: np.ndarray) -> bool:
    height, width = image.shape[:2]
    sample = bbox.expanded(2).clipped(width, height)
    pixels = image[sample.top : sample.bottom, sample.left : sample.right].astype(np.int32)
    if pixels.size == 0:
        return False
    # Discord uses noticeably different message-row colors for mentions,
    # followed announcements and hover/highlight states. Their RGB distance
    # from the dominant pane is about 28, while attachment artwork is farther.
    close = (
        np.linalg.norm(pixels - background, axis=2) <= CHAT_SURFACE_COLOR_DISTANCE
    )
    return float(close.mean()) >= 0.24


def _is_colored_label(bbox: Rect, image: np.ndarray, background: np.ndarray) -> bool:
    """Discord usernames/roles are often saturated; body text is neutral."""
    height, width = image.shape[:2]
    sample = bbox.expanded(1).clipped(width, height)
    pixels = image[sample.top : sample.bottom, sample.left : sample.right].astype(np.int32)
    foreground = pixels[np.linalg.norm(pixels - background, axis=2) > 24]
    if len(foreground) < 6:
        return False
    saturation = foreground.max(axis=1) - foreground.min(axis=1)
    return float(np.quantile(saturation, 0.65)) >= 48
