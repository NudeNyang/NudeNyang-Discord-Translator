(() => {
  const api = globalThis.chrome ?? globalThis.browser ?? globalThis.whale;
  const adapters = globalThis.NudeNyangSiteAdapters;
  const messengerAdapters = globalThis.NudeNyangMessengerAdapters;
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
  const LOCAL_TRANSLATORS = new Set(["hymt_1_8b", "hymt_7b", "translategemma_4b"]);
  const DEFAULT_WEB_SETTINGS = Object.freeze({
    enabled: true,
    messengerEnabled: false,
    targetLanguage: "display",
    processingMode: "balanced",
    externalPageCharLimit: 25000,
    quickToggleShortcut: "F4",
    sitePolicies: {},
  });
  const APPLY_BLOCKS_PER_FRAME = 2;
  const LAYOUT_OWNER = "p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,dt,dd,summary,th,td,div,section,article,main,body";
  const EMBED_HOSTS = new Set(["www.youtube.com", "www.youtube-nocookie.com"]);
  const RESTORABLE_HIDDEN_SELECTORS = new Set(["[hidden]", "[inert]", '[aria-hidden="true"]']);
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
  let messengerSite = null;
  let messengerContext = null;
  let messengerConsent = false;
  let messengerPageId = "";
  let messengerStartContextId = "";
  let messengerStartRevision = 0;
  let messengerFailure = "";
  let lastMessengerStatusAt = 0;
  let refreshingStatus = false;
  let appStatusEpoch = 0;
  let adapter = adapters.adapterForLocation(location);
  let blockSelector = adapter?.blocks.join(",") ?? "";
  let excludedSelector = adapter ? adapters.exclusionSelector(adapter) : "";
  let protectedSelector = adapter ? adapters.protectedExclusionSelector(adapter) : "";
  let messengerRestoreSelector = "";
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
    excludedSelector = messengerSite ? (messengerContext?.excludes.join(",") ?? "")
      : adapter ? adapters.exclusionSelector(adapter) : "";
    protectedSelector = messengerSite ? excludedSelector
      : adapter ? adapters.protectedExclusionSelector(adapter) : "";
    messengerRestoreSelector = messengerSite
      ? (messengerContext?.excludes ?? []).filter((selector) => !RESTORABLE_HIDDEN_SELECTORS.has(selector)).join(",")
      : "";
  }

  function pageContext() {
    const context = messengerAdapters?.contextForDocument(location, document) ?? null;
    const site = context ? { id: context.id, label: context.label }
      : messengerAdapters?.privateSiteForLocation(location)
        ?? messengerAdapters?.siteForLocation(location) ?? null;
    return { context, site };
  }

  function sameConversation(next) {
    return next.site?.id === messengerSite?.id
      && next.context?.root === messengerContext?.root
      && next.context?.routeKey === messengerContext?.routeKey
      && (next.context?.identityNodes ?? []).every((node, index) => node === messengerContext?.identityNodes[index]);
  }

  function assignPageContext(next) {
    messengerStartContextId = "";
    messengerSite = next.site;
    messengerContext = next.context;
    messengerFailure = "";
    // An opaque, per-conversation nonce must never contain a URL, peer ID or name.
    messengerPageId = messengerSite ? `messenger:${messengerSite.id}:${crypto.randomUUID()}` : "";
    assignAdapter(messengerSite
      ? messengerContext ?? { id: messengerSite.id, blocks: [] }
      : adapters.adapterForLocation(location));
  }

  function messengerGate() {
    if (!messengerSite) return "";
    if (!webSettings.enabled) return "web_translation_disabled";
    if (!webSettings.messengerEnabled) return "messenger_disabled";
    if (!messengerConsent) return "messenger_consent_required";
    if (!LOCAL_TRANSLATORS.has(translator)) return "messenger_local_only";
    if (!messengerContext?.root.isConnected) return "messenger_no_conversation";
    return messengerFailure;
  }

  function canReadConversation() {
    return !messengerSite || (!messengerGate() && !document.hidden);
  }

  function nearViewport(block) {
    if (!messengerSite) return isElementNearViewport(block, innerHeight, scheduling.viewportMargin);
    if (!canReadConversation() || !messengerContext.root.contains(block)
      || !messengerAdapters.isVisibleElement(block)) return false;
    const rect = block.getBoundingClientRect();
    let top = Math.max(0, rect.top);
    let bottom = Math.min(innerHeight, rect.bottom);
    let left = Math.max(0, rect.left);
    let right = Math.min(innerWidth, rect.right);
    if (rect.width <= 0 || rect.height <= 0) return false;
    // Message lists scroll inside panels; window coordinates alone can expose
    // historical messages clipped outside the currently visible conversation.
    for (let parent = block.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (/(auto|scroll|hidden|clip)/u.test(`${style.overflow} ${style.overflowY}`)) {
        const bounds = parent.getBoundingClientRect();
        top = Math.max(top, bounds.top);
        bottom = Math.min(bottom, bounds.bottom);
      }
      if (/(auto|scroll|hidden|clip)/u.test(`${style.overflow} ${style.overflowX}`)) {
        const bounds = parent.getBoundingClientRect();
        left = Math.max(left, bounds.left);
        right = Math.min(right, bounds.right);
      }
    }
    return bottom > top && right > left;
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
    if (messengerSite) return;
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
      messengerEnabled: source.messengerEnabled === true,
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
    if (refreshingStatus || disposed) return;
    refreshingStatus = true;
    const refreshEpoch = ++appStatusEpoch;
    try {
      const [response, consent] = await Promise.all([
        nativeRequest({ type: "status", requestId: `content-focus-${Date.now()}` }),
        extensionRequest({ type: "nudenyang-messenger-consent-get" }),
      ]);
      if (disposed || refreshEpoch !== appStatusEpoch) return;
      await changeState(() => {
        // A queued refresh must not undo a newer permission/settings notification.
        if (refreshEpoch !== appStatusEpoch) return status();
        const oldKey = translationKey();
        const oldSettings = JSON.stringify(webSettings);
        const oldFailure = messengerFailure;
        messengerConsent = consent?.granted === true && consent.consentVersion === 1;
        if (response?.type === "status") {
          applyAppStatus(response);
          messengerFailure = "";
        } else if (messengerSite) messengerFailure = "messenger_request_cancelled";
        handleNavigation();
        if (oldKey !== translationKey() || oldSettings !== JSON.stringify(webSettings)
          || oldFailure !== messengerFailure) refreshPageSettings(oldKey);
        else if (messengerSite && enabled && canReadConversation()) {
          replayTranslations();
          scan(document, { enqueueVisible: true });
        }
      });
    } finally {
      lastMessengerStatusAt = refreshEpoch === appStatusEpoch ? Date.now() : 0;
      refreshingStatus = false;
    }
  }

  function applyWebSettings(value) {
    webSettings = normalizeWebSettings(value);
    sitePolicy = webSettings.sitePolicies[currentHostname()] ?? "default";
    refreshSchedulingProfile();
  }

  function initialEnabled() {
    if (messengerStartContextId && messengerStartContextId === messengerPageId) {
      return !messengerGate() && webSettings.enabled && sitePolicy !== "never";
    }
    return !messengerGate() && pageTranslationEnabled({
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
    return JSON.stringify([translator, effectiveTargetLanguage() ?? appTargetLanguage,
      messengerSite ? [messengerSite.id, webSettings.messengerEnabled, messengerConsent] : null]);
  }

  function visibleEmbed(frameUrl) {
    if (!adapter || messengerSite || document.hidden) return null;
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
      ok: true, enabled: enabled && Boolean(adapter) && !messengerSite && !disposed,
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
    if (messengerSite) {
      if (document.hidden) restoreOriginals();
      else {
        handleNavigation();
        void refreshAppStatus();
      }
    }
    notifyEmbeddedFrames();
  }

  function handlePageHide() {
    if (!messengerSite || disposed) return;
    pageEpoch += 1;
    enabled = false;
    restoreOriginals({ discard: true });
    pendingScanBatch.clear();
    messengerContext = null;
    messengerPageId = "";
  }

  function handlePageShow() {
    if (disposed) return;
    handleNavigation();
    if (messengerSite) void refreshAppStatus();
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
    if (state?.itemId === item.id) {
      if (messengerSite && !isCurrentMessengerText(item.node)) forgetMessengerText(item.node);
      else state.pending = false;
    }
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
    if (messengerSite) return !canReadConversation()
      || !messengerAdapters.isEligibleMessageBlock(block, messengerContext);
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
    if (messengerSite && (!messengerContext || !element || !messengerContext.root.contains(element))) return null;
    const semantic = closestTranslationBlock(node, blockSelector);
    if (semantic) return semantic;
    if (messengerSite) return null;
    if (!adapter.collectLayoutText || !element || element.closest(excludedSelector)) return null;
    const block = element.closest(LAYOUT_OWNER);
    if (block) layoutBlocks.add(block);
    return block;
  }

  function textEligibility(block, visibility = new WeakMap()) {
    if (excludedBlock(block)) return () => false;
    if (messengerSite) return (node) => {
      const parent = node.parentElement;
      if (!canReadConversation() || !parent || !block.contains(node)
        || !messengerContext.root.contains(node) || !textIsVisible(parent, visibility)) return false;
      // Protect author names, mentions, timestamps, editors and attachments even
      // when a service places them inside its message-body element.
      for (let current = parent; current; current = current.parentElement) {
        if (current.matches(excludedSelector)) return false;
        if (current === messengerContext.root) break;
      }
      const anchor = parent.closest("a[href]");
      if (!anchor) return true;
      // textContent also reads hidden/editor/author descendants. A mixed or
      // enclosing link is not a safe message label, even if this node is safe.
      if (!block.contains(anchor)) return false;
      for (const child of anchor.querySelectorAll("*")) {
        if (child.matches(excludedSelector) || !textIsVisible(child, visibility)) return false;
      }
      return !isUrlLikeLinkText(anchor.textContent, anchor.href);
    };
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

  function isCurrentMessengerText(node) {
    // A retained node can be repurposed without changing the conversation root
    // or first message. Recheck its current role and visibility before reading
    // its value, retaining a result, or replaying a cached translation.
    const block = translationBlockFor(node);
    return Boolean(block && canReadConversation() && nearViewport(block) && textEligibility(block)(node));
  }

  function isRestorableMessengerText(node) {
    const block = translationBlockFor(node);
    if (!node?.isConnected || !block || block === messengerContext?.root
      || !messengerContext?.root.contains(block) || !block.matches(blockSelector)) return false;
    // Cleanup may restore an already translated, now-hidden message. It must
    // never overwrite an editor, sender name, contact, or other repurposed UI,
    // even if the retained text still equals our earlier translated value.
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      if (messengerRestoreSelector && parent.matches(messengerRestoreSelector)) return false;
    }
    return true;
  }

  function forgetMessengerText(node, { restore = false } = {}) {
    const state = nodeStates.get(node);
    if (restore && isRestorableMessengerText(node)
      && state?.translated != null && node.nodeValue === state.translated) node.nodeValue = state.original;
    nodeStates.delete(node);
    trackedNodes.delete(node);
  }

  function pruneMessengerTranslations({ restoring = false } = {}) {
    if (!messengerSite) return 0;
    let removed = 0;
    for (const node of trackedNodes) {
      if (restoring ? isRestorableMessengerText(node) : isCurrentMessengerText(node)) continue;
      forgetMessengerText(node, { restore: !restoring });
      removed += 1;
    }
    return removed;
  }

  function eligibleTextNodes(block) {
    const isEligible = textEligibility(block);
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!isEligible(node)) return NodeFilter.FILTER_REJECT;
        const text = node.nodeValue ?? "";
        if (text.trim().length < 2 || text.length > MAX_ITEM_CHARS) {
          return NodeFilter.FILTER_REJECT;
        }
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
      || !canReadConversation() || !nearViewport(block)) {
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
    if (!disposed && messengerSite) handleNavigation();
    if (disposed) return;
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
        if (messengerSite && state?.itemId === item.id && !isCurrentMessengerText(item.node)) {
          forgetMessengerText(item.node);
          continue;
        }
        if (
          translated != null
          && state?.itemId === item.id
          && state.epoch === pageEpoch
          && item.node.isConnected
          && item.node.nodeValue === state.original
        ) {
          state.pending = false;
          state.translated = translated;
          if (enabled && canReadConversation()) writes.push({ node: item.node, translated });
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
    if (disposed || translating || !enabled || !canReadConversation() || usageLimited || queue.length === 0) {
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
          // A queued private message can become an editor, author label or
          // hidden node before dispatch. Do not read its newly protected value.
          && (!messengerSite || (nearViewport(item.block) && eligibilityByBlock.get(item.block)(item.node)))
          && item.node.nodeValue === state.original
          && (messengerSite || eligibilityByBlock.get(item.block)(item.node));
      },
      isNearViewport(item) {
        return nearViewport(item.block);
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
      pageId: messengerSite ? messengerPageId
        : `${adapter.id}:${location.origin}${location.pathname}`.slice(0, 240),
      ...(messengerSite ? { privateContext: { service: messengerSite.id, consentVersion: 1 } } : {}),
      targetLanguage: effectiveTargetLanguage(),
      items: batch.map(({ id, blockId: itemBlockId, text }) => ({ id, blockId: itemBlockId, text })),
    });
    if (!disposed) handleNavigation();
    if (disposed || requestEpoch !== pageEpoch || requestKey !== translationKey() || messengerGate()) {
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
      if (messengerSite) {
        // Do not expose native/provider errors that could contain private text.
        messengerFailure = ["messenger_disabled", "messenger_local_only", "messenger_consent_required",
          "web_translation_disabled"].includes(response?.code) ? response.code : "messenger_request_cancelled";
        lastError = "";
        translating = false;
        refreshPageSettings(translationKey());
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
        if (messengerSite && state?.itemId === item.id && !isCurrentMessengerText(item.node)) {
          forgetMessengerText(item.node);
          continue;
        }
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
    const removed = pruneMessengerTranslations({ restoring: true });
    const result = syncTrackedTranslationDisplay(trackedNodes, nodeStates, false);
    result.removed += removed;
    if (discard) {
      for (const node of trackedNodes) nodeStates.delete(node);
      trackedNodes.clear();
    }
    return result;
  }

  function replayTranslations() {
    if (!canReadConversation()) return { changed: 0, removed: 0 };
    const removed = pruneMessengerTranslations();
    const result = syncTrackedTranslationDisplay(trackedNodes, nodeStates, true);
    result.removed += removed;
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
    window.removeEventListener("pagehide", handlePageHide);
    window.removeEventListener("pageshow", handlePageShow);
    try { api.runtime.onMessage.removeListener(handleMessage); } catch { /* Reloaded extension. */ }
    rescanTimer = undefined;
    navigationTimer = undefined;
    restoreOriginals({ discard: true });
    if (globalThis[INSTANCE_KEY]?.dispose === shutdownInvalidatedContext) delete globalThis[INSTANCE_KEY];
  }

  function observeBlock(block) {
    if (messengerSite && excludedBlock(block)) return;
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
    if (disposed || !enabled || !adapter || !blockSelector || !canReadConversation() || !root?.querySelectorAll) {
      return;
    }
    if (messengerSite) {
      if (root === document || root.contains(messengerContext.root)) root = messengerContext.root;
      else if (!messengerContext.root.contains(root)) return;
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
    if (disposed) return;
    const next = pageContext();
    if (location.href === currentUrl && sameConversation(next)) return;
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
    intersectionObserver?.disconnect();
    assignPageContext(next);
    configureIntersectionObserver();
    pendingScanBatch.clear();
    clearTimeout(rescanTimer);
    rescanTimer = undefined;
    sitePolicy = webSettings.sitePolicies[currentHostname()] ?? "default";
    enabled = initialEnabled();
    lastError = "";
    scheduleScan(document);
    notifyEmbeddedFrames();
  }

  async function setEnabled(value) {
    handleNavigation();
    if (!adapter) {
      return status();
    }
    messengerStartContextId = "";
    if (value && !webSettings.enabled) {
      lastError = "Windows 앱에서 웹 번역 사용이 꺼져 있습니다.";
      return status();
    }
    if (value && sitePolicy === "never") {
      lastError = "이 사이트는 번역하지 않도록 설정되어 있습니다.";
      return status();
    }
    if (value && messengerGate()) return status();
    tabEnabled = await saveTabEnabled(value);
    if (disposed) return status();
    handleNavigation();
    enabled = tabEnabled && !messengerGate();
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
    messengerStartRevision += 1;
    return changeState(() => setEnabled(!enabled));
  }

  async function startConsentedConversation(contextId) {
    const revision = ++messengerStartRevision;
    await startupPromise;
    // Native/permission lookup stays outside the state lock so OFF/revocation
    // can cancel this request while the companion app is waking up.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      handleNavigation();
      if (disposed || !contextId || contextId !== messengerPageId
        || revision !== messengerStartRevision) return status();
      const epoch = appStatusEpoch;
      const [app, consent] = await Promise.all([
        nativeRequest({ type: "status", requestId: `messenger-start-${Date.now()}` }),
        extensionRequest({ type: "nudenyang-messenger-consent-get" }),
      ]);
      const result = await changeState(() => {
        handleNavigation();
        if (disposed || contextId !== messengerPageId || revision !== messengerStartRevision) return status();
        // A consent-saved broadcast may race this lookup; read a fresh snapshot.
        if (epoch !== appStatusEpoch) return null;
        const oldKey = translationKey();
        messengerConsent = consent?.ok === true && consent.granted === true && consent.consentVersion === 1;
        if (app?.type === "status") {
          applyAppStatus(app);
          messengerFailure = "";
        } else messengerFailure = "messenger_request_cancelled";
        // Resume only this conversation. Do not change site policy or persist
        // a tab-wide ON override which could start a different conversation.
        if (!messengerGate() && sitePolicy !== "never") messengerStartContextId = contextId;
        return refreshPageSettings(oldKey);
      });
      if (result !== null) return result;
    }
    return status();
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
      messengerService: messengerSite?.id ?? "",
      messengerContextId: messengerPageId,
      messengerGate: messengerGate(),
      translatedNodes: [...trackedNodes].filter((node) => {
        const state = nodeStates.get(node);
        return state?.translated != null && (!messengerSite || isCurrentMessengerText(node))
          && node.nodeValue === state.translated;
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
    }, { rootMargin: `${messengerSite ? 0 : scheduling.viewportMargin}px 0px` });
  }

  function refreshPageSettings(oldKey) {
    if (oldKey !== translationKey() || (messengerSite && messengerGate())) {
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
      handleNavigation();
      sendResponse(status());
      return false;
    }
    if (message?.type === "nudenyang-messenger-refresh" && sender?.id === api.runtime.id) {
      appStatusEpoch += 1;
      if (message.consent?.granted !== true) messengerStartRevision += 1;
      changeState(() => {
        const oldKey = translationKey();
        messengerConsent = message.consent?.granted === true && message.consent.consentVersion === 1;
        messengerFailure = "";
        handleNavigation();
        return refreshPageSettings(oldKey);
      }).then(sendResponse);
      return true;
    }
    if (message?.type === "nudenyang-messenger-start" && sender?.id === api.runtime.id) {
      startConsentedConversation(message.contextId).then(sendResponse, () => sendResponse(status()));
      return true;
    }
    if (message?.type === "nudenyang-set-enabled") {
      messengerStartRevision += 1;
      changeState(() => setEnabled(message.enabled)).then(sendResponse);
      return true;
    }
    if (message?.type === "nudenyang-toggle-enabled") {
      toggleEnabled().then(sendResponse);
      return true;
    }
    if (message?.type === "nudenyang-restore") {
      messengerStartRevision += 1;
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
      appStatusEpoch += 1;
      changeState(() => {
        const oldKey = translationKey();
        applyWebSettings(message.webSettings);
        messengerFailure = "";
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
    const startupEpoch = appStatusEpoch;
    const [stored, appStatus, restoredTabEnabled, consent] = await Promise.all([
      storageGet({ enabled: true }),
      nativeRequest({ type: "status", requestId: `content-${Date.now()}` }),
      loadTabEnabled(),
      extensionRequest({ type: "nudenyang-messenger-consent-get" }),
    ]);
    if (disposed) return;
    storedEnabled = stored.enabled !== false;
    tabEnabled = restoredTabEnabled;
    // Notifications received during startup are queued behind this promise.
    // Keep the private gate closed until they apply instead of scanning with
    // a now-obsolete consent snapshot even for a single microtask.
    if (startupEpoch === appStatusEpoch) {
      messengerConsent = consent?.granted === true && consent.consentVersion === 1;
      applyAppStatus(appStatus);
    }
    assignPageContext(pageContext());
    lastMessengerStatusAt = startupEpoch === appStatusEpoch ? Date.now() : 0;
    enabled = initialEnabled();
    configureIntersectionObserver();
    visibilityObserver = new MutationObserver((mutations) => {
      if (!enabled || disposed) return;
      for (const mutation of mutations) scheduleScan(mutation.target);
    });
    observer = new MutationObserver((mutations) => {
      handleNavigation();
      if (!enabled || disposed || !canReadConversation()) {
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
          if (messengerSite && !isCurrentMessengerText(mutation.target)) {
            forgetMessengerText(mutation.target);
            continue;
          }
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
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("pageshow", handlePageShow);
    navigationTimer = setInterval(() => {
      handleNavigation();
      // The desktop app may change while the browser stays focused. Only active
      // messenger tabs poll permission/model state; public pages do not poll.
      if (messengerSite && !document.hidden && Date.now() - lastMessengerStatusAt >= 5000) void refreshAppStatus();
    }, 500);
    scan(document);
    notifyEmbeddedFrames();
  }

  startupPromise = start().catch((error) => {
    lastError = error?.message ?? String(error ?? "확장 프로그램을 시작하지 못했습니다.");
    console.warn("[NudeNyang Web Translator] startup-failed", { detail: lastError });
  });
})();
