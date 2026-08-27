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
  messengerPrivacyPermissionDenied: "선택 권한이 허용되지 않아 동의를 저장하지 않았습니다.",
  messengerPrivacyRevoked: "동의를 철회했습니다.",
  messengerPrivacySaveFailed: "동의를 저장하지 못했습니다. 다시 시도해 주십시오.",
  messengerReadTranslation: "웹 메신저 읽기 번역",
  messengerPrivacyConsent: "웹 메신저 개인정보 동의",
  messengerConsentRequired: "웹 메신저 읽기 번역에 대한 개인정보 동의가 필요합니다.",
  messengerDisabled: "메인 앱에서 웹 메신저 읽기 번역을 켜십시오.",
  messengerLocalOnly: "웹 메신저 읽기 번역은 로컬 AI에서만 사용할 수 있습니다.",
  messengerNoConversation: "현재 열린 대화가 없습니다.",
  messengerWaiting: "번역할 메시지를 기다리고 있습니다.",
  reviewMessengerPrivacy: "개인정보 안내 확인",
  close: "닫기",
  messengerPrivacyTitle: "웹 메신저 읽기 번역 개인정보 안내",
  messengerPrivacyIntro: "웹 메신저 읽기 번역은 기본적으로 꺼져 있습니다. 동의한 브라우저에서만 사용할 수 있습니다.",
  messengerPrivacyData: "현재 열린 대화의 메시지 본문·링크 미리보기 텍스트와 현재 Discord 서버의 보이는 채널 이름만 별도로 설치한 NudeNyang Windows 앱에서 로컬 AI로 번역합니다.",
  messengerPrivacyRetention: "확장 프로그램이 보관하는 대화 내용과 번역문은 메모리에서만 처리하며, 대화 전환 또는 종료 시 삭제합니다. 디스크 캐시, 번역 기록 또는 본문 로그에 저장하지 않습니다.",
  messengerPrivacyExternal: "외부 번역 서비스로 대화 내용을 전송하지 않습니다.",
  messengerPrivacyNoSending: "입력 및 전송 기능을 사용하지 않으며, 사용자 이름과 연락처를 번역하지 않습니다.",
  messengerPrivacyConfirm: "이 브라우저에는 동의 기록과 설정만 저장됩니다. 위 내용을 확인하고 웹 메신저 읽기 번역에 동의합니다.",
  messengerPrivacyAccept: "동의하고 사용",
  messengerPrivacyRevoke: "동의 철회",
  messengerPrivacySaved: "이 브라우저에 웹 메신저 읽기 번역 동의가 저장되었습니다.",
  messengerPrivacyCancel: "취소",
  webTranslation: "웹 번역",
  enableWebTranslation: "웹페이지 번역 사용",
  checking: "확인 중",
  connecting: "엔진 연결 중",
  translationLanguage: "번역 언어",
  defaultTranslationLanguage: "기본 번역 언어",
  searchLanguage: "언어 검색",
  noSearchResults: "검색 결과가 없습니다.",
  autoTranslateThisSite: "이 사이트 자동 번역",
  autoTranslateThisSiteDescription: "이 사이트의 페이지를 열 때마다 자동으로 번역합니다.",
  translation: "번역",
  original: "원문",
  send: "전송",
  pageLimit: "페이지별 외부 전송 한도",
  settings: "설정",
  open: "열기",
  viewOriginal: "원문 보기",
  connected: "연결됨",
  disabled: "사용 중지됨",
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
