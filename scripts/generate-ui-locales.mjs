import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { COPY } from "../web/i18n.mjs";

const TARGETS = Object.freeze([
  ["zh-Hant", "Traditional Chinese for Taiwan"],
  ["pt-BR", "Brazilian Portuguese"],
  ["hi", "Hindi"],
  ["es-419", "Latin American Spanish"],
  ["de", "German"],
  ["ru", "Russian"],
  ["id", "Indonesian"],
  ["fr", "French"],
  ["tr", "Turkish"],
  ["ar", "Modern Standard Arabic"],
  ["vi", "Vietnamese"],
  ["it", "Italian"],
  ["pl", "Polish"],
  ["uk", "Ukrainian"],
  ["ms", "Malay"],
  ["nl", "Dutch"],
]);

const entries = Object.entries(COPY).map(([korean, translations], index) => ({
  id: index,
  korean,
  english: translations[0],
}));
const temporaryDirectory = mkdtempSync(join(tmpdir(), "nudenyang-ui-locales-"));
const schemaPath = join(temporaryDirectory, "schema.json");

const protectedTokens = [
  "NudeNyang Translator", "Discord", "Hy-MT2", "TranslateGemma", "ChatGPT", "Claude",
  "Gemini", "DeepL", "Antigravity", "API", "CLI", "GPU", "CPU", "RAM", "VRAM",
  "F1", "F8", "F12", "F24", "Ctrl", "Alt", "Shift", "Enter", "Esc", "OAuth",
];
const moduleOutputPath = fileURLToPath(new URL("../web/ui-locales.mjs", import.meta.url));
const jsonOutputPath = fileURLToPath(new URL("../web/ui-locales.json", import.meta.url));
const existingCopy = existsSync(moduleOutputPath)
  ? (await import(`${new URL("../web/ui-locales.mjs", import.meta.url).href}?t=${Date.now()}`)).UI_LOCALE_COPY
  : {};
const localeCopy = structuredClone(existingCopy);
const codexCommand = process.platform === "win32"
  ? [process.execPath, join(process.env.APPDATA || "", "npm", "node_modules", "@openai", "codex", "bin", "codex.js")]
  : ["codex"];

try {
  for (const [locale, target] of TARGETS) {
    const pendingEntries = entries.filter(entry => !localeCopy[locale]?.[entry.korean]);
    if (!pendingEntries.length) {
      process.stdout.write(`Skipping ${locale}; dictionary is complete.\n`);
      continue;
    }
    writeFileSync(schemaPath, JSON.stringify({
      type: "object",
      properties: {
        translations: {
          type: "array",
          items: { type: "string", minLength: 1 },
          minItems: pendingEntries.length,
          maxItems: pendingEntries.length,
        },
      },
      required: ["translations"],
      additionalProperties: false,
    }));
    process.stdout.write(`Translating ${locale} (${pendingEntries.length} strings)...\n`);
    const outputPath = join(temporaryDirectory, `${locale}.json`);
    const prompt = [
      `Translate the following desktop application UI strings from English into ${target}.`,
      "The Korean field is context only. Translate the English field, not the Korean wording.",
      `Return exactly ${pendingEntries.length} translations in the same numeric id order using the required JSON schema.`,
      "Use concise, natural terminology appropriate for a Discord translation utility.",
      "Preserve product names, model names, keyboard shortcuts, file sizes, brace placeholders such as {language}, {part}, and {total}, punctuation intent, and line breaks.",
      "Do not add explanations. Do not leave ordinary English prose untranslated.",
      `Protected tokens: ${protectedTokens.join(", ")}.`,
      JSON.stringify(pendingEntries),
    ].join("\n\n");
    const result = spawnSync(codexCommand[0], [...codexCommand.slice(1),
      "exec",
      "--ephemeral",
      "--ignore-rules",
      "--skip-git-repo-check",
      "--sandbox", "read-only",
      "--output-schema", schemaPath,
      "--output-last-message", outputPath,
      "-",
    ], {
      cwd: temporaryDirectory,
      input: prompt,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    });
    if (result.status !== 0) {
      throw new Error(`Codex translation failed for ${locale}: ${result.error?.message || result.stderr || result.stdout || `exit ${result.status}`}`);
    }
    const parsed = JSON.parse(readFileSync(outputPath, "utf8"));
    if (!Array.isArray(parsed.translations) || parsed.translations.length !== pendingEntries.length) {
      throw new Error(`${locale} returned ${parsed.translations?.length ?? 0}/${pendingEntries.length} translations`);
    }
    const dictionary = localeCopy[locale] || {};
    pendingEntries.forEach((entry, index) => {
      const translated = String(parsed.translations[index] || "").trim();
      if (!translated) throw new Error(`${locale} translation ${index} is empty`);
      if (/[가-힣]/.test(translated)) throw new Error(`${locale} translation ${index} contains Korean: ${translated}`);
      const sourcePlaceholders = [...entry.english.matchAll(/\{[^}]+\}/g)].map(match => match[0]).sort();
      const translatedPlaceholders = [...translated.matchAll(/\{[^}]+\}/g)].map(match => match[0]).sort();
      if (JSON.stringify(sourcePlaceholders) !== JSON.stringify(translatedPlaceholders)) {
        throw new Error(`${locale} translation ${index} changed placeholders: ${translated}`);
      }
      dictionary[entry.korean] = translated;
    });
    localeCopy[locale] = dictionary;
  }

  const serialized = JSON.stringify(localeCopy, null, 2);
  writeFileSync(
    moduleOutputPath,
    `// Generated by scripts/generate-ui-locales.mjs.\n` +
      `export const UI_LOCALE_COPY = Object.freeze(${serialized});\n`,
  );
  writeFileSync(jsonOutputPath, `${serialized}\n`);
  process.stdout.write(`Wrote ${moduleOutputPath} and ${jsonOutputPath}\n`);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
