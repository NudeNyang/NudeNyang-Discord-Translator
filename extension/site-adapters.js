(function exposeSiteAdapters(root) {
  const COMMON_EXCLUDES = [
    "script", "style", "noscript", "svg", "canvas", "iframe",
    "input", "textarea", "select", "option", "button", "form", "label",
    "pre", "code", "kbd", "samp", "[contenteditable]",
    "nav", "header", "footer", "aside",
    "[role='navigation']", "[role='search']", "[role='textbox']",
    "[role='button']", "[role='menu']", "[role='menubar']", "[role='toolbar']",
    "[role='dialog']", "[role='alertdialog']", "[role='alert']", "[role='status']",
    "[aria-live]", "[aria-modal='true']", "[aria-hidden='true']",
    "[translate='no']", ".notranslate", "[data-nudenyang-ignore]",
    "[class~='price']", "[class^='price-']", "[class*=' price-']",
    "[data-price]", "[itemprop='price']",
    "[class*='cookie']", "[id*='cookie']", "[class*='consent']", "[id*='consent']",
  ];

  const UNIVERSAL_BLOCKED_PATH_SEGMENTS = new Set([
    "account", "accounts", "admin", "billing", "cart", "checkout", "compose",
    "dashboard", "dm", "dms", "inbox", "login", "log-in", "logout", "log-out",
    "mail", "message", "messages", "order", "orders", "payment", "payments",
    "register", "settings", "signin", "sign-in", "signup", "sign-up", "wallet",
  ]);

  const UNIVERSAL_BLOCKED_HOSTS = new Set([
    "discord.com", "ptb.discord.com", "canary.discord.com",
    "mail.google.com", "messages.google.com", "app.slack.com",
    "teams.microsoft.com", "web.whatsapp.com", "web.telegram.org",
    "messenger.com", "www.messenger.com", "outlook.live.com", "outlook.office.com",
  ]);

  const ADAPTERS = [
    {
      id: "dlsite-report",
      hosts: ["www.dlsite.com"],
      pathPattern: /^\/[^/]+\/circle\/report(?:\/|$)/u,
      blocks: [
        "article.circle_report .work_name",
        "article.circle_report .catchphrase",
        "article.circle_report .report_info .label",
        "article.circle_report .report_info .content",
        "article.circle_report .report_title",
        "article.circle_report .report_section .content",
        "article.circle_report .btn_report.type_cart",
        "#left .left_module h3",
        "#left .list_head h4",
        "#left .list_content_text_item > a",
        "#left .list_text_indent > a",
        "#left .link_list_item > a",
        "#footer .floor_list_item > a",
        "#footer .label",
        "#footer .link_list_item > a",
        "#footer .img_list_text",
        "#footer .footer_sns_item > a",
        "#footer .recruit a",
        "#footer #system",
      ],
      excludes: [],
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
      blocks: [
        "main p", "main li", "main h1", "main h2", "main h3",
        "main h4", "main h5", "main h6", "main blockquote", "main figcaption",
        "main dt", "main dd",
        "main :is(div,section,span,a,b,strong,small,th,td):not(:has(*:not(br)))",
        "[class*='description'] p", "[class*='description'] li",
        "[class~='description'] > span.autolink",
        ".booth-description > .autolink > div",
        "nav.js-accordion-content a.no-underline[href^='https://booth.pm/']",
        ".js-agreement-banner .text-white.text-14.font-bold",
        ".js-agreement-banner a[href^='https://booth.pm/']",
        ".booth-message > a[href^='https://booth.pm/announcements/']",
        "details.booth-messages > summary",
        "details.booth-messages .booth-message > a[href^='https://booth.pm/announcements/']",
        "a[href*='/downloadables/'] [class~='text-ellipsis']",
        ".cart-button-wrap [class~='text-left'][class~='mb-8']",
        "[class*='notice'] p",
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
        "article [data-testid='tweetText']", "article [data-testid='card.layoutLarge.detail']",
        "article [data-testid='card.layoutSmall.detail']", "[data-testid='UserDescription']",
      ],
      excludes: [
        "[data-testid='tweetTextarea_0']", "[data-testid='DMDrawer']",
        "[data-testid='UserName']", "a[href^='/hashtag/']",
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
    blocks: [
      "body h1", "body h2", "body h3", "body h4", "body h5", "body h6",
      "body p", "body li", "body blockquote", "body figcaption", "body dt", "body dd",
      "body details > summary", "body table th", "body table td",
    ],
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
      && !pathSegments(locationLike).some((segment) => UNIVERSAL_BLOCKED_PATH_SEGMENTS.has(segment));
  }

  function adapterForLocation(locationLike) {
    const host = String(locationLike?.hostname ?? "").toLowerCase();
    const path = String(locationLike?.pathname ?? "/");
    const specific = ADAPTERS.find((adapter) => (
      isSpecificHost(adapter, host)
      && (!adapter.pathPattern || adapter.pathPattern.test(path))
    ));
    if (specific) {
      return (specific.blockedPaths ?? []).some((prefix) => path.startsWith(prefix)) ? null : specific;
    }
    return isUniversalLocationAllowed(locationLike, host) ? UNIVERSAL_ADAPTER : null;
  }

  function exclusionSelector(adapter) {
    return [...COMMON_EXCLUDES, ...(adapter?.excludes ?? [])].join(",");
  }

  const api = Object.freeze({ ADAPTERS, UNIVERSAL_ADAPTER, adapterForLocation, exclusionSelector });
  root.NudeNyangSiteAdapters = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(globalThis);
