import { LANDING_LOCALES, LANGUAGE_OPTIONS, RTL_LOCALES } from "./locales.generated.mjs";
import { buildGreetingCycle } from "./greetings.mjs";
import { detectPreferredLocale, normalizeLocale } from "./locale-utils.mjs";
import { pageScrollThumbMetrics, pageScrollTopFromPointer } from "./scrollbar-utils.mjs";

const root = document.documentElement;
const themeButton = document.querySelector(".theme-toggle");
const themeMeta = document.querySelector('meta[name="theme-color"]');
const menuButton = document.querySelector(".menu-toggle");
const menu = document.querySelector("#primary-menu");
const languagePicker = document.querySelector(".language-picker");
const languageTrigger = document.querySelector(".language-trigger");
const languageTriggerLabel = document.querySelector(".language-trigger-label");
const languagePopover = document.querySelector("#language-popover");
const languageSearch = document.querySelector("#language-search");
const languageOptions = document.querySelector(".language-options");
const languageEmpty = document.querySelector(".language-empty");
const supportedLanguageGrid = document.querySelector(".supported-language-grid");
const heroVideo = document.querySelector("[data-hero-video]");
const workflowVideo = document.querySelector("[data-scroll-autoplay]");
const featureGreetings = document.querySelector("[data-feature-greetings]");
const pageScrollIndicator = document.querySelector("[data-page-scroll-indicator]");
const pageScrollThumb = pageScrollIndicator?.querySelector(".page-scroll-indicator-thumb");
const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
const reduceMotionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
const finePointerPreference = window.matchMedia("(hover: hover) and (pointer: fine) and (min-width: 721px)");
const translationNodes = [...document.querySelectorAll("[data-i18n]")];
const placeholderNodes = [...document.querySelectorAll("[data-i18n-placeholder]")];
const PAGE_SCROLL_REVEAL_DISTANCE = 42;
const PAGE_SCROLL_IDLE_DELAY = 700;
function updateGreetingLocale(locale) {
  if (!featureGreetings) return;
  const greetings = buildGreetingCycle(locale);
  featureGreetings.replaceChildren(
    ...greetings.map((greeting, index) => {
      const node = document.createElement("span");
      node.className = `feature-greeting${index === 0 ? " is-selected" : ""}`;
      node.textContent = greeting.text;
      node.lang = greeting.locale;
      node.dir = "auto";
      node.style.setProperty("--greeting-index", index);
      return node;
    }),
  );
}

function bindPageScrollIndicator() {
  if (!pageScrollIndicator || !pageScrollThumb) return;

  let draggingPointer = null;
  let scrollIdleTimer = 0;
  let updateFrame = 0;

  const updateIndicator = () => {
    updateFrame = 0;
    if (!finePointerPreference.matches) {
      clearTimeout(scrollIdleTimer);
      scrollIdleTimer = 0;
      pageScrollIndicator.classList.remove("is-scrollable", "is-scroll-near", "is-scroll-active", "is-dragging");
      return;
    }

    const metrics = pageScrollThumbMetrics(
      pageScrollIndicator.clientHeight,
      window.innerHeight,
      root.scrollHeight,
      window.scrollY || root.scrollTop,
    );
    pageScrollIndicator.classList.toggle("is-scrollable", metrics.scrollable);
    pageScrollThumb.style.height = `${metrics.height}px`;
    pageScrollThumb.style.transform = `translate3d(0, ${metrics.top}px, 0)`;
    if (!metrics.scrollable) {
      pageScrollIndicator.classList.remove("is-scroll-near", "is-scroll-active", "is-dragging");
    }
  };

  const requestIndicatorUpdate = () => {
    if (updateFrame) return;
    updateFrame = window.requestAnimationFrame(updateIndicator);
  };

  const showIndicatorWhileScrolling = () => {
    requestIndicatorUpdate();
    if (!finePointerPreference.matches) return;
    pageScrollIndicator.classList.add("is-scroll-active");
    clearTimeout(scrollIdleTimer);
    scrollIdleTimer = window.setTimeout(() => {
      scrollIdleTimer = 0;
      pageScrollIndicator.classList.remove("is-scroll-active");
    }, PAGE_SCROLL_IDLE_DELAY);
  };

  const scrollToPointer = (clientY) => {
    const track = pageScrollIndicator.getBoundingClientRect();
    const thumbHeight = pageScrollThumb.getBoundingClientRect().height;
    const maxScroll = Math.max(0, root.scrollHeight - window.innerHeight);
    window.scrollTo({
      top: pageScrollTopFromPointer(clientY, track.top, track.height, thumbHeight, maxScroll),
    });
  };

  const finishDrag = (event) => {
    if (draggingPointer !== event.pointerId) return;
    draggingPointer = null;
    pageScrollIndicator.classList.remove("is-dragging");
    if (pageScrollIndicator.hasPointerCapture(event.pointerId)) {
      pageScrollIndicator.releasePointerCapture(event.pointerId);
    }
    pageScrollIndicator.classList.toggle(
      "is-scroll-near",
      window.innerWidth - event.clientX <= PAGE_SCROLL_REVEAL_DISTANCE,
    );
  };

  document.addEventListener("pointermove", (event) => {
    if (draggingPointer !== null) return;
    const isNear = event.pointerType === "mouse"
      && window.innerWidth - event.clientX <= PAGE_SCROLL_REVEAL_DISTANCE;
    pageScrollIndicator.classList.toggle("is-scroll-near", isNear);
  });
  document.addEventListener("wheel", showIndicatorWhileScrolling, { passive: true });
  document.addEventListener("scroll", showIndicatorWhileScrolling, { passive: true });
  window.addEventListener("resize", requestIndicatorUpdate);
  finePointerPreference.addEventListener("change", requestIndicatorUpdate);

  pageScrollIndicator.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !pageScrollIndicator.classList.contains("is-scrollable")) return;
    draggingPointer = event.pointerId;
    pageScrollIndicator.classList.add("is-scroll-near", "is-dragging");
    pageScrollIndicator.setPointerCapture(event.pointerId);
    scrollToPointer(event.clientY);
    event.preventDefault();
  });
  pageScrollIndicator.addEventListener("pointermove", (event) => {
    if (draggingPointer === event.pointerId) scrollToPointer(event.clientY);
  });
  pageScrollIndicator.addEventListener("pointerup", finishDrag);
  pageScrollIndicator.addEventListener("pointercancel", finishDrag);
  pageScrollIndicator.addEventListener("wheel", (event) => {
    if (!pageScrollIndicator.classList.contains("is-scrollable")) return;
    window.scrollBy({ top: event.deltaY });
    event.preventDefault();
  }, { passive: false });

  if ("ResizeObserver" in window) {
    new ResizeObserver(requestIndicatorUpdate).observe(document.body);
  }
  requestIndicatorUpdate();
}

function syncHeroVideoPlayback() {
  if (!heroVideo) return;
  if (reduceMotionPreference.matches || document.hidden) {
    heroVideo.pause();
    return;
  }

  heroVideo.muted = true;
  heroVideo.play().catch(() => {});
}

async function toggleWorkflowVideoPlayback() {
  if (!workflowVideo) return;

  if (workflowVideo.paused) {
    try {
      workflowVideo.muted = true;
      await workflowVideo.play();
      workflowVideo.dataset.autoplayState = "playing";
    } catch {
      workflowVideo.dataset.autoplayState = "manual";
    }
    return;
  }

  workflowVideo.pause();
  workflowVideo.dataset.autoplayState = "paused";
}

function bindWorkflowVideoPlayback() {
  if (!workflowVideo) return;

  workflowVideo.addEventListener("click", toggleWorkflowVideoPlayback);
  workflowVideo.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggleWorkflowVideoPlayback();
  });

  if (!("IntersectionObserver" in window)) {
    workflowVideo.dataset.autoplayState = "manual";
    return;
  }

  let playTimer = 0;
  const cancelScheduledPlay = () => {
    if (!playTimer) return;
    window.clearTimeout(playTimer);
    playTimer = 0;
    workflowVideo.dataset.autoplayState = "idle";
  };

  const observer = new IntersectionObserver(
    ([entry]) => {
      if (!entry.isIntersecting || entry.intersectionRatio < 0.12 || reduceMotionPreference.matches) {
        cancelScheduledPlay();
        return;
      }

      if (playTimer || workflowVideo.dataset.autoplayState === "playing") return;
      workflowVideo.dataset.autoplayState = "waiting";
      playTimer = window.setTimeout(async () => {
        playTimer = 0;
        try {
          workflowVideo.muted = true;
          await workflowVideo.play();
          workflowVideo.dataset.autoplayState = "playing";
          observer.unobserve(workflowVideo);
        } catch {
          workflowVideo.dataset.autoplayState = "manual";
        }
      }, 300);
    },
    { threshold: [0, 0.12], rootMargin: "0px 0px -20% 0px" },
  );

  reduceMotionPreference.addEventListener("change", () => {
    if (!reduceMotionPreference.matches) return;
    cancelScheduledPlay();
    workflowVideo.pause();
    workflowVideo.dataset.autoplayState = "manual";
  });

  observer.observe(workflowVideo);
}

translationNodes.forEach((node) => {
  node.dataset.i18nSource = node.textContent.trim();
});

function initialLocale() {
  const saved = normalizeLocale(window.localStorage.getItem("landing-locale"));
  if (saved) return saved;
  const browserLocales = [
    ...(navigator.languages || []),
    navigator.language,
    Intl.DateTimeFormat().resolvedOptions().locale,
  ].filter(Boolean);
  return detectPreferredLocale(browserLocales);
}

let currentLocale = initialLocale();

function translate(source, locale = currentLocale) {
  return LANDING_LOCALES[locale]?.[source] || LANDING_LOCALES.ko[source] || source;
}

function resolvedTheme() {
  return root.dataset.theme || (systemTheme.matches ? "dark" : "light");
}

function updateThemeControl() {
  const isDark = resolvedTheme() === "dark";
  themeButton.textContent = translate(isDark ? "밝게" : "어둡게");
  themeButton.setAttribute("aria-label", translate(isDark ? "밝은 테마로 전환" : "어두운 테마로 전환"));
  themeMeta.setAttribute("content", isDark ? "#08141d" : "#f1f6fa");
}

function applyTheme(theme) {
  root.dataset.theme = theme;
  window.localStorage.setItem("landing-theme", theme);
  updateThemeControl();
}

function closeLanguagePicker() {
  languagePopover.hidden = true;
  languageTrigger.setAttribute("aria-expanded", "false");
}

function renderLanguageOptions(filter = "") {
  const query = filter.trim().toLocaleLowerCase();
  const filtered = LANGUAGE_OPTIONS.filter(([code, label, compact, english]) =>
    [code, label, compact, english].some((value) => value.toLocaleLowerCase().includes(query)),
  );

  languageOptions.replaceChildren(
    ...filtered.map(([code, label]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "language-option";
      button.dataset.locale = code;
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(code === currentLocale));
      button.textContent = label;
      return button;
    }),
  );
  languageEmpty.hidden = filtered.length !== 0;
}

function renderSupportedLanguages() {
  supportedLanguageGrid.replaceChildren(
    ...LANGUAGE_OPTIONS.map(([code, label, , english]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "supported-language-button";
      button.dataset.locale = code;
      button.setAttribute("aria-label", `${label}, ${english}`);
      const labelNode = document.createElement("span");
      labelNode.textContent = label;
      button.append(labelNode);
      return button;
    }),
  );
}

function updateSupportedLanguageSelection() {
  supportedLanguageGrid.querySelectorAll(".supported-language-button").forEach((button) => {
    const isCurrent = button.dataset.locale === currentLocale;
    button.classList.toggle("is-active", isCurrent);
    button.setAttribute("aria-pressed", String(isCurrent));
  });
}

function applyLocale(locale, { persist = true } = {}) {
  currentLocale = normalizeLocale(locale) || "ko";
  root.lang = currentLocale;
  root.dir = RTL_LOCALES.includes(currentLocale) ? "rtl" : "ltr";

  translationNodes.forEach((node) => {
    node.textContent = translate(node.dataset.i18nSource);
  });
  placeholderNodes.forEach((node) => {
    node.placeholder = translate(node.dataset.i18nPlaceholder);
  });

  const languageLabel = LANGUAGE_OPTIONS.find(([code]) => code === currentLocale)?.[1] || "한국어";
  languageTriggerLabel.textContent = languageLabel;
  languageTrigger.setAttribute("aria-label", `${translate("인터페이스 언어")}: ${languageLabel}`);
  languageOptions.setAttribute("aria-label", translate("인터페이스 언어"));
  document.title = `NudeNyang Discord Translator | ${languageLabel}`;
  updateThemeControl();
  updateGreetingLocale(currentLocale);
  renderLanguageOptions(languageSearch.value);
  updateSupportedLanguageSelection();
  if (persist) window.localStorage.setItem("landing-locale", currentLocale);
}

const savedTheme = window.localStorage.getItem("landing-theme");
if (savedTheme === "light" || savedTheme === "dark") root.dataset.theme = savedTheme;

renderSupportedLanguages();
applyLocale(currentLocale, { persist: false });
bindPageScrollIndicator();
bindWorkflowVideoPlayback();

themeButton.addEventListener("click", () => {
  applyTheme(resolvedTheme() === "dark" ? "light" : "dark");
});

systemTheme.addEventListener("change", () => {
  if (!root.dataset.theme) updateThemeControl();
});

reduceMotionPreference.addEventListener("change", syncHeroVideoPlayback);
document.addEventListener("visibilitychange", syncHeroVideoPlayback);
syncHeroVideoPlayback();

menuButton.addEventListener("click", () => {
  const isOpen = menu.classList.toggle("is-open");
  menuButton.setAttribute("aria-expanded", String(isOpen));
});

menu.addEventListener("click", (event) => {
  if (!(event.target instanceof HTMLAnchorElement)) return;
  menu.classList.remove("is-open");
  menuButton.setAttribute("aria-expanded", "false");
});

languageTrigger.addEventListener("click", () => {
  const willOpen = languagePopover.hidden;
  languagePopover.hidden = !willOpen;
  languageTrigger.setAttribute("aria-expanded", String(willOpen));
  if (willOpen) {
    languageSearch.value = "";
    renderLanguageOptions();
    languageSearch.focus();
  }
});

languageSearch.addEventListener("input", () => renderLanguageOptions(languageSearch.value));

languageOptions.addEventListener("click", (event) => {
  const option = event.target.closest(".language-option");
  if (!option) return;
  applyLocale(option.dataset.locale);
  closeLanguagePicker();
  languageTrigger.focus();
});

supportedLanguageGrid.addEventListener("click", (event) => {
  const option = event.target.closest(".supported-language-button");
  if (!option) return;
  applyLocale(option.dataset.locale);
});

document.addEventListener("click", (event) => {
  if (!languagePicker.contains(event.target)) closeLanguagePicker();
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || languagePopover.hidden) return;
  closeLanguagePicker();
  languageTrigger.focus();
});

const reduceMotion = reduceMotionPreference.matches;
const revealItems = document.querySelectorAll(".reveal");

if (reduceMotion || !("IntersectionObserver" in window)) {
  revealItems.forEach((item) => item.classList.add("is-visible"));
} else {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.16 },
  );

  revealItems.forEach((item) => observer.observe(item));
}
