if (typeof importScripts === "function") {
  if (!globalThis.NudeNyangNativeClient) importScripts("native-client.js");
  if (!globalThis.NudeNyangTabTranslationState) importScripts("tab-state.js");
}

const api = globalThis.chrome ?? globalThis.browser ?? globalThis.whale;
const HOST_NAME = "com.nudenyang.translator";
const FALLBACK_COMMAND_SHORTCUT = "Ctrl+Shift+L";
const CLIENT = Object.freeze({
  browser: navigator.userAgent.includes("Firefox")
    ? "firefox"
    : navigator.userAgent.includes("Whale")
      ? "whale"
      : "chrome",
  extensionVersion: api.runtime.getManifest().version,
});
const nativeClient = globalThis.NudeNyangNativeClient.createNativeClient(api, HOST_NAME, CLIENT);
const tabTranslationState = globalThis.NudeNyangTabTranslationState.createTabTranslationState(api);

function nativeRequest(request) {
  return nativeClient.request(request);
}

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "nudenyang-native-request") {
    nativeRequest(message.request).then(sendResponse);
    return true;
  }
  if (message?.type === "nudenyang-tab-enabled-get") {
    tabTranslationState.get(sender.tab?.id).then((enabled) => sendResponse({ enabled }));
    return true;
  }
  if (message?.type === "nudenyang-tab-enabled-set") {
    tabTranslationState.set(sender.tab?.id, message.enabled).then((enabled) => sendResponse({ enabled }));
    return true;
  }
  return false;
});

api.tabs.onRemoved?.addListener((tabId) => {
  void tabTranslationState.clear(tabId);
});

function ensureFallbackCommandShortcut() {
  if (!api.commands?.getAll || !api.commands?.update) return;
  api.commands.getAll((commands) => {
    void api.runtime.lastError;
    const toggleCommand = commands?.find((command) => command.name === "toggle-page-translation");
    if (toggleCommand?.shortcut) return;
    api.commands.update({
      name: "toggle-page-translation",
      shortcut: FALLBACK_COMMAND_SHORTCUT,
    }, () => {
      void api.runtime.lastError;
    });
  });
}

api.runtime.onInstalled?.addListener(ensureFallbackCommandShortcut);

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
