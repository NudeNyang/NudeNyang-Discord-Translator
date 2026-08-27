# 개인정보 처리방침 / Privacy Policy

최종 수정일: 2026-08-28

NudeNyang Discord Translator는 별도의 운영 서버를 두지 않으며, 개발자가 Discord 메시지, 웹페이지 텍스트, 이미지, 번역 기록, 방문한 페이지 주소 또는 인증 정보를 수집하거나 보관하지 않습니다.

이 문서의 **웹 메신저 읽기 번역**은 Windows 본체 `0.7.3-beta`와 웹 확장 `0.7.8`을 기준으로 설명합니다. 이전 공개 본체 `0.7.2-beta`는 이 기능의 설정과 처리 경로를 지원하지 않습니다. 확장의 제공 시점은 각 스토어의 심사 상태에 따라 다릅니다. 나머지 일반 웹·Discord 번역의 처리 방식과 구분하여 안내합니다.

## 로컬 처리

- Hy-MT2와 TranslateGemma 번역은 사용자 PC에서 처리됩니다.
- 이미지 픽셀은 PC 안에서 OCR과 합성에 사용되며 외부 번역 서비스로 전송되지 않습니다.
- 일반 번역의 설정, 번역 캐시와 번역 기록은 Windows 사용자 데이터 폴더에 저장됩니다. 보관 기간은 앱 설정에서 변경할 수 있습니다. 아래 웹 메신저 읽기 번역의 대화 본문과 번역문은 이 저장 경로를 사용하지 않습니다.
- 진단 로그에는 메시지 본문, 로컬 모델 프롬프트와 인증 비밀 값을 기록하지 않습니다.

## 브라우저 확장

- Chrome, Naver Whale과 Firefox 확장은 일반 HTTP/HTTPS 웹사이트에서 동작할 수 있으므로 브라우저가 모든 웹사이트의 데이터를 읽고 변경할 수 있다는 권한 경고를 표시할 수 있습니다. Firefox는 일반 웹 번역에서 Windows 앱으로 전달되는 허용 영역 텍스트를 `websiteContent`, 번역 중인 현재 페이지의 주소 범주를 `browsingActivity`로 명시합니다. 메신저 기능에는 별도 선택 항목인 `personalCommunications`를 사용합니다.
- 확장 백그라운드 시작·설치·브라우저 시작·창 포커스 변경과 주기적인 알람에서 같은 PC의 본체 연결을 확인하며, 일시 실패는 제한된 횟수로 재시도합니다. 연결 확인에는 브라우저 종류와 확장 버전이 포함되며, 페이지 본문이나 주소는 포함되지 않습니다. 연결 확인만으로 모델을 준비하거나 번역·개인정보 동의를 활성화하지 않습니다.
- 본체의 브라우저별 `연결 해제`는 해당 종류의 모든 프로필에서 본체 사용을 중지하는 로컬 설정입니다. 새 번역·설정 요청을 차단하고 대기 결과를 무효화하지만 확장 삭제, 브라우저 권한 또는 메신저 동의 철회를 대신하지 않으며 이미 표시한 번역문을 강제로 복원하지 않습니다. 다른 브라우저와 Discord의 설정은 유지됩니다. 연결 확인의 브라우저 종류·버전 기록은 갱신될 수 있지만 저장한 해제 상태를 자동으로 취소하지 않습니다.
- 전용 지원 사이트가 아닌 일반 웹사이트에서는 사용자가 해당 탭에서 F4를 누르거나 팝업 토글을 켜기 전까지 텍스트를 추출하거나 번역 요청을 보내지 않습니다. 사용자가 선택한 켜짐·꺼짐 상태는 탭을 닫을 때까지 유지되며, 같은 탭에서 페이지를 이동하거나 새로 고쳐도 이어집니다. 사이트 자동 번역 정책을 직접 저장하면 이후 해당 사이트 방문에서도 자동으로 시작할 수 있습니다.
- 일반 웹 번역 요청에는 화면과 가까운 제목, 문단, 목록, 인용문과 그림 설명의 허용된 텍스트와 페이지 구분용 주소가 포함됩니다. 페이지 구분용 주소는 프로토콜·호스트 이름·경로만 포함하며 쿼리 문자열과 해시는 포함하지 않습니다. Windows 앱은 이 값을 번역 요청과 문맥을 페이지별로 분리하는 데 사용합니다. 메신저의 대화 구분 방식은 아래에 별도로 설명합니다.
- 전체 HTML, 쿠키, 로그인 토큰과 방문 기록 목록은 읽거나 전달하지 않습니다. 현재 페이지 주소와 사이트 정책은 사용자가 요청한 웹 번역을 제공하기 위해서만 PC 안에서 처리하며, 개발자에게 전송되지 않습니다. 사이트별 정책에는 호스트 이름과 사용자가 선택한 동작만 로컬 설정으로 저장됩니다.
- 입력값, 편집기, 코드, 가격, 계정, 로그인, 결제, 주문, 관리와 개인 메시지 화면은 범용 번역에서 제외합니다. 일부 지원 사이트의 공개 고정 메뉴·안내 문구와 기사 본문은 명시된 영역에서만 허용합니다. 메신저 동의는 이 범용 차단을 전체 해제하는 권한이 아닙니다. Chrome·Whale·Firefox 내부 페이지와 로컬 파일에는 확장 스크립트를 주입하지 않습니다.
- 일반 웹 번역에서 로컬 모델을 선택하면 추출된 텍스트는 PC 안에서 처리됩니다. 외부 번역 서비스를 선택한 경우에만 번역에 필요한 허용 영역 텍스트가 해당 공급자에게 전달됩니다. 웹 메신저 읽기 번역에는 외부 서비스를 사용하지 않습니다.
- 개발자는 웹페이지 텍스트나 주소를 판매하거나 광고, 사용자 추적, 분석, 신용 평가 또는 번역과 무관한 목적으로 사용하지 않으며 사람이 열람할 수 있는 개발자 운영 서버로 전송하지 않습니다.

## 웹 메신저 읽기 번역 — 선택 기능

### 사용 조건과 처리 범위

- 기본값은 꺼짐입니다. Windows 앱의 `웹 메신저 읽기 번역` 설정을 켜고, 사용할 브라우저 프로필의 개인정보 안내에서 명시적으로 동의해야 합니다. 본체 설정을 켜거나 일반 웹 번역을 시작하는 것만으로 동의가 이루어지지 않으며, 다른 브라우저나 프로필의 동의도 대신하지 않습니다.
- Firefox에서는 동의 동작 중 선택 데이터 권한 `personalCommunications`도 요청합니다. 거부하거나 취소하면 동의를 저장하지 않으며, 브라우저에서 이 권한을 철회하면 기존 동의로 번역을 계속할 수 없습니다.
- 대상은 X DM, 웹 Discord, WhatsApp Web, Telegram Web, Messenger, Slack, Microsoft Teams, Google Messages의 식별 가능한 현재 열린 대화입니다. 활성 화면에서 보이는 메시지 본문을 읽습니다. 웹 Discord에서는 현재 대화에 표시된 링크 미리보기의 제목·설명·항목 텍스트와 현재 서버의 보이는 채널 이름도 포함합니다. DM 상대 목록이나 다른 서버의 채널 목록은 제외하며, 다른 대화를 열거나 숨겨진 메시지·첨부 파일·링크 대상 페이지를 가져오지 않습니다. 사이트 구조가 달라 대화를 안전하게 식별할 수 없으면 번역하지 않습니다.
- 채널 이름과 링크 미리보기를 포함하는 범위에는 동의 버전 2가 필요합니다. 이전의 메시지 본문 전용 동의는 자동으로 확대하지 않으며, 갱신된 안내에 사용자가 직접 동의하기 전에는 웹 메신저 번역을 시작하지 않습니다.
- 작성자 이름·연락처 목록·프로필, 작성창·입력값·미전송 초안, 전송 조작, 첨부 파일·이미지·음성·영상은 대상이 아닙니다. 이미 대화에 표시된 메시지의 읽기 번역만 수행하며 메시지를 작성하거나 전송하지 않습니다. 다만 메시지 본문 자체에 이름, 연락처 또는 민감한 정보가 적혀 있으면 해당 내용도 로컬 번역에 포함될 수 있습니다. 본문 속 개인정보를 자동으로 모두 찾아 지우는 기능은 아닙니다.
- Hy-MT2 또는 TranslateGemma 로컬 모델에서만 동작합니다. 외부 번역 서비스가 선택되어 있거나 로컬 처리 조건을 확인할 수 없으면 요청을 차단하며, 대화 내용을 외부 서비스로 자동 전환하여 처리하지 않습니다.
- 요청에는 허용된 본문과 목표 언어 등 번역에 필요한 정보, 서비스 구분, 동의 버전, 임의로 생성한 임시 대화 식별자가 포함되어 같은 PC의 Windows 본체로 전달됩니다. 실제 대화 URL·대화 ID·참여자 목록을 대화 식별자로 보내지 않습니다. 페이지 경로 등은 확장 안에서 대화 전환을 감지하는 데만 사용합니다.
- 이메일, 지원하지 않는 메신저, 로그인·계정·결제·주문·관리 화면의 기본 차단은 유지됩니다. 위 조건을 모두 만족하는 지원 대화의 본문 및 명시된 Discord 텍스트만 제한된 예외로 처리합니다.

### 보관·철회와 메모리 처리의 한계

확장 프로그램이 보관하는 대화 내용과 번역문은 메모리에서만 처리하며, 대화 전환 또는 종료 시 삭제합니다. 채널 이름과 링크 미리보기 텍스트에도 같은 규칙을 적용합니다. 디스크 캐시, 번역 기록 또는 본문 로그에 저장하지 않습니다. Windows 본체도 일반 번역 캐시·문맥과 분리된 요청 단위 임시 메모리 캐시를 사용합니다. 브라우저에 지속적으로 저장하는 것은 동의 버전과 번역 설정이며 대화 본문이나 번역문이 아닙니다.

동의를 철회하거나 본체의 기능 허용을 끄면 새 수집과 요청을 중단하고 확장이 보관한 사본과 대기 작업을 폐기합니다. 대화 전환·종료 뒤 늦게 도착하는 결과도 적용하지 않습니다. 여기서 삭제는 확장과 본체가 관리하는 사본의 보관을 끝낸다는 뜻이며, 메신저 사이트의 원문이나 서버 기록을 삭제하는 것은 아닙니다. 이미 진행 중인 모델 처리는 정리되기까지 시간이 걸릴 수 있습니다.

로컬 모델 요청에는 `cache_prompt=false`를 사용하지만, 이는 프롬프트 캐시 재사용을 제한하는 설정입니다. 다른 번역과 같은 모델 런타임을 공유하므로 별도의 격리된 모델 프로세스를 제공하거나 RAM·VRAM·모델 KV 캐시의 내용을 즉시 물리적으로 소거하는 것을 보장하지 않습니다. 운영체제와 모델 런타임이 관리하는 메모리 사본까지 안전하게 지워졌다는 보장도 하지 않습니다.

## 선택형 외부 서비스

일반 웹·Discord 번역에서는 사용자가 ChatGPT, Claude, Gemini 또는 DeepL을 번역 서비스로 직접 선택한 경우에만 번역에 필요한 텍스트가 해당 서비스로 전송됩니다. 이미지 번역에서는 PC 안에서 인식한 텍스트만 선택한 서비스로 전달되며 이미지 파일이나 픽셀은 전달하지 않습니다. 웹 메신저 읽기 번역은 이 외부 서비스 경로를 사용하지 않습니다.

외부 서비스의 데이터 처리는 각 공급자의 약관과 개인정보 처리방침을 따릅니다. 구독형 서비스 연결은 각 공급자의 공식 로컬 CLI 인증을 사용하며, DeepL API 키는 Windows 자격 증명 관리자에 저장합니다.

## 네트워크 사용

앱은 사용자가 요청한 기능을 위해 다음 네트워크 연결을 사용할 수 있습니다.

- 앱 업데이트 확인과 설치 파일 다운로드
- 사용자가 선택한 로컬 번역 모델 및 OCR 모델 다운로드
- 사용자가 선택한 외부 번역 서비스 연결과 번역 요청

사용자가 외부 번역 서비스를 선택하지 않으면 번역할 대화 텍스트를 외부 번역 서비스로 보내지 않습니다. 웹 메신저 읽기 번역의 대화 본문은 외부 번역 서비스 선택 여부와 관계없이 해당 서비스로 보내지 않습니다.

## 문의

개인정보 또는 데이터 처리에 관한 문의는 [GitHub Issues](https://github.com/NudeNyang/NudeNyang-Discord-Translator/issues)에 남길 수 있습니다.

---

## English

NudeNyang Discord Translator does not operate a developer-controlled backend. The developer does not collect or retain Discord messages, webpage text, images, translation history, visited page addresses, or credentials. Local processing and storage by the application are described separately below.

The web-messenger reading feature below describes Windows companion `0.7.3-beta` with extension `0.7.8`. The earlier published companion `0.7.2-beta` does not support its setting or processing path. Extension availability depends on each store's review status. This feature is separate from ordinary webpage and Discord translation.

Local models process translation on the user's PC. Image pixels remain local for OCR and compositing. For ordinary webpage and Discord translation, if the user explicitly selects ChatGPT, Claude, Gemini, or DeepL, only the text required for translation is sent to that provider under its own terms and privacy policy. Ordinary settings, caches, and history remain in the Windows user data directory. The web-messenger feature does not use those content-storage paths or external translation providers. DeepL credentials are stored in Windows Credential Manager, and subscription providers use their official local CLI authentication. Diagnostic logs do not record message bodies, local-model prompts, or authentication secrets.

The Chrome, Naver Whale, and Firefox extensions can run on ordinary HTTP/HTTPS websites, which may produce a browser warning that they can read and change data on all websites. Firefox declares eligible ordinary page text passed to the Windows app as `websiteContent` and the address category of the page being translated as `browsingActivity`. Web-messenger reading uses the separate optional category `personalCommunications`.

At background startup, installation, browser startup, window-focus changes, and periodic alarms, the extension checks its connection to the same-computer companion, with bounded retries for temporary failures. These checks include browser type and extension version, not webpage text or addresses. A connection check alone does not initialize a translation model, enable translation, or grant messenger consent.

The companion's browser-specific Disconnect action stores a local disabled setting for all profiles of that browser kind. It rejects new translation/settings requests and invalidates pending results, but does not uninstall the extension, revoke browser permissions or messenger consent, or force already displayed translations back to their originals. Other browser kinds and Discord settings are unchanged. Connection-only signals may update local browser-kind/version presence without cancelling the saved disabled setting.

On generic sites, extraction remains off until the user explicitly presses F4 or enables the popup toggle. The selected on or off state continues while that tab remains open, including after navigation or refresh. A site can also start automatically on future visits only when the user explicitly saves an automatic-translation policy for that hostname.

An ordinary webpage translation request contains eligible visible text near the viewport and a page identifier made from the current protocol, hostname, and path. Query strings and URL fragments are excluded. The Windows app uses this identifier only to separate translation requests and context by page. The extension does not read or transmit full HTML, cookies, authentication tokens, or a list of browsing history. The current page address and saved hostname policies are processed locally only to provide the requested translation and are not sent to the developer. Saved site policies contain only the hostname and the behavior selected by the user.

Input values, editable content, code, prices, account, login, payment, order, administration, and private-message surfaces are excluded from generic translation. Explicitly supported public fixed menus, instructions, and article bodies have narrowly scoped exceptions. Messenger consent does not remove the generic sensitive-page blocks. The extension does not inject into browser-internal pages or local files. The developer does not sell webpage text or addresses, use them for advertising, tracking, analytics, credit assessment, or unrelated purposes, or transmit them to a developer-operated server where a person could access them.

### Optional web-messenger reading

The feature is off by default. It requires both the Windows app's web-messenger setting and explicit consent in the current browser profile. Enabling ordinary translation or the app setting alone does not grant consent; consent in another browser or profile does not apply. Firefox also requests optional `personalCommunications` permission from the consent action. Refusal or cancellation does not save consent, and removing that permission prevents a previously saved consent from authorizing translation.

The supported surfaces are X DM, web Discord, WhatsApp Web, Telegram Web, Messenger, Slack, Microsoft Teams, and Google Messages. Visible message bodies in an identifiable currently open conversation are eligible. Web Discord also includes the titles, descriptions, and textual fields of link previews displayed in that conversation, plus visible channel names in the current server. DM contact lists and other servers' channel lists are excluded. The extension does not open other conversations or retrieve hidden messages, attachments, or linked pages. If it cannot safely identify a supported conversation, it does not translate it.

Consent version 2 covers the added Discord channel names and link-preview text. Previous message-body-only consent is not automatically expanded. Web-messenger translation remains blocked until the user explicitly accepts the updated notice.

Author names, contact lists, profiles, composers, input values, unsent drafts, send actions, attachments, images, audio, and video are excluded. This feature only translates messages already displayed in the conversation; it does not compose or send messages. Message bodies can themselves contain names, contact details, or other sensitive information, which may be included in local translation. This is not an automatic personal-data redaction feature.

Only local Hy-MT2 or TranslateGemma models are permitted. An external provider selection or an unverified local-processing condition blocks the request, rather than falling back to an external service. Eligible text is passed to the Windows companion on the same computer with translation settings, a service identifier, consent version, and a randomly generated temporary conversation identifier. The identifier is not the real conversation URL, conversation ID, or participant list. Routing information used to detect conversation changes stays within the extension. Email, unsupported messengers, and account, login, payment, order, and administration pages remain blocked.

Conversation content and translations retained by the extension are processed in memory only and discarded when the conversation changes or ends. The same rules apply to channel names and link-preview text. They are not stored in disk caches, translation history, or body logs. The Windows companion uses a separate request-scoped in-memory cache and context, not the ordinary translation cache. Only consent version and translation preferences persist in browser storage, not conversation text or translations.

Revoking consent or disabling the feature in the companion stops new collection and requests and discards extension-owned copies and pending work. Results arriving after a conversation change or closure are not applied. Discarding these copies does not delete the original messages or the messenger service's records. An inference already running may take time to finish and release its request data.

Requests set `cache_prompt=false` to restrict prompt-cache reuse. The model runtime is shared with other translations. This is **not** a separate isolated model process and does **not** guarantee immediate physical erasure of RAM, VRAM, or model KV caches, or secure erasure of copies managed by the operating system or model runtime.

Network access is limited to user-requested update checks, model downloads, and calls to an external translation provider selected for ordinary translation. Web-messenger reading never sends conversation bodies to an external translation provider. Privacy questions can be submitted through [GitHub Issues](https://github.com/NudeNyang/NudeNyang-Discord-Translator/issues).
