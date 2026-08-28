(function exposeContentHelpers(root) {
  // Bounded, page-lifetime replay only. Keys are complete source-block snapshots;
  // callers clear the cache on policy, provider, language and conversation changes.
  function createTranslationReplayCache({ maxEntries = 512, maxChars = 2_000_000 } = {}) {
    const entries = new Map();
    let chars = 0;
    function remove(key) {
      const entry = entries.get(key);
      if (!entry) return;
      chars -= entry.chars;
      entries.delete(key);
    }
    return Object.freeze({
      get(key) {
        const entry = entries.get(key);
        if (!entry) return null;
        entries.delete(key);
        entries.set(key, entry);
        return entry.values;
      },
      set(key, values) {
        remove(key);
        if (typeof key !== "string" || !Array.isArray(values) || !values.length
          || values.some(value => typeof value !== "string" || !value.trim())) return;
        const size = key.length + values.reduce((sum, value) => sum + value.length, 0);
        if (size > maxChars || maxEntries < 1) return;
        entries.set(key, { values: Object.freeze([...values]), chars: size });
        chars += size;
        while (entries.size > maxEntries || chars > maxChars) remove(entries.keys().next().value);
      },
      delete: remove,
      clear() { entries.clear(); chars = 0; },
      get size() { return entries.size; },
      get chars() { return chars; },
    });
  }

  function sameMessageContext(current, next, witnesses, accepts = () => true) {
    if (current?.id !== next?.id || current?.root !== next?.root || current?.routeKey !== next?.routeKey) return false;
    const previousIdentity = current?.identityNodes ?? [];
    const nextIdentity = next?.identityNodes ?? [];
    if (previousIdentity.length === nextIdentity.length
      && nextIdentity.every((node, index) => node === previousIdentity[index])) return true;
    // A changed first row is not a conversation switch while previously observed
    // message blocks still belong to this same root and route. No text is read.
    for (const block of witnesses) {
      if (!block.isConnected) { witnesses.delete(block); continue; }
      if (next?.root?.contains(block) && accepts(block)) return true;
    }
    return false;
  }

  function createScanBatch() {
    const roots = new Set();
    return Object.freeze({
      add(scanRoot) {
        if (!scanRoot) return;
        for (const root of roots) {
          if (root === scanRoot || root?.contains?.(scanRoot)) {
            return;
          }
        }
        for (const root of roots) {
          if (scanRoot?.contains?.(root)) {
            roots.delete(root);
          }
        }
        roots.add(scanRoot);
      },
      clear() {
        roots.clear();
      },
      drain(documentRoot) {
        if (roots.size === 0) return [];
        const pending = [...roots].filter((scanRoot) => scanRoot === documentRoot || scanRoot?.isConnected);
        roots.clear();
        return pending;
      },
    });
  }

  function scanRootForAddedNode(node, blockSelector) {
    if (node?.nodeType === 1) {
      return node;
    }
    if (node?.nodeType === 3) {
      return node.parentElement?.closest(blockSelector) ?? node.parentElement ?? null;
    }
    return null;
  }

  function closestTranslationBlock(node, blockSelector) {
    const element = node?.nodeType === 3 ? node.parentElement : node?.nodeType === 1 ? node : null;
    if (!element) return null;
    try {
      if (element.matches?.(blockSelector)) return element;
      return element.closest?.(blockSelector) ?? null;
    } catch {
      return null;
    }
  }

  function isElementNearViewport(element, viewportHeight, margin = 500) {
    if (!element?.isConnected) return false;
    const rect = element.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) return false;
    return rect.bottom >= -margin && rect.top <= viewportHeight + margin;
  }

  function registerTranslationBlock(block, observedBlocks, observer) {
    if (!block || observedBlocks.has(block)) return false;
    observedBlocks.add(block);
    observer.observe(block);
    return true;
  }

  function syncTrackedTranslationDisplay(trackedNodes, nodeStates, showTranslations) {
    let changed = 0;
    let retained = 0;
    let removed = 0;
    for (const node of trackedNodes) {
      const state = nodeStates.get(node);
      const current = node?.nodeValue;
      const isKnownValue = state
        && (current === state.original || (state.translated != null && current === state.translated));
      if (!node?.isConnected || !isKnownValue) {
        trackedNodes.delete(node);
        nodeStates.delete(node);
        removed += 1;
        continue;
      }
      retained += 1;
      const next = showTranslations && state.translated != null ? state.translated : state.original;
      if (current !== next) {
        node.nodeValue = next;
        changed += 1;
      }
    }
    return { changed, retained, removed };
  }

  function addTranslationItems(queue, items, priority = false) {
    if (priority) {
      queue.unshift(...items);
    } else {
      queue.push(...items);
    }
  }

  function isUrlLikeLinkText(text, href = "") {
    const compact = String(text ?? "").trim().replace(/\s+/gu, "");
    if (!compact || compact.length > 2048) return false;
    if (/^(?:https?:\/\/|www\.|mailto:)/iu.test(compact)) return true;
    if (/^[^\s@]+@[^\s@]+\.[\p{L}]{2,24}$/u.test(compact)) return true;
    if (/^[\p{L}\p{N}](?:[\p{L}\p{N}-]*\.)+[\p{L}]{2,24}(?::\d+)?(?:[/?#][^\s]*)?$/u.test(compact)) {
      return true;
    }
    try {
      const host = new URL(String(href ?? "")).hostname.toLocaleLowerCase().replace(/^www\./u, "");
      const label = compact.toLocaleLowerCase().replace(/^www\./u, "").replace(/\/$/u, "");
      return Boolean(host && (label === host || label.startsWith(`${host}/`)));
    } catch {
      return false;
    }
  }

  function isExplicitExclusionBypassBlock(block, adapter) {
    for (const selector of adapter?.exclusionBypassBlocks ?? []) {
      try {
        if (block?.matches?.(selector)) return true;
      } catch {
        // 잘못된 사이트별 선택자 하나가 전체 페이지 번역을 중단하지 않도록 무시한다.
      }
    }
    return false;
  }

  function takeTranslationBatch(queue, options) {
    const batch = [];
    let chars = 0;
    while (queue.length > 0 && batch.length < options.maxItems) {
      const blockKey = queue[0].blockId ?? queue[0].id;
      const block = [];
      while (queue.length > 0 && (queue[0].blockId ?? queue[0].id) === blockKey) {
        block.push(queue.shift());
      }
      const current = [];
      for (const item of block) {
        if (!options.isCurrent(item) || !options.isNearViewport(item)) {
          options.onDiscard(item);
        } else {
          current.push(item);
        }
      }
      if (current.length === 0) {
        continue;
      }
      const blockChars = current.reduce((total, item) => total + item.text.length, 0);
      const exceedsItemLimit = batch.length > 0 && batch.length + current.length > options.maxItems;
      const exceedsCharLimit = batch.length > 0 && chars + blockChars > options.maxChars;
      if (exceedsItemLimit || exceedsCharLimit) {
        queue.unshift(...current);
        break;
      }
      if (current.length > options.maxItems || blockChars > options.maxChars) {
        // Only an intrinsically oversized block may span requests. Keep each
        // existing node and blockId intact, and never exceed the remaining budget.
        for (let index = 0; index < current.length; index += 1) {
          const item = current[index];
          if (item.text.length > options.maxChars) {
            options.onDiscard(item);
            continue;
          }
          if (batch.length >= options.maxItems || chars + item.text.length > options.maxChars) {
            queue.unshift(...current.slice(index));
            return batch;
          }
          batch.push(item);
          chars += item.text.length;
        }
        continue;
      }
      batch.push(...current);
      chars += blockChars;
    }
    return batch;
  }

  function groupTranslationApplications(batch, results) {
    const blocks = [];
    const byBlock = new Map();
    const missing = [];
    for (const item of batch) {
      const translated = results.get(item.id);
      if (translated == null) {
        missing.push(item);
        continue;
      }
      let block = byBlock.get(item.blockId);
      if (!block) {
        block = { blockId: item.blockId, applications: [] };
        byBlock.set(item.blockId, block);
        blocks.push(block);
      }
      block.applications.push({ item, translated });
    }
    return { blocks, missing };
  }

  function webSchedulingProfile(mode, externalProvider) {
    const profiles = {
      responsive: externalProvider
        ? { collectDelayMs: 260, applyDelayMs: 180, viewportMargin: 180, maxItems: 24, maxChars: 24000 }
        : { collectDelayMs: 140, applyDelayMs: 120, viewportMargin: 240, maxItems: 16, maxChars: 10000 },
      balanced: externalProvider
        ? { collectDelayMs: 420, applyDelayMs: 240, viewportMargin: 180, maxItems: 32, maxChars: 32000 }
        : { collectDelayMs: 280, applyDelayMs: 180, viewportMargin: 220, maxItems: 24, maxChars: 16000 },
      economy: externalProvider
        ? { collectDelayMs: 700, applyDelayMs: 320, viewportMargin: 120, maxItems: 32, maxChars: 32000 }
        : { collectDelayMs: 500, applyDelayMs: 260, viewportMargin: 160, maxItems: 32, maxChars: 24000 },
    };
    return { ...(profiles[mode] ?? profiles.balanced) };
  }

  function translationBatchLimits(profile, externalProvider, longDocument) {
    // Long local-AI pages must keep the normal visible-paragraph batch size.
    // Splitting them into six-item requests makes the model wake repeatedly and
    // stretches GPU contention across the entire scroll instead of finishing a
    // nearby group together. External-service limits are enforced separately.
    void externalProvider;
    void longDocument;
    return { maxItems: profile.maxItems, maxChars: profile.maxChars };
  }

  function browserShortcutFromEvent(event) {
    let key = String(event?.key ?? "");
    if (/^Key[A-Z]$/.test(String(event?.code ?? "")) && !/^[a-z]$/i.test(key)) {
      key = String(event.code).slice(3);
    } else if (/^F(?:[1-9]|1\d|2[0-4])$/.test(String(event?.code ?? "")) && !/^F\d+$/.test(key)) {
      key = String(event.code);
    }
    if (/^[a-z0-9]$/i.test(key)) key = key.toUpperCase();
    const aliases = { " ": "Space", Spacebar: "Space" };
    key = aliases[key] ?? key;
    const modifiers = [];
    if (event?.ctrlKey) modifiers.push("Ctrl");
    if (event?.altKey) modifiers.push("Alt");
    if (event?.shiftKey) modifiers.push("Shift");
    if (event?.metaKey) modifiers.push("Super");
    return [...modifiers, key].filter(Boolean).join("+");
  }

  function isQuickToggleShortcut(event, configuredShortcut = "F4") {
    return Boolean(configuredShortcut)
      && !event?.repeat
      && !event?.isComposing
      && browserShortcutFromEvent(event) === configuredShortcut;
  }

  function initialTranslationEnabled(storedEnabled, adapter) {
    return Boolean(storedEnabled && adapter && !adapter.manualOnly);
  }

  function pageTranslationEnabled({
    adapter,
    storedEnabled,
    tabEnabled,
    webEnabled,
    sitePolicy,
  }) {
    if (!adapter || !webEnabled || sitePolicy === "never") {
      return false;
    }
    if (typeof tabEnabled === "boolean") {
      return tabEnabled;
    }
    if (sitePolicy === "manual") {
      return false;
    }
    if (sitePolicy === "always") {
      return true;
    }
    return initialTranslationEnabled(storedEnabled, adapter);
  }

  function runtimeMessageFailure(requestId, error) {
    const detail = error?.message ?? String(error ?? "unknown");
    const invalidated = /extension context invalidated/i.test(detail);
    return {
      type: "error",
      requestId: requestId ?? "",
      code: invalidated ? "extension_context_invalidated" : "extension_message_failed",
      message: invalidated
        ? "확장 프로그램이 업데이트되었습니다. 페이지를 새로 고치십시오."
        : "확장 프로그램 내부 연결이 끊겼습니다. 확장을 다시 로드하십시오.",
      detail,
      retryable: !invalidated,
    };
  }

  const api = Object.freeze({
    addTranslationItems,
    closestTranslationBlock,
    createScanBatch,
    createTranslationReplayCache,
    sameMessageContext,
    groupTranslationApplications,
    isElementNearViewport,
    initialTranslationEnabled,
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
  });
  root.NudeNyangContentHelpers = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(globalThis);
