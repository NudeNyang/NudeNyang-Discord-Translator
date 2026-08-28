(function exposeSiteAdapters(root) {
  // These are never bypassed, including by public navigation and modal adapters.
  const PROTECTED_EXCLUDES = [
    "script", "style", "noscript", "svg", "canvas", "iframe",
    "input", "textarea", "select", "option", "[role='textbox']",
    "pre", "code", "kbd", "samp", "[contenteditable]",
    "[hidden]", "[inert]", "[aria-hidden='true']",
    "[translate='no']", ".notranslate", "[data-nudenyang-ignore]",
    "[data-price]", "[itemprop='price']",
    "address", "output", "[data-sensitive]", "[rel~='author']",
    "[itemprop~='author']", "[itemprop~='creator']", "[itemprop~='email']", "[itemprop~='telephone']",
    "[itemprop~='identifier']", "[itemprop~='orderNumber']", "[itemprop~='paymentAccountId']",
    "[itemprop~='streetAddress']", "[itemprop~='postalCode']",
    "[itemtype$='/Person']", "[itemtype$='/PostalAddress']",
  ];

  const COMMON_EXCLUDES = [
    ...PROTECTED_EXCLUDES,
    "[class~='price']", "[class^='price-']", "[class*=' price-']",
    "button", "form", "label",
    "nav", "header", "footer", "aside",
    "[role='navigation']", "[role='search']", "[role='textbox']",
    "[role='button']", "[role='menu']", "[role='menubar']", "[role='toolbar']",
    "[role='dialog']", "[role='alertdialog']", "[role='alert']", "[role='status']",
    "[aria-live]", "[aria-modal='true']",
  ];

  const UNIVERSAL_BLOCKED_PATH_SEGMENTS = new Set([
    "account", "accounts", "admin", "billing", "cart", "checkout", "compose",
    "dashboard", "direct", "dm", "dms", "inbox", "login", "log-in", "logout", "log-out",
    "mail", "message", "messages", "mypage", "order", "orders", "payment", "payments",
    "register", "settings", "signin", "sign-in", "signup", "sign-up", "wallet",
  ]);

  const UNIVERSAL_BLOCKED_HOSTS = new Set([
    "discord.com", "ptb.discord.com", "canary.discord.com",
    "mail.google.com", "messages.google.com", "app.slack.com",
    "teams.microsoft.com", "web.whatsapp.com", "web.telegram.org",
    "messenger.com", "www.messenger.com", "outlook.live.com", "outlook.office.com", "outlook.office365.com",
  ]);

  const PRIVATE_PATH_SEGMENTS = new Set(["compose", "direct", "dm", "dms", "inbox", "mail", "message", "messages"]);

  function routeSegments(path) {
    const segments = String(path).split(/[/?&=]+/u).filter(Boolean).map(segment => {
      try { return decodeURIComponent(segment).toLowerCase(); } catch { return segment.toLowerCase(); }
    });
    // A language prefix is routing metadata, not the page's semantic scope.
    if (/^[a-z]{2}(?:-[a-z]{2})?$/u.test(segments[0] ?? "") && segments.length > 1) segments.shift();
    return segments;
  }

  function staticUiLocation(locationLike) {
    const publicSections = new Set(["help", "docs", "guide", "reference", "news", "articles"]);
    const restricted = route => {
      const parts = routeSegments(route);
      return !publicSections.has(parts[0]) && parts.some(part => UNIVERSAL_BLOCKED_PATH_SEGMENTS.has(part));
    };
    const hash = String(locationLike?.hash ?? "");
    return restricted(locationLike?.pathname)
      || (/^#!?\//u.test(hash) && restricted(hash.replace(/^#!/u, "").replace(/^#/u, "")));
  }

  const X_TWEET_BLOCKS = [
    "article [data-testid='tweetText']",
    "article [data-testid='card.layoutLarge.detail']",
    "article [data-testid='card.layoutSmall.detail']",
  ];

  const X_ARTICLE_BLOCKS = [
    "article [data-testid='card.wrapper'] [dir='auto']",
    // Newer X article previews use a semantic link container without card.wrapper.
    "article [role='link'] [dir='auto']",
    "[data-testid='twitterArticleReadView'] [data-testid='twitter-article-title']",
    "[data-testid='twitterArticleReadView'] .longform-header-one",
    "[data-testid='twitterArticleReadView'] .longform-header-one-narrow",
    "[data-testid='twitterArticleReadView'] .longform-header-two",
    "[data-testid='twitterArticleReadView'] .longform-header-two-narrow",
    "[data-testid='twitterArticleReadView'] .longform-unstyled",
    "[data-testid='twitterArticleReadView'] .longform-unstyled-narrow",
    "[data-testid='twitterArticleReadView'] .longform-blockquote",
    "[data-testid='twitterArticleReadView'] .longform-blockquote-narrow",
    "[data-testid='twitterArticleReadView'] .longform-unordered-list-item",
    "[data-testid='twitterArticleReadView'] .longform-unordered-list-item-narrow",
    "[data-testid='twitterArticleReadView'] .longform-ordered-list-item",
    "[data-testid='twitterArticleReadView'] .longform-ordered-list-item-narrow",
    "[data-testid='twitterArticleReadView'] section[data-block='true']",
  ];

  const DOCUMENT_BLOCKS = [
    "body h1", "body h2", "body h3", "body h4", "body h5", "body h6",
    "body p", "body li", "body blockquote", "body figcaption", "body dt", "body dd",
    "body details > summary", "body table th", "body table td",
  ];

  // Layout-only prose is discovered by the shared DOM policy. This avoids
  // guessing content IDs, expensive descendant :has() selectors, and missing direct
  // text around nested paragraphs. Each text node still belongs to one block.
  const PUBLIC_DOCUMENT_BLOCKS = DOCUMENT_BLOCKS;

  const TAKARA_PUBLIC_UI_BLOCKS = [
    "header.l-header a[href]", "header.l-header button", "header.l-header label",
    ".ul_Navi01 a[href]", ".ul_Navi01 .naviBtn", ".ul_Navi01 .tit",
    ".c-tab-group .c-tab-buttons button[role='tab']",
    "#search_cond p", "#search_cond label", "#search_cond button",
    "#SS_searchForm label", "#SS_searchForm button",
    "footer.l-footer a[href]", "footer.l-footer p", "footer.l-footer h2",
    "footer.l-footer h3", "footer.l-footer h4",
    // The shared footer uses accordion buttons as its visible sitemap headings.
    "footer.l-footer button.l-footer-sitemap__trigger",
  ];

  const EISYS_PUBLIC_NAVIGATION_BLOCKS = [
    "nav.header_navi a[href^='https://www.eisys.co.jp/']",
    "footer.l-footer .footer_sitemap a[href]",
    "footer.l-footer .corp_navi a[href]",
    "footer.l-footer .footer_parent_text",
    "footer.l-footer .corp_support",
  ];

  const SHOPRO_ANIME_PUBLIC_NAVIGATION_BLOCKS = [
    "header .headerWrap .menu > ul > li > a[href]",
  ];

  const DLSITE_PRIVATE_LINK_FILTERS = [
    ":not([href*='/mypage'])",
    ":not([href*='/cart'])",
    ":not([href*='/checkout'])",
    ":not([href*='/order'])",
    ":not([href*='/payment'])",
    ":not([href*='/login'])",
    ":not([href*='/account'])",
    ":not([href*='/favorite'])",
    ":not([href*='/wishlist'])",
    ":not([href*='/coupon'])",
    ":not([href*='/history'])",
  ].join("");

  const DLSITE_PUBLIC_NAVIGATION_LINKS = [
    "#header a[href]",
    "header a[href]",
    "nav a[href]",
    "#left a[href]",
  ].map((selector) => `${selector}${DLSITE_PRIVATE_LINK_FILTERS}`);

  const DLSITE_STATIC_HEADER_LABELS = [
    "#header .header_description",
    "#header .login_information_item.type_point > .coupon_text",
    "#header .login_information_item.type_coupon > .coupon_text",
    "#header .header_dropdown_nav.type_language .header_dropdown_nav_Link",
    "#header .header_dropdown_nav.type_service .header_dropdown_nav_Link",
    "#header .globalNav > .globalNav-item.type-favorite > a > i",
    "#header .globalNav > .globalNav-item.type-cart > a > i",
    "#header .globalNav > .globalNav-item.type-play > a > i",
    "#header .globalNav > .globalNav-item.type-circle > a > i",
    "#header .globalNav > .globalNav-item.type-guide > a > i",
  ];

  // Public report pages share the same account-value protection as other
  // DLsite documents; using the generic collector must not widen that boundary.
  const DLSITE_PROTECTED_EXCLUDES = ["#header .login_information .number"];

  const ADAPTERS = [
    {
      id: "dlsite-report",
      hosts: ["www.dlsite.com"],
      pathPattern: /^\/[^/]+\/circle\/report(?:\/|$)/u,
      blockUniversalSensitivePaths: true,
      collectLayoutText: true,
      blocks: PUBLIC_DOCUMENT_BLOCKS,
      excludes: DLSITE_PROTECTED_EXCLUDES,
    },
    {
      id: "dlsite",
      hosts: ["www.dlsite.com"],
      blockUniversalSensitivePaths: true,
      collectLayoutText: true,
      blocks: [
        ...PUBLIC_DOCUMENT_BLOCKS,
        ...DLSITE_PUBLIC_NAVIGATION_LINKS,
        ...DLSITE_STATIC_HEADER_LABELS,
      ],
      excludes: DLSITE_PROTECTED_EXCLUDES,
      exclusionBypassBlocks: [
        ...DLSITE_PUBLIC_NAVIGATION_LINKS,
        ...DLSITE_STATIC_HEADER_LABELS,
      ],
    },
    {
      id: "eisys",
      hosts: ["www.eisys.co.jp", "eisys.co.jp"],
      collectLayoutText: true,
      blocks: [
        ...PUBLIC_DOCUMENT_BLOCKS,
        ...EISYS_PUBLIC_NAVIGATION_BLOCKS,
      ],
      excludes: [],
      exclusionBypassBlocks: EISYS_PUBLIC_NAVIGATION_BLOCKS,
    },
    {
      id: "takaratomy",
      hosts: ["www.takaratomy.co.jp", "takaratomy.co.jp", "dm.takaratomy.co.jp"],
      blockUniversalSensitivePaths: true,
      collectLayoutText: true,
      blocks: [...PUBLIC_DOCUMENT_BLOCKS, ...TAKARA_PUBLIC_UI_BLOCKS],
      publicUiBlocks: TAKARA_PUBLIC_UI_BLOCKS,
      publicForms: ["#search_cond", "#SS_searchForm"],
      excludes: [],
    },
    {
      id: "shopro-anime",
      hosts: ["www.shopro.co.jp"],
      pathPattern: /^\/anime(?:\/|$)/u,
      blockUniversalSensitivePaths: true,
      // Preserve the generic page's opt-in policy while recognizing its public menu.
      manualOnly: true,
      collectLayoutText: true,
      blocks: [...PUBLIC_DOCUMENT_BLOCKS, ...SHOPRO_ANIME_PUBLIC_NAVIGATION_BLOCKS],
      publicUiBlocks: SHOPRO_ANIME_PUBLIC_NAVIGATION_BLOCKS,
      excludes: ["button", "[role='button']"],
    },
    {
      id: "github",
      hosts: ["github.com"],
      blocks: [
        ".markdown-body p", ".markdown-body li", ".markdown-body blockquote",
        ".markdown-body h1", ".markdown-body h2", ".markdown-body h3",
        ".markdown-body h4", ".markdown-body h5", ".markdown-body h6",
        ".markdown-body details > summary", ".markdown-body dt", ".markdown-body dd",
        ".markdown-body figcaption",
        ".markdown-body table th", ".markdown-body table td",
        ".comment-body p", ".comment-body li", "[data-testid='issue-body'] p",
        "[data-testid='issue-body'] li", ".Box-body .markdown-title",
      ],
      excludes: [
        ".blob-code", ".blob-num", ".diff-table", ".react-code-text",
        ".commit-sha", ".file-info", ".js-file-line-container",
      ],
    },
    {
      id: "booth",
      hosts: ["booth.pm"],
      collectLayoutText: true,
      blocks: [
        ...PUBLIC_DOCUMENT_BLOCKS,
        "nav.js-accordion-content a.no-underline[href^='https://booth.pm/']",
        ".js-agreement-banner .text-white.text-14.font-bold",
        ".js-agreement-banner a[href^='https://booth.pm/']",
        ".booth-message > a[href^='https://booth.pm/announcements/']",
        "details.booth-messages .booth-message > a[href^='https://booth.pm/announcements/']",
        "a[href*='/downloadables/'] [class~='text-ellipsis']",
        ".cart-button-wrap [class~='text-left'][class~='mb-8']",
      ],
      excludes: [
        "[class*='price']", "[class*='checkout']",
        "[data-testid*='cart']", "form[action*='cart']", "a[href*='/cart']",
        "[class~='order']", "[class^='order-']", "[class*=' order-']",
        "[class*='item-order']", "[data-testid*='order']", "form[action*='order']",
        "[class*='account']", "[class*='payment']",
      ],
      exclusionBypassBlocks: [
        "nav.js-accordion-content a.no-underline[href^='https://booth.pm/']",
        ".js-agreement-banner .text-white.text-14.font-bold",
        ".js-agreement-banner a[href^='https://booth.pm/']",
      ],
    },
    {
      id: "x",
      hosts: ["x.com", "twitter.com"],
      blocks: [
        ...X_TWEET_BLOCKS,
        "[data-testid='UserDescription']",
        ...X_ARTICLE_BLOCKS,
      ],
      excludes: [
        "[data-testid='tweetTextarea_0']", "[data-testid='DMDrawer']",
        "[data-testid='UserName']", "a[href^='/hashtag/']",
      ],
      exclusionBypassBlocks: [
        ...X_TWEET_BLOCKS,
        ...X_ARTICLE_BLOCKS,
      ],
      blockedPaths: ["/messages", "/compose"],
    },
    {
      id: "google",
      hosts: ["www.google.com", "www.google.co.kr", "www.google.co.jp"],
      blocks: [
        "#search h1", "#search h2", "#search h3", "#search h4",
        "#search [role='heading']", "#search [data-sncf]", "#search [data-content-feature]",
        "#search .VwiC3b", "#search .IsZvec", "#search .kno-rdesc span",
        "#search [data-attrid='wa:/description']", "#search [data-md] span",
      ],
      excludes: [
        "form", "[role='search']", "[data-ogsr-up]", "[aria-label*='Account']",
        "[aria-label*='계정']",
      ],
    },
    {
      id: "youtube",
      hosts: ["www.youtube.com"],
      blocks: [
        "ytd-watch-metadata h1", "ytd-text-inline-expander #plain-snippet-text",
        "ytd-text-inline-expander #expanded", "ytd-text-inline-expander #attributed-snippet-text",
        "ytd-comment-thread-renderer #content-text",
        "ytd-transcript-segment-renderer .segment-text", "ytd-video-renderer #video-title",
        "ytd-rich-grid-media #video-title", "ytd-compact-video-renderer #video-title",
        ".ytLockupMetadataViewModelTitle", "ytd-media-lockup-renderer #title",
      ],
      excludes: [
        "#search-form", "ytd-comment-simplebox-renderer", "#channel-name",
        "#author-text", "yt-formatted-string.ytd-channel-name", "#upload-info",
      ],
      blockedPaths: ["/upload", "/studio"],
    },
  ];

  const UNIVERSAL_ADAPTER = Object.freeze({
    id: "web",
    manualOnly: true,
    collectLayoutText: true,
    collectPublicUi: true,
    collectReadOnlyUi: true,
    blocks: PUBLIC_DOCUMENT_BLOCKS,
    excludes: [],
  });

  function isSpecificHost(adapter, host) {
    return adapter.hosts.includes(host) || (adapter.id === "booth" && host.endsWith(".booth.pm"));
  }

  function pathSegments(locationLike) {
    const pathAndHash = `${locationLike?.pathname ?? "/"}/${locationLike?.hash ?? ""}`;
    return pathAndHash.split(/[\/#?&=]+/u).map((segment) => {
      try {
        return decodeURIComponent(segment).toLowerCase();
      } catch {
        return segment.toLowerCase();
      }
    }).filter(Boolean);
  }

  function isUniversalLocationAllowed(locationLike, host) {
    const protocol = String(locationLike?.protocol ?? "").toLowerCase();
    return (protocol === "http:" || protocol === "https:")
      && !UNIVERSAL_BLOCKED_HOSTS.has(host)
      && !pathSegments(locationLike).some((segment) => PRIVATE_PATH_SEGMENTS.has(segment));
  }

  function adapterForLocation(locationLike) {
    const host = String(locationLike?.hostname ?? "").toLowerCase();
    const path = String(locationLike?.pathname ?? "/");
    const specific = ADAPTERS.find((adapter) => (
      isSpecificHost(adapter, host)
      && (!adapter.pathPattern || adapter.pathPattern.test(path))
    ));
    if (specific) {
      const blockedByPrefix = (specific.blockedPaths ?? []).some((prefix) => path.startsWith(prefix));
      const blockedBySensitiveSegment = specific.blockUniversalSensitivePaths
        && pathSegments(locationLike).some((segment) => UNIVERSAL_BLOCKED_PATH_SEGMENTS.has(segment));
      if (blockedByPrefix || pathSegments(locationLike).some(segment => PRIVATE_PATH_SEGMENTS.has(segment))) return null;
      return { ...specific, collectReadOnlyUi: true, staticUiOnly: blockedBySensitiveSegment || staticUiLocation(locationLike) };
    }
    return isUniversalLocationAllowed(locationLike, host)
      ? (staticUiLocation(locationLike) ? { ...UNIVERSAL_ADAPTER, staticUiOnly: true } : UNIVERSAL_ADAPTER) : null;
  }

  const RESTORABLE_EXCLUDES = new Set(["[hidden]", "[inert]", "[aria-hidden='true']"]);

  function exclusionSelector(adapter, { restoring = false } = {}) {
    return [...COMMON_EXCLUDES, ...(adapter?.excludes ?? [])]
      .filter(selector => !restoring || !RESTORABLE_EXCLUDES.has(selector)).join(",");
  }

  function isPublicNavigationUrl(href, base) {
    try {
      const url = new URL(href, base);
      // An account link can display the user's name, not a static menu label.
      // Opening that screen's read-only UI does not make identity links public.
      return isUniversalLocationAllowed(url, url.hostname.toLowerCase())
        && !pathSegments(url).some(segment => UNIVERSAL_BLOCKED_PATH_SEGMENTS.has(segment));
    } catch {
      return false;
    }
  }

  function protectedExclusionSelector(adapter, { restoring = false } = {}) {
    return [...PROTECTED_EXCLUDES, ...(adapter?.excludes ?? [])]
      .filter(selector => !restoring || !RESTORABLE_EXCLUDES.has(selector)).join(",");
  }

  const api = Object.freeze({
    ADAPTERS, UNIVERSAL_ADAPTER, adapterForLocation, exclusionSelector, protectedExclusionSelector,
    isPublicNavigationUrl,
  });
  root.NudeNyangSiteAdapters = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(globalThis);
