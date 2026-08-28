(function exposeGlobalTranslationState(root) {
  const CONSENT_VERSION = 2;
  const ENABLED_KEY = "webTranslationEnabled";
  const CONSENT_KEY = "webTranslationConsentVersion";

  function createGlobalTranslationState(api, { messengerPrivacy } = {}) {
    let queue = Promise.resolve();
    let revision = 0;
    let notice = null;
    let forcedOff = false;
    const defaults = { [ENABLED_KEY]: false, [CONSENT_KEY]: 0 };
    function storage(method, value) {
      return new Promise((resolve, reject) => {
        try {
          api.storage.local[method](value, result => {
            const error = api.runtime.lastError;
            if (error) reject(new Error(error.message));
            else resolve(result);
          });
        } catch (error) { reject(error); }
      });
    }
    function serialize(operation) {
      const pending = queue.then(operation);
      queue = pending.catch(() => {});
      return pending;
    }
    async function read() {
      try {
        const saved = await storage("get", defaults);
        const consent = saved?.[CONSENT_KEY] === CONSENT_VERSION;
        return { ok: true, consent, enabled: !forcedOff && consent && saved?.[ENABLED_KEY] === true };
      } catch { return { ok: false, consent: false, enabled: false }; }
    }
    function get() { return serialize(read); }
    function invalidate() { revision += 1; }
    function openNotice() {
      if (notice) return notice;
      // A focused extension-owned page is also usable without an active HTTP tab.
      notice = new Promise(resolve => {
        try {
          api.tabs.create({ url: api.runtime.getURL("messenger-privacy.html"), active: true }, tab => {
            void api.runtime.lastError;
            resolve(Boolean(tab?.id));
          });
        } catch { resolve(false); }
      }).finally(() => { notice = null; });
      return notice;
    }
    function set(value) {
      return serialize(async () => {
        const current = await read();
        const enabled = value === "toggle" ? !current.enabled : value === true;
        if (enabled && !current.consent) {
          await openNotice();
          return { ...current, needsConsent: true };
        }
        invalidate();
        if (!enabled) forcedOff = true;
        try {
          await storage("set", { [ENABLED_KEY]: enabled });
          forcedOff = !enabled;
          return { ...current, ok: true, enabled };
        } catch { return { ...current, ok: false, enabled: !forcedOff && current.enabled }; }
      });
    }
    function isConsentPage(sender) {
      return sender?.id === api.runtime.id
        && sender?.url?.split(/[?#]/u)[0] === api.runtime.getURL("messenger-privacy.html");
    }
    function consent(granted, sender) {
      if (!isConsentPage(sender)) {
        return Promise.resolve({ ok: false, enabled: false, consent: false });
      }
      return serialize(async () => {
        invalidate();
        if (granted !== true) forcedOff = true;
        try {
          await storage("set", { [CONSENT_KEY]: granted === true ? CONSENT_VERSION : 0,
            [ENABLED_KEY]: granted === true });
          forcedOff = granted !== true;
          return read();
        } catch { return { ok: false, enabled: false, consent: false }; }
      });
    }

    async function readPrivacy() {
      const saved = await storage("get", { ...defaults, messengerConsentVersion: 0 });
      const webGranted = saved?.[CONSENT_KEY] === CONSENT_VERSION;
      const messengerRecorded = saved?.messengerConsentVersion === 5;
      const messengerPermissionGranted = await messengerPrivacy.dataPermissionGranted();
      const messengerGranted = messengerRecorded && messengerPermissionGranted;
      return { ok: true, enabled: !forcedOff && webGranted && saved?.[ENABLED_KEY] === true,
        webGranted, messengerGranted, messengerPermissionGranted,
        granted: webGranted && messengerGranted,
        anyGranted: Number(saved?.[CONSENT_KEY]) > 0 || Number(saved?.messengerConsentVersion) > 0 };
    }
    function privacyState() { return serialize(readPrivacy); }
    function privacyConsent(granted, sender) {
      if (!isConsentPage(sender)) return Promise.resolve({ ok: false });
      return serialize(async () => {
        invalidate();
        if (granted !== true) forcedOff = true;
        try {
          const allowMessenger = granted === true && await messengerPrivacy.dataPermissionGranted();
          // One explicit approval, one storage write. The native protocol still
          // checks private reading v5 independently; a missing browser permission only
          // blocks personal communications, not ordinary webpage translation.
          await storage("set", { [CONSENT_KEY]: granted === true ? CONSENT_VERSION : 0,
            [ENABLED_KEY]: granted === true, messengerConsentVersion: allowMessenger ? 5 : 0 });
          forcedOff = granted !== true;
          messengerPrivacy.invalidate?.();
          return await readPrivacy();
        } catch { return { ok: false }; }
      });
    }
    return Object.freeze({ get, set, consent, privacyState, privacyConsent, openNotice, invalidate,
      get revision() { return revision; } });
  }
  root.NudeNyangGlobalTranslationState = Object.freeze({ createGlobalTranslationState, ENABLED_KEY, CONSENT_KEY });
})(globalThis);
