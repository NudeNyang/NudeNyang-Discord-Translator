(function exposeEmbeddedTitle(root) {
  const TITLE_SELECTOR = "a.ytmVideoInfoVideoTitle > span.ytAttributedStringHost, a.ytp-title-link";
  const EXCLUDED_TEXT = "script,style,noscript,svg,canvas,button,input,textarea,select,option,"
    + "[contenteditable],[role='button'],[translate='no'],.notranslate,[data-nudenyang-ignore]";
  const RETRY_DELAYS = [300, 1000, 3000];
  const MAX_CACHE_ENTRIES = 32;

  function allowedEmbedUrl(value) {
    try {
      const url = new URL(value);
      return ["https://www.youtube.com", "https://www.youtube-nocookie.com"].includes(url.origin)
        && !url.username && !url.password && url.pathname.startsWith("/embed/")
        && url.pathname.length > "/embed/".length;
    } catch {
      return false;
    }
  }

  function validContext(value) {
    return Number.isSafeInteger(value?.epoch) && value.epoch >= 0
      && typeof value.translationKey === "string" && value.translationKey.length > 0
      && value.translationKey.length <= 512;
  }

  function runtimeVersion(runtime) {
    try {
      const version = runtime?.getManifest?.().version;
      return runtime?.id && typeof version === "string" && version.length > 0 ? version : null;
    } catch {
      return null;
    }
  }

  function createEmbeddedTitleController(api, environment = root) {
    const frameWindow = environment.window;
    const document = environment.document;
    if (!frameWindow || frameWindow === frameWindow.top || !document
      || !allowedEmbedUrl(environment.location?.href)) return null;
    const runtime = api?.runtime;
    const version = runtimeVersion(runtime);
    if (!version || !runtime?.sendMessage) return null;

    const setTimer = environment.setTimeout.bind(environment);
    const clearTimer = environment.clearTimeout.bind(environment);
    const documentToken = environment.crypto?.randomUUID?.()
      ?? `embed-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const cache = new Map();
    const pendingRequests = new Set();
    const observedTitles = new WeakSet();
    const intersections = new WeakMap();
    let generation = 0;
    let stopped = false;
    let currentStatus = null;
    let record = null;
    let lastAttempt = null;
    let retryAttempt = 0;
    let retryTimer;
    let scanTimer;
    let observer;
    let intersectionObserver;

    function unavailable(retryable = false) {
      return { ok: false, code: "unavailable", retryable };
    }

    function restoreRecord() {
      if (!record?.appliedValues) return;
      record.nodes.forEach((node, index) => {
        if (node.isConnected && node.nodeValue === record.appliedValues[index]
          && node.nodeValue !== record.originalValues[index]) node.nodeValue = record.originalValues[index];
      });
      record.appliedValues = null;
    }

    function invalidate() {
      generation += 1;
      lastAttempt = null;
      clearTimer(retryTimer);
      retryTimer = undefined;
      // Cancel local waiters only. Old native work may finish, but cannot write to this document.
      for (const finish of [...pendingRequests]) finish(unavailable());
    }

    function extensionRequest(action, fields = {}) {
      if (stopped || document.hidden) return Promise.resolve(unavailable());
      return new Promise((resolve) => {
        let settled = false;
        const finish = (response) => {
          if (settled) return;
          settled = true;
          clearTimer(timer);
          pendingRequests.delete(finish);
          resolve(response);
        };
        const timer = setTimer(() => finish(unavailable(true)), action === "status" ? 5000 : 200000);
        pendingRequests.add(finish);
        try {
          runtime.sendMessage({ type: "nudenyang-embed-request", action, documentToken, ...fields }, (response) => {
            let error = "";
            try {
              error = runtime.lastError?.message ?? "";
            } catch {
              error = "Extension context invalidated.";
            }
            if (/extension context invalidated/iu.test(error)) stop();
            finish(error ? unavailable(true) : response ?? unavailable(true));
          });
        } catch (error) {
          if (/extension context invalidated/iu.test(error?.message ?? "")) stop();
          finish(unavailable(true));
        }
      });
    }

    function visibleAncestors(element) {
      for (let parent = element; parent; parent = parent.parentElement) {
        if (parent.hidden || parent.getAttribute("aria-hidden") === "true") return false;
        const style = environment.getComputedStyle(parent);
        if (style.display === "none" || ["hidden", "collapse"].includes(style.visibility)
          || style.opacity === "0") return false;
      }
      return true;
    }

    function isVisible(element) {
      return !document.hidden && element.isConnected && element.getClientRects().length > 0
        && (!intersectionObserver || intersections.get(element) === true) && visibleAncestors(element);
    }

    function titleElements() {
      const elements = [...document.querySelectorAll(TITLE_SELECTOR)];
      for (const element of elements) {
        if (intersectionObserver && !observedTitles.has(element)) {
          observedTitles.add(element);
          intersectionObserver.observe(element);
        }
      }
      return elements;
    }

    function textNodes(element) {
      const nodes = [];
      const walker = document.createTreeWalker(element, environment.NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          return node.parentElement?.closest(EXCLUDED_TEXT) || !visibleAncestors(node.parentElement)
            ? environment.NodeFilter.FILTER_REJECT : environment.NodeFilter.FILTER_ACCEPT;
        },
      });
      while (walker.nextNode()) nodes.push(walker.currentNode);
      return nodes;
    }

    function sameNodes(nodes, saved) {
      return nodes.length === saved.length && nodes.every((node, index) => node === saved[index]);
    }

    function sameValues(nodes, values) {
      return Boolean(values) && nodes.every((node, index) => node.nodeValue === values[index]);
    }

    function readRecord() {
      const element = titleElements().find(isVisible);
      if (!element) return null;
      let nodes = textNodes(element);
      if (record?.element === element && sameNodes(nodes, record.nodes)
        && (sameValues(nodes, record.originalValues) || sameValues(nodes, record.appliedValues))) return record;
      // If a site appends or edits one title node, first undo only our unchanged writes.
      restoreRecord();
      nodes = textNodes(element);
      const originalValues = nodes.map((node) => node.nodeValue ?? "");
      const original = originalValues.join("");
      if (!original.trim() || original.length > 1000) return null;
      return { element, nodes, originalValues, original, appliedValues: null };
    }

    function applyTranslation(target, translation) {
      if (target !== record || !isVisible(target.element)
        || !sameNodes(textNodes(target.element), target.nodes)
        || !(sameValues(target.nodes, target.originalValues) || sameValues(target.nodes, target.appliedValues))) return;
      if (translation === target.original) {
        restoreRecord();
        return;
      }
      target.appliedValues = target.nodes.map((_node, index) => index === 0 ? translation : "");
      target.nodes.forEach((node, index) => {
        if (node.nodeValue !== target.appliedValues[index]) node.nodeValue = target.appliedValues[index];
      });
    }

    function cacheKey(context, target) {
      return JSON.stringify([context.translationKey, target.original]);
    }

    function remember(key, translation) {
      cache.delete(key);
      cache.set(key, translation);
      while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
    }

    function scheduleRetry(response) {
      if (stopped || document.hidden || response?.retryable === false
        || !["unavailable", "stale"].includes(response?.code) || retryAttempt >= RETRY_DELAYS.length) return;
      const delay = RETRY_DELAYS[retryAttempt++];
      clearTimer(retryTimer);
      retryTimer = setTimer(() => {
        retryTimer = undefined;
        void refresh(false);
      }, delay);
    }

    async function translateRecord(target, context) {
      const requestGeneration = generation;
      const response = await extensionRequest("translate", {
        epoch: context.epoch, translationKey: context.translationKey, title: target.original,
      });
      if (stopped || document.hidden || requestGeneration !== generation || record !== target) return;
      if (!response?.ok || response.enabled !== true || response.epoch !== context.epoch
        || response.translationKey !== context.translationKey || typeof response.translation !== "string"
        || !response.translation.trim() || response.translation.length > 8000) {
        if (response?.code === "disabled") {
          currentStatus = null;
          restoreRecord();
        }
        scheduleRetry(response?.ok ? { code: "stale" } : response);
        return;
      }
      if (!sameNodes(textNodes(target.element), target.nodes)
        || !sameValues(target.nodes, target.originalValues)) return;
      remember(cacheKey(context, target), response.translation);
      retryAttempt = 0;
      applyTranslation(target, response.translation);
    }

    function updateTitle() {
      if (stopped || document.hidden || currentStatus?.enabled !== true) return;
      const next = readRecord();
      if (next !== record) {
        invalidate();
        restoreRecord();
        record = next;
        retryAttempt = 0;
      }
      if (!record) return;
      const key = cacheKey(currentStatus, record);
      if (cache.has(key)) {
        retryAttempt = 0;
        applyTranslation(record, cache.get(key));
        return;
      }
      if (lastAttempt?.record === record && lastAttempt.generation === generation) return;
      lastAttempt = { record, generation };
      void translateRecord(record, currentStatus);
    }

    function scheduleScan() {
      if (stopped || scanTimer !== undefined) return;
      scanTimer = setTimer(() => {
        scanTimer = undefined;
        titleElements();
        updateTitle();
      }, 80);
    }

    async function refresh(resetRetries = true) {
      if (stopped) return;
      invalidate();
      restoreRecord();
      currentStatus = null;
      if (resetRetries) retryAttempt = 0;
      if (document.hidden) return;
      const requestGeneration = generation;
      const response = await extensionRequest("status");
      if (stopped || document.hidden || generation !== requestGeneration) return;
      if (!response?.ok || typeof response.enabled !== "boolean" || !validContext(response)) {
        scheduleRetry(response ?? unavailable(true));
        return;
      }
      currentStatus = response;
      if (response.enabled) updateTitle();
    }

    function handleRefresh(message, _sender, sendResponse) {
      if (message?.type === "nudenyang-embed-refresh") {
        void refresh();
        sendResponse?.({ ok: true });
      }
      return false;
    }

    function handleVisibility() {
      void refresh();
    }

    function handlePageHide() {
      invalidate();
      restoreRecord();
      currentStatus = null;
    }

    function stop() {
      if (stopped) return;
      stopped = true;
      invalidate();
      restoreRecord();
      clearTimer(scanTimer);
      observer?.disconnect();
      intersectionObserver?.disconnect();
      document.removeEventListener("visibilitychange", handleVisibility);
      frameWindow.removeEventListener("focus", handleVisibility);
      frameWindow.removeEventListener("pageshow", handleVisibility);
      frameWindow.removeEventListener("pagehide", handlePageHide);
      try {
        runtime.onMessage.removeListener?.(handleRefresh);
      } catch {
        // Reloaded extensions cannot access their old messaging context.
      }
    }

    if (environment.IntersectionObserver) {
      intersectionObserver = new environment.IntersectionObserver((entries) => {
        let becameVisible = false;
        for (const entry of entries) {
          if (entry.isIntersecting && intersections.get(entry.target) !== true) becameVisible = true;
          intersections.set(entry.target, entry.isIntersecting);
        }
        if (becameVisible) void refresh();
        else updateTitle();
      });
    }
    observer = new environment.MutationObserver(scheduleScan);
    observer.observe(document.documentElement, {
      childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: ["class", "style", "hidden", "aria-hidden"],
    });
    runtime.onMessage.addListener(handleRefresh);
    document.addEventListener("visibilitychange", handleVisibility);
    frameWindow.addEventListener("focus", handleVisibility);
    frameWindow.addEventListener("pageshow", handleVisibility);
    frameWindow.addEventListener("pagehide", handlePageHide);
    titleElements();
    void refresh();
    return Object.freeze({
      runtime,
      version,
      alive: () => !stopped && runtimeVersion(runtime) === version,
      refresh: () => refresh(),
      stop,
    });
  }

  const titleApi = Object.freeze({ createEmbeddedTitleController });
  root.NudeNyangEmbeddedTitle = titleApi;
  if (typeof module !== "undefined" && module.exports) module.exports = titleApi;
  if (!root.window || !root.document || root.window === root.window.top
    || !allowedEmbedUrl(root.location?.href)) return;
  const api = root.chrome ?? root.browser ?? root.whale;
  const runtime = api?.runtime;
  const version = runtimeVersion(runtime);
  if (!version) return;
  const previous = root.__NudeNyangEmbeddedTitleController;
  try {
    if (previous?.runtime === runtime && previous.version === version && previous.alive?.()) return;
  } catch {
    // Accessing an invalidated controller may throw after an extension reload.
  }
  previous?.stop();
  root.__NudeNyangEmbeddedTitleController = createEmbeddedTitleController(api);
})(globalThis);
