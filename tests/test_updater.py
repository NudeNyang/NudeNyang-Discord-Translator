import hashlib
import io
import zipfile

import httpx
import pytest

from discord_translate_overlay.updater import (
    GitHubReleaseClient,
    UnsafeUpdateArchiveError,
    extract_update_archive,
    stage_update,
)


def _release_payload(content: bytes) -> dict:
    digest = hashlib.sha256(content).hexdigest()
    return {
        "tag_name": "v0.2.0",
        "html_url": "https://github.com/NudeNyang/DiscordTranslateOverlay/releases/tag/v0.2.0",
        "body": "새 설정창",
        "draft": False,
        "prerelease": False,
        "assets": [
            {
                "name": "NudeTranslator-Windows-x64.zip",
                "browser_download_url": "https://example.test/NudeTranslator.zip",
                "size": len(content),
                "digest": f"sha256:{digest}",
            }
        ],
    }


def test_checks_latest_release_and_selects_signed_windows_asset() -> None:
    content = b"release-archive"

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/releases/latest")
        return httpx.Response(200, json=_release_payload(content))

    http = httpx.Client(transport=httpx.MockTransport(handler))
    client = GitHubReleaseClient("NudeNyang/DiscordTranslateOverlay", http_client=http)

    release = client.check_for_update("0.1.0")

    assert release is not None
    assert release.version == "0.2.0"
    assert release.asset.sha256 == hashlib.sha256(content).hexdigest()
    assert client.check_for_update("0.2.0") is None


def test_download_rejects_digest_mismatch(tmp_path) -> None:
    expected = b"expected"
    payload = _release_payload(expected)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "api.github.com":
            return httpx.Response(200, json=payload)
        return httpx.Response(200, content=b"tampered")

    http = httpx.Client(transport=httpx.MockTransport(handler))
    client = GitHubReleaseClient("NudeNyang/DiscordTranslateOverlay", http_client=http)
    release = client.check_for_update("0.1.0")
    assert release is not None

    with pytest.raises(ValueError, match="SHA-256"):
        client.download(release, tmp_path)


def test_extract_update_archive_blocks_path_traversal(tmp_path) -> None:
    archive = tmp_path / "bad.zip"
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w") as zipped:
        zipped.writestr("../outside.txt", "blocked")
    archive.write_bytes(stream.getvalue())

    with pytest.raises(UnsafeUpdateArchiveError):
        extract_update_archive(archive, tmp_path / "staged")


def test_stages_release_next_to_a_valid_installed_executable(tmp_path) -> None:
    install = tmp_path / "installed"
    install.mkdir()
    executable = install / "NudeTranslator.exe"
    executable.write_bytes(b"old")
    archive = tmp_path / "update.zip"
    with zipfile.ZipFile(archive, "w") as zipped:
        zipped.writestr("NudeTranslator/NudeTranslator.exe", b"new")
        zipped.writestr("NudeTranslator/_internal/runtime.txt", b"runtime")

    staged = stage_update(
        archive,
        "0.2.0",
        tmp_path / "updates",
        executable=executable,
    )

    assert (staged.payload_directory / "NudeTranslator.exe").read_bytes() == b"new"
    script = staged.installer_script.read_text(encoding="utf-8-sig")
    assert "Wait-Process" in script
    assert str(install) in script
