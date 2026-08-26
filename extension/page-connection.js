(function exposePageConnection(root) {
  const DEFAULT_CONTENT_SCRIPTS = Object.freeze([
    "site-adapters.js",
    "content-helpers.js",
    "content.js",
  ]);

  function isWebPageUrl(value) {
    try {
      const protocol = new URL(value).protocol;
      return protocol === "http:" || protocol === "https:";
    } catch {
      return false;
    }
  }

  function isMissingReceiverError(value) {
    const message = String(value ?? "").toLowerCase();
    return message.includes("receiving end does not exist")
      || message.includes("could not establish connection")
      || message.includes("no matching message handler");
  }

  function createPageConnection(api, contentScripts = DEFAULT_CONTENT_SCRIPTS) {
    const recoveries = new Map();

    function runtimeError() {
      try {
        return api.runtime.lastError?.message ?? "";
      } catch (error) {
        return error?.message ?? String(error ?? "");
      }
    }

    function sendOnce(tabId, message) {
      return new Promise((resolve) => {
        try {
          api.tabs.sendMessage(tabId, message, (response) => {
            const error = runtimeError();
            resolve({ response: response ?? null, error });
          });
        } catch (error) {
          resolve({ response: null, error: error?.message ?? String(error) });
        }
      });
    }

    function tab(tabId) {
      return new Promise((resolve) => {
        try {
          api.tabs.get(tabId, (value) => {
            resolve(runtimeError() ? null : value ?? null);
          });
        } catch {
          resolve(null);
        }
      });
    }

    function inject(tabId) {
      return new Promise((resolve) => {
        if (!api.scripting?.executeScript) {
          resolve(false);
          return;
        }
        try {
          api.scripting.executeScript({
            target: { tabId },
            files: [...contentScripts],
          }, () => resolve(!runtimeError()));
        } catch {
          resolve(false);
        }
      });
    }

    async function recover(tabId) {
      if (recoveries.has(tabId)) return recoveries.get(tabId);
      const recovery = (async () => {
        const currentTab = await tab(tabId);
        if (!isWebPageUrl(currentTab?.url)) return false;
        return inject(tabId);
      })();
      recoveries.set(tabId, recovery);
      try {
        return await recovery;
      } finally {
        if (recoveries.get(tabId) === recovery) recoveries.delete(tabId);
      }
    }

    async function request(tabId, message) {
      if (typeof tabId !== "number") return null;
      const first = await sendOnce(tabId, message);
      if (!first.error && first.response) return first.response;
      if (!isMissingReceiverError(first.error)) return null;
      if (!await recover(tabId)) return null;
      const ready = await sendOnce(tabId, { type: "nudenyang-ready" });
      if (ready.error || !ready.response) return null;
      const retried = await sendOnce(tabId, message);
      return retried.error ? null : retried.response;
    }

    function ensure(tabId) {
      return request(tabId, { type: "nudenyang-status" });
    }

    return Object.freeze({ ensure, request });
  }

  const pageConnectionApi = Object.freeze({
    createPageConnection,
    isMissingReceiverError,
    isWebPageUrl,
  });
  root.NudeNyangPageConnection = pageConnectionApi;
  if (typeof module !== "undefined" && module.exports) module.exports = pageConnectionApi;
})(globalThis);
