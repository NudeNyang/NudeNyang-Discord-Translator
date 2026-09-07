# 오래 열린 탭의 F4와 연결 복구

현재 미공개 개발본의 전체 ON/OFF와 새 탭 동작은 [전체 웹 번역 정책](WEB_TRANSLATION_GLOBAL_SWITCH.md)을 따른다. 아래 탭별 수동 시작 설명은 이전 구현 기록이다.

## 2026-09-07: 연결 표시 중 간헐적인 본체 요청 실패

실행 중인 Windows 본체에서 같은 `status` 요청을 연결 직후 보내면 성공했지만,
100ms 뒤 보내면 연결이 끊기는 현상을 두 차례씩 교차 재현했다. 본체 로그에는
`browser-bridge`의 소켓 오류 `10035`가 남았다. 페이지 콘솔의 `batch-failed`와
팝업의 `연결됨`·`오류` 동시 표시도 관찰했다. 팝업의 이전 연결 확인 성공은 이후
페이지 상태 조회나 번역 요청의 성공을 보증하지 않는다.

브리지 수신 대기는 종료 확인을 위해 nonblocking 모드지만 Windows에서는 수락한
연결에도 이 모드가 상속된다. 기존 코드는 수신 제한 시간만 설정하고 바로 읽어서
요청이 아직 도착하지 않았거나 일부만 도착한 경우 즉시 실패했다.
[Microsoft Winsock accept 문서](https://learn.microsoft.com/en-us/windows/win32/api/winsock2/nf-winsock2-accept)의 연결 속성 상속 규칙과 일치한다.

수락한 연결만 blocking 모드로 바꾸고 기존 읽기·쓰기 제한 시간을 유지한다.
요청 파싱·인증을 공통 함수로 분리하여 실제 TCP 연결로 첫 전송 지연과 분할 전송을
검증한다. 두 회귀 테스트는 수정 전 `10035`로 실패하고 수정 후 통과했다.
인증 키, 요청 크기 제한, 웹 동의·브라우저 사용 중지와 Discord 인증 보호는 유지한다.
Discord의 `인증 호환 모드` 자체가 웹 번역을 금지하는 정책은 아니다.

이 수정은 본체 통신 경로에 적용된다. 확장 소스·권한·버전은 변경하지 않는다.
주소창 포커스, 사이트의 키 이벤트 선점, 확장 재로드 후 기존 탭 등의 별도 F4 원인이
모두 해결됐다는 의미는 아니다. 아래 과거 검증 및 격리 Chromium E2E는 실제 본체
통신·Whale에서의 검증과 구분한다.

### 이번 수정의 검증 결과

- `cargo test --manifest-path src-tauri/Cargo.toml browser_bridge::tests::bridge_waits -- --nocapture`:
  수정 전 2개 실패(`10035`), 수정 후 2개 통과.
- `cargo test --manifest-path src-tauri/Cargo.toml`: 486개 통과, 기존 제외 50개.
- `npm test`: 780개 통과.
- `npm run test:e2e`: 전체 180개 통과(3.1분). 격리 Chromium·HTML fixture와 모사
  Native Messaging을 사용하며 실제 본체 통신 검증은 아래와 별개다.
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`, `git diff --check`: 통과.
- `scripts/package_windows_variants.ps1`: x64·ARM64 설치형 생성 성공.
- 최신 x64 실행본의 실제 인증 브리지: 즉시·100ms 지연·분할·100ms 지연 상태 요청
  4개 모두 성공. `incognito: true` 합성 문장을 분할 전송하여 실제 로컬 Hy-MT2
  모델의 한국어 `translationResult` 응답도 확인했다. 사용자 페이지 본문을
  진단 요청으로 복사하거나 저장하지 않았다.
- 자동 브라우저 도구의 F4 입력에서는 화면 전환을 확정하지 못했지만, 최신 본체로
  다시 실행한 뒤 사용자가 Whale에서 직접 F4를 눌러 정상 전환을 확인했다.
  Chrome·Firefox의 실제 사용자 프로필 및 ARM64 기기 실행은 검사하지 않았다.

본체는 `dist/NudeNyangDiscordTranslator/NudeNyangDiscordTranslator.exe`의
`0.7.5-beta` 실행본으로 적용했으며 루트 Tauri 바로가기의 대상·작업 폴더·아이콘과
실행 중 프로세스 경로·제품 버전을 확인했다. 공개 배포·확장 업데이트는 수행하지 않았다.

## 원인과 수정

확장 0.7.8의 로컬 수정이다. 버전과 개인정보 동의 버전은 변경하지 않는다.

- Chromium의 정적 `content_scripts.matches` 선언만으로는 `scripting.executeScript`를 사용하는 재주입 권한을 얻지 못한다. 이전에는 명시적 `host_permissions`가 없어 설치·업데이트·재로드 뒤 남은 탭의 자동 복구가 실패하고, 팝업을 눌러 `activeTab` 권한을 얻은 뒤에야 성공할 수 있었다.
- Chrome·Whale에도 기존 정적 주입 범위와 같은 `http://*/*`, `https://*/*` 호스트 권한을 명시한다. Firefox는 이미 같은 선언을 사용한다. 탭 활성화·창 포커스 복귀·설치 이벤트에서 기존 수신자가 없을 때만 기존 복구 경로로 재주입한다. 사이트 접근을 사용자가 제한했다면 이를 우회하지 않는다.
- 오래 열린 일반 페이지의 F4가 예전 본체 설정만 보고 시작을 거절하는 경우를 재현했다. 켜기 요청은 팝업과 마찬가지로 최신 본체 상태와 브라우저 동의를 확인하고 시작한다. 본체 조회 실패·연결 해제·최신 사이트 차단·본체 기능 꺼짐은 허용으로 바꾸지 않는다.
- 끄기는 본체 조회를 기다리지 않는다. 대기 중 다시 전환하거나 동의를 철회하거나 다른 페이지·대화로 이동하면 이전 시작 응답을 폐기한다. 페이지 상태 저장과 실제 표시가 모두 최신 사용자 선택을 따른다.

범용 사이트 권한은 기존 HTTP/HTTPS 범위만 명시하며 브라우저 내부 페이지·로컬 파일·새 메신저 수집 범위를 추가하지 않는다. 권한 경고가 표시될 수 있으며 사용자 승인을 자동화하지 않는다. 메시지 로컬 AI 전용, 별도 명시적 동의, 입력·전송 제외, 임시 메모리 처리 원칙은 유지한다.

## 검증과 적용

회귀 테스트는 `extension/test/page-connection.test.mjs`와 `content-dom.test.mjs`에 있다. 선언된 권한이 없는 복구와 오래된 본체 설정의 F4가 수정 전 실패함을 확인한 뒤, 켜기·끄기·동의 철회·대화 이동 경계를 검증한다. 가상 DOM 및 브라우저 API 모형 테스트는 실제 Whale에서의 성공 증거와 구분한다.

개발자 모드에서는 새 개인용 확장 폴더를 빌드한 뒤 확장을 새로고침하고 대상 탭으로 돌아간다. 새 확장 권한 적용 전 남아 있는 구 실행기를 새 코드가 이미 적용된 것으로 취급하지 않는다. 설치본은 스토어 업데이트가 필요하며 소스 수정만으로 자동 반영되지 않는다.

실브라우저 확인 순서:

1. 일반 문서 탭을 열어 둔 상태에서 확장을 재로드한다.
2. 문서 탭으로 돌아가 팝업을 열지 않고 F4로 번역·원문을 전환한다.
3. 본체에서 웹 번역을 껐다 켠 뒤 같은 탭에서 다시 확인한다.
4. 본체가 응답하지 않을 때 연속 F4/OFF가 늦은 응답으로 다시 켜지지 않는지 확인한다.
5. 메신저 동의가 없을 때는 본문 대신 기존 동의 안내만 표시되는지 확인한다.

공식 권한 기준: [Chrome scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting), [activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab).

## 0.7.10 후속 수정: 팝업 없는 F4의 키 이벤트 선점

일반 페이지에서 팝업을 한 번도 열지 않고 F4로 처음 번역을 켜는 경우는 기존 코드에서도
통과했다. 반면 사이트가 먼저 window의 capture 단계에서 키 이벤트를 중단하는 최소 HTML
fixture에서는 실패했다. 콘텐츠 스크립트가 document_idle에 등록되므로 사이트의 선행
키 처리 뒤에 실행되어, F4가 확장 핸들러까지 도달하지 않는 공통 원인이었다.

Chrome·Whale·Firefox의 최상위 콘텐츠 스크립트 주입을 document_start로 앞당겼다.
키 리스너는 먼저 등록하되, 본문 수집·관찰·자동 번역은 DOMContentLoaded와 기존 본체
상태·브라우저 동의 확인이 끝난 뒤에만 시작한다. 로딩 중 받은 F4도 초기화 후 단축키
설정을 다시 확인하여 사용자가 바꾸거나 끈 키를 임시 기본값으로 실행하지 않는다.
사이트별 selector나 허용 예외, 추가 권한, iframe 수집 범위 변경은 없다.

주입 시점의 기준은 [Chrome 콘텐츠 스크립트 문서](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts#run_time)를 따른다.
수정본 확장을 다시 로드하고 기존 페이지도 한 번 새로고침해야 선행 키 등록이 적용된다.
이미 로드된 사이트의 리스너보다 과거 시점으로 재주입할 수는 없다. 주소창·브라우저 내부
화면·자식 iframe에 포커스한 경우까지 최상위 페이지 F4가 동작한다고 보장하지 않는다.

### 재현 및 검증 경계

- 수정 전 실패: 사이트의 선행 capture 핸들러가 F4를 차단하는 도메인 독립 HTML E2E.
- 새 회귀: 팝업 미실행 상태의 실제 F4 ON/OFF, 선행 키 처리 충돌, 연결이 끊긴 탭 활성화
  복구 후 F4, F8로 변경한 설정과 단축키 해제, 입력값 보호.
- 보조키: headless Chromium에서 키 배정이 비어 있고 키 입력이 명령 이벤트를 발생시키지
  않는 것을 확인했다. 명령 이벤트 경계만 주입해 실제 등록된 background 처리와 ON/OFF를
  검증한다. OS 키 입력·사용자 브라우저의 실제 단축키 배정 성공으로 보고하지 않는다.
- 확장 재로드 전체 검증은 worker 재생성 대기 타임아웃으로 완료하지 못했다. E2E의 탭
  복구 검사는 런타임 dispose 후 실제 탭 활성화로 수행한다.

각 테스트는 격리 Chromium과 합성 HTML을 사용하고 번역 엔진 응답은 모사한다.
실제 로그인 사이트·Whale·Firefox의 키 입력 결과나 실제 본체 추론과 구분한다.
자세한 테스트 경계는 [E2E 안내](../extension/e2e/README.md)에 있다.

최종 실행 결과: `npm run test:e2e` 전체 95개 통과(재시도·제외 0개),
`npm test` 741개 통과(UI 246, 랜딩 37, 확장 449, 사전 9).
변경 JS의 `node --check`와 `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`도 통과했다.
로그는 커밋하지 않는 `artifacts/web-policy/shortcut-*.log`에 보관한다.
