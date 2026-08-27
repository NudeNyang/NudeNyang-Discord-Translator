(() => {
  "use strict";

  // This module only identifies DOM structure. It never reads message text,
  // contact names, input values, application stores, cookies, or auth tokens.
  // The caller must obtain messenger consent BEFORE extracting any text.
  const COMMON_EXCLUDES = Object.freeze([
    "input", "textarea", "select", "option", "form", "label",
    "[contenteditable]", '[role="textbox"]', '[role="searchbox"]', '[role="search"]',
    "script", "style", "noscript", "svg", "canvas", "iframe", "object", "embed",
    "audio", "video", "img", "pre", "code", "kbd", "samp",
    "[hidden]", "[inert]", '[aria-hidden="true"]', '[translate="no"]', ".notranslate",
    "[data-nudenyang-ignore]", "header", "nav", '[role="navigation"]', '[role="heading"]',
    // X uses a button for an outgoing message bubble; no other button is text.
    'button:not([data-testid="messageEntry"])', '[role="button"]:not([data-testid="messageEntry"])',
    '[role="menu"]', '[role="toolbar"]', "time", "[datetime]",
    '[data-testid="search-results"]', '[data-testid="conversation-list"]',
    '[data-testid="messageSender"]', '[data-testid="message-author"]',
    '[data-testid="message-reactions"]', '[data-testid="message-attachment"]',
    '[data-testid="message-actions"]', '[data-testid="message-timestamp"]',
    ".username", ".peer-title", ".message-author", ".message-sender",
    ".message-timestamp", ".message-reactions", ".message-attachments",
    'a[href^="mailto:"]', 'a[href^="tel:"]',
  ]);

  const SERVICES = Object.freeze([
    {
      id: "x", label: "X",
      hosts: ["x.com", "www.x.com", "twitter.com", "www.twitter.com"],
      route: (path) => /^\/(?:messages|i\/chat)(?:\/[^/]+)?\/?$/.test(path),
      roots: [
        '[data-testid="DmActivityViewport"]', '[data-testid="dm-conversation-messages"]',
        // Current X Chat: the inbox is a sibling of the conversation panel.
        // Do not use dm-container, the whole panel, or an arbitrary role=log.
        '[data-testid="dm-conversation-panel"] [data-testid="dm-conversation-content"] [data-testid="dm-message-scroller"][role="log"]',
      ],
      blocks: [
        '[data-testid="messageEntry"] [data-testid="tweetText"]',
        '[data-testid="messageEntry"] [data-testid="message-text"]',
        '[data-testid="messageEntry"] [dir="auto"]',
        '[data-testid="dm-message-text"]',
        // The bubble also contains timestamp/layout nodes. Only its directional
        // body span is text; the dynamic test ID is not a conversation identity.
        '[data-testid="dm-message-scroller"][role="log"] [role="article"] [data-testid^="message-text-"] span[dir="auto"]',
      ],
      excludes: [
        '[data-testid="UserName"]', '[data-testid="User-Name"]', '[data-testid="UserAvatar-Container"]',
        '[data-testid="messageHeader"]', '[data-testid="messageSender"]', '[data-testid="DMComposer"]',
        '[data-testid="DMConversationList"]', '[data-testid="reply"]', '[data-testid="dm-reaction"]',
        '[data-testid="dm-inbox-panel"]', '[role="status"]',
        'a[href^="/i/user/"]', 'a[href^="/hashtag/"]',
      ],
    },
    {
      id: "discord", label: "Discord",
      hosts: ["discord.com", "ptb.discord.com", "canary.discord.com"],
      route: (path) => /^\/channels\/(?:@me|\d+)\/\d+(?:\/\d+)?\/?$/.test(path),
      roots: ['[data-list-id="chat-messages"]'],
      blocks: ['[id^="message-content-"]'],
      excludes: [
        '[id^="message-username-"]', '[id^="message-reply-context-"]', '[class*="repliedMessage_"]',
        '[class*="username_"]', '[class*="timestamp_"]', '[class*="reactions_"]',
        '[class*="embedAuthor_"]', '[class*="attachment_"]', '[class*="mention_"]',
        '[data-list-id="private-channels"]',
      ],
    },
    {
      id: "whatsapp", label: "WhatsApp",
      hosts: ["web.whatsapp.com"],
      route: (path) => path === "/",
      roots: ['#main [data-testid="conversation-panel-messages"]', "#main"],
      blocks: [
        ".message-in .selectable-text", ".message-out .selectable-text",
        '[data-testid="msg-container"] [data-testid="msg-text"]',
      ],
      excludes: [
        "footer", '[data-testid="quoted-message"]', '[data-testid="quoted-message-text"]',
        '[data-testid="author"]', '[data-testid="sender-name"]', '[data-testid="msg-meta"]',
        '[data-testid="reactions"]', '[data-testid="document-thumb"]', '[data-testid="contact-card"]',
        '[data-testid="conversation-info-header"]', '[data-testid="mention"]',
      ],
    },
    {
      id: "telegram", label: "Telegram",
      hosts: ["web.telegram.org"],
      route: (path) => /^\/(?:[akz]\/?)?$/.test(path),
      roots: ["#MiddleColumn .MessageList", ".chat .bubbles-inner"],
      blocks: [
        ".Message:not(.ActionMessage) .text-content",
        ".bubble:not(.service):not(.is-date):not(.is-sponsored) .message",
      ],
      excludes: [
        ".time", ".time-inner", ".message-time", ".MessageMeta", ".reactions-element",
        ".replies-element", ".reactions", ".Reactions", ".reply", ".reply-wrapper", ".sender-title",
        ".message-title", ".message-author", ".embedded-message", ".media-inner", ".document",
        ".contact", ".forwarded", ".forward-title", ".is-sponsored", ".service", ".ActionMessage",
        ".web", ".mention", ".mention-name", ".Transition_slide:not(.Transition_slide-active)",
      ],
    },
    {
      id: "messenger", label: "Messenger",
      hosts: ["messenger.com", "www.messenger.com"],
      route: (path) => /^\/(?:e2ee\/)?t\/\d+\/?$/.test(path),
      roots: ['[role="main"] [data-scope="messages_table"]'],
      blocks: ['div[dir="auto"]', 'span[dir="auto"]'],
      excludes: [
        'a[href*="facebook.com/"]', '[data-scope="actor"]', '[data-testid="message_sender"]',
        '[data-testid="message_timestamp"]', '[data-testid="message_reactions"]',
        '[data-testid="attachment"]', '[role="status"]', '[role="tooltip"]',
      ],
    },
    {
      id: "slack", label: "Slack",
      hosts: ["app.slack.com"],
      route: (path) => /^\/client\/T[A-Z0-9]+\/[CDG][A-Z0-9]+(?:\/thread\/[^/]+)?\/?$/i.test(path),
      roots: ['[data-qa="message_pane"] [data-qa="message_list"]', ".p-message_pane"],
      blocks: [".c-message_kit__blocks .p-rich_text_block", ".c-message__body"],
      excludes: [
        ".c-message__sender", ".c-message__sender_link", ".c-message__timestamp", ".c-reaction",
        ".c-message_kit__reactions", ".c-message_kit__thread_message", ".c-mention", ".c-member_slug",
        ".c-file", '[data-qa="message_sender"]', '[data-qa="search_results"]',
        '[data-qa="message_input"]', '[data-qa="file_attachment"]',
      ],
    },
    {
      id: "teams", label: "Microsoft Teams",
      hosts: ["teams.microsoft.com", "teams.live.com", "teams.cloud.microsoft"],
      route: (path) => /^\/(?:v2\/?|_\/?)?$/.test(path),
      roots: ["#chat-pane-list", '[data-tid="chat-pane-list"]'],
      blocks: ['[id^="message-body-"] [id^="content-"]', '[data-tid="message-body"]'],
      excludes: [
        '[data-tid="message-author-name"]', '[id^="timestamp-"]', '[data-tid="message-reactions"]',
        '[data-tid="quoted-reply"]', '[data-tid="message-attachments"]', '[data-tid="mention"]',
        '[data-tid="chat-header"]', '[data-tid="chat-list"]',
      ],
    },
    {
      id: "google-messages", label: "Google Messages",
      hosts: ["messages.google.com"],
      route: (path) => /^\/web(?:\/u\/\d+)?(?:\/conversations(?:\/[A-Za-z0-9_-]+)?)?\/?$/.test(path),
      roots: ["mws-conversation-container mws-messages-list", "mws-conversation-container"],
      blocks: ["mws-message-wrapper mws-text-message-part"],
      excludes: [
        "mws-conversation-header", "mws-message-timestamp", "mws-message-sender", "mws-message-reactions",
        "mws-contact-card", "mws-message-composer", "mws-conversations-list", "mws-attachment",
      ],
    },
  ].map((service) => Object.freeze({
    ...service,
    hosts: Object.freeze(service.hosts),
    roots: Object.freeze(service.roots),
    blocks: Object.freeze(service.blocks),
    excludes: Object.freeze([...COMMON_EXCLUDES, ...service.excludes]),
  })));

  const BLOCKED_ROUTE_SEGMENT = /(?:^|[\/#])(?:login|logout|signin|signout|auth|authentication|pairing|account|settings|preferences|payment|payments|billing|checkout|search|compose|new|requests|contacts|calendar|calls)(?:[\/#?]|$)/i;

  function parsedLocation(location) {
    try {
      const url = new URL(typeof location === "string" ? location : location?.href);
      if (url.protocol !== "https:" || url.port || url.username || url.password) return null;
      return url;
    } catch {
      return null;
    }
  }

  function serviceForUrl(url) {
    if (!url || BLOCKED_ROUTE_SEGMENT.test(`${url.pathname}${url.hash}`)) return null;
    return SERVICES.find((service) => service.hosts.includes(url.hostname) && service.route(url.pathname)) ?? null;
  }

  function siteForLocation(location) {
    const service = serviceForUrl(parsedLocation(location));
    return service ? { id: service.id, label: service.label } : null;
  }

  function privateSiteForLocation(location) {
    const url = parsedLocation(location);
    if (!url) return null;
    const service = SERVICES.find((item) => item.hosts.includes(url.hostname));
    if (!service || (service.id === "x" && !/^\/(?:messages|i\/chat)(?:\/|$)/.test(url.pathname))) return null;
    // Classification is deliberately wider than translation eligibility. Inbox,
    // login, search, settings, and compose screens must never use public fallback.
    return { id: service.id, label: service.label };
  }

  function canHostConversation(location, serviceId) {
    const url = parsedLocation(location);
    if (!url || BLOCKED_ROUTE_SEGMENT.test(`${url.pathname}${url.hash}`)) return false;
    const service = serviceForUrl(url);
    if (service) return service.id === serviceId;
    // X may host a private drawer on a public profile or timeline, but never on
    // an unsupported private route or an authentication/settings/search page.
    return serviceId === "x" && SERVICES[0].hosts.includes(url.hostname)
      && !privateSiteForLocation(url);
  }

  function isVisibleElement(element, cache) {
    if (!element || element.nodeType !== 1 || !element.isConnected) return false;
    if (cache?.has(element)) return cache.get(element);
    const view = element.ownerDocument?.defaultView;
    const walked = [];
    let visible = true;
    for (let current = element; current; current = current.parentElement) {
      if (cache?.has(current)) {
        visible = cache.get(current);
        break;
      }
      walked.push(current);
      if (current.hasAttribute("hidden") || current.hasAttribute("inert")
        || current.getAttribute("aria-hidden") === "true"
        || (current.localName === "dialog" && !current.hasAttribute("open"))) {
        visible = false;
        break;
      }
      const parent = current.parentElement;
      if (parent?.localName === "details" && !parent.hasAttribute("open") && current.localName !== "summary") {
        visible = false;
        break;
      }
      const style = view?.getComputedStyle?.(current);
      if (style && (style.display === "none" || style.visibility === "hidden"
        || style.visibility === "collapse" || style.opacity === "0" || style.contentVisibility === "hidden")) {
        visible = false;
        break;
      }
    }
    // Hidden children do not make their ancestors hidden; cache only the queried
    // element on failure and all ancestors only when the whole chain is visible.
    if (cache) {
      if (visible) for (const current of walked) cache.set(current, true);
      else cache.set(element, false);
    }
    return visible;
  }

  function excludedInsideRoot(element, context) {
    const selectors = context.excludes.join(",");
    for (let current = element; current; current = current.parentElement) {
      if (current.matches(selectors)) return true;
      if (current === context.root) break;
    }
    // A transcript nested in an editor is never a read-only conversation.
    return Boolean(context.root.closest('[contenteditable], input, textarea, [role="textbox"], [role="search"], [data-testid="search-results"]'));
  }

  function isEligibleMessageBlock(element, context, visibilityCache) {
    return Boolean(context?.root && element?.nodeType === 1 && element !== context.root
      && context.root.isConnected && context.root.contains(element)
      && element.matches(context.blocks.join(","))
      && !excludedInsideRoot(element, context)
      && isVisibleElement(element, visibilityCache));
  }

  function selectMessageBlocks(context, visibilityCache = new WeakMap()) {
    if (!context?.root || !isVisibleElement(context.root, visibilityCache)) return [];
    const blocks = [];
    const selected = new Set();
    for (const element of context.root.querySelectorAll(context.blocks.join(","))) {
      if (!isEligibleMessageBlock(element, context, visibilityCache)) continue;
      let nested = false;
      for (let parent = element.parentElement; parent && parent !== context.root; parent = parent.parentElement) {
        if (selected.has(parent)) {
          nested = true;
          break;
        }
      }
      if (nested) continue;
      selected.add(element);
      blocks.push(element);
    }
    return blocks;
  }

  function firstMessageBlock(context, visibilityCache) {
    // Lifecycle checks are frequent. Determine structural conversation identity
    // from one eligible body without inspecting every message in a long chat.
    for (const element of context.root.querySelectorAll(context.blocks.join(","))) {
      if (isEligibleMessageBlock(element, context, visibilityCache)) return element;
    }
    return null;
  }

  function contextForDocument(location, document) {
    if (!document?.querySelectorAll) return null;
    const url = parsedLocation(location);
    if (!url) return null;
    let service = serviceForUrl(url);
    let scopes = [document];
    if (!service) {
      // A visible X DM drawer is private even while the main page is a public
      // timeline. Do not fall back to the timeline's tweet/article selectors.
      const x = SERVICES[0];
      if (!canHostConversation(url, "x")) return null;
      scopes = [...document.querySelectorAll('[data-testid="DMDrawer"]')].filter((element) => isVisibleElement(element));
      if (scopes.length !== 1) return null;
      service = x;
    }
    const visibilityCache = new WeakMap();
    let xContext = null;
    for (const selector of service.roots) {
      const contexts = [];
      for (const scope of scopes) {
        for (const root of scope.querySelectorAll(selector)) {
          if (!isVisibleElement(root, visibilityCache)) continue;
          if (service.id === "x" && root.closest('[data-testid="dm-inbox-panel"]')) continue;
          const context = {
            id: service.id,
            label: service.label,
            root,
            blocks: service.blocks,
            excludes: service.excludes,
            protectedExcludes: service.excludes,
            // Local in-page lifecycle key only. Never serialize this route or
            // identityNodes into native messages, settings, logs, or telemetry.
            routeKey: `${service.id}:${url.pathname}${url.hash}`,
            identityNodes: [],
          };
          const first = firstMessageBlock(context, visibilityCache);
          if (!first) continue;
          context.identityNodes = [root, first];
          contexts.push(context);
        }
      }
      // Ambiguous visible transcripts (e.g. during a view transition) are left
      // untouched until a single active conversation can be identified.
      if (contexts.length > 1) return null;
      if (contexts.length === 1) {
        if (service.id !== "x") return contexts[0];
        // Check all X layouts before choosing: a legacy and a current panel
        // can coexist during navigation. Nested roots are the same transcript;
        // retain the existing selector priority only in that case.
        const next = contexts[0];
        if (xContext && !xContext.root.contains(next.root) && !next.root.contains(xContext.root)) return null;
        xContext ??= next;
      }
    }
    return xContext;
  }

  globalThis.NudeNyangMessengerAdapters = Object.freeze({
    siteForLocation,
    privateSiteForLocation,
    canHostConversation,
    contextForDocument,
    isVisibleElement,
    isEligibleMessageBlock,
    selectMessageBlocks,
  });
})();
