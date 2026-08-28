// Test-only Native Messaging transport. This file is never loaded by a product
// manifest. The E2E manifest also removes nativeMessaging permission, so a broken
// stub cannot connect to the user's installed companion or native-host registry.
(function installNativePortStub(root) {
  const requests = [];
  const pending = new Set();
  let deferred = false;
  let status = defaultStatus();

  function defaultStatus(options = {}) {
    return {
      type: "status", appConnected: true,
      translator: options.translator ?? "hymt_1_8b",
      targetLanguage: "KO", resolvedUiLanguage: "ko",
      webSettings: { enabled: true, messengerPolicyVersion: 3, processingMode: "responsive", ...options.settings },
    };
  }

  function listeners() {
    const values = new Set();
    return {
      addListener(callback) { values.add(callback); },
      removeListener(callback) { values.delete(callback); },
      emit(value) { for (const callback of values) callback(value); },
    };
  }

  function connectNative(hostName) {
    if (hostName !== "com.nudenyang.translator") throw new Error(`Unexpected test host: ${hostName}`);
    let disconnected = false;
    let orderedReplies = Promise.resolve();
    const onMessage = listeners();
    const onDisconnect = listeners();
    return {
      onMessage, onDisconnect,
      disconnect() { disconnected = true; },
      postMessage(request) {
        if (disconnected) throw new Error("Test native port is closed");
        requests.push(structuredClone(request));
        let response;
        if (request.type === "translate") {
          response = {
            type: "translationResult", requestId: request.requestId,
            translator: status.translator,
            items: request.items.map(item => ({ id: item.id, text: `번역(${item.text})` })),
          };
        } else if (request.type === "status") {
          response = { ...structuredClone(status), requestId: request.requestId };
        } else if (request.type === "connectionPing") {
          response = { type: "connectionPong", requestId: request.requestId, appConnected: true };
        } else {
          throw new Error(`Unhandled E2E native request: ${request.type}`);
        }
        const ready = request.type === "translate" && deferred
          ? new Promise(resolve => pending.add({ response, resolve }))
          : Promise.resolve(response);
        // Production native-client matches responses FIFO, including status
        // lookups during translation. The stub preserves the same ordering.
        orderedReplies = orderedReplies.then(() => ready).then(reply => {
          if (!disconnected) onMessage.emit(reply);
        });
      },
    };
  }

  Object.defineProperty(chrome.runtime, "connectNative", { value: connectNative, configurable: false });
  root.__NudeNyangE2E = Object.freeze({
    configure(options) {
      if (pending.size) throw new Error("Release previous pending translations before reconfiguring the stub");
      status = defaultStatus(options);
      deferred = options.deferTranslations === true;
      requests.length = 0;
    },
    requests: () => structuredClone(requests),
    pending: () => pending.size,
    releaseTranslations({ count = pending.size, keepDeferred = false,
      omitItemIds = [], emptyItemIds = [], errorCode = "" } = {}) {
      deferred = keepDeferred;
      const ready = [...pending].slice(0, count);
      const omitted = new Set(omitItemIds);
      const empty = new Set(emptyItemIds);
      for (const entry of ready) {
        pending.delete(entry);
        const response = errorCode
          ? { type: "error", requestId: entry.response.requestId, code: errorCode, retryable: false }
          : { ...entry.response, items: entry.response.items.filter(item => !omitted.has(item.id))
            .map(item => empty.has(item.id) ? { ...item, text: "" } : item) };
        entry.resolve(response);
      }
      return ready.length;
    },
  });
})(globalThis);
