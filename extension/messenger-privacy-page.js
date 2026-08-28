(() => {
  "use strict";

  const firefoxApi = typeof globalThis.browser?.runtime?.getBrowserInfo === "function" ? globalThis.browser : null;
  const api = firefoxApi ?? globalThis.chrome ?? globalThis.browser ?? globalThis.whale;
  const isFirefox = Boolean(firefoxApi) || typeof api?.runtime?.getBrowserInfo === "function";
  const locales = globalThis.NudeNyangPopupLocales;
  const confirmation = document.getElementById("privacy-confirm");
  const confirmationRow = document.getElementById("privacy-confirmation");
  const accept = document.getElementById("privacy-accept");
  const revoke = document.getElementById("privacy-revoke");
  const status = document.getElementById("privacy-status");
  const controls = document.getElementById("privacy-controls");
  const pendingTimers = new Set();
  let uiLanguage = locales.resolve("auto", api?.i18n?.getUILanguage?.() || navigator.language);
  let ready = false;
  let granted = false;
  let anyGranted = false;
  let busy = false;
  let disposed = false;
  let consentRevision = 0;
  let refreshAfterBusy = false;
  let hadMessengerPermission = false;

  // Do not let browser form restoration count as a new affirmative choice.
  confirmation.checked = false;

  function copy(key) {
    if (key === "messengerPrivacySaved") key = "globalPrivacySaved";
    if (key === "messengerConsentRequired") key = "reviewMessengerPrivacy";
    return locales.message(uiLanguage, key);
  }

  function applyLanguage(language) {
    uiLanguage = locales.resolve(language || uiLanguage, api?.i18n?.getUILanguage?.() || navigator.language);
    document.documentElement.lang = uiLanguage;
    document.documentElement.dir = ["ar", "ur", "fa", "he"].includes(uiLanguage) ? "rtl" : "ltr";
    document.title = copy("webPrivacyTitle");
    for (const element of document.querySelectorAll("[data-i18n]")) {
      element.textContent = copy(element.dataset.i18n);
    }
    if (status.dataset.message) status.textContent = copy(status.dataset.message);
  }

  function setStatus(key, tone = "") {
    status.dataset.message = key;
    status.dataset.tone = tone;
    status.textContent = copy(key);
  }

  function render() {
    confirmationRow.hidden = granted;
    confirmation.disabled = !ready || busy || granted;
    accept.hidden = granted;
    accept.disabled = !ready || busy || granted || !confirmation.checked;
    revoke.hidden = !anyGranted;
    revoke.disabled = !ready || busy || !anyGranted;
    controls.setAttribute("aria-busy", String(busy));
  }

  function runtimeMessage(message) {
    return new Promise((resolve) => {
      if (disposed || !api?.runtime?.sendMessage) { resolve(null); return; }
      let finished = false;
      const timer = setTimeout(() => finish(null), 10000);
      pendingTimers.add(timer);
      function finish(response) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        pendingTimers.delete(timer);
        resolve(response);
      }
      try {
        if (isFirefox) Promise.resolve(api.runtime.sendMessage(message)).then(finish, () => finish(null));
        else api.runtime.sendMessage(message, (response) => finish(api.runtime.lastError ? null : response));
      } catch { finish(null); }
    });
  }

  async function removeFirefoxPermission() {
    if (!isFirefox || typeof api.permissions?.remove !== "function") return;
    try { await api.permissions.remove({ data_collection: ["personalCommunications"] }); }
    catch { /* Stored consent is independently required even if permission removal fails. */ }
  }

  function removeNewFirefoxPermission() {
    if (!hadMessengerPermission) return removeFirefoxPermission();
  }

  async function resumeConversation() {
    const params = new URL(location.href).searchParams;
    const rawTab = params.get("tab");
    const tabId = Number(rawTab);
    const contextId = params.get("context") ?? "";
    if (!/^\d+$/.test(rawTab ?? "") || !Number.isSafeInteger(tabId)
      || !/^messenger:[a-z]+:[a-zA-Z0-9_-]{16,128}$/.test(contextId)) return;
    const response = await runtimeMessage({ type: "nudenyang-page-request", tabId,
      message: { type: "nudenyang-messenger-start", contextId } });
    if (disposed || !response?.enabled || response.messengerContextId !== contextId) return;
    try {
      if (isFirefox) await api.tabs.update(tabId, { active: true });
      else api.tabs.update(tabId, { active: true }, () => { void api.runtime.lastError; });
    } catch { /* The source tab may have closed; consent management remains usable. */ }
  }

  async function finishAcceptance(permission) {
    let permitted = false;
    try { permitted = await permission === true; }
    catch { /* Missing or denied optional permission must fail closed. */ }
    if (disposed) {
      if (permitted) void removeNewFirefoxPermission();
      return;
    }
    // Denying the optional Firefox messenger permission must not take away
    // ordinary webpage translation. The background independently checks it.
    const response = await runtimeMessage({ type: "nudenyang-privacy-consent-set", granted: true });
    if (disposed) return;
    if (response?.ok === true && response.anyGranted === true) {
      granted = response.granted === true;
      anyGranted = true;
      confirmation.checked = false;
      setStatus(granted ? "messengerPrivacySaved" : "webPrivacyPartial", granted ? "success" : "");
      if (granted) await resumeConversation();
    } else {
      await removeNewFirefoxPermission();
      if (disposed) return;
      setStatus("messengerPrivacySaveFailed", "error");
    }
    busy = false;
    render();
    if (refreshAfterBusy) { refreshAfterBusy = false; void refreshConsent(); }
  }

  function acceptConsent() {
    if (disposed || !ready || busy || granted || !confirmation.checked) return;
    busy = true;
    consentRevision += 1;
    setStatus("checking");
    render();
    let permission = true;
    try {
      // This call must stay in the actual click handler before the first await:
      // Firefox optional data permissions require an active user gesture.
      if (isFirefox) permission = typeof api.permissions?.request === "function"
        ? api.permissions.request({ data_collection: ["personalCommunications"] }) : false;
    } catch { permission = false; }
    void finishAcceptance(permission);
  }

  async function revokeConsent() {
    if (disposed || !ready || busy || !anyGranted) return;
    busy = true;
    consentRevision += 1;
    setStatus("checking");
    render();
    const response = await runtimeMessage({ type: "nudenyang-privacy-consent-set", granted: false });
    await removeFirefoxPermission();
    if (disposed) return;
    if (response?.ok === true && response.granted === false) {
      granted = false;
      anyGranted = false;
      confirmation.checked = false;
      setStatus("messengerPrivacyRevoked", "success");
    } else setStatus("messengerPrivacySaveFailed", "error");
    busy = false;
    render();
    if (refreshAfterBusy) { refreshAfterBusy = false; void refreshConsent(); }
  }

  function dispose() {
    disposed = true;
    for (const timer of pendingTimers) clearTimeout(timer);
    pendingTimers.clear();
    api.storage?.onChanged?.removeListener(storageChanged);
    api.permissions?.onRemoved?.removeListener(permissionsRemoved);
  }

  async function refreshConsent() {
    if (busy) { refreshAfterBusy = true; return; }
    const revision = ++consentRevision;
    const response = await runtimeMessage({ type: "nudenyang-privacy-consent-get" });
    if (disposed || busy || revision !== consentRevision) return;
    ready = response?.ok === true;
    granted = response?.ok === true && response.granted === true;
    anyGranted = response?.ok === true && response.anyGranted === true;
    hadMessengerPermission = response?.messengerPermissionGranted === true;
    confirmation.checked = false;
    setStatus(response?.ok === true
      ? (granted ? "messengerPrivacySaved" : anyGranted ? "webPrivacyPartial" : "messengerConsentRequired")
      : "messengerPrivacySaveFailed", response?.ok === true ? "" : "error");
    render();
  }
  function storageChanged(changes, area) {
    if (area === "local" && (changes.webTranslationConsentVersion || changes.messengerConsentVersion)) void refreshConsent();
  }
  function permissionsRemoved(permissions) {
    if (permissions.data_collection?.includes("personalCommunications")) void refreshConsent();
  }
  api.storage?.onChanged?.addListener(storageChanged);
  api.permissions?.onRemoved?.addListener(permissionsRemoved);

  confirmation.addEventListener("change", render);
  accept.addEventListener("click", acceptConsent);
  revoke.addEventListener("click", () => { void revokeConsent(); });
  document.getElementById("privacy-cancel").addEventListener("click", () => {
    dispose();
    window.close();
  });
  window.addEventListener("pagehide", dispose);

  applyLanguage(uiLanguage);
  setStatus("checking");
  render();
  void refreshConsent();
  // Native status is only for language. A
  // sleeping or disconnected engine must not block browser consent management.
  void runtimeMessage({
    type: "nudenyang-native-request", request: { type: "status", requestId: `messenger-privacy-${Date.now()}` },
  }).then((response) => {
    if (disposed || response?.type !== "status") return;
    applyLanguage(response.resolvedUiLanguage || response.uiLanguage);
    render();
  });
})();
