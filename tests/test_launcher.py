from pathlib import Path

from discord_translate_overlay.launcher import should_run_dom


def test_dom_executable_name_selects_dom_mode() -> None:
    assert should_run_dom(r"C:\Apps\NudeTranslatorDOM.exe", [])


def test_dom_flag_selects_dom_mode_for_source_runs() -> None:
    assert should_run_dom(r"C:\Python\python.exe", ["--dom"])


def test_standard_executable_keeps_overlay_mode() -> None:
    assert not should_run_dom(r"C:\Apps\NudeTranslator.exe", [])


def test_packaged_dom_launcher_does_not_hide_future_settings_windows() -> None:
    launcher = (
        Path(__file__).parents[1] / "scripts" / "start_packaged_dom.ps1"
    ).read_text(encoding="utf-8")

    assert "-WindowStyle Hidden" not in launcher
