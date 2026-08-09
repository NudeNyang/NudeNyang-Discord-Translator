const COPY = Object.freeze({
  "설정": ["Settings", "設定", "设置"],
  "번역": ["Translation", "翻訳", "翻译"],
  "번역 엔진": ["Translation engine", "翻訳エンジン", "翻译引擎"],
  "이미지 번역": ["Image translation", "画像翻訳", "图片翻译"],
  "편의 기능": ["Preferences", "便利機能", "便捷功能"],
  "앱 정보": ["About", "アプリ情報", "应用信息"],
  "Discord 번역, 번역 엔진 및 이미지 OCR을 관리합니다.": ["Manage Discord translation, translation engines, and image OCR.", "Discord翻訳、翻訳エンジン、画像OCRを管理します。", "管理 Discord 翻译、翻译引擎和图片 OCR。"],
  "받는 메시지와 보내는 메시지의 번역 방식을 설정합니다.": ["Configure translation for received and outgoing messages.", "受信メッセージと送信メッセージの翻訳方法を設定します。", "设置接收消息和发送消息的翻译方式。"],
  "받는 메시지": ["Received messages", "受信メッセージ", "接收消息"],
  "Discord에서 표시할 번역을 설정합니다.": ["Configure translations displayed in Discord.", "Discordに表示する翻訳を設定します。", "设置在 Discord 中显示的翻译。"],
  "실시간 번역": ["Real-time translation", "リアルタイム翻訳", "实时翻译"],
  "메시지와 채널명을 번역하여 표시합니다.": ["Translate and display messages and channel names.", "メッセージとチャンネル名を翻訳して表示します。", "翻译并显示消息和频道名称。"],
  "표시 언어": ["Display language", "表示言語", "显示语言"],
  "원문과 같은 언어는 그대로 표시합니다.": ["Text already in this language is displayed unchanged.", "同じ言語の原文はそのまま表示します。", "与显示语言相同的原文将保持不变。"],
  "보내는 메시지": ["Outgoing messages", "送信メッセージ", "发送消息"],
  "입력한 메시지를 번역한 후 전송합니다.": ["Translate messages before sending them.", "入力したメッセージを翻訳してから送信します。", "翻译输入的消息后再发送。"],
  "보내는 메시지 번역": ["Outgoing message translation", "送信メッセージ翻訳", "发送消息翻译"],
  "최근 대화 언어를 기준으로 번역합니다.": ["Translate using the language of recent messages.", "最近の会話言語を基準に翻訳します。", "根据最近对话的语言进行翻译。"],
  "기본 전송 언어": ["Default outgoing language", "既定の送信言語", "默认发送语言"],
  "채널별 선택이 없을 때 적용합니다.": ["Used when a channel has no saved selection.", "チャンネル別の選択がない場合に適用します。", "频道没有保存的选择时使用。"],
  "채널별 첫 감지 확인": ["Confirm first detection per channel", "チャンネル別の初回検出確認", "按频道确认首次检测"],
  "자동 감지된 언어를 채널별로 처음 사용할 때 한 번만 확인합니다.": ["Confirm an automatically detected language once per channel.", "自動検出した言語をチャンネルごとに初回のみ確認します。", "每个频道首次使用自动检测语言时仅确认一次。"],
  "공통 번역 규칙": ["Common translation rules", "共通翻訳ルール", "通用翻译规则"],
  "받는 메시지와 보내는 메시지에 공통으로 적용합니다.": ["Applied to received and outgoing messages.", "受信メッセージと送信メッセージに共通で適用します。", "统一应用于接收消息和发送消息。"],
  "번역 말투": ["Translation tone", "翻訳の文体", "翻译语气"],
  "원문 말투를 유지하거나 원하는 말투로 고정합니다.": ["Preserve the source tone or use a selected tone.", "原文の文体を維持するか、指定した文体に固定します。", "保留原文语气或固定为所选语气。"],
  "번역 모델, 로컬 실행 방식 및 외부 번역 서비스를 설정합니다.": ["Configure models, local execution, and external translation services.", "翻訳モデル、ローカル実行方式、外部翻訳サービスを設定します。", "设置翻译模型、本地运行方式和外部翻译服务。"],
  "번역 모델": ["Translation model", "翻訳モデル", "翻译模型"],
  "로컬 Hy-MT2, 구독 CLI 또는 외부 API를 선택합니다.": ["Select local Hy-MT2, a subscription CLI, or an external API.", "ローカルHy-MT2、サブスクリプションCLI、外部APIから選択します。", "选择本地 Hy-MT2、订阅 CLI 或外部 API。"],
  "로컬 엔진": ["Local engine", "ローカルエンジン", "本地引擎"],
  "Hy-MT2의 실행 장치와 자원 사용 방식을 설정합니다.": ["Configure Hy-MT2 execution and resource use.", "Hy-MT2の実行デバイスとリソース使用方法を設定します。", "设置 Hy-MT2 的运行设备和资源使用方式。"],
  "Hy-MT2 실행 장치": ["Hy-MT2 device", "Hy-MT2実行デバイス", "Hy-MT2 运行设备"],
  "자동 설정은 GPU를 우선 사용하고 필요한 경우 CPU로 전환합니다.": ["Automatic mode prioritizes the GPU and falls back to the CPU.", "自動設定ではGPUを優先し、必要に応じてCPUへ切り替えます。", "自动模式优先使用 GPU，并在需要时切换到 CPU。"],
  "로컬 모델 예열 유지": ["Keep local model warm", "ローカルモデルの常駐", "保持本地模型预热"],
  "번역을 꺼도 모델을 VRAM에 유지합니다.": ["Keep the model in VRAM while translation is off.", "翻訳をオフにしてもモデルをVRAMに保持します。", "翻译关闭时仍将模型保留在显存中。"],
  "화면 확인 빈도": ["Screen scan rate", "画面確認頻度", "屏幕检查频率"],
  "값이 높을수록 반응이 빨라지며 CPU 사용량이 증가할 수 있습니다.": ["Higher values respond faster but may increase CPU use.", "値を高くすると応答が速くなりますが、CPU使用率が増える場合があります。", "数值越高响应越快，但可能增加 CPU 使用率。"],
  "로컬 우선": ["Local first", "ローカル優先", "本地优先"],
  "Hy-MT2와 이미지 OCR은 PC에서 실행됩니다. 외부 모델에는 추출된 텍스트만 전송됩니다.": ["Hy-MT2 and image OCR run on this PC. Only extracted text is sent to external models.", "Hy-MT2と画像OCRはPC上で実行されます。外部モデルには抽出したテキストのみ送信されます。", "Hy-MT2 和图片 OCR 在本机运行。仅将提取的文本发送给外部模型。"],
  "번역 서비스 연결": ["Translation service connections", "翻訳サービス接続", "翻译服务连接"],
  "구독 계정과 API 연결 상태를 관리합니다.": ["Manage subscription accounts and API connections.", "サブスクリプションアカウントとAPI接続を管理します。", "管理订阅账户和 API 连接。"],
  "연결": ["Connect", "接続", "连接"],
  "연결됨": ["Connected", "接続済み", "已连接"],
  "연결 해제": ["Disconnect", "接続解除", "断开连接"],
  "엔진 연결 중": ["Connecting engine", "エンジン接続中", "正在连接引擎"],
  "엔진 연결 실패": ["Engine connection failed", "エンジン接続失敗", "引擎连接失败"],
  "번역 대기 중": ["Translation ready", "翻訳待機中", "翻译待机中"],
  "Discord 연결 중": ["Connecting to Discord", "Discord接続中", "正在连接 Discord"],
  "Discord 연결됨": ["Discord connected", "Discord接続済み", "Discord 已连接"],
  "준비 중": ["preparing", "準備中", "准备中"],
  "사용 중": ["active", "使用中", "使用中"],
  "준비 실패": ["failed to prepare", "準備失敗", "准备失败"],
  "설치": ["Install", "インストール", "安装"],
  "확인 중": ["Checking", "確認中", "检查中"],
  "이미지 OCR 자동 번역": ["Automatic image OCR translation", "画像OCR自動翻訳", "图片 OCR 自动翻译"],
  "기본 기능": ["Built-in", "基本機能", "内置功能"],
  "처리 위치": ["Processing", "処理場所", "处理位置"],
  "OCR은 PC에서 실행됩니다.": ["OCR runs on this PC.", "OCRはPC上で実行されます。", "OCR 在本机运行。"],
  "번역 언어": ["Translation language", "翻訳言語", "翻译语言"],
  "번역 메뉴의 표시 언어 설정을 따릅니다.": ["Uses the display language selected in Translation.", "翻訳メニューの表示言語設定に従います。", "使用“翻译”中的显示语言设置。"],
  "표시 조건": ["Availability", "表示条件", "显示条件"],
  "실시간 번역이 켜져 있을 때만 활성화됩니다.": ["Available only while real-time translation is on.", "リアルタイム翻訳がオンの場合のみ有効です。", "仅在实时翻译开启时启用。"],
  "설정창 테마와 전역 단축키를 관리합니다.": ["Manage the settings theme and global shortcuts.", "設定画面のテーマとグローバルショートカットを管理します。", "管理设置窗口主题和全局快捷键。"],
  "설정창에 표시할 언어를 선택합니다.": ["Select the language used in this settings window.", "設定画面に表示する言語を選択します。", "选择设置窗口中显示的语言。"],
  "설정창 테마": ["Settings theme", "設定画面のテーマ", "设置主题"],
  "시스템 설정을 따르거나 라이트 및 다크 모드를 선택합니다.": ["Follow the system theme or select light or dark mode.", "システム設定に従うか、ライトまたはダークモードを選択します。", "跟随系统主题，或选择浅色或深色模式。"],
  "전역 단축키": ["Global shortcuts", "グローバルショートカット", "全局快捷键"],
  "다른 프로그램을 사용 중일 때도 번역 상태를 전환합니다.": ["Toggle translation while using other applications.", "他のプログラムを使用中でも翻訳状態を切り替えます。", "使用其他程序时也可切换翻译状态。"],
  "실시간 번역 켜기·끄기": ["Toggle real-time translation", "リアルタイム翻訳の切り替え", "切换实时翻译"],
  "받는 메시지의 실시간 번역 상태를 전환합니다.": ["Toggle real-time translation for received messages.", "受信メッセージのリアルタイム翻訳を切り替えます。", "切换接收消息的实时翻译。"],
  "보내는 메시지 번역 켜기·끄기": ["Toggle outgoing translation", "送信メッセージ翻訳の切り替え", "切换发送消息翻译"],
  "입력 메시지의 번역 전송 상태를 전환합니다.": ["Toggle translation before sending messages.", "入力メッセージの翻訳送信を切り替えます。", "切换发送前翻译输入消息。"],
  "입력란을 선택한 뒤 원하는 단축키를 누르십시오.": ["Select the field, then press the desired shortcut.", "入力欄を選択し、使用するショートカットを押してください。", "请选择输入框，然后按下所需快捷键。"],
  "버전, 업데이트, 프로젝트 및 라이선스 정보를 확인합니다.": ["View version, update, project, and license information.", "バージョン、更新、プロジェクト、ライセンス情報を確認します。", "查看版本、更新、项目和许可证信息。"],
  "자동 업데이트": ["Automatic updates", "自動更新", "自动更新"],
  "지금 확인": ["Check now", "今すぐ確認", "立即检查"],
  "라이선스 보기": ["View license", "ライセンスを表示", "查看许可证"],
  "되돌리기": ["Revert", "元に戻す", "还原"],
  "저장": ["Save", "保存", "保存"],
  "설정은 이 PC에만 저장됩니다.": ["Settings are stored only on this PC.", "設定はこのPCにのみ保存されます。", "设置仅保存在此电脑上。"],
  "켜짐": ["On", "オン", "开启"],
  "꺼짐": ["Off", "オフ", "关闭"],
  "사용": ["On", "使用", "启用"],
  "사용 안 함": ["Off", "使用しない", "不启用"],
  "유지": ["Keep", "保持", "保持"],
  "반환": ["Release", "解放", "释放"],
  "최근 대화에서 자동 감지": ["Detect from recent messages", "最近の会話から自動検出", "根据最近对话自动检测"],
  "원문 말투 유지 (자동)": ["Preserve source tone (automatic)", "原文の文体を維持（自動）", "保留原文语气（自动）"],
  "항상 존댓말·격식체": ["Always polite and formal", "常に敬語・フォーマル", "始终使用礼貌正式语气"],
  "항상 반말·비격식체": ["Always casual and informal", "常にタメ口・カジュアル", "始终使用随意非正式语气"],
  "자동 (GPU 우선, CPU 대체)": ["Automatic (GPU first, CPU fallback)", "自動（GPU優先、CPU代替）", "自动（GPU 优先，CPU 备用）"],
  "시스템 설정 따르기": ["Follow system settings", "システム設定に従う", "跟随系统设置"],
  "자동 (시스템 언어)": ["Auto (system language)", "自動（システム言語）", "自动（系统语言）"],
  "라이트": ["Light", "ライト", "浅色"],
  "다크": ["Dark", "ダーク", "深色"],
  "회/초": ["/sec", "回/秒", "次/秒"],
});

const LANGUAGE_INDEX = Object.freeze({ en: 0, ja: 1, zh: 2 });

export function resolveUiLanguage(language, systemLanguage = globalThis.navigator?.language) {
  if (language !== "auto") return ["ko", "en", "ja", "zh"].includes(language) ? language : "en";
  const normalized = String(systemLanguage || "").trim().toLowerCase();
  if (normalized.startsWith("ko")) return "ko";
  if (normalized.startsWith("ja")) return "ja";
  if (normalized.startsWith("zh")) return "zh";
  return "en";
}

export function translateCopy(language, korean) {
  language = resolveUiLanguage(language);
  if (language === "ko") return korean;
  const index = LANGUAGE_INDEX[language];
  return index === undefined ? korean : (COPY[korean]?.[index] || korean);
}

function matchesKnownTranslation(value, key) {
  return value === key || COPY[key]?.includes(value);
}

export function applyStaticTranslations(root, language) {
  language = resolveUiLanguage(language);
  document.documentElement.lang = language === "zh" ? "zh-CN" : language;
  document.title = language === "ko"
    ? "Nude Translator 설정"
    : `Nude Translator · ${translateCopy(language, "설정")}`;
  const elements = root.querySelectorAll("h1, h2, h3, p, span, strong, b, button, small");
  for (const element of elements) {
    if (element.children.length > 0) continue;
    const value = element.textContent.trim();
    let key = element.dataset.i18nKey;
    if (!key || !matchesKnownTranslation(value, key)) {
      key = COPY[value] ? value : "";
      if (key) element.dataset.i18nKey = key;
    }
    if (key) element.textContent = translateCopy(language, key);
  }
}
