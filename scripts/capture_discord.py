from __future__ import annotations

import argparse
import ctypes
import sys
from pathlib import Path

import cv2

from discord_translate_overlay.capture import (
    DiscordWindowLocator,
    DxgiCapture,
    detect_chat_region,
)
from discord_translate_overlay.config import load_config
from discord_translate_overlay.models import Rect


def main() -> int:
    try:
        ctypes.windll.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
    except Exception:
        pass
    parser = argparse.ArgumentParser(description="현재 Discord 채팅 영역을 로컬 PNG로 캡처")
    parser.add_argument("--output", type=Path, default=Path("artifacts/discord-chat.png"))
    args = parser.parse_args()
    window = DiscordWindowLocator.find()
    if window is None:
        print("표시 중인 Discord 창을 찾지 못했어.", file=sys.stderr)
        return 1
    config = load_config()
    client = window.client_rect
    camera = DxgiCapture()
    try:
        if config.chat_region.auto:
            full = camera.capture(client)
            if full is None:
                print("Discord 전체 프레임을 받지 못했어.", file=sys.stderr)
                return 2
            local = detect_chat_region(full)
            region = local.translated(client.left, client.top)
            frame = full[local.top : local.bottom, local.left : local.right].copy()
        else:
            crop = config.chat_region
            region = Rect(
                client.left + round(client.width * crop.left_ratio),
                client.top + round(client.height * crop.top_ratio),
                client.left + round(client.width * crop.right_ratio),
                client.top + round(client.height * crop.bottom_ratio),
            )
            frame = camera.capture(region)
    finally:
        camera.close()
    if frame is None:
        print("프레임을 받지 못했어.", file=sys.stderr)
        return 2
    args.output.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(args.output), frame)
    print(f"hwnd={window.hwnd} dpi={window.dpi} region={region} output={args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
