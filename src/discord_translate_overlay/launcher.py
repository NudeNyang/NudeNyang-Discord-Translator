from __future__ import annotations

import sys
from collections.abc import Sequence
from pathlib import Path


def should_run_dom(executable: str, arguments: Sequence[str]) -> bool:
    return Path(executable).stem.casefold() == "nudetranslatordom" or "--dom" in arguments


def main() -> int | None:
    if should_run_dom(sys.executable, sys.argv[1:]):
        if "--dom" in sys.argv:
            sys.argv.remove("--dom")
        from .experimental_dom.controller import main as dom_main

        return dom_main()

    from .app import main as overlay_main

    return overlay_main()
