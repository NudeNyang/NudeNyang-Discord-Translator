(function exposeContentHelpers(root) {
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
      if (batch.length === 0 && blockChars > options.maxChars && options.discardOversize) {
        for (const item of current) options.onDiscard(item);
        continue;
      }
      const exceedsItemLimit = batch.length > 0 && batch.length + current.length > options.maxItems;
      const exceedsCharLimit = batch.length > 0 && chars + blockChars > options.maxChars;
      if (exceedsItemLimit || exceedsCharLimit) {
        queue.unshift(...current);
        break;
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

  function isQuickToggleShortcut(event) {
    return (event?.key === "F4" || event?.code === "F4")
      && !event.repeat
      && !event.isComposing
      && !event.ctrlKey
      && !event.altKey
      && !event.shiftKey
      && !event.metaKey;
  }

  function initialTranslationEnabled(storedEnabled, adapter) {
    return Boolean(storedEnabled && adapter && !adapter.manualOnly);
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
    createScanBatch,
    groupTranslationApplications,
    isElementNearViewport,
    initialTranslationEnabled,
    isQuickToggleShortcut,
    isUrlLikeLinkText,
    registerTranslationBlock,
    runtimeMessageFailure,
    scanRootForAddedNode,
    takeTranslationBatch,
    webSchedulingProfile,
  });
  root.NudeNyangContentHelpers = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(globalThis);
