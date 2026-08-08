from __future__ import annotations

from .base import PlatformKind, PlatformServices

# This describes the intended package contract only. A signed/notarized macOS
# artifact and its updater are deliberately not advertised as supported yet.
MACOS = PlatformServices(
    kind=PlatformKind.MACOS,
    display_name="macOS (Apple Silicon)",
    release_asset_name="NudeTranslator-macOS-arm64.zip",
    llama_server_filename="llama-server",
    packaged_app_supported=False,
    auto_update_supported=False,
    global_hotkeys_supported=False,
)

