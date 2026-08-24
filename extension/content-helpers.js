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
        const pending = [...roots];
        roots.clear();
        if (pending.some((scanRoot) => !scanRoot?.isConnected)) {
          return [documentRoot];
        }
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

  function takeTranslationBatch(queue, options) {
    const batch = [];
    let chars = 0;
    while (queue.length > 0 && batch.length < options.maxItems) {
      const next = queue.shift();
      if (!options.isCurrent(next) || !options.isNearViewport(next)) {
        options.onDiscard(next);
        continue;
      }
      if (batch.length > 0 && chars + next.text.length > options.maxChars) {
        queue.unshift(next);
        break;
      }
      batch.push(next);
      chars += next.text.length;
    }
    return batch;
  }

  function isQuickToggleShortcut(event) {
    return event?.key === "F4"
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
    isElementNearViewport,
    initialTranslationEnabled,
    isQuickToggleShortcut,
    runtimeMessageFailure,
    scanRootForAddedNode,
    takeTranslationBatch,
  });
  root.NudeNyangContentHelpers = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(globalThis);
