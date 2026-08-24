(() => {
  const api = globalThis.chrome ?? globalThis.whale;
  const adapters = globalThis.NudeNyangSiteAdapters;
  const {
    createScanBatch,
    isElementNearViewport,
    initialTranslationEnabled,
    isQuickToggleShortcut,
    runtimeMessageFailure,
    scanRootForAddedNode,
    takeTranslationBatch,
    webSchedulingProfile,
  } = globalThis.NudeNyangContentHelpers;
  const MAX_ITEM_CHARS = 4000;
  const EXTERNAL_TRANSLATORS = new Set(["chatgpt", "claude", "gemini", "deepl"]);
  const DEFAULT_WEB_SETTINGS = Object.freeze({
    enabled: true,
    targetLanguage: "display",
    processingMode: "balanced",
    externalPageCharLimit: 25000,
    sitePolicies: {},
  });
  const APPLY_CHUNK_SIZE = 12;
  const trackedNodes = new Set();
  const nodeStates = new WeakMap();
  let blockIds = new WeakMap();
  let observedBlocks = new WeakSet();
  const queue = [];
  let enabled = false;
  let translating = false;
  let sequence = 0;
  let pageEpoch = 0;
  let currentUrl = location.href;
  let adapter = adapters.adapterForLocation(location);
  let observer;
  let intersectionObserver;
  let rescanTimer;
  let navigationTimer;
  let flushTimer;
  let applyTimer;
  let applyingFrame;
  const pendingScanBatch = createScanBatch();
  const pendingApplications = [];
  let lastError = "";
  let webSettings = { ...DEFAULT_WEB_SETTINGS };
  let sitePolicy = "default";
  let pageTargetLanguage = "";
  let externalProvider = false;
  let scheduling = webSchedulingProfile("balanced", false);
  let viewportActiveUntil = 0;
  let requestCount = 0;
  let sentChars = 0;
  let usageLimited = false;

  function storageGet(defaults) {
    return new Promise((resolve) => api.storage.local.get(defaults, resolve));
  }

  function nativeRequest(request) {
    return new Promise((resolve) => {
      try {
        api.runtime.sendMessage({ type: "nudenyang-native-request", request }, (response) => {
          let error;
          try {
            error = api.runtime.lastError;
          } catch (caught) {
            resolve(runtimeMessageFailure(request.requestId, caught));
            return;
          }
          resolve(error ? runtimeMessageFailure(request.requestId, error) : response);
        });
      } catch (error) {
        resolve(runtimeMessageFailure(request.requestId, error));
      }
    });
  }

  function logDiagnostic(event, detail = {}) {
    console.info("[NudeNyang Web Translator]", event, detail);
  }

  function currentHostname() {
    return location.hostname.toLowerCase().replace(/^www\./, "");
  }

  function normalizeWebSettings(value) {
    const source = value && typeof value === "object" ? value : {};
    const policies = source.sitePolicies && typeof source.sitePolicies === "object"
      ? source.sitePolicies
      : {};
    return {
      enabled: source.enabled !== false,
      targetLanguage: typeof source.targetLanguage === "string" ? source.targetLanguage : "display",
      processingMode: ["responsive", "balanced", "economy"].includes(source.processingMode)
        ? source.processingMode
        : "balanced",
      externalPageCharLimit: [0, 10000, 25000, 50000].includes(Number(source.externalPageCharLimit))
        ? Number(source.externalPageCharLimit)
        : 25000,
      sitePolicies: policies,
    };
  }

  function refreshSchedulingProfile() {
    scheduling = webSchedulingProfile(webSettings.processingMode, externalProvider);
  }

  function applyAppStatus(response) {
    if (response?.type !== "status") return;
    externalProvider = EXTERNAL_TRANSLATORS.has(response.translator);
    applyWebSettings(response.webSettings);
  }

  function applyWebSettings(value) {
    webSettings = normalizeWebSettings(value);
    sitePolicy = webSettings.sitePolicies[currentHostname()] ?? "default";
    refreshSchedulingProfile();
  }

  function initialEnabled(storedEnabled) {
    if (!adapter || !webSettings.enabled || sitePolicy === "never" || sitePolicy === "manual") {
      return false;
    }
    if (sitePolicy === "always") return true;
    return initialTranslationEnabled(storedEnabled, adapter);
  }

  function resetPageUsage() {
    requestCount = 0;
    sentChars = 0;
    usageLimited = false;
  }

  function effectiveTargetLanguage() {
    if (pageTargetLanguage) return pageTargetLanguage;
    return webSettings.targetLanguage === "display" ? undefined : webSettings.targetLanguage;
  }

  function releasePending(item) {
    const state = nodeStates.get(item.node);
    if (state?.itemId === item.id) state.pending = false;
  }

  function pruneDisconnectedNodes() {
    for (const node of trackedNodes) {
      if (!node.isConnected) {
        trackedNodes.delete(node);
        nodeStates.delete(node);
      }
    }
  }

  function stopForUsageLimit() {
    usageLimited = true;
    lastError = "이 페이지의 외부 번역 서비스 전송 한도에 도달했습니다.";
    while (queue.length > 0) releasePending(queue.shift());
  }

  function blockId(block) {
    if (!blockIds.has(block)) {
      blockIds.set(block, `${adapter.id}-${pageEpoch}-${++sequence}`);
    }
    return blockIds.get(block);
  }

  function eligibleTextNodes(block) {
    const excluded = adapters.exclusionSelector(adapter);
    if (block.matches(excluded) || block.closest(excluded)) {
      return [];
    }
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const text = node.nodeValue ?? "";
        if (text.trim().length < 2 || text.length > MAX_ITEM_CHARS) {
          return NodeFilter.FILTER_REJECT;
        }
        const parent = node.parentElement;
        if (!parent || parent.closest(excluded)) {
          return NodeFilter.FILTER_REJECT;
        }
        const state = nodeStates.get(node);
        if (state?.pending || (state?.translated && text === state.translated)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) {
      nodes.push(walker.currentNode);
    }
    return nodes;
  }

  function enqueueBlock(block) {
    if (!enabled || !adapter || usageLimited || !isElementNearViewport(block, innerHeight, scheduling.viewportMargin)) {
      return;
    }
    const id = blockId(block);
    for (const node of eligibleTextNodes(block)) {
      const original = node.nodeValue;
      const itemId = `${id}-${++sequence}`;
      nodeStates.set(node, { original, translated: null, pending: true, itemId, epoch: pageEpoch });
      trackedNodes.add(node);
      queue.push({ id: itemId, blockId: id, text: original, node, block, epoch: pageEpoch });
    }
    scheduleFlush();
  }

  function scheduleFlush(delay = scheduling.collectDelayMs) {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      flushTimer = undefined;
      void flushQueue();
    }, Math.max(0, delay));
  }

  function scheduleApplications() {
    clearTimeout(applyTimer);
    if (pendingApplications.length === 0) return;
    const remaining = Math.max(0, viewportActiveUntil - performance.now());
    applyTimer = setTimeout(() => {
      applyTimer = undefined;
      if (applyingFrame) cancelAnimationFrame(applyingFrame);
      applyingFrame = requestAnimationFrame(applyApplicationChunk);
    }, remaining);
  }

  function applyApplicationChunk() {
    applyingFrame = undefined;
    if (performance.now() < viewportActiveUntil) {
      scheduleApplications();
      return;
    }
    let applied = 0;
    for (let count = 0; count < APPLY_CHUNK_SIZE && pendingApplications.length > 0; count += 1) {
      const { item, translated } = pendingApplications.shift();
      const state = nodeStates.get(item.node);
      if (
        translated != null
        && state?.itemId === item.id
        && state.epoch === pageEpoch
        && item.node.isConnected
        && item.node.nodeValue === state.original
      ) {
        state.pending = false;
        state.translated = translated;
        item.node.nodeValue = translated;
        applied += 1;
      } else if (state?.itemId === item.id) {
        state.pending = false;
      }
    }
    if (applied > 0) logDiagnostic("dom-chunk-applied", { applied, remaining: pendingApplications.length });
    if (pendingApplications.length > 0) {
      applyingFrame = requestAnimationFrame(applyApplicationChunk);
    }
  }

  function noteViewportActivity() {
    viewportActiveUntil = performance.now() + scheduling.applyDelayMs;
    if (queue.length > 0) scheduleFlush();
    if (pendingApplications.length > 0) scheduleApplications();
  }

  async function flushQueue() {
    if (translating || !enabled || usageLimited || queue.length === 0) {
      return;
    }
    translating = true;
    const remainingBudget = externalProvider && webSettings.externalPageCharLimit > 0
      ? Math.max(0, webSettings.externalPageCharLimit - sentChars)
      : scheduling.maxChars;
    if (remainingBudget === 0) {
      translating = false;
      stopForUsageLimit();
      return;
    }
    const batch = takeTranslationBatch(queue, {
      maxItems: scheduling.maxItems,
      maxChars: Math.min(scheduling.maxChars, remainingBudget),
      discardOversize: externalProvider && webSettings.externalPageCharLimit > 0,
      isCurrent(item) {
        const state = nodeStates.get(item.node);
        return item.epoch === pageEpoch
          && state?.itemId === item.id
          && state.epoch === pageEpoch
          && item.node.isConnected
          && item.node.nodeValue === state.original;
      },
      isNearViewport(item) {
        return isElementNearViewport(item.block, innerHeight, scheduling.viewportMargin);
      },
      onDiscard: releasePending,
    });
    if (batch.length === 0) {
      translating = false;
      if (externalProvider && webSettings.externalPageCharLimit > 0 && remainingBudget < MAX_ITEM_CHARS) {
        stopForUsageLimit();
      }
      return;
    }
    const requestId = `web-${Date.now()}-${++sequence}`;
    const batchChars = batch.reduce((total, item) => total + item.text.length, 0);
    requestCount += 1;
    sentChars += batchChars;
    const response = await nativeRequest({
      type: "translate",
      requestId,
      pageId: `${adapter.id}:${location.origin}${location.pathname}`.slice(0, 240),
      targetLanguage: effectiveTargetLanguage(),
      items: batch.map(({ id, blockId: itemBlockId, text }) => ({ id, blockId: itemBlockId, text })),
    });
    if (response?.type === "translationResult") {
      if (response.translator) externalProvider = EXTERNAL_TRANSLATORS.has(response.translator);
      if (response.webSettings) applyWebSettings(response.webSettings);
      const results = new Map(response.items.map((item) => [item.id, item.text]));
      const rejected = {
        missingResult: 0,
      };
      for (const item of batch) {
        const translated = results.get(item.id);
        if (translated == null) rejected.missingResult += 1;
        if (translated == null) releasePending(item);
        else pendingApplications.push({ item, translated });
      }
      scheduleApplications();
      logDiagnostic("batch-applied", {
        requested: batch.length,
        returned: response.items.length,
        queuedForApply: batch.length - rejected.missingResult,
        requestCount,
        sentChars,
        epoch: pageEpoch,
        rejected,
      });
      lastError = "";
    } else {
      for (const item of batch) {
        const state = nodeStates.get(item.node);
        if (state?.itemId === item.id) {
          state.pending = false;
        }
      }
      lastError = response?.message ?? "Windows 앱에서 번역 결과를 받지 못했습니다.";
      if (response?.code === "extension_context_invalidated") {
        shutdownInvalidatedContext();
        return;
      }
      console.warn("[NudeNyang Web Translator] batch-failed", {
        code: response?.code ?? "unknown",
        retryable: Boolean(response?.retryable),
        epoch: pageEpoch,
      });
      if (response?.retryable && enabled) {
        setTimeout(() => {
          for (const item of batch) {
            if (item.epoch === pageEpoch && item.node.isConnected) {
              enqueueBlock(item.node.parentElement?.closest(adapter.blocks.join(",")) ?? item.node.parentElement);
            }
          }
        }, response.code === "model_preparing" ? 2500 : 5000);
      }
    }
    translating = false;
    if (externalProvider && webSettings.externalPageCharLimit > 0 && sentChars >= webSettings.externalPageCharLimit) {
      stopForUsageLimit();
      return;
    }
    if (queue.length > 0) {
      scheduleFlush();
    }
  }

  function restoreOriginals() {
    queue.length = 0;
    pendingApplications.length = 0;
    clearTimeout(flushTimer);
    clearTimeout(applyTimer);
    if (applyingFrame) cancelAnimationFrame(applyingFrame);
    flushTimer = undefined;
    applyTimer = undefined;
    applyingFrame = undefined;
    for (const node of trackedNodes) {
      const state = nodeStates.get(node);
      if (state && node.isConnected && state.translated != null && node.nodeValue === state.translated) {
        node.nodeValue = state.original;
      }
      nodeStates.delete(node);
    }
    trackedNodes.clear();
  }

  function shutdownInvalidatedContext() {
    enabled = false;
    translating = false;
    observer?.disconnect();
    intersectionObserver?.disconnect();
    pendingScanBatch.clear();
    clearTimeout(rescanTimer);
    clearTimeout(flushTimer);
    clearTimeout(applyTimer);
    if (applyingFrame) cancelAnimationFrame(applyingFrame);
    clearInterval(navigationTimer);
    document.removeEventListener("scroll", noteViewportActivity, true);
    window.removeEventListener("keydown", handleQuickToggle, true);
    rescanTimer = undefined;
    navigationTimer = undefined;
    restoreOriginals();
  }

  function observeBlock(block) {
    if (!observedBlocks.has(block)) {
      observedBlocks.add(block);
      intersectionObserver.observe(block);
    }
    if (isElementNearViewport(block, innerHeight)) {
      enqueueBlock(block);
    }
  }

  function scan(root = document) {
    if (!enabled || !adapter || !root?.querySelectorAll) {
      return;
    }
    const selector = adapter.blocks.join(",");
    const containingBlock = root.nodeType === Node.ELEMENT_NODE ? root.closest(selector) : null;
    if (containingBlock) {
      observeBlock(containingBlock);
    }
    if (root.nodeType === Node.ELEMENT_NODE && root.matches(selector)) {
      observeBlock(root);
    }
    for (const block of root.querySelectorAll(selector)) {
      observeBlock(block);
    }
    pruneDisconnectedNodes();
  }

  function scheduleScan(root) {
    pendingScanBatch.add(root);
    if (rescanTimer) {
      return;
    }
    rescanTimer = setTimeout(() => {
      rescanTimer = undefined;
      for (const scanRoot of pendingScanBatch.drain(document)) {
        scan(scanRoot);
      }
    }, 120);
  }

  function handleNavigation() {
    if (location.href === currentUrl) {
      return;
    }
    currentUrl = location.href;
    pageEpoch += 1;
    restoreOriginals();
    resetPageUsage();
    pageTargetLanguage = "";
    blockIds = new WeakMap();
    observedBlocks = new WeakSet();
    intersectionObserver.disconnect();
    configureIntersectionObserver();
    pendingScanBatch.clear();
    clearTimeout(rescanTimer);
    rescanTimer = undefined;
    const nextAdapter = adapters.adapterForLocation(location);
    adapter = nextAdapter;
    sitePolicy = webSettings.sitePolicies[currentHostname()] ?? "default";
    if (sitePolicy === "never" || sitePolicy === "manual" || !webSettings.enabled) {
      enabled = false;
    } else if (sitePolicy === "always") {
      enabled = true;
    } else if (adapter?.manualOnly) {
      enabled = false;
    }
    lastError = "";
    scheduleScan(document);
  }

  async function setEnabled(value) {
    if (!adapter) {
      return status();
    }
    if (value && !webSettings.enabled) {
      lastError = "Windows 앱에서 웹 번역 사용이 꺼져 있습니다.";
      return status();
    }
    enabled = Boolean(value);
    usageLimited = false;
    lastError = "";
    if (enabled) {
      scan(document);
    } else {
      restoreOriginals();
    }
    return status();
  }

  function toggleEnabled() {
    return setEnabled(!enabled);
  }

  function handleQuickToggle(event) {
    if (!adapter || !isQuickToggleShortcut(event)) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    void toggleEnabled();
  }

  function status() {
    return {
      enabled,
      supported: Boolean(adapter),
      site: adapter?.id ?? "",
      manualOnly: Boolean(adapter?.manualOnly),
      translatedNodes: [...trackedNodes].filter((node) => nodeStates.get(node)?.translated != null).length,
      requestCount,
      sentChars,
      usageLimit: externalProvider ? webSettings.externalPageCharLimit : 0,
      usageLimited,
      targetLanguage: pageTargetLanguage || webSettings.targetLanguage,
      sitePolicy,
      processingMode: webSettings.processingMode,
      lastError,
    };
  }

  function configureIntersectionObserver() {
    intersectionObserver = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) noteViewportActivity();
      for (const entry of entries) {
        if (entry.isIntersecting) {
          enqueueBlock(entry.target);
        }
      }
    }, { rootMargin: `${scheduling.viewportMargin}px 0px` });
  }

  api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "nudenyang-status") {
      sendResponse(status());
      return false;
    }
    if (message?.type === "nudenyang-set-enabled") {
      setEnabled(message.enabled).then(sendResponse);
      return true;
    }
    if (message?.type === "nudenyang-toggle-enabled") {
      toggleEnabled().then(sendResponse);
      return true;
    }
    if (message?.type === "nudenyang-restore") {
      setEnabled(false).then(sendResponse);
      return true;
    }
    if (message?.type === "nudenyang-set-target-language") {
      pageTargetLanguage = typeof message.targetLanguage === "string" ? message.targetLanguage : "";
      pageEpoch += 1;
      restoreOriginals();
      resetPageUsage();
      if (enabled) scan(document);
      sendResponse(status());
      return false;
    }
    if (message?.type === "nudenyang-apply-web-settings") {
      applyWebSettings(message.webSettings);
      intersectionObserver?.disconnect();
      observedBlocks = new WeakSet();
      configureIntersectionObserver();
      if (!webSettings.enabled || sitePolicy === "never" || sitePolicy === "manual") {
        enabled = false;
        restoreOriginals();
      } else if (sitePolicy === "always") {
        enabled = true;
        scan(document);
      }
      sendResponse(status());
      return false;
    }
    return false;
  });

  window.addEventListener("keydown", handleQuickToggle, true);

  async function start() {
    const stored = await storageGet({ enabled: true });
    const appStatus = await nativeRequest({ type: "status", requestId: `content-${Date.now()}` });
    applyAppStatus(appStatus);
    enabled = initialEnabled(stored.enabled);
    configureIntersectionObserver();
    observer = new MutationObserver((mutations) => {
      handleNavigation();
      if (!enabled) {
        return;
      }
      const blockSelector = adapter?.blocks.join(",") ?? "body";
      for (const mutation of mutations) {
        if (mutation.type === "childList") {
          for (const node of mutation.addedNodes) {
            const scanRoot = scanRootForAddedNode(node, blockSelector);
            if (scanRoot) {
              scheduleScan(scanRoot);
            }
          }
        } else if (mutation.type === "characterData") {
          const state = nodeStates.get(mutation.target);
          if (!state || mutation.target.nodeValue !== state.translated) {
            const block = mutation.target.parentElement?.closest(adapter?.blocks.join(",") ?? "body");
            if (block) {
              scheduleScan(block);
            }
          }
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    document.addEventListener("scroll", noteViewportActivity, { capture: true, passive: true });
    navigationTimer = setInterval(handleNavigation, 500);
    scan(document);
  }

  void start();
})();
