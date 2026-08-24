(() => {
  const api = globalThis.chrome ?? globalThis.whale;
  const adapters = globalThis.NudeNyangSiteAdapters;
  const {
    createScanBatch,
    isElementNearViewport,
    runtimeMessageFailure,
    scanRootForAddedNode,
    takeTranslationBatch,
  } = globalThis.NudeNyangContentHelpers;
  const MAX_ITEMS = 32;
  const MAX_ITEM_CHARS = 4000;
  const MAX_TOTAL_CHARS = 32000;
  const trackedNodes = new Set();
  const nodeStates = new WeakMap();
  let blockIds = new WeakMap();
  let observedBlocks = new WeakSet();
  const queue = [];
  let enabled = true;
  let translating = false;
  let sequence = 0;
  let pageEpoch = 0;
  let currentUrl = location.href;
  let adapter = adapters.adapterForLocation(location);
  let observer;
  let intersectionObserver;
  let rescanTimer;
  let navigationTimer;
  const pendingScanBatch = createScanBatch();
  let lastError = "";

  function storageGet(defaults) {
    return new Promise((resolve) => api.storage.local.get(defaults, resolve));
  }

  function storageSet(values) {
    return new Promise((resolve) => api.storage.local.set(values, resolve));
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
    if (!enabled || !adapter || !isElementNearViewport(block, innerHeight)) {
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
    void flushQueue();
  }

  async function flushQueue() {
    if (translating || !enabled || queue.length === 0) {
      return;
    }
    translating = true;
    const releasePending = (item) => {
      const state = nodeStates.get(item.node);
      if (state?.itemId === item.id) {
        state.pending = false;
      }
    };
    const batch = takeTranslationBatch(queue, {
      maxItems: MAX_ITEMS,
      maxChars: MAX_TOTAL_CHARS,
      isCurrent(item) {
        const state = nodeStates.get(item.node);
        return item.epoch === pageEpoch
          && state?.itemId === item.id
          && state.epoch === pageEpoch
          && item.node.isConnected
          && item.node.nodeValue === state.original;
      },
      isNearViewport(item) {
        return isElementNearViewport(item.block, innerHeight);
      },
      onDiscard: releasePending,
    });
    if (batch.length === 0) {
      translating = false;
      return;
    }
    const requestId = `web-${Date.now()}-${++sequence}`;
    const response = await nativeRequest({
      type: "translate",
      requestId,
      pageId: `${adapter.id}:${location.origin}${location.pathname}`.slice(0, 240),
      items: batch.map(({ id, blockId: itemBlockId, text }) => ({ id, blockId: itemBlockId, text })),
    });
    if (response?.type === "translationResult") {
      const results = new Map(response.items.map((item) => [item.id, item.text]));
      let applied = 0;
      const rejected = {
        missingResult: 0,
        missingState: 0,
        itemChanged: 0,
        epochChanged: 0,
        disconnected: 0,
        sourceChanged: 0,
      };
      for (const item of batch) {
        const state = nodeStates.get(item.node);
        const translated = results.get(item.id);
        if (translated == null) rejected.missingResult += 1;
        if (!state) rejected.missingState += 1;
        if (state && state.itemId !== item.id) rejected.itemChanged += 1;
        if (state && state.epoch !== pageEpoch) rejected.epochChanged += 1;
        if (!item.node.isConnected) rejected.disconnected += 1;
        if (state && item.node.nodeValue !== state.original) rejected.sourceChanged += 1;
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
      logDiagnostic("batch-applied", {
        requested: batch.length,
        returned: response.items.length,
        applied,
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
    if (queue.length > 0) {
      void flushQueue();
    }
  }

  function restoreOriginals() {
    queue.length = 0;
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
    clearInterval(navigationTimer);
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
    blockIds = new WeakMap();
    observedBlocks = new WeakSet();
    intersectionObserver.disconnect();
    configureIntersectionObserver();
    pendingScanBatch.clear();
    clearTimeout(rescanTimer);
    rescanTimer = undefined;
    adapter = adapters.adapterForLocation(location);
    lastError = "";
    scheduleScan(document);
  }

  async function setEnabled(value) {
    enabled = Boolean(value);
    await storageSet({ enabled });
    if (enabled) {
      scan(document);
    } else {
      restoreOriginals();
    }
    return status();
  }

  function status() {
    return {
      enabled,
      supported: Boolean(adapter),
      site: adapter?.id ?? "",
      translatedNodes: [...trackedNodes].filter((node) => nodeStates.get(node)?.translated != null).length,
      lastError,
    };
  }

  function configureIntersectionObserver() {
    intersectionObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          enqueueBlock(entry.target);
        }
      }
    }, { rootMargin: "500px 0px" });
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
    if (message?.type === "nudenyang-restore") {
      setEnabled(false).then(sendResponse);
      return true;
    }
    return false;
  });

  async function start() {
    ({ enabled } = await storageGet({ enabled: true }));
    configureIntersectionObserver();
    observer = new MutationObserver((mutations) => {
      handleNavigation();
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
    navigationTimer = setInterval(handleNavigation, 500);
    scan(document);
  }

  void start();
})();
