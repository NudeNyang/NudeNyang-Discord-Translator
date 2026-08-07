from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

MARKER_PREFIX = "ZXQKEEP"
MARKER_SUFFIX = "QXZ"

MENTION_RE = re.compile(r"@(?:[A-Za-z0-9_.-]+|全員|各位|여러분)", re.IGNORECASE)
CHANNEL_TAG_RE = re.compile(r"#[A-Za-z0-9_.-]{2,}")
CUSTOM_EMOJI_RE = re.compile(r":[A-Za-z0-9_~.-]{2,32}:")
ASCII_EMOTICON_RE = re.compile(
    r"(?<![A-Za-z0-9])(?:"
    r"[:;=8][-~^']?[()DPOp/\\]|[xX][dD]|[Tt][_.-][Tt]|\^[_ .-]?\^"
    r"|[ㅠㅜ]{2,}|ㅇㅅㅇ|ㅋ{2,}|ㅎ{2,}"
    r")(?![A-Za-z0-9])"
)
SHRUG_RE = re.compile(r"¯\\?_\([ツづ]?\)_/¯|¯\\_\([^\n]{1,12}\)_/¯")
KAOMOJI_RE = re.compile(r"[（(][^()（）\n]{1,24}[）)]")
KAOMOJI_HINTS = frozenset("^;:°ωツづノಠಥ益Д▽∀・´｀≧≤＞＜ㅅㅇ")
BOW_RE = re.compile(r"m\(\s*[_＿]{1,4}\s*\)m", re.IGNORECASE)
CHAT_FACE_RE = re.compile(
    r"(?:"
    r"[ωwWνvV][·・.'’`]*[)'）]+"
    r"|[・･][ωwWνvV^＾]+[・･]"
    r"|>(?:[_＿]|く|＜)[;；]?"
    r")"
)

EMOJI_BASE = (
    "\u00a9\u00ae\u203c\u2049\u2122\u2139"
    "\u2194-\u21ff\u2300-\u23ff\u2460-\u24ff"
    "\u25a0-\u27bf\u2934-\u2935\u2b00-\u2bff"
    "\u3030\u303d\u3297\u3299"
    "\U0001f1e6-\U0001f1ff"
    "\U0001f300-\U0001faff"
)
EMOJI_RE = re.compile(
    rf"(?:[{EMOJI_BASE}](?:[\ufe0e\ufe0f])?(?:[\U0001f3fb-\U0001f3ff])?"
    rf"(?:\u200d[{EMOJI_BASE}](?:[\ufe0e\ufe0f])?(?:[\U0001f3fb-\U0001f3ff])?)*"
    rf"|[0-9#*][\ufe0e\ufe0f]?\u20e3)"
)


@dataclass(frozen=True, slots=True)
class ProtectedText:
    original: str
    masked: str
    tokens: tuple[str, ...]

    @property
    def has_translatable_text(self) -> bool:
        remainder = self.masked
        for index in range(len(self.tokens)):
            remainder = remainder.replace(_marker(index), "")
        letters = [
            character
            for character in remainder
            if character.isalpha() or character.isdigit()
        ]
        # OCR often appends one or two kana to a large kaomoji. Sending those
        # fragments to a small LLM makes it invent an explanatory paragraph.
        emoticon_dominated = any(_is_text_emoticon(token) for token in self.tokens)
        if emoticon_dominated and len(letters) <= 3:
            return False
        return bool(letters)

    def restore(self, translated: str) -> str:
        restored = translated
        missing: list[str] = []
        for index, token in enumerate(self.tokens):
            marker = _marker(index)
            if marker in restored:
                restored = restored.replace(marker, token)
                continue
            flexible = re.compile(
                rf"Z\s*X\s*Q\s*KEEP\s*0*{index}\s*Q\s*X\s*Z",
                re.IGNORECASE,
            )
            if flexible.search(restored):
                restored = flexible.sub(lambda _match, value=token: value, restored)
            else:
                missing.append(token)
        if missing:
            separator = " " if restored and not restored.endswith((" ", "\n")) else ""
            restored = f"{restored}{separator}{' '.join(missing)}"
        return restored


def protect_text(text: str) -> ProtectedText:
    spans: list[tuple[int, int]] = []
    for pattern in (
        MENTION_RE,
        CHANNEL_TAG_RE,
        CUSTOM_EMOJI_RE,
        ASCII_EMOTICON_RE,
        SHRUG_RE,
        BOW_RE,
        CHAT_FACE_RE,
        EMOJI_RE,
    ):
        spans.extend((match.start(), match.end()) for match in pattern.finditer(text))
    for match in KAOMOJI_RE.finditer(text):
        value = match.group()
        if any(character in KAOMOJI_HINTS for character in value) or any(
            unicodedata.category(character).startswith("S") for character in value
        ):
            spans.append((match.start(), match.end()))

    selected: list[tuple[int, int]] = []
    for start, end in sorted(spans, key=lambda item: (item[0], -(item[1] - item[0]))):
        if selected and start < selected[-1][1]:
            continue
        selected.append((start, end))
    if not selected:
        return ProtectedText(text, text, ())

    parts: list[str] = []
    tokens: list[str] = []
    cursor = 0
    for index, (start, end) in enumerate(selected):
        parts.append(text[cursor:start])
        parts.append(_marker(index))
        tokens.append(text[start:end])
        cursor = end
    parts.append(text[cursor:])
    return ProtectedText(text, "".join(parts), tuple(tokens))


def _marker(index: int) -> str:
    return f"{MARKER_PREFIX}{index:03d}{MARKER_SUFFIX}"


def _is_text_emoticon(token: str) -> bool:
    return any(
        pattern.fullmatch(token)
        for pattern in (
            ASCII_EMOTICON_RE,
            SHRUG_RE,
            BOW_RE,
            CHAT_FACE_RE,
            KAOMOJI_RE,
        )
    )
