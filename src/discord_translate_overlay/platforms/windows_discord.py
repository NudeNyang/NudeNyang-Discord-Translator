from __future__ import annotations

import os
import subprocess
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Any

import psutil

from .discord import DiscordProcess, DiscordProcessChangedError

_DISCORD_EXECUTABLES = ("Discord.exe", "DiscordPTB.exe", "DiscordCanary.exe")
_DISCORD_INSTALL_DIRS = (
    ("Discord", "Discord.exe"),
    ("DiscordPTB", "DiscordPTB.exe"),
    ("DiscordCanary", "DiscordCanary.exe"),
)
_DISCORD_EXECUTABLE_NAMES = {name.casefold() for name in _DISCORD_EXECUTABLES}


class WindowsDiscordDebugLauncher:
    def __init__(
        self,
        *,
        local_app_data: Path | None = None,
        process_iter: Callable[[], Iterable[Any]] | None = None,
        popen: Callable[..., Any] | None = None,
        wait_procs: Callable[..., Any] | None = None,
    ) -> None:
        configured_local_app_data = os.getenv("LOCALAPPDATA", "").strip()
        self.local_app_data = (
            local_app_data
            if local_app_data is not None
            else Path(configured_local_app_data) if configured_local_app_data else None
        )
        self._process_iter = process_iter or psutil.process_iter
        self._popen = popen or subprocess.Popen
        self._wait_procs = wait_procs or psutil.wait_procs

    @property
    def available(self) -> bool:
        return self.current_process() is not None or self._installed_executable() is not None

    def current_process(self) -> DiscordProcess | None:
        candidates: list[tuple[float, DiscordProcess]] = []
        for process in self._discord_processes():
            try:
                command = process.cmdline()
                if any(argument.startswith("--type=") for argument in command):
                    continue
                executable = Path(process.exe())
                candidates.append(
                    (
                        float(process.create_time()),
                        DiscordProcess(int(process.pid), executable),
                    )
                )
            except (psutil.Error, OSError, ValueError):
                continue
        if not candidates:
            return None
        return max(candidates, key=lambda candidate: candidate[0])[1]

    def restart(
        self,
        *,
        expected_process_id: int | None,
        port: int = 9222,
    ) -> DiscordProcess:
        current = self.current_process()
        current_id = current.process_id if current is not None else None
        if expected_process_id != current_id:
            raise DiscordProcessChangedError(
                "Discord가 카운트다운 도중 다시 실행되어 자동 재시작을 취소했어."
            )
        executable = current.executable if current is not None else self._installed_executable()
        if executable is None or not executable.is_file():
            raise FileNotFoundError("Discord 설치 경로를 찾지 못했어.")

        selected_name = executable.name.casefold()
        processes = [
            process
            for process in self._discord_processes()
            if self._process_name(process) == selected_name
        ]
        for process in processes:
            try:
                process.terminate()
            except psutil.Error:
                continue
        _gone, alive = self._wait_procs(processes, timeout=5)
        for process in alive:
            try:
                process.kill()
            except psutil.Error:
                continue
        if alive:
            self._wait_procs(alive, timeout=3)

        command = discord_debug_command(executable, port)
        started = self._popen(
            command,
            cwd=executable.parent,
            close_fds=True,
        )
        return DiscordProcess(int(started.pid), executable)

    def _discord_processes(self) -> list[Any]:
        matches: list[Any] = []
        for process in self._process_iter():
            try:
                if process.name().casefold() in _DISCORD_EXECUTABLE_NAMES:
                    matches.append(process)
            except (psutil.Error, OSError):
                continue
        return matches

    @staticmethod
    def _process_name(process: Any) -> str:
        try:
            return str(process.name()).casefold()
        except (psutil.Error, OSError):
            return ""

    def _installed_executable(self) -> Path | None:
        if self.local_app_data is None:
            return None
        for directory_name, executable_name in _DISCORD_INSTALL_DIRS:
            root = self.local_app_data / directory_name
            versions = sorted(root.glob("app-*"), reverse=True)
            for version in versions:
                executable = version / executable_name
                if executable.is_file():
                    return executable.resolve()
        return None


def discord_debug_command(executable: Path, port: int = 9222) -> list[str]:
    return [
        str(executable),
        "--force-renderer-accessibility",
        f"--remote-debugging-port={port}",
    ]
