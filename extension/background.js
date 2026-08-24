const api = globalThis.chrome ?? globalThis.whale;
const HOST_NAME = "com.nudenyang.translator";
const CLIENT = Object.freeze({
  browser: navigator.userAgent.includes("Whale") ? "whale" : "chrome",
  extensionVersion: api.runtime.getManifest().version,
});

function nativeRequest(request) {
  return new Promise((resolve) => {
    api.runtime.sendNativeMessage(HOST_NAME, { ...request, client: CLIENT }, (response) => {
      const error = api.runtime.lastError;
      if (error) {
        resolve({
          type: "error",
          requestId: request.requestId ?? "",
          code: "native_host_unavailable",
          message: "Windows 앱 연결 구성요소를 찾지 못했습니다. 호스트 등록 후 브라우저를 다시 시작하십시오.",
          detail: error.message,
          retryable: true,
        });
        return;
      }
      resolve(response ?? {
        type: "error",
        requestId: request.requestId ?? "",
        code: "empty_native_response",
        message: "Windows 앱에서 응답을 받지 못했습니다.",
        retryable: true,
      });
    });
  });
}

api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "nudenyang-native-request") {
    return false;
  }
  nativeRequest(message.request).then(sendResponse);
  return true;
});

function sendPageToggle(tabId) {
  if (typeof tabId !== "number") {
    return;
  }
  try {
    api.tabs.sendMessage(tabId, { type: "nudenyang-toggle-enabled" }, () => {
      void api.runtime.lastError;
    });
  } catch {
    // 브라우저 내부 페이지처럼 콘텐츠 스크립트가 없는 탭에서는 조용히 무시한다.
  }
}

api.commands.onCommand.addListener((command, tab) => {
  if (command !== "toggle-page-translation") {
    return;
  }
  if (typeof tab?.id === "number") {
    sendPageToggle(tab.id);
    return;
  }
  api.tabs.query({ active: true, lastFocusedWindow: true }, ([activeTab]) => {
    sendPageToggle(activeTab?.id);
  });
});
