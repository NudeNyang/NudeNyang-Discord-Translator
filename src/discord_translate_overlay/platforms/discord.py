from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from .base import PlatformKind


class DiscordProcessChangedError(RuntimeError):
    pass


class DiscordDebugUnavailableError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class DiscordProcess:
    process_id: int
    executable: Path


class DiscordDebugLauncher(Protocol):
    @property
    def available(self) -> bool: ...

    def current_process(self) -> DiscordProcess | None: ...

    def restart(
        self,
        *,
        expected_process_id: int | None,
        port: int = 9222,
    ) -> DiscordProcess: ...


class UnsupportedDiscordDebugLauncher:
    def __init__(self, platform_kind: PlatformKind) -> None:
        self.platform_kind = platform_kind

    @property
    def available(self) -> bool:
        return False

    def current_process(self) -> DiscordProcess | None:
        return None

    def restart(
        self,
        *,
        expected_process_id: int | None,
        port: int = 9222,
    ) -> DiscordProcess:
        del expected_process_id, port
        raise DiscordDebugUnavailableError(
            f"{self.platform_kind.value}용 Discord 디버그 재시작은 아직 구현되지 않았어."
        )

