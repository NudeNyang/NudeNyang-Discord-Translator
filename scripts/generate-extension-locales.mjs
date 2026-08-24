import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { COPY, DYNAMIC_TEMPLATE_COPY } from "../web/i18n.mjs";
import { UI_LOCALE_COPY } from "../web/ui-locales.mjs";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXTENSION_ROOT = join(PROJECT_ROOT, "extension");
const POPUP_OUTPUT = join(EXTENSION_ROOT, "popup-locales.js");
const BROWSER_LOCALES_ROOT = join(EXTENSION_ROOT, "_locales");
const CHECK_ONLY = process.argv.includes("--check");

const LOCALES = Object.freeze([
  "ko", "en", "ja", "zh", "zh-Hant", "pt-BR", "hi", "es-419", "de", "ru", "id", "fr",
  "tr", "ar", "vi", "it", "pl", "uk", "ms", "nl", "th", "fil", "bn", "ur", "ta", "fa",
  "he", "cs",
]);

const BROWSER_LOCALE = Object.freeze({
  zh: "zh_CN",
  "zh-Hant": "zh_TW",
  "pt-BR": "pt_BR",
  "es-419": "es_419",
});

const POPUP_SOURCE = Object.freeze({
  webTranslation: "웹 번역",
  enableWebTranslation: "웹페이지 번역 사용",
  checking: "확인 중",
  connecting: "엔진 연결 중",
  translationLanguage: "번역 언어",
  defaultTranslationLanguage: "기본 번역 언어",
  searchLanguage: "언어 검색",
  noSearchResults: "검색 결과가 없습니다.",
  alwaysTranslate: "항상 번역",
  translation: "번역",
  original: "원문",
  send: "전송",
  pageLimit: "페이지별 외부 전송 한도",
  settings: "설정",
  open: "열기",
  viewOriginal: "원문 보기",
  connected: "연결됨",
  preparing: "준비 중",
  connectionRequired: "연결 필요",
  unableToProcess: "요청을 처리할 수 없음",
  manualStart: "직접 시작",
  error: "오류",
});

const sourceCopy = Object.freeze({ ...COPY, ...DYNAMIC_TEMPLATE_COPY });

function translated(locale, korean) {
  if (locale === "ko") return korean;
  const base = sourceCopy[korean];
  if (!base) throw new Error(`메인 UI 사전에 없는 확장 문구입니다: ${korean}`);
  if (locale === "en") return base[0];
  if (locale === "ja") return base[1] || base[0];
  if (locale === "zh") return base[2] || base[0];
  const value = UI_LOCALE_COPY[locale]?.[korean];
  if (!value) throw new Error(`${locale} 확장 문구가 메인 UI 사전에 없습니다: ${korean}`);
  return value;
}

const popupCopy = Object.fromEntries(LOCALES.map(locale => [
  locale,
  Object.fromEntries(Object.entries(POPUP_SOURCE).map(([id, korean]) => [id, translated(locale, korean)])),
]));

const runtime = `(function exposePopupLocales(root) {\n` +
  `  const COPY = Object.freeze(${JSON.stringify(popupCopy, null, 2)});\n` +
  `  const SUPPORTED = Object.freeze(${JSON.stringify(LOCALES)});\n` +
  `  function canonical(language) {\n` +
  `    const normalized = String(language || "").trim().replaceAll("_", "-").toLowerCase();\n` +
  `    if (normalized.startsWith("zh")) return /(?:^|-)hant(?:-|$)/.test(normalized) || /^zh-(tw|hk|mo)(?:-|$)/.test(normalized) ? "zh-Hant" : "zh";\n` +
  `    if (normalized.startsWith("pt")) return "pt-BR";\n` +
  `    if (normalized.startsWith("es")) return "es-419";\n` +
  `    if (normalized === "in" || normalized.startsWith("in-")) return "id";\n` +
  `    return SUPPORTED.find(code => normalized === code.toLowerCase() || normalized.startsWith(\`${"${code.toLowerCase()}"}-\`)) || "en";\n` +
  `  }\n` +
  `  function resolve(configured, systemLanguage = root.navigator?.language) {\n` +
  `    return canonical(configured === "auto" ? systemLanguage : configured);\n` +
  `  }\n` +
  `  function message(language, id) {\n` +
  `    return COPY[resolve(language)]?.[id] || COPY.en[id] || id;\n` +
  `  }\n` +
  `  const api = Object.freeze({ COPY, SUPPORTED, canonical, resolve, message });\n` +
  `  root.NudeNyangPopupLocales = api;\n` +
  `  if (typeof module !== "undefined" && module.exports) module.exports = api;\n` +
  `})(globalThis);\n`;

const expectedBrowserFiles = new Map();
for (const locale of LOCALES) {
  const directory = BROWSER_LOCALE[locale] || locale;
  const messages = {
    extensionName: { message: "NudeNyang Web Translator" },
    extensionDescription: {
      message: translated(locale, "확장 프로그램에서 현재 페이지의 문단을 번역할 수 있도록 합니다."),
    },
    togglePageTranslation: { message: translated(locale, "웹페이지 번역 사용") },
  };
  expectedBrowserFiles.set(
    join(BROWSER_LOCALES_ROOT, directory, "messages.json"),
    `${JSON.stringify(messages, null, 2)}\n`,
  );
}

function assertCurrent(path, expected) {
  const actual = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (actual !== expected) throw new Error(`생성된 확장 언어 파일이 최신이 아닙니다: ${path}`);
}

if (CHECK_ONLY) {
  assertCurrent(POPUP_OUTPUT, runtime);
  for (const [path, expected] of expectedBrowserFiles) assertCurrent(path, expected);
  const actualDirectories = existsSync(BROWSER_LOCALES_ROOT)
    ? readdirSync(BROWSER_LOCALES_ROOT, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
    : [];
  const expectedDirectories = [...expectedBrowserFiles.keys()].map(path => path.split(/[/\\]/).at(-2)).sort();
  if (JSON.stringify(actualDirectories) !== JSON.stringify(expectedDirectories)) {
    throw new Error("확장 브라우저 로케일 폴더 구성이 최신이 아닙니다.");
  }
  console.log(`Extension locales are current: ${LOCALES.length} languages`);
} else {
  writeFileSync(POPUP_OUTPUT, runtime);
  const resolvedLocalesRoot = resolve(BROWSER_LOCALES_ROOT);
  if (!resolvedLocalesRoot.startsWith(resolve(EXTENSION_ROOT))) {
    throw new Error(`확장 폴더 밖의 로케일 경로는 정리할 수 없습니다: ${resolvedLocalesRoot}`);
  }
  rmSync(resolvedLocalesRoot, { recursive: true, force: true });
  for (const [path, expected] of expectedBrowserFiles) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, expected);
  }
  console.log(`Generated extension locales: ${LOCALES.length} languages`);
}
