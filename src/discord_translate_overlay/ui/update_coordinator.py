from __future__ import annotations

import queue
import sys
import threading
from collections.abc import Callable
from pathlib import Path

from platformdirs import user_cache_dir
from PySide6.QtCore import QTimer

from .. import __version__
from ..config import AppConfig
from ..updater import (
    GitHubReleaseClient,
    ReleaseInfo,
    StagedUpdate,
    launch_staged_update,
    stage_update,
)


class UpdateCoordinator:
    """Check GitHub Releases without blocking Qt and stage verified packaged updates."""

    def __init__(
        self,
        config: AppConfig,
        *,
        notify: Callable[[str, str], None],
        ready: Callable[[StagedUpdate], None],
    ) -> None:
        self.config = config
        self.notify = notify
        self.ready = ready
        self.staged: StagedUpdate | None = None
        self._results: queue.Queue[tuple[ReleaseInfo | None, StagedUpdate | None, str]] = (
            queue.Queue()
        )
        self._poll_timer = QTimer()
        self._poll_timer.timeout.connect(self._poll)
        self._poll_timer.start(250)

    def start(self, delay_ms: int = 5000) -> None:
        if self.config.auto_update:
            QTimer.singleShot(delay_ms, self.check)

    def check(self) -> None:
        repository = self.config.update_repository

        def worker() -> None:
            client = None
            try:
                client = GitHubReleaseClient(repository)
                release = client.check_for_update(__version__)
                staged = self._prepare(client, release) if release is not None else None
                self._results.put((release, staged, ""))
            except Exception as exc:
                self._results.put((None, None, str(exc)))
            finally:
                if client is not None:
                    client.close()

        threading.Thread(target=worker, name="release-update-check", daemon=True).start()

    def _prepare(
        self, client: GitHubReleaseClient, release: ReleaseInfo
    ) -> StagedUpdate | None:
        if not getattr(sys, "frozen", False):
            return None
        update_root = Path(user_cache_dir("NudeTranslator", "NudeNyang")) / "updates"
        archive = client.download(release, update_root / "downloads" / release.version)
        return stage_update(archive, release.version, update_root)

    def _poll(self) -> None:
        try:
            release, staged, error = self._results.get_nowait()
        except queue.Empty:
            return
        if error:
            # Automatic checks stay quiet when offline or before the first Release exists.
            return
        if release is None:
            return
        if staged is None:
            self.notify(
                f"{release.version} 업데이트",
                "새 GitHub Release가 있어. 패키지 실행 파일에서는 자동으로 내려받아.",
            )
            return
        self.staged = staged
        self.ready(staged)

    def install_and_restart(self) -> bool:
        if self.staged is None:
            return False
        launch_staged_update(self.staged)
        return True

    def close(self) -> None:
        self._poll_timer.stop()
