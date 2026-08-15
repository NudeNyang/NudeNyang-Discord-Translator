import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { UI_LOCALE_COPY } from "../web/ui-locales.mjs";
import { LANGUAGE_OPTIONS } from "../web/languages.mjs";

const root = resolve(import.meta.dirname, "..");
const html = await readFile(resolve(root, "landing/index.html"), "utf8");
const textPattern = /<([a-z][\w-]*)\b[^>]*\sdata-i18n(?=\s|>)[^>]*>([^<]+)<\/\1>/giu;
const attributePattern = /data-i18n-placeholder="([^"]+)"/gu;
const sources = new Set(["밝게", "인터페이스 언어", "어두운 테마로 전환", "밝은 테마로 전환"]);

for (const match of html.matchAll(textPattern)) sources.add(match[2].trim());
for (const match of html.matchAll(attributePattern)) sources.add(match[1].trim());

const sourceList = [...sources].filter(Boolean);
const targetCodes = {
  ar: "ar",
  bn: "bn",
  cs: "cs",
  de: "de",
  en: "en",
  "es-419": "es",
  fa: "fa",
  fil: "tl",
  fr: "fr",
  he: "iw",
  hi: "hi",
  id: "id",
  it: "it",
  ja: "ja",
  ms: "ms",
  nl: "nl",
  pl: "pl",
  "pt-BR": "pt",
  ru: "ru",
  ta: "ta",
  th: "th",
  tr: "tr",
  uk: "uk",
  ur: "ur",
  vi: "vi",
  zh: "zh-CN",
  "zh-Hant": "zh-TW",
};
const separator = "[[NT_SPLIT]]";
const batchSize = 12;
const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
const protectedTerms = [
  "Discord Inc.", "NudeNyang Discord Translator", "Discord", "Windows", "Hy-MT2", "ChatGPT",
  "Claude", "Gemini", "DeepL", "self-bot", "macOS", "WebM", "MP4", "PNG", "API", "CLI",
  "OCR", "x64", "PC",
];
const keepTogether = (value) => [...value].join("\u2060");
const workflowTitle = "번역하려고 별도의 번역기를 켤 필요가 없습니다.";
const workflowTitleOverrides = {
  en: "No need to open a separate translation app.",
  ja: `翻訳のために別の${keepTogether("翻訳アプリを")}開く必要はありません。`,
  zh: "翻译时无需打开其他翻译工具。",
  "zh-Hant": "翻譯時無需開啟其他翻譯工具。",
  "pt-BR": "Não é preciso abrir outro aplicativo de tradução.",
  hi: "अनुवाद के लिए अलग ऐप खोलने की ज़रूरत नहीं है।",
  "es-419": "No es necesario abrir otra aplicación de traducción.",
  de: "Sie müssen keine separate Übersetzungs-App öffnen.",
  ru: "Для перевода не нужно открывать отдельное приложение.",
  id: "Tidak perlu membuka aplikasi penerjemah terpisah.",
  fr: "Pas besoin d'ouvrir une autre application de traduction.",
  tr: "Çeviri için ayrı bir uygulama açmanıza gerek yok.",
  ar: "لا حاجة إلى فتح تطبيق ترجمة منفصل.",
  vi: "Không cần mở một ứng dụng dịch riêng.",
  it: "Non serve aprire un'altra app di traduzione.",
  pl: "Nie trzeba otwierać osobnej aplikacji do tłumaczenia.",
  uk: "Для перекладу не потрібно відкривати окрему програму.",
  ms: "Tidak perlu membuka aplikasi penterjemah yang berasingan.",
  nl: "Je hoeft geen aparte vertaalapp te openen.",
  th: "ไม่ต้องเปิดแอปแปลภาษาแยกต่างหาก",
  fil: "Hindi kailangang magbukas ng hiwalay na app para magsalin.",
  bn: "অনুবাদের জন্য আলাদা অ্যাপ খোলার দরকার নেই।",
  ur: "ترجمے کے لیے الگ ایپ کھولنے کی ضرورت نہیں ہے۔",
  ta: "மொழிபெயர்க்க தனி செயலி தேவையில்லை.",
  fa: "برای ترجمه نیازی به باز کردن یک برنامه جداگانه نیست.",
  he: "אין צורך לפתוח אפליקציית תרגום נפרדת.",
  cs: "Nemusíte otevírat samostatnou překladovou aplikaci.",
};

const overrides = {
  en: {
    "기능": "Features",
    "개인정보": "Privacy",
    "베타 다운로드": "Beta download",
    "주요 기능": "Key features",
    "Discord 실시간 번역": "Real-time Discord translation",
    "Discord는 그대로,": "Discord stays the same,",
    "대화는 내 언어로.": "the conversation is in my language.",
    "메시지와 채널명, 이미지 속 글자까지 Discord 화면 안에서 바로 번역합니다.": "Translate messages, channel names, and text in images directly inside Discord.",
    "메시지와 답장은 물론, 이미지 속 글자까지 Discord 화면에서 바로 번역합니다.": "Translate messages, replies, and text in images right inside Discord.",
    "어둡게": "Dark",
    "밝게": "Light",
    "지원": "Support",
    "작동 방식 보기": "See how it works",
    "앱 지원 언어": "Supported UI languages",
  },
  zh: {
    "아닙니다. 이미지의 글자는 PC에서 인식하며 선택한 외부 번역기에는 추출된 텍스트만 전달합니다.": "不会。图像中的文本由 PC 识别，并且仅将提取的文本传递给选定的外部翻译器。",
  },
};

function protectTerms(value) {
  let protectedValue = value;
  const replacements = [];
  protectedTerms.forEach((term, index) => {
    if (!protectedValue.includes(term)) return;
    const marker = `[[NT_TERM_${index}]]`;
    protectedValue = protectedValue.replaceAll(term, marker);
    replacements.push([marker, term]);
  });
  return { protectedValue, replacements };
}

async function translateBatch(strings, target) {
  const protectedStrings = strings.map(protectTerms);
  const query = protectedStrings.map(({ protectedValue }) => protectedValue).join(`\n${separator}\n`);
  const url = new URL("https://translate.googleapis.com/translate_a/single");
  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", "ko");
  url.searchParams.set("tl", target);
  url.searchParams.set("dt", "t");
  url.searchParams.set("q", query);

  const response = await fetch(url, { headers: { "User-Agent": "NudeNyang-Landing-Locale-Generator/1.0" } });
  if (!response.ok) throw new Error(`Translation request failed: ${response.status}`);
  const payload = await response.json();
  const translated = payload[0].map((part) => part[0]).join("");
  const parts = translated.split(separator).map((part) => part.trim());
  if (parts.length !== strings.length) {
    throw new Error(`Translation segment mismatch: expected ${strings.length}, received ${parts.length}`);
  }
  return parts.map((part, index) => {
    let restored = part;
    for (const [marker, term] of protectedStrings[index].replacements) {
      restored = restored.replaceAll(marker, term);
    }
    return restored.replace(/[—–]/gu, "-").replace(/\s+([,.!?])/gu, "$1");
  });
}

const locales = { ko: Object.fromEntries(sourceList.map((source) => [source, source])) };

for (const [locale] of LANGUAGE_OPTIONS) {
  if (locale === "ko") continue;
  const dictionary = {};
  const missing = [];

  for (const source of sourceList) {
    const existing = UI_LOCALE_COPY[locale]?.[source];
    const override = source === workflowTitle ? workflowTitleOverrides[locale] : overrides[locale]?.[source];
    if (override || existing) dictionary[source] = override || existing;
    else missing.push(source);
  }

  for (let index = 0; index < missing.length; index += batchSize) {
    const batch = missing.slice(index, index + batchSize);
    const translated = await translateBatch(batch, targetCodes[locale]);
    batch.forEach((source, batchIndex) => {
      dictionary[source] = translated[batchIndex];
    });
    await delay(120);
  }

  locales[locale] = Object.fromEntries(sourceList.map((source) => [source, dictionary[source] || source]));
  console.log(`${locale}: ${sourceList.length} strings`);
}

const generated = `// Generated by scripts/generate-landing-locales.mjs.\n` +
  `export const LANGUAGE_OPTIONS = Object.freeze(${JSON.stringify(LANGUAGE_OPTIONS, null, 2)});\n\n` +
  `export const RTL_LOCALES = Object.freeze(["ar", "fa", "he", "ur"]);\n\n` +
  `export const LANDING_LOCALES = Object.freeze(${JSON.stringify(locales, null, 2)});\n`;

await writeFile(resolve(root, "landing/locales.generated.mjs"), generated, "utf8");
console.log(`Generated ${Object.keys(locales).length} landing locales with ${sourceList.length} strings each.`);
