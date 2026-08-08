from __future__ import annotations

import argparse
import copy
import json
import logging
import queue
import signal
import sys
import threading
import time
from dataclasses import asdict
from typing import Any, TextIO

from .config import AppConfig, load_config, save_config
from .env import load_local_env
from .experimental_dom.cdp import discord_target
from .experimental_dom.controller import DomTranslationController, configure_logging
from .platforms import create_discord_debug_launcher
from .updater import GitHubReleaseClient

LOGGER = logging.getLogger("nude_translator_engine")
PROTOCOL_VERSION = 1


class EngineRuntime:
    def __init__(self, config: AppConfig | None = None) -> None:
        self.config = config or load_config()
        self.controller = DomTranslationController(self.config)
        self.thread = threading.Thread(
            target=self.controller.run,
            name="tauri-dom-controller",
            daemon=True,
        )
        self.thread.start()
        self.discord_launcher = create_discord_debug_launcher()
        self._closed = False

    def dispatch(self, command: str, payload: Any) -> Any:
        if command == "health":
            return {
                "status": "ready",
                "protocolVersion": PROTOCOL_VERSION,
                "ocrMode": "built-in",
            }
        if command == "settings-get":
            return _config_payload(self.config)
        if command == "settings-update":
            updated = _patched_config(self.config, payload)
            self.config = updated
            self.controller.request_config(updated)
            save_config(updated)
            return _config_payload(updated)
        if command == "translation-set-enabled":
            enabled = bool(_mapping(payload).get("enabled", False))
            self.config.enabled = enabled
            self.controller.request_enabled(enabled)
            save_config(self.config)
            return self.status()
        if command == "runtime-status":
            return self.status()
        if command == "update-check":
            current_version = str(
                _mapping(payload).get("currentVersion", "")
            ).strip()
            if not current_version:
                raise ValueError("현재 앱 버전이 필요해.")
            return _check_for_update(self.config.update_repository, current_version)
        if command == "discord-restart":
            return self._restart_discord(_mapping(payload).get("expectedProcessId"))
        if command == "shutdown":
            self.close()
            return {"stopped": True}
        raise ValueError(f"지원하지 않는 엔진 명령이야: {command}")

    def status(self) -> dict[str, Any]:
        issue = ""
        try:
            issue = self.controller.connection_issues.get_nowait()
        except queue.Empty:
            pass
        notice = ""
        while True:
            try:
                notice = self.controller.notices.get_nowait()
            except queue.Empty:
                break
        process = self.discord_launcher.current_process()
        configured_translator = self.config.translator
        active_translator = self.controller.active_translator_name
        preparing_translator = self.controller.preparing_translator_name
        translator_error = self.controller.translator_error
        if translator_error:
            translator_state = "error"
        elif active_translator == configured_translator:
            translator_state = "ready"
        elif preparing_translator == configured_translator:
            translator_state = "preparing"
        else:
            translator_state = "queued"
        return {
            "enabled": self.config.enabled,
            "controllerEnabled": self.controller.enabled,
            "cdpConnected": self.controller.client is not None,
            "connectionIssue": issue,
            "discordProcessId": process.process_id if process is not None else None,
            "engine": "python-ocr-sidecar",
            "targetLanguage": self.config.target_language.value,
            "configuredTranslator": configured_translator,
            "activeTranslator": active_translator,
            "translatorState": translator_state,
            "translatorError": translator_error,
            "notice": notice,
        }

    def _restart_discord(self, expected_process_id: Any) -> dict[str, Any]:
        expected = int(expected_process_id) if expected_process_id is not None else None
        self.controller.request_enabled(False)
        self.discord_launcher.restart(expected_process_id=expected, port=9222)
        deadline = time.monotonic() + 30.0
        last_error = "Discord 디버그 렌더러를 찾지 못했어."
        while time.monotonic() < deadline:
            try:
                discord_target()
                self.controller.request_enabled(True)
                return {"connected": True}
            except Exception as exc:
                last_error = str(exc)
                time.sleep(0.5)
        raise RuntimeError(
            "Discord를 다시 열었지만 30초 안에 디버그 렌더러가 준비되지 않았어. "
            f"마지막 오류: {last_error}"
        )

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self.controller.stop()
        self.thread.join(timeout=5.0)
        self.controller.close()


def serve(input_stream: TextIO, output_stream: TextIO) -> int:
    load_local_env()
    configure_logging()
    runtime = EngineRuntime()
    try:
        for line in input_stream:
            if not line.strip():
                continue
            request_id: Any = None
            try:
                request = json.loads(line)
                request_id = request.get("id")
                result = runtime.dispatch(
                    str(request.get("command", "")),
                    request.get("payload"),
                )
                response = {"id": request_id, "ok": True, "result": result}
            except Exception as exc:
                LOGGER.exception("Tauri 엔진 요청 실패")
                response = {"id": request_id, "ok": False, "error": str(exc)}
            output_stream.write(json.dumps(response, ensure_ascii=False) + "\n")
            output_stream.flush()
            if response.get("ok") and request.get("command") == "shutdown":
                break
    finally:
        runtime.close()
    return 0


def _mapping(payload: Any) -> dict[str, Any]:
    return dict(payload) if isinstance(payload, dict) else {}


def _check_for_update(repository: str, current_version: str) -> dict[str, Any]:
    client = GitHubReleaseClient(repository)
    try:
        release = client.check_for_update(current_version)
    finally:
        client.close()
    if release is None:
        return {"available": False}
    return {
        "available": True,
        "version": release.version,
        "pageUrl": release.page_url,
    }


def _patched_config(current: AppConfig, payload: Any) -> AppConfig:
    values = asdict(current)
    patch = _mapping(payload)
    for key, value in patch.items():
        if key == "hotkeys" and isinstance(value, dict):
            values["hotkeys"].update(value)
        elif key in values:
            values[key] = copy.deepcopy(value)
    return AppConfig.from_dict(values)


def _config_payload(config: AppConfig) -> dict[str, Any]:
    return json.loads(json.dumps(asdict(config), ensure_ascii=False))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Nude Translator Tauri engine")
    parser.add_argument("command", choices=("serve", "health"), nargs="?", default="serve")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    if args.command == "health":
        print(
            json.dumps(
                {"status": "ready", "protocolVersion": PROTOCOL_VERSION},
                ensure_ascii=False,
            )
        )
        return 0
    signal.signal(signal.SIGINT, lambda *_: sys.exit(0))
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    return serve(sys.stdin, sys.stdout)


if __name__ == "__main__":
    raise SystemExit(main())
