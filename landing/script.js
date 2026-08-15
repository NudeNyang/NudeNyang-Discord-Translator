import { LANDING_LOCALES, LANGUAGE_OPTIONS, RTL_LOCALES } from "./locales.generated.mjs";

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
const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
const translationNodes = [...document.querySelectorAll("[data-i18n]")];
const placeholderNodes = [...document.querySelectorAll("[data-i18n-placeholder]")];

translationNodes.forEach((node) => {
  node.dataset.i18nSource = node.textContent.trim();
});

function normalizeLocale(locale) {
  if (!locale) return null;
  const normalized = locale.replace("_", "-");
  if (normalized.toLowerCase() === "zh-tw" || normalized.toLowerCase() === "zh-hk") return "zh-Hant";
  if (normalized.toLowerCase().startsWith("zh")) return "zh";
  if (normalized.toLowerCase().startsWith("pt")) return "pt-BR";
  if (normalized.toLowerCase().startsWith("es")) return "es-419";
  const exact = LANGUAGE_OPTIONS.find(([code]) => code.toLowerCase() === normalized.toLowerCase());
  if (exact) return exact[0];
  const base = normalized.split("-")[0].toLowerCase();
  return LANGUAGE_OPTIONS.find(([code]) => code.split("-")[0].toLowerCase() === base)?.[0] || null;
}

function initialLocale() {
  const saved = normalizeLocale(window.localStorage.getItem("landing-locale"));
  if (saved) return saved;
  for (const locale of navigator.languages || [navigator.language]) {
    const supported = normalizeLocale(locale);
    if (supported) return supported;
  }
  return "ko";
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
    ...LANGUAGE_OPTIONS.map(([code, label, compact, english]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "supported-language-button";
      button.dataset.locale = code;
      button.setAttribute("aria-label", `${label}, ${english}`);
      const labelNode = document.createElement("span");
      const compactNode = document.createElement("small");
      labelNode.textContent = label;
      compactNode.textContent = compact;
      button.append(labelNode, compactNode);
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
  renderLanguageOptions(languageSearch.value);
  updateSupportedLanguageSelection();
  if (persist) window.localStorage.setItem("landing-locale", currentLocale);
}

const savedTheme = window.localStorage.getItem("landing-theme");
if (savedTheme === "light" || savedTheme === "dark") root.dataset.theme = savedTheme;

renderSupportedLanguages();
applyLocale(currentLocale, { persist: false });

themeButton.addEventListener("click", () => {
  applyTheme(resolvedTheme() === "dark" ? "light" : "dark");
});

systemTheme.addEventListener("change", () => {
  if (!root.dataset.theme) updateThemeControl();
});

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

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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
