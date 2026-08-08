from __future__ import annotations

import tomllib
from pathlib import Path

from packaging.requirements import Requirement

PROJECT_ROOT = Path(__file__).resolve().parents[1]


def _requirement_names(requirements: list[str]) -> set[str]:
    return {Requirement(requirement).name for requirement in requirements}


def test_main_ocr_environment_never_installs_torch() -> None:
    main = tomllib.loads((PROJECT_ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    project = main["project"]
    requirements = list(project["dependencies"])
    for extra in project["optional-dependencies"].values():
        requirements.extend(extra)

    assert "torch" not in _requirement_names(requirements)
    assert "transformers" not in _requirement_names(requirements)
    assert "bitsandbytes" not in _requirement_names(requirements)


def test_windows_native_dependencies_are_not_installed_on_macos() -> None:
    main = tomllib.loads((PROJECT_ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    requirements = {
        Requirement(item).name: Requirement(item)
        for item in main["project"]["dependencies"]
    }

    assert str(requirements["dxcam"].marker) == 'sys_platform == "win32"'
    assert str(requirements["pywin32"].marker) == 'sys_platform == "win32"'
    assert "sys_platform == 'darwin'" in main["tool"]["uv"]["environments"]


def test_legacy_ocr_extras_are_windows_only() -> None:
    main = tomllib.loads((PROJECT_ROOT / "pyproject.toml").read_text(encoding="utf-8"))

    for extra_name in ("ocr-cpu", "ocr-gpu"):
        for item in main["project"]["optional-dependencies"][extra_name]:
            requirement = Requirement(item)
            assert str(requirement.marker) == 'sys_platform == "win32"'
