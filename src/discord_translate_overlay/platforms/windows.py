from __future__ import annotations

import os
from pathlib import Path

from .base import PlatformKind, PlatformServices

WINDOWS = PlatformServices(
    kind=PlatformKind.WINDOWS,
    display_name="Windows 10/11",
    release_asset_name="NudeTranslator-Windows-x64.zip",
    llama_server_filename="llama-server.exe",
    packaged_app_supported=True,
    auto_update_supported=True,
    global_hotkeys_supported=True,
)


def extra_llama_server_candidates() -> tuple[Path, ...]:
    local_app_data = os.getenv("LOCALAPPDATA")
    if not local_app_data:
        return ()
    package_root = Path(local_app_data) / "Microsoft" / "WinGet" / "Packages"
    return tuple(package_root.glob("ggml.llamacpp_*/llama-server.exe"))

