import json

from discord_translate_overlay.config import AppConfig, load_config, save_config


def test_new_desktop_and_update_preferences_round_trip(tmp_path) -> None:
    path = tmp_path / "settings.json"
    config = AppConfig()
    config.ui_theme = "dark"
    config.auto_update = False
    config.update_repository = "Example/CustomTranslator"
    config.hotkeys.toggle_translation = "Ctrl+Alt+T"

    save_config(config, path)
    restored = load_config(path)

    assert restored.ui_theme == "dark"
    assert not restored.auto_update
    assert restored.update_repository == "Example/CustomTranslator"
    assert restored.hotkeys.toggle_translation == "Ctrl+Alt+T"


def test_old_settings_receive_safe_new_defaults(tmp_path) -> None:
    path = tmp_path / "old.json"
    path.write_text(json.dumps({"enabled": False}), encoding="utf-8")

    restored = load_config(path)

    assert restored.ui_theme == "system"
    assert restored.auto_update
    assert restored.update_repository == "NudeNyang/Nude-Translator"


def test_old_update_repository_is_migrated(tmp_path) -> None:
    path = tmp_path / "old-repository.json"
    path.write_text(
        json.dumps({"update_repository": "NudeNyang/DiscordTranslateOverlay"}),
        encoding="utf-8",
    )

    restored = load_config(path)

    assert restored.update_repository == "NudeNyang/Nude-Translator"
