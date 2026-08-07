from __future__ import annotations

import logging
import re
import unicodedata
from dataclasses import dataclass
from hashlib import blake2b
from statistics import median

import numpy as np

from ..language import LanguageDetector, detect_explicit_language
from ..models import Language, Message, RecognitionCandidate, Rect, TextLine, union_rect
from ..ocr.message_grouper import (
    COMPOSED_INLINE_MEDIA_ENGINE,
    PRESERVED_INLINE_ENGINE,
)

LOGGER = logging.getLogger("discord_translate_overlay.uia")

TEXT_CONTROL = 50020
BUTTON_CONTROL = 50000
HYPERLINK_CONTROL = 50005
IMAGE_CONTROL = 50006
LIST_ITEM_CONTROL = 50007

MESSAGE_ID_PREFIX = "chat-messages-"
CHANNEL_SUFFIX_RE = re.compile(
    r"\s*\((?:채팅|음성|포럼|공지|스테이지)\s*채널\)\s*$", re.IGNORECASE
)
UNREAD_PREFIX_RE = re.compile(
    r"^(?:읽지\s*않은|unread|未読(?:の)?)\s+", re.IGNORECASE
)
HEADER_SERVER_PREFIX_RE = re.compile(r"^[^:：]{1,80}[:：]\s*")
TIMESTAMP_RE = re.compile(
    r"^(?:20\d{2}[-./년]\s*)?\d{1,2}(?:[-./월]\s*\d{1,2})?.*"
    r"(?:오전|오후|午前|午後|am|pm)?\s*\d{1,2}:\d{2}$",
    re.IGNORECASE,
)


@dataclass(frozen=True, slots=True)
class UiaElement:
    name: str
    bbox: Rect
    control_type: int
    class_name: str = ""
    automation_id: str = ""
    font_name: str = ""
    font_size: float = 0.0


@dataclass(frozen=True, slots=True)
class DiscordUiaSnapshot:
    available: bool
    messages: tuple[Message, ...] = ()
    sidebar_messages: tuple[Message, ...] = ()
    header_messages: tuple[Message, ...] = ()
    visible_message_rows: int = 0


class DiscordUiaReader:
    """Read Discord's Chromium accessibility tree without using its API or DOM.

    UI Automation supplies exact text and physical screen coordinates for normal
    Discord messages, embeds, mentions and channel labels. OCR remains the
    fallback when Chromium does not expose a usable message tree.
    """

    def read(
        self,
        hwnd: int,
        chat_screen: Rect,
        sidebar_screen: Rect,
        header_screen: Rect,
    ) -> DiscordUiaSnapshot:
        try:
            elements = self._read_elements(hwnd)
        except Exception:
            LOGGER.exception("Discord UI Automation tree read failed")
            return DiscordUiaSnapshot(False)
        return build_snapshot(elements, chat_screen, sidebar_screen, header_screen)

    @staticmethod
    def _read_elements(hwnd: int) -> list[UiaElement]:
        # COM is initialized inside the executor thread on every call. This also
        # makes development reloads and packaged runs independent of the Qt thread.
        import comtypes
        import comtypes.client

        comtypes.CoInitialize()
        try:
            comtypes.client.GetModule("UIAutomationCore.dll")
            from comtypes.gen.UIAutomationClient import (  # type: ignore[import-not-found]
                CUIAutomation8,
                IUIAutomation,
                IUIAutomationTextPattern,
                TreeScope_Descendants,
                TreeScope_Element,
                UIA_AutomationIdPropertyId,
                UIA_BoundingRectanglePropertyId,
                UIA_ClassNamePropertyId,
                UIA_ControlTypePropertyId,
                UIA_FontNameAttributeId,
                UIA_FontSizeAttributeId,
                UIA_NamePropertyId,
                UIA_TextPatternId,
            )

            automation = comtypes.client.CreateObject(CUIAutomation8, interface=IUIAutomation)
            root = automation.ElementFromHandle(hwnd)
            request = automation.CreateCacheRequest()
            for property_id in (
                UIA_NamePropertyId,
                UIA_BoundingRectanglePropertyId,
                UIA_ControlTypePropertyId,
                UIA_ClassNamePropertyId,
                UIA_AutomationIdPropertyId,
            ):
                request.AddProperty(property_id)
            request.AddPattern(UIA_TextPatternId)
            # Cache only every returned element, not another descendant tree for
            # each element. Chromium then returns all five properties in one
            # cross-process call instead of thousands of individual COM calls.
            request.TreeScope = TreeScope_Element
            collection = root.FindAllBuildCache(
                TreeScope_Descendants,
                automation.CreateTrueCondition(),
                request,
            )
            result: list[UiaElement] = []
            for index in range(collection.Length):
                element = collection.GetElement(index)
                try:
                    bounds = element.CachedBoundingRectangle
                    control_type = int(element.CachedControlType)
                    font_name = ""
                    font_size = 0.0
                    if control_type == TEXT_CONTROL:
                        try:
                            pattern = element.GetCachedPattern(UIA_TextPatternId).QueryInterface(
                                IUIAutomationTextPattern
                            )
                            text_range = pattern.DocumentRange
                            font_name_value = text_range.GetAttributeValue(
                                UIA_FontNameAttributeId
                            )
                            font_size_value = text_range.GetAttributeValue(
                                UIA_FontSizeAttributeId
                            )
                            if isinstance(font_name_value, str):
                                font_name = font_name_value
                            if isinstance(font_size_value, (int, float)):
                                font_size = float(font_size_value)
                        except Exception:
                            pass
                    bbox = Rect(
                        round(bounds.left),
                        round(bounds.top),
                        round(bounds.right),
                        round(bounds.bottom),
                    )
                    result.append(
                        UiaElement(
                            name=element.CachedName or "",
                            bbox=bbox,
                            control_type=control_type,
                            class_name=element.CachedClassName or "",
                            automation_id=element.CachedAutomationId or "",
                            font_name=font_name,
                            font_size=font_size,
                        )
                    )
                except Exception:
                    # Chromium can remove a virtualized row while it is being
                    # enumerated. One stale element must not discard the snapshot.
                    continue
            return result
        finally:
            comtypes.CoUninitialize()


def build_snapshot(
    elements: list[UiaElement],
    chat_screen: Rect,
    sidebar_screen: Rect,
    header_screen: Rect,
) -> DiscordUiaSnapshot:
    document_present = any(
        element.automation_id == "RootWebArea" for element in elements
    )
    if not document_present:
        return DiscordUiaSnapshot(False)

    messages, visible_rows = _message_items(elements, chat_screen)
    sidebar = _sidebar_items(elements, sidebar_screen)
    header = _header_items(elements, header_screen)
    return DiscordUiaSnapshot(
        True,
        tuple(messages),
        tuple(sidebar),
        tuple(header),
        visible_rows,
    )


def _message_items(
    elements: list[UiaElement], chat_screen: Rect
) -> tuple[list[Message], int]:
    all_indexed_rows = [
        (index, element)
        for index, element in enumerate(elements)
        if element.control_type == LIST_ITEM_CONTROL
        and element.automation_id.startswith(MESSAGE_ID_PREFIX)
        and "messageListItem__" in element.class_name
    ]
    detector = LanguageDetector()
    messages: list[Message] = []
    visible_rows = 0
    for row_number, (tree_index, row) in enumerate(all_indexed_rows):
        if not _visible_intersection(row.bbox, chat_screen).area:
            continue
        visible_rows += 1
        next_tree_index = (
            all_indexed_rows[row_number + 1][0]
            if row_number + 1 < len(all_indexed_rows)
            else len(elements)
        )
        # UI Automation's FindAll result is depth-first. Restricting candidates
        # to this subtree-sized slice prevents a partially clipped message row
        # from accidentally swallowing the channel header or member-list text
        # that happens to share the same screen coordinates.
        descendants = [
            item
            for item in elements[tree_index + 1 : next_tree_index]
            if item.bbox.area
            and _center_inside(item.bbox, row.bbox)
        ]
        messages.extend(_messages_from_row(row, descendants, chat_screen, detector))
    messages.sort(key=lambda item: (item.bbox.top, item.bbox.left))
    return messages, visible_rows


def _messages_from_row(
    row: UiaElement,
    descendants: list[UiaElement],
    chat_screen: Rect,
    detector: LanguageDetector,
) -> list[Message]:
    header_rects = [
        item.bbox for item in descendants if "header_c19a55" in item.class_name
    ]
    reaction_rects = [
        item.bbox
        for item in descendants
        if "reactions__" in item.class_name or item.automation_id.startswith("message-reactions-")
    ]
    embed_rects = [
        item.bbox for item in descendants if "embedFull__" in item.class_name
    ]
    protected = _protected_elements(descendants)

    body_nodes: list[UiaElement] = []
    embed_nodes: dict[int, list[UiaElement]] = {
        index: [] for index in range(len(embed_rects))
    }
    for item in descendants:
        if item.control_type != TEXT_CONTROL or not item.name.strip() or not item.bbox.area:
            continue
        if item.automation_id.startswith("message-timestamp-"):
            continue
        if any(_center_inside(item.bbox, rect) for rect in header_rects):
            continue
        if any(_center_inside(item.bbox, rect) for rect in reaction_rects):
            continue
        if _skip_metadata_text(item):
            continue
        prepared = _trim_text_bounds(item)
        if prepared is None:
            continue
        embed_index = next(
            (
                index
                for index, rect in enumerate(embed_rects)
                if _center_inside(prepared.bbox, rect)
            ),
            None,
        )
        if embed_index is None:
            body_nodes.append(prepared)
        else:
            embed_nodes[embed_index].append(prepared)

    groups: list[tuple[str, list[UiaElement]]] = []
    groups.extend(("body", group) for group in _cluster_text_nodes(body_nodes))
    for embed_index, nodes in embed_nodes.items():
        groups.extend(
            (f"embed-{embed_index}", group) for group in _cluster_text_nodes(nodes)
        )

    output: list[Message] = []
    group_counts: dict[str, int] = {}
    for kind, nodes in groups:
        text = "\n".join(node.name.strip() for node in nodes if node.name.strip()).strip()
        if not text or not _has_language_character(text) or _is_embed_chrome(kind, text):
            continue
        absolute_bbox = union_rect(node.bbox for node in nodes).expanded(2, 1)
        clipped = _visible_intersection(absolute_bbox, chat_screen)
        if not clipped.area:
            continue
        # TextPattern exposes the complete message even when only a thin sliver
        # is visible at a scroll boundary. Do not squeeze that complete text
        # into the clipped sliver; render it once most of the source is visible.
        visible_height_ratio = clipped.height / max(1, absolute_bbox.height)
        visible_width_ratio = clipped.width / max(1, absolute_bbox.width)
        if visible_height_ratio < 0.70 or visible_width_ratio < 0.70:
            continue
        local_bbox = clipped.translated(-chat_screen.left, -chat_screen.top)
        container = _render_container_for_group(
            kind,
            nodes,
            absolute_bbox,
            row,
            groups,
            descendants,
            embed_rects,
            reaction_rects,
            chat_screen,
        )
        holes = _holes_for_bbox(protected, absolute_bbox, chat_screen)
        explicit = detect_explicit_language(text)
        language = explicit if explicit is not Language.UNKNOWN else detector.detect(text)
        line = _text_line(local_bbox, text, language, holes)
        count = group_counts.get(kind, 0)
        group_counts[kind] = count + 1
        output.append(
            Message(
                bbox=local_bbox,
                source_text=text,
                source_language=language,
                confidence=1.0,
                lines=[line],
                message_id=f"uia:{row.automation_id}:{kind}:{count}",
                render_font_family=_dominant_font_family(nodes),
                render_font_size=_median_font_size(nodes),
                render_kind="embed" if kind.startswith("embed-") else "body",
                render_container=container,
            )
        )
    return output


def _render_container_for_group(
    kind: str,
    nodes: list[UiaElement],
    absolute_bbox: Rect,
    row: UiaElement,
    groups: list[tuple[str, list[UiaElement]]],
    descendants: list[UiaElement],
    embed_rects: list[Rect],
    reaction_rects: list[Rect],
    chat_screen: Rect,
) -> Rect:
    """Return the safe surface a translated text card may occupy."""

    if kind.startswith("embed-"):
        embed_index = int(kind.split("-", maxsplit=1)[1])
        surface = embed_rects[embed_index]
        right_margin = 8
    else:
        surface = row.bbox
        right_margin = 12

    right = min(chat_screen.right, surface.right) - right_margin
    right = max(absolute_bbox.right, right)
    bottom_limit = min(chat_screen.bottom, surface.bottom) - 4

    blockers: list[Rect] = list(reaction_rects)
    blockers.extend(
        union_rect(item.bbox for item in other_nodes)
        for _other_kind, other_nodes in groups
        if other_nodes and other_nodes is not nodes
    )
    blockers.extend(
        item.bbox
        for item in descendants
        if item.bbox.area
        and item.control_type in {HYPERLINK_CONTROL, IMAGE_CONTROL}
        and "emoji" not in item.class_name.casefold()
    )
    if not kind.startswith("embed-"):
        blockers.extend(embed_rects)

    below = [
        blocker.top
        for blocker in blockers
        if blocker.top >= absolute_bbox.bottom - 1
        and blocker.left < right
        and blocker.right > absolute_bbox.left
        and blocker.top < bottom_limit
    ]
    if below:
        bottom_limit = min(bottom_limit, min(below) - 3)
    bottom_limit = max(absolute_bbox.bottom, bottom_limit)
    absolute = Rect(
        absolute_bbox.left,
        absolute_bbox.top,
        right,
        bottom_limit,
    )
    return _visible_intersection(absolute, chat_screen).translated(
        -chat_screen.left, -chat_screen.top
    )


def _protected_elements(elements: list[UiaElement]) -> list[UiaElement]:
    protected: list[UiaElement] = []
    seen: set[tuple[int, int, int, int]] = set()
    for item in elements:
        is_link = item.control_type == HYPERLINK_CONTROL
        is_mention = "roleMention__" in item.class_name
        is_emoji = "emojiContainer__" in item.class_name or (
            item.control_type == IMAGE_CONTROL and item.class_name == "emoji"
        )
        if not (is_link or is_mention or is_emoji) or not item.bbox.area:
            continue
        key = (item.bbox.left, item.bbox.top, item.bbox.right, item.bbox.bottom)
        if key in seen:
            continue
        seen.add(key)
        protected.append(item)
    return protected


def _holes_for_bbox(
    protected: list[UiaElement], absolute_bbox: Rect, origin: Rect
) -> tuple[RecognitionCandidate, ...]:
    holes = []
    for item in protected:
        if not item.bbox.expanded(2).intersects(absolute_bbox):
            continue
        local = item.bbox.translated(-origin.left, -origin.top)
        is_emoji = "emojiContainer__" in item.class_name or (
            item.control_type == IMAGE_CONTROL and item.class_name == "emoji"
        )
        engine = COMPOSED_INLINE_MEDIA_ENGINE if is_emoji else PRESERVED_INLINE_ENGINE
        suffix = f"|{item.name.strip()}" if is_emoji and item.name.strip() else ""
        holes.append(
            RecognitionCandidate(
                engine,
                f"{local.left},{local.top},{local.right},{local.bottom}{suffix}",
                1.0,
            )
        )
    return tuple(holes)


def _cluster_text_nodes(nodes: list[UiaElement]) -> list[list[UiaElement]]:
    ordered = sorted(nodes, key=lambda item: (item.bbox.top, item.bbox.left))
    if not ordered:
        return []
    typical_height = median(max(1, item.bbox.height) for item in ordered)
    max_gap = max(8, round(typical_height * 0.55))
    groups: list[list[UiaElement]] = []
    for item in ordered:
        if not groups:
            groups.append([item])
            continue
        previous_bbox = union_rect(value.bbox for value in groups[-1])
        vertical_gap = item.bbox.top - previous_bbox.bottom
        horizontally_related = (
            item.bbox.left <= previous_bbox.right + max(24, round(typical_height * 1.5))
            or abs(item.bbox.left - previous_bbox.left) <= max(24, round(typical_height * 1.5))
        )
        if vertical_gap <= max_gap and horizontally_related:
            groups[-1].append(item)
        else:
            groups.append([item])
    return groups


def _trim_text_bounds(item: UiaElement) -> UiaElement | None:
    normalized = item.name.replace("\r\n", "\n").replace("\r", "\n")
    rows = normalized.split("\n")
    leading = 0
    while leading < len(rows) and not rows[leading].strip():
        leading += 1
    trailing = 0
    while trailing < len(rows) - leading and not rows[len(rows) - trailing - 1].strip():
        trailing += 1
    if leading == len(rows):
        return None
    top = item.bbox.top + round(item.bbox.height * leading / max(1, len(rows)))
    bottom = item.bbox.bottom - round(item.bbox.height * trailing / max(1, len(rows)))
    text = "\n".join(rows[leading : len(rows) - trailing if trailing else None]).strip()
    return UiaElement(
        text,
        Rect(item.bbox.left, top, item.bbox.right, max(top + 1, bottom)),
        item.control_type,
        item.class_name,
        item.automation_id,
        item.font_name,
        item.font_size,
    )


def _skip_metadata_text(item: UiaElement) -> bool:
    class_name = item.class_name.casefold()
    if any(
        marker in class_name
        for marker in ("timestamp", "edited", "embedfooter", "reactioncount")
    ):
        return True
    text = " ".join(item.name.split())
    if text in {
        "클릭해서 반응",
        "눌러서 반응하기",
        "반응 추가하기",
        "Click to react",
        "Add Reaction",
    }:
        return True
    return bool(TIMESTAMP_RE.fullmatch(text))


def _sidebar_items(elements: list[UiaElement], screen: Rect) -> list[Message]:
    if not screen.area:
        return []
    children_right_by_row = [
        item
        for item in elements
        if "children__2ea32" in item.class_name and item.bbox.intersects(screen)
    ]
    candidates = [
        item
        for item in elements
        if item.bbox.intersects(screen)
        and (
            "link__2ea32" in item.class_name
            or (item.control_type == TEXT_CONTROL and "name__29444" in item.class_name)
        )
    ]
    messages: list[Message] = []
    detector = LanguageDetector()
    for item in sorted(candidates, key=lambda value: (value.bbox.top, value.bbox.left)):
        raw = CHANNEL_SUFFIX_RE.sub("", UNREAD_PREFIX_RE.sub("", item.name.strip()))
        body, prefix = _channel_body(raw)
        if not body or not _has_language_character(body):
            continue
        is_link = "link__2ea32" in item.class_name
        visual_base_left = item.bbox.left + (32 if is_link else 0)
        body_left = visual_base_left + _estimated_text_width(prefix, item.bbox.height)
        action = next(
            (
                value
                for value in children_right_by_row
                if _same_visual_row(value.bbox, item.bbox)
            ),
            None,
        )
        hard_right = (action.bbox.left - 4) if action else (item.bbox.right - 7)
        natural_right = body_left + _estimated_text_width(body, item.bbox.height) + 5
        body_right = min(hard_right, max(body_left + 8, natural_right))
        absolute = Rect(body_left, item.bbox.top + 3, body_right, item.bbox.bottom - 3)
        local = _visible_intersection(absolute, screen).translated(-screen.left, -screen.top)
        if not local.area:
            continue
        language = _resolved_language(body, detector)
        messages.append(_uia_message(local, body, language, "channel"))
    return messages


def _header_items(elements: list[UiaElement], screen: Rect) -> list[Message]:
    if not screen.area:
        return []
    candidates = [
        item
        for item in elements
        if item.control_type == TEXT_CONTROL
        and "title__9293f" in item.class_name
        and item.bbox.intersects(screen)
    ]
    detector = LanguageDetector()
    messages: list[Message] = []
    for item in candidates[:1]:
        raw = HEADER_SERVER_PREFIX_RE.sub("", item.name.strip())
        body, prefix = _channel_body(raw)
        if not body or not _has_language_character(body):
            continue
        left = item.bbox.left + _estimated_text_width(prefix, item.bbox.height)
        absolute = Rect(left, item.bbox.top, item.bbox.right, item.bbox.bottom)
        local = _visible_intersection(absolute, screen).translated(-screen.left, -screen.top)
        if local.area:
            messages.append(
                _uia_message(local, body, _resolved_language(body, detector), "header")
            )
    return messages


def _channel_body(text: str) -> tuple[str, str]:
    body_start = next(
        (
            index
            for index, character in enumerate(text)
            if character.isalpha() or character.isdigit()
        ),
        0,
    )
    return text[body_start:].strip(), text[:body_start]


def _estimated_text_width(text: str, row_height: int) -> int:
    em = max(10.0, min(18.0, row_height * 0.50))
    units = 0.0
    for character in text:
        if unicodedata.category(character).startswith("M"):
            continue
        if unicodedata.east_asian_width(character) in {"W", "F"}:
            units += 1.0
        elif character.isspace() or character in "|│┃・･":
            units += 0.45
        else:
            units += 0.55
    return round(units * em)


def _uia_message(bbox: Rect, text: str, language: Language, kind: str) -> Message:
    stable = blake2b(f"{kind}:{text.casefold()}".encode(), digest_size=12).hexdigest()
    return Message(
        bbox=bbox,
        source_text=text,
        source_language=language,
        confidence=1.0,
        lines=[_text_line(bbox, text, language)],
        message_id=f"uia:{kind}:{stable}",
    )


def _median_font_size(nodes: list[UiaElement]) -> float:
    values = [item.font_size for item in nodes if item.font_size > 0]
    return float(median(values)) if values else 0.0


def _dominant_font_family(nodes: list[UiaElement]) -> str:
    values = [item.font_name for item in nodes if item.font_name]
    return max(set(values), key=values.count) if values else ""


def _text_line(
    bbox: Rect,
    text: str,
    language: Language,
    candidates: tuple[RecognitionCandidate, ...] = (),
) -> TextLine:
    polygon = np.array(
        [
            [bbox.left, bbox.top],
            [bbox.right, bbox.top],
            [bbox.right, bbox.bottom],
            [bbox.left, bbox.bottom],
        ],
        dtype=float,
    )
    return TextLine(polygon, bbox, text, 1.0, language, candidates)


def _resolved_language(text: str, detector: LanguageDetector) -> Language:
    explicit = detect_explicit_language(text)
    return explicit if explicit is not Language.UNKNOWN else detector.detect(text)


def _has_language_character(text: str) -> bool:
    return any(unicodedata.category(character).startswith("L") for character in text)


def _is_embed_chrome(kind: str, text: str) -> bool:
    if not kind.startswith("embed-"):
        return False
    compact = "".join(character for character in text if not character.isspace())
    return bool(compact) and all(character in "Xx•·" for character in compact)


def _center_inside(candidate: Rect, container: Rect) -> bool:
    center_x = (candidate.left + candidate.right) / 2
    center_y = (candidate.top + candidate.bottom) / 2
    return (
        container.left <= center_x <= container.right
        and container.top <= center_y <= container.bottom
    )


def _same_visual_row(first: Rect, second: Rect) -> bool:
    overlap = min(first.bottom, second.bottom) - max(first.top, second.top)
    return overlap >= min(first.height, second.height) * 0.45


def _visible_intersection(first: Rect, second: Rect) -> Rect:
    return Rect(
        max(first.left, second.left),
        max(first.top, second.top),
        min(first.right, second.right),
        min(first.bottom, second.bottom),
    )
