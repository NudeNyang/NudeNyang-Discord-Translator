# 개인정보 처리방침 / Privacy Policy

최종 수정일: 2026-08-25

NudeNyang Discord Translator는 별도의 운영 서버를 두지 않으며, 개발자가 Discord 메시지, 웹페이지 텍스트, 이미지, 번역 기록, 방문한 페이지 주소 또는 인증 정보를 수집하거나 보관하지 않습니다.

## 로컬 처리

- Hy-MT2와 TranslateGemma 번역은 사용자 PC에서 처리됩니다.
- 이미지 픽셀은 PC 안에서 OCR과 합성에 사용되며 외부 번역 서비스로 전송되지 않습니다.
- 설정, 번역 캐시와 번역 기록은 Windows 사용자 데이터 폴더에 저장됩니다. 보관 기간은 앱 설정에서 변경할 수 있습니다.
- 진단 로그에는 메시지 본문, 로컬 모델 프롬프트와 인증 비밀 값을 기록하지 않습니다.

## 브라우저 확장

- Chrome, Naver Whale과 Firefox 확장은 일반 HTTP/HTTPS 웹사이트에서 동작할 수 있으므로 브라우저가 모든 웹사이트의 데이터를 읽고 변경할 수 있다는 권한 경고를 표시할 수 있습니다. Firefox는 Windows 앱으로 전달되는 허용 영역 텍스트를 `websiteContent`, 번역 중인 현재 페이지의 주소 범주를 `browsingActivity`로 명시합니다.
- 전용 지원 사이트가 아닌 일반 웹사이트에서는 사용자가 해당 탭에서 F4를 누르거나 팝업 토글을 켜기 전까지 텍스트를 추출하거나 번역 요청을 보내지 않습니다. 사용자가 선택한 켜짐·꺼짐 상태는 탭을 닫을 때까지 유지되며, 같은 탭에서 페이지를 이동하거나 새로 고쳐도 이어집니다. 사이트 자동 번역 정책을 직접 저장하면 이후 해당 사이트 방문에서도 자동으로 시작할 수 있습니다.
- 번역 요청에는 화면과 가까운 제목, 문단, 목록, 인용문과 그림 설명의 허용된 텍스트와 페이지 구분용 주소가 포함됩니다. 페이지 구분용 주소는 프로토콜·호스트 이름·경로만 포함하며 쿼리 문자열과 해시는 포함하지 않습니다. Windows 앱은 이 값을 번역 요청과 문맥을 페이지별로 분리하는 데 사용합니다.
- 전체 HTML, 쿠키, 로그인 토큰과 방문 기록 목록은 읽거나 전달하지 않습니다. 현재 페이지 주소와 사이트 정책은 사용자가 요청한 웹 번역을 제공하기 위해서만 PC 안에서 처리하며, 개발자에게 전송되지 않습니다. 사이트별 정책에는 호스트 이름과 사용자가 선택한 동작만 로컬 설정으로 저장됩니다.
- 입력 폼, 코드, 탐색 UI, 대화상자, 가격, 계정, 로그인, 결제, 주문, 관리와 개인 메시지 화면은 범용 번역에서 제외합니다. Chrome·Whale·Firefox 내부 페이지와 로컬 파일에는 확장 스크립트를 주입하지 않습니다.
- 로컬 모델을 선택하면 추출된 웹 텍스트는 PC 안에서 처리됩니다. 외부 번역 서비스를 선택한 경우에만 번역에 필요한 허용 영역 텍스트가 해당 공급자에게 전달됩니다.
- 개발자는 웹페이지 텍스트나 주소를 판매하거나 광고, 사용자 추적, 분석, 신용 평가 또는 번역과 무관한 목적으로 사용하지 않으며 사람이 열람할 수 있는 개발자 운영 서버로 전송하지 않습니다.

## 선택형 외부 서비스

사용자가 ChatGPT, Claude, Gemini 또는 DeepL을 번역 서비스로 직접 선택한 경우에만 번역에 필요한 텍스트가 해당 서비스로 전송됩니다. 이미지 번역에서는 PC 안에서 인식한 텍스트만 선택한 서비스로 전달되며 이미지 파일이나 픽셀은 전달하지 않습니다.

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

NudeNyang Discord Translator does not operate a developer-controlled backend and does not collect or retain Discord messages, webpage text, images, translation history, visited page addresses, or credentials.

Local models process translation on the user's PC. Image pixels remain local for OCR and compositing. If the user explicitly selects ChatGPT, Claude, Gemini, or DeepL, only the text required for translation is sent to that provider under its own terms and privacy policy. Settings, caches, and history remain in the Windows user data directory. DeepL credentials are stored in Windows Credential Manager, and subscription providers use their official local CLI authentication.

The Chrome, Naver Whale, and Firefox extensions can run on ordinary HTTP/HTTPS websites, which may produce a browser warning that they can read and change data on all websites. Firefox declares eligible page text passed to the Windows app as `websiteContent` and the address category of the page being translated as `browsingActivity`.

On generic sites, extraction remains off until the user explicitly presses F4 or enables the popup toggle. The selected on or off state continues while that tab remains open, including after navigation or refresh. A site can also start automatically on future visits only when the user explicitly saves an automatic-translation policy for that hostname.

A translation request contains eligible visible text near the viewport and a page identifier made from the current protocol, hostname, and path. Query strings and URL fragments are excluded. The Windows app uses this identifier only to separate translation requests and context by page. The extension does not read or transmit full HTML, cookies, authentication tokens, or a list of browsing history. The current page address and saved hostname policies are processed locally only to provide the requested translation and are not sent to the developer. Saved site policies contain only the hostname and the behavior selected by the user.

Forms, code, navigation UI, dialogs, prices, account, login, payment, order, administration, and private-message surfaces are excluded. The extension does not inject into browser-internal pages or local files. The developer does not sell webpage text or addresses, use them for advertising, tracking, analytics, credit assessment, or unrelated purposes, or transmit them to a developer-operated server where a person could access them.

Network access is limited to user-requested update checks, model downloads, and calls to an external translation provider selected by the user. With a local model, extracted web text remains on the user's PC; with a selected external provider, only the eligible text required for translation is sent to that provider.
