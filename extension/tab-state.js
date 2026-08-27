(function exposeTabTranslationState(root) {
  const KEY_PREFIX = "nudenyang-tab-enabled:";

  function createTabTranslationState(api) {
    const memory = new Map();
    const revisions = new Map();
    const pendingWrites = new Map();
    const storage = api.storage?.session;

    function validTabId(tabId) {
      return Number.isInteger(tabId) && tabId >= 0;
    }

    function key(tabId) {
      return `${KEY_PREFIX}${tabId}`;
    }

    function revision(tabId) {
      if (!revisions.has(tabId)) revisions.set(tabId, {});
      return revisions.get(tabId);
    }

    function currentValue(tabId) {
      return memory.get(tabId) ?? null;
    }

    function httpOrigin(value) {
      try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
      } catch {
        return null;
      }
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

    function persist(tabId, operation) {
      // Session writes may finish out of order; a late set must not undo clear/off.
      const write = (pendingWrites.get(tabId) ?? Promise.resolve()).then(operation);
      pendingWrites.set(tabId, write);
      return write.then(() => {
        if (pendingWrites.get(tabId) === write) pendingWrites.delete(tabId);
      });
    }

    function readTab(tabId) {
      return new Promise((resolve) => {
        if (!api.tabs?.get) {
          resolve(null);
          return;
        }
        try {
          api.tabs.get(tabId, (tab) => {
            const error = api.runtime?.lastError;
            resolve(!error && tab?.id === tabId ? tab : null);
          });
        } catch {
          resolve(null);
        }
      });
    }

    function readPageOrigin(tabId) {
      return new Promise((resolve) => {
        if (!api.tabs?.sendMessage) {
          resolve(null);
          return;
        }
        try {
          // Without broad tabs permission the URL can be omitted. Ask only our
          // top-frame script for its current origin, never infer it from history.
          api.tabs.sendMessage(tabId, { type: "nudenyang-status" }, { frameId: 0 }, (response) => {
            const error = api.runtime?.lastError;
            resolve(error ? null : httpOrigin(response?.origin));
          });
        } catch {
          resolve(null);
        }
      });
    }

    async function get(tabId) {
      if (!validTabId(tabId)) return null;
      if (memory.has(tabId)) return currentValue(tabId);
      const beforeRead = revision(tabId);
      const storageKey = key(tabId);
      const values = await storageGet({ [storageKey]: null });
      if (revisions.get(tabId) !== beforeRead) return currentValue(tabId);
      const value = typeof values?.[storageKey] === "boolean" ? values[storageKey] : null;
      if (value !== null) memory.set(tabId, value);
      return value;
    }

    async function set(tabId, enabled) {
      if (!validTabId(tabId)) return null;
      const value = Boolean(enabled);
      revisions.set(tabId, {});
      memory.set(tabId, value);
      await persist(tabId, () => storageSet({ [key(tabId)]: value }));
      return value;
    }

    async function clear(tabId) {
      if (!validTabId(tabId)) return;
      const clearedRevision = {};
      revisions.set(tabId, clearedRevision);
      // Keep a tombstone until the queued removal finishes, so a concurrent get
      // cannot restore the old session value while a previous write is pending.
      memory.set(tabId, null);
      await persist(tabId, () => storageRemove(key(tabId)));
      if (revisions.get(tabId) === clearedRevision) {
        memory.delete(tabId);
        revisions.delete(tabId);
      }
    }

    async function getForTab(tab, senderUrl) {
      const tabId = tab?.id;
      if (!validTabId(tabId)) return null;
      const beforeLookup = revision(tabId);
      const ownValue = await get(tabId);
      if (revisions.get(tabId) !== beforeLookup) return currentValue(tabId);
      if (ownValue !== null) return ownValue;

      let child = tab;
      let childUrl = senderUrl ?? tab.url;
      if (childUrl !== undefined && !httpOrigin(childUrl)) return currentValue(tabId);
      if (child.openerTabId === undefined || childUrl === undefined) {
        child = await readTab(tabId);
        if (!child) return currentValue(tabId);
        // Do not use an opener from a newer, different-origin navigation.
        if (childUrl !== undefined && child.url !== undefined && httpOrigin(child.url) !== httpOrigin(childUrl)) {
          return currentValue(tabId);
        }
        childUrl ??= child.url;
      }
      const childOrigin = httpOrigin(childUrl);
      const openerTabId = child.openerTabId;
      if (!childOrigin || !validTabId(openerTabId) || openerTabId === tabId) return currentValue(tabId);

      // Only explicit parent on/off is inherited. Site defaults and policies
      // remain the child's responsibility and are not converted into overrides.
      await get(openerTabId);
      if (currentValue(openerTabId) === null) return currentValue(tabId);
      const opener = await readTab(openerTabId);
      if (!opener) return currentValue(tabId);
      const openerOrigin = opener.url === undefined
        ? await readPageOrigin(openerTabId)
        : httpOrigin(opener.url);
      if (openerOrigin !== childOrigin || revisions.get(tabId) !== beforeLookup) return currentValue(tabId);
      const inherited = currentValue(openerTabId);
      if (inherited === null) return currentValue(tabId);
      await set(tabId, inherited);
      return currentValue(tabId);
    }

    return Object.freeze({
      get,
      getForTab,
      set,
      clear,
    });
  }

  const api = Object.freeze({ createTabTranslationState });
  root.NudeNyangTabTranslationState = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(globalThis);
