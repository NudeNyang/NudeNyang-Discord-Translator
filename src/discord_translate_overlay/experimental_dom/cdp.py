from __future__ import annotations

import itertools
import json
import threading
from dataclasses import dataclass
from typing import Any

import httpx
import websocket


@dataclass(frozen=True, slots=True)
class CdpTarget:
    title: str
    url: str
    websocket_url: str


def list_targets(port: int = 9222) -> list[CdpTarget]:
    response = httpx.get(f"http://127.0.0.1:{port}/json/list", timeout=2.0)
    response.raise_for_status()
    targets: list[CdpTarget] = []
    for item in response.json():
        websocket_url = str(item.get("webSocketDebuggerUrl", ""))
        if websocket_url:
            targets.append(
                CdpTarget(
                    title=str(item.get("title", "")),
                    url=str(item.get("url", "")),
                    websocket_url=websocket_url,
                )
            )
    return targets


def discord_target(port: int = 9222) -> CdpTarget:
    targets = list_targets(port)
    preferred = [
        target
        for target in targets
        if target.url.startswith("https://discord.com/channels/")
    ]
    if not preferred:
        preferred = [
            target
            for target in targets
            if target.url.startswith("https://discord.com/")
            and "/popout" not in target.url
        ]
    if not preferred:
        details = ", ".join(f"{t.title!r} {t.url!r}" for t in targets)
        raise RuntimeError(f"Discord 렌더러 대상을 찾지 못했어: {details or '대상 없음'}")
    return preferred[0]


class CdpClient:
    def __init__(self, websocket_url: str, *, timeout: float = 10.0) -> None:
        self.websocket_url = websocket_url
        self.timeout = timeout
        self._ids = itertools.count(1)
        self._socket: websocket.WebSocket | None = None
        self._lock = threading.Lock()

    def __enter__(self) -> CdpClient:
        self.connect()
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def connect(self) -> None:
        if self._socket is not None:
            return
        self._socket = websocket.create_connection(
            self.websocket_url,
            timeout=self.timeout,
            origin="http://127.0.0.1:9222",
            suppress_origin=True,
        )

    def close(self) -> None:
        if self._socket is not None:
            self._socket.close()
            self._socket = None

    def call(self, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        if self._socket is None:
            self.connect()
        assert self._socket is not None
        request_id = next(self._ids)
        payload = {"id": request_id, "method": method, "params": params or {}}
        with self._lock:
            self._socket.send(json.dumps(payload, ensure_ascii=False))
            while True:
                response = json.loads(self._socket.recv())
                if response.get("id") != request_id:
                    continue
                if "error" in response:
                    raise RuntimeError(f"CDP {method} 실패: {response['error']}")
                return dict(response.get("result", {}))

    def evaluate(self, expression: str, *, await_promise: bool = False) -> Any:
        response = self.call(
            "Runtime.evaluate",
            {
                "expression": expression,
                "returnByValue": True,
                "awaitPromise": await_promise,
                "userGesture": False,
            },
        )
        if "exceptionDetails" in response:
            description = response["exceptionDetails"].get("text", "JavaScript 오류")
            raise RuntimeError(description)
        return response.get("result", {}).get("value")
