from __future__ import annotations

import hashlib
import os
import re
import stat
import subprocess
import sys
import zipfile
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import httpx

from .platforms import current_platform_services

GITHUB_API_VERSION = "2026-03-10"
_REPOSITORY_PATTERN = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
_VERSION_PATTERN = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$")


class UnsafeUpdateArchiveError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class ReleaseAsset:
    name: str
    download_url: str
    size: int
    sha256: str


@dataclass(frozen=True, slots=True)
class ReleaseInfo:
    version: str
    tag: str
    page_url: str
    notes: str
    asset: ReleaseAsset


@dataclass(frozen=True, slots=True)
class StagedUpdate:
    version: str
    payload_directory: Path
    installer_script: Path
    install_directory: Path
    executable_name: str


class GitHubReleaseClient:
    def __init__(
        self,
        repository: str,
        *,
        asset_name: str | None = None,
        http_client: httpx.Client | None = None,
    ) -> None:
        if not _REPOSITORY_PATTERN.fullmatch(repository.strip()):
            raise ValueError("업데이트 저장소는 owner/repository 형식이어야 해.")
        self.repository = repository.strip()
        self.asset_name = asset_name or current_platform_services().release_asset_name
        if not self.asset_name:
            raise ValueError("현재 운영체제의 업데이트 파일 이름이 정의되지 않았어.")
        self._owns_client = http_client is None
        self.http = http_client or httpx.Client(
            follow_redirects=True,
            timeout=httpx.Timeout(30.0, connect=10.0),
            headers={
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": GITHUB_API_VERSION,
                "User-Agent": "Nude-Translator-Updater",
            },
        )

    def check_for_update(self, current_version: str) -> ReleaseInfo | None:
        current = _version_tuple(current_version)
        response = self.http.get(
            f"https://api.github.com/repos/{self.repository}/releases/latest"
        )
        if response.status_code == 404:
            return None
        response.raise_for_status()
        payload = response.json()
        if payload.get("draft") or payload.get("prerelease"):
            return None
        tag = str(payload.get("tag_name", ""))
        latest = _version_tuple(tag)
        if latest <= current:
            return None
        asset_payload = next(
            (
                item
                for item in payload.get("assets", [])
                if str(item.get("name", "")) == self.asset_name
            ),
            None,
        )
        if asset_payload is None:
            return None
        digest = str(asset_payload.get("digest", ""))
        if not digest.startswith("sha256:") or len(digest) != 71:
            return None
        return ReleaseInfo(
            version=".".join(str(part) for part in latest),
            tag=tag,
            page_url=str(payload.get("html_url", "")),
            notes=str(payload.get("body", "")),
            asset=ReleaseAsset(
                name=self.asset_name,
                download_url=str(asset_payload.get("browser_download_url", "")),
                size=int(asset_payload.get("size", 0)),
                sha256=digest.removeprefix("sha256:").lower(),
            ),
        )

    def download(
        self,
        release: ReleaseInfo,
        destination: Path,
        *,
        progress: Callable[[int, int], None] | None = None,
    ) -> Path:
        destination.mkdir(parents=True, exist_ok=True)
        final_path = destination / release.asset.name
        partial_path = final_path.with_suffix(final_path.suffix + ".part")
        digest = hashlib.sha256()
        written = 0
        try:
            with self.http.stream("GET", release.asset.download_url) as response:
                response.raise_for_status()
                with partial_path.open("wb") as output:
                    for chunk in response.iter_bytes(1024 * 1024):
                        output.write(chunk)
                        digest.update(chunk)
                        written += len(chunk)
                        if progress is not None:
                            progress(written, release.asset.size)
            if release.asset.size and written != release.asset.size:
                raise ValueError("업데이트 파일 크기가 GitHub Release 정보와 달라.")
            if digest.hexdigest().lower() != release.asset.sha256:
                raise ValueError("업데이트 파일의 SHA-256 검증에 실패했어.")
            partial_path.replace(final_path)
            return final_path
        except Exception:
            partial_path.unlink(missing_ok=True)
            raise

    def close(self) -> None:
        if self._owns_client:
            self.http.close()


def extract_update_archive(archive: Path, destination: Path) -> Path:
    destination = destination.resolve()
    destination.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as zipped:
        for member in zipped.infolist():
            output = (destination / member.filename).resolve()
            if not output.is_relative_to(destination):
                raise UnsafeUpdateArchiveError("업데이트 압축 파일에 잘못된 경로가 있어.")
            mode = member.external_attr >> 16
            if stat.S_ISLNK(mode):
                raise UnsafeUpdateArchiveError("업데이트 압축 파일의 심볼릭 링크는 허용하지 않아.")
        zipped.extractall(destination)
    entries = list(destination.iterdir())
    if len(entries) == 1 and entries[0].is_dir():
        return entries[0]
    return destination


def stage_update(
    archive: Path,
    version: str,
    update_root: Path,
    *,
    executable: Path | None = None,
) -> StagedUpdate:
    executable = (executable or Path(sys.executable)).resolve()
    install_directory = executable.parent
    _validate_install_directory(install_directory, executable)
    version_directory = (update_root / version).resolve()
    payload_directory = extract_update_archive(archive, version_directory / "payload")
    packaged_executable = payload_directory / executable.name
    if not packaged_executable.is_file():
        raise ValueError(f"업데이트 파일에 {executable.name} 실행 파일이 없어.")
    script = version_directory / "install-update.ps1"
    script.write_text(
        _installer_script(
            payload_directory,
            install_directory,
            executable.name,
            os.getpid(),
        ),
        encoding="utf-8-sig",
    )
    return StagedUpdate(
        version=version,
        payload_directory=payload_directory,
        installer_script=script,
        install_directory=install_directory,
        executable_name=executable.name,
    )


def launch_staged_update(staged: StagedUpdate) -> None:
    creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    subprocess.Popen(
        [
            "powershell.exe",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(staged.installer_script),
        ],
        cwd=staged.installer_script.parent,
        creationflags=creation_flags,
        close_fds=True,
    )


def _validate_install_directory(directory: Path, executable: Path) -> None:
    if not executable.is_file() or executable.parent != directory:
        raise ValueError("현재 실행 파일의 설치 폴더를 확인하지 못했어.")
    anchor = Path(directory.anchor).resolve()
    if directory == anchor or directory == Path.home().resolve():
        raise ValueError("너무 넓은 폴더에는 자동 업데이트를 적용하지 않아.")


def _ps_literal(path: Path | str) -> str:
    return "'" + str(path).replace("'", "''") + "'"


def _installer_script(
    source: Path,
    destination: Path,
    executable_name: str,
    process_id: int,
) -> str:
    return f"""$ErrorActionPreference = 'Stop'
$source = {_ps_literal(source)}
$destination = {_ps_literal(destination)}
$executable = {_ps_literal(executable_name)}
Wait-Process -Id {process_id} -Timeout 90 -ErrorAction SilentlyContinue
$internal = Join-Path $destination '_internal'
if (Test-Path -LiteralPath $internal) {{ Remove-Item -LiteralPath $internal -Recurse -Force }}
Get-ChildItem -LiteralPath $source -Force | ForEach-Object {{
    $target = Join-Path $destination $_.Name
    Copy-Item -LiteralPath $_.FullName -Destination $target -Recurse -Force
}}
Start-Process `
    -FilePath (Join-Path $destination $executable) `
    -WorkingDirectory $destination `
    -WindowStyle Hidden
"""


def _version_tuple(version: str) -> tuple[int, int, int]:
    match = _VERSION_PATTERN.fullmatch(version.strip())
    if match is None:
        raise ValueError(f"지원하지 않는 버전 형식이야: {version}")
    return tuple(int(part) for part in match.groups())
