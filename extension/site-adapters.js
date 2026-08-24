(function exposeSiteAdapters(root) {
  const COMMON_EXCLUDES = [
    "script", "style", "noscript", "svg", "canvas", "iframe",
    "input", "textarea", "select", "option", "button",
    "pre", "code", "kbd", "samp", "[contenteditable='true']",
    "[aria-hidden='true']", "[data-nudenyang-ignore]",
  ];

  const ADAPTERS = [
    {
      id: "github",
      hosts: ["github.com"],
      blocks: [
        ".markdown-body p", ".markdown-body li", ".markdown-body blockquote",
        ".markdown-body h1", ".markdown-body h2", ".markdown-body h3",
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
        "[class*='description'] p", "[class*='description'] li",
        "[class*='notice'] p",
      ],
      excludes: [
        "[class*='price']", "[class*='cart']", "[class*='checkout']",
        "[class~='order']", "[class^='order-']", "[class*=' order-']",
        "[class*='item-order']", "[data-testid*='order']", "form[action*='order']",
        "[class*='account']", "[class*='payment']",
      ],
    },
    {
      id: "x",
      hosts: ["x.com", "twitter.com"],
      blocks: [
        "article [data-testid='tweetText']", "article [data-testid='card.layoutLarge.detail']",
        "article [data-testid='card.layoutSmall.detail']",
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
        "#search h3", "#search [data-sncf]", "#search [data-content-feature]",
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
        "ytd-text-inline-expander #expanded", "ytd-comment-thread-renderer #content-text",
        "ytd-transcript-segment-renderer .segment-text", "ytd-video-renderer #video-title",
        "ytd-rich-grid-media #video-title", "ytd-compact-video-renderer #video-title",
      ],
      excludes: [
        "#search-form", "ytd-comment-simplebox-renderer", "#channel-name",
        "#author-text", "yt-formatted-string.ytd-channel-name", "#upload-info",
      ],
      blockedPaths: ["/upload", "/studio"],
    },
  ];

  function adapterForLocation(locationLike) {
    const host = String(locationLike?.hostname ?? "").toLowerCase();
    const path = String(locationLike?.pathname ?? "/");
    return ADAPTERS.find((adapter) =>
      (adapter.hosts.includes(host) || (adapter.id === "booth" && host.endsWith(".booth.pm")))
      && !(adapter.blockedPaths ?? []).some((prefix) => path.startsWith(prefix))
    ) ?? null;
  }

  function exclusionSelector(adapter) {
    return [...COMMON_EXCLUDES, ...(adapter?.excludes ?? [])].join(",");
  }

  const api = Object.freeze({ ADAPTERS, adapterForLocation, exclusionSelector });
  root.NudeNyangSiteAdapters = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(globalThis);
