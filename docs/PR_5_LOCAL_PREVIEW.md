# PR #5 로컬 확인본

2026-10-15, PR `91ab38a` 기준. 공개 버전 번호 `0.7.10-beta`를 유지한 로컬 확인용 빌드다.

## 수정 내용

- 원문으로 남긴 품질 실패를 성공 번역과 구분해 전달한다. 메시지가 화면에서 사라졌다가
  다시 나타나도 같은 번역을 재요청하지 않는다. 같은 메시지의 정상 번역 부분은 유지한다.
- CodeBuddy를 웹 확장의 외부 번역 서비스로 분류해 페이지 전송 한도를 적용한다.
- CodeBuddy를 DeepL과 OpenAI 호환 API 사이에 두고 모델 선택과 기존 연결·해제 아이콘을
  펼친 설정 안으로 옮겼다. 두 아코디언의 화살표는 연결 여부에 관계없이 오른쪽 끝을 유지한다.
- Discord가 비활성인 동안 일시적인 연결 확인 오류가 나도 기존 보안 연결에 다시 접속한다.
  메시지 수집과 번역 적용은 계속 활성 창에서만 수행한다.

## 수정 전 재현

`extension/e2e/discord-retry.spec.mjs`에 메시지를 제거한 뒤 같은 원문으로 다시 넣는 검사를
추가했다. 로컬 모의 API에 대한 요청이 2회에서 4회로 늘어 실패했다.

`extension/test/content-dom.test.mjs`에 CodeBuddy 전송 한도 검사를 추가했다. 10,000자 한도에서
본문 9,988자 뒤에 20자 영상 제목이 전송되어 실패했다. 기존 DeepL 대조군은 차단했다.

수정 중 기존 수동 재시도 검사에서도 실패를 확인했다. 번역을 껐다 켜도 화면의 원문 유지 상태가
남아 요청이 5회에서 늘어나지 않았다(기대 7회). 원문 유지 상태에도 현재 작업 세대를 기록해
화면 재등장에는 재사용하되, 사용자가 다시 켜거나 설정을 바꾸면 새 시도를 허용하도록 보완했다.

## 검증 범위

- `cargo test --manifest-path src-tauri/Cargo.toml --no-fail-fast`: 567개 통과, 51개 제외.
- `npm test`: 801개 통과.
- `npm run test:e2e -- --workers=1`: 전체 207개 통과(10.2분).
- `npx playwright test --config web/e2e/playwright.config.mjs`: 12개 통과.
  밝은·어두운 테마, 좁은 화면, 화살표 정렬, 키보드 조작, 모델 목록 조회 실패·복구를 포함한다.
- `npm run test:locales`: 28개 언어, 703개 문구 검사 통과.
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`: 통과.
- `npm run tauri -- build --target x86_64-pc-windows-msvc --no-bundle`: 성공.
  로컬 실행 파일만 생성했으며 설치 파일 패키징이나 공개 배포는 하지 않았다.

전체 E2E의 첫 실행은 릴리스 빌드와 겹쳐 2개 항목이 시간 초과로 끝났다.
다시 실행했을 때는 201개가 통과했으나 재시도 묶음이 테스트용 Rust 빌드 실패로 시작되지 않았다.
이후 재시도 묶음을 따로 실행해 위 수동 재시도 문제를 찾아 수정했고, 수동 재시도·화면 재등장·
부분 번역 유지 검사 3개가 통과했다. 최종 전체 검사는 빌드와 겹치지 않도록 한 작업자로 실행했고,
207개 모두 통과했다. 마지막 수정 후 Rust 567개와 설정 화면 12개도 다시 통과했다.

Node 검사는 제품 코드와 DOM fixture를 사용한다. Discord E2E는 별도 브라우저·앱 프로필에서
실제 Rust 제어기, CDP, 작업 스레드와 로컬 모의 API를 실행한다. 설정 화면 E2E는 제품 HTML·CSS·JS를
실행하고 Tauri 명령 응답만 모사한다. 실제 CodeBuddy 계정 로그인과 실제 서비스 번역은 검사하지 않았다.

웹 DOM 수집·가시성·적용 알고리즘이나 사이트별 선택자는 변경하지 않았다. 실제 공개 사이트 표본 검사는
이번 변경의 검증 범위에 포함하지 않는다. 브라우저에 설치된 확장도 교체하지 않는다. CodeBuddy의
웹 전송 제한을 실제 브라우저에 적용하려면 수정된 확장을 함께 설치해야 한다.

## 로컬 실행

최초 확인본은 `dist/PR5Preview/NudeNyangDiscordTranslator.exe`에 보관하고, 화면 배치와
재연결을 보완한 확인본은 `dist/PR5Preview2/NudeNyangDiscordTranslator.exe`에 보관한다.
CodeBuddy 버튼 여백까지 수정한 최신 확인본은 `dist/PR5Preview3/NudeNyangDiscordTranslator.exe`다.
기존 로컬 llama 런타임을 함께 사용하고, 데스크톱·프로젝트의 기존
`NudeNyang Discord Translator (Tauri).lnk`를 같은 실행 파일로 맞춘다. 프론트 확인 후 병합 여부를
결정할 수 있도록 원격 PR과 공개 릴리스는 변경하지 않는다.

## 화면 배치·재연결 보완 검증 (2026-10-15)

- `npm run test:e2e -- --workers=1`: 전체 208개 통과(8.4분). 비활성 창의 일시적 연결 확인
  오류 뒤 재접속, 지속되는 실제 연결 실패, 추가 인증, 다중 Discord 창 전환을 포함한다.
- `cargo test --manifest-path src-tauri/Cargo.toml --no-fail-fast`: 567개 통과, 51개 제외.
- `npm test`: 801개 통과.
- `PLAYWRIGHT_BROWSERS_PATH=0`을 설정하고 `npx playwright test --config web/e2e/playwright.config.mjs`:
  설정 화면 13개 통과. CodeBuddy와 OpenAI 호환 API의 연결 전후 화살표 위치, 접힌 상태의
  버튼 숨김, 펼쳤을 때 헤더 고정, 입력 보존과 좁은 화면 배치를 검사했다.
- 기존 연결·해제 버튼 10개의 HTML을 변경 전과 비교해 SVG, 툴팁과 접근성 속성이 동일함을 확인했다.
- `npm run test:locales`, `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`,
  `git diff --check`: 통과.
- 실제 OCR 모델 로드·이미지 처리 검사 1개 통과. 비 MSVC 충돌 제보는 재현 환경이 없어
  해결 여부를 판단하지 않았다. 상세 내용은 [OCR 빌드 조사](OCR_BUILD_INVESTIGATION.md)에 기록했다.
- `npm run tauri -- build --target x86_64-pc-windows-msvc --no-bundle`: 릴리스 실행 파일
  빌드 성공. 버전은 `0.7.10-beta`이며, 설치 파일 패키징과 공개 배포는 하지 않았다.

비활성 창 재연결 검사는 수정 전에 8초 동안 복구되지 않아 실패한 뒤 수정 후 통과했다.
화면 구조 검사도 수정 전 헤더에 버튼이 3개 남아 실패했고, 기존 버튼을 설정 안으로 옮긴 뒤
통과했다. 설정 화면 E2E의 첫 실행은 공유 브라우저 캐시의 실행 오류로 시작하지 못했으며,
프로젝트의 hermetic Playwright 설치를 선택한 위 명령으로 13개 모두 통과했다.

Discord 검증은 격리 문서와 모사한 OS 상태·번역 모델을 사용한다. 제보자 PC의 실제 보안
파이프 장애나 실제 로그인 대화를 재현한 것은 아니다. 웹 공통 수집·적용 코드는 이번에
변경하지 않았으며, 공개 사이트 표본 검사와 ARM64 하드웨어 실행은 수행하지 않았다.

## CodeBuddy 연결 버튼 여백 보완

모델 설정 줄에만 공통 `.setting-row`의 좌우 여백과 아래 구분선이 적용되어 연결 버튼이
입력칸보다 오른쪽으로 나가고 선에 붙었다. CodeBuddy 안에서 중복 여백을 없애고, 구분선은
하단 버튼 영역에 배치해 위아래에 14px 여백을 둔다. 모델 선택과 새로 고침도 같은 오른쪽
끝에 정렬한다. 기존 아이콘과 동작은 유지한다.

수정 전 배치 검사는 1920px 화면에서 오른쪽 끝이 16px 어긋나 실패했다. 수정 후에는
1920·1280·900·720px에서 연결·해제 버튼 각각의 정렬, 구분선 간격과 카드 안쪽 여백을 확인했다.
설정 화면 E2E 14개와 `npm run test:web` 284개가 통과했고 밝은·어두운 테마의 렌더링을
검사했다. CSS만 변경했으며 Discord 엔진과 웹 번역 수집·적용 코드는 변경하지 않았다.
`git diff --check`와 x64 `tauri build --target x86_64-pc-windows-msvc --no-bundle`도 통과했다.
