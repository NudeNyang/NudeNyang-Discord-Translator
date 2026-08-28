# 개인정보 처리방침 / Privacy Policy

최종 수정일: 2026-08-28

NudeNyang Discord Translator는 별도의 운영 서버를 두지 않으며, 개발자가 Discord 메시지, 웹페이지 텍스트, 이미지, 번역 기록, 방문한 페이지 주소 또는 인증 정보를 수집하거나 보관하지 않습니다.

이 문서는 동의 v3를 사용하는 미공개 개발 변경을 포함합니다. 버전 번호만으로 적용 여부를 판단하지 않으며 본체와 확장의 정책 기능 확인이 필요합니다. 공개 정책·설치 파일·스토어 고지는 이후 배포 시 함께 갱신해야 합니다.

## 로컬 처리

- Hy-MT2와 TranslateGemma 번역은 사용자 PC에서 처리됩니다.
- 이미지 픽셀은 PC 안에서 OCR과 합성에 사용되며 외부 번역 서비스로 전송되지 않습니다.
- 일반 번역의 설정, 번역 캐시와 번역 기록은 Windows 사용자 데이터 폴더에 저장됩니다. 보관 기간은 앱 설정에서 변경할 수 있습니다. 동의 v3를 받은 일반 창의 웹 메신저도 이 보관·삭제 정책을 공유합니다.
- 진단 로그에는 메시지 본문, 로컬 모델 프롬프트와 인증 비밀 값을 기록하지 않습니다.

## 브라우저 확장

- 확장 0.7.9의 설치·연결 도움말은 연결 성공 이력과 안내를 접었는지만 브라우저 로컬 저장소에 추가로 저장합니다. 웹페이지 본문·주소·대화 내용은 포함하지 않습니다. 본체 연결 해제나 메신저 동의를 자동으로 변경하지 않습니다.
- 사용자가 다운로드 안내를 열면 기존 GitHub 공개 업데이트 목록에서 최신 본체 버전과 x64·ARM64 설치형 링크를 확인합니다. 조회에는 쿠키·리퍼러·페이지 주소·본문·대화를 보내지 않으며 원격 코드를 실행하지 않습니다. GitHub는 일반 HTTPS 요청에 필요한 IP 주소 등 네트워크 정보를 처리할 수 있습니다. 파일은 사용자가 설치형 링크를 선택할 때만 다운로드됩니다. 설치나 브라우저 시작 시 다운로드 탭을 자동으로 열지 않습니다.

- Chrome, Naver Whale과 Firefox 확장은 일반 HTTP/HTTPS 웹사이트에서 동작할 수 있으므로 브라우저가 모든 웹사이트의 데이터를 읽고 변경할 수 있다는 권한 경고를 표시할 수 있습니다. Firefox는 일반 웹 번역에서 Windows 앱으로 전달되는 허용 영역 텍스트를 `websiteContent`, 번역 중인 현재 페이지의 주소 범주를 `browsingActivity`로 명시합니다. 메신저 기능에는 별도 선택 항목인 `personalCommunications`를 사용합니다.
- 확장 백그라운드 시작·설치·브라우저 시작·창 포커스 변경과 주기적인 알람에서 같은 PC의 본체 연결을 확인하며, 일시 실패는 제한된 횟수로 재시도합니다. 연결 확인에는 브라우저 종류와 확장 버전이 포함되며, 페이지 본문이나 주소는 포함되지 않습니다. 연결 확인만으로 모델을 준비하거나 번역·개인정보 동의를 활성화하지 않습니다.
- 본체의 브라우저별 `연결 해제`는 해당 종류의 모든 프로필에서 본체 사용을 중지하는 로컬 설정입니다. 새 번역·설정 요청을 차단하고 대기 결과를 무효화하지만 확장 삭제, 브라우저 권한 또는 메신저 동의 철회를 대신하지 않으며 이미 표시한 번역문을 강제로 복원하지 않습니다. 다른 브라우저와 Discord의 설정은 유지됩니다. 연결 확인의 브라우저 종류·버전 기록은 갱신될 수 있지만 저장한 해제 상태를 자동으로 취소하지 않습니다.
- 전용 지원 사이트가 아닌 일반 웹사이트에서는 사용자가 해당 탭에서 F4를 누르거나 팝업 토글을 켜기 전까지 텍스트를 추출하거나 번역 요청을 보내지 않습니다. 사용자가 선택한 켜짐·꺼짐 상태는 탭을 닫을 때까지 유지되며, 같은 탭에서 페이지를 이동하거나 새로 고쳐도 이어집니다. 사이트 자동 번역 정책을 직접 저장하면 이후 해당 사이트 방문에서도 자동으로 시작할 수 있습니다.
- 일반 웹 번역 요청에는 화면과 가까운 제목, 문단, 목록, 인용문과 그림 설명의 허용된 텍스트와 페이지 구분용 주소가 포함됩니다. 페이지 구분용 주소는 프로토콜·호스트 이름·경로만 포함하며 쿼리 문자열과 해시는 포함하지 않습니다. Windows 앱은 이 값을 번역 요청과 문맥을 페이지별로 분리하는 데 사용합니다. 메신저의 대화 구분 방식은 아래에 별도로 설명합니다.
- 전체 HTML, 쿠키, 로그인 토큰과 방문 기록 목록은 읽거나 전달하지 않습니다. 현재 페이지 주소와 사이트 정책은 사용자가 요청한 웹 번역을 제공하기 위해서만 PC 안에서 처리하며, 개발자에게 전송되지 않습니다. 사이트별 정책에는 호스트 이름과 사용자가 선택한 동작만 로컬 설정으로 저장됩니다.
- 입력값, 편집기, 코드, 가격, 계정, 로그인, 결제, 주문, 관리와 개인 메시지 화면은 범용 번역에서 제외합니다. 일부 지원 사이트의 공개 고정 메뉴·안내 문구와 기사 본문은 명시된 영역에서만 허용합니다. 메신저 동의는 이 범용 차단을 전체 해제하는 권한이 아닙니다. Chrome·Whale·Firefox 내부 페이지와 로컬 파일에는 확장 스크립트를 주입하지 않습니다.
- 일반 웹 번역에서 로컬 모델을 선택하면 추출된 텍스트는 PC 안에서 처리됩니다. 외부 번역 서비스를 선택한 경우에만 번역에 필요한 허용 영역 텍스트가 해당 공급자에게 전달됩니다. 동의 v3를 받은 웹 메신저에도 같은 번역기 선택이 적용됩니다.
- 개발자는 웹페이지 텍스트나 주소를 판매하거나 광고, 사용자 추적, 분석, 신용 평가 또는 번역과 무관한 목적으로 사용하지 않으며 사람이 열람할 수 있는 개발자 운영 서버로 전송하지 않습니다.

## 웹 메신저 읽기 번역

### 사용 조건과 처리 범위

- 별도 메신저 사용 스위치 없이 공통 웹 번역 설정, 탭의 켜기/끄기, 사이트 정책을 따릅니다. 브라우저 프로필에서 개인정보 안내에 동의하기 전에는 대화를 수집하지 않습니다. 동의 거절은 일반 웹 번역 사용을 막지 않습니다.
- 동의 v3는 앱에서 선택한 번역기와 본체 캐시의 보관·삭제 정책을 안내합니다. 외부 전송과 디스크 저장을 허용하지 않았던 v1/v2 동의는 자동 승격하지 않습니다. 본체의 `messengerPolicyVersion: 3`도 확인하며, 구형 본체·확장은 함께 업데이트해야 합니다. 이 변경은 아직 공개 릴리스되지 않았습니다.
- Firefox의 선택 권한 `personalCommunications`는 동의 버튼에서 요청합니다. 거절·취소·권한 철회 상태에서는 저장된 동의로 우회하지 않습니다. 다른 브라우저 프로필의 동의는 대신하지 않습니다.
- X DM, 웹 Discord, WhatsApp Web, Telegram Web, Messenger, Slack, Microsoft Teams, Google Messages의 안전하게 식별되는 현재 열린 대화만 지원합니다. 보이는 메시지 본문과 링크 미리보기 텍스트, 현재 Discord 서버의 보이는 채널 이름을 처리합니다. 다른 대화를 열거나 숨겨진 기록·첨부·링크 대상 페이지를 내려받지 않습니다.
- 작성자 이름·핸들·연락처 목록·프로필, 작성창·입력값·초안·전송 UI, 코드·첨부 파일·이미지·음성·영상은 제외합니다. 본문 자체의 민감한 정보까지 자동 익명화하는 기능은 아닙니다. 이메일·미지원 메신저·계정·결제 등 범용 민감 화면 차단은 유지합니다.
- 번역기는 앱 Discord와 동일한 선택을 따릅니다. 로컬 모델은 PC에서 처리하고, 선택한 외부 서비스 또는 그 번역 경로에 포함된 대체 공급자는 필요한 대화 텍스트를 받아 자체 정책에 따라 처리합니다. 별도의 외부 전송 토글은 추가하지 않습니다.
- Native Messaging 요청에는 허용 텍스트, 번역 설정, 서비스, 동의 버전과 임의의 대화 식별자가 포함됩니다. 실제 대화 URL·ID·참여자를 식별자로 보내지 않습니다. 시크릿 여부는 페이지가 아닌 브라우저가 제공한 탭 정보로 결정합니다.

### 저장·삭제·철회

일반 창에서는 본체의 기존 번역 캐시를 재사용합니다. 본문과 번역문, 앱에서 저장하는 전송 원문은 Windows 사용자 계정 기반 DPAPI로 암호화해 로컬 SQLite에 저장합니다. 기존 평문 본문도 읽을 수 있는 형태로 전환하며 보관 시각을 유지합니다. 설정·언어·캐시 색인 등의 메타데이터까지 데이터베이스 전체를 암호화하는 것은 아닙니다. 암호화는 같은 Windows 사용자로 실행되는 다른 프로그램이나 실행 중인 메모리 접근까지 막는 장치가 아닙니다.

앱의 기록 보관 기간(기본 30일, 7/30/90/180일 또는 기간 제한 없음)과 기록 삭제 기능을 그대로 사용합니다. 기간 제한 없음은 저장하지 않음이 아닙니다. 대화 전환, 웹 번역 끄기 또는 동의 철회만으로 이미 저장한 캐시를 삭제하지 않으므로, 삭제하려면 앱의 기록 삭제를 사용해야 합니다. 외부 공급자와 구독 CLI의 자체 기록·보관 정책은 본체의 캐시 삭제로 제어하지 못합니다.

시크릿/사생활 보호 창은 본체의 디스크 캐시를 읽거나 쓰지 않고 요청 단위 메모리만 사용합니다. 구독 CLI의 로컬 기록 경로를 통제할 수 없어 이 창에서는 로컬 모델 또는 DeepL만 허용합니다. 이 제한은 일반 창에 적용하지 않습니다.

확장 자체는 대화 본문을 브라우저 저장소에 저장하지 않습니다. 현재 DOM을 위한 메모리 사본은 대화 이동·종료·동의 철회 때 폐기하며, 새 수집과 요청을 차단하고 이전 대화나 철회된 동의에 대한 늦은 응답은 표시하지 않습니다. 이미 전달한 외부 요청은 취소하거나 회수하지 못할 수 있습니다. 사이트의 원문·서버 기록 삭제, RAM·VRAM·운영체제 사본의 즉시 물리 소거는 보장하지 않습니다. 앱 진단 로그에 대화 본문을 기록하지 않습니다.

## 선택형 외부 서비스

일반 웹·Discord 번역에서는 사용자가 ChatGPT, Claude, Gemini 또는 DeepL을 번역 서비스로 직접 선택한 경우에만 번역에 필요한 텍스트가 해당 서비스로 전송됩니다. 이미지 번역에서는 PC 안에서 인식한 텍스트만 선택한 서비스로 전달되며 이미지 파일이나 픽셀은 전달하지 않습니다. 동의 v3 이후 일반 창의 웹 메신저도 이 외부 서비스 경로를 사용합니다.

외부 서비스의 데이터 처리는 각 공급자의 약관과 개인정보 처리방침을 따릅니다. 구독형 서비스 연결은 각 공급자의 공식 로컬 CLI 인증을 사용하며, DeepL API 키는 Windows 자격 증명 관리자에 저장합니다.

## 네트워크 사용

앱은 사용자가 요청한 기능을 위해 다음 네트워크 연결을 사용할 수 있습니다.

- 앱 업데이트 확인과 설치 파일 다운로드
- 사용자가 선택한 로컬 번역 모델 및 OCR 모델 다운로드
- 사용자가 선택한 외부 번역 서비스 연결과 번역 요청

사용자가 외부 번역 서비스를 선택하지 않으면 번역할 대화 텍스트를 외부 번역 서비스로 보내지 않습니다.

## 문의

개인정보 또는 데이터 처리에 관한 문의는 [GitHub Issues](https://github.com/NudeNyang/NudeNyang-Discord-Translator/issues)에 남길 수 있습니다.

---

## English

NudeNyang Discord Translator does not operate a developer-controlled backend. The developer does not collect or retain Discord messages, webpage text, images, translation history, visited page addresses, or credentials. Local processing and storage by the application are described separately below.

This document includes the unpublished consent-v3 development policy. Version numbers alone do not establish support. The public policy, installers and store disclosures must be updated together before a future release.

Local models process translation on the user's PC. Image pixels remain local for OCR and compositing. For ordinary webpage and Discord translation, if the user explicitly selects ChatGPT, Claude, Gemini, or DeepL, only the text required for translation is sent to that provider under its own terms and privacy policy. Ordinary settings, caches, and history remain in the Windows user data directory. After consent v3, regular-window messenger translation uses the same translator and cache policy. DeepL credentials are stored in Windows Credential Manager, and subscription providers use their official local CLI authentication. Diagnostic logs do not record message bodies, local-model prompts, or authentication secrets.

The Chrome, Naver Whale, and Firefox extensions can run on ordinary HTTP/HTTPS websites, which may produce a browser warning that they can read and change data on all websites. Firefox declares eligible ordinary page text passed to the Windows app as `websiteContent` and the address category of the page being translated as `browsingActivity`. Web-messenger reading uses the separate optional category `personalCommunications`.

Extension 0.7.9 additionally stores two local preferences: whether the companion has connected successfully and whether the connection-help card was dismissed. These contain no page addresses, text, or conversations and never change messenger consent or a disabled browser connection.

Only when the user opens the bundled download guide does it fetch the existing public GitHub update list for the latest published companion, including prereleases and both Windows installer architectures. The request omits cookies and referrers; no page addresses, text, or conversations are sent. GitHub may process network information such as the IP address needed for a normal HTTPS request. No remote code runs. Installer downloads require a further user click; installation and browser startup never open download tabs automatically.

At background startup, installation, browser startup, window-focus changes, and periodic alarms, the extension checks its connection to the same-computer companion, with bounded retries for temporary failures. These checks include browser type and extension version, not webpage text or addresses. A connection check alone does not initialize a translation model, enable translation, or grant messenger consent.

The companion's browser-specific Disconnect action stores a local disabled setting for all profiles of that browser kind. It rejects new translation/settings requests and invalidates pending results, but does not uninstall the extension, revoke browser permissions or messenger consent, or force already displayed translations back to their originals. Other browser kinds and Discord settings are unchanged. Connection-only signals may update local browser-kind/version presence without cancelling the saved disabled setting.

On generic sites, extraction remains off until the user explicitly presses F4 or enables the popup toggle. The selected on or off state continues while that tab remains open, including after navigation or refresh. A site can also start automatically on future visits only when the user explicitly saves an automatic-translation policy for that hostname.

An ordinary webpage translation request contains eligible visible text near the viewport and a page identifier made from the current protocol, hostname, and path. Query strings and URL fragments are excluded. The Windows app uses this identifier only to separate translation requests and context by page. The extension does not read or transmit full HTML, cookies, authentication tokens, or a list of browsing history. The current page address and saved hostname policies are processed locally only to provide the requested translation and are not sent to the developer. Saved site policies contain only the hostname and the behavior selected by the user.

Input values, editable content, code, prices, account, login, payment, order, administration, and private-message surfaces are excluded from generic translation. Explicitly supported public fixed menus, instructions, and article bodies have narrowly scoped exceptions. Messenger consent does not remove the generic sensitive-page blocks. The extension does not inject into browser-internal pages or local files. The developer does not sell webpage text or addresses, use them for advertising, tracking, analytics, credit assessment, or unrelated purposes, or transmit them to a developer-operated server where a person could access them.

### Web-messenger reading

After consent in the current browser profile, messengers follow the common web switch, current-tab control and site policy. There is no separate messenger enable switch or separate external-provider/storage toggle. Refusing consent does not prevent ordinary webpage translation. Firefox additionally requires optional `personalCommunications` permission; refusal, cancellation or revocation blocks the private path.

Consent v3 discloses the app's selected translator and shared retention/deletion policy. Earlier v1/v2 local-only, no-disk-storage consent is never upgraded automatically. The extension also requires companion capability `messengerPolicyVersion: 3`. This policy change is an unpublished development change, not a claim that the currently published builds implement it.

Supported surfaces are X DM, web Discord, WhatsApp Web, Telegram Web, Messenger, Slack, Microsoft Teams and Google Messages. Only a safely identified open conversation is read: visible message bodies and link-preview text, plus visible channel names in the current Discord server. The extension does not open other conversations, retrieve hidden history, attachments or linked pages, or translate authors, handles, contact lists, profiles, composers, drafts, send controls or code. Sensitive information present in message bodies is not automatically redacted. Generic account, payment, email and unsupported-messenger blocks remain.

The app's selected translator is shared with desktop Discord. Local models process text on the PC. Selecting ChatGPT, Claude, Gemini or DeepL permits the necessary conversation text to be sent to that provider, including its configured fallback path, under the provider's policies. Requests to the local companion use a random conversation identifier, not a real conversation URL, ID or participant list. Private-browsing state comes from browser-owned tab metadata.

In regular windows the app reuses its shared translation cache. Source text, translations and saved outgoing message bodies are encrypted using Windows user-scoped DPAPI before SQLite storage. Existing plaintext bodies are migrated without discarding their retention timestamps. Metadata such as settings, languages and cache indexes is not whole-database encrypted. This protection does not prevent access by software running as the same Windows user or access to live process memory.

App retention is 30 days by default, with 7/30/90/180-day or unlimited options. Unlimited does not mean storage is disabled. The existing history-deletion action clears this cache. Changing conversations, disabling translation or withdrawing consent does not delete previously stored cache entries. Provider and subscription-CLI records are governed separately and cannot be deleted through the app cache controls.

Private-browsing requests never read or write the app's disk cache and use request-scoped memory. Only local models and DeepL are allowed there because subscription CLI local-content records cannot be controlled. Regular-window messenger translation has no such provider restriction.

The extension persists settings and consent, not message bodies. It discards its current-conversation memory copies on navigation, closure or revocation, blocks new collection and requests, and ignores late responses for an old conversation or revoked consent. Requests already sent externally may not be retractable. This does not delete the messenger service's original messages or server records, or guarantee physical erasure of RAM, VRAM or OS-managed copies. App diagnostics do not record conversation bodies.

Network use remains limited to the disclosed update/download and user-selected translation functions. Privacy questions: [GitHub Issues](https://github.com/NudeNyang/NudeNyang-Discord-Translator/issues).
