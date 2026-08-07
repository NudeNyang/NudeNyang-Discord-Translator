from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import cv2

from .cache import TranslationCache
from .models import Language, Message
from .ocr.message_grouper import group_message_lines
from .ocr.paddle_dual import PaddleDualOcr
from .static_render import render_messages
from .theme import detect_theme
from .translation.deepl import DeepLTranslator
from .translation.mock import MockTranslator, OriginalTranslator


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="정적 Discord 스크린샷 번역 덮어쓰기 POC")
    parser.add_argument("input", type=Path)
    parser.add_argument("--output", type=Path, default=Path("artifacts/poc-overlay.png"))
    parser.add_argument("--json", type=Path, default=Path("artifacts/poc-result.json"))
    parser.add_argument("--target", choices=("ko", "en", "ja"), default="ko")
    parser.add_argument("--translator", choices=("deepl", "mock", "original"), default="mock")
    parser.add_argument("--device", default="auto")
    parser.add_argument("--theme", choices=("auto", "dark", "light"), default="auto")
    parser.add_argument("--crop", help="left,top,right,bottom")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    os.environ.setdefault("PADDLE_PDX_MODEL_SOURCE", "BOS")
    image = cv2.imread(str(args.input))
    if image is None:
        raise SystemExit(f"이미지를 읽을 수 없어: {args.input}")
    offset_x = offset_y = 0
    working = image
    if args.crop:
        left, top, right, bottom = [int(value) for value in args.crop.split(",")]
        working = image[top:bottom, left:right]
        offset_x, offset_y = left, top

    ocr = PaddleDualOcr(device=args.device)
    lines = ocr.recognize(working)
    messages = group_message_lines(lines, working.shape[1], working)
    target = Language(args.target)
    translator = _translator(args.translator)
    cache = TranslationCache(args.output.parent / "poc-cache.db")
    try:
        for message in messages:
            if message.source_language == target:
                message.translated_text = message.source_text
            else:
                cached = cache.get(message.ensure_id(), target)
                if cached is None:
                    cached = translator.translate(
                        message.source_text, message.source_language, target
                    )
                    cache.put(
                        message.ensure_id(),
                        message.source_text,
                        message.source_language,
                        target,
                        cached,
                    )
                message.translated_text = cached
        style = detect_theme(working, args.theme)
        rendered = render_messages(working, messages, style)
    finally:
        cache.close()

    if offset_x or offset_y:
        image[offset_y : offset_y + rendered.shape[0], offset_x : offset_x + rendered.shape[1]] = (
            rendered
        )
        rendered = image
        for message in messages:
            message.bbox = message.bbox.translated(offset_x, offset_y)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.json.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(args.output), rendered)
    args.json.write_text(
        json.dumps([_message_json(message) for message in messages], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"messages={len(messages)} output={args.output} json={args.json}")
    return 0


def _translator(name: str):
    if name == "deepl":
        return DeepLTranslator()
    if name == "original":
        return OriginalTranslator()
    return MockTranslator()


def _message_json(message: Message) -> dict[str, object]:
    return {
        "id": message.ensure_id(),
        "bbox": [message.bbox.left, message.bbox.top, message.bbox.right, message.bbox.bottom],
        "source_language": message.source_language.value,
        "source_text": message.source_text,
        "translated_text": message.translated_text,
        "confidence": message.confidence,
        "candidates": [
            {
                "engine": candidate.engine,
                "text": candidate.text,
                "confidence": candidate.confidence,
            }
            for line in message.lines
            for candidate in line.candidates
        ],
    }


if __name__ == "__main__":
    raise SystemExit(main())
