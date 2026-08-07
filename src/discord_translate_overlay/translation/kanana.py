from __future__ import annotations

import importlib.util
import json
import os
import re
import subprocess
import sys
import threading
from pathlib import Path
from typing import Any

import psutil
from platformdirs import user_cache_dir, user_data_dir

from ..models import Language
from .base import Translator

MODEL_ID = "kakaocorp/kanana-2-1.3b-instruct"
# Remote model code is executed by Transformers, so keep it pinned to a reviewed commit.
MODEL_REVISION = "bf4786aa2a1908adce942d53976270132732f720"
MODEL_DOWNLOAD_BYTES = 2_593_309_962
MODEL_WEIGHT_BYTES = 2_582_997_160
MIN_CUDA_FREE_BYTES = 4 * 1024**3
MIN_CPU_FREE_BYTES = 7 * 1024**3
MIN_INT4_CUDA_FREE_BYTES = 2 * 1024**3
MIN_INT4_CPU_FREE_BYTES = 4 * 1024**3

_LANGUAGE_NAME = {
    Language.KOREAN: "한국어",
    Language.ENGLISH: "영어",
    Language.JAPANESE: "일본어",
}

_MODEL_FILE_PATTERNS = (
    "LICENSE",
    "README.md",
    "chat_template.jinja",
    "config.json",
    "configuration_kanana2_tiny.py",
    "generation_config.json",
    "model.safetensors",
    "modeling_kanana2_tiny.py",
    "tokenizer.json",
    "tokenizer_config.json",
)


class KananaTranslator(Translator):
    """RPC client for the CUDA-isolated Kanana worker process."""

    display_name = "Kanana-2 1.3B (로컬)"
    cache_namespace = f"kanana-2-1.3b:{MODEL_REVISION[:12]}:prompt-v1"

    def __init__(
        self,
        *,
        device: str = "auto",
        cache_dir: Path | None = None,
        precision: str = "int4",
        runtime_python: Path | None = None,
    ) -> None:
        if device not in {"auto", "cuda", "cpu"}:
            raise ValueError(f"지원하지 않는 Kanana 장치 설정이야: {device}")
        self.requested_device = device
        if precision not in {"int4", "native"}:
            raise ValueError(f"지원하지 않는 Kanana 정밀도 설정이야: {precision}")
        self.precision = precision
        self.cache_dir = cache_dir or default_model_cache_dir()
        self.runtime_python = runtime_python or default_runtime_python()
        self._process: subprocess.Popen[str] | None = None
        self._stderr_handle: Any | None = None
        self._request_lock = threading.Lock()
        self._device = ""
        self.runtime_metrics: dict[str, float] = {}

    @property
    def selected_device(self) -> str:
        return self._device or self.requested_device

    def translate(self, text: str, source: Language, target: Language) -> str:
        return self.translate_many([(text, source)], target)[0]

    def translate_many(
        self,
        items: list[tuple[str, Language]],
        target: Language,
    ) -> list[str]:
        if not items:
            return []
        with self._request_lock:
            self._ensure_worker()
            assert self._process is not None
            assert self._process.stdin is not None
            assert self._process.stdout is not None
            request = {
                "items": [
                    {"text": text, "source": source.value}
                    for text, source in items
                ],
                "target": target.value,
            }
            try:
                self._process.stdin.write(json.dumps(request, ensure_ascii=False) + "\n")
                self._process.stdin.flush()
                response_line = self._process.stdout.readline()
            except (BrokenPipeError, OSError) as exc:
                raise RuntimeError("Kanana worker와 통신이 끊겼어.") from exc
            if not response_line:
                code = self._process.poll()
                raise RuntimeError(
                    f"Kanana worker가 응답 없이 종료됐어(exit code: {code}). "
                    f"로그: {default_worker_log_path()}"
                )
            response = json.loads(response_line)
            if error := response.get("error"):
                raise RuntimeError(f"Kanana worker 오류: {error}")
            self._device = str(response.get("device", ""))
            self.runtime_metrics = {
                str(key): float(value)
                for key, value in response.get("metrics", {}).items()
            }
            return [str(value) for value in response["results"]]

    def _ensure_worker(self) -> None:
        if self._process is not None and self._process.poll() is None:
            return
        if not self.runtime_python.is_file():
            raise RuntimeError(
                "Kanana 전용 런타임이 없어. PowerShell에서 "
                "`scripts\\setup_kanana_runtime.ps1`을 한 번 실행해줘."
            )
        log_path = default_worker_log_path()
        log_path.parent.mkdir(parents=True, exist_ok=True)
        self._stderr_handle = log_path.open("a", encoding="utf-8")
        environment = os.environ.copy()
        source_dir = Path(__file__).resolve().parents[2]
        existing_pythonpath = environment.get("PYTHONPATH", "")
        environment["PYTHONPATH"] = os.pathsep.join(
            value for value in (str(source_dir), existing_pythonpath) if value
        )
        command = [
            str(self.runtime_python),
            "-m",
            "discord_translate_overlay.translation.kanana_worker",
            "--device",
            self.requested_device,
            "--precision",
            self.precision,
            "--cache-dir",
            str(self.cache_dir),
        ]
        creationflags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
        self._process = subprocess.Popen(
            command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=self._stderr_handle,
            text=True,
            encoding="utf-8",
            bufsize=1,
            env=environment,
            creationflags=creationflags,
        )

    def close(self) -> None:
        process, self._process = self._process, None
        if process is not None and process.poll() is None:
            try:
                assert process.stdin is not None
                process.stdin.write('{"command":"close"}\n')
                process.stdin.flush()
                process.wait(timeout=3)
            except (BrokenPipeError, OSError, subprocess.TimeoutExpired):
                process.terminate()
        if self._stderr_handle is not None:
            self._stderr_handle.close()
            self._stderr_handle = None


class KananaInferenceEngine:
    """In-process engine used only inside the dedicated Kanana runtime."""

    def __init__(
        self,
        *,
        device: str = "auto",
        cache_dir: Path | None = None,
        precision: str = "int4",
        max_new_tokens: int = 96,
        batch_size: int = 2,
    ) -> None:
        if device not in {"auto", "cuda", "cpu"}:
            raise ValueError(f"지원하지 않는 Kanana 장치 설정이야: {device}")
        if precision not in {"int4", "native"}:
            raise ValueError(f"지원하지 않는 Kanana 정밀도 설정이야: {precision}")
        self.requested_device = device
        self.precision = precision
        self.cache_dir = cache_dir or default_model_cache_dir()
        self.max_new_tokens = max_new_tokens
        self.batch_size = max(1, batch_size)
        self._load_lock = threading.Lock()
        self._model: Any | None = None
        self._tokenizer: Any | None = None
        self._torch: Any | None = None
        self._device = ""

    @staticmethod
    def dependencies_installed() -> bool:
        return all(importlib.util.find_spec(name) is not None for name in ("torch", "transformers"))

    @property
    def selected_device(self) -> str:
        return self._device or self.requested_device

    def translate_many(
        self,
        items: list[tuple[str, Language]],
        target: Language,
    ) -> list[str]:
        if not items:
            return []
        self._ensure_loaded()
        results: list[str] = []
        for start in range(0, len(items), self.batch_size):
            results.extend(self._generate_batch(items[start : start + self.batch_size], target))
        return results

    def _ensure_loaded(self) -> None:
        if self._model is not None:
            return
        with self._load_lock:
            if self._model is not None:
                return
            if not self.dependencies_installed():
                raise RuntimeError(
                    "Kanana worker 실행 구성요소가 없어. 전용 런타임을 다시 설치해줘."
                )

            import torch
            import transformers
            from huggingface_hub import snapshot_download
            from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

            version = tuple(int(part) for part in re.findall(r"\d+", transformers.__version__)[:2])
            if version < (4, 57):
                raise RuntimeError("Kanana-2에는 transformers 4.57 이상이 필요해.")

            minimum_gpu = (
                MIN_INT4_CUDA_FREE_BYTES
                if self.precision == "int4"
                else MIN_CUDA_FREE_BYTES
            )
            device = _select_device(torch, self.requested_device, minimum_gpu)
            available_ram = psutil.virtual_memory().available
            minimum_ram = (
                MIN_INT4_CPU_FREE_BYTES
                if self.precision == "int4"
                else MIN_CPU_FREE_BYTES
            )
            if device == "cpu" and available_ram < minimum_ram:
                free_gib = available_ram / 1024**3
                raise RuntimeError(
                    f"Kanana CPU 실행에 필요한 여유 메모리가 부족해(현재 {free_gib:.1f}GB). "
                    f"최소 {minimum_ram / 1024**3:.0f}GB를 확보하거나 "
                    "DeepL/원문 표시 모드를 사용해줘."
                )

            self.cache_dir.mkdir(parents=True, exist_ok=True)
            model_dir = self.cache_dir / MODEL_REVISION
            if not _model_download_is_complete(model_dir):
                snapshot_download(
                    repo_id=MODEL_ID,
                    revision=MODEL_REVISION,
                    local_dir=model_dir,
                    allow_patterns=list(_MODEL_FILE_PATTERNS),
                )
            if not _model_download_is_complete(model_dir):
                raise RuntimeError("Kanana 모델 다운로드가 완전하지 않아. 다시 실행해줘.")
            tokenizer = AutoTokenizer.from_pretrained(
                model_dir,
                trust_remote_code=True,
                local_files_only=True,
            )
            tokenizer.padding_side = "left"
            if tokenizer.pad_token_id is None:
                tokenizer.pad_token = tokenizer.eos_token

            dtype = torch.bfloat16 if device == "cuda" else torch.float32
            model_kwargs: dict[str, Any] = {
                "trust_remote_code": True,
                "local_files_only": True,
                "dtype": dtype,
                "low_cpu_mem_usage": True,
            }
            if self.precision == "int4":
                if importlib.util.find_spec("bitsandbytes") is None:
                    raise RuntimeError("Kanana INT4 경량 모드에는 bitsandbytes가 필요해.")
                model_kwargs["quantization_config"] = BitsAndBytesConfig(
                    load_in_4bit=True,
                    bnb_4bit_quant_type="nf4",
                    bnb_4bit_compute_dtype=dtype,
                )
                model_kwargs["device_map"] = {"": device}

            model = AutoModelForCausalLM.from_pretrained(
                model_dir,
                **model_kwargs,
            )
            if self.precision == "native":
                model.to(device)
            model.eval()

            self._torch = torch
            self._tokenizer = tokenizer
            self._model = model
            self._device = device

    def _generate_batch(
        self,
        items: list[tuple[str, Language]],
        target: Language,
    ) -> list[str]:
        prompts = [self._render_prompt(text, source, target) for text, source in items]
        encoded = self._tokenizer(
            prompts,
            padding=True,
            truncation=True,
            max_length=512,
            return_tensors="pt",
        )
        encoded = {name: tensor.to(self._device) for name, tensor in encoded.items()}
        input_width = encoded["input_ids"].shape[1]
        with self._torch.inference_mode():
            output = self._model.generate(
                **encoded,
                max_new_tokens=self.max_new_tokens,
                do_sample=False,
                use_cache=True,
                pad_token_id=self._tokenizer.pad_token_id,
                eos_token_id=self._tokenizer.eos_token_id,
            )
        generated = output[:, input_width:]
        decoded = self._tokenizer.batch_decode(generated, skip_special_tokens=True)
        cleaned = [_clean_translation(text) for text in decoded]
        return [result or original for result, (original, _) in zip(cleaned, items, strict=True)]

    def _render_prompt(self, text: str, source: Language, target: Language) -> str:
        source_name = _LANGUAGE_NAME.get(source, "원문 언어")
        target_name = _LANGUAGE_NAME[target]
        messages = [
            {
                "role": "system",
                "content": (
                    "너는 Discord 채팅 전문 번역기다. 원문의 뜻과 말투를 유지하고 사용자명, "
                    "게임명, URL, 이모지는 보존한다. 설명이나 따옴표 없이 번역문만 출력한다."
                ),
            },
            {
                "role": "user",
                "content": f"다음 {source_name} 문장을 {target_name}로 번역해.\n\n{text}",
            },
        ]
        return str(
            self._tokenizer.apply_chat_template(
                messages,
                tokenize=False,
                add_generation_prompt=True,
            )
        )

    def runtime_metrics(self) -> dict[str, float]:
        metrics = {
            "process_rss_mib": round(psutil.Process(os.getpid()).memory_info().rss / 1024**2, 1),
            "cuda_allocated_mib": 0.0,
            "cuda_reserved_mib": 0.0,
        }
        if self._device == "cuda":
            metrics["cuda_allocated_mib"] = round(
                self._torch.cuda.memory_allocated() / 1024**2, 1
            )
            metrics["cuda_reserved_mib"] = round(
                self._torch.cuda.memory_reserved() / 1024**2, 1
            )
        return metrics

    def close(self) -> None:
        self._model = None
        self._tokenizer = None
        if self._torch is not None and self._device == "cuda":
            self._torch.cuda.empty_cache()


def default_model_cache_dir() -> Path:
    return Path(user_cache_dir("DiscordTranslateOverlay", "LocalTools")) / "models" / "kanana-2"


def default_runtime_python() -> Path:
    override = os.getenv("KANANA_RUNTIME_PYTHON")
    if override:
        return Path(override).expanduser().resolve()
    project_runtime = (
        Path(__file__).resolve().parents[3]
        / "runtime"
        / "kanana"
        / ".venv"
        / "Scripts"
        / "python.exe"
    )
    if project_runtime.is_file():
        return project_runtime
    return (
        Path(user_data_dir("DiscordTranslateOverlay", "LocalTools"))
        / "runtime"
        / "kanana"
        / ".venv"
        / "Scripts"
        / "python.exe"
    )


def default_worker_log_path() -> Path:
    return Path(user_cache_dir("DiscordTranslateOverlay", "LocalTools")) / "kanana-worker.log"


def _model_download_is_complete(model_dir: Path) -> bool:
    weight = model_dir / "model.safetensors"
    return (
        weight.is_file()
        and weight.stat().st_size == MODEL_WEIGHT_BYTES
        and (model_dir / "config.json").is_file()
        and (model_dir / "tokenizer.json").is_file()
        and (model_dir / "modeling_kanana2_tiny.py").is_file()
    )


def _select_device(torch: Any, requested: str, minimum_cuda_free: int) -> str:
    cuda_available = bool(torch.cuda.is_available())
    if requested == "cuda" and not cuda_available:
        raise RuntimeError("NVIDIA CUDA를 선택했지만 PyTorch가 사용할 수 있는 GPU를 찾지 못했어.")
    if requested == "cpu":
        return "cpu"
    if cuda_available:
        free_bytes, _ = torch.cuda.mem_get_info()
        if free_bytes >= minimum_cuda_free:
            return "cuda"
        if requested == "cuda":
            free_gib = free_bytes / 1024**3
            raise RuntimeError(
                "Kanana용 GPU 여유 메모리가 부족해"
                f"(현재 {free_gib:.1f}GB, 최소 {minimum_cuda_free / 1024**3:.0f}GB)."
            )
    return "cpu"


def _clean_translation(text: str) -> str:
    cleaned = text.strip()
    cleaned = re.sub(r"^(?:번역(?:문| 결과)?|translation)\s*:\s*", "", cleaned, flags=re.I)
    if len(cleaned) >= 2 and cleaned[0] == cleaned[-1] and cleaned[0] in {'"', "'"}:
        cleaned = cleaned[1:-1].strip()
    return cleaned
