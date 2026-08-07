from __future__ import annotations

import os
import re
import sys
from pathlib import Path

_ENV_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def load_local_env(paths: list[Path] | None = None) -> list[Path]:
    """Load local .env files without overwriting the process environment."""
    candidates = paths if paths is not None else _candidate_paths()
    loaded: list[Path] = []
    seen: set[Path] = set()
    for candidate in candidates:
        path = candidate.expanduser().resolve()
        if path in seen or not path.is_file():
            continue
        seen.add(path)
        _load_file(path)
        loaded.append(path)
    return loaded


def _candidate_paths() -> list[Path]:
    paths: list[Path] = []
    if getattr(sys, "frozen", False):
        paths.append(Path(sys.executable).resolve().parent / ".env")
    paths.append(Path.cwd() / ".env")
    if not getattr(sys, "frozen", False):
        paths.append(Path(__file__).resolve().parents[2] / ".env")
    return paths


def _load_file(path: Path) -> None:
    for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        name, separator, raw_value = line.partition("=")
        name = name.strip()
        if not separator or not _ENV_NAME.fullmatch(name):
            continue
        value = _unquote(raw_value.strip())
        os.environ.setdefault(name, value)


def _unquote(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1]
    return value
