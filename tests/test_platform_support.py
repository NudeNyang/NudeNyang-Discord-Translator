from pathlib import Path

from discord_translate_overlay.platforms import PlatformKind, services_for


def test_windows_platform_contract_preserves_current_distribution() -> None:
    services = services_for("win32")

    assert services.kind is PlatformKind.WINDOWS
    assert services.release_asset_name == "NudeTranslator-Windows-x64.zip"
    assert services.llama_server_filename == "llama-server.exe"
    assert services.packaged_app_supported
    assert services.auto_update_supported
    assert services.global_hotkeys_supported


def test_macos_contract_reserves_native_app_and_llama_runtime_layout() -> None:
    services = services_for("darwin")
    executable = Path("/Applications/Nude Translator.app/Contents/MacOS/NudeTranslator")

    assert services.kind is PlatformKind.MACOS
    assert services.release_asset_name == "NudeTranslator-macOS-arm64.zip"
    assert services.llama_server_command_names == ("llama-server",)
    assert services.bundled_llama_server_candidates(executable) == (
        executable.parent / "runtime" / "llama" / "llama-server",
        Path(
            "/Applications/Nude Translator.app/Contents/Resources/"
            "runtime/llama/llama-server"
        ),
    )
    assert not services.packaged_app_supported
    assert not services.auto_update_supported
    assert not services.global_hotkeys_supported


def test_unknown_platform_is_explicitly_unsupported() -> None:
    services = services_for("freebsd14")

    assert services.kind is PlatformKind.UNSUPPORTED
    assert not services.release_asset_name
    assert not services.packaged_app_supported

