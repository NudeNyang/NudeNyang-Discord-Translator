importScripts("native-client.js");

const api = globalThis.chrome ?? globalThis.whale;
const HOST_NAME = "com.nudenyang.translator";
const CLIENT = Object.freeze({
  browser: navigator.userAgent.includes("Whale") ? "whale" : "chrome",
  extensionVersion: api.runtime.getManifest().version,
});
const nativeClient = globalThis.NudeNyangNativeClient.createNativeClient(api, HOST_NAME, CLIENT);

function nativeRequest(request) {
  return nativeClient.request(request);
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
