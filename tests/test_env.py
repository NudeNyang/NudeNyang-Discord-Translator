from __future__ import annotations

import os
from pathlib import Path

from discord_translate_overlay.env import load_local_env


def test_load_local_env_reads_key_and_does_not_override(
    tmp_path: Path, monkeypatch
) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text(
        "# comment\nDEEPL_API_KEY=from-file\nQUOTED='quoted value'\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("DEEPL_API_KEY", "from-process")
    monkeypatch.delenv("QUOTED", raising=False)

    loaded = load_local_env([env_file])

    assert loaded == [env_file.resolve()]
    assert os.environ["DEEPL_API_KEY"] == "from-process"
    assert os.environ["QUOTED"] == "quoted value"
