from __future__ import annotations

import logging
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
from typing import Any

import httpx
from platformdirs import user_cache_dir

from ..models import Language
from ..platforms import current_platform_services, llama_server_candidates
from .base import Translator

LOGGER = logging.getLogger("discord_translate_overlay")


@dataclass(frozen=True, slots=True)
class HyMtModel:
    key: str
    label: str
    repository: str
    filename: str
    expected_bytes: int
    expected_sha256: str


MODELS = {
    "1.8b": HyMtModel(
        key="1.8b",
        label="Hy-MT2 1.8B Q4_K_M",
        repository="tencent/Hy-MT2-1.8B-GGUF",
        filename="Hy-MT2-1.8B-Q4_K_M.gguf",
        expected_bytes=1_133_080_448,
        expected_sha256="dc5f44fcf1fa496ee7ad725982c0c8c553a4de00259b53af84c4b89fb0c06699",
    ),
    "7b": HyMtModel(
        key="7b",
        label="Hy-MT2 7B Q4_K_M",
        repository="tencent/Hy-MT2-7B-GGUF",
        filename="Hy-MT2-7B-Q4_K_M.gguf",
        expected_bytes=4_624_648_896,
        expected_sha256="9f96256500f3fc1ab4d64336b58f52a949a95ad7516b0c229476eef782f9f77b",
    ),
}

LANGUAGE_NAME = {
    Language.KOREAN: "Korean",
    Language.ENGLISH: "English",
    Language.JAPANESE: "Japanese",
    Language.CHINESE_SIMPLIFIED: "Simplified Chinese",
    Language.CHINESE_TRADITIONAL: "Traditional Chinese",
    Language.UNKNOWN: "the source language",
}

PROMPT_VERSION = "register-aware-v3"
SPEECH_STYLES = {"auto", "polite", "casual"}
PROTECTED_MARKER_RE = re.compile(r"(ZXQKEEP\d{3}QXZ)")
PROMPT_ECHO_HINTS = (
    "zxqkeep",
    "discord chat message",
    "preserve line breaks",
    "only output the translated",
    "additional explanation",
    "줄바꿈",
    "사용자명",
    "이모티콘",
    "추가 설명",
    "번역된 결과",
    "翻訳結果",
    "追加の説明",
    "只需输出",
    "额外解释",
    "額外解釋",
)


class HyMtTranslator(Translator):
    """Local Hy-MT2 GGUF client backed by a persistent llama.cpp server."""

    sends_text_externally = False

    def __init__(
        self,
        model_size: str = "1.8b",
        *,
        device: str = "auto",
        model_path: Path | None = None,
        server_path: Path | None = None,
        speech_style: str = "auto",
        startup_timeout: float = 240.0,
        request_timeout: float = 90.0,
    ) -> None:
        if model_size not in MODELS:
            raise ValueError(f"지원하지 않는 Hy-MT2 모델 크기야: {model_size}")
        if device not in {"auto", "cpu"}:
            raise ValueError(f"지원하지 않는 Hy-MT2 실행 장치야: {device}")
        if speech_style not in SPEECH_STYLES:
            raise ValueError(f"지원하지 않는 말투 설정이야: {speech_style}")
        self.model = MODELS[model_size]
        self.device = device
        self.speech_style = speech_style
        self.model_path = model_path or default_model_path(self.model)
        self.server_path = server_path
        self.startup_timeout = startup_timeout
        self.request_timeout = request_timeout
        self.display_name = f"{self.model.label} (로컬)"
        self.cache_namespace = (
            f"hy-mt2:{self.model.key}:q4_k_m:{PROMPT_VERSION}:{speech_style}"
        )
        self._process: subprocess.Popen[str] | None = None
        self._log_handle: Any | None = None
        self._port = 0
        self._lock = threading.RLock()

    def model_is_ready(self) -> bool:
        """Return whether the selected GGUF is already downloaded and verified."""
        return _model_is_verified(self.model_path, self.model)

    def prepare(self) -> None:
        """Download the model when needed and warm the local inference server."""
        with self._lock:
            self._ensure_server()

    def translate(self, text: str, source: Language, target: Language) -> str:
        if source == target or not text.strip():
            return text
        with self._lock:
            self._ensure_server()
            resolved_style = (
                detect_speech_style(text, source)
                if self.speech_style == "auto"
                else self.speech_style
            )
            translated_parts: list[str] = []
            for part in PROTECTED_MARKER_RE.split(text):
                if not part:
                    continue
                if PROTECTED_MARKER_RE.fullmatch(part) or not any(
                    character.isalnum() for character in part
                ):
                    translated_parts.append(part)
                    continue
                leading = part[: len(part) - len(part.lstrip())]
                trailing = part[len(part.rstrip()) :]
                core = part.strip()
                translated_parts.append(
                    f"{leading}{self._translate_fragment(core, source, target, resolved_style)}"
                    f"{trailing}"
                )
            return "".join(translated_parts)

    def _translate_fragment(
        self,
        text: str,
        source: Language,
        target: Language,
        resolved_style: str,
    ) -> str:
        prompt = _translation_prompt(text, source, target, resolved_style)
        result = self._complete(prompt, text)
        if resolved_style in {"polite", "casual"} and (
            detect_speech_style(result, target) != resolved_style
            or _has_register_artifact(result, target)
        ):
            rewritten = self._complete(
                _rewrite_style_prompt(result, target, resolved_style),
                result,
            )
            if _rewrite_preserves_content(result, rewritten):
                result = rewritten
            else:
                LOGGER.warning(
                    "말투 교정 결과가 지나치게 짧아 원래 번역을 보존했어: %r -> %r",
                    result,
                    rewritten,
                )
                result = _fallback_register_cleanup(result, target, resolved_style)
        result = _fallback_register_cleanup(result, target, resolved_style)
        return _clean_register_artifacts(result, target)

    def _complete(self, prompt: str, text: str) -> str:
        response = httpx.post(
            f"http://127.0.0.1:{self._port}/v1/chat/completions",
            json={
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": _max_output_tokens(text),
                "temperature": 0.2,
                "top_p": 0.6,
                "top_k": 20,
                "repeat_penalty": 1.05,
            },
            timeout=self.request_timeout,
        )
        response.raise_for_status()
        payload = response.json()
        choices = payload.get("choices", [])
        content = choices[0].get("message", {}).get("content", "") if choices else ""
        result = _clean_translation(str(content))
        if not result:
            raise RuntimeError("Hy-MT2가 번역문 대신 지시문 또는 빈 결과를 반환했어.")
        return result

    def _ensure_server(self) -> None:
        if self._process is not None and self._process.poll() is None:
            return
        self._ensure_model()
        executable = self.server_path or find_llama_server()
        if executable is None:
            raise RuntimeError(
                "llama.cpp 실행 파일이 없어. PowerShell에서 "
                "`scripts\\setup_hymt_runtime.ps1`을 한 번 실행해줘."
            )
        self._port = _free_tcp_port()
        log_path = default_server_log_path(self.model)
        log_path.parent.mkdir(parents=True, exist_ok=True)
        self._log_handle = log_path.open("a", encoding="utf-8")
        command = [
            str(executable),
            "--model",
            str(self.model_path),
            "--host",
            "127.0.0.1",
            "--port",
            str(self._port),
            "--ctx-size",
            "2048",
            "--parallel",
            "1",
            "--gpu-layers",
            "0" if self.device == "cpu" else "auto",
            "--no-webui",
        ]
        creationflags = current_platform_services().subprocess_creation_flags()
        self._process = subprocess.Popen(
            command,
            stdin=subprocess.DEVNULL,
            stdout=self._log_handle,
            stderr=self._log_handle,
            text=True,
            encoding="utf-8",
            creationflags=creationflags,
        )
        deadline = time.monotonic() + self.startup_timeout
        while time.monotonic() < deadline:
            if self._process.poll() is not None:
                raise RuntimeError(
                    f"Hy-MT2 로컬 서버가 시작 중 종료됐어. 로그: {log_path}"
                )
            try:
                health = httpx.get(
                    f"http://127.0.0.1:{self._port}/health",
                    timeout=1.0,
                )
                if health.status_code == 200:
                    return
            except httpx.HTTPError:
                pass
            time.sleep(0.25)
        self.close()
        raise RuntimeError(
            f"Hy-MT2 모델을 {self.startup_timeout:.0f}초 안에 불러오지 못했어. "
            f"로그: {log_path}"
        )

    def _ensure_model(self) -> None:
        if _model_is_verified(self.model_path, self.model):
            return
        if self.model_path.exists():
            self.model_path.unlink()
        self.model_path.parent.mkdir(parents=True, exist_ok=True)
        required = self.model.expected_bytes + 512 * 1024**2
        if shutil.disk_usage(self.model_path.parent).free < required:
            raise RuntimeError(
                f"{self.model.label} 다운로드 공간이 부족해. "
                f"최소 {required / 1024**3:.1f}GB의 여유 공간이 필요해."
            )
        partial = self.model_path.with_suffix(self.model_path.suffix + ".part")
        downloaded = partial.stat().st_size if partial.is_file() else 0
        if downloaded > self.model.expected_bytes:
            partial.unlink()
            downloaded = 0
        headers = {"Range": f"bytes={downloaded}-"} if downloaded else {}
        url = (
            f"https://huggingface.co/{self.model.repository}/resolve/main/"
            f"{self.model.filename}?download=true"
        )
        LOGGER.info(
            "%s 모델 다운로드 시작: %.2fGB",
            self.model.label,
            self.model.expected_bytes / 1024**3,
        )
        timeout = httpx.Timeout(30.0, read=None)
        with httpx.stream(
            "GET", url, headers=headers, follow_redirects=True, timeout=timeout
        ) as response:
            response.raise_for_status()
            append = downloaded > 0 and response.status_code == 206
            if not append:
                downloaded = 0
            mode = "ab" if append else "wb"
            next_log = 0.1
            with partial.open(mode) as output:
                for chunk in response.iter_bytes(1024 * 1024):
                    output.write(chunk)
                    downloaded += len(chunk)
                    ratio = downloaded / self.model.expected_bytes
                    if ratio >= next_log:
                        LOGGER.info("%s 모델 다운로드 %.0f%%", self.model.label, ratio * 100)
                        next_log += 0.1
        if not _model_is_complete(partial, self.model.expected_bytes):
            actual = partial.stat().st_size if partial.exists() else 0
            raise RuntimeError(
                f"Hy-MT2 모델 다운로드 크기가 맞지 않아"
                f"({actual:,}/{self.model.expected_bytes:,} bytes)."
            )
        actual_sha256 = _file_sha256(partial)
        if actual_sha256 != self.model.expected_sha256:
            partial.unlink(missing_ok=True)
            raise RuntimeError(
                "Hy-MT2 모델 무결성 검증에 실패했어. 손상된 다운로드 파일을 삭제했어."
            )
        partial.replace(self.model_path)
        _hash_marker(self.model_path).write_text(actual_sha256, encoding="ascii")
        LOGGER.info("%s 모델 다운로드 완료: %s", self.model.label, self.model_path)

    def close(self) -> None:
        with self._lock:
            process, self._process = self._process, None
            if process is not None and process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
            if self._log_handle is not None:
                self._log_handle.close()
                self._log_handle = None


def default_model_cache_dir() -> Path:
    return Path(user_cache_dir("DiscordTranslateOverlay", "LocalTools")) / "models" / "hy-mt2"


def default_model_path(model: HyMtModel) -> Path:
    return default_model_cache_dir() / model.key / model.filename


def default_server_log_path(model: HyMtModel) -> Path:
    return (
        Path(user_cache_dir("DiscordTranslateOverlay", "LocalTools"))
        / f"hy-mt2-{model.key}-server.log"
    )


def find_llama_server() -> Path | None:
    override = os.getenv("LLAMA_SERVER_PATH", "").strip()
    candidates: list[Path] = []
    if override:
        candidates.append(Path(override).expanduser())
    services = current_platform_services()
    candidates.extend(llama_server_candidates(Path(sys.executable)))
    for command_name in services.llama_server_command_names:
        discovered = shutil.which(command_name)
        if discovered:
            candidates.append(Path(discovered))
    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()
    return None


def _translation_prompt(
    text: str,
    source: Language,
    target: Language,
    speech_style: str = "auto",
) -> str:
    del speech_style
    target_name = LANGUAGE_NAME[target]
    source_name = LANGUAGE_NAME[source]
    return (
        f"Translate the following {source_name} text into {target_name}.\n"
        "Translate every clause and preserve every piece of information without "
        "adding or omitting anything.\n"
        "Preserve paragraph boundaries and line breaks where possible.\n"
        "Only output the translated result without an explanation.\n\n"
        f"{text}"
    )


def detect_speech_style(text: str, source: Language) -> str:
    """Classify explicit polite/casual cues while leaving ambiguous text neutral."""
    normalized = text.strip()
    if not normalized:
        return "neutral"
    if source == Language.KOREAN:
        if re.search(
            r"(?:습니다|습니까|ㅂ니다|세요|십시오|해요|예요|이에요|네요|군요|죠|요)"
            r"(?:[,.!?，。！？、…~]|$)",
            normalized,
        ):
            return "polite"
        return "casual"
    if source == Language.JAPANESE:
        if re.search(
            r"(?:です|ます|ました|ません|でしょう|ください|ございます|お願い(?:し)?ます)"
            r"(?:[,，。！？!?、…]|$)",
            normalized,
        ):
            return "polite"
        return "casual"
    if source == Language.ENGLISH:
        lower = normalized.casefold()
        if re.search(
            r"\b(?:please|thank you|would you|could you|may i|excuse me|sir|madam)\b",
            lower,
        ):
            return "polite"
        if re.search(r"\b(?:hey|yo|yeah|yep|nah|thanks|lol|lmao|gonna|wanna)\b", lower):
            return "casual"
        return "neutral"
    if source in {Language.CHINESE_SIMPLIFIED, Language.CHINESE_TRADITIONAL}:
        if re.search(r"(?:您|请|請|劳驾|勞駕|麻烦您|麻煩您|敬请|敬請|谢谢|謝謝)", normalized):
            return "polite"
        if re.search(r"(?:你|妳|谢了|謝了|哈哈|嘿|呀|啦|喔)", normalized):
            return "casual"
        return "neutral"
    return "neutral"


def _style_requirement(target: Language, style: str) -> str:
    if style == "polite":
        requirements = {
            Language.KOREAN: (
                "Use polite Korean honorific speech (존댓말) with natural 요/습니다 "
                "endings; never use casual banmal."
            ),
            Language.JAPANESE: (
                "Use polite Japanese 丁寧語. The output must use です/ます/ました "
                "forms and convert casual expressions into polite expressions. Never "
                "combine endings as ましたです or でしたです; use ました or でした."
            ),
            Language.ENGLISH: (
                "Use polite/formal English appropriate for respectfully addressing "
                "someone."
            ),
            Language.CHINESE_SIMPLIFIED: (
                "Use polite/respectful Simplified Chinese; use 您 and 请 where natural."
            ),
            Language.CHINESE_TRADITIONAL: (
                "Use polite/respectful Traditional Chinese; use 您 and 請 where natural."
            ),
        }
        return requirements.get(
            target,
            "Use the target language's polite, respectful, formal register.",
        )
    if style == "casual":
        requirements = {
            Language.KOREAN: (
                "Use Korean casual banmal (반말). Never use polite endings such as "
                "요, 습니다, 합니다, 입니다, 주세요; use endings like 해, 했어, 고마워."
                " Say 고마워, not 고마워해; convert 보세요 to 봐."
            ),
            Language.JAPANESE: (
                "Use Japanese casual/plain form (常体・タメ口). Never use です, ます, "
                "ください, ございます."
            ),
            Language.ENGLISH: "Use natural casual/informal English, not formal wording.",
            Language.CHINESE_SIMPLIFIED: (
                "Use natural casual/informal Simplified Chinese; use 你 rather than 您."
            ),
            Language.CHINESE_TRADITIONAL: (
                "Use natural casual/informal Traditional Chinese; use 你 rather than 您."
            ),
        }
        return requirements.get(
            target,
            "Use the target language's natural casual, informal register.",
        )
    return (
        "Preserve the source's level of politeness and formality without making it "
        "more polite or more casual."
    )


def _rewrite_style_prompt(text: str, target: Language, style: str) -> str:
    target_name = LANGUAGE_NAME[target]
    return (
        f"Rewrite the following {target_name} text to meet this style requirement.\n"
        f"Style requirement: {_style_requirement(target, style)}\n"
        "Keep the meaning unchanged. Only output the rewritten text without an "
        "explanation.\n\n"
        f"{text}"
    )


def _has_register_artifact(text: str, target: Language) -> bool:
    if target == Language.JAPANESE:
        return bool(re.search(r"(?:ました|でした|ます|ません)です", text))
    if target == Language.KOREAN:
        return "고마워해" in text
    return False


def _clean_register_artifacts(text: str, target: Language) -> str:
    if target == Language.JAPANESE:
        return re.sub(r"(ました|でした|ます|ません)です", r"\1", text)
    if target == Language.KOREAN:
        return text.replace("고마워해", "고마워")
    return text


def _rewrite_preserves_content(original: str, rewritten: str) -> bool:
    original_units = sum(character.isalnum() for character in original)
    rewritten_units = sum(character.isalnum() for character in rewritten)
    return rewritten_units >= max(1, round(original_units * 0.45))


def _fallback_register_cleanup(text: str, target: Language, style: str) -> str:
    if target == Language.KOREAN and style == "casual":
        replacements = (
            ("해 주세요", "해줘"),
            ("해주세요", "해줘"),
            ("보세요", "봐"),
            ("하세요", "해"),
            ("주세요", "줘"),
            ("감사합니다", "고마워"),
            ("고마워요", "고마워"),
        )
        for polite, casual in replacements:
            text = text.replace(polite, casual)
    return text


def _max_output_tokens(text: str) -> int:
    return min(768, max(96, len(text) * 3))


def _clean_translation(text: str) -> str:
    cleaned = text.strip()
    cleaned = re.sub(
        r"^(?:translation|translated text|번역(?:문| 결과)?)\s*:\s*",
        "",
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = cleaned.split("<|", 1)[0].strip()
    paragraphs = re.split(r"\n\s*\n", cleaned)
    while paragraphs and _looks_like_prompt_echo(paragraphs[0]):
        paragraphs.pop(0)
    cleaned = "\n\n".join(paragraphs).strip()
    if len(cleaned) >= 2 and cleaned[0] == cleaned[-1] and cleaned[0] in {'"', "'"}:
        cleaned = cleaned[1:-1].strip()
    return cleaned


def _looks_like_prompt_echo(text: str) -> bool:
    normalized = text.casefold()
    hits = sum(hint in normalized for hint in PROMPT_ECHO_HINTS)
    return hits >= 2


def _model_is_complete(path: Path, expected_bytes: int) -> bool:
    return path.is_file() and path.stat().st_size == expected_bytes


def _model_is_verified(path: Path, model: HyMtModel) -> bool:
    if not _model_is_complete(path, model.expected_bytes):
        return False
    marker = _hash_marker(path)
    if marker.is_file() and marker.read_text(encoding="ascii").strip() == model.expected_sha256:
        return True
    actual = _file_sha256(path)
    if actual != model.expected_sha256:
        return False
    marker.write_text(actual, encoding="ascii")
    return True


def _hash_marker(path: Path) -> Path:
    return path.with_suffix(path.suffix + ".sha256")


def _file_sha256(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(4 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _free_tcp_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])
