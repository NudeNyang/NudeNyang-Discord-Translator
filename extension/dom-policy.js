(function exposeDomPolicy(root) {
  const LAYOUT_OWNER = "p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,dt,dd,summary,th,td,div,section,article,main,body";
  const INTERACTION_ROOT = "details,nav,header,footer,[role='navigation'],[role='dialog']";

  function hasTranslatableText(text) {
    // A one-character word is valid prose; a standalone count, symbol or emoji
    // is not. Length limits belong only to transport segmentation.
    return typeof text === "string" && /\p{L}/u.test(text);
  }

  function textIsVisible(element, cache = new WeakMap()) {
    if (!element) return true;
    if (cache.has(element)) return cache.get(element);
    const style = element.ownerDocument.defaultView.getComputedStyle(element);
    const visible = style.display !== "none" && style.visibility !== "hidden"
      && style.visibility !== "collapse" && style.contentVisibility !== "hidden"
      && style.opacity !== "0" && textIsVisible(element.parentElement, cache);
    cache.set(element, visible);
    return visible;
  }

  function interactionRoot(target) {
    return target?.closest?.(INTERACTION_ROOT) ?? target?.closest?.(LAYOUT_OWNER) ?? null;
  }

  // Location selection belongs to site-adapters. This engine knows only the
  // allowed document scopes and the exclusions that must survive refactoring.
  // Use the same policy again at dispatch, application and cache replay: a Text
  // node's current role can change without its identity or value changing.
  function createPublicDomPolicy(document, adapter) {
    const { Node, NodeFilter } = document.defaultView;
    const sites = root.NudeNyangSiteAdapters;
    const { isExplicitExclusionBypassBlock, isUrlLikeLinkText } = root.NudeNyangContentHelpers;
    const blockSelector = adapter.blocks.join(",");
    const selectors = (restoring) => ({
      excluded: sites.exclusionSelector(adapter, { restoring }),
      protected: sites.protectedExclusionSelector(adapter, { restoring }),
    });
    const active = selectors(false);
    const restore = selectors(true);
    const elementFor = node => node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    const publicUi = block => Boolean(adapter.publicUiBlocks?.some(selector => block.matches(selector)));
    const publicForm = element => {
      const form = element.closest("form");
      return !form || Boolean(adapter.publicForms?.some(selector => form.matches(selector)));
    };

    function excludesBlock(block, { restoring = false } = {}) {
      const policy = restoring ? restore : active;
      if (!block || block.closest(policy.protected)) return true;
      if (publicUi(block)) return !publicForm(block);
      return !isExplicitExclusionBypassBlock(block, adapter) && Boolean(block.closest(policy.excluded));
    }

    function blockFor(node, { restoring = false } = {}) {
      const element = elementFor(node);
      if (!element || !blockSelector) return null;
      // A matched heading inside an allowed navigation link is not necessarily
      // an allowed block itself. Keep looking for the closest permitted owner;
      // eligibility still checks every child's absolute protection separately.
      for (let candidate = element.closest(blockSelector); candidate;
        candidate = candidate.parentElement?.closest(blockSelector)) {
        if (!excludesBlock(candidate, { restoring })) return candidate;
      }
      if (!adapter.collectLayoutText || element.closest((restoring ? restore : active).excluded)) return null;
      return element.closest(LAYOUT_OWNER);
    }

    function eligibility(block, { visibility = new WeakMap(), restoring = false } = {}) {
      if (excludesBlock(block, { restoring })) return () => false;
      const policy = restoring ? restore : active;
      const isPublicUi = publicUi(block);
      const bypass = isPublicUi || isExplicitExclusionBypassBlock(block, adapter);
      return node => {
        const parent = node.parentElement;
        if (!node.isConnected || !parent || !block.contains(node) || parent.closest(policy.protected)
          || (!restoring && !textIsVisible(parent, visibility))) return false;
        // Every text node has exactly one owner, including nested semantic
        // paragraphs and layout-only prose around them.
        if (blockFor(node, { restoring }) !== block) return false;
        const nearestExcluded = parent.closest(policy.excluded);
        const excludedInsideBypass = bypass && nearestExcluded !== block && block.contains(nearestExcluded);
        if ((!bypass && nearestExcluded) || (!isPublicUi && excludedInsideBypass)
          || (isPublicUi && !publicForm(parent))) return false;
        const anchor = parent.closest("a[href]");
        return !anchor || !isUrlLikeLinkText(anchor.textContent, anchor.href);
      };
    }

    function allowsText(node, options = {}) {
      const block = blockFor(node, options);
      return Boolean(block && eligibility(block, options)(node));
    }

    function collectBlocks(scanRoot, visit) {
      if (!scanRoot?.querySelectorAll || !blockSelector) return 0;
      const found = new Set();
      const add = block => {
        if (!block || found.has(block) || excludesBlock(block)) return;
        found.add(block);
        visit(block);
      };
      if (scanRoot.nodeType === Node.ELEMENT_NODE) add(blockFor(scanRoot));
      for (const block of scanRoot.querySelectorAll(blockSelector)) add(block);
      if (adapter.collectLayoutText) {
        const element = scanRoot.nodeType === Node.DOCUMENT_NODE ? document.body : scanRoot;
        if (element && !element.closest(active.excluded) && !element.closest(blockSelector)) {
          // Never read text values in a pruned editor/private/protected subtree.
          // Text length is a transport concern, not a content eligibility rule.
          const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
              if (node.nodeType === Node.ELEMENT_NODE) {
                return node.matches(active.excluded) || node.matches(blockSelector)
                  ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
              }
              return hasTranslatableText(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
            },
          });
          while (walker.nextNode()) add(blockFor(walker.currentNode));
        }
      }
      return found.size;
    }

    return Object.freeze({ blockFor, collectBlocks, eligibility, allowsText, excludesBlock });
  }

  root.NudeNyangDomPolicy = Object.freeze({ createPublicDomPolicy, hasTranslatableText, interactionRoot, textIsVisible });
})(globalThis);
