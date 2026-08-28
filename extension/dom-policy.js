(function exposeDomPolicy(root) {
  const LAYOUT_OWNER = "p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,dt,dd,summary,th,td,div,section,article,main,body";
  const INTERACTION_ROOT = "details,nav,header,footer,[role='navigation'],[role='dialog']";
  const NAVIGATION = "nav,header,footer,aside,[role='navigation'],[role='menu'],[role='menubar'],[role='toolbar']";
  const ARTICLE = "article,[role='article']";
  const PROSE = "p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,dt,dd";
  const PRIVATE_UI = "form,[role='form'],[role='log'],[rel~='author'],[itemprop~='author'],[itemprop~='creator']";
  const PRICE_CONTAINER = "[class~='price'],[class^='price-'],[class*=' price-']";
  const UI_LABEL = "button,label,legend,[role='button'],[role='tab'],[role='menuitem']";
  const STATIC_HEADING = "h1,h2,h3,h4,h5,h6,dt,th";
  const UI_CANDIDATE = `${UI_LABEL},${STATIC_HEADING},[id],[role='note'],[itemprop~='name'],[itemprop~='orderStatus'],${PRICE_CONTAINER} > *`;

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

    function readOnlyUiScope(element) {
      if (!adapter.collectReadOnlyUi || !element || element.closest("[role='log']")) return null;
      const label = element.closest(UI_LABEL);
      if (label && !label.querySelector(ARTICLE)) return label;
      for (let description = element.closest("[id]"); description; description = description.parentElement?.closest("[id]")) {
        // Query the reference, not all fields' values. Re-evaluate on dispatch
        // and replay so a removed description relationship takes effect at once.
        const id = description.id.replace(/[^\w-]/gu, character => `\\${character.codePointAt(0).toString(16)} `);
        if (id && [...document.querySelectorAll(`input[aria-describedby~="${id}"],select[aria-describedby~="${id}"],textarea[aria-describedby~="${id}"]`)]
          .some(control => control.closest("form") === description.closest("form"))) return description;
      }
      if (adapter.staticUiOnly) {
        const heading = element.closest(STATIC_HEADING);
        if (heading) return heading;
        const product = element.closest("[itemprop~='name']");
        if (product?.closest("[itemtype$='/Product']")) return product;
        return element.closest("[itemprop~='orderStatus']");
      }
      const price = element.closest(PRICE_CONTAINER);
      if (price && price !== element) {
        let child = element;
        while (child.parentElement !== price) child = child.parentElement;
        return child;
      }
      return null;
    }

    function hardProtected(element) {
      if (element.closest(active.protected)) return true;
      // A price leaf is a value; a container can also have separately marked copy.
      return Boolean(element.closest(PRICE_CONTAINER)?.childElementCount === 0);
    }

    function navigationLink(element) {
      if (!adapter.collectPublicUi) return null;
      const anchor = element?.closest("a[href]");
      const landmark = anchor?.closest(NAVIGATION);
      return landmark && !landmark.closest(ARTICLE)
        && sites.isPublicNavigationUrl(anchor.getAttribute("href"), document.baseURI) ? anchor : null;
    }

    function articleFor(element) {
      return adapter.collectPublicUi ? element?.closest(ARTICLE) : null;
    }

    function sectionHeading(element) {
      if (!adapter.collectPublicUi) return null;
      const heading = element?.closest("h1,h2,h3,h4,h5,h6");
      const header = heading?.closest("header");
      const section = header?.parentElement?.closest("section,article,main");
      // Article headers often contain author names. Only a section's own
      // heading is a generic public title; do not open arbitrary bylines.
      return section?.matches("section") && !header.closest("nav,aside,footer,form,[role='navigation'],[role='dialog'],[role='log']") ? heading : null;
    }

    // A navigation landmark is not itself private. Only its public link labels
    // are eligible; arbitrary account values and unclassified dialogs stay out.
    // A semantic article remains prose when a viewer wraps it in a modal or a
    // clickable row. Leaf action labels have their own owner.
    function genericScope(element) {
      return readOnlyUiScope(element) || navigationLink(element) || sectionHeading(element) || articleFor(element);
    }

    function genericExcludes(element, policy) {
      const ui = readOnlyUiScope(element);
      if (!genericScope(element) || (!ui && element.closest(PRIVATE_UI))) return true;
      if (adapter.staticUiOnly && !ui && !navigationLink(element)) return true;
      const link = navigationLink(element);
      const article = articleFor(element);
      const prose = element.closest(PROSE);
      const heading = sectionHeading(element);
      for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
        if (ancestor.matches(policy.protected)) return true;
        if (!ancestor.matches(policy.excluded)) continue;
        if (ui && ancestor.contains(ui) && ancestor.matches(`${UI_LABEL},form,[role='form'],${NAVIGATION},[role='dialog'],[aria-modal='true'],${PRICE_CONTAINER}`)) continue;
        if (link && ancestor.matches(NAVIGATION) && ancestor.contains(link)) continue;
        if (heading && ancestor.matches("header") && ancestor.contains(heading)) continue;
        if (article && ancestor.matches("[role='dialog'],[aria-modal='true']") && ancestor.contains(article)) continue;
        if (article && prose && article.contains(prose) && ancestor.matches("[role='button']")
          && ancestor !== prose && ancestor.contains(prose)) continue;
        return true;
      }
      return false;
    }

    function excludesBlock(block, { restoring = false } = {}) {
      const policy = restoring ? restore : active;
      if (!block || block.closest(policy.protected) || (!restoring && hardProtected(block))) return true;
      if (adapter.staticUiOnly && !readOnlyUiScope(block) && !navigationLink(block)) return true;
      if (genericScope(block)) return genericExcludes(block, policy);
      if (publicUi(block)) return !publicForm(block);
      return !isExplicitExclusionBypassBlock(block, adapter) && Boolean(block.closest(policy.excluded));
    }

    function blockFor(node, { restoring = false } = {}) {
      const element = elementFor(node);
      if (!element || !blockSelector) return null;
      const ui = readOnlyUiScope(element);
      if (ui && !excludesBlock(ui, { restoring })) return ui;
      const link = navigationLink(element);
      if (link && !excludesBlock(link, { restoring })) return link;
      // A matched heading inside an allowed navigation link is not necessarily
      // an allowed block itself. Keep looking for the closest permitted owner;
      // eligibility still checks every child's absolute protection separately.
      for (let candidate = element.closest(blockSelector); candidate;
        candidate = candidate.parentElement?.closest(blockSelector)) {
        if (!excludesBlock(candidate, { restoring })) return candidate;
      }
      if (!adapter.collectLayoutText || excludesBlock(element, { restoring })) return null;
      return element.closest(LAYOUT_OWNER);
    }

    function eligibility(block, { visibility = new WeakMap(), restoring = false } = {}) {
      if (excludesBlock(block, { restoring })) return () => false;
      const policy = restoring ? restore : active;
      const isPublicUi = publicUi(block);
      const isGenericUi = Boolean(genericScope(block));
      const bypass = isPublicUi || isExplicitExclusionBypassBlock(block, adapter);
      const linkLabels = new WeakMap();
      function visibleLinkLabel(anchor) {
        if (linkLabels.has(anchor)) return linkLabels.get(anchor);
        const walker = document.createTreeWalker(anchor, NodeFilter.SHOW_TEXT);
        let label = "";
        while (walker.nextNode()) {
          const parent = walker.currentNode.parentElement;
          if (parent.closest(policy.protected) || !publicForm(parent)
            || (!restoring && !textIsVisible(parent, visibility))
            || (genericScope(anchor) && genericExcludes(parent, policy))) continue;
          label += walker.currentNode.nodeValue ?? "";
        }
        linkLabels.set(anchor, label.trim());
        return label.trim();
      }
      return node => {
        const parent = node.parentElement;
        if (!node.isConnected || !parent || !block.contains(node) || parent.closest(policy.protected)
          || (!restoring && hardProtected(parent))
          || (!restoring && !textIsVisible(parent, visibility))) return false;
        // Do not send unmarked numeric price fragments from mixed price wrappers.
        if (parent.closest(PRICE_CONTAINER) && /\p{N}/u.test(node.nodeValue ?? "")) return false;
        // Every text node has exactly one owner, including nested semantic
        // paragraphs and layout-only prose around them.
        if (blockFor(node, { restoring }) !== block) return false;
        const nearestExcluded = parent.closest(policy.excluded);
        const excludedInsideBypass = bypass && nearestExcluded !== block && block.contains(nearestExcluded);
        if (isGenericUi) {
          if (genericExcludes(parent, policy)) return false;
        } else if ((!bypass && nearestExcluded) || (!isPublicUi && excludedInsideBypass)
          || (isPublicUi && !publicForm(parent))) return false;
        const anchor = parent.closest("a[href]");
        if (!anchor) return true;
        const label = visibleLinkLabel(anchor);
        if (isUrlLikeLinkText(label, anchor.href)) return false;
        if (adapter.collectPublicUi && /^@[\p{L}\p{N}_.-]+$/u.test(label)) return false;
        if (articleFor(parent) && anchor.getAttribute("role") === "link") {
          try {
            // A link whose complete label is its profile identifier is an
            // identity, not natural-language navigation or article prose.
            const segments = new URL(anchor.href).pathname.split("/").filter(Boolean);
            if (segments.length === 1 && decodeURIComponent(segments[0]) === label) return false;
          } catch { return false; }
        }
        return true;
      };
    }

    function allowsText(node, options = {}) {
      const block = blockFor(node, options);
      return Boolean(block && eligibility(block, options)(node));
    }

    // Metadata-only boundaries used by the independent audit before it reads a
    // text value. Reuse safety policy, never the collector's discovery selectors.
    function auditBoundary(element, { visibility = new WeakMap() } = {}) {
      if (element.matches("iframe,canvas,svg")) return `unsupported_${element.localName === "iframe" ? "frame" : "drawing"}`;
      if (element.matches("[hidden],[inert],[aria-hidden='true']")) return "hidden";
      if (element.matches(active.protected) || hardProtected(element)) return "protected";
      if (element.matches("[role='log'],[rel~='author'],[itemprop~='author'],[itemprop~='creator']")) return "private_scope";
      if (!adapter.collectReadOnlyUi && (element.matches("[role='form']") || (element.matches("form") && !publicForm(element)))) return "private_scope";
      if (!textIsVisible(element, visibility)) return "hidden";
      return "";
    }

    function explain(node, { visibility = new WeakMap() } = {}) {
      const element = elementFor(node);
      if (!node?.isConnected || !element) return { eligible: false, reason: "detached" };
      for (let parent = element; parent; parent = parent.parentElement) {
        const reason = auditBoundary(parent, { visibility });
        if (reason) return { eligible: false, reason };
      }
      const block = blockFor(node);
      if (!block) return { eligible: false, reason: element.closest(active.excluded) ? "excluded_scope" : "outside_scope" };
      if (eligibility(block, { visibility })(node)) return { eligible: true, reason: "eligible", block };
      return { eligible: false, reason: element.closest("a[href]") ? "identity_link" : "excluded_scope", block };
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
      if (adapter.collectReadOnlyUi) {
        for (const element of scanRoot.querySelectorAll(UI_CANDIDATE)) {
          const scope = readOnlyUiScope(element);
          if (scope) add(scope);
        }
      }
      for (const block of scanRoot.querySelectorAll(blockSelector)) add(block);
      if (adapter.collectPublicUi) {
        for (const anchor of scanRoot.querySelectorAll("a[href]")) {
          if (navigationLink(anchor)) add(anchor);
        }
        const articles = [...scanRoot.querySelectorAll(ARTICLE)];
        if (scanRoot.matches?.(ARTICLE)) articles.unshift(scanRoot);
        const containingArticle = elementFor(scanRoot)?.closest(ARTICLE);
        if (containingArticle && !articles.includes(containingArticle)) articles.push(containingArticle);
        for (const article of articles) {
          if (excludesBlock(article)) continue;
          const walker = document.createTreeWalker(article, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
              if (node.nodeType === Node.ELEMENT_NODE) return excludesBlock(node) || node.matches(blockSelector)
                ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
              const block = blockFor(node);
              return block && eligibility(block)(node) && hasTranslatableText(node.nodeValue)
                ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
            },
          });
          while (walker.nextNode()) add(blockFor(walker.currentNode));
        }
      }
      if (adapter.collectLayoutText && !adapter.staticUiOnly) {
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

    return Object.freeze({ blockFor, collectBlocks, eligibility, allowsText, excludesBlock, explain, auditBoundary });
  }

  root.NudeNyangDomPolicy = Object.freeze({ createPublicDomPolicy, hasTranslatableText, interactionRoot, textIsVisible });
})(globalThis);
