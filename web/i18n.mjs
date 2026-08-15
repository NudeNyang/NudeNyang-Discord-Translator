import { UI_LOCALE_COPY } from "./ui-locales.mjs";

export const COPY = Object.freeze({
  "설정": ["Settings", "設定", "设置"],
  "인터페이스 언어": ["Interface language", "インターフェース言語", "界面语言"],
  "자동(시스템)": ["Automatic (system)", "自動（システム）", "自动（系统）"],
  "언어 검색": ["Search languages", "言語を検索", "搜索语言"],
  "검색 결과 없음": ["No matching languages", "一致する言語がありません", "没有匹配的语言"],
  "자동 감지": ["Auto detect", "自動検出", "自动检测"],
  "전송": ["Send", "送信", "发送"],
  "전송 언어 선택": ["Select outgoing language", "送信言語を選択", "选择发送语言"],
  "이번 메시지만 원문으로 전송": ["Send only this message without translation", "このメッセージのみ原文で送信", "仅本条消息发送原文"],
  "다음 메시지는 번역하지 않고 전송합니다.": ["The next message will be sent without translation.", "次のメッセージは翻訳せずに送信します。", "下一条消息将不翻译并直接发送。"],
  "전송 언어를 선택하십시오.": ["Select an outgoing language.", "送信言語を選択してください。", "请选择发送语言。"],
  "원문을 전송합니다.": ["Sending the original message.", "原文を送信します。", "正在发送原文。"],
  "메시지를 번역하고 있습니다.": ["Translating the message.", "メッセージを翻訳しています。", "正在翻译消息。"],
  "대화 언어를 판단하지 못했습니다. 전송 언어를 선택하십시오.": ["The conversation language could not be determined. Select an outgoing language.", "会話の言語を判定できませんでした。送信言語を選択してください。", "无法判断对话语言。请选择发送语言。"],
  "{language}로 감지했습니다. 전송 언어 메뉴에서 변경할 수 있습니다.": ["Detected {language}. You can change it from the outgoing language menu.", "{language}と判定しました。送信言語メニューから変更できます。", "已检测为{language}。可在发送语言菜单中更改。"],
  "원문 전송": ["Send original", "原文を送信", "发送原文"],
  "메시지를 번역하지 못했습니다. 번역하지 않고 원문을 유지합니다.": ["The message could not be translated. The original message has been preserved.", "メッセージを翻訳できませんでした。原文は変更されていません。", "无法翻译消息。原文已保持不变。"],
  "이전 메시지를 처리하고 있습니다. 잠시 후 다시 시도하십시오.": ["The previous message is still being processed. Try again shortly.", "前のメッセージを処理しています。しばらくしてからもう一度お試しください。", "上一条消息仍在处理中。请稍后重试。"],
  "번역문을 분할 전송하고 있습니다. ({part}/{total})": ["Sending the translated message in parts. ({part}/{total})", "翻訳文を分割して送信しています。({part}/{total})", "正在分段发送译文。({part}/{total})"],
  "번역문이 길어 텍스트 파일로 전송합니다.": ["The translation is long and will be sent as a text file.", "翻訳文が長いため、テキストファイルとして送信します。", "译文较长，将以文本文件形式发送。"],
  "번역문을 확인하거나 수정한 뒤 Enter로 전송하십시오.": ["Review or edit the translation, then press Enter to send.", "翻訳文を確認・修正し、Enterで送信してください。", "请检查或修改译文，然后按 Enter 发送。"],
  "번역문을 수정하거나 Enter로 전송하십시오.": ["Edit the translation or press Enter to send it.", "翻訳文を修正するか、Enterで送信してください。", "请修改译文或按 Enter 发送。"],
  "번역 켜짐": ["Translation on", "翻訳オン", "翻译开启"],
  "표시": ["View", "表示", "显示"],
  "원문": ["Original", "原文", "原文"],
  "원문 보기": ["Show original", "原文を表示", "查看原文"],
  "전송문 보기": ["Show sent message", "送信文を表示", "查看发送内容"],
  "번역 보기": ["Show translation", "翻訳を表示", "查看译图"],
  "번역 중…": ["Translating…", "翻訳中…", "正在翻译…"],
  "다시 시도": ["Try again", "再試行", "重试"],
  "이미지를 번역하지 못했습니다.": ["The image could not be translated.", "画像を翻訳できませんでした。", "无法翻译图片。"],
  "번역": ["Translation", "翻訳", "翻译"],
  "번역 엔진": ["Translation engine", "翻訳エンジン", "翻译引擎"],
  "이미지 번역": ["Image translation", "画像翻訳", "图片翻译"],
  "이미지 OCR 품질": ["Image OCR quality", "画像OCR品質", "图片 OCR 质量"],
  "글자 모양과 배경에 따라 인식 속도와 정확도를 조절합니다.": ["Balance recognition speed and accuracy for different text styles and backgrounds.", "文字の形や背景に合わせて、認識速度と精度を調整します。", "根据文字样式和背景调整识别速度与准确度。"],
  "자동 (권장)": ["Automatic (recommended)", "自動（推奨）", "自动（推荐）"],
  "빠른 처리": ["Faster processing", "高速処理", "快速处理"],
  "고품질 우선": ["Prioritize quality", "品質優先", "质量优先"],
  "자동 처리": ["Automatic processing", "自動処理", "自动处理"],
  "빠른 모델로 먼저 인식하고 불확실한 영역만 고품질 모델로 다시 확인합니다.": ["Use the fast model first, then recheck only uncertain regions with the higher-quality model.", "まず高速モデルで認識し、不確かな領域のみ高品質モデルで再確認します。", "先使用快速模型识别，再仅用高质量模型复查不确定区域。"],
  "고품질 모델": ["Higher-quality model", "高品質モデル", "高质量模型"],
  "약 70MB이며 처음 필요할 때 다운로드합니다. 5분 동안 사용하지 않으면 메모리에서 해제됩니다.": ["About 70MB. It downloads when first needed and is released from memory after 5 minutes of inactivity.", "約70MBです。初めて必要になったときにダウンロードし、5分間使用しないとメモリから解放します。", "约 70MB。首次需要时下载，闲置 5 分钟后从内存中释放。"],
  "편의 기능": ["Preferences", "便利機能", "便捷功能"],
  "앱 정보": ["About", "アプリ情報", "应用信息"],
  "Discord 메시지·이미지 번역과 앱 동작을 설정합니다.": ["Configure Discord message and image translation, and app behavior.", "Discordのメッセージ・画像翻訳とアプリの動作を設定します。", "设置 Discord 消息与图片翻译以及应用行为。"],
  "받는 메시지와 보내는 메시지의 번역 방식을 설정합니다.": ["Configure translation for received and outgoing messages.", "受信メッセージと送信メッセージの翻訳方法を設定します。", "设置接收消息和发送消息的翻译方式。"],
  "받는 메시지": ["Received messages", "受信メッセージ", "接收消息"],
  "Discord에서 표시할 번역을 설정합니다.": ["Configure translations displayed in Discord.", "Discordに表示する翻訳を設定します。", "设置在 Discord 中显示的翻译。"],
  "실시간 번역": ["Real-time translation", "リアルタイム翻訳", "实时翻译"],
  "메시지 통역": ["Message interpretation", "メッセージ通訳", "消息翻译"],
  "단축키": ["Shortcut", "ショートカット", "快捷键"],
  "메시지와 채널명을 번역하여 표시합니다.": ["Translate and display messages and channel names.", "メッセージとチャンネル名を翻訳して表示します。", "翻译并显示消息和频道名称。"],
  "표시 언어": ["Display language", "表示言語", "显示语言"],
  "원문과 같은 언어는 그대로 표시합니다.": ["Text already in this language is displayed unchanged.", "同じ言語の原文はそのまま表示します。", "与显示语言相同的原文将保持不变。"],
  "보내는 메시지": ["Outgoing messages", "送信メッセージ", "发送消息"],
  "입력한 메시지를 번역한 후 전송합니다.": ["Translate messages before sending them.", "入力したメッセージを翻訳してから送信します。", "翻译输入的消息后再发送。"],
  "전송 메시지 통역": ["Outgoing message interpretation", "送信メッセージ通訳", "发送消息翻译"],
  "초대 수락이 완료되지 않으면 브라우저에서 계속해 주세요.": ["If the invite is not accepted, please continue in your browser.", "招待の承認が完了しない場合は、ブラウザーで続行してください。", "如果邀请未能接受，请在浏览器中继续。"],
  "초대를 수락하려면 브라우저에서 계속해 주세요.": ["To accept this invite, please continue in your browser.", "この招待を承認するには、ブラウザーで続行してください。", "要接受此邀请，请在浏览器中继续。"],
  "브라우저에서 계속": ["Continue in browser", "ブラウザーで続行", "在浏览器中继续"],
  "초대 정보를 불러오지 못했습니다. 브라우저에서 초대 상태를 확인해 주세요.": ["Discord could not load this invite. Please check its status in your browser.", "Discordでこの招待を読み込めませんでした。ブラウザーで状態を確認してください。", "Discord 无法加载此邀请。请在浏览器中检查其状态。"],
  "브라우저에서 확인": ["Check in browser", "ブラウザーで確認", "在浏览器中检查"],
  "최근 대화 언어를 기준으로 번역합니다.": ["Translate using the language of recent messages.", "最近の会話言語を基準に翻訳します。", "根据最近对话的语言进行翻译。"],
  "기본 전송 언어": ["Default outgoing language", "既定の送信言語", "默认发送语言"],
  "채널별 선택이 없을 때 적용합니다.": ["Used when a channel has no saved selection.", "チャンネル別の選択がない場合に適用します。", "频道没有保存的选择时使用。"],
  "전송 전 확인": ["Review before sending", "送信前に確認", "发送前确认"],
  "켜면 번역문을 입력창에 남겨 확인하거나 수정할 수 있습니다.": ["When enabled, the translation stays in the message box so you can review or edit it.", "オンにすると、翻訳文を入力欄に残して確認・修正できます。", "开启后，译文会保留在输入框中，便于检查或修改。"],
  "언어를 판단하기 어려울 때만 전송 언어를 확인합니다.": ["Ask for the outgoing language only when it cannot be determined.", "言語を判定しにくい場合のみ、送信言語を確認します。", "仅在难以判断语言时确认发送语言。"],
  "번역 모델, 로컬 실행 방식 및 외부 번역 서비스를 설정합니다.": ["Configure models, local execution, and external translation services.", "翻訳モデル、ローカル実行方式、外部翻訳サービスを設定します。", "设置翻译模型、本地运行方式和外部翻译服务。"],
  "번역 모델": ["Translation model", "翻訳モデル", "翻译模型"],
  "표시 언어 번역 모델": ["Display translation model", "表示言語の翻訳モデル", "显示语言翻译模型"],
  "받은 메시지와 이미지에 사용할 모델입니다.": ["Used for received messages and images.", "受信メッセージと画像に使用するモデルです。", "用于收到的消息和图片。"],
  "실시간 통역 모델": ["Real-time interpretation model", "リアルタイム通訳モデル", "实时翻译模型"],
  "내가 입력한 메시지를 번역할 모델입니다.": ["Used to translate messages you type.", "入力したメッセージを翻訳するモデルです。", "用于翻译你输入的消息。"],
  "보내는 메시지 통역 모델": ["Outgoing message translation model", "送信メッセージ通訳モデル", "发送消息翻译模型"],
  "상대방에게 보낼 메시지를 번역하는 모델입니다.": ["Translates messages before they are sent to other people.", "相手に送るメッセージを翻訳するモデルです。", "用于翻译即将发送给对方的消息。"],
  "TranslateGemma 4B Q4 (실험·약 2.5GB)": ["TranslateGemma 4B Q4 (experimental · about 2.5GB)", "TranslateGemma 4B Q4（実験・約2.5GB）", "TranslateGemma 4B Q4（实验 · 约2.5GB）"],
  "GPT-5.6 (품질 최우선)": ["GPT-5.6 (quality first)", "GPT-5.6（品質最優先）", "GPT-5.6（质量优先）"],
  "Claude (품질 최우선)": ["Claude (quality first)", "Claude（品質最優先）", "Claude（质量优先）"],
  "Gemini (품질 최우선)": ["Gemini (quality first)", "Gemini（品質最優先）", "Gemini（质量优先）"],
  "ChatGPT CLI (외부·품질 우선)": ["ChatGPT CLI (external · quality first)", "ChatGPT CLI（外部・品質優先）", "ChatGPT CLI（外部 · 质量优先）"],
  "Claude CLI (외부·품질 우선)": ["Claude CLI (external · quality first)", "Claude CLI（外部・品質優先）", "Claude CLI（外部 · 质量优先）"],
  "Gemini CLI (외부·품질 우선)": ["Gemini CLI (external · quality first)", "Gemini CLI（外部・品質優先）", "Gemini CLI（外部 · 质量优先）"],
  "ChatGPT CLI (권장·품질 우선)": ["ChatGPT CLI (recommended · quality first)", "ChatGPT CLI（推奨・品質優先）", "ChatGPT CLI（推荐 · 质量优先）"],
  "Claude CLI (권장·품질 우선)": ["Claude CLI (recommended · quality first)", "Claude CLI（推奨・品質優先）", "Claude CLI（推荐 · 质量优先）"],
  "Gemini CLI (권장·품질 우선)": ["Gemini CLI (recommended · quality first)", "Gemini CLI（推奨・品質優先）", "Gemini CLI（推荐 · 质量优先）"],
  "Hy-MT2 1.8B Q4 (로컬·속도 우선)": ["Hy-MT2 1.8B Q4 (local · speed first)", "Hy-MT2 1.8B Q4（ローカル・速度優先）", "Hy-MT2 1.8B Q4（本地 · 速度优先）"],
  "Hy-MT2 7B Q4 (로컬·속도 우선)": ["Hy-MT2 7B Q4 (local · speed first)", "Hy-MT2 7B Q4（ローカル・速度優先）", "Hy-MT2 7B Q4（本地 · 速度优先）"],
  "TranslateGemma 4B Q4 (실험·속도 우선)": ["TranslateGemma 4B Q4 (experimental · speed first)", "TranslateGemma 4B Q4（実験・速度優先）", "TranslateGemma 4B Q4（实验 · 速度优先）"],
  "로컬 모델": ["Local models", "ローカルモデル", "本地模型"],
  "외부 번역 서비스": ["External translation services", "外部翻訳サービス", "外部翻译服务"],
  "권장 CLI 및 번역 서비스": ["Recommended CLI and translation services", "推奨CLI・翻訳サービス", "推荐的 CLI 和翻译服务"],
  "로컬 및 실험 모델": ["Local and experimental models", "ローカル・実験モデル", "本地和实验模型"],
  "테스트 모델": ["Test model", "テストモデル", "测试模型"],
  "품질 최우선": ["Quality first", "品質最優先", "质量优先"],
  "VRAM 보호": ["VRAM protection", "VRAM 保護", "VRAM 保护"],
  "표시 번역과 실시간 통역에서 로컬 모델을 선택하면 하나만 실행되며, 한쪽의 선택을 바꾸면 다른 쪽도 같은 모델로 맞춰집니다.": ["When local models are selected for display translation and real-time interpretation, only one runs at a time. Changing one selection aligns the other to the same model.", "表示翻訳とリアルタイム通訳でローカルモデルを選択した場合、実行されるのは一つだけです。一方の選択を変更すると、もう一方も同じモデルに揃います。", "显示翻译和实时翻译都选择本地模型时，一次只运行一个。更改一侧的选择后，另一侧也会同步为相同模型。"],
  "로컬 모델은 하나만 실행됩니다. 표시 번역과 보내는 메시지 통역의 로컬 모델 선택은 함께 변경됩니다.": ["Only one local model runs at a time. The local model selections for display translation and outgoing message translation change together.", "ローカルモデルは一つだけ実行されます。表示翻訳と送信メッセージ通訳のローカルモデル選択は連動して変更されます。", "一次只会运行一个本地模型。显示翻译和发送消息翻译的本地模型选择会同步更改。"],
  "보내는 메시지에는 CLI 모델을 권장합니다.": ["CLI models are recommended for outgoing messages.", "送信メッセージにはCLIモデルを推奨します。", "建议为发送消息使用 CLI 模型。"],
  "로컬 모델은 짧고 단순한 문장에 적합합니다. 문맥과 말투가 중요한 메시지는 CLI 모델 사용을 권장합니다.": ["Local models are best suited to short, simple messages. Use a CLI model when meaning and tone matter.", "ローカルモデルは短く簡単な文に適しています。意味や文体が重要なメッセージにはCLIモデルの使用を推奨します。", "本地模型适合简短句子。对于重视含义和语气的消息，建议使用 CLI 模型。"],
  "연결된 CLI 모델을 사용하면 의미와 말투를 더 안정적으로 보존할 수 있습니다.": ["A connected CLI model can preserve meaning and tone more reliably.", "接続済みのCLIモデルを使用すると、意味と文体をより安定して保持できます。", "使用已连接的 CLI 模型可以更稳定地保留含义和语气。"],
  "CLI 모델로 보내는 메시지를 통역합니다.": ["Outgoing messages are translated with a CLI model.", "CLIモデルで送信メッセージを通訳します。", "使用 CLI 模型翻译发送消息。"],
  "번역할 텍스트만 선택한 서비스로 전송됩니다. 로컬 모델보다 의미와 말투를 안정적으로 보존하는 데 적합합니다.": ["Only the text to translate is sent to the selected service. It is better suited than local models to preserving meaning and tone.", "翻訳するテキストのみが選択したサービスへ送信されます。ローカルモデルよりも意味と文体を安定して保持する用途に適しています。", "仅将待翻译文本发送到所选服务。相比本地模型，它更适合稳定保留含义和语气。"],
  "외부 번역 서비스로 보내는 메시지를 통역합니다.": ["Outgoing messages are translated with an external service.", "外部翻訳サービスで送信メッセージを通訳します。", "使用外部翻译服务翻译发送消息。"],
  "번역할 텍스트만 DeepL로 전송됩니다.": ["Only the text to translate is sent to DeepL.", "翻訳するテキストのみがDeepLへ送信されます。", "仅将待翻译文本发送到 DeepL。"],
  "CLI 모델 연결": ["Connect a CLI model", "CLIモデルを接続", "连接 CLI 模型"],
  "권장 모델 사용": ["Use recommended model", "推奨モデルを使用", "使用推荐模型"],
  "권장 모델을 적용하지 못했습니다": ["Could not apply the recommended model", "推奨モデルを適用できませんでした", "无法应用推荐模型"],
  "로컬 엔진": ["Local engine", "ローカルエンジン", "本地引擎"],
  "로컬 번역 모델의 실행 장치와 자원 사용 방식을 설정합니다.": ["Configure local translation model execution and resource use.", "ローカル翻訳モデルの実行デバイスとリソース使用方法を設定します。", "设置本地翻译模型的运行设备和资源使用方式。"],
  "시스템 메모리를 확인하고 있습니다.": ["Checking system memory.", "システムメモリを確認しています。", "正在检查系统内存。"],
  "선택한 로컬 모델의 메모리 요구량을 계산합니다.": ["Calculating the memory requirements of the selected local model.", "選択したローカルモデルのメモリ要件を計算します。", "正在计算所选本地模型的内存需求。"],
  "저사양 권장 설정 적용": ["Apply low-spec preset", "低スペック向け設定を適用", "应用低配置推荐设置"],
  "로컬 모델을 선택하면 메모리 사용량을 안내합니다.": ["Select a local model to see its memory usage.", "ローカルモデルを選択するとメモリ使用量を確認できます。", "选择本地模型后可查看内存使用量。"],
  "외부 번역 서비스는 로컬 모델 메모리를 사용하지 않습니다.": ["External translation services do not use local model memory.", "外部翻訳サービスはローカルモデル用のメモリを使用しません。", "外部翻译服务不占用本地模型内存。"],
  "현재 여유 RAM으로는 실행이 불안정할 수 있습니다.": ["The app may be unstable with the currently available RAM.", "現在の空きRAMでは動作が不安定になる可能性があります。", "当前可用 RAM 可能不足以稳定运行。"],
  "현재 메모리에서 실행할 수 있습니다.": ["The model can run with the current memory.", "現在のメモリで実行できます。", "当前内存可以运行此模型。"],
  "예상 VRAM 사용량": ["Estimated VRAM usage", "推定VRAM使用量", "预计 VRAM 使用量"],
  "예상 RAM 사용량": ["Estimated RAM usage", "推定RAM使用量", "预计 RAM 使用量"],
  "약": ["about", "約", "约"],
  "모델 파일": ["Model file", "モデルファイル", "模型文件"],
  "권장 여유 RAM": ["Recommended free RAM", "推奨空きRAM", "建议可用 RAM"],
  "현재 사용 가능": ["Currently available", "現在使用可能", "当前可用"],
  "전체 RAM": ["Total RAM", "合計RAM", "总 RAM"],
  "GPU 실행 기준이며 환경에 따라 달라질 수 있습니다.": ["Based on GPU execution; actual usage may vary by system.", "GPU実行時の目安で、環境によって変動します。", "以 GPU 运行为准，实际用量可能因环境而异。"],
  "CPU 실행 기준이며 환경에 따라 달라질 수 있습니다.": ["Based on CPU execution; actual usage may vary by system.", "CPU実行時の目安で、環境によって変動します。", "以 CPU 运行为准，实际用量可能因环境而异。"],
  "현재 여유 RAM이 예상 사용량보다 적습니다.": ["Available RAM is below the estimated usage.", "現在の空きRAMが推定使用量を下回っています。", "当前可用 RAM 低于预计用量。"],
  "로컬 모델 실행 장치": ["Local model device", "ローカルモデルの実行デバイス", "本地模型运行设备"],
  "자동 설정은 GPU를 우선 사용하고 필요한 경우 CPU로 전환합니다.": ["Automatic mode prioritizes the GPU and falls back to the CPU.", "自動設定ではGPUを優先し、必要に応じてCPUへ切り替えます。", "自动模式优先使用 GPU，并在需要时切换到 CPU。"],
  "로컬 모델 예열 유지": ["Keep local model warm", "ローカルモデルの常駐", "保持本地模型预热"],
  "번역을 꺼도 모델을 메모리에 유지합니다.": ["Keep the model in memory while translation is off.", "翻訳をオフにしてもモデルをメモリに保持します。", "翻译关闭时仍将模型保留在内存中。"],
  "켜두면 다시 번역할 때 빠르게 반응하지만 RAM/VRAM을 계속 사용합니다. 게임이 느려지거나 메모리가 부족하다면 꺼주세요.": ["Keeping it on makes the next translation respond faster, but continues to use RAM/VRAM. Turn it off if games slow down or memory is low.", "オンにすると次の翻訳にすばやく反応しますが、RAM/VRAMを使い続けます。ゲームが遅くなる、またはメモリが不足する場合はオフにしてください。", "开启后再次翻译时响应更快，但会持续占用 RAM/VRAM。如果游戏变慢或内存不足，请将其关闭。"],
  "화면 확인 빈도": ["Screen scan rate", "画面確認頻度", "屏幕检查频率"],
  "값이 높을수록 반응이 빨라지며 CPU 사용량이 증가할 수 있습니다.": ["Higher values respond faster but may increase CPU use.", "値を高くすると応答が速くなりますが、CPU使用率が増える場合があります。", "数值越高响应越快，但可能增加 CPU 使用率。"],
  "저장 공간 관리": ["Storage management", "ストレージ管理", "存储空间管理"],
  "저장 공간": ["Storage", "ストレージ", "存储空间"],
  "다운로드한 로컬 모델과 번역 기록을 관리합니다.": ["Manage downloaded local models and translation history.", "ダウンロードしたローカルモデルと翻訳履歴を管理します。", "管理已下载的本地模型和翻译记录。"],
  "로컬 번역 모델": ["Local translation models", "ローカル翻訳モデル", "本地翻译模型"],
  "사용하지 않는 다운로드 모델을 삭제하여 저장 공간을 확보합니다.": ["Remove downloaded models you no longer use to free storage space.", "使用しないダウンロード済みモデルを削除して、ストレージ容量を確保します。", "删除不再使用的已下载模型以释放存储空间。"],
  "폴더 열기": ["Open folder", "フォルダーを開く", "打开文件夹"],
  "여는 중": ["Opening", "開いています", "正在打开"],
  "로컬 모델 데이터 폴더를 열었습니다.": ["Opened the local model data folder.", "ローカルモデルのデータフォルダーを開きました。", "已打开本地模型数据文件夹。"],
  "번역 기록": ["Translation history", "翻訳履歴", "翻译记录"],
  "로컬에 저장된 번역 데이터의 용량을 관리합니다.": ["Manage the space used by locally saved translation data.", "ローカルに保存された翻訳データの容量を管理します。", "管理本地保存的翻译数据容量。"],
  "SQLite 번역 기록": ["SQLite translation history", "SQLite翻訳履歴", "SQLite 翻译记录"],
  "저장된 번역 결과와 보낸 메시지 원문을 정리합니다. 설정, 채널별 언어 및 인증 정보는 유지됩니다.": ["Remove saved translations and original outgoing messages. Settings, channel language choices, and credentials are retained.", "保存された翻訳結果と送信メッセージの原文を削除します。設定、チャンネル別の言語、認証情報は保持されます。", "清理已保存的翻译结果和已发送消息原文。设置、频道语言和身份验证信息将保留。"],
  "저장 공간을 확인하고 있습니다.": ["Checking storage usage.", "ストレージ使用量を確認しています。", "正在检查存储空间。"],
  "기록 정리": ["Clear history", "履歴を消去", "清理记录"],
  "자동 정리": ["Automatic cleanup", "自動整理", "自动清理"],
  "보관 기간이 지난 번역 결과와 보낸 메시지 원문을 자동으로 정리합니다.": ["Automatically remove saved translations and original outgoing messages after the selected retention period.", "選択した保存期間を過ぎた翻訳結果と送信メッセージの原文を自動的に削除します。", "自动清理超过所选保留期限的翻译结果和已发送消息原文。"],
  "7일 보관": ["Keep for 7 days", "7日間保存", "保留 7 天"],
  "30일 보관": ["Keep for 30 days", "30日間保存", "保留 30 天"],
  "90일 보관": ["Keep for 90 days", "90日間保存", "保留 90 天"],
  "180일 보관": ["Keep for 180 days", "180日間保存", "保留 180 天"],
  "앱에 포함됨": ["Included with the app", "アプリに同梱", "应用内置"],
  "다운로드됨": ["Downloaded", "ダウンロード済み", "已下载"],
  "다운로드 중": ["Downloading", "ダウンロード中", "下载中"],
  "일부 다운로드됨": ["Partially downloaded", "一部ダウンロード済み", "已部分下载"],
  "설치되지 않음 · 필요할 때 자동으로 다운로드됩니다.": ["Not installed · Downloads automatically when selected.", "未インストール・選択時に自動でダウンロードします。", "未安装 · 选择后将自动下载。"],
  "삭제": ["Delete", "削除", "删除"],
  "앱 포함": ["Included", "同梱", "内置"],
  "미설치": ["Not installed", "未インストール", "未安装"],
  "정리 가능한 기록": ["Stored records", "保存済み履歴", "已存记录"],
  "건": [" records", "件", "条"],
  "로컬 모델 삭제": ["Delete local model", "ローカルモデルを削除", "删除本地模型"],
  "다운로드 파일을 삭제합니다. 이 모델을 다시 선택하면 파일을 다시 다운로드합니다.": ["The downloaded files will be removed. Selecting this model again will download them again.", "ダウンロードファイルを削除します。このモデルを再度選択すると、ファイルを再ダウンロードします。", "将删除已下载文件。再次选择此模型时将重新下载。"],
  "번역 기록 정리": ["Clear translation history", "翻訳履歴を消去", "清理翻译记录"],
  "저장된 번역 결과와 보낸 메시지 원문을 삭제합니다. 설정, 채널별 언어 및 번역 서비스 인증 정보는 유지됩니다.": ["Delete saved translations and original outgoing messages. Settings, channel language choices, and translation service credentials are retained.", "保存された翻訳結果と送信メッセージの原文を削除します。設定、チャンネル別の言語、翻訳サービスの認証情報は保持されます。", "删除已保存的翻译结果和已发送消息原文。设置、频道语言和翻译服务身份验证信息将保留。"],
  "번역 서비스 연결": ["Translation service connections", "翻訳サービス接続", "翻译服务连接"],
  "구독 계정과 API 연결 상태를 관리합니다.": ["Manage subscription accounts and API connections.", "サブスクリプションアカウントとAPI接続を管理します。", "管理订阅账户和 API 连接。"],
  "CLI 및 번역 서비스 연결": ["CLI and translation service connections", "CLI・翻訳サービス接続", "CLI 和翻译服务连接"],
  "보내는 메시지 통역에 사용할 구독 CLI와 API 연결을 관리합니다.": ["Manage subscription CLI and API connections used for outgoing message translation.", "送信メッセージ通訳に使用するサブスクリプションCLIとAPI接続を管理します。", "管理用于发送消息翻译的订阅 CLI 和 API 连接。"],
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
  "Discord 이미지에서 글자를 감지하고 번역하여 표시합니다.": ["Detect and translate text in Discord images.", "Discord画像内の文字を検出し、翻訳して表示します。", "检测 Discord 图片中的文字，翻译后显示。"],
  "이미지 OCR 자동 번역": ["Automatic image OCR translation", "画像OCR自動翻訳", "图片 OCR 自动翻译"],
  "기본 기능": ["Built-in", "基本機能", "内置功能"],
  "실시간 번역이 켜져 있을 때 Discord 이미지의 글자를 PC에서 감지하여 표시 언어로 번역합니다. 번역이 꺼져 있으면 이미지에 별도 버튼이나 안내 문구를 표시하지 않습니다.": ["When real-time translation is on, text in Discord images is detected on this PC and translated into the display language. When translation is off, no extra buttons or notices are shown on images.", "リアルタイム翻訳がオンのとき、Discord画像内の文字をPC上で検出し、表示言語へ翻訳します。翻訳がオフのときは、画像にボタンや案内を表示しません。", "实时翻译开启时，会在本机检测 Discord 图片中的文字并翻译为显示语言。翻译关闭时，不会在图片上显示额外按钮或提示。"],
  "처리 위치": ["Processing", "処理場所", "处理位置"],
  "OCR은 PC에서 실행됩니다.": ["OCR runs on this PC.", "OCRはPC上で実行されます。", "OCR 在本机运行。"],
  "번역 언어": ["Translation language", "翻訳言語", "翻译语言"],
  "번역 메뉴의 표시 언어 설정을 따릅니다.": ["Uses the display language selected in Translation.", "翻訳メニューの表示言語設定に従います。", "使用“翻译”中的显示语言设置。"],
  "표시 조건": ["Availability", "表示条件", "显示条件"],
  "실시간 번역이 켜져 있을 때만 활성화됩니다.": ["Available only while real-time translation is on.", "リアルタイム翻訳がオンの場合のみ有効です。", "仅在实时翻译开启时启用。"],
  "설정창 테마, 시스템 시작 및 번역 단축키를 관리합니다.": ["Manage the settings theme, system startup, and translation shortcuts.", "設定画面のテーマ、システム起動、翻訳ショートカットを管理します。", "管理设置主题、系统启动和翻译快捷键。"],
  "설정창에 표시할 언어를 선택합니다.": ["Select the language used in this settings window.", "設定画面に表示する言語を選択します。", "选择设置窗口中显示的语言。"],
  "설정창 테마": ["Settings theme", "設定画面のテーマ", "设置主题"],
  "시스템 설정을 따르거나 라이트 및 다크 모드를 선택합니다.": ["Follow the system theme or select light or dark mode.", "システム設定に従うか、ライトまたはダークモードを選択します。", "跟随系统主题，或选择浅色或深色模式。"],
  "시스템 시작 시 자동 실행": ["Launch at system startup", "システム起動時に自動実行", "系统启动时自动运行"],
  "컴퓨터에 로그인하면 앱을 실행하고 Discord 번역 연결을 자동으로 준비합니다.": ["Launch the app when you sign in and automatically prepare the Discord translation connection.", "コンピューターへのログイン時にアプリを起動し、Discordの翻訳接続を自動的に準備します。", "登录电脑时启动应用，并自动准备 Discord 翻译连接。"],
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
  "앱 버전과 업데이트를 확인하고, 진단 로그·초기화·라이선스를 관리합니다.": ["Check the app version and updates, and manage diagnostic logs, reset options, and licenses.", "アプリのバージョンと更新を確認し、診断ログ・初期化・ライセンスを管理します。", "查看应用版本和更新，并管理诊断日志、重置和许可证。"],
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
  "설정 초기화": ["Reset settings", "設定を初期化", "重置设置"],
  "앱 설정과 단축키를 기본값으로 초기화합니다. 번역 기록, 다운로드한 모델 및 번역 서비스 인증 정보는 유지됩니다.": ["Reset app settings and shortcuts to their defaults. Translation history, downloaded models, and translation service credentials are kept.", "アプリ設定とショートカットを既定値に初期化します。翻訳履歴、ダウンロード済みモデル、翻訳サービスの認証情報は保持されます。", "将应用设置和快捷键重置为默认值。翻译记录、已下载的模型和翻译服务身份验证信息将保留。"],
  "초기화": ["Reset", "初期化", "重置"],
  "GNU GPL v3에 따라 이용 가능하며 별도 보증은 제공되지 않습니다.": ["Available under GNU GPL v3 without any warranty.", "GNU GPL v3に基づいて利用でき、保証はありません。", "可依据 GNU GPL v3 使用，不提供任何担保。"],
  "라이선스 보기": ["View license", "ライセンスを表示", "查看许可证"],
  "확인": ["OK", "確認", "确认"],
  "저장": ["Save", "保存", "保存"],
  "설정은 이 PC에만 저장됩니다.": ["Settings are stored only on this PC.", "設定はこのPCにのみ保存されます。", "设置仅保存在此电脑上。"],
  "변경 사항은 즉시 적용됩니다.": ["Changes are applied immediately.", "変更はすぐに適用されます。", "更改会立即应用。"],
  "적용 중": ["Applying", "適用中", "正在应用"],
  "적용되었습니다.": ["Applied.", "適用しました。", "已应用。"],
  "초기화 중": ["Resetting", "初期化しています", "正在重置"],
  "설정을 초기화했습니다.": ["Settings have been reset.", "設定を初期化しました。", "设置已重置。"],
  "저장 중": ["Saving", "保存中", "正在保存"],
  "저장되었습니다.": ["Saved.", "保存しました。", "已保存。"],
  "선택한 외부 번역 서비스를 먼저 연결하십시오.": ["Connect the selected external translation service first.", "選択した外部翻訳サービスに先に接続してください。", "请先连接所选的外部翻译服务。"],
  "로컬 모델을 삭제하지 못했습니다": ["Could not delete the local model", "ローカルモデルを削除できませんでした", "无法删除本地模型"],
  "모델 폴더를 열지 못했습니다": ["Could not open the model folder", "モデルフォルダーを開けませんでした", "无法打开模型文件夹"],
  "설정을 적용하지 못했습니다": ["Could not apply settings", "設定を適用できませんでした", "无法应用设置"],
  "화면 확인 빈도를 적용하지 못했습니다": ["Could not apply the screen scan rate", "画面確認頻度を適用できませんでした", "无法应用屏幕检查频率"],
  "번역 상태를 변경하지 못했습니다": ["Could not change translation state", "翻訳状態を変更できませんでした", "无法更改翻译状态"],
  "전송 메시지 통역 상태를 변경하지 못했습니다": ["Could not change outgoing interpretation state", "送信メッセージ通訳の状態を変更できませんでした", "无法更改发送消息翻译状态"],
  "Discord 연결 실패": ["Discord connection failed", "Discordへの接続に失敗しました", "Discord 连接失败"],
  "Discord 자동 재시작 실패": ["Discord automatic restart failed", "Discordの自動再起動に失敗しました", "Discord 自动重启失败"],
  "전송 전 확인 설정을 적용하지 못했습니다": ["Could not apply the review-before-send setting", "送信前確認の設定を適用できませんでした", "无法应用发送前确认设置"],
  "로컬 모델 예열 설정을 적용하지 못했습니다": ["Could not apply the local model warm-up setting", "ローカルモデル常駐の設定を適用できませんでした", "无法应用本地模型预热设置"],
  "단축키를 적용하지 못했습니다": ["Could not apply the shortcut", "ショートカットを適用できませんでした", "无法应用快捷键"],
  "링크를 열지 못했습니다": ["Could not open the link", "リンクを開けませんでした", "无法打开链接"],
  "번역 서비스를 연결하지 못했습니다": ["Could not connect the translation service", "翻訳サービスに接続できませんでした", "无法连接翻译服务"],
  "연결을 해제하지 못했습니다": ["Could not disconnect", "接続を解除できませんでした", "无法断开连接"],
  "API 키를 적용하지 못했습니다": ["Could not apply the API key", "APIキーを適用できませんでした", "无法应用 API 密钥"],
  "업데이트를 확인하지 못했습니다": ["Could not check for updates", "アップデートを確認できませんでした", "无法检查更新"],
  "업데이트를 설치하지 못했습니다": ["Could not install the update", "アップデートをインストールできませんでした", "无法安装更新"],
  "로그 파일을 열지 못했습니다": ["Could not open the log file", "ログファイルを開けませんでした", "无法打开日志文件"],
  "번역 기록을 정리하지 못했습니다": ["Could not clear translation history", "翻訳履歴を消去できませんでした", "无法清理翻译记录"],
  "설정을 초기화하지 못했습니다": ["Could not reset settings", "設定を初期化できませんでした", "无法重置设置"],
  "자동 시작 설정을 변경하지 못했습니다": ["Could not change the startup setting", "自動起動の設定を変更できませんでした", "无法更改自动启动设置"],
  "저장 공간 정보를 확인하지 못했습니다": ["Could not check storage information", "ストレージ情報を確認できませんでした", "无法检查存储信息"],
  "Discord 접근성 모드를 준비할까요?": ["Prepare Discord accessibility mode?", "Discordのアクセシビリティモードを準備しますか？", "是否准备 Discord 辅助功能模式？"],
  "NudeNyang과 Sentory가 함께 사용할 수 있는 안전한 접근성 모드가 필요합니다. 현재 Discord가 일반 모드라면 최초 전환 때 한 번만 다시 시작하며, 서버를 이동할 때는 다시 시작하지 않습니다.\n\n재시작 전에 작성 중인 메시지와 통화를 확인해 주세요.": ["NudeNyang and Sentory need a secure accessibility mode they can share. If Discord is currently in normal mode, it restarts only once during the initial transition and does not restart when you switch servers.\n\nCheck any message you are typing and active calls before restarting.", "NudeNyangとSentoryが共用できる安全なアクセシビリティモードが必要です。Discordが通常モードの場合、初回切り替え時に一度だけ再起動し、サーバー移動時には再起動しません。\n\n再起動前に入力中のメッセージと通話を確認してください。", "NudeNyang 和 Sentory 需要可共同使用的安全辅助功能模式。如果 Discord 当前处于普通模式，仅在首次切换时重启一次，切换服务器时不会重启。\n\n重启前请确认正在输入的消息和通话。"],
  "확인하고 준비": ["Confirm and prepare", "確認して準備", "确认并准备"],
  "이번 번역 실행에서 자동 재시작을 이미 한 번 시도했습니다. Discord를 직접 종료한 후 다시 실행하십시오.": ["An automatic restart has already been attempted during this translation session. Close Discord completely and start it again.", "今回の翻訳実行では自動再起動をすでに一度試しました。Discordを完全に終了してから、もう一度起動してください。", "本次翻译运行中已尝试过一次自动重启。请完全退出 Discord 后重新启动。"],
  "Discord 접근성 모드를 준비합니다": ["Preparing Discord accessibility mode", "Discordのアクセシビリティモードを準備しています", "正在准备 Discord 辅助功能模式"],
  "지금 재시작": ["Restart now", "今すぐ再起動", "立即重启"],
  "Discord 재시작 중": ["Restarting Discord", "Discordを再起動中", "正在重启 Discord"],
  "설치 중": ["Installing", "インストール中", "正在安装"],
  "로그인 중": ["Signing in", "ログイン中", "正在登录"],
  "취소": ["Cancel", "キャンセル", "取消"],
  "취소 중": ["Cancelling", "キャンセル中", "正在取消"],
  "터미널 열기": ["Open terminal", "ターミナルを開く", "打开终端"],
  "이동": ["Continue", "移動", "继续"],
  "로그인 준비가 완료되지 않았습니다. 잠시 후 다시 시도하십시오.": ["Sign-in is not ready yet. Try again shortly.", "ログインの準備がまだ完了していません。しばらくしてからもう一度お試しください。", "登录尚未准备完成，请稍后重试。"],
  "Antigravity 로그인 터미널을 준비하고 있습니다. 잠시 기다리십시오.": ["Preparing the Antigravity sign-in terminal. Please wait.", "Antigravityのログインターミナルを準備しています。しばらくお待ちください。", "正在准备 Antigravity 登录终端，请稍候。"],
  "Antigravity 최초 로그인을 진행하려면 터미널 열기를 선택하십시오.": ["Select Open terminal to complete the first Antigravity sign-in.", "Antigravityの初回ログインを行うには「ターミナルを開く」を選択してください。", "请选择“打开终端”以完成 Antigravity 首次登录。"],
  "열린 터미널에서 Google OAuth를 선택하십시오.\n브라우저 로그인 후 인증 코드를 터미널에 붙여넣으면 앱이 완료를 자동으로 감지합니다.": ["Select Google OAuth in the opened terminal.\nAfter signing in through the browser, paste the authorization code into the terminal. The app will detect completion automatically.", "開いたターミナルでGoogle OAuthを選択してください。\nブラウザでログインした後、認証コードをターミナルに貼り付けると、アプリが完了を自動で検出します。", "请在打开的终端中选择 Google OAuth。\n通过浏览器登录后，将授权码粘贴到终端，应用会自动检测完成状态。"],
  "DeepL API 키 확인 중": ["Checking DeepL API key", "DeepL APIキーを確認中", "正在检查 DeepL API 密钥"],
  "DeepL API 키": ["DeepL API key", "DeepL APIキー", "DeepL API 密钥"],
  "새 API 키 입력 시 변경": ["Enter a new API key to replace it", "新しいAPIキーを入力すると変更されます", "输入新的 API 密钥即可更换"],
  "라이선스 및 제3자 고지": ["Licenses and third-party notices", "ライセンスと第三者への通知", "许可证和第三方声明"],
  "열기": ["Open", "開く", "打开"],
  "뒤로": ["Back", "戻る", "返回"],
  "종료": ["Quit", "終了", "退出"],
  "연결 필요": ["Connection required", "接続が必要", "需要连接"],
  "상태 확인 중": ["Checking status", "状態を確認中", "正在检查状态"],
  "상태를 확인할 수 없음": ["Status unavailable", "状態を確認できません", "无法检查状态"],
  "요청을 처리할 수 없음": ["Could not process the request", "リクエストを処理できません", "无法处理请求"],
  "표시 언어를 바꾸지 못함": ["Could not change the display language", "表示言語を変更できません", "无法更改显示语言"],
  "번역 모델을 바꾸지 못함": ["Could not change the translation model", "翻訳モデルを変更できません", "无法更改翻译模型"],
  "오류": ["Error", "エラー", "错误"],
  "버전을 사용할 수 있습니다": ["version is available", "バージョンを利用できます", "版本可用"],
  "NudeNyang Translator 트레이 메뉴": ["NudeNyang Translator tray menu", "NudeNyang Translator トレイメニュー", "NudeNyang Translator 托盘菜单"],
  "표시 언어 선택": ["Select display language", "表示言語を選択", "选择显示语言"],
  "번역 모델 선택": ["Select translation model", "翻訳モデルを選択", "选择翻译模型"],
  "모델 다운로드 진행률": ["Model download progress", "モデルのダウンロード進行状況", "模型下载进度"],
  "설정 분류": ["Settings categories", "設定カテゴリ", "设置分类"],
  "프로젝트 링크": ["Project links", "プロジェクトリンク", "项目链接"],
  "Tauri 앱에서만 사용할 수 있는 기능입니다.": ["This feature is available only in the Tauri app.", "この機能はTauriアプリでのみ使用できます。", "此功能仅可在 Tauri 应用中使用。"],
  "허용되지 않은 외부 주소입니다.": ["This external address is not allowed.", "許可されていない外部アドレスです。", "不允许访问此外部地址。"],
  "DeepL API 키를 입력하십시오.": ["Enter a DeepL API key.", "DeepL APIキーを入力してください。", "请输入 DeepL API 密钥。"],
  "지원하지 않는 계정 로그인 방식입니다.": ["This account sign-in method is not supported.", "このアカウントログイン方式には対応していません。", "不支持此账户登录方式。"],
  "DeepL API 키를 저장하지 못했습니다.": ["Could not save the DeepL API key.", "DeepL APIキーを保存できませんでした。", "无法保存 DeepL API 密钥。"],
  "번역 서비스": ["Translation service", "翻訳サービス", "翻译服务"],
  "로컬 모델은 번역 기능을 켤 때 준비합니다.": ["The local model will be prepared when translation is enabled.", "ローカルモデルは翻訳機能をオンにしたときに準備します。", "本地模型将在开启翻译功能时准备。"],
  "표시 언어를 변경했습니다.": ["Display language changed.", "表示言語を変更しました。", "已更改显示语言。"],
  "이미지 OCR과 번역을 처리하고 있습니다. 최초 실행 시에는 모델 준비에 시간이 걸릴 수 있습니다.": ["Processing image OCR and translation. Preparing models may take some time on the first run.", "画像OCRと翻訳を処理しています。初回実行時はモデルの準備に時間がかかる場合があります。", "正在处理图片 OCR 和翻译。首次运行时准备模型可能需要一些时间。"],
  "번역 서비스가 요청한 메시지 수와 다른 결과를 반환했습니다.": ["The translation service returned a different number of results than requested.", "翻訳サービスが要求したメッセージ数と異なる件数の結果を返しました。", "翻译服务返回的结果数量与请求的消息数量不同。"],
  "캐시된 이미지 번역을 적용했습니다.": ["Applied the cached image translation.", "キャッシュ済みの画像翻訳を適用しました。", "已应用缓存的图片翻译。"],
  "번역할 이미지 텍스트를 찾지 못했습니다.": ["No image text was found to translate.", "翻訳できる画像内テキストが見つかりませんでした。", "未找到可翻译的图片文字。"],
  "Codex CLI와 로그인 상태를 확인하고 있습니다.": ["Checking Codex CLI and sign-in status.", "Codex CLIとログイン状態を確認しています。", "正在检查 Codex CLI 和登录状态。"],
  "Claude Code와 로그인 상태를 확인하고 있습니다.": ["Checking Claude Code and sign-in status.", "Claude Codeとログイン状態を確認しています。", "正在检查 Claude Code 和登录状态。"],
  "Antigravity CLI와 로그인 상태를 확인하고 있습니다.": ["Checking Antigravity CLI and sign-in status.", "Antigravity CLIとログイン状態を確認しています。", "正在检查 Antigravity CLI 和登录状态。"],
  "API 사용량 과금": ["Usage-based API billing", "API使用量に応じた課金", "按 API 使用量计费"],
  "저장된 API 키를 확인하고 있습니다.": ["Checking the saved API key.", "保存済みのAPIキーを確認しています。", "正在检查已保存的 API 密钥。"],
  "구독 서비스 인증은 각 공식 CLI에서 관리하며 API 키는 운영체제 보안 저장소에 보관합니다.": ["Subscription authentication is managed by each official CLI, and API keys are stored in the operating system secure storage.", "サブスクリプションサービスの認証は各公式CLIで管理され、APIキーはOSのセキュアストレージに保存されます。", "订阅服务身份验证由各官方 CLI 管理，API 密钥保存在操作系统安全存储中。"],
  "ChatGPT 계정으로 연결되어 있습니다.": ["Connected with a ChatGPT account.", "ChatGPTアカウントで接続されています。", "已连接 ChatGPT 账户。"],
  "Codex CLI는 설치되어 있지만 ChatGPT 로그인이 필요합니다.": ["Codex CLI is installed, but ChatGPT sign-in is required.", "Codex CLIはインストールされていますが、ChatGPTへのログインが必要です。", "Codex CLI 已安装，但需要登录 ChatGPT。"],
  "Gemini가 Google Antigravity 플랜 계정으로 연결되어 있습니다.": ["Gemini is connected with a Google Antigravity plan account.", "GeminiはGoogle Antigravityプランのアカウントで接続されています。", "Gemini 已连接 Google Antigravity 订阅账户。"],
  "Google Antigravity CLI는 설치되어 있지만 로그인이 필요합니다.": ["Google Antigravity CLI is installed, but sign-in is required.", "Google Antigravity CLIはインストールされていますが、ログインが必要です。", "Google Antigravity CLI 已安装，但需要登录。"],
  "Gemini CLI가 Google 플랜 계정으로 실행되도록 설정되어 있습니다.": ["Gemini CLI is configured to use a Google plan account.", "Gemini CLIはGoogleプランのアカウントで実行するよう設定されています。", "Gemini CLI 已配置为使用 Google 订阅账户运行。"],
  "Gemini CLI 로그인 정보가 불완전합니다. Google 계정을 다시 연결하십시오.": ["Gemini CLI sign-in information is incomplete. Reconnect the Google account.", "Gemini CLIのログイン情報が不完全です。Googleアカウントを再接続してください。", "Gemini CLI 登录信息不完整，请重新连接 Google 账户。"],
  "Claude 계정으로 연결되어 있습니다.": ["Connected with a Claude account.", "Claudeアカウントで接続されています。", "已连接 Claude 账户。"],
  "Claude Code는 설치되어 있지만 Claude 로그인이 필요합니다.": ["Claude Code is installed, but Claude sign-in is required.", "Claude Codeはインストールされていますが、Claudeへのログインが必要です。", "Claude Code 已安装，但需要登录 Claude。"],
  "API 키가 운영체제 보안 저장소에 저장되어 있습니다.": ["The API key is stored in the operating system secure storage.", "APIキーはOSのセキュアストレージに保存されています。", "API 密钥已保存在操作系统安全存储中。"],
  "DeepL API Free 또는 Pro 키를 입력하여 연결하십시오.": ["Enter a DeepL API Free or Pro key to connect.", "DeepL API FreeまたはProキーを入力して接続してください。", "请输入 DeepL API Free 或 Pro 密钥以连接。"],
  "Codex CLI가 설치되어 있지 않습니다. 설치를 선택하여 연결 준비를 시작하십시오.": ["Codex CLI is not installed. Select Install to prepare the connection.", "Codex CLIがインストールされていません。「インストール」を選択して接続準備を開始してください。", "Codex CLI 未安装。请选择“安装”以准备连接。"],
  "Claude Code가 설치되어 있지 않습니다. 설치를 선택하여 연결 준비를 시작하십시오.": ["Claude Code is not installed. Select Install to prepare the connection.", "Claude Codeがインストールされていません。「インストール」を選択して接続準備を開始してください。", "Claude Code 未安装。请选择“安装”以准备连接。"],
  "Google Antigravity CLI가 설치되어 있지 않습니다. 설치를 선택하여 연결 준비를 시작하십시오.": ["Google Antigravity CLI is not installed. Select Install to prepare the connection.", "Google Antigravity CLIがインストールされていません。「インストール」を選択して接続準備を開始してください。", "Google Antigravity CLI 未安装。请选择“安装”以准备连接。"],
  "DeepL API 키의 유효성을 확인하고 있습니다.": ["Checking the DeepL API key.", "DeepL APIキーの有効性を確認しています。", "正在检查 DeepL API 密钥的有效性。"],
  "계정 로그인 절차를 시작하고 있습니다.": ["Starting the account sign-in process.", "アカウントのログイン手続きを開始しています。", "正在启动账户登录流程。"],
  "F1~F24 또는 Ctrl·Alt·Shift와 일반 키를 함께 입력하십시오.": ["Enter F1-F24 or a regular key combined with Ctrl, Alt, or Shift.", "F1～F24、またはCtrl・Alt・Shiftと一般キーの組み合わせを入力してください。", "请输入 F1-F24，或 Ctrl、Alt、Shift 与普通按键的组合。"],
  "단축키를 적용하지 못했습니다.": ["Could not apply the shortcut.", "ショートカットを適用できませんでした。", "无法应用快捷键。"],
  "새 단축키 조합을 입력하십시오. Esc를 누르면 취소됩니다.": ["Enter a new shortcut combination. Press Esc to cancel.", "新しいショートカットの組み合わせを入力してください。Escでキャンセルできます。", "请输入新的快捷键组合。按 Esc 可取消。"],
  "운영체제 보안 저장소에서 DeepL API 키를 삭제합니다. DeepL이 선택되어 있으면 로컬 기본 모델로 전환합니다.": ["Delete the DeepL API key from the operating system secure storage. If DeepL is selected, switch to the default local model.", "OSのセキュアストレージからDeepL APIキーを削除します。DeepLが選択されている場合は、標準のローカルモデルへ切り替えます。", "从操作系统安全存储中删除 DeepL API 密钥。如果当前选择了 DeepL，将切换到默认本地模型。"],
  "CLI 로그인 정보와 설치 상태는 유지되며 NudeNyang Translator에서만 사용을 중지합니다. 해당 서비스가 선택되어 있으면 로컬 기본 모델로 전환합니다.": ["Keep the CLI sign-in and installation, but disable the service only in NudeNyang Translator. If the service is selected, switch to the default local model.", "CLIのログイン情報とインストール状態は保持し、NudeNyang Translatorでのみ使用を停止します。そのサービスが選択されている場合は、標準のローカルモデルへ切り替えます。", "保留 CLI 登录信息和安装状态，仅在 NudeNyang Translator 中停用该服务。如果当前选择了该服务，将切换到默认本地模型。"],
  "켜짐": ["On", "オン", "开启"],
  "꺼짐": ["Off", "オフ", "关闭"],
  "사용": ["On", "使用", "启用"],
  "사용 안 함": ["Off", "使用しない", "不启用"],
  "유지": ["Keep", "保持", "保持"],
  "반환": ["Release", "解放", "释放"],
  "최근 대화에서 자동 감지": ["Detect from recent messages", "最近の会話から自動検出", "根据最近对话自动检测"],
  "자동 (GPU 우선, CPU 대체)": ["Automatic (GPU first, CPU fallback)", "自動（GPU優先、CPU代替）", "自动（GPU 优先，CPU 备用）"],
  "CPU/RAM 전용": ["CPU/RAM only", "CPU/RAMのみ", "仅 CPU/RAM"],
  "저사양 권장 설정을 적용했습니다.": ["Applied the low-spec preset.", "低スペック向け設定を適用しました。", "已应用低配置推荐设置。"],
  "저사양 권장 설정을 적용하지 못했습니다": ["Could not apply the low-spec preset", "低スペック向け設定を適用できませんでした", "无法应用低配置推荐设置"],
  "VRAM이 부족하거나 GPU를 사용할 수 없어 CPU/RAM 전용 모드로 전환했습니다.": ["VRAM was insufficient or the GPU was unavailable, so the app switched to CPU/RAM-only mode.", "VRAM不足またはGPUを使用できないため、CPU/RAMのみのモードに切り替えました。", "由于 VRAM 不足或 GPU 不可用，已切换到仅 CPU/RAM 模式。"],
  "GPU 실행에 실패해 시스템 RAM을 사용하는 CPU 모드로 다시 준비하고 있습니다.": ["GPU startup failed. Preparing again in CPU mode using system RAM.", "GPUでの起動に失敗したため、システムRAMを使用するCPUモードで再準備しています。", "GPU 启动失败，正在使用系统 RAM 的 CPU 模式重新准备。"],
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

export const DYNAMIC_TEMPLATE_COPY = Object.freeze({
  "{seconds}초 후 Discord를 자동으로 다시 시작합니다.": ["Discord will restart automatically in {seconds} seconds."],
  "이미지에서 {count}개 글자 영역을 번역했습니다.": ["Translated {count} text regions in the image."],
  "표시 번역은 {display}, 실시간 통역은 {outgoing}을 사용합니다.": ["Display translation uses {display}, and real-time interpretation uses {outgoing}."],
  "{model} 준비를 백그라운드에서 시작했습니다. 완료 전까지 현재 모델로 계속 번역합니다.": ["Started preparing {model} in the background. The current model will remain in use until it is ready."],
  "번역 모델 준비 실패: {error}": ["Translation model preparation failed: {error}"],
  "이미지를 읽지 못했습니다: {error}": ["Could not read the image: {error}"],
  "이미지 번역에 실패했습니다: {error}": ["Image translation failed: {error}"],
  "로컬 모델 예열에 실패했습니다: {error}": ["Local model warm-up failed: {error}"],
  "Discord가 아직 접근성 호환 모드로 실행되지 않았습니다.\n작성 중인 메시지가 사라지거나 통화가 종료될 수 있습니다.\n\n{seconds}초 후 최초 전환을 위해 Discord를 한 번 다시 시작합니다.": ["Discord is not running in accessibility-compatible mode yet.\nA message you are typing may be discarded or a call may end.\n\nDiscord will restart once for the initial transition in {seconds} seconds."],
  "{name} CLI와 필요한 실행 환경을 자동으로 설치하고 있습니다.": ["Installing {name} CLI and its required runtime automatically."],
  "{name} 계정 연결": ["Connect {name} account"],
  "{name} CLI 로그인 정보는 유지되며 NudeNyang Translator에서만 사용을 중지했습니다.": ["{name} CLI sign-in is retained and disabled only in NudeNyang Translator."],
  "{name} 공식 로그인 페이지를 준비하고 있습니다. 잠시 기다리십시오.": ["Preparing the official {name} sign-in page. Please wait."],
  "{name} 계정 로그인을 취소하고 있습니다.": ["Cancelling {name} account sign-in."],
  "{name} 공식 로그인 페이지로 이동하려면 이동을 선택하십시오.": ["Select Continue to open the official {name} sign-in page."],
  "브라우저에서 {account} 로그인을 완료하십시오.\n로그인이 완료되면 이 창이 자동으로 닫힙니다.": ["Complete {account} sign-in in the browser.\nThis window will close automatically when sign-in finishes."],
  "{name} 연결을 해제하시겠습니까?": ["Disconnect {name}?"],
  "{shortcut}로 적용되었습니다.": ["Applied {shortcut}."],
  "{shortcut} 적용 중": ["Applying {shortcut}"],
  "로컬 모델 파일 {size}를 삭제했습니다.": ["Deleted {size} of local model files."],
  "번역 기록 {count}건을 정리했습니다.": ["Cleared {count} translation history records."],
  "{model} 모델 다운로드 중": ["Downloading {model} model"],
  "{model} 모델 파일 확인 중": ["Verifying {model} model file"],
  "{model} 모델 불러오는 중": ["Loading {model} model"],
  "{model} 모델 준비 대기 중": ["Waiting to prepare {model} model"],
  "{model} CPU/RAM 전용 모드로 전환 중": ["Switching {model} to CPU/RAM-only mode"],
  "{downloaded} / {total} 다운로드됨": ["{downloaded} / {total} downloaded"],
  "{total} 다운로드 완료 · 파일 무결성을 확인하고 있습니다.": ["{total} downloaded · Verifying file integrity."],
  "{total} 다운로드 완료 · 번역 엔진을 준비하고 있습니다.": ["{total} downloaded · Preparing the translation engine."],
  "같은 로컬 모델 준비 작업이 끝나기를 기다리고 있습니다.": ["Waiting for the shared local model preparation to finish."],
  "선택한 번역 모델: {model}. 번역 준비가 완료되었습니다.": ["Selected translation model: {model}. Translation is ready."],
  "선택한 번역 모델: {model}. 번역을 켜면 모델을 준비합니다.": ["Selected translation model: {model}. The model will be prepared when translation is enabled."],
  "새 버전 {version}을 사용할 수 있습니다.": ["Version {version} is available."],
  "{version} 버전을 설치할 수 있습니다. 지금 설치하면 앱이 다시 실행됩니다. 작업 중이라면 나중에 설치해도 됩니다.": ["Version {version} is available. Installing it now will restart the app. You can install it later if you are working."],
  "{version} 업데이트를 다운로드하고 있습니다...": ["Downloading update {version}..."],
  "업데이트 다운로드 중 {progress}": ["Downloading update {progress}"],
  "업데이트 확인 실패: {error}": ["Update check failed: {error}"],
  "업데이트 설치 실패: {error}": ["Update installation failed: {error}"],
  "{binding} 전역 단축키를 등록하지 못했습니다. 다른 앱에서 이 단축키를 사용 중입니다. 다른 조합을 선택하십시오.": [
    "Could not register the {binding} global shortcut. Another app is already using this shortcut. Choose a different combination.",
    "{binding} グローバルショートカットを登録できませんでした。このショートカットは別のアプリですでに使用されています。別の組み合わせを選択してください。",
    "无法注册 {binding} 全局快捷键。其他应用已在使用此快捷键，请选择其他组合。",
  ],
  "예기치 않은 오류가 발생했습니다. 자세한 내용은 진단 로그를 확인하십시오.": [
    "An unexpected error occurred. Check the diagnostic log for details.",
    "予期しないエラーが発生しました。詳細は診断ログを確認してください。",
    "发生意外错误。请查看诊断日志了解详情。",
  ],
});

const LANGUAGE_INDEX = Object.freeze({ en: 0, ja: 1, zh: 2 });
const SUPPORTED_UI_LANGUAGES = Object.freeze([
  "ko", "en", "ja", "zh", "zh-Hant", "pt-BR", "hi", "es-419", "de", "ru",
  "id", "fr", "tr", "ar", "vi", "it", "pl", "uk", "ms", "nl",
  "th", "fil", "bn", "ur", "ta", "fa", "he", "cs",
]);

function canonicalUiLanguage(language) {
  const normalized = String(language || "").trim().replaceAll("_", "-").toLowerCase();
  if (normalized.startsWith("zh")) {
    return /(?:^|-)hant(?:-|$)/.test(normalized) || /^zh-(tw|hk|mo)(?:-|$)/.test(normalized)
      ? "zh-Hant"
      : "zh";
  }
  if (normalized.startsWith("pt")) return "pt-BR";
  if (normalized.startsWith("es")) return "es-419";
  if (normalized === "in" || normalized.startsWith("in-")) return "id";
  return SUPPORTED_UI_LANGUAGES.find(code => (
    normalized === code.toLowerCase() || normalized.startsWith(`${code.toLowerCase()}-`)
  )) || "en";
}

export function resolveUiLanguage(language, systemLanguage = globalThis.navigator?.language) {
  return canonicalUiLanguage(language === "auto" ? systemLanguage : language);
}

export function translateCopy(language, korean) {
  language = resolveUiLanguage(language);
  if (korean === "UI Language" || korean === "Auto (System)") return korean;
  if (language === "ko") return korean;
  const index = LANGUAGE_INDEX[language];
  const source = COPY[korean] || DYNAMIC_TEMPLATE_COPY[korean];
  if (index !== undefined) return source?.[index] || source?.[0] || korean;
  return UI_LOCALE_COPY[language]?.[korean] || source?.[0] || korean;
}

export const DYNAMIC_COPY = Object.freeze([
  {
    pattern: /^(\d+)초 후 Discord를 자동으로 다시 시작합니다\.$/,
    render: {
      en: seconds => `Discord will restart automatically in ${seconds} seconds.`,
      ja: seconds => `${seconds}秒後にDiscordを自動で再起動します。`,
      zh: seconds => `Discord 将在 ${seconds} 秒后自动重启。`,
    },
  },
  {
    pattern: /^이미지에서 (\d+)개 글자 영역을 번역했습니다\.$/,
    render: {
      en: count => `Translated ${count} text regions in the image.`,
      ja: count => `画像内の文字領域を${count}件翻訳しました。`,
      zh: count => `已翻译图片中的 ${count} 个文字区域。`,
    },
  },
  {
    pattern: /^표시 번역은 (.+), 실시간 통역은 (.+)을 사용합니다\.$/,
    render: {
      en: (display, outgoing) => `Display translation uses ${translateCopy("en", display)}, and real-time interpretation uses ${translateCopy("en", outgoing)}.`,
      ja: (display, outgoing) => `表示翻訳には${translateCopy("ja", display)}、リアルタイム通訳には${translateCopy("ja", outgoing)}を使用します。`,
      zh: (display, outgoing) => `显示翻译使用 ${translateCopy("zh", display)}，实时翻译使用 ${translateCopy("zh", outgoing)}。`,
    },
  },
  {
    pattern: /^(.+) 준비를 백그라운드에서 시작했습니다\. 완료 전까지 현재 모델로 계속 번역합니다\.$/,
    render: {
      en: model => `Started preparing ${translateCopy("en", model)} in the background. The current model will remain in use until it is ready.`,
      ja: model => `${translateCopy("ja", model)}の準備をバックグラウンドで開始しました。完了するまでは現在のモデルで翻訳を続けます。`,
      zh: model => `已在后台开始准备 ${translateCopy("zh", model)}。准备完成前将继续使用当前模型翻译。`,
    },
  },
  {
    pattern: /^(번역 모델 준비 실패|이미지를 읽지 못했습니다|이미지 번역에 실패했습니다|로컬 모델 예열에 실패했습니다): (.+)$/,
    render: {
      en: (kind, error) => `${({
        "번역 모델 준비 실패": "Translation model preparation failed",
        "이미지를 읽지 못했습니다": "Could not read the image",
        "이미지 번역에 실패했습니다": "Image translation failed",
        "로컬 모델 예열에 실패했습니다": "Local model warm-up failed",
      })[kind]}: ${translateUserFacingError("en", error)}`,
      ja: (kind, error) => `${({
        "번역 모델 준비 실패": "翻訳モデルの準備に失敗しました",
        "이미지를 읽지 못했습니다": "画像を読み込めませんでした",
        "이미지 번역에 실패했습니다": "画像翻訳に失敗しました",
        "로컬 모델 예열에 실패했습니다": "ローカルモデルの常駐に失敗しました",
      })[kind]}: ${translateUserFacingError("ja", error)}`,
      zh: (kind, error) => `${({
        "번역 모델 준비 실패": "翻译模型准备失败",
        "이미지를 읽지 못했습니다": "无法读取图片",
        "이미지 번역에 실패했습니다": "图片翻译失败",
        "로컬 모델 예열에 실패했습니다": "本地模型预热失败",
      })[kind]}：${translateUserFacingError("zh", error)}`,
    },
  },
  {
    pattern: /^Discord가 아직 접근성 호환 모드로 실행되지 않았습니다\.\n작성 중인 메시지가 사라지거나 통화가 종료될 수 있습니다\.\n\n(\d+)초 후 최초 전환을 위해 Discord를 한 번 다시 시작합니다\.$/,
    render: {
      en: seconds => `Discord is not running in accessibility-compatible mode yet.\nA message you are typing may be discarded or a call may end.\n\nDiscord will restart once for the initial transition in ${seconds} seconds.`,
      ja: seconds => `Discordはまだアクセシビリティ互換モードで動作していません。\n入力中のメッセージが消えたり、通話が終了したりする場合があります。\n\n初回切り替えのため、${seconds}秒後にDiscordを一度再起動します。`,
      zh: seconds => `Discord 尚未以辅助功能兼容模式运行。\n正在输入的消息可能会丢失，通话也可能会结束。\n\nDiscord 将在 ${seconds} 秒后为首次切换重启一次。`,
    },
  },
  {
    pattern: /^(.+) CLI와 필요한 실행 환경을 자동으로 설치하고 있습니다\.$/,
    render: {
      en: name => `Installing ${name} CLI and its required runtime automatically.`,
      ja: name => `${name} CLIと必要な実行環境を自動でインストールしています。`,
      zh: name => `正在自动安装 ${name} CLI 及其所需运行环境。`,
    },
  },
  {
    pattern: /^(.+) 계정 연결$/,
    render: {
      en: name => `Connect ${name} account`,
      ja: name => `${name}アカウントに接続`,
      zh: name => `连接 ${name} 账户`,
    },
  },
  {
    pattern: /^(.+) CLI 로그인 정보는 유지되며 NudeNyang Translator에서만 사용을 중지했습니다\.$/,
    render: {
      en: name => `${name} CLI sign-in is retained and disabled only in NudeNyang Translator.`,
      ja: name => `${name} CLIのログイン情報は保持され、NudeNyang Translatorでのみ使用を停止しました。`,
      zh: name => `${name} CLI 登录信息已保留，仅在 NudeNyang Translator 中停用。`,
    },
  },
  {
    pattern: /^(.+) 공식 로그인 페이지를 준비하고 있습니다\. 잠시 기다리십시오\.$/,
    render: {
      en: name => `Preparing the official ${name} sign-in page. Please wait.`,
      ja: name => `${name}の公式ログインページを準備しています。しばらくお待ちください。`,
      zh: name => `正在准备 ${name} 官方登录页面，请稍候。`,
    },
  },
  {
    pattern: /^(.+) 계정 로그인을 취소하고 있습니다\.$/,
    render: {
      en: name => `Cancelling ${name} account sign-in.`,
      ja: name => `${name}アカウントへのログインをキャンセルしています。`,
      zh: name => `正在取消 ${name} 账户登录。`,
    },
  },
  {
    pattern: /^(.+) 공식 로그인 페이지로 이동하려면 이동을 선택하십시오\.$/,
    render: {
      en: name => `Select Continue to open the official ${name} sign-in page.`,
      ja: name => `${name}の公式ログインページへ移動するには「移動」を選択してください。`,
      zh: name => `请选择“继续”以打开 ${name} 官方登录页面。`,
    },
  },
  {
    pattern: /^브라우저에서 (.+) 로그인을 완료하십시오\.\n로그인이 완료되면 이 창이 자동으로 닫힙니다\.$/,
    render: {
      en: account => `Complete ${account} sign-in in the browser.\nThis window will close automatically when sign-in finishes.`,
      ja: account => `ブラウザで${account}へのログインを完了してください。\nログインが完了すると、この画面は自動で閉じます。`,
      zh: account => `请在浏览器中完成 ${account} 登录。\n登录完成后，此窗口会自动关闭。`,
    },
  },
  {
    pattern: /^(.+) 연결을 해제하시겠습니까\?$/,
    render: {
      en: name => `Disconnect ${name}?`,
      ja: name => `${name}との接続を解除しますか？`,
      zh: name => `要断开与 ${name} 的连接吗？`,
    },
  },
  {
    pattern: /^(.+)로 적용되었습니다\.$/,
    render: {
      en: shortcut => `Applied ${shortcut}.`,
      ja: shortcut => `${shortcut}を適用しました。`,
      zh: shortcut => `已应用 ${shortcut}。`,
    },
  },
  {
    pattern: /^(.+) 적용 중$/,
    render: {
      en: shortcut => `Applying ${shortcut}`,
      ja: shortcut => `${shortcut}を適用中`,
      zh: shortcut => `正在应用 ${shortcut}`,
    },
  },
  {
    pattern: /^로컬 모델 파일 ([0-9.]+(?:GB|MB|KB|B))를 삭제했습니다\.$/,
    render: {
      en: size => `Deleted ${size} of local model files.`,
      ja: size => `ローカルモデルファイル ${size} を削除しました。`,
      zh: size => `已删除 ${size} 的本地模型文件。`,
    },
  },
  {
    pattern: /^번역 기록 ([0-9]+)건을 정리했습니다\.$/,
    render: {
      en: count => `Cleared ${count} translation history records.`,
      ja: count => `翻訳履歴を ${count} 件削除しました。`,
      zh: count => `已清理 ${count} 条翻译记录。`,
    },
  },
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
    pattern: /^(.+) CPU\/RAM 전용 모드로 전환 중$/,
    render: {
      en: model => `Switching ${model} to CPU/RAM-only mode`,
      ja: model => `${model} をCPU/RAMのみのモードへ切り替え中`,
      zh: model => `正在将 ${model} 切换到仅 CPU/RAM 模式`,
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
      en: (kind, error) => `${kind === "업데이트 확인 실패" ? "Update check failed" : "Update installation failed"}: ${translateUserFacingError("en", error)}`,
      ja: (kind, error) => `${kind === "업데이트 확인 실패" ? "アップデートの確認に失敗しました" : "アップデートのインストールに失敗しました"}: ${translateUserFacingError("ja", error)}`,
      zh: (kind, error) => `${kind === "업데이트 확인 실패" ? "检查更新失败" : "安装更新失败"}：${translateUserFacingError("zh", error)}`,
    },
  },
]);

const DYNAMIC_TEMPLATE_RESOLVERS = Object.freeze([
  ([seconds]) => ["{seconds}초 후 Discord를 자동으로 다시 시작합니다.", { seconds }],
  ([count]) => ["이미지에서 {count}개 글자 영역을 번역했습니다.", { count }],
  ([display, outgoing], language) => [
    "표시 번역은 {display}, 실시간 통역은 {outgoing}을 사용합니다.",
    { display: translateCopy(language, display), outgoing: translateCopy(language, outgoing) },
  ],
  ([model], language) => [
    "{model} 준비를 백그라운드에서 시작했습니다. 완료 전까지 현재 모델로 계속 번역합니다.",
    { model: translateCopy(language, model) },
  ],
  ([kind, error], language) => [
    `${kind}: {error}`,
    { error: translateUserFacingError(language, error) },
  ],
  ([seconds]) => [
    "Discord가 아직 접근성 호환 모드로 실행되지 않았습니다.\n작성 중인 메시지가 사라지거나 통화가 종료될 수 있습니다.\n\n{seconds}초 후 최초 전환을 위해 Discord를 한 번 다시 시작합니다.",
    { seconds },
  ],
  ([name]) => ["{name} CLI와 필요한 실행 환경을 자동으로 설치하고 있습니다.", { name }],
  ([name]) => ["{name} 계정 연결", { name }],
  ([name]) => ["{name} CLI 로그인 정보는 유지되며 NudeNyang Translator에서만 사용을 중지했습니다.", { name }],
  ([name]) => ["{name} 공식 로그인 페이지를 준비하고 있습니다. 잠시 기다리십시오.", { name }],
  ([name]) => ["{name} 계정 로그인을 취소하고 있습니다.", { name }],
  ([name]) => ["{name} 공식 로그인 페이지로 이동하려면 이동을 선택하십시오.", { name }],
  ([account]) => ["브라우저에서 {account} 로그인을 완료하십시오.\n로그인이 완료되면 이 창이 자동으로 닫힙니다.", { account }],
  ([name]) => ["{name} 연결을 해제하시겠습니까?", { name }],
  ([shortcut]) => ["{shortcut}로 적용되었습니다.", { shortcut }],
  ([shortcut]) => ["{shortcut} 적용 중", { shortcut }],
  ([size]) => ["로컬 모델 파일 {size}를 삭제했습니다.", { size }],
  ([count]) => ["번역 기록 {count}건을 정리했습니다.", { count }],
  ([model]) => ["{model} 모델 다운로드 중", { model }],
  ([model]) => ["{model} 모델 파일 확인 중", { model }],
  ([model]) => ["{model} 모델 불러오는 중", { model }],
  ([model]) => ["{model} 모델 준비 대기 중", { model }],
  ([model]) => ["{model} CPU/RAM 전용 모드로 전환 중", { model }],
  ([downloaded, total]) => ["{downloaded} / {total} 다운로드됨", { downloaded, total }],
  ([total]) => ["{total} 다운로드 완료 · 파일 무결성을 확인하고 있습니다.", { total }],
  ([total]) => ["{total} 다운로드 완료 · 번역 엔진을 준비하고 있습니다.", { total }],
  () => ["같은 로컬 모델 준비 작업이 끝나기를 기다리고 있습니다.", {}],
  ([model], language) => [
    "선택한 번역 모델: {model}. 번역 준비가 완료되었습니다.",
    { model: translateCopy(language, model) },
  ],
  ([model], language) => [
    "선택한 번역 모델: {model}. 번역을 켜면 모델을 준비합니다.",
    { model: translateCopy(language, model) },
  ],
  ([version]) => ["새 버전 {version}을 사용할 수 있습니다.", { version }],
  ([version]) => [
    "{version} 버전을 설치할 수 있습니다. 지금 설치하면 앱이 다시 실행됩니다. 작업 중이라면 나중에 설치해도 됩니다.",
    { version },
  ],
  ([version]) => ["{version} 업데이트를 다운로드하고 있습니다...", { version }],
  ([progress]) => ["업데이트 다운로드 중 {progress}", { progress }],
  ([kind, error], language) => [
    `${kind}: {error}`,
    { error: translateUserFacingError(language, error) },
  ],
]);

function interpolateDynamicTemplate(template, values) {
  return template.replace(/\{([a-z]+)\}/gi, (placeholder, name) => (
    Object.hasOwn(values, name) ? String(values[name]) : placeholder
  ));
}

function translateDynamicTemplate(language, index, captures) {
  const resolver = DYNAMIC_TEMPLATE_RESOLVERS[index];
  if (!resolver) return "";
  const [key, values] = resolver(captures, language);
  const template = translateCopy(language, key);
  if (template === key) return "";
  return interpolateDynamicTemplate(template, values);
}

export function translateDynamicCopy(language, korean) {
  language = resolveUiLanguage(language);
  const value = String(korean ?? "");
  if (language === "ko" || !value) return value;
  const exact = translateCopy(language, value);
  if (exact !== value) return exact;
  for (const [index, entry] of DYNAMIC_COPY.entries()) {
    const match = value.match(entry.pattern);
    if (match) {
      if (entry.render[language]) return entry.render[language](...match.slice(1));
      return translateDynamicTemplate(language, index, match.slice(1))
        || entry.render.en(...match.slice(1));
    }
  }
  return value;
}

export function translateUserFacingError(language, error) {
  language = resolveUiLanguage(language);
  const value = String(error ?? "").replace(/^Error:\s*/, "").trim();
  if (!value || language === "ko") return value;

  const shortcut = value.match(/^(.+?) 전역 단축키를 등록하지 못했습니다:\s*(.+)$/);
  if (shortcut) {
    const [, binding, detail] = shortcut;
    if (/already registered/i.test(detail)) {
      return interpolateDynamicTemplate(
        translateCopy(
          language,
          "{binding} 전역 단축키를 등록하지 못했습니다. 다른 앱에서 이 단축키를 사용 중입니다. 다른 조합을 선택하십시오.",
        ),
        { binding },
      );
    }
  }

  const translated = translateDynamicCopy(language, value);
  if (translated !== value && !/[가-힣]/.test(translated)) return translated;

  const separator = value.indexOf(": ");
  const detail = separator >= 0 ? value.slice(separator + 2).trim() : "";
  const safeDetail = detail && !/[가-힣]/.test(detail) && !/HotKey\s*\{/i.test(detail)
    ? detail
    : "";
  const fallback = translateCopy(
    language,
    "예기치 않은 오류가 발생했습니다. 자세한 내용은 진단 로그를 확인하십시오.",
  );
  return safeDetail ? `${fallback} ${safeDetail}` : fallback;
}

function matchesKnownTranslation(value, key) {
  return value === key || COPY[key]?.includes(value)
    || Object.values(UI_LOCALE_COPY).some(dictionary => dictionary[key] === value);
}

export function applyStaticTranslations(root, language) {
  language = resolveUiLanguage(language);
  document.documentElement.lang = language === "zh" ? "zh-CN" : language === "zh-Hant" ? "zh-TW" : language;
  document.documentElement.dir = "ltr";
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
  for (const element of root.querySelectorAll("[aria-label], [placeholder], [title]")) {
    for (const attribute of ["aria-label", "placeholder", "title"]) {
      const value = element.getAttribute(attribute)?.trim();
      if (!value) continue;
      const datasetKey = attribute === "aria-label"
        ? "i18nAriaLabel"
        : attribute === "placeholder"
          ? "i18nPlaceholder"
          : "i18nTitle";
      let key = element.dataset[datasetKey];
      if (!key || !matchesKnownTranslation(value, key)) {
        key = COPY[value] ? value : "";
        if (key) element.dataset[datasetKey] = key;
      }
      if (key) element.setAttribute(attribute, translateCopy(language, key));
    }
  }
  for (const element of root.querySelectorAll("[data-tooltip]")) {
    const value = element.dataset.tooltip?.trim();
    if (!value) continue;
    let key = element.dataset.i18nTooltip;
    if (!key || !matchesKnownTranslation(value, key)) {
      key = COPY[value] ? value : "";
      if (key) element.dataset.i18nTooltip = key;
    }
    if (key) element.dataset.tooltip = translateCopy(language, key);
  }
}
