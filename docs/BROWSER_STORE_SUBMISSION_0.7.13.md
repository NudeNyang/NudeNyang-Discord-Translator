# NudeNyang Web Translator 0.7.13 제출 자료

이 문서는 Chrome·Naver Whale·Firefox용 0.7.13 제출 파일과 스토어 입력 문구를 한곳에
정리한다. 공개 선행 조건은 2026-08-29에 충족했으며, 아래 파일을 다시 패키징하고 검증한 뒤
각 스토어에 제출한다.

## 2026-09-06 재제출 패키징

이전 제출물을 덮어쓰지 않고 `release/browser-extension/0.7.13-submission/2026-09-06`에
새 제출물을 생성한다. 확장 버전은 Chromium·Firefox 모두 기존 `0.7.13`을 유지한다.
확장 런타임과 앱 내부 개인정보 안내는 이번 패키징에서 변경하지 않는다.

Chrome 거절 안내에서 지적한 메신저 이름의 나열은 **스토어 상세 설명**의 문제다.
아래 상세 설명을 사용하고, 개발자 대시보드에 남아 있는 이전 설명도 언어별로 직접 교체한다.
ZIP 업로드만으로 스토어 상세 설명이 바뀌지는 않는다. 개인정보 안내·권한 사유·검토자 노트의
구체적인 지원 범위와 외부 전송 설명은 그대로 유지한다. 심사 승인을 보장하지 않는다.

```powershell
npm run extension:locales
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package_chromium_extension.ps1 -OutputDirectory release/browser-extension/0.7.13-submission/2026-09-06
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package_firefox_amo.ps1 -OutputDirectory release/browser-extension/0.7.13-submission/2026-09-06
```

이 문서의 공개 선행 조건은 2026-08-29 확인 기록이며 이번 로컬 재빌드에서 원격 배포 상태를
다시 검증했다는 뜻이 아니다. 아래 2026-09-01 검사 결과도 당시 기록으로 구분한다.
Windows 본체의 후속 CPU·작업 순서 최적화는 본체 변경이며, 확장 ZIP만 업데이트한다고
기존 사용자의 Windows 본체까지 업데이트되는 것은 아니다.

## 공개 선행 조건 확인

- **공개 본체 0.7.4-beta**: `messengerPolicyVersion: 5`를 포함한 x64·ARM64 설치형과 업데이트
  서명·체크섬을 [GitHub 프리릴리스](https://github.com/NudeNyang/NudeNyang-Discord-Translator/releases/tag/v0.7.4-beta)에 공개했다.
- **공개 개인정보 처리방침**: 저장소의 현재 `PRIVACY.md`가 공개 `main`에 반영되어 있으며
  동의 v5, 선택한 외부 공급자, 암호화 캐시와 열린 메일 범위를 설명한다.
- 공개 업데이트 목록은 0.7.4-beta의 x64·ARM64 설치형을 가리키며 두 URL의 HTTP 200 응답과
  원격 파일 크기를 확인했다. 릴리스 파일 공개 뒤에 목록을 갱신했다.
- Outlook은 합성 검사만 수행한 사실을 심사 자료에 유지한다. 실제 스토어 설치본의 세 브라우저
  연결과 동의 흐름은 제출 전·심사 중 수동 확인 항목으로 남긴다.

최종 산출물은 `release/browser-extension/0.7.13-submission`에 둔다. 스토어 업로드와 심사
완료는 이 로컬 패키징과 별개다.

## 패키지

- Chrome·Whale 공용: `NudeNyang-Web-Translator-Chromium-0.7.13.zip`
- Firefox: `NudeNyang-Web-Translator-Firefox-0.7.13.xpi`
- Firefox 검토 소스: `NudeNyang-Web-Translator-Firefox-0.7.13-source.zip`
- 체크섬: `NudeNyang-Web-Translator-Firefox-0.7.13-SHA256SUMS.txt`, `SHA256SUMS.txt`
- 개인용 개발 폴더: `dist/chromium-personal-extension`

Chrome과 Whale은 같은 Chromium ZIP을 사용한다. Chrome 스토어용 ZIP에는 개발 `key`가 없고,
개인용 폴더는 기존 개인 ID를 유지한다. Firefox Add-on ID도 기존 값을 유지한다.

## 새로운 기능 — 한국어

```text
타임라인과 메신저처럼 짧은 간격으로 여러 항목이 나타나는 화면에서 새 본문을 한 요청으로 묶어, 빠르게 스크롤한 뒤 번역이 늦게 채워지는 현상을 줄였습니다. 일본어 장문 중 일부 문장이 원문으로 남는 결과는 줄 단위로 다시 번역하고 불완전한 결과를 캐시하지 않도록 품질 검사를 보강했습니다.

YouTube와 게시판처럼 DOM이 자주 바뀌는 페이지에서 반복되던 전체 문서 검색, 레이아웃 측정과 자동 누락 진단을 줄여 응답성과 번역 시작 속도를 개선했습니다. 숨겨진 탭은 활성화될 때까지 번역 작업을 미룹니다.

웹 번역의 켜기·끄기 상태를 현재 브라우저의 모든 탭과 새 탭에 함께 적용하도록 정리했습니다.
처음 사용할 때는 통합 개인정보 안내를 확인하고 동의해야 하며, 기존 동의를 자동으로 확대하지 않습니다.

일반 페이지의 문단과 제목뿐 아니라 구분 가능한 메뉴, 버튼, 설명 문구도 번역합니다. 입력값, 편집기, 코드, 금액과 표시된 개인정보 영역은 제외합니다. 동적 페이지의 부분 누락과 오래 열린 탭의 F4 연결 복구도 개선했습니다.

명시적인 사적 읽기 동의 후에는 현재 열린 지원 메신저 대화와 Gmail·Outlook 읽기 화면의 제목·보이는 본문을 번역할 수 있습니다. 목록, 연락처, 작성 중인 내용, 발신자·수신자 UI, 첨부 파일과 다른 대화·메일은 읽지 않습니다. Outlook은 합성 환경에서만 검증했습니다.

일반 창의 사적 읽기 번역은 앱에서 선택한 번역기와 보관 설정을 사용하며, 로컬 캐시 본문은 Windows 사용자 계정 범위로 암호화합니다. 시크릿 창은 디스크 캐시를 사용하지 않습니다.
```

## New features — English

```text
New visible items that appear in short bursts on timelines and messengers are now combined into fewer translation requests, reducing delayed translation after fast scrolling. Quality checks now retry a Japanese source sentence left unchanged inside an otherwise Korean result and keep incomplete results out of the completed cache.

Performance on highly dynamic pages such as YouTube and discussion boards has been improved by eliminating repeated full-document queries, redundant layout measurements and automatic coverage audits. Hidden tabs defer translation work until activated.

Translation can now be enabled or disabled across all current and new tabs in the browser. A unified privacy notice is shown before first use, and earlier consent is never expanded automatically.

In addition to visible page headings and paragraphs, identifiable menus, buttons and associated descriptions can be translated. Input values, editors, code, amounts and marked personal-data fields remain excluded. Partial dynamic-page coverage and F4 recovery in long-open tabs were also improved.

After explicit private-reading consent, the add-on can translate the current supported messenger conversation and the subject and visible body of an opened Gmail or Outlook message. Lists, contacts, drafts, sender/recipient UI, attachments and other conversations or mail are not read. Outlook has synthetic automated validation only.

Private reading in regular windows follows the translator and retention settings selected in the companion. Locally cached source and translation bodies are protected with Windows user-scoped encryption. Private windows do not use the disk cache.
```

## 상세 설명 — 한국어

```text
NudeNyang Web Translator는 기존 페이지 구조를 유지하면서 번역 가능한 화면의 텍스트를 번역합니다. 별도로 설치하는 NudeNyang Windows 앱을 Native Messaging으로 연결해 번역 엔진으로 사용하며, 확장 프로그램 자체에는 번역 모델이 포함되지 않습니다.

팝업이나 F4로 현재 브라우저의 모든 탭에서 번역을 켜고 끌 수 있습니다. 사이트별 동작과 번역 언어를 설정할 수 있습니다. 보이는 제목, 문단, 목록, 인용문, 이미지 설명과 구분 가능한 읽기 전용 안내 문구를 번역합니다. 입력값, 편집 가능한 내용, 코드, 금액과 표시된 식별 정보는 제외합니다.

별도의 사적 읽기 동의 후에는 지원되는 메신저의 현재 대화와 현재 열린 메일의 제목·보이는 본문도 번역할 수 있습니다. 다른 대화나 메일을 열지 않으며, 목록, 연락처, 작성자, 발신자·수신자 UI, 초안, 작성창, 첨부 파일, 연결된 페이지와 전송 버튼은 제외합니다.

Windows 앱에서 로컬 AI 모델 또는 사용자가 명시적으로 선택한 외부 번역 공급자를 사용합니다. 외부 공급자를 선택하면 번역에 필요한 허용된 텍스트가 해당 공급자에게 전송됩니다. 개발자는 번역 중계 서버, 분석 서버 또는 웹페이지 본문 저장 서버를 운영하지 않습니다.

일반 창의 캐시 본문은 Windows 사용자 계정 범위로 암호화되며 앱의 보관 기간과 삭제 설정을 따릅니다. 시크릿 창에서는 메모리만 사용합니다. Windows 10 또는 Windows 11과 호환되는 Windows 앱이 필요합니다.

Windows 앱: https://github.com/NudeNyang/NudeNyang-Discord-Translator/releases
개인정보 처리방침: https://github.com/NudeNyang/NudeNyang-Discord-Translator/blob/main/PRIVACY.md
```

## 상세 설명 — English

```text
NudeNyang Web Translator translates eligible visible text while preserving the existing page structure. It uses the separately installed NudeNyang Windows companion as its translation engine through Native Messaging and does not bundle a translation model.

Use the popup or F4 to switch translation for all tabs. You can save per-site behavior and choose the target language. Eligible content includes visible headings, paragraphs, lists, quotations, image captions and identifiable read-only interface labels. Input values, editable content, code, amounts and marked identifiers are excluded.

After a separate private-reading consent, supported current messenger conversations and the currently opened Gmail or Outlook subject and visible body can be translated. The add-on does not open other conversations or mail and excludes lists, contacts, authors, sender/recipient UI, drafts, composers, attachments, linked pages and send controls.

The companion can use a local AI model or an external translation provider explicitly selected by the user. Eligible text is sent only to the selected provider when an external provider is chosen. The developer operates no translation relay, analytics or webpage-content storage server.

Regular-window cache bodies are encrypted with Windows user-scoped protection and follow the companion's retention and deletion settings. Private windows use memory only. Windows 10 or Windows 11 and the compatible companion are required.

Companion: https://github.com/NudeNyang/NudeNyang-Discord-Translator/releases
Privacy policy: https://github.com/NudeNyang/NudeNyang-Discord-Translator/blob/main/PRIVACY.md
```

## Chrome 개인정보 항목

- 단일 목적: 웹페이지에서 허용된 보이는 텍스트를 사용자가 선택한 번역기로 번역한다.
- 선택: **Website content**, **Web history**, **Personal communications**.
- 판매·광고·신용 평가·분석·목적 외 이용: 없음.
- 외부 전송: 같은 PC의 본체 Native Messaging 및 사용자가 명시적으로 선택한 번역 공급자.
- 원격 코드: 없음.
- 개인정보 처리방침 URL은 공개된 `PRIVACY.md`를 등록한다.

권한 사유:

- `nativeMessaging`: 같은 PC에 설치된 번역 본체와 통신.
- `storage`: 설정·전체 탭 상태·동의 버전 저장. 본문은 저장하지 않음.
- `activeTab`: 팝업에서 현재 탭을 제어.
- `scripting`: 설치·업데이트·재로드 뒤 오래 열린 탭에 포함된 수신 스크립트 복구.
- `alarms`: 본문·주소 없는 본체 연결 확인.
- HTTP/HTTPS 호스트 권한: 사용자가 승인한 일반 페이지와 별도 동의한 지원 읽기 화면 처리.

## Firefox 검토자 입력용 요약

```text
Requires Firefox 142+ on Windows 10/11 and a matching NudeNyang Windows companion reporting messengerPolicyVersion 5. The add-on contains no model and uses Native Messaging with the same-computer companion.

Its single purpose is translating eligible visible webpage text. After one bundled disclosure, the popup or F4 controls all current and new tabs. Ordinary scope includes headings, paragraphs, lists, quotations, image captions and identifiable read-only interface labels. Inputs, editors, code, amounts and marked identifiers are excluded.

Optional personalCommunications is requested only from an explicit consent-page click. Consent v5 permits visible bodies in the current supported messenger conversation, Discord preview/channel text, and the subject and visible body in the currently opened Gmail or Outlook reading pane. Lists, contacts, authors, sender/recipient UI, drafts, composers, attachments, linked pages and other conversations/mail are excluded. Outlook has synthetic validation only. Denial or withdrawal blocks private reading while approved ordinary translation remains available. Earlier consent is not upgraded.

Local models keep translation on the PC. In regular windows, choosing ChatGPT, Claude, Gemini or DeepL permits necessary eligible text to be sent to that provider. Cache bodies are encrypted with Windows user-scoped DPAPI and follow companion retention/deletion settings. Private windows use no disk cache and allow only local models or DeepL. The developer operates no relay, analytics or content-storage server.

Permissions: nativeMessaging connects to the companion; storage keeps preferences/state/consent but no bodies; activeTab addresses the active tab; scripting restores bundled receivers in old tabs; alarms performs content-free connection checks; HTTP/HTTPS hosts provide the disclosed translation scope. Required websiteContent and browsingActivity cover eligible text and protocol/host/path context. personalCommunications remains optional.

Build from source: npm ci; npm run extension:locales; powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package_firefox_extension.ps1. Validate with npm run test:extension and web-ext 10.6.0 lint. Full scope, reproducibility and limitations are in docs/FIREFOX_AMO_REVIEW.md. Automated E2E uses synthetic pages and does not claim live coverage of every service.
```

## 2026-09-06 로컬 재빌드 검증

- `npm run extension:locales`: 28개 언어 생성, 추적 중인 확장 파일 변경 없음.
- `npm run test:extension`: 469개 통과, 실패·건너뜀 0.
- `npm run test:e2e`: Chromium MV3·합성 문서·모사 Native Messaging 및 전송 검토 fixture
  전체 172개 통과. 실제 로그인 사이트와 Firefox·Whale 실브라우저 검증은 포함하지 않는다.
- `npx --yes web-ext@10.6.0 lint --source-dir dist/firefox-extension --warnings-as-errors`:
  오류·알림·경고 0.
- 제출용 소스 ZIP을 별도 폴더에 풀어 `npm ci`, `npm run extension:locales`, 두 브라우저
  패키징과 `npm run test:extension`을 실행했다. 소스에서도 테스트 469개가 통과했고,
  Chromium 67개·Firefox 68개 런타임 항목의 이름과 바이트가 제출 파일과 모두 일치했다.
  ZIP 메타데이터 시각은 비교에서 제외한다.
- 두 런타임 매니페스트 버전은 `0.7.13`, 개발 `key`는 없으며 Firefox 고정 ID를 유지했다.
  소스 ZIP은 137개 파일이며 절대 경로·상위 경로·역슬래시·중복 항목·의존성 설치 폴더·
  실행 파일·로그·DB·환경변수 파일을 포함하지 않는다.
- 공통 DOM 코드를 변경하지 않았으므로 이번 재빌드에서는 `npm run test:public`을 재실행하지 않았다.
- Windows 본체 `cargo build --release --manifest-path src-tauri/Cargo.toml` 성공.
  기존 MNN 사전 빌드 안내, C++ 경고 수준 재정의와 `LNK4098` 경고는 남아 있다.

산출물 폴더의 안내 문서와 `SHA256SUMS.txt`를 함께 확인한다. 스토어 업로드·심사 요청·
공개 배포는 수행하지 않았다. Firefox XPI는 AMO 제출용 미서명 파일이다.

## 최종 체크 (2026-09-01 기록)

- [x] 공개 본체 0.7.4-beta와 x64·ARM64 파일·서명·체크섬 확인
- [x] 공개 `PRIVACY.md`가 로컬 정책과 일치
- [ ] 새 본체 설치 환경에서 세 브라우저 연결·일반 번역·동의 v5 확인
- [x] Chrome 개인정보 항목과 상세 설명이 서로 모순되지 않음
- [x] Firefox XPI·소스 ZIP 재현 및 `web-ext` 경고 0
- [x] 실제 제출용 패키지 체크섬 재확인
- [x] 심사 자료에 Outlook 실사용 미검증을 유지

## 로컬 준비 검증 (2026-09-01)

- 확장 단위 테스트 469개 통과.
- `npm run test:e2e`: 실제 Chromium MV3·합성 문서·모사 Native Messaging 156개 통과.
- `npm run test:public`: 네트워크 공개 표본 6개 통과. 보호·화면 밖 영역은 성공으로 세지 않음.
- Firefox 소스 ZIP을 새 폴더에서 `npm ci` 후 재빌드해 확장 테스트 469개를 통과했고,
  제출 XPI와 재빌드 XPI의 런타임 68개 항목이 바이트 단위로 일치했다.
- `web-ext@10.6.0 lint --warnings-as-errors`: 오류·알림·경고 0.

최종 SHA-256은 산출물 폴더의 `SHA256SUMS.txt`에 기록한다. 소스 ZIP 자체에 자신의
체크섬을 넣지 않아 재패키징 때 자기 참조로 체크섬이 계속 바뀌는 일을 피한다.

자동 검사는 실제 로그인 메신저 전체, Outlook 실사용, Firefox·Whale 실브라우저, 외부 공급자
계정과 스토어 심사를 대신하지 않는다. 따라서 남은 수동 확인 결과를 심사 범위보다 넓게 표현하지 않는다.
