(function exposeEmbeddedBridge(root) {
  const MAX_FRAMES_PER_TAB = 100;
  const EMBED_ORIGINS = new Set(["https://www.youtube.com", "https://www.youtube-nocookie.com"]);

  function allowedEmbedUrl(value) {
    try {
      const url = new URL(value);
      return EMBED_ORIGINS.has(url.origin) && !url.username && !url.password
        && url.pathname.startsWith("/embed/") && url.pathname.length > "/embed/".length;
    } catch {
      return false;
    }
  }

  function validTabId(value) {
    return Number.isInteger(value) && value >= 0;
  }

  function validContext(value) {
    return Number.isSafeInteger(value?.epoch) && value.epoch >= 0
      && typeof value.translationKey === "string" && value.translationKey.length > 0
      && value.translationKey.length <= 512;
  }

  function unavailable(retryable = false) {
    return { ok: false, code: "unavailable", retryable };
  }

  function createEmbeddedBridge(api) {
    const tabs = new Map();

    function runtimeError() {
      try {
        return api.runtime?.lastError?.message ?? "";
      } catch {
        return "Extension context invalidated.";
      }
    }

    function clear(tabId) {
      tabs.delete(tabId);
    }

    function refreshChildren(tabId) {
      // Content scripts survive MV3 worker restarts, but this registry does not.
      // Broadcast only a refresh signal; every responding embed must obtain fresh
      // top-document approval before it can relay any title or reuse a context.
      clear(tabId);
      try {
        api.tabs.sendMessage(tabId, { type: "nudenyang-embed-refresh" }, {}, () => {
          void runtimeError();
        });
      } catch {
        // A closed tab or a document without embedded listeners needs no retry.
      }
    }

    function handle(message, sender, sendResponse) {
      if (message?.type === "nudenyang-embed-parent-changed") {
        if (sender?.frameId !== 0 || !validTabId(sender?.tab?.id)) {
          sendResponse(unavailable());
        } else {
          refreshChildren(sender.tab.id);
          sendResponse({ ok: true });
        }
        return true;
      }
      if (message?.type !== "nudenyang-embed-request") return false;

      const tabId = sender?.tab?.id;
      const frameId = sender?.frameId;
      const token = message.documentToken;
      if (!validTabId(tabId) || !Number.isInteger(frameId) || frameId <= 0
        || !allowedEmbedUrl(sender?.url)
        || typeof token !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(token)
        || !["status", "translate"].includes(message.action)) {
        sendResponse(unavailable());
        return true;
      }
      if (message.action === "translate" && (!validContext(message)
        || typeof message.title !== "string" || !message.title.trim() || message.title.length > 1000)) {
        sendResponse(unavailable());
        return true;
      }

      let frames = tabs.get(tabId);
      let frame = frames?.get(frameId);
      if (message.action === "status") {
        if (!frames) {
          frames = new Map();
          tabs.set(tabId, frames);
        }
        if (!frame && frames.size >= MAX_FRAMES_PER_TAB) {
          sendResponse({ ok: false, code: "limited" });
          return true;
        }
        if (!frame || frame.token !== token || frame.url !== sender.url) {
          frame = { token, url: sender.url, revision: 0, context: null };
          frames.set(frameId, frame);
        }
        frame.revision += 1;
        frame.context = null;
      } else {
        if (!frame || frame.token !== token || frame.url !== sender.url) {
          sendResponse({ ok: false, code: "stale" });
          return true;
        }
        // A frame must obtain the top document's approval before sending source text.
        if (!frame.context?.enabled) {
          sendResponse({ ok: false, code: "disabled" });
          return true;
        }
        if (frame.context.epoch !== message.epoch || frame.context.translationKey !== message.translationKey) {
          sendResponse({ ok: false, code: "stale" });
          return true;
        }
      }

      const revision = frame.revision;
      // Never trust tab/frame identifiers or arbitrary extra fields from the payload.
      const forwarded = {
        type: "nudenyang-embed-parent-request",
        action: message.action,
        documentToken: token,
        frameId,
        frameUrl: sender.url,
      };
      if (message.action === "translate") {
        forwarded.epoch = message.epoch;
        forwarded.translationKey = message.translationKey;
        forwarded.title = message.title;
      }
      try {
        api.tabs.sendMessage(tabId, forwarded, { frameId: 0 }, (response) => {
          const error = runtimeError();
          if (tabs.get(tabId)?.get(frameId) !== frame || frame.revision !== revision) {
            sendResponse({ ok: false, code: "stale" });
            return;
          }
          if (error || !response || typeof response.ok !== "boolean") {
            sendResponse(unavailable(true));
            return;
          }
          if (message.action === "status" && response.ok && validContext(response)) {
            frame.context = {
              enabled: response.enabled === true,
              epoch: response.epoch,
              translationKey: response.translationKey,
            };
          }
          sendResponse(response);
        });
      } catch {
        sendResponse(unavailable(true));
      }
      return true;
    }

    return Object.freeze({ handle, clear });
  }

  const bridgeApi = Object.freeze({ createEmbeddedBridge });
  root.NudeNyangEmbeddedBridge = bridgeApi;
  if (typeof module !== "undefined" && module.exports) module.exports = bridgeApi;
})(globalThis);
