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

  const X_CHAT_ROOT = '[data-testid="dm-conversation-panel"] [data-testid="dm-conversation-content"] [data-testid="dm-message-scroller"][role="log"]';
  const OUTLOOK_READING_BODY = '[id="UniqueMessageBody"][role="document"], .allowTextSelection:is([role="document"], [role="region"])';

  const SERVICES = Object.freeze([
    {
      id: "x", label: "X",
      hosts: ["x.com", "www.x.com", "twitter.com", "www.twitter.com"],
      route: (path) => /^\/(?:messages|i\/chat)(?:\/[^/]+)?\/?$/.test(path),
      roots: [
        '[data-testid="DmActivityViewport"]', '[data-testid="dm-conversation-messages"]',
        // Current X Chat: the inbox is a sibling of the conversation panel.
        // Do not use dm-container, the whole panel, or an arbitrary role=log.
        X_CHAT_ROOT,
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
      blocks: [
        '[id^="message-content-"]',
        // Use the same textual preview parts as the desktop adapter, inside
        // the current transcript only. Never follow links or read image pixels.
        ':is(article[class*="embed_"], [class*="embedFull_"]) :is([class*="embedTitle_"], [class*="embedDescription_"], [class*="embedFieldName_"], [class*="embedFieldValue_"])',
      ],
      excludes: [
        '[id^="message-username-"]', '[id^="message-reply-context-"]', '[class*="repliedMessage_"]',
        '[class*="username_"]', '[class*="timestamp_"]', '[class*="reactions_"]',
        '[class*="embedAuthor_"]', '[class*="attachment_"]', '[class*="mention_"]',
        '[class*="embedAuthorName_"]', '[class*="embedProvider_"]', '[class*="embedFooter_"]',
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
      id: "gmail", label: "Gmail",
      hosts: ["mail.google.com"],
      route: path => /^\/mail(?:\/u\/\d+)?\/?$/u.test(path),
      roots: ['[role="main"]'],
      blocks: ['.ha > h2.hP', '[data-message-id] .ii > .a3s'],
      reading: { roots: ['[role="main"]'], title: '.ha > h2.hP', body: '[data-message-id] .ii > .a3s' },
      excludes: ['[email]', '[data-hovercard-id]', '.gE', '.aHl', '[role="grid"]', 'address', '[itemprop~="author"]'],
    },
    {
      id: "outlook", label: "Outlook",
      hosts: ["outlook.live.com", "outlook.office.com", "outlook.office365.com"],
      route: path => /^\/mail(?:\/|$)/iu.test(path),
      roots: ['[data-app-section="MailReadCompose"][role="main"]'],
      blocks: ['h1', 'h2', '[role="heading"][aria-level="2"]', OUTLOOK_READING_BODY],
      // Service boundaries only; the common reading contract selects a single
      // subject outside the body and never falls back to the whole mail page.
      // Structural references and live-verification limits: WEB_READING_SCOPE.md.
      reading: {
        roots: ['[data-app-section="MailReadCompose"][role="main"]'],
        title: 'h1, h2, [role="heading"][aria-level="2"]',
        body: OUTLOOK_READING_BODY,
      },
      excludes: ['[email]', '.ms-Persona', '[data-app-section="MessageList"]', '[role="listbox"]',
        '[role="option"]', 'address', '[itemprop~="author"]', '[itemprop~="email"]', '[rel~="author"]'],
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
    if (!url) return null;
    const service = SERVICES.find(item => item.hosts.includes(url.hostname) && item.route(url.pathname));
    if (service?.reading) {
      // Mail search can open a single result in the reading pane. The DOM
      // contract still requires a subject and a visible body, never list text.
      let route;
      try { route = decodeURIComponent(`${url.pathname}${url.hash}`); } catch { return null; }
      return /(?:^|[\/#])(?:drafts|compose|new|settings|options|contacts|people|calendar|login|logout|signin|signout|auth)(?:[\/#?]|$)/iu.test(route)
        || [...url.searchParams.keys()].some(key => /^(?:compose|draft)$/iu.test(key)) ? null : service;
    }
    return BLOCKED_ROUTE_SEGMENT.test(`${url.pathname}${url.hash}`) ? null : service ?? null;
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
    if (!url) return false;
    const service = serviceForUrl(url);
    if (service) return service.id === serviceId;
    if (BLOCKED_ROUTE_SEGMENT.test(`${url.pathname}${url.hash}`)) return false;
    // X may host a private drawer on a public profile or timeline, but never on
    // an unsupported private route or an authentication/settings/search page.
    return serviceId === "x" && SERVICES[0].hosts.includes(url.hostname)
      && !privateSiteForLocation(url);
  }

  function isVisibleElement(element, cache, ariaHiddenException = null) {
    if (!element || element.nodeType !== 1 || !element.isConnected) return false;
    // Discord's visual channel label duplicates its accessible link name.
    // Ignore aria-hidden only on that exact, structurally verified wrapper;
    // never reuse its visibility result for ordinary message collection.
    if (ariaHiddenException) cache = undefined;
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
        || (current.getAttribute("aria-hidden") === "true" && current !== ariaHiddenException)
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

  const DISCORD_CHANNEL_VISUAL = 'div[aria-hidden="true"] > span, [class*="name__"][aria-hidden="true"] > div';
  const DISCORD_CHANNEL_TITLE = 'h1[class*="title__"], h2[class*="title__"]';
  const CHANNEL_CONTAINER_EXCLUDES = new Set(["nav", "header", '[role="navigation"]', '[role="heading"]', '[aria-hidden="true"]']);

  function channelNameInfo(element, context) {
    if (context?.id !== "discord" || !context.guildId || !context.root?.isConnected || !element?.closest) return null;
    if (context.root.contains(element)) return null;
    const row = element.closest('[data-list-item-id^="channels___"]');
    if (row) {
      if (!row.closest('nav, [role="navigation"], [data-list-id="channels"]')) return null;
      const link = row.matches("a[href]") ? row : row.querySelector("a[href]");
      if (!link) return null;
      let url;
      try { url = new URL(link.getAttribute("href"), element.ownerDocument.location.href); }
      catch { return null; }
      const route = /^\/channels\/(\d+)\/(\d+)\/?$/.exec(url.pathname);
      if (url.origin !== element.ownerDocument.location.origin || url.username || url.password
        || url.search || url.hash || !route || route[1] !== context.guildId
        || row.getAttribute("data-list-item-id") !== `channels___${route[2]}`) return null;
      const block = link.querySelector(DISCORD_CHANNEL_VISUAL);
      if (!block || !(element === row || element.contains(block) || block.contains(element))) return null;
      return { block, ariaHiddenException: block.parentElement };
    }
    const chat = context.root.closest('[class*="chat_"]');
    if (!chat || !chat.contains(element)) return null;
    const titles = [...chat.querySelectorAll(DISCORD_CHANNEL_TITLE)].filter((title) => (
      !context.root.contains(title) && title.closest('[class*="chat_"]') === chat
    ));
    if (titles.length !== 1) return null;
    const block = titles[0];
    if (element !== block && !element.contains(block) && !block.contains(element)) return null;
    return { block, ariaHiddenException: block.getAttribute("aria-hidden") === "true" ? block : null };
  }

  function channelNameBlockFor(element, context) {
    return channelNameInfo(element, context)?.block ?? null;
  }

  function channelNameTextAllowed(node, block, context, { restoring = false } = {}) {
    const info = channelNameInfo(block, context);
    if (!info || info.block !== block || !block.contains(node) || !node.isConnected) return false;
    if (!restoring && !isVisibleElement(context.root)) return false;
    for (let current = node.nodeType === 1 ? node : node.parentElement; current; current = current.parentElement) {
      if (context.channelNameExcludes.some((selector) => (
        !(restoring && ["[hidden]", "[inert]"].includes(selector)) && current.matches(selector)
      ))) return false;
      if (!restoring && current.getAttribute("aria-hidden") === "true" && current !== info.ariaHiddenException) return false;
      // Navigation/heading containers are allowed only around the verified
      // label, not as arbitrary descendants inside its text.
      if (current !== block && block.contains(current)
        && current.matches('nav, header, [role="navigation"], [role="heading"]')) return false;
    }
    return restoring || isVisibleElement(node.nodeType === 1 ? node : node.parentElement, undefined, info.ariaHiddenException);
  }

  function selectChannelNameBlocks(context, scope = context?.root?.ownerDocument) {
    if (!context?.guildId || !scope?.querySelectorAll) return [];
    const candidates = [...scope.querySelectorAll(`[data-list-item-id^="channels___"], ${DISCORD_CHANNEL_TITLE}`)];
    if (scope.nodeType === 1) candidates.unshift(scope);
    const blocks = new Set();
    for (const candidate of candidates) {
      const block = channelNameBlockFor(candidate, context);
      if (block && channelNameTextAllowed(block, block, context)) blocks.add(block);
    }
    return [...blocks];
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
    if (context?.guildId && channelNameBlockFor(element, context) === element) {
      return channelNameTextAllowed(element, element, context);
    }
    return Boolean(context?.root && element?.nodeType === 1 && element !== context.root
      && (!context.readingBlocks || context.readingBlocks.has(element))
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
    if (service?.reading) return readingDocumentContext(document, url, service);
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
          if (service.id === "discord") {
            // Server identity is local-only, like routeKey. DM recipients and
            // other servers' channel lists are never eligible channel names.
            context.guildId = /^\/channels\/(\d+)\/\d+(?:\/\d+)?\/?$/.exec(url.pathname)?.[1] ?? "";
            context.channelNameExcludes = [
              ...service.excludes.filter((item) => !CHANNEL_CONTAINER_EXCLUDES.has(item)),
              "dialog", '[role="dialog"]',
            ];
          }
          const first = firstMessageBlock(context, visibilityCache);
          // X Chat virtualizes rows: scrolling prepends/removes the first body
          // and can briefly empty the list. Only on an explicit conversation
          // route is the panel + scroller a stable identity without a message.
          // Public drawers / inbox routes keep the conservative body identity.
          const stableXPanel = service.id === "x"
            && /^\/(?:messages|i\/chat)\/[^/]+\/?$/.test(url.pathname)
            && root.matches(X_CHAT_ROOT) && !excludedInsideRoot(root, context)
            ? root.closest('[data-testid="dm-conversation-panel"]') : null;
          if (!first && !stableXPanel && !selectChannelNameBlocks(context).length) continue;
          context.identityNodes = stableXPanel ? [root, stableXPanel] : first ? [root, first] : [root];
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

  // A mail provider supplies only its explicit reading-pane boundaries. This
  // contract is independent of domains, wording, and the mail's HTML layout.
  // Resolve using metadata only; consent is checked by the caller before text.
  function readingDocumentContext(document, location, service) {
    const { reading } = service;
    const roots = [...document.querySelectorAll(reading.roots.join(","))]
      .filter(element => isVisibleElement(element) && !element.closest('[contenteditable],form,[role="textbox"],[role="search"]'));
    if (roots.length !== 1) return null;
    const root = roots[0];
    // A heading inside the selected reading document is content. Keeping the
    // messenger-wide heading exclusion here would reject semantic subjects.
    // The single-title/body whitelist still excludes unrelated UI headings.
    const excludes = service.excludes.filter(selector => selector !== '[role="heading"]');
    const context = { id: service.id, label: service.label, root,
      blocks: [reading.title, reading.body], excludes, protectedExcludes: excludes,
      routeKey: `${service.id}:${location.pathname}${location.hash}`, identityNodes: [] };
    const allowed = element => isVisibleElement(element) && !excludedInsideRoot(element, context);
    const bodies = [...root.querySelectorAll(reading.body)].filter(allowed);
    const titles = [...root.querySelectorAll(reading.title)]
      .filter(element => allowed(element) && !bodies.some(body => body.contains(element)));
    if (!bodies.length || titles.length !== 1) return null;
    context.readingBlocks = new Set([titles[0], ...bodies]);
    context.identityNodes = [root, titles[0]];
    return context;
  }

  globalThis.NudeNyangMessengerAdapters = Object.freeze({
    siteForLocation,
    privateSiteForLocation,
    canHostConversation,
    contextForDocument,
    readingDocumentContext,
    isVisibleElement,
    isEligibleMessageBlock,
    selectMessageBlocks,
    channelNameBlockFor,
    channelNameTextAllowed,
    selectChannelNameBlocks,
  });
})();
