from __future__ import annotations

import sys
from functools import cache
from pathlib import Path

from .base import PlatformKind, PlatformServices
from .discord import DiscordDebugLauncher, UnsupportedDiscordDebugLauncher
from .macos import MACOS
from .windows import WINDOWS, extra_llama_server_candidates


@cache
def services_for(platform_name: str) -> PlatformServices:
    if platform_name == "win32":
        return WINDOWS
    if platform_name == "darwin":
        return MACOS
    return PlatformServices(
        kind=PlatformKind.UNSUPPORTED,
        display_name=platform_name or "알 수 없는 운영체제",
        release_asset_name="",
        llama_server_filename="llama-server",
        packaged_app_supported=False,
        auto_update_supported=False,
        global_hotkeys_supported=False,
    )


def current_platform_services() -> PlatformServices:
    return services_for(sys.platform)


def llama_server_candidates(executable: Path) -> tuple[Path, ...]:
    services = current_platform_services()
    candidates = list(services.bundled_llama_server_candidates(executable))
    if services.kind is PlatformKind.WINDOWS:
        candidates.extend(extra_llama_server_candidates())
    return tuple(candidates)


def create_discord_debug_launcher() -> DiscordDebugLauncher:
    services = current_platform_services()
    if services.kind is PlatformKind.WINDOWS:
        from .windows_discord import WindowsDiscordDebugLauncher

        return WindowsDiscordDebugLauncher()
    return UnsupportedDiscordDebugLauncher(services.kind)


__all__ = [
    "PlatformKind",
    "PlatformServices",
    "create_discord_debug_launcher",
    "current_platform_services",
    "llama_server_candidates",
    "services_for",
]
