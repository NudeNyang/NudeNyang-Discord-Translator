from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from platformdirs import user_config_dir

from .branding import DEFAULT_UPDATE_REPOSITORY
from .models import Language


@dataclass(slots=True)
class RegionConfig:
    auto: bool = True
    left_ratio: float = 0.29
    top_ratio: float = 0.044
    right_ratio: float = 0.985
    bottom_ratio: float = 0.965


@dataclass(slots=True)
class HotkeyConfig:
    toggle_translation: str = "F12"
    toggle_original: str = "Ctrl+Alt+O"
    hide_overlay: str = "Ctrl+Alt+H"
    copy_current: str = "Ctrl+Alt+C"


@dataclass(slots=True)
class AppConfig:
    target_language: Language = Language.KOREAN
    enabled: bool = True
    show_original: bool = False
    theme: str = "auto"
    ui_theme: str = "system"
    background_color: str = ""
    text_color: str = ""
    overlay_opacity: float = 1.0
    font_scale: float = 1.0
    capture_fps: int = 8
    stable_frames: int = 2
    change_threshold: float = 0.015
    ocr_device: str = "auto"
    translator: str = "hymt_1_8b"
    hymt_device: str = "auto"
    keep_local_model_warm: bool = True
    speech_style: str = "auto"
    auto_update: bool = True
    update_repository: str = DEFAULT_UPDATE_REPOSITORY
    discord_auto_restart_consent_granted: bool = False
    chat_region: RegionConfig = field(default_factory=RegionConfig)
    hotkeys: HotkeyConfig = field(default_factory=HotkeyConfig)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> AppConfig:
        data = dict(data)
        region = RegionConfig(**data.pop("chat_region", {}))
        hotkeys = HotkeyConfig(**data.pop("hotkeys", {}))
        # Removed prototype engines should migrate without requiring users to
        # delete their local settings file.
        if data.get("translator") in {"kanana", "original"}:
            data["translator"] = "hymt_1_8b"
        data.pop("kanana_device", None)
        data.pop("kanana_precision", None)
        if data.get("update_repository") == "NudeNyang/DiscordTranslateOverlay":
            data["update_repository"] = DEFAULT_UPDATE_REPOSITORY
        if data.get("speech_style", "auto") not in {"auto", "polite", "casual"}:
            data["speech_style"] = "auto"
        if data.get("ui_theme", "system") not in {"system", "light", "dark"}:
            data["ui_theme"] = "system"
        if "target_language" in data:
            data["target_language"] = Language(data["target_language"])
        return cls(**data, chat_region=region, hotkeys=hotkeys)


def default_config_path() -> Path:
    override = os.getenv("DISCORD_TRANSLATE_CONFIG")
    if override:
        return Path(override).expanduser().resolve()
    return Path(user_config_dir("DiscordTranslateOverlay", "LocalTools")) / "settings.json"


def load_config(path: Path | None = None) -> AppConfig:
    path = path or default_config_path()
    if not path.exists():
        return AppConfig()
    data = json.loads(path.read_text(encoding="utf-8"))
    return AppConfig.from_dict(data)


def save_config(config: AppConfig, path: Path | None = None) -> Path:
    path = path or default_config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(asdict(config), ensure_ascii=False, indent=2), encoding="utf-8")
    return path
