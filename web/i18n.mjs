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
  "전송 메시지 통역": ["Outgoing message interpretation", "送信メッセージ通訳", "发送消息翻译"],
  "최근 대화 언어를 기준으로 번역합니다.": ["Translate using the language of recent messages.", "最近の会話言語を基準に翻訳します。", "根据最近对话的语言进行翻译。"],
  "기본 전송 언어": ["Default outgoing language", "既定の送信言語", "默认发送语言"],
  "채널별 선택이 없을 때 적용합니다.": ["Used when a channel has no saved selection.", "チャンネル別の選択がない場合に適用します。", "频道没有保存的选择时使用。"],
  "전송 전 확인": ["Review before sending", "送信前に確認", "发送前确认"],
  "켜면 번역문을 입력창에 남겨 확인하거나 수정할 수 있습니다.": ["When enabled, the translation stays in the message box so you can review or edit it.", "オンにすると、翻訳文を入力欄に残して確認・修正できます。", "开启后，译文会保留在输入框中，便于检查或修改。"],
  "언어를 판단하기 어려울 때만 전송 언어를 확인합니다.": ["Ask for the outgoing language only when it cannot be determined.", "言語を判定しにくい場合のみ、送信言語を確認します。", "仅在难以判断语言时确认发送语言。"],
  "공통 번역 규칙": ["Common translation rules", "共通翻訳ルール", "通用翻译规则"],
  "받는 메시지와 보내는 메시지에 공통으로 적용합니다.": ["Applied to received and outgoing messages.", "受信メッセージと送信メッセージに共通で適用します。", "统一应用于接收消息和发送消息。"],
  "번역 말투": ["Translation tone", "翻訳の文体", "翻译语气"],
  "원문 말투를 유지하거나 원하는 말투로 고정합니다.": ["Preserve the source tone or use a selected tone.", "原文の文体を維持するか、指定した文体に固定します。", "保留原文语气或固定为所选语气。"],
  "번역 모델, 로컬 실행 방식 및 외부 번역 서비스를 설정합니다.": ["Configure models, local execution, and external translation services.", "翻訳モデル、ローカル実行方式、外部翻訳サービスを設定します。", "设置翻译模型、本地运行方式和外部翻译服务。"],
  "번역 모델": ["Translation model", "翻訳モデル", "翻译模型"],
  "표시 언어 번역 모델": ["Display translation model", "表示言語の翻訳モデル", "显示语言翻译模型"],
  "받은 메시지와 이미지에 사용할 모델입니다.": ["Used for received messages and images.", "受信メッセージと画像に使用するモデルです。", "用于收到的消息和图片。"],
  "실시간 통역 모델": ["Real-time interpretation model", "リアルタイム通訳モデル", "实时翻译模型"],
  "내가 입력한 메시지를 번역할 모델입니다.": ["Used to translate messages you type.", "入力したメッセージを翻訳するモデルです。", "用于翻译你输入的消息。"],
  "TranslateGemma 4B Q4 (실험·약 2.5GB)": ["TranslateGemma 4B Q4 (experimental · about 2.5GB)", "TranslateGemma 4B Q4（実験・約2.5GB）", "TranslateGemma 4B Q4（实验 · 约2.5GB）"],
  "GPT-5.6 Luna · 품질 최우선": ["GPT-5.6 Luna · quality first", "GPT-5.6 Luna・品質最優先", "GPT-5.6 Luna · 质量优先"],
  "Claude Haiku 4.5 · 품질 최우선": ["Claude Haiku 4.5 · quality first", "Claude Haiku 4.5・品質最優先", "Claude Haiku 4.5 · 质量优先"],
  "Gemini 3.6 Flash · 품질 최우선": ["Gemini 3.6 Flash · quality first", "Gemini 3.6 Flash・品質最優先", "Gemini 3.6 Flash · 质量优先"],
  "VRAM 보호": ["VRAM protection", "VRAM保護", "显存保护"],
  "1.8B와 7B 중 하나의 로컬 모델만 사용합니다. 한쪽에서 로컬 모델을 바꾸면 다른 쪽의 로컬 선택도 함께 바뀝니다.": ["Only one local model, either 1.8B or 7B, is used. Changing a local model for one role updates the other local selection too.", "ローカルモデルは1.8Bか7Bのどちらか一つだけを使用します。一方で変更すると、もう一方のローカル選択も更新されます。", "本地仅使用 1.8B 或 7B 中的一个模型。一侧更改本地模型时，另一侧的本地选择也会同步更改。"],
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
  "사용 중지됨": ["Disabled", "無効", "已停用"],
  "설치 필요": ["Installation required", "インストールが必要", "需要安装"],
  "API 키 필요": ["API key required", "APIキーが必要", "需要 API 密钥"],
  "로그인 필요": ["Login required", "ログインが必要", "需要登录"],
  "확인 필요": ["Action required", "確認が必要", "需要确认"],
  "확인 실패": ["Check failed", "確認に失敗", "检查失败"],
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
  "설정창 테마와 번역 단축키를 관리합니다.": ["Manage the settings theme and translation shortcuts.", "設定画面のテーマと翻訳ショートカットを管理します。", "管理设置主题和翻译快捷键。"],
  "설정창에 표시할 언어를 선택합니다.": ["Select the language used in this settings window.", "設定画面に表示する言語を選択します。", "选择设置窗口中显示的语言。"],
  "설정창 테마": ["Settings theme", "設定画面のテーマ", "设置主题"],
  "시스템 설정을 따르거나 라이트 및 다크 모드를 선택합니다.": ["Follow the system theme or select light or dark mode.", "システム設定に従うか、ライトまたはダークモードを選択します。", "跟随系统主题，或选择浅色或深色模式。"],
  "전역 단축키": ["Global shortcuts", "グローバルショートカット", "全局快捷键"],
  "다른 프로그램을 사용 중일 때도 번역 상태를 전환합니다.": ["Toggle translation while using other applications.", "他のプログラムを使用中でも翻訳状態を切り替えます。", "使用其他程序时也可切换翻译状态。"],
  "실시간 번역 켜기·끄기": ["Toggle real-time translation", "リアルタイム翻訳の切り替え", "切换实时翻译"],
  "받는 메시지의 실시간 번역 상태를 전환합니다.": ["Toggle real-time translation for received messages.", "受信メッセージのリアルタイム翻訳を切り替えます。", "切换接收消息的实时翻译。"],
  "전송 메시지 통역 켜기·끄기": ["Toggle outgoing interpretation", "送信メッセージ通訳の切り替え", "切换发送消息翻译"],
  "입력 메시지의 번역 전송 상태를 전환합니다.": ["Toggle translation before sending messages.", "入力メッセージの翻訳送信を切り替えます。", "切换发送前翻译输入消息。"],
  "메시지 입력 단축키": ["Message input shortcuts", "メッセージ入力ショートカット", "消息输入快捷键"],
  "Discord 메시지 입력창에서 통역 결과의 전송 방식을 선택합니다.": ["Choose how interpreted text is sent from the Discord message box.", "Discordのメッセージ入力欄で通訳結果の送信方法を選択します。", "选择在 Discord 消息输入框中发送翻译结果的方式。"],
  "즉시 전송": ["Send immediately", "即時送信", "立即发送"],
  "전송 전 확인 설정과 관계없이 번역 후 바로 전송합니다.": ["Translate and send immediately regardless of the review setting.", "送信前の確認設定に関係なく、翻訳後すぐに送信します。", "无论是否开启发送前确认，翻译后都会立即发送。"],
  "항상 첨삭": ["Always review", "常に推敲", "始终修改"],
  "자동 전송 상태에서도 번역문을 입력창에 남겨 수정합니다.": ["Keep the translation in the message box for editing even when automatic sending is enabled.", "自動送信時でも翻訳文を入力欄に残して修正できます。", "即使启用自动发送，也会将译文保留在输入框中以便修改。"],
  "입력란을 선택한 뒤 원하는 단축키를 누르십시오.": ["Select the field, then press the desired shortcut.", "入力欄を選択し、使用するショートカットを押してください。", "请选择输入框，然后按下所需快捷键。"],
  "버전, 업데이트, 프로젝트 및 라이선스 정보를 확인합니다.": ["View version, update, project, and license information.", "バージョン、更新、プロジェクト、ライセンス情報を確認します。", "查看版本、更新、项目和许可证信息。"],
  "버전": ["Version", "バージョン", "版本"],
  "자동 업데이트": ["Automatic updates", "自動更新", "自动更新"],
  "새 버전을 자동으로 확인하고 사용할 수 있으면 알려드립니다.": ["Automatically check for new versions and notify you when one is available.", "新しいバージョンを自動的に確認し、利用可能になったらお知らせします。", "自动检查新版本，并在可用时通知你。"],
  "비공개 베타 업데이트를 확인하고 있습니다...": ["Checking for private beta updates...", "非公開ベータ版のアップデートを確認しています…", "正在检查私有测试版更新…"],
  "현재 베타 버전이 최신입니다.": ["The current beta version is up to date.", "現在のベータ版は最新です。", "当前测试版已是最新版本。"],
  "업데이트 설치를 시작했습니다. 앱이 곧 다시 실행됩니다.": ["Update installation has started. The app will restart shortly.", "アップデートのインストールを開始しました。アプリはまもなく再起動します。", "已开始安装更新，应用即将重启。"],
  "업데이트 서명을 확인하고 설치하고 있습니다...": ["Verifying the update signature and installing...", "アップデートの署名を確認してインストールしています…", "正在验证更新签名并安装…"],
  "새 업데이트가 있습니다": ["A new update is available", "新しいアップデートがあります", "有新的更新可用"],
  "업데이트 설치": ["Install update", "アップデートをインストール", "安装更新"],
  "설치 준비 중": ["Preparing installation", "インストール準備中", "正在准备安装"],
  "버전을 설치할 수 있습니다. 작업이 끝났을 때 설치해도 됩니다.": ["is available to install. You can install it after you finish your work.", "をインストールできます。作業が終わってからインストールすることもできます。", "可供安装。你也可以在完成工作后再安装。"],
  "나중에": ["Later", "後で", "稍后"],
  "지금 확인": ["Check now", "今すぐ確認", "立即检查"],
  "진단 로그": ["Diagnostic log", "診断ログ", "诊断日志"],
  "오류 확인에 필요한 기록을 개인정보와 인증 정보를 가린 하나의 파일에 저장합니다.": ["Store troubleshooting details in one file with personal and authentication data redacted.", "トラブルシューティングに必要な記録を、個人情報と認証情報を伏せた1つのファイルに保存します。", "将排查错误所需的记录保存到一个文件中，并隐藏个人信息和身份验证信息。"],
  "로그 파일 찾기": ["Show log file", "ログファイルを表示", "显示日志文件"],
  "GNU GPL v3에 따라 이용 가능하며 별도 보증은 제공되지 않습니다.": ["Available under GNU GPL v3 without any warranty.", "GNU GPL v3に基づいて利用でき、保証はありません。", "可依据 GNU GPL v3 使用，不提供任何担保。"],
  "라이선스 보기": ["View license", "ライセンスを表示", "查看许可证"],
  "되돌리기": ["Revert", "元に戻す", "还原"],
  "확인": ["OK", "確認", "确认"],
  "저장": ["Save", "保存", "保存"],
  "설정은 이 PC에만 저장됩니다.": ["Settings are stored only on this PC.", "設定はこのPCにのみ保存されます。", "设置仅保存在此电脑上。"],
  "변경 사항은 즉시 적용됩니다.": ["Changes are applied immediately.", "変更はすぐに適用されます。", "更改会立即应用。"],
  "적용 중": ["Applying", "適用中", "正在应用"],
  "적용되었습니다.": ["Applied.", "適用しました。", "已应用。"],
  "되돌리는 중": ["Reverting", "元に戻しています", "正在还原"],
  "변경 사항을 되돌렸습니다.": ["Changes reverted.", "変更を元に戻しました。", "更改已还原。"],
  "저장 중": ["Saving", "保存中", "正在保存"],
  "저장되었습니다.": ["Saved.", "保存しました。", "已保存。"],
  "선택한 외부 번역 서비스를 먼저 연결하십시오.": ["Connect the selected external translation service first.", "選択した外部翻訳サービスに先に接続してください。", "请先连接所选的外部翻译服务。"],
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
  "라이트": ["Light", "ライト", "浅色"],
  "다크": ["Dark", "ダーク", "深色"],
  "Hy-MT2 1.8B Q4 (로컬·기본)": ["Hy-MT2 1.8B Q4 (local · default)", "Hy-MT2 1.8B Q4（ローカル・標準）", "Hy-MT2 1.8B Q4（本地・默认）"],
  "Hy-MT2 7B Q4 (로컬·품질 우선)": ["Hy-MT2 7B Q4 (local · quality first)", "Hy-MT2 7B Q4（ローカル・品質優先）", "Hy-MT2 7B Q4（本地・质量优先）"],
  "Hy-MT2 1.8B Q4 (경량·기본)": ["Hy-MT2 1.8B Q4 (lightweight · default)", "Hy-MT2 1.8B Q4（軽量・標準）", "Hy-MT2 1.8B Q4（轻量・默认）"],
  "Hy-MT2 7B Q4 (품질·약 4.6GB)": ["Hy-MT2 7B Q4 (quality · approx. 4.6GB)", "Hy-MT2 7B Q4（品質・約4.6GB）", "Hy-MT2 7B Q4（质量・约4.6GB）"],
  "DeepL (API 키·외부 전송)": ["DeepL (API key · external transfer)", "DeepL（APIキー・外部送信）", "DeepL（API 密钥・外部传输）"],
  "Mock 테스트": ["Mock test", "モックテスト", "模拟测试"],
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

const DYNAMIC_COPY = Object.freeze([
  {
    pattern: /^(.+) 모델 다운로드 중$/,
    render: {
      en: model => `Downloading ${model} model`,
      ja: model => `${model} モデルをダウンロード中`,
      zh: model => `正在下载 ${model} 模型`,
    },
  },
  {
    pattern: /^(.+) 모델 파일 확인 중$/,
    render: {
      en: model => `Verifying ${model} model file`,
      ja: model => `${model} モデルファイルを確認中`,
      zh: model => `正在验证 ${model} 模型文件`,
    },
  },
  {
    pattern: /^(.+) 모델 불러오는 중$/,
    render: {
      en: model => `Loading ${model} model`,
      ja: model => `${model} モデルを読み込み中`,
      zh: model => `正在加载 ${model} 模型`,
    },
  },
  {
    pattern: /^(.+) 모델 준비 대기 중$/,
    render: {
      en: model => `Waiting to prepare ${model} model`,
      ja: model => `${model} モデルの準備を待機中`,
      zh: model => `正在等待准备 ${model} 模型`,
    },
  },
  {
    pattern: /^([0-9.]+GB) \/ ([0-9.]+GB) 다운로드됨$/,
    render: {
      en: (downloaded, total) => `${downloaded} / ${total} downloaded`,
      ja: (downloaded, total) => `${downloaded} / ${total} ダウンロード済み`,
      zh: (downloaded, total) => `已下载 ${downloaded} / ${total}`,
    },
  },
  {
    pattern: /^([0-9.]+GB) 다운로드 완료 · 파일 무결성을 확인하고 있습니다\.$/,
    render: {
      en: total => `${total} downloaded · Verifying file integrity.`,
      ja: total => `${total} ダウンロード完了・ファイルの整合性を確認しています。`,
      zh: total => `已下载 ${total} · 正在验证文件完整性。`,
    },
  },
  {
    pattern: /^([0-9.]+GB) 다운로드 완료 · 번역 엔진을 준비하고 있습니다\.$/,
    render: {
      en: total => `${total} downloaded · Preparing the translation engine.`,
      ja: total => `${total} ダウンロード完了・翻訳エンジンを準備しています。`,
      zh: total => `已下载 ${total} · 正在准备翻译引擎。`,
    },
  },
  {
    pattern: /^같은 로컬 모델 준비 작업이 끝나기를 기다리고 있습니다\.$/,
    render: {
      en: () => "Waiting for the shared local model preparation to finish.",
      ja: () => "共有ローカルモデルの準備が完了するまで待機しています。",
      zh: () => "正在等待共享本地模型准备完成。",
    },
  },
  {
    pattern: /^선택한 번역 모델: (.+)\. 번역 준비가 완료되었습니다\.$/,
    render: {
      en: model => `Selected translation model: ${translateCopy("en", model)}. Translation is ready.`,
      ja: model => `選択した翻訳モデル: ${translateCopy("ja", model)}。翻訳の準備が完了しました。`,
      zh: model => `已选择翻译模型：${translateCopy("zh", model)}。翻译准备已完成。`,
    },
  },
  {
    pattern: /^선택한 번역 모델: (.+)\. 번역을 켜면 모델을 준비합니다\.$/,
    render: {
      en: model => `Selected translation model: ${translateCopy("en", model)}. The model will be prepared when translation is enabled.`,
      ja: model => `選択した翻訳モデル: ${translateCopy("ja", model)}。翻訳をオンにするとモデルを準備します。`,
      zh: model => `已选择翻译模型：${translateCopy("zh", model)}。开启翻译后将准备模型。`,
    },
  },
  {
    pattern: /^새 버전 (.+)을 사용할 수 있습니다\.$/,
    render: {
      en: version => `Version ${version} is available.`,
      ja: version => `新しいバージョン ${version} を利用できます。`,
      zh: version => `新版本 ${version} 可用。`,
    },
  },
  {
    pattern: /^(.+) 버전을 설치할 수 있습니다\. 지금 설치하면 앱이 다시 실행됩니다\. 작업 중이라면 나중에 설치해도 됩니다\.$/,
    render: {
      en: version => `Version ${version} is available. Installing it now will restart the app. You can install it later if you are working.`,
      ja: version => `バージョン ${version} をインストールできます。今インストールするとアプリが再起動します。作業中の場合は後でインストールできます。`,
      zh: version => `可以安装版本 ${version}。立即安装会重启应用；如果正在工作，也可以稍后安装。`,
    },
  },
  {
    pattern: /^(.+) 업데이트를 다운로드하고 있습니다\.\.\.$/,
    render: {
      en: version => `Downloading update ${version}...`,
      ja: version => `アップデート ${version} をダウンロードしています…`,
      zh: version => `正在下载更新 ${version}…`,
    },
  },
  {
    pattern: /^업데이트 다운로드 중 (.+)$/,
    render: {
      en: progress => `Downloading update ${progress}`,
      ja: progress => `アップデートをダウンロード中 ${progress}`,
      zh: progress => `正在下载更新 ${progress}`,
    },
  },
  {
    pattern: /^(업데이트 확인 실패|업데이트 설치 실패): (.+)$/,
    render: {
      en: (kind, error) => `${kind === "업데이트 확인 실패" ? "Update check failed" : "Update installation failed"}: ${error}`,
      ja: (kind, error) => `${kind === "업데이트 확인 실패" ? "アップデートの確認に失敗しました" : "アップデートのインストールに失敗しました"}: ${error}`,
      zh: (kind, error) => `${kind === "업데이트 확인 실패" ? "检查更新失败" : "安装更新失败"}：${error}`,
    },
  },
]);

export function translateDynamicCopy(language, korean) {
  language = resolveUiLanguage(language);
  const value = String(korean ?? "");
  if (language === "ko" || !value) return value;
  const exact = translateCopy(language, value);
  if (exact !== value) return exact;
  for (const entry of DYNAMIC_COPY) {
    const match = value.match(entry.pattern);
    if (match) return entry.render[language](...match.slice(1));
  }
  return value;
}

function matchesKnownTranslation(value, key) {
  return value === key || COPY[key]?.includes(value);
}

export function applyStaticTranslations(root, language) {
  language = resolveUiLanguage(language);
  document.documentElement.lang = language === "zh" ? "zh-CN" : language;
  document.title = language === "ko"
    ? "NudeNyang Translator 설정"
    : `NudeNyang Translator · ${translateCopy(language, "설정")}`;
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
