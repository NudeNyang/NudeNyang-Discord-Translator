from __future__ import annotations

import argparse
import json

import win32gui
import win32process


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("pid", type=int)
    args = parser.parse_args()
    windows: list[dict[str, object]] = []

    def visit(hwnd: int, _extra: object) -> None:
        if win32process.GetWindowThreadProcessId(hwnd)[1] != args.pid:
            return
        windows.append(
            {
                "hwnd": hwnd,
                "title": win32gui.GetWindowText(hwnd),
                "visible": bool(win32gui.IsWindowVisible(hwnd)),
                "rect": win32gui.GetWindowRect(hwnd),
                "ex_style": hex(win32gui.GetWindowLong(hwnd, win32con.GWL_EXSTYLE)),
            }
        )

    import win32con

    win32gui.EnumWindows(visit, None)
    print(json.dumps(windows, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
