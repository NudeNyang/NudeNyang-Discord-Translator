from __future__ import annotations

import subprocess
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path


class PlatformKind(StrEnum):
    WINDOWS = "windows"
    MACOS = "macos"
    UNSUPPORTED = "unsupported"


@dataclass(frozen=True, slots=True)
class PlatformServices:
    """Small, import-safe boundary for operating-system-specific behavior."""

    kind: PlatformKind
    display_name: str
    release_asset_name: str
    llama_server_filename: str
    packaged_app_supported: bool
    auto_update_supported: bool
    global_hotkeys_supported: bool

    def bundled_llama_server_candidates(self, executable: Path) -> tuple[Path, ...]:
        adjacent = executable.parent / "runtime" / "llama" / self.llama_server_filename
        if self.kind is PlatformKind.MACOS:
            # A future .app bundle runs from Contents/MacOS while immutable
            # resources normally live below Contents/Resources.
            resources = (
                executable.parent.parent
                / "Resources"
                / "runtime"
                / "llama"
                / self.llama_server_filename
            )
            return adjacent, resources
        return (adjacent,)

    def subprocess_creation_flags(self) -> int:
        if self.kind is PlatformKind.WINDOWS:
            return getattr(subprocess, "CREATE_NO_WINDOW", 0)
        return 0

    @property
    def llama_server_command_names(self) -> tuple[str, ...]:
        if self.kind is PlatformKind.WINDOWS:
            return "llama-server.exe", "llama-server"
        return ("llama-server",)
