(function exposeMessengerPrivacy(root) {
  const CONSENT_VERSION = 2;
  const CONSENT_KEY = "messengerConsentVersion";
  const LOCAL_TRANSLATORS = new Set(["hymt_1_8b", "hymt_7b", "translategemma_4b"]);
  const SERVICES = new Set(["x", "discord", "whatsapp", "telegram", "messenger", "slack", "teams", "google-messages"]);

  function denied(request, code) {
    return { type: "error", requestId: request?.requestId ?? "", code, retryable: false };
  }

  function createMessengerPrivacy(api, { firefox = false } = {}) {
    let consentEpoch = 0;

    function readConsent() {
      return new Promise((resolve) => {
        try {
          api.storage.local.get({ [CONSENT_KEY]: 0 }, (value) => {
            resolve(api.runtime.lastError ? 0 : value?.[CONSENT_KEY]);
          });
        } catch { resolve(0); }
      });
    }

    async function dataPermissionGranted() {
      if (!firefox) return true;
      try {
        const permissions = await api.permissions.getAll();
        return permissions?.data_collection?.includes("personalCommunications") === true;
      } catch { return false; }
    }

    async function getConsent() {
      const granted = await readConsent() === CONSENT_VERSION && await dataPermissionGranted();
      return { ok: true, granted, consentVersion: granted ? CONSENT_VERSION : 0 };
    }

    function isConsentPage(sender) {
      return sender?.id === api.runtime.id
        && sender?.url?.split(/[?#]/u)[0] === api.runtime.getURL("messenger-privacy.html");
    }

    async function setConsent(granted, sender) {
      if (!isConsentPage(sender)) return { ok: false, granted: false };
      const accepted = granted === true && await dataPermissionGranted();
      consentEpoch += 1;
      const saved = await new Promise((resolve) => {
        try {
          api.storage.local.set({ [CONSENT_KEY]: accepted ? CONSENT_VERSION : 0 }, () => resolve(!api.runtime.lastError));
        } catch { resolve(false); }
      });
      return { ok: saved, granted: saved && accepted, consentVersion: saved && accepted ? CONSENT_VERSION : 0 };
    }

    function invalidate() { consentEpoch += 1; }

    function senderService(sender) {
      try {
        const url = new URL(sender?.url);
        return root.NudeNyangMessengerAdapters.privateSiteForLocation(url)?.id ?? null;
      } catch { return null; }
    }

    function validContext(request, sender) {
      const context = request.privateContext;
      if (!context || !SERVICES.has(context.service) || context.consentVersion !== CONSENT_VERSION
        || sender?.frameId !== 0 || !Number.isInteger(sender?.tab?.id)
        || sender?.id !== api.runtime.id
        || typeof request.pageId !== "string"
        || !new RegExp(`^messenger:${context.service}:[A-Za-z0-9_-]{16,128}$`, "u").test(request.pageId)) return false;
      try {
        const url = new URL(sender.url);
        if (url.protocol !== "https:" || url.port || url.username || url.password) return false;
        return root.NudeNyangMessengerAdapters.canHostConversation(url, context.service);
      } catch { return false; }
    }

    async function forward(request, sender, nativeRequest) {
      if (request?.type !== "translate") return nativeRequest(request);
      const privateRequest = request.privateContext != null || senderService(sender) != null;
      if (!privateRequest) return nativeRequest(request);
      if (!validContext(request, sender)) return denied(request, "messenger_invalid_context");
      const epoch = consentEpoch;
      let consent = await getConsent();
      if (epoch !== consentEpoch || !consent.granted) return denied(request, "messenger_consent_required");
      // An older native app must never interpret private messages as ordinary cached website text.
      const status = await nativeRequest({ type: "status", requestId: `${request.requestId ?? "private"}-gate` });
      if (status?.type !== "status") return denied(request, status?.code ?? "native_host_unavailable");
      if (status.webSettings?.enabled === false) return denied(request, "web_translation_disabled");
      if (status.webSettings?.messengerEnabled !== true) return denied(request, "messenger_disabled");
      if (!LOCAL_TRANSLATORS.has(status.translator)) return denied(request, "messenger_local_only");
      // Storage/permission reads yield; revocation and regrant during either read invalidate this request.
      consent = await getConsent();
      if (epoch !== consentEpoch || !consent.granted) return denied(request, "messenger_consent_required");
      const response = await nativeRequest(request);
      consent = await getConsent();
      if (epoch !== consentEpoch || !consent.granted) return denied(request, "messenger_request_cancelled");
      return response;
    }

    async function openNotice(contextId, sender, currentStatus) {
      const service = typeof contextId === "string" ? contextId.split(":")[1] : "";
      if (!validContext({ pageId: contextId, privateContext: { service, consentVersion: CONSENT_VERSION } }, sender)) return { ok: false };
      const status = await currentStatus(sender.tab.id);
      if (status?.messengerContextId !== contextId || status?.messengerService !== service
        || status?.messengerGate !== "messenger_consent_required") return { ok: false };
      // Use the browser's sender tab, never a page-supplied destination or URL.
      const url = new URL(api.runtime.getURL("messenger-privacy.html"));
      url.searchParams.set("tab", String(sender.tab.id));
      url.searchParams.set("context", contextId);
      return new Promise((resolve) => {
        try {
          api.tabs.create({ url: url.href }, (tab) => resolve({ ok: !api.runtime.lastError && Number.isInteger(tab?.id) }));
        } catch { resolve({ ok: false }); }
      });
    }

    return Object.freeze({ getConsent, setConsent, forward, invalidate, openNotice });
  }

  const exported = Object.freeze({ CONSENT_VERSION, CONSENT_KEY, createMessengerPrivacy });
  root.NudeNyangMessengerPrivacy = exported;
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
})(globalThis);
