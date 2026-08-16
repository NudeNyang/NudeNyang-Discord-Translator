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
  "Discord Inc.", "NudeNyang Discord Translator", "NudeNyang Translator", "Discord", "Windows", "Hy-MT2", "ChatGPT",
  "Claude", "Gemini", "DeepL", "self-bot", "macOS", "WebM", "MP4", "PNG", "API", "CLI",
  "OCR", "x64", "PC", "Beta",
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
const showcaseTitle = "번역 방식부터 언어까지 원하는 대로 설정하세요.";
const showcaseTitleOverrides = {
  en: "Customize everything from translation methods to languages.",
  ja: "翻訳方法から言語まで、お好みに合わせて設定できます。",
  zh: "从翻译方式到语言，都可按需设置。",
  "zh-Hant": "從翻譯方式到語言，都可依需求設定。",
  "pt-BR": "Personalize tudo, dos métodos de tradução aos idiomas.",
  hi: "अनुवाद के तरीके से लेकर भाषा तक, अपनी पसंद के अनुसार सेट करें।",
  "es-419": "Configura a tu gusto desde el método de traducción hasta el idioma.",
  de: "Passen Sie Übersetzungsmethode und Sprache nach Ihren Wünschen an.",
  ru: "Настройте всё по своему усмотрению: от способа перевода до языка.",
  id: "Atur sesuai keinginan, mulai dari metode terjemahan hingga bahasa.",
  fr: "Personnalisez tout, de la méthode de traduction à la langue.",
  tr: "Çeviri yönteminden dile kadar her şeyi istediğiniz gibi ayarlayın.",
  ar: "خصّص كل شيء كما تريد، من طريقة الترجمة إلى اللغة.",
  vi: "Tùy chỉnh theo ý bạn, từ phương thức dịch đến ngôn ngữ.",
  it: "Personalizza tutto, dal metodo di traduzione alla lingua.",
  pl: "Dostosuj wszystko do swoich potrzeb, od metody tłumaczenia po język.",
  uk: "Налаштуйте все на свій смак: від способу перекладу до мови.",
  ms: "Tetapkan mengikut kehendak anda, daripada kaedah terjemahan hingga bahasa.",
  nl: "Stel alles naar wens in, van de vertaalmethode tot de taal.",
  th: "ตั้งค่าได้ตามต้องการ ตั้งแต่วิธีการแปลไปจนถึงภาษา",
  fil: "Itakda ayon sa gusto mo, mula sa paraan ng pagsasalin hanggang sa wika.",
  bn: "অনুবাদের পদ্ধতি থেকে ভাষা পর্যন্ত, নিজের পছন্দমতো সেট করুন।",
  ur: "ترجمے کے طریقے سے لے کر زبان تک، اپنی پسند کے مطابق ترتیب دیں۔",
  ta: "மொழிபெயர்ப்பு முறையிலிருந்து மொழி வரை, உங்கள் விருப்பப்படி அமைக்கவும்.",
  fa: "همه‌چیز را، از روش ترجمه تا زبان، به دلخواه تنظیم کنید.",
  he: "הגדירו כרצונכם הכול, משיטת התרגום ועד השפה.",
  cs: "Nastavte si podle potřeby vše od způsobu překladu až po jazyk.",
};

const overrides = {
  en: {
    "기능": "Features",
    "개인정보": "Privacy",
    "Beta 다운로드": "Beta download",
    "Windows Beta 다운로드": "Download Windows Beta",
    "주요 기능": "Key features",
    "이미지 속 글자까지 번역합니다.": "Translate text inside images.",
    "사진과 스크린샷의 글자를 자동으로 인식해 선택한 언어로 번역합니다.": "Automatically detect text in photos and screenshots, then translate it into your selected language.",
    "Discord 실시간 번역": "Real-time Discord translation",
    "Discord는 그대로,": "Discord stays the same,",
    "대화는 내 언어로.": "the conversation is in my language.",
    "메시지와 채널명, 이미지 속 글자까지 Discord 화면 안에서 바로 번역합니다.": "Translate messages, channel names, and text in images directly inside Discord.",
    "메시지와 답장은 물론, 이미지 속 글자까지 Discord 안에서 바로 번역합니다.": "Translate messages, replies, and text in images right inside Discord.",
    "어둡게": "Dark",
    "밝게": "Light",
    "지원": "Support",
    "작동 방식 보기": "See how it works",
    "앱 지원 언어": "Supported UI languages",
    "로컬 AI": "Local AI",
    "로컬 AI 선택 가능": "Local AI available",
    "로컬 AI 모델로 번역 비용을 줄일 수 있습니다.": "Reduce translation costs with local AI models.",
    "로컬 AI를 사용하면 별도의 번역 API 비용 없이 PC에서 번역할 수 있습니다.": "Use local AI to translate on your PC without separate translation API fees.",
    "로컬 AI부터 구독 CLI와 DeepL까지 용도에 맞게 연결할 수 있습니다.": "Connect local AI, subscription CLIs, or DeepL to suit your needs.",
    "로컬 AI를 선택하면 번역할 텍스트를 외부 번역 서비스로 전송하지 않습니다.": "When you choose local AI, the text being translated is not sent to an external translation service.",
    "개인정보 보호": "Privacy protection",
    "별도의 운영 서버 없이, 내 PC에서 동작합니다.": "Runs on your PC without a separate service server.",
    "NudeNyang Translator는 별도의 중계·저장 서버를 운영하지 않으며, 대화 내역과 개인정보를 자체 서버로 전송하거나 보관하지 않습니다.": "NudeNyang Translator does not operate separate relay or storage servers, and does not send or store your conversation history or personal information on its own servers.",
    "자체 서버 없음": "No NudeNyang Translator servers",
    "회원가입이나 서버 연결 없이 앱이 PC에서 직접 동작합니다.": "The app runs directly on your PC without account registration or a server connection.",
    "대화 내역을 수집하지 않음": "No conversation history collection",
    "대화 내용, 이미지와 번역 기록을 수집하거나 보관하지 않습니다.": "Conversation content, images, and translation history are not collected or retained.",
    "Discord 데이터 그대로 유지": "Leaves Discord data unchanged",
    "온라인 번역 엔진을 선택하면 번역에 필요한 텍스트가 해당 서비스로 직접 전달될 수는 있습니다.": "When you select an online translation engine, the text required for translation may still be sent directly to that service.",
    "Discord 이용 안내": "Using Discord",
    "이 앱은 사용자 토큰이나 비공식 Discord API를 사용하지 않지만, Discord가 공식으로 승인한 도구는 아닙니다. Discord 정책상 클라이언트 변경 또는 일반 사용자 계정 자동화로 판단될 경우 사용이 제한되거나 계정에 조치가 적용될 수 있습니다. 최신 정책을 확인한 뒤 사용 여부를 결정해 주십시오.": "This app does not use user tokens or unofficial Discord APIs, but it is not officially approved by Discord. If Discord determines its use to be client modification or automation of a regular user account, access may be restricted or account action may be taken. Review the latest policies before deciding whether to use it.",
    "사용에 따른 책임은 사용자에게 있습니다.": "You are responsible for your decision to use the app and its consequences.",
    "Discord 이용 약관": "Discord Terms of Service",
    "플랫폼 조작 정책": "Platform Manipulation Policy",
    "Discord 이용 약관에 위배될 수 있나요?": "Could this violate Discord's Terms of Service?",
    "Discord 정책은 클라이언트 변경과 일반 사용자 계정 자동화를 허용하지 않는다고 안내합니다. 이 앱은 공식 승인을 받은 도구가 아니므로 정책 위반으로 판단될 가능성을 배제할 수 없습니다. 사용 여부와 결과에 대한 책임은 사용자에게 있습니다.": "Discord states that client modification and automation of regular user accounts are not allowed. This app is not officially approved, so it may be considered a policy violation. You are responsible for your decision to use it and the resulting consequences.",
  },
  ja: {
    "이미지 속 글자까지 번역합니다.": "画像内の文字まで翻訳します。",
    "사진과 스크린샷의 글자를 자동으로 인식해 선택한 언어로 번역합니다.": "写真やスクリーンショットの文字を自動認識し、選択した言語に翻訳します。",
    "로컬 AI": "ローカルAI",
    "로컬 AI 선택 가능": "ローカルAIを選択可能",
    "로컬 AI 모델로 번역 비용을 줄일 수 있습니다.": "ローカルAIモデルで翻訳コストを抑えられます。",
    "로컬 AI를 사용하면 별도의 번역 API 비용 없이 PC에서 번역할 수 있습니다.": "ローカルAIを使えば、別途翻訳APIの費用をかけずにPC上で翻訳できます。",
    "로컬 AI부터 구독 CLI와 DeepL까지 용도에 맞게 연결할 수 있습니다.": "ローカルAI、サブスクリプションCLI、DeepLから用途に合う方法を接続できます。",
    "로컬 AI를 선택하면 번역할 텍스트를 외부 번역 서비스로 전송하지 않습니다.": "ローカルAIを選択すると、翻訳するテキストは外部の翻訳サービスに送信されません。",
    "개인정보 보호": "プライバシー保護",
    "별도의 운영 서버 없이, 내 PC에서 동작합니다.": "専用の運用サーバーを介さず、PC上で動作します。",
    "NudeNyang Translator는 별도의 중계·저장 서버를 운영하지 않으며, 대화 내역과 개인정보를 자체 서버로 전송하거나 보관하지 않습니다.": "NudeNyang Translatorは専用の中継・保存サーバーを運用しておらず、会話履歴や個人情報を自社サーバーへ送信または保存しません。",
    "자체 서버 없음": "専用サーバーなし",
    "회원가입이나 서버 연결 없이 앱이 PC에서 직접 동작합니다.": "アカウント登録やサーバー接続なしで、アプリがPC上で直接動作します。",
    "대화 내역을 수집하지 않음": "会話履歴を収集しない",
    "대화 내용, 이미지와 번역 기록을 수집하거나 보관하지 않습니다.": "会話内容、画像、翻訳履歴を収集または保存しません。",
    "Discord 데이터 그대로 유지": "Discordのデータを変更しない",
    "온라인 번역 엔진을 선택하면 번역에 필요한 텍스트가 해당 서비스로 직접 전달될 수는 있습니다.": "ただし、オンライン翻訳エンジンを選択した場合、翻訳に必要なテキストがそのサービスへ直接送信されることがあります。",
    "Discord 이용 안내": "Discordの利用に関するご案内",
    "이 앱은 사용자 토큰이나 비공식 Discord API를 사용하지 않지만, Discord가 공식으로 승인한 도구는 아닙니다. Discord 정책상 클라이언트 변경 또는 일반 사용자 계정 자동화로 판단될 경우 사용이 제한되거나 계정에 조치가 적용될 수 있습니다. 최신 정책을 확인한 뒤 사용 여부를 결정해 주십시오.": "このアプリはユーザートークンや非公式のDiscord APIを使用しませんが、Discordが公式に承認したツールではありません。Discordのポリシーにより、クライアントの変更または通常のユーザーアカウントの自動化と判断された場合、利用が制限されたり、アカウントに措置が講じられたりする可能性があります。最新のポリシーを確認したうえで、利用するかどうかを判断してください。",
    "사용에 따른 책임은 사용자에게 있습니다.": "利用およびその結果については、利用者が責任を負います。",
    "Discord 이용 약관": "Discord利用規約",
    "플랫폼 조작 정책": "プラットフォーム操作ポリシー",
    "Discord 이용 약관에 위배될 수 있나요?": "Discordの利用規約に違反する可能性はありますか？",
    "Discord 정책은 클라이언트 변경과 일반 사용자 계정 자동화를 허용하지 않는다고 안내합니다. 이 앱은 공식 승인을 받은 도구가 아니므로 정책 위반으로 판단될 가능성을 배제할 수 없습니다. 사용 여부와 결과에 대한 책임은 사용자에게 있습니다.": "Discordは、クライアントの変更および通常のユーザーアカウントの自動化を認めていないと案内しています。このアプリは公式に承認されたツールではないため、ポリシー違反と判断される可能性を否定できません。利用するかどうか、およびその結果については利用者が責任を負います。",
  },
  zh: {
    "이미지 속 글자까지 번역합니다.": "连图片中的文字也能翻译。",
    "사진과 스크린샷의 글자를 자동으로 인식해 선택한 언어로 번역합니다.": "自动识别照片和截图中的文字，并翻译成您选择的语言。",
    "로컬 AI": "本地 AI",
    "로컬 AI 선택 가능": "可选择本地 AI",
    "로컬 AI 모델로 번역 비용을 줄일 수 있습니다.": "使用本地 AI 模型降低翻译成本。",
    "로컬 AI를 사용하면 별도의 번역 API 비용 없이 PC에서 번역할 수 있습니다.": "使用本地 AI，无需另付翻译 API 费用即可在 PC 上完成翻译。",
    "로컬 AI부터 구독 CLI와 DeepL까지 용도에 맞게 연결할 수 있습니다.": "可根据需要连接本地 AI、订阅版 CLI 或 DeepL。",
    "로컬 AI를 선택하면 번역할 텍스트를 외부 번역 서비스로 전송하지 않습니다.": "选择本地 AI 后，待翻译文本不会发送到外部翻译服务。",
    "개인정보 보호": "隐私保护",
    "별도의 운영 서버 없이, 내 PC에서 동작합니다.": "无需独立运营服务器，直接在您的 PC 上运行。",
    "NudeNyang Translator는 별도의 중계·저장 서버를 운영하지 않으며, 대화 내역과 개인정보를 자체 서버로 전송하거나 보관하지 않습니다.": "NudeNyang Translator 不运营独立的中转或存储服务器，也不会将对话记录或个人信息发送或保存在自有服务器上。",
    "자체 서버 없음": "无自有服务器",
    "회원가입이나 서버 연결 없이 앱이 PC에서 직접 동작합니다.": "无需注册账户或连接服务器，应用即可直接在 PC 上运行。",
    "대화 내역을 수집하지 않음": "不收集对话记录",
    "대화 내용, 이미지와 번역 기록을 수집하거나 보관하지 않습니다.": "不会收集或保存对话内容、图片或翻译记录。",
    "Discord 데이터 그대로 유지": "保持 Discord 数据不变",
    "온라인 번역 엔진을 선택하면 번역에 필요한 텍스트가 해당 서비스로 직접 전달될 수는 있습니다.": "不过，选择在线翻译引擎后，翻译所需的文本仍可能会直接发送给该服务。",
    "아닙니다. 이미지의 글자는 PC에서 인식하며 선택한 외부 번역기에는 추출된 텍스트만 전달합니다.": "不会。图像中的文本由 PC 识别，并且仅将提取的文本传递给选定的外部翻译器。",
    "Discord 이용 안내": "Discord 使用须知",
    "이 앱은 사용자 토큰이나 비공식 Discord API를 사용하지 않지만, Discord가 공식으로 승인한 도구는 아닙니다. Discord 정책상 클라이언트 변경 또는 일반 사용자 계정 자동화로 판단될 경우 사용이 제한되거나 계정에 조치가 적용될 수 있습니다. 최신 정책을 확인한 뒤 사용 여부를 결정해 주십시오.": "本应用不使用用户令牌或非官方 Discord API，但并非 Discord 官方批准的工具。如果 Discord 将其判定为修改客户端或自动操作普通用户账户，使用可能会受到限制，账户也可能被采取措施。请查看最新政策后再决定是否使用。",
    "사용에 따른 책임은 사용자에게 있습니다.": "使用本应用及其结果由用户自行负责。",
    "Discord 이용 약관": "Discord 服务条款",
    "플랫폼 조작 정책": "平台操纵政策",
    "Discord 이용 약관에 위배될 수 있나요?": "是否可能违反 Discord 服务条款？",
    "Discord 정책은 클라이언트 변경과 일반 사용자 계정 자동화를 허용하지 않는다고 안내합니다. 이 앱은 공식 승인을 받은 도구가 아니므로 정책 위반으로 판단될 가능성을 배제할 수 없습니다. 사용 여부와 결과에 대한 책임은 사용자에게 있습니다.": "Discord 表示不允许修改客户端或自动操作普通用户账户。本应用并非官方批准的工具，因此不能排除被判定为违反政策的可能性。是否使用以及由此产生的结果由用户自行负责。",
  },
  "zh-Hant": {
    "이미지 속 글자까지 번역합니다.": "連圖片中的文字也能翻譯。",
    "사진과 스크린샷의 글자를 자동으로 인식해 선택한 언어로 번역합니다.": "自動辨識照片和螢幕截圖中的文字，並翻譯成您選擇的語言。",
    "로컬 AI": "本機 AI",
    "로컬 AI 선택 가능": "可選擇本機 AI",
    "로컬 AI 모델로 번역 비용을 줄일 수 있습니다.": "使用本機 AI 模型降低翻譯成本。",
    "로컬 AI를 사용하면 별도의 번역 API 비용 없이 PC에서 번역할 수 있습니다.": "使用本機 AI，無須另付翻譯 API 費用即可在 PC 上完成翻譯。",
    "로컬 AI부터 구독 CLI와 DeepL까지 용도에 맞게 연결할 수 있습니다.": "可依需求連接本機 AI、訂閱版 CLI 或 DeepL。",
    "로컬 AI를 선택하면 번역할 텍스트를 외부 번역 서비스로 전송하지 않습니다.": "選擇本機 AI 後，待翻譯文字不會傳送到外部翻譯服務。",
    "개인정보 보호": "隱私保護",
    "별도의 운영 서버 없이, 내 PC에서 동작합니다.": "無須獨立營運伺服器，直接在您的 PC 上運作。",
    "NudeNyang Translator는 별도의 중계·저장 서버를 운영하지 않으며, 대화 내역과 개인정보를 자체 서버로 전송하거나 보관하지 않습니다.": "NudeNyang Translator 不營運獨立的中繼或儲存伺服器，也不會將對話記錄或個人資料傳送或儲存在自有伺服器上。",
    "자체 서버 없음": "無自有伺服器",
    "회원가입이나 서버 연결 없이 앱이 PC에서 직접 동작합니다.": "無須註冊帳戶或連線伺服器，應用程式即可直接在 PC 上運作。",
    "대화 내역을 수집하지 않음": "不收集對話記錄",
    "대화 내용, 이미지와 번역 기록을 수집하거나 보관하지 않습니다.": "不會收集或保存對話內容、圖片或翻譯記錄。",
    "Discord 데이터 그대로 유지": "保持 Discord 資料不變",
    "온라인 번역 엔진을 선택하면 번역에 필요한 텍스트가 해당 서비스로 직접 전달될 수는 있습니다.": "不過，選擇線上翻譯引擎後，翻譯所需的文字仍可能會直接傳送給該服務。",
    "Discord 이용 안내": "Discord 使用須知",
    "이 앱은 사용자 토큰이나 비공식 Discord API를 사용하지 않지만, Discord가 공식으로 승인한 도구는 아닙니다. Discord 정책상 클라이언트 변경 또는 일반 사용자 계정 자동화로 판단될 경우 사용이 제한되거나 계정에 조치가 적용될 수 있습니다. 최신 정책을 확인한 뒤 사용 여부를 결정해 주십시오.": "本應用程式不使用使用者權杖或非官方 Discord API，但並非 Discord 官方核准的工具。如果 Discord 將其判定為修改用戶端或自動操作一般使用者帳戶，使用可能會受到限制，帳戶也可能被採取措施。請查看最新政策後再決定是否使用。",
    "사용에 따른 책임은 사용자에게 있습니다.": "使用本應用程式及其結果由使用者自行負責。",
    "Discord 이용 약관": "Discord 服務條款",
    "플랫폼 조작 정책": "平台操縱政策",
    "Discord 이용 약관에 위배될 수 있나요?": "是否可能違反 Discord 服務條款？",
    "Discord 정책은 클라이언트 변경과 일반 사용자 계정 자동화를 허용하지 않는다고 안내합니다. 이 앱은 공식 승인을 받은 도구가 아니므로 정책 위반으로 판단될 가능성을 배제할 수 없습니다. 사용 여부와 결과에 대한 책임은 사용자에게 있습니다.": "Discord 表示不允許修改用戶端或自動操作一般使用者帳戶。本應用程式並非官方核准的工具，因此不能排除被判定為違反政策的可能性。是否使用以及由此產生的結果由使用者自行負責。",
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
    const override = source === workflowTitle
      ? workflowTitleOverrides[locale]
      : source === showcaseTitle
        ? showcaseTitleOverrides[locale]
        : overrides[locale]?.[source];
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
