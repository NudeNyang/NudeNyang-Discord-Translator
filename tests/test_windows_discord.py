from pathlib import Path
from types import SimpleNamespace

import pytest

from discord_translate_overlay.platforms.discord import DiscordProcessChangedError
from discord_translate_overlay.platforms.windows_discord import (
    WindowsDiscordDebugLauncher,
    discord_debug_command,
)


class FakeProcess:
    def __init__(
        self,
        process_id: int,
        executable: Path,
        *,
        command: list[str] | None = None,
        started_at: float = 1.0,
    ) -> None:
        self.pid = process_id
        self._executable = executable
        self._command = command or [str(executable)]
        self._started_at = started_at
        self.terminated = False
        self.killed = False

    def name(self) -> str:
        return self._executable.name

    def cmdline(self) -> list[str]:
        return self._command

    def exe(self) -> str:
        return str(self._executable)

    def create_time(self) -> float:
        return self._started_at

    def terminate(self) -> None:
        self.terminated = True

    def kill(self) -> None:
        self.killed = True


def test_debug_command_contains_required_electron_port() -> None:
    executable = Path(r"C:\Discord\Discord.exe")

    assert discord_debug_command(executable) == [
        str(executable),
        "--force-renderer-accessibility",
        "--remote-debugging-port=9222",
    ]


def test_current_process_ignores_renderer_children(tmp_path: Path) -> None:
    executable = tmp_path / "Discord.exe"
    executable.write_bytes(b"exe")
    main = FakeProcess(10, executable, started_at=2.0)
    renderer = FakeProcess(
        11,
        executable,
        command=[str(executable), "--type=renderer"],
        started_at=3.0,
    )
    launcher = WindowsDiscordDebugLauncher(process_iter=lambda: [main, renderer])

    assert launcher.current_process() is not None
    assert launcher.current_process().process_id == 10


def test_restart_aborts_if_discord_changed_during_countdown(tmp_path: Path) -> None:
    executable = tmp_path / "Discord.exe"
    executable.write_bytes(b"exe")
    current = FakeProcess(22, executable)
    launcher = WindowsDiscordDebugLauncher(process_iter=lambda: [current])

    with pytest.raises(DiscordProcessChangedError):
        launcher.restart(expected_process_id=21)

    assert not current.terminated


def test_restart_closes_discord_and_starts_debug_renderer(tmp_path: Path) -> None:
    executable = tmp_path / "Discord.exe"
    executable.write_bytes(b"exe")
    main = FakeProcess(30, executable)
    renderer = FakeProcess(31, executable, command=[str(executable), "--type=renderer"])
    canary_executable = tmp_path / "DiscordCanary.exe"
    canary_executable.write_bytes(b"exe")
    canary = FakeProcess(32, canary_executable, started_at=0.5)
    starts: list[tuple[list[str], Path]] = []

    def fake_popen(command, *, cwd, close_fds):
        assert close_fds
        starts.append((command, cwd))
        return SimpleNamespace(pid=40)

    launcher = WindowsDiscordDebugLauncher(
        process_iter=lambda: [main, renderer, canary],
        popen=fake_popen,
        wait_procs=lambda processes, timeout: (list(processes), []),
    )

    started = launcher.restart(expected_process_id=30)

    assert main.terminated and renderer.terminated
    assert not canary.terminated
    assert starts == [(discord_debug_command(executable), executable.parent)]
    assert started.process_id == 40


def test_installed_discord_can_be_launched_when_not_running(tmp_path: Path) -> None:
    executable = tmp_path / "Discord" / "app-1.2.3" / "Discord.exe"
    executable.parent.mkdir(parents=True)
    executable.write_bytes(b"exe")
    starts: list[list[str]] = []
    launcher = WindowsDiscordDebugLauncher(
        local_app_data=tmp_path,
        process_iter=lambda: [],
        popen=lambda command, **_kwargs: (
            starts.append(command) or SimpleNamespace(pid=50)
        ),
        wait_procs=lambda processes, timeout: (list(processes), []),
    )

    started = launcher.restart(expected_process_id=None)

    assert starts == [discord_debug_command(executable.resolve())]
    assert started.process_id == 50
