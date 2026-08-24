(function exposeNativeClient(root) {
  const DEFAULT_TIMEOUT_MS = 195000;

  function unavailableResponse(requestId, detail, code = "native_host_unavailable") {
    return {
      type: "error",
      requestId: requestId ?? "",
      code,
      message: code === "native_host_timeout"
        ? "Windows 앱의 번역 응답 시간이 초과되었습니다. 잠시 후 다시 시도하십시오."
        : "Windows 앱 연결 구성요소를 찾지 못했습니다. 호스트 등록 후 브라우저를 다시 시작하십시오.",
      detail: String(detail ?? ""),
      retryable: true,
    };
  }

  function createNativeClient(api, hostName, client, timeoutMs = DEFAULT_TIMEOUT_MS) {
    let port = null;
    const pending = [];

    function removePending(entry) {
      const index = pending.indexOf(entry);
      if (index >= 0) pending.splice(index, 1);
    }

    function settle(entry, response) {
      clearTimeout(entry.timer);
      removePending(entry);
      entry.resolve(response);
    }

    function rejectAll(detail, code = "native_host_unavailable") {
      for (const entry of pending.splice(0)) {
        clearTimeout(entry.timer);
        entry.resolve(unavailableResponse(entry.requestId, detail, code));
      }
    }

    function closePort(activePort) {
      if (port === activePort) port = null;
      try {
        activePort?.disconnect?.();
      } catch {
        // 이미 종료된 Native Messaging 포트는 추가 정리가 필요하지 않다.
      }
    }

    function connect() {
      if (port) return port;
      let activePort;
      try {
        activePort = api.runtime.connectNative(hostName);
      } catch (error) {
        rejectAll(error?.message ?? error);
        return null;
      }
      port = activePort;
      activePort.onMessage.addListener((response) => {
        const entry = pending[0];
        if (entry) settle(entry, response);
      });
      activePort.onDisconnect.addListener(() => {
        let detail = "Native Messaging 연결이 종료되었습니다.";
        try {
          detail = api.runtime.lastError?.message ?? detail;
        } catch {
          // 일부 Chromium 버전은 종료 콜백 밖의 lastError 접근을 허용하지 않는다.
        }
        if (port === activePort) port = null;
        rejectAll(detail);
      });
      return activePort;
    }

    function request(requestValue) {
      return new Promise((resolve) => {
        const entry = {
          requestId: requestValue.requestId ?? "",
          resolve,
          timer: undefined,
        };
        pending.push(entry);
        const activePort = connect();
        if (!activePort) {
          settle(entry, unavailableResponse(entry.requestId, "Native Messaging 연결을 시작하지 못했습니다."));
          return;
        }
        entry.timer = setTimeout(() => {
          closePort(activePort);
          rejectAll("Windows 앱의 번역 응답 시간이 초과되었습니다.", "native_host_timeout");
        }, timeoutMs);
        try {
          activePort.postMessage({ ...requestValue, client });
        } catch (error) {
          settle(entry, unavailableResponse(entry.requestId, error?.message ?? error));
          closePort(activePort);
        }
      });
    }

    return Object.freeze({ request });
  }

  const api = Object.freeze({ createNativeClient });
  root.NudeNyangNativeClient = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
