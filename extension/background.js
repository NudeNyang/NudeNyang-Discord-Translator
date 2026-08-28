if (typeof importScripts === "function") {
  if (!globalThis.NudeNyangNativeClient) importScripts("native-client.js");
  if (!globalThis.NudeNyangGlobalTranslationState) importScripts("global-state.js");
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
// Keep short liveness deadlines separate from long, in-flight translations.
const connectionClient = globalThis.NudeNyangNativeClient.createNativeClient(api, HOST_NAME, CLIENT, 5000);
let rememberedConnection = false;
function rememberConnection(response) {
  if (!rememberedConnection && response?.appConnected === true && response.type !== "error") {
    rememberedConnection = true;
    try {
      api.storage.local?.set({ companionConnected: true }, () => { void api.runtime.lastError; });
    } catch { /* Connection remains usable when storage is unavailable. */ }
  }
  return response;
}
const pageConnection = globalThis.NudeNyangPageConnection.createPageConnection(api);
const embeddedBridge = globalThis.NudeNyangEmbeddedBridge.createEmbeddedBridge(api);
const messengerPrivacy = globalThis.NudeNyangMessengerPrivacy.createMessengerPrivacy(api, { firefox: CLIENT.browser === "firefox" });
const globalTranslationState = globalThis.NudeNyangGlobalTranslationState.createGlobalTranslationState(api, { messengerPrivacy });
let messengerBroadcastEpoch = 0;
const CONNECTION_ALARM = "nudenyang-connection";
const CONNECTION_RETRY_DELAYS = [1000, 2000, 4000, 8000];
let connectionCheck = null;
let connectionRetry = null;

// This request carries no page data and must not prepare a model or open a tab.
function checkAppConnection(attempt = 0) {
  if (connectionCheck) return connectionCheck;
  if (connectionRetry !== null) clearTimeout(connectionRetry);
  connectionRetry = null;
  connectionCheck = connectionClient.request({ type: "connectionPing", requestId: "connection" })
    .then(rememberConnection)
    .catch(() => null)
    .then(response => {
      // The desktop app may still be starting when the browser loses focus.
      // Retry briefly; the alarm remains the backstop if the worker sleeps.
      const retryable = !response || (response.type === "error"
        && response.retryable !== false && response.code !== "browser_connection_disabled");
      if (retryable && attempt < CONNECTION_RETRY_DELAYS.length) {
        connectionRetry = setTimeout(() => {
          connectionRetry = null;
          void checkAppConnection(attempt + 1);
        }, CONNECTION_RETRY_DELAYS[attempt]);
      }
      return response;
    })
    .finally(() => { connectionCheck = null; });
  return connectionCheck;
}

function startConnectionChecks() {
  api.alarms?.create(CONNECTION_ALARM, { periodInMinutes: 1 });
  return checkAppConnection();
}

api.runtime.onStartup?.addListener(startConnectionChecks);
api.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name === CONNECTION_ALARM) return checkAppConnection();
});

async function nativeRequest(request) {
  if (request?.type !== "translate") return nativeClient.request(request).then(rememberConnection);
  const revision = globalTranslationState.revision;
  const state = await globalTranslationState.get();
  const blocked = () => ({ type: "error", requestId: request.requestId, code: "web_translation_disabled", retryable: false });
  if (!state.enabled || revision !== globalTranslationState.revision) return blocked();
  const response = await nativeClient.request(request).then(rememberConnection);
  if (revision !== globalTranslationState.revision || !(await globalTranslationState.get()).enabled) return blocked();
  return response;
}

function globalSender(sender) {
  if (sender?.id !== api.runtime.id) return false;
  if (sender.url?.split(/[?#]/u)[0] === api.runtime.getURL("popup.html")) return true;
  return sender.frameId === 0 && Number.isInteger(sender.tab?.id) && /^https?:\/\//u.test(sender.url ?? "");
}

function broadcastGlobalState() {
  api.tabs.query({}, tabs => {
    void api.runtime.lastError;
    for (const tab of tabs ?? []) if (Number.isInteger(tab.id)) {
      try { api.tabs.sendMessage(tab.id, { type: "nudenyang-global-refresh" }, { frameId: 0 }, () => { void api.runtime.lastError; }); }
      catch { /* Restricted/discarded tabs are checked on their next startup. */ }
    }
  });
}
function notifyGlobalState(state) { broadcastGlobalState(); return state; }

async function forwardPageRequest(request, sender) {
  const revision = globalTranslationState.revision;
  const blocked = () => ({ type: "error", requestId: request?.requestId, code: "web_translation_disabled", retryable: false });
  if (request?.type === "translate" && (!(await globalTranslationState.get()).enabled
    || revision !== globalTranslationState.revision)) return blocked();
  // An OFF/ON while messenger permission or companion checks are waiting must
  // not revive the old page payload after those asynchronous checks finish.
  return messengerPrivacy.forward(request, sender, native => {
    if (native?.type === "translate" && revision !== globalTranslationState.revision) return Promise.resolve(blocked());
    return nativeRequest(native);
  });
}

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "nudenyang-privacy-consent-get") {
    globalTranslationState.privacyState().then(sendResponse, () => sendResponse({ ok: false })); return true;
  }
  if (message?.type === "nudenyang-privacy-consent-set") {
    globalTranslationState.privacyConsent(message.granted, sender).then(state => {
      broadcastMessengerPrivacy();
      return notifyGlobalState(state);
    }).then(sendResponse, () => sendResponse({ ok: false })); return true;
  }
  if (message?.type === "nudenyang-global-get") {
    globalTranslationState.get().then(sendResponse); return true;
  }
  if (message?.type === "nudenyang-global-consent-set") {
    globalTranslationState.consent(message.granted, sender).then(notifyGlobalState).then(sendResponse); return true;
  }
  if (["nudenyang-global-set", "nudenyang-global-toggle"].includes(message?.type)) {
    if (!globalSender(sender)) { sendResponse({ ok: false }); return true; }
    globalTranslationState.set(message.type === "nudenyang-global-toggle" ? "toggle" : message.enabled).then(notifyGlobalState).then(sendResponse);
    return true;
  }
  if (embeddedBridge.handle(message, sender, sendResponse)) return true;
  if (message?.type === "nudenyang-setup-status") {
    if (sender?.url !== api.runtime.getURL("popup.html") || sender?.tab) {
      sendResponse({ type: "error", code: "invalid_setup_sender" });
      return true;
    }
    const type = message.checkOnly === true ? "connectionPing" : "status";
    connectionClient.request({ type, requestId: "popup-connection" })
      .then(rememberConnection).then(sendResponse, () => sendResponse(null));
    return true;
  }
  if (message?.type === "nudenyang-native-request") {
    forwardPageRequest(message.request, sender).then(sendResponse).catch(() => sendResponse({
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
  if (message?.type === "nudenyang-messenger-privacy-open") {
    messengerPrivacy.openNotice(message.contextId, sender,
      (tabId) => pageConnection.request(tabId, { type: "nudenyang-status" }))
      .then(sendResponse, () => sendResponse({ ok: false }));
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
  if (area === "local" && (changes.webTranslationEnabled || changes.webTranslationConsentVersion)) {
    globalTranslationState.invalidate();
    broadcastGlobalState();
  }
});
api.permissions?.onRemoved?.addListener((permissions) => {
  if (permissions.data_collection?.includes("personalCommunications")) broadcastMessengerPrivacy();
});

api.tabs.onRemoved?.addListener((tabId) => {
  embeddedBridge.clear(tabId);
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

api.runtime.onInstalled?.addListener((details) => {
  if (details?.reason === "install" || details?.reason === "update") {
    void globalTranslationState.get().then(state => { if (!state.consent) return globalTranslationState.openNotice(); });
  }
  ensureFallbackCommandShortcut();
  recoverActiveTabs();
  return startConnectionChecks();
});

api.tabs.onActivated?.addListener(({ tabId }) => recoverPageConnection(tabId));

api.windows?.onFocusChanged?.addListener((windowId) => {
  void checkAppConnection();
  if (windowId === api.windows.WINDOW_ID_NONE) return;
  api.tabs.query({ active: true, windowId }, ([tab]) => {
    void api.runtime.lastError;
    recoverPageConnection(tab?.id);
  });
});

api.commands.onCommand.addListener((command, tab) => {
  if (command !== "toggle-page-translation") {
    return;
  }
  void globalTranslationState.set("toggle").then(notifyGlobalState);
});

// A recreated service worker does not receive onStartup/onInstalled again.
// Re-establish the metadata-only heartbeat whenever this background starts.
void startConnectionChecks();
