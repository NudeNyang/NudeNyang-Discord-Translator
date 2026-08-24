(function exposeTabTranslationState(root) {
  const KEY_PREFIX = "nudenyang-tab-enabled:";

  function createTabTranslationState(api) {
    const memory = new Map();
    const storage = api.storage?.session;

    function validTabId(tabId) {
      return Number.isInteger(tabId) && tabId >= 0;
    }

    function key(tabId) {
      return `${KEY_PREFIX}${tabId}`;
    }

    function storageGet(defaults) {
      return new Promise((resolve) => {
        if (!storage?.get) {
          resolve(defaults);
          return;
        }
        try {
          storage.get(defaults, (values) => {
            void api.runtime?.lastError;
            resolve(values ?? defaults);
          });
        } catch {
          resolve(defaults);
        }
      });
    }

    function storageSet(update) {
      return new Promise((resolve) => {
        if (!storage?.set) {
          resolve();
          return;
        }
        try {
          storage.set(update, () => {
            void api.runtime?.lastError;
            resolve();
          });
        } catch {
          resolve();
        }
      });
    }

    function storageRemove(storageKey) {
      return new Promise((resolve) => {
        if (!storage?.remove) {
          resolve();
          return;
        }
        try {
          storage.remove(storageKey, () => {
            void api.runtime?.lastError;
            resolve();
          });
        } catch {
          resolve();
        }
      });
    }

    return Object.freeze({
      async get(tabId) {
        if (!validTabId(tabId)) return null;
        if (memory.has(tabId)) return memory.get(tabId);
        const storageKey = key(tabId);
        const values = await storageGet({ [storageKey]: null });
        const value = typeof values?.[storageKey] === "boolean" ? values[storageKey] : null;
        if (value !== null) memory.set(tabId, value);
        return value;
      },
      async set(tabId, enabled) {
        if (!validTabId(tabId)) return null;
        const value = Boolean(enabled);
        memory.set(tabId, value);
        await storageSet({ [key(tabId)]: value });
        return value;
      },
      async clear(tabId) {
        if (!validTabId(tabId)) return;
        memory.delete(tabId);
        await storageRemove(key(tabId));
      },
    });
  }

  const api = Object.freeze({ createTabTranslationState });
  root.NudeNyangTabTranslationState = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(globalThis);
