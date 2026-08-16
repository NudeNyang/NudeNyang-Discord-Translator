# Language support

NudeNyang uses one catalog for incoming chat translation, outgoing translation, and the application interface.

## Supported languages

| Code | Display name | Code | Display name |
|---|---|---|---|
| `ko` | 한국어 | `en` | English |
| `ja` | 日本語 | `zh` | 简体中文 |
| `zh-Hant` | 繁體中文 | `pt-BR` | Português (Brasil) |
| `es-419` | Español (Latinoamérica) | `de` | Deutsch |
| `fr` | Français | `id` | Bahasa Indonesia |
| `hi` | हिन्दी | `vi` | Tiếng Việt |
| `pl` | Polski | `ru` | Русский |
| `uk` | Українська | `tr` | Türkçe |
| `ar` | العربية | `it` | Italiano |
| `nl` | Nederlands | `ms` | Bahasa Melayu |
| `th` | ไทย | `fil` | Filipino |
| `bn` | বাংলা | `ur` | اردو |
| `ta` | தமிழ் | `fa` | فارسی |
| `he` | עברית | `cs` | Čeština |

Legacy or provider-specific aliases are normalized before storage. For example, `zh-Hans` becomes `zh`, `pt` becomes `pt-BR`, and `es` becomes `es-419`.

The interface language and the translation target are independent. Changing the interface does not change detection candidates or the selected translation provider. `UI Language` and `Auto (System)` remain in English so users can recover from an incorrect automatic interface choice.

## Detection behavior

Detection favors an unknown result over a confident-looking mistake.

- Strong writing-system signals identify Korean, Japanese kana, Devanagari, Thai, Bengali, Tamil, Hebrew, and Chinese variants.
- Languages that share a script use additional confidence and ambiguity checks.
- URLs, Discord mentions, channel tags, custom emoji, and code-fence markers are removed from the statistical input.
- Very short or ambiguous messages such as `gg`, `lol`, numbers, and URL-only content are not forced into a language.
- Channel and category names use a separate server-navigation context and never influence message-language detection.

When detection remains uncertain, NudeNyang uses the recent channel language or asks the user to choose, depending on the outgoing-translation settings.

## Translation providers

| Provider | Language handling |
|---|---|
| Hy-MT2 1.8B / 7B | Uses the product language code and name catalog |
| TranslateGemma 4B | Uses product codes with provider-specific Chinese variants |
| ChatGPT, Claude, Gemini | Uses product codes and language names through official local CLI sessions |
| DeepL | Maps product codes to the API's source and target code variants |

Provider availability and account permissions can change. NudeNyang keeps the original text and reports an error rather than silently substituting a different language.

## Content preservation

Before translation, Markdown, line breaks, code blocks, Discord mentions, URLs, and emoji are protected and restored afterward. Empty output, obvious refusal text, repeated source text, and abnormal expansion are not cached.

## OCR coverage

The 28-language catalog applies to text chat and the interface. Image translation has a narrower scope because recognition depends on the character sets included in the bundled PP-OCR models.

Current full character-set coverage includes Korean, English, Japanese, Simplified and Traditional Chinese, Brazilian Portuguese, Latin American Spanish, German, French, Indonesian, Polish, Turkish, Italian, Dutch, Malay, Filipino, and Czech. Vietnamese is partial. Other catalog languages require additional recognition models before they can be advertised as OCR-supported.

Character-set coverage means that the recognizer can represent the script; it is not a guarantee of accuracy for every image.
