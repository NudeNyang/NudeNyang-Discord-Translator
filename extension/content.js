(() => {
  const api = globalThis.chrome ?? globalThis.browser ?? globalThis.whale;
  const adapters = globalThis.NudeNyangSiteAdapters;
  const INSTANCE_KEY = "__nudeNyangContentRuntime";
  const version = api.runtime.getManifest().version;
  const previous = globalThis[INSTANCE_KEY];
  if (previous?.version === version && previous.alive()) return;
  previous?.dispose();
  const {
    addTranslationItems,
    closestTranslationBlock,
    createScanBatch,
    groupTranslationApplications,
    isElementNearViewport,
    isExplicitExclusionBypassBlock,
    isQuickToggleShortcut,
    isUrlLikeLinkText,
    pageTranslationEnabled,
    registerTranslationBlock,
    runtimeMessageFailure,
    scanRootForAddedNode,
    syncTrackedTranslationDisplay,
    takeTranslationBatch,
    translationBatchLimits,
    webSchedulingProfile,
  } = globalThis.NudeNyangContentHelpers;
  const MAX_ITEM_CHARS = 4000;
  const EXTERNAL_TRANSLATORS = new Set(["chatgpt", "claude", "gemini", "deepl"]);
  const DEFAULT_WEB_SETTINGS = Object.freeze({
    enabled: true,
    targetLanguage: "display",
    processingMode: "balanced",
    externalPageCharLimit: 25000,
    quickToggleShortcut: "F4",
    sitePolicies: {},
  });
  const APPLY_BLOCKS_PER_FRAME = 2;
  const LAYOUT_OWNER = "p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,dt,dd,summary,th,td,div,section,article,main,body";
  const EMBED_HOSTS = new Set(["www.youtube.com", "www.youtube-nocookie.com"]);
  const trackedNodes = new Set();
  const nodeStates = new WeakMap();
  const embeddedRequests = new Map();
  let disposed = false;
  let layoutBlocks = new WeakSet();
  let visibilityRoots = new WeakSet();
  let blockIds = new WeakMap();
  let observedBlocks = new WeakSet();
  const queue = [];
  let enabled = false;
  let storedEnabled = true;
  let tabEnabled = null;
  let translating = false;
  let sequence = 0;
  let pageEpoch = 0;
  let currentUrl = location.href;
  let adapter = adapters.adapterForLocation(location);
  let blockSelector = adapter?.blocks.join(",") ?? "";
  let excludedSelector = adapter ? adapters.exclusionSelector(adapter) : "";
  let protectedSelector = adapter ? adapters.protectedExclusionSelector(adapter) : "";
  let observer;
  let visibilityObserver;
  let intersectionObserver;
  let rescanTimer;
  let navigationTimer;
  let flushTimer;
  let flushDueAt = 0;
  let applyTimer;
  let applyingFrame;
  const pendingScanBatch = createScanBatch();
  const pendingApplications = [];
  let lastError = "";
  let webSettings = { ...DEFAULT_WEB_SETTINGS };
  let sitePolicy = "default";
  let pageTargetLanguage = "";
  let externalProvider = false;
  let translator = "default";
  let appTargetLanguage = "KO";
  let scheduling = webSchedulingProfile("balanced", false);
  let viewportActiveUntil = 0;
  let longDocument = false;
  let requestCount = 0;
  let sentChars = 0;
  let usageLimited = false;
  let startupPromise;
  let stateChanges = Promise.resolve();

  globalThis[INSTANCE_KEY] = {
    version,
    alive: () => !disposed && Boolean(api.runtime.id),
    dispose: shutdownInvalidatedContext,
  };

  function assignAdapter(nextAdapter) {
    adapter = nextAdapter;
    blockSelector = adapter?.blocks.join(",") ?? "";
    excludedSelector = adapter ? adapters.exclusionSelector(adapter) : "";
    protectedSelector = adapter ? adapters.protectedExclusionSelector(adapter) : "";
  }

  function changeState(operation) {
    const next = stateChanges.then(() => startupPromise).then(() => (
      disposed ? status() : operation()
    ));
    stateChanges = next.catch(() => {});
    return next;
  }

  function storageGet(defaults) {
    return new Promise((resolve) => api.storage.local.get(defaults, resolve));
  }

  function extensionRequest(message) {
    return new Promise((resolve) => {
      try {
        api.runtime.sendMessage(message, (response) => {
          try {
            if (api.runtime.lastError) {
              resolve(null);
              return;
            }
          } catch {
            resolve(null);
            return;
          }
          resolve(response ?? null);
        });
      } catch {
        resolve(null);
      }
    });
  }

  async function loadTabEnabled() {
    const response = await extensionRequest({ type: "nudenyang-tab-enabled-get" });
    return typeof response?.enabled === "boolean" ? response.enabled : null;
  }

  async function saveTabEnabled(value) {
    const response = await extensionRequest({
      type: "nudenyang-tab-enabled-set",
      enabled: Boolean(value),
    });
    return typeof response?.enabled === "boolean" ? response.enabled : Boolean(value);
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
      quickToggleShortcut: typeof source.quickToggleShortcut === "string"
        ? source.quickToggleShortcut
        : "F4",
      sitePolicies: policies,
    };
  }

  function refreshSchedulingProfile() {
    scheduling = webSchedulingProfile(webSettings.processingMode, externalProvider);
  }

  function applyAppStatus(response) {
    if (response?.type !== "status") return;
    translator = response.translator ?? translator;
    appTargetLanguage = response.targetLanguage ?? appTargetLanguage;
    externalProvider = EXTERNAL_TRANSLATORS.has(response.translator);
    applyWebSettings(response.webSettings);
  }

  async function refreshAppStatus() {
    const response = await nativeRequest({ type: "status", requestId: `content-focus-${Date.now()}` });
    if (response?.type !== "status" || disposed) return;
    await changeState(() => {
      const oldKey = translationKey();
      applyAppStatus(response);
      refreshPageSettings(oldKey);
    });
  }

  function applyWebSettings(value) {
    webSettings = normalizeWebSettings(value);
    sitePolicy = webSettings.sitePolicies[currentHostname()] ?? "default";
    refreshSchedulingProfile();
  }

  function initialEnabled() {
    return pageTranslationEnabled({
      adapter,
      storedEnabled,
      tabEnabled,
      webEnabled: webSettings.enabled,
      sitePolicy,
    });
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

  function translationKey() {
    return JSON.stringify([translator, effectiveTargetLanguage() ?? appTargetLanguage]);
  }

  function visibleEmbed(frameUrl) {
    if (!adapter || document.hidden) return null;
    let url;
    try { url = new URL(frameUrl); } catch { return null; }
    if (url.protocol !== "https:" || !EMBED_HOSTS.has(url.hostname) || url.port
      || url.username || url.password || !/^\/embed\/[^/]+/u.test(url.pathname)) return null;
    for (const frame of document.querySelectorAll("iframe[src]")) {
      if (frame.src !== url.href
        || frame.matches("[hidden],[inert],[aria-hidden='true'],[translate='no'],.notranslate,[data-nudenyang-ignore]")
        || frame.parentElement?.closest(excludedSelector)) continue;
      if (!isElementNearViewport(frame, innerHeight, 0)) continue;
      const rect = frame.getBoundingClientRect();
      if (rect.right <= 0 || rect.left >= innerWidth) continue;
      let shown = true;
      for (let parent = frame; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse"
          || style.contentVisibility === "hidden" || style.opacity === "0") { shown = false; break; }
      }
      if (shown) return frame;
    }
    return null;
  }

  function embeddedContext() {
    return {
      ok: true, enabled: enabled && Boolean(adapter) && !disposed,
      epoch: pageEpoch, translationKey: translationKey(),
      targetLanguage: effectiveTargetLanguage() ?? appTargetLanguage,
    };
  }

  function isCurrentEmbedded(item) {
    return !disposed && enabled && item.epoch === pageEpoch
      && item.embedded.translationKey === translationKey()
      && embeddedRequests.get(item.embedded.frameId) === item
      && visibleEmbed(item.embedded.frameUrl) === item.block;
  }

  async function embeddedParentRequest(message, sender) {
    await startupPromise;
    if (disposed || sender?.id !== api.runtime.id || !Number.isInteger(message.frameId) || message.frameId <= 0
      || typeof message.documentToken !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(message.documentToken)) {
      return { ok: false, code: "unavailable" };
    }
    // SPA navigation may precede the normal mutation/interval notification.
    handleNavigation();
    const frame = visibleEmbed(message.frameUrl);
    const context = embeddedContext();
    if (message.action === "status") return { ...context, enabled: context.enabled && Boolean(frame) };
    if (message.action !== "translate" || !frame) return { ok: false, code: "unavailable" };
    if (!context.enabled) return { ok: false, code: "disabled" };
    if (message.epoch !== context.epoch || message.translationKey !== context.translationKey) {
      return { ok: false, code: "stale" };
    }
    if (typeof message.title !== "string" || !message.title.trim() || message.title.length > 1000) {
      return { ok: false, code: "unavailable" };
    }
    // Embedded titles use the SAME queue and page budget as the surrounding prose.
    // A child refresh invalidates its old reply, not the native work already in flight.
    // Hand the existing result to the newest waiter before checking the remaining budget.
    const previousItem = embeddedRequests.get(message.frameId);
    if (previousItem && isCurrentEmbedded(previousItem) && previousItem.block === frame
      && previousItem.text === message.title) {
      previousItem.embedded.resolve({ ok: false, code: "stale" });
      return new Promise((resolve) => { previousItem.embedded.resolve = resolve; });
    }
    if (previousItem) completeEmbedded(previousItem, { ok: false, code: "stale" });
    const remaining = webSettings.externalPageCharLimit - sentChars;
    if (usageLimited || (externalProvider && webSettings.externalPageCharLimit > 0 && message.title.length > remaining)) {
      return { ok: false, code: "limited" };
    }
    if (embeddedRequests.size >= 100) return { ok: false, code: "limited" };
    return new Promise((resolve) => {
      const id = `${blockId(frame)}-title-${++sequence}`;
      const item = {
        id, blockId: blockId(frame), text: message.title, block: frame, epoch: pageEpoch,
        embedded: { resolve, frameId: message.frameId, frameUrl: message.frameUrl, translationKey: context.translationKey },
      };
      embeddedRequests.set(message.frameId, item);
      queue.push(item);
      scheduleFlush();
    });
  }

  function notifyEmbeddedFrames() {
    if (!disposed) void extensionRequest({ type: "nudenyang-embed-parent-changed" });
  }

  function handleVisibilityChange() {
    if (document.hidden) cancelEmbeddedRequests("stale");
    notifyEmbeddedFrames();
  }

  function completeEmbedded(item, response) {
    if (embeddedRequests.get(item.embedded.frameId) !== item) return;
    embeddedRequests.delete(item.embedded.frameId);
    item.embedded.resolve(response);
  }

  function cancelEmbeddedRequests(code = "stale") {
    for (const item of embeddedRequests.values()) completeEmbedded(item, { ok: false, code });
  }

  function releasePending(item) {
    if (item.embedded) {
      completeEmbedded(item, { ok: false, code: usageLimited ? "limited" : "stale" });
      return;
    }
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

  function isPublicUiBlock(block) {
    return Boolean(adapter?.publicUiBlocks?.some((selector) => block.matches(selector)));
  }

  function allowedPublicForm(element) {
    const form = element.closest("form");
    return !form || Boolean(adapter?.publicForms?.some((selector) => form.matches(selector)));
  }

  function excludedBlock(block) {
    if (!block || !excludedSelector || block.closest(protectedSelector)) return true;
    if (isPublicUiBlock(block)) return !allowedPublicForm(block);
    return !isExplicitExclusionBypassBlock(block, adapter) && Boolean(block.closest(excludedSelector));
  }

  function textIsVisible(element, cache) {
    if (!element) return true;
    if (cache.has(element)) return cache.get(element);
    const style = getComputedStyle(element);
    const visible = style.display !== "none" && style.visibility !== "hidden"
      && style.visibility !== "collapse" && style.contentVisibility !== "hidden"
      && style.opacity !== "0" && textIsVisible(element.parentElement, cache);
    cache.set(element, visible);
    return visible;
  }

  function translationBlockFor(node) {
    if (!adapter) return null;
    const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    const semantic = closestTranslationBlock(node, blockSelector);
    if (semantic) return semantic;
    if (!adapter.collectLayoutText || !element || element.closest(excludedSelector)) return null;
    const block = element.closest(LAYOUT_OWNER);
    if (block) layoutBlocks.add(block);
    return block;
  }

  function textEligibility(block, visibility = new WeakMap()) {
    if (excludedBlock(block)) return () => false;
    const publicUi = isPublicUiBlock(block);
    const bypassExclusion = publicUi || isExplicitExclusionBypassBlock(block, adapter);
    return (node) => {
      const parent = node.parentElement;
      if (!parent || !block.contains(node) || parent.closest(protectedSelector)
        || !textIsVisible(parent, visibility)) return false;
      if (layoutBlocks.has(block) && parent.closest(LAYOUT_OWNER) !== block) return false;
      const nearestExcluded = parent.closest(excludedSelector);
      const excludedInsideBypass = bypassExclusion
        && nearestExcluded !== block && block.contains(nearestExcluded);
      if ((!bypassExclusion && nearestExcluded) || (!publicUi && excludedInsideBypass)
        || (publicUi && !allowedPublicForm(parent))) return false;
      const anchor = parent.closest("a[href]");
      return !anchor || !isUrlLikeLinkText(anchor.textContent, anchor.href);
    };
  }

  function eligibleTextNodes(block) {
    const isEligible = textEligibility(block);
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const text = node.nodeValue ?? "";
        if (text.trim().length < 2 || text.length > MAX_ITEM_CHARS) {
          return NodeFilter.FILTER_REJECT;
        }
        if (!isEligible(node)) return NodeFilter.FILTER_REJECT;
        const state = nodeStates.get(node);
        if (
          state?.pending
          || (state?.translated != null && (text === state.original || text === state.translated))
        ) {
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

  function enqueueBlock(block, { priority = false } = {}) {
    if (disposed || !enabled || !adapter || usageLimited || !block
      || !isElementNearViewport(block, innerHeight, scheduling.viewportMargin)) {
      return;
    }
    const id = blockId(block);
    const items = [];
    for (const node of eligibleTextNodes(block)) {
      const original = node.nodeValue;
      const itemId = `${id}-${++sequence}`;
      nodeStates.set(node, { original, translated: null, pending: true, itemId, epoch: pageEpoch });
      trackedNodes.add(node);
      items.push({ id: itemId, blockId: id, text: original, node, block, epoch: pageEpoch, priority });
    }
    addTranslationItems(queue, items, priority);
    if (items.length > 0) scheduleFlush(priority ? 0 : scheduling.collectDelayMs);
  }

  function scheduleFlush(delay = scheduling.collectDelayMs) {
    const normalizedDelay = Math.max(0, delay);
    const dueAt = performance.now() + normalizedDelay;
    if (flushTimer && flushDueAt <= dueAt) return;
    clearTimeout(flushTimer);
    flushDueAt = dueAt;
    flushTimer = setTimeout(() => {
      flushTimer = undefined;
      flushDueAt = 0;
      void flushQueue();
    }, normalizedDelay);
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
    let appliedBlocks = 0;
    let appliedNodes = 0;
    for (let count = 0; count < APPLY_BLOCKS_PER_FRAME && pendingApplications.length > 0; count += 1) {
      const block = pendingApplications.shift();
      const writes = [];
      for (const { item, translated } of block.applications) {
        if (item.embedded) {
          if (typeof translated === "string" && translated.trim() && isCurrentEmbedded(item)) {
            completeEmbedded(item, { ...embeddedContext(), translation: translated });
          } else releasePending(item);
          continue;
        }
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
          if (enabled) writes.push({ node: item.node, translated });
        } else if (state?.itemId === item.id) {
          state.pending = false;
        }
      }
      for (const write of writes) {
        write.node.nodeValue = write.translated;
      }
      if (writes.length > 0) {
        appliedBlocks += 1;
        appliedNodes += writes.length;
      }
    }
    if (appliedBlocks > 0) {
      logDiagnostic("dom-blocks-applied", {
        appliedBlocks,
        appliedNodes,
        remainingBlocks: pendingApplications.length,
      });
    }
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
    if (!disposed) handleNavigation();
    if (disposed || translating || !enabled || usageLimited || queue.length === 0) {
      return;
    }
    translating = true;
    const batchLimits = translationBatchLimits(scheduling, externalProvider, longDocument);
    const remainingBudget = externalProvider && webSettings.externalPageCharLimit > 0
      ? Math.max(0, webSettings.externalPageCharLimit - sentChars)
      : batchLimits.maxChars;
    if (remainingBudget === 0) {
      translating = false;
      stopForUsageLimit();
      return;
    }
    const eligibilityByBlock = new WeakMap();
    const visibility = new WeakMap();
    const batch = takeTranslationBatch(queue, {
      maxItems: batchLimits.maxItems,
      maxChars: Math.min(batchLimits.maxChars, remainingBudget),
      discardOversize: externalProvider && webSettings.externalPageCharLimit > 0,
      isCurrent(item) {
        if (item.embedded) return isCurrentEmbedded(item);
        if (!eligibilityByBlock.has(item.block)) {
          eligibilityByBlock.set(item.block, textEligibility(item.block, visibility));
        }
        const state = nodeStates.get(item.node);
        return item.epoch === pageEpoch
          && state?.itemId === item.id
          && state.epoch === pageEpoch
          && item.node.isConnected
          && item.node.nodeValue === state.original
          && eligibilityByBlock.get(item.block)(item.node);
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
    const requestEpoch = pageEpoch;
    const requestKey = translationKey();
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
    if (!disposed) handleNavigation();
    if (disposed || requestEpoch !== pageEpoch || requestKey !== translationKey()) {
      for (const item of batch) releasePending(item);
      translating = false;
      if (!disposed && enabled && queue.length > 0) scheduleFlush(0);
      return;
    }
    if (response?.type === "translationResult") {
      const oldKey = translationKey();
      const oldSettings = JSON.stringify(webSettings);
      if (response.translator) {
        translator = response.translator;
        externalProvider = EXTERNAL_TRANSLATORS.has(response.translator);
      }
      if (response.webSettings) applyWebSettings(response.webSettings);
      if (oldKey !== translationKey() || oldSettings !== JSON.stringify(webSettings)) {
        refreshPageSettings(oldKey);
        if (requestEpoch !== pageEpoch || requestKey !== translationKey()) {
          for (const item of batch) releasePending(item);
          translating = false;
          if (enabled && queue.length > 0) scheduleFlush(0);
          return;
        }
      }
      const results = new Map(response.items.map((item) => [item.id, item.text]));
      const applications = groupTranslationApplications(batch, results);
      for (const item of applications.missing) releasePending(item);
      pendingApplications.push(...applications.blocks);
      scheduleApplications();
      logDiagnostic("batch-applied", {
        requested: batch.length,
        returned: response.items.length,
        queuedForApply: batch.length - applications.missing.length,
        queuedBlocks: applications.blocks.length,
        requestCount,
        sentChars,
        epoch: pageEpoch,
        rejected: { missingResult: applications.missing.length },
      });
      lastError = "";
    } else {
      for (const item of batch) {
        if (item.embedded) {
          completeEmbedded(item, { ok: false, code: "unavailable", retryable: Boolean(response?.retryable) });
          continue;
        }
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
            if (!disposed && !item.embedded && item.epoch === pageEpoch && item.node.isConnected) {
              enqueueBlock(translationBlockFor(item.node));
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
      scheduleFlush(queue.some((item) => item.priority) ? 0 : scheduling.collectDelayMs);
    }
  }

  function settlePendingApplications() {
    for (const block of pendingApplications) {
      for (const { item, translated } of block.applications) {
        if (item.embedded) { releasePending(item); continue; }
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
        } else if (state?.itemId === item.id) {
          state.pending = false;
        }
      }
    }
    pendingApplications.length = 0;
  }

  function restoreOriginals({ discard = false } = {}) {
    cancelEmbeddedRequests(enabled ? "stale" : "disabled");
    while (queue.length > 0) releasePending(queue.shift());
    settlePendingApplications();
    clearTimeout(flushTimer);
    clearTimeout(applyTimer);
    if (applyingFrame) cancelAnimationFrame(applyingFrame);
    flushTimer = undefined;
    flushDueAt = 0;
    applyTimer = undefined;
    applyingFrame = undefined;
    const result = syncTrackedTranslationDisplay(trackedNodes, nodeStates, false);
    if (discard) {
      for (const node of trackedNodes) nodeStates.delete(node);
      trackedNodes.clear();
    }
    return result;
  }

  function replayTranslations() {
    const result = syncTrackedTranslationDisplay(trackedNodes, nodeStates, true);
    if (result.changed > 0 || result.removed > 0) {
      logDiagnostic("cached-translations-replayed", result);
    }
    return result;
  }

  function shutdownInvalidatedContext() {
    if (disposed) return;
    disposed = true;
    enabled = false;
    translating = false;
    observer?.disconnect();
    visibilityObserver?.disconnect();
    intersectionObserver?.disconnect();
    pendingScanBatch.clear();
    clearTimeout(rescanTimer);
    clearTimeout(flushTimer);
    clearTimeout(applyTimer);
    if (applyingFrame) cancelAnimationFrame(applyingFrame);
    clearInterval(navigationTimer);
    document.removeEventListener("scroll", noteViewportActivity, true);
    window.removeEventListener("keydown", handleQuickToggle, true);
    window.removeEventListener("focus", refreshAppStatus, true);
    document.removeEventListener("pointerover", handleMenuInteraction, true);
    document.removeEventListener("focusin", handleMenuInteraction, true);
    document.removeEventListener("toggle", handleMenuInteraction, true);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    try { api.runtime.onMessage.removeListener(handleMessage); } catch { /* Reloaded extension. */ }
    rescanTimer = undefined;
    navigationTimer = undefined;
    restoreOriginals({ discard: true });
    if (globalThis[INSTANCE_KEY]?.dispose === shutdownInvalidatedContext) delete globalThis[INSTANCE_KEY];
  }

  function observeBlock(block) {
    if (intersectionObserver) registerTranslationBlock(block, observedBlocks, intersectionObserver);
  }

  function collectLayoutBlocks(root, visit) {
    if (!adapter.collectLayoutText) return;
    const element = root.nodeType === Node.DOCUMENT_NODE ? document.body : root;
    if (!element || element.closest(excludedSelector) || element.closest(blockSelector)) return;
    const blocks = new Set();
    // Prune semantic blocks and protected subtrees. Only initial/dirty subtrees are walked;
    // scroll events never cause a full-page traversal.
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          return node.matches(excludedSelector) || node.matches(blockSelector)
            ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
        }
        const text = node.nodeValue ?? "";
        return text.trim().length >= 2 && text.length <= MAX_ITEM_CHARS
          ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    while (walker.nextNode()) {
      const block = walker.currentNode.parentElement?.closest(LAYOUT_OWNER);
      if (block && !blocks.has(block)) {
        blocks.add(block);
        layoutBlocks.add(block);
        visit(block);
      }
    }
  }

  function observeVisibilityRoots(root) {
    const selector = adapter?.visibilityRoots?.join(",");
    if (!selector || !visibilityObserver) return;
    const roots = [...root.querySelectorAll(selector)];
    if (root.nodeType === Node.ELEMENT_NODE && root.matches(selector)) roots.push(root);
    for (const element of roots) {
      if (visibilityRoots.has(element)) continue;
      visibilityRoots.add(element);
      visibilityObserver.observe(element, { attributes: true, subtree: true, attributeFilter: ["class", "style"] });
    }
  }

  function handleMenuInteraction(event) {
    if (!enabled || disposed) return;
    const selector = adapter?.visibilityRoots?.join(",");
    const root = event.target?.closest?.(selector ? `${selector},details` : "details");
    if (root && !root.contains(event.relatedTarget)) scheduleScan(root);
  }

  function scan(root = document, { enqueueVisible = false } = {}) {
    if (disposed || !enabled || !adapter || !root?.querySelectorAll) {
      return;
    }
    observeVisibilityRoots(root);
    const containingBlock = root.nodeType === Node.ELEMENT_NODE ? translationBlockFor(root) : null;
    if (containingBlock) {
      observeBlock(containingBlock);
      if (enqueueVisible) enqueueBlock(containingBlock);
    }
    if (root.nodeType === Node.ELEMENT_NODE && root.matches(blockSelector)) {
      observeBlock(root);
      if (enqueueVisible && root !== containingBlock) enqueueBlock(root);
    }
    const matchedBlocks = root.querySelectorAll(blockSelector);
    if (root === document && matchedBlocks.length >= 200) {
      longDocument = true;
    }
    for (const block of matchedBlocks) {
      observeBlock(block);
      if (enqueueVisible) enqueueBlock(block);
    }
    collectLayoutBlocks(root, (block) => {
      observeBlock(block);
      if (enqueueVisible) enqueueBlock(block);
    });
    pruneDisconnectedNodes();
  }

  function scheduleScan(root) {
    if (disposed) return;
    pendingScanBatch.add(root);
    if (rescanTimer) {
      return;
    }
    rescanTimer = setTimeout(() => {
      rescanTimer = undefined;
      for (const scanRoot of pendingScanBatch.drain(document)) {
        scan(scanRoot, { enqueueVisible: true });
      }
    }, 120);
  }

  function handleNavigation() {
    if (disposed || location.href === currentUrl) {
      return;
    }
    currentUrl = location.href;
    pageEpoch += 1;
    restoreOriginals({ discard: true });
    resetPageUsage();
    pageTargetLanguage = "";
    longDocument = false;
    blockIds = new WeakMap();
    observedBlocks = new WeakSet();
    layoutBlocks = new WeakSet();
    visibilityRoots = new WeakSet();
    visibilityObserver?.disconnect();
    intersectionObserver.disconnect();
    configureIntersectionObserver();
    pendingScanBatch.clear();
    clearTimeout(rescanTimer);
    rescanTimer = undefined;
    const nextAdapter = adapters.adapterForLocation(location);
    assignAdapter(nextAdapter);
    sitePolicy = webSettings.sitePolicies[currentHostname()] ?? "default";
    enabled = initialEnabled();
    lastError = "";
    scheduleScan(document);
    notifyEmbeddedFrames();
  }

  async function setEnabled(value) {
    if (!adapter) {
      return status();
    }
    if (value && !webSettings.enabled) {
      lastError = "Windows 앱에서 웹 번역 사용이 꺼져 있습니다.";
      return status();
    }
    if (value && sitePolicy === "never") {
      lastError = "이 사이트는 번역하지 않도록 설정되어 있습니다.";
      return status();
    }
    tabEnabled = await saveTabEnabled(value);
    if (disposed) return status();
    enabled = tabEnabled;
    usageLimited = false;
    lastError = "";
    if (enabled) {
      replayTranslations();
      scan(document, { enqueueVisible: true });
    } else {
      restoreOriginals();
    }
    notifyEmbeddedFrames();
    return status();
  }

  function toggleEnabled() {
    return changeState(() => setEnabled(!enabled));
  }

  function handleQuickToggle(event) {
    if (!adapter || !isQuickToggleShortcut(event, webSettings.quickToggleShortcut)) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    void toggleEnabled();
  }

  function status() {
    return {
      origin: location.origin,
      enabled,
      supported: Boolean(adapter),
      site: adapter?.id ?? "",
      manualOnly: Boolean(adapter?.manualOnly),
      translatedNodes: [...trackedNodes].filter((node) => {
        const state = nodeStates.get(node);
        return state?.translated != null && node.nodeValue === state.translated;
      }).length,
      requestCount,
      sentChars,
      usageLimit: externalProvider ? webSettings.externalPageCharLimit : 0,
      usageLimited,
      targetLanguage: pageTargetLanguage || webSettings.targetLanguage,
      sitePolicy,
      processingMode: webSettings.processingMode,
      quickToggleShortcut: webSettings.quickToggleShortcut,
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

  function refreshPageSettings(oldKey) {
    if (oldKey !== translationKey()) {
      pageEpoch += 1;
      restoreOriginals({ discard: true });
      resetPageUsage();
    }
    intersectionObserver?.disconnect();
    observedBlocks = new WeakSet();
    configureIntersectionObserver();
    enabled = initialEnabled();
    if (!enabled) restoreOriginals();
    else {
      replayTranslations();
      scan(document, { enqueueVisible: true });
    }
    notifyEmbeddedFrames();
    return status();
  }

  function handleMessage(message, sender, sendResponse) {
    if (disposed) return false;
    if (message?.type === "nudenyang-embed-parent-request") {
      // Native work must not hold the state lock: OFF must cancel an in-flight title immediately.
      embeddedParentRequest(message, sender).then(sendResponse, () => sendResponse({ ok: false, code: "unavailable" }));
      return true;
    }
    if (message?.type === "nudenyang-ready") {
      Promise.resolve(startupPromise).then(() => sendResponse({ ready: true }));
      return true;
    }
    if (message?.type === "nudenyang-status") {
      sendResponse(status());
      return false;
    }
    if (message?.type === "nudenyang-set-enabled") {
      changeState(() => setEnabled(message.enabled)).then(sendResponse);
      return true;
    }
    if (message?.type === "nudenyang-toggle-enabled") {
      toggleEnabled().then(sendResponse);
      return true;
    }
    if (message?.type === "nudenyang-restore") {
      changeState(() => setEnabled(false)).then(sendResponse);
      return true;
    }
    if (message?.type === "nudenyang-set-target-language") {
      changeState(() => {
        const oldKey = translationKey();
        pageTargetLanguage = typeof message.targetLanguage === "string" ? message.targetLanguage : "";
        return refreshPageSettings(oldKey);
      }).then(sendResponse);
      return true;
    }
    if (message?.type === "nudenyang-apply-web-settings") {
      changeState(() => {
        const oldKey = translationKey();
        applyWebSettings(message.webSettings);
        return refreshPageSettings(oldKey);
      }).then(sendResponse);
      return true;
    }
    return false;
  }

  api.runtime.onMessage.addListener(handleMessage);

  window.addEventListener("keydown", handleQuickToggle, true);
  window.addEventListener("focus", refreshAppStatus, true);

  async function start() {
    const [stored, appStatus, restoredTabEnabled] = await Promise.all([
      storageGet({ enabled: true }),
      nativeRequest({ type: "status", requestId: `content-${Date.now()}` }),
      loadTabEnabled(),
    ]);
    if (disposed) return;
    storedEnabled = stored.enabled !== false;
    tabEnabled = restoredTabEnabled;
    applyAppStatus(appStatus);
    enabled = initialEnabled();
    configureIntersectionObserver();
    visibilityObserver = new MutationObserver((mutations) => {
      if (!enabled || disposed) return;
      for (const mutation of mutations) scheduleScan(mutation.target);
    });
    observer = new MutationObserver((mutations) => {
      handleNavigation();
      if (!enabled || disposed) {
        return;
      }
      for (const mutation of mutations) {
        if (mutation.type === "childList") {
          const changedBlock = translationBlockFor(mutation.target);
          if (changedBlock) enqueueBlock(changedBlock, { priority: true });
          for (const node of mutation.addedNodes) {
            const scanRoot = scanRootForAddedNode(node, blockSelector);
            if (scanRoot) {
              const addedBlock = translationBlockFor(scanRoot);
              if (addedBlock && addedBlock !== changedBlock) {
                enqueueBlock(addedBlock, { priority: true });
              }
              scheduleScan(scanRoot);
            }
          }
        } else if (mutation.type === "characterData") {
          const state = nodeStates.get(mutation.target);
          if (!state || mutation.target.nodeValue !== state.translated) {
            const block = translationBlockFor(mutation.target);
            if (block) {
              enqueueBlock(block, { priority: true });
            }
          }
        } else if (mutation.type === "attributes") {
          scheduleScan(mutation.target);
        }
      }
    });
    observer.observe(document.documentElement, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ["hidden", "aria-hidden", "open"],
    });
    document.addEventListener("scroll", noteViewportActivity, { capture: true, passive: true });
    document.addEventListener("pointerover", handleMenuInteraction, true);
    document.addEventListener("focusin", handleMenuInteraction, true);
    document.addEventListener("toggle", handleMenuInteraction, true);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    navigationTimer = setInterval(handleNavigation, 500);
    scan(document);
    notifyEmbeddedFrames();
  }

  startupPromise = start().catch((error) => {
    lastError = error?.message ?? String(error ?? "확장 프로그램을 시작하지 못했습니다.");
    console.warn("[NudeNyang Web Translator] startup-failed", { detail: lastError });
  });
})();
