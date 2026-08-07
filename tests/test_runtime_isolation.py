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


def test_kanana_runtime_declares_its_own_model_dependencies() -> None:
    runtime_path = PROJECT_ROOT / "runtime" / "kanana" / "pyproject.toml"
    runtime = tomllib.loads(runtime_path.read_text(encoding="utf-8"))
    extras = runtime["project"]["optional-dependencies"]

    assert {"torch", "transformers", "bitsandbytes"} <= _requirement_names(extras["gpu"])
    assert {"torch", "transformers", "bitsandbytes"} <= _requirement_names(extras["cpu"])
