if (typeof importScripts === "function") {
  if (!globalThis.NudeNyangNativeClient) importScripts("native-client.js");
  if (!globalThis.NudeNyangTabTranslationState) importScripts("tab-state.js");
  if (!globalThis.NudeNyangPageConnection) importScripts("page-connection.js");
  if (!globalThis.NudeNyangEmbeddedBridge) importScripts("embedded-bridge.js");
  if (!globalThis.NudeNyangMessengerAdapters) importScripts("messenger-adapters.js");
  if (!globalThis.NudeNyangMessengerPrivacy) importScripts("messenger-privacy.js");
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
const pageConnection = globalThis.NudeNyangPageConnection.createPageConnection(api);
const embeddedBridge = globalThis.NudeNyangEmbeddedBridge.createEmbeddedBridge(api);
const messengerPrivacy = globalThis.NudeNyangMessengerPrivacy.createMessengerPrivacy(api, { firefox: CLIENT.browser === "firefox" });
let messengerBroadcastEpoch = 0;

function nativeRequest(request) {
  return nativeClient.request(request);
}

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (embeddedBridge.handle(message, sender, sendResponse)) return true;
  if (message?.type === "nudenyang-native-request") {
    messengerPrivacy.forward(message.request, sender, nativeRequest).then(sendResponse).catch(() => sendResponse({
      type: "error", code: "messenger_request_cancelled", retryable: false,
    }));
    return true;
  }
  if (message?.type === "nudenyang-messenger-consent-get") {
    messengerPrivacy.getConsent().then(sendResponse);
    return true;
  }
  if (message?.type === "nudenyang-messenger-consent-set") {
    messengerPrivacy.setConsent(message.granted, sender).then(sendResponse);
    return true;
  }
  if (message?.type === "nudenyang-tab-enabled-get") {
    tabTranslationState.getForTab(sender.tab, sender.url).then((enabled) => sendResponse({ enabled }));
    return true;
  }
  if (message?.type === "nudenyang-tab-enabled-set") {
    tabTranslationState.set(sender.tab?.id, message.enabled).then((enabled) => sendResponse({ enabled }));
    return true;
  }
  if (message?.type === "nudenyang-page-request") {
    pageConnection.request(message.tabId, message.message).then(sendResponse);
    return true;
  }
  return false;
});

function broadcastMessengerPrivacy() {
  const epoch = ++messengerBroadcastEpoch;
  messengerPrivacy.invalidate();
  void messengerPrivacy.getConsent().then((consent) => {
    if (epoch !== messengerBroadcastEpoch) return;
    api.tabs.query({}, (tabs) => {
      void api.runtime.lastError;
      // A newer revocation may finish either asynchronous lookup first.
      if (epoch !== messengerBroadcastEpoch) return;
      for (const tab of tabs ?? []) {
        if (!Number.isInteger(tab.id)) continue;
        try {
          api.tabs.sendMessage(tab.id, { type: "nudenyang-messenger-refresh", consent }, { frameId: 0 }, () => {
            void api.runtime.lastError;
          });
        } catch { /* A discarded or restricted tab has no private content runtime. */ }
      }
    });
  });
}

api.storage?.onChanged?.addListener((changes, area) => {
  if (area === "local" && changes.messengerConsentVersion) broadcastMessengerPrivacy();
});
api.permissions?.onRemoved?.addListener((permissions) => {
  if (permissions.data_collection?.includes("personalCommunications")) broadcastMessengerPrivacy();
});

api.tabs.onRemoved?.addListener((tabId) => {
  embeddedBridge.clear(tabId);
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

function recoverPageConnection(tabId) {
  if (typeof tabId === "number") void pageConnection.ensure(tabId);
}

function recoverActiveTabs() {
  api.tabs.query({ active: true }, (tabs) => {
    void api.runtime.lastError;
    for (const tab of tabs ?? []) recoverPageConnection(tab.id);
  });
}

api.runtime.onInstalled?.addListener(() => {
  ensureFallbackCommandShortcut();
  recoverActiveTabs();
});

api.tabs.onActivated?.addListener(({ tabId }) => recoverPageConnection(tabId));

api.windows?.onFocusChanged?.addListener((windowId) => {
  if (windowId === api.windows.WINDOW_ID_NONE) return;
  api.tabs.query({ active: true, windowId }, ([tab]) => {
    void api.runtime.lastError;
    recoverPageConnection(tab?.id);
  });
});

function sendPageToggle(tabId) {
  if (typeof tabId !== "number") {
    return;
  }
  void pageConnection.request(tabId, { type: "nudenyang-toggle-enabled" });
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
