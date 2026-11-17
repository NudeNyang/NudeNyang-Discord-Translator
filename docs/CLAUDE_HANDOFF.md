# NudeNyang Discord Translator — Claude 인수인계

작성일: 2026-11-17 (한국 시간). 개발 도구를 Codex에서 Claude로 옮기기 위한 기록이다.
개발 도구 이전과 앱 안의 ChatGPT/Claude 번역 공급자 설정 변경은 별개다.
이 작업에서는 계정 구독, 앱 인증, 번역 공급자, 제품 소스 및 배포 상태를 변경하지 않는다.

## 1. 바로 이어받는 방법

같은 PC에서는 기존 저장소 폴더를 그대로 열고 `CLAUDE.md`, `AGENTS.md`, `PROJECT.md`,
이 문서를 읽는다. 새 복제본보다 현재 폴더를 사용하는 편이 Git 제외 문서와 로컬 개발 자원을
유지하기 쉽다. 사용자와 대화할 때는 한국어 반말과 쉬운 설명을 사용하고, 제품 문구는 공식체로 쓴다.

Claude에 전달할 첫 요청 예시:

```text
이 저장소의 NudeNyang Discord Translator 개발을 이어받아 줘.
CLAUDE.md, AGENTS.md, PROJECT.md, docs/CLAUDE_HANDOFF.md부터 읽고
현재 Git 상태와 요청에 관련된 문서를 확인해 줘.
사용자와는 쉬운 한국어 반말로 대화하고 제품 UI는 공식체를 유지해.
우선 현재 상태와 다음 작업에 필요한 준비만 정리해 줘.
이번 첫 인수 확인에서는 코드 수정, 빌드, 앱 재실행, 푸시, 배포를 하지 마.
```

개발용 Claude의 설치·로그인은 사용하는 도구에서 별도로 진행한다. 앱의 Claude 번역 연결은
`src-tauri/src/translation/subscription_cli.rs`가 담당하는 별도 제품 기능이다.
개발 도구를 바꾼다는 이유로 기존 ChatGPT 공급자 구현이나 인증 파일을 삭제하지 않는다.
이 문서에 개인 인증 값이나 Codex 대화 원문은 포함하지 않는다.

## 2. 확인한 저장소 상태

| 항목 | 인수인계 시작 시 확인값 |
| --- | --- |
| 브랜치 | `main` |
| 시작 커밋 | `bfa4aaf` — 원격 최신 변경을 로컬 정리 기록과 병합 (2026-11-08) |
| 작업 트리 | 변경 없음 |
| 로컬 `origin/main`과 차이 | 앞섬 0 / 뒤처짐 0. 이번 작업에서 fetch하지 않았으므로 현재 서버 상태 확인은 아님 |
| 본체 | `package.json`, `src-tauri/tauri.conf.json`: `0.7.13-beta` |
| 확장 소스 | Chromium/Firefox manifest: `0.7.13`. 스토어 배포 버전 확인은 아님 |
| 로컬 도구 | Node.js `v24.17.0`, npm `11.13.0`, rustc `1.97.1`, cargo `1.97.1` |

인수인계 문서 커밋은 위 시작 커밋 이후에 추가된다. 다음 작업에서는 이 표를 현재 상태로
가정하지 말고 다시 확인한다. 사용자에게 새 기능이나 미해결 버그 작업을 별도로 지정받지는 않았다.
과거 채팅에만 있던 요청과 미공개 작업 목록까지 이 문서로 복원한 것은 아니다.

최근 변경은 MiLMMT 12B, NAS 모델 폴더, 서식 조각의 언어 감지와 공유 모델 다운로드 잠금이다.
기준 기록은 [0.7.13-beta 변경 내역](releases/0.7.13-beta.md)과
[로컬 검증·잠금 복구](releases/0.7.13-beta-local.md)다.

## 3. Git만 옮기면 빠지는 문서

루트의 다음 7개 파일은 `.gitignore`에 명시되어 있고 Git으로 관리하지 않는다.

- `PROJECT.md`
- `ARCHITECTURE.md`
- `HYMT.md`
- `MACOS.md`
- `MULTILINGUAL.md`
- `PRODUCT_LANGUAGE.md`
- `TAURI_MIGRATION.md`

이 작업은 이 7개 원본과 `CLAUDE.md`, `AGENTS.md`, 이 인수인계서를
`artifacts/claude-handoff-2026-11-17.zip`에 별도로 보관한다. ZIP도 Git 제외 파일이며,
전체 소스나 인증·사용자 데이터 백업은 아니다. 같은 PC에서는 원본 파일을 그대로 사용한다.
다른 PC로 옮길 때는 Git 저장소와 이 ZIP을 함께 전달한다.

새 복제본에서 ZIP을 먼저 별도 빈 폴더에 풀고 `local-docs/`의 7개 파일을 저장소 루트에
복사한다. 기존 동명 파일이 있으면 비교하고 병합하며 자동 덮어쓰지 않는다.
ZIP의 `CLAUDE.md`, `AGENTS.md`, `docs/CLAUDE_HANDOFF.md`는 시점별 참고본이다.
새 저장소에 이미 있는 최신 Git 관리 파일 위에 덮어쓰지 않는다.
`SHA256SUMS.txt`는 ZIP 내부 문서들의 SHA-256을 제공한다.

모델, 런타임 DLL, 빌드 캐시, 사용자 설정, Windows 자격 증명, 업데이트 서명 개인 키는
이 문서 묶음에 포함하지 않는다. 새 PC의 개발 환경과 외부 서비스 인증은 별도로 준비한다.
특히 기존 업데이트 개인 키를 잃었다고 새 키로 조용히 교체해서는 안 된다.

## 4. 제품 방향과 보존해야 할 경계

- Windows 우선 Tauri 2/Rust 앱이다. 설정·트레이·사전 UI는 HTML/CSS/JavaScript다.
- Discord는 Electron의 익명 CDP 파이프와 화면 DOM을 이용한다. 사용자 토큰, 비공식 API,
  self-bot, 설치 파일 변조를 도입하지 않는다. 마지막 메시지 전송은 사용자에게 맡긴다.
- Stable/PTB/Canary 연결을 유지하며 활성 창 중심으로 처리한다. 설정은 전역 공유한다.
- 기본 로컬 모델은 Hy-MT2 1.8B, 품질 선택지는 7B다. TranslateGemma 4B와 MiLMMT 12B는
  실험 선택지다. OCR은 기본 제품 기능이며 Rust 네이티브 경로를 유지한다.
- Chrome·Whale·Firefox 확장은 인증된 Native Messaging/loopback 브리지로 본체 엔진을 사용한다.
- 외부 번역 공급자는 선택 사항이다. 전송 범위·동의·인증·기록 보관과 삭제 경계를 유지한다.
- 웹 동의 v2, 사적 읽기 동의 v5와 Gmail/Outlook 읽기 경계는
  [웹 읽기 범위](WEB_READING_SCOPE.md)를 따른다. 옛 아키텍처 문서의 v3 설명만으로 판단하지 않는다.
- 입력값·편집기·코드·URL·이메일·닉네임/핸들·링크 목적지와 대화/메일 경계를 보호한다.
  기존 자연어 링크 문구와 공개 메뉴·검색 라벨 번역도 유지한다.
- 일반 창의 암호화 캐시·기록 정책과 시크릿 창의 메모리 전용 정책을 구분한다.
  진단을 핑계로 보호된 본문이나 개인 대화를 읽거나 내보내지 않는다.
- 툴팁은 기존 `data-tooltip`과 디자인 토큰을 사용한다. HTML `title`을 새로 도입하지 않는다.
  키보드 초점, 다국어, 접근성과 화면 가장자리 잘림도 확인한다.
- 제3자 라이브러리·모델을 추가하면 라이선스·배포 조건과 `THIRD_PARTY_NOTICES.md`를 갱신한다.

## 5. 코드와 문서 지도

| 작업 | 주로 볼 코드 | 먼저 읽을 문서 |
| --- | --- | --- |
| 앱 창·트레이·설정 | `src-tauri/src/main.rs`, `config.rs`, `web/app.js`, `web/tray.js` | `docs/ARCHITECTURE.md`, `docs/PROVIDER_SETTINGS_UI.md` |
| Discord 연결·창 전환 | `discord.rs`, `discord_focus.rs`, `cdp.rs`, `engine.rs` | `docs/DISCORD_ACTIVE_WINDOW.md`, `docs/DISCORD_CONNECTION_STATUS_INVESTIGATION.md` |
| Discord 수집·적용·전송 | `dom.rs`, `outgoing.rs`, `engine/`, `translation/discord_format.rs` | `docs/DISCORD_MESSAGE_EDITS.md`, `docs/DISCORD_SCROLL_PERFORMANCE.md`, `docs/OUTGOING_SYMBOL_PASSTHROUGH.md` |
| 번역 엔진·로컬 모델 | `translation/service.rs`, `translation/resilient.rs`, `translation/hymt.rs`, `translation/local_model.rs`, `providers.rs` | `HYMT.md`, `docs/CPU_PERFORMANCE.md`, `docs/releases/0.7.13-beta-local.md` |
| 외부 공급자·인증 | `translation/subscription_cli.rs`, `translation/openai_compat.rs`, `translation/codebuddy_cli.rs`, `credentials.rs` | `docs/CODEBUDDY.md`, `docs/OPENAI_COMPAT_CREDENTIALS.md` |
| 웹 수집·적용·동의 | `extension/content.js`, `extension/dom-policy.js`, `extension/messenger-adapters.js`, `extension/background.js` | `docs/BROWSER_EXTENSION.md`, `docs/WEB_READING_SCOPE.md`, `docs/WEB_TRANSLATION_COVERAGE.md` |
| 웹 브리지·등록 | `browser_bridge.rs`, `browser_setup.rs`, `extension/native-client.js` | `docs/ARCHITECTURE.md`, `docs/BROWSER_SHORTCUT_RECOVERY.md` |
| OCR·사전 | `ocr.rs`, `image_translation.rs`, `dictionary.rs`, `web/dictionary.js` | `docs/OCR_BUILD_INVESTIGATION.md`, `DICTIONARY.md`, `docs/DICTIONARY.md` |
| 캐시·기록 | `cache.rs`, `cache_crypto.rs`, `app_paths.rs` | `PRIVACY.md`, `docs/MESSENGER_SHARED_POLICY.md` |
| 다국어 | `web/ui-locales.json`, `web/i18n.mjs`, `scripts/generate-extension-locales.mjs` | `PRODUCT_LANGUAGE.md`, `docs/LANGUAGES.md` |
| 패키징·업데이트 | `scripts/package_windows_variants.ps1`, `package_github_release.ps1`, `release-updates.mjs`, `updater.rs` | `docs/WINDOWS_RELEASE.md`, `CODE_SIGNING_POLICY.md` |
| 웹 소개 페이지 | `landing/`, `.github/workflows/deploy-landing-pages.yml` | `landing/README.md` |

표의 Rust 축약 경로는 `src-tauri/src/` 기준, 축약 패키징 스크립트는 `scripts/` 기준이다.
소스 manifest 버전과 공유·스토어 확장 버전은 자동으로 같다고 가정하지 않는다.
[확장 버전 분리 기록](BROWSER_EXTENSION_VERSION_SPLIT.md)은 과거 작업 기록이며 현재 배포 상태는 별도 확인한다.

## 6. 개발·검증 명령

저장소 루트의 PowerShell에서 실행한다. 새 환경에는 Rust/MSVC Windows 빌드 도구,
Windows SDK, Node.js/npm과 WebView2가 필요하다. ARM64 패키징에는 해당 Rust target과
MSVC 크로스 빌드 구성요소도 필요하다. 실제 요구사항은 패키징 스크립트의 사전 검사를 따른다.

```powershell
# 새 환경의 의존성 준비. 기존 환경에서 무조건 반복할 필요는 없다.
npm ci
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup_hymt_runtime.ps1
npm run test:e2e:install

# 개발 실행
npm run tauri:dev

# JS 단위 검사와 다국어 검사
npm test
npm run test:locales

# Rust 검사
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo test --manifest-path src-tauri/Cargo.toml --no-fail-fast
cargo clippy --manifest-path src-tauri/Cargo.toml --bin nude-translator-tauri -- -D warnings

# 전체 E2E와 별도 공개 표본 검사
npm run test:e2e
npm run test:public

# 설치 패키지를 만들지 않는 본체 release 빌드
npm run tauri:build
```

한 명령이 실패하면 뒤의 성공으로 덮지 말고 종료 코드와 원인을 확인한다.
변경 범위에 맞게 검증하되, 웹 번역 문제는 `AGENTS.md`의 필수 절차를 따른다.

웹 문제는 도메인 없는 최소 HTML fixture로 먼저 재현하고 현재 코드에서 테스트 실패를 확인한다.
selector 예외보다 DOM 의미·가시성·편집 상태·동적 렌더링의 공통 원인을 고친다.
수정 후 전체 E2E를 실행하고, 공통 수집·가시성·적용 경로를 바꾸면 독립 진단·구조 생성 검사와
`npm run test:public`도 실행한다. 사이트별 예외는 범용 수정이 불가능한 이유와 사용자 확인이 필요하다.

[E2E 안내](../extension/e2e/README.md)에 따라 격리 Chromium을 설치한다.
E2E는 실제 Chromium + 합성 HTML + 모사 Native Messaging을 사용한다.
실제 Discord, 로그인 사이트, Rust Native Messaging 등록, AI 모델 품질, Whale/Firefox 실사용을
검증한 결과로 바꾸어 표현하지 않는다. 공개 표본 검사도 실제 번역 엔진 검증은 아니다.
공개 네트워크 차단·표본 변경 등으로 실패하면 실행하지 못한 범위를 보고한다.

## 7. 빌드·바로가기·릴리스

작업 종료 절차는 `AGENTS.md`를 따른다. 사용자에게 명시적으로 빌드·실행 생략을 요청받은
경우에만 해당 절차를 생략한다. 이번 인수인계 문서 작업에는 생략 요청이 있었으며,
이 예외를 다음 기능 작업에 자동 적용하지 않는다.

Windows 패키징은 x64와 ARM64를 함께 만든다.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package_windows_variants.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/sync_developer_shortcuts.ps1 -Restart
```

개발자 실행본은 `dist/NudeNyangDiscordTranslator/NudeNyangDiscordTranslator.exe`다.
동기화 스크립트는 x64 target 빌드와 해시·제품 버전을 비교하고 프로젝트 및 기존 실제 바탕화면
바로가기의 대상·작업 폴더·아이콘을 맞춘다. 다른 설치본을 가리키면 중단한다.
`-Restart`는 정확한 경로의 해당 프로젝트 프로세스를 다시 실행하고 경로·버전·응답을 확인한다.
단순 `tauri:build` 산출물과 target별 패키징 산출물을 혼동하거나 검사 실패를 우회하지 않는다.

공개 릴리스가 별도로 요청된 경우에만 [Windows 릴리스 절차](WINDOWS_RELEASE.md)를 진행한다.
`package_github_release.ps1`은 패키징·서명·검증용이며, `deploy_github_release.ps1`은 실제 게시 단계다.
두 설치형, 각 `.sig`, `latest.json`, `SHA256SUMS.txt`와 기존 공개 키의 서명 검증을 모두 확인한다.
포터블판을 공개 릴리스에 넣지 않는다. 공개 파일 검증 전에는 `updates/beta/latest.json`을
새 버전으로 커밋·푸시하지 않는다. 기존 업데이트 주소와 서명 키를 유지한다.

**릴리스 분류 주의:** `AGENTS.md`의 기본은 `-beta`의 프리릴리스 및 `--latest=false`다.
반면 README와 Windows 릴리스 문서는 0.7.13-beta 등 일부 버전이 당시 사용자의 명시적 요청으로
정식 최신 릴리스가 된 예외를 기록한다. 과거 예외를 다음 버전의 정식 게시 승인으로 사용하지 않는다.
새 정식 게시 요청이 없으면 기본 규칙을 따른다. 이번 인수인계에서는 GitHub의 현재 분류를 조회하지 않았다.
1.0.0은 문서상 macOS 출시 시점 계획이며 Windows 정식 표시만으로 버전을 올리지 않는다.

## 8. 남은 확인 범위와 로컬 자원

다음은 새로 발견한 결함이나 확정된 작업 지시가 아니라 기존 문서에 남은 검증 한계다.

- 0.7.13-beta 기록은 MiLMMT 실제 추론, 실제 Discord 메시지 번역, 두 PC/NAS 동시 동작,
  ARM64 실제 기기 실행을 검증 범위에서 제외한다. 관련 작업 시 별도로 확인한다.
- macOS는 아직 지원하지 않는다. 로컬 `MACOS.md`에 Apple Silicon 준비 계획이 있다.
- `docs/STORAGE_CLEANUP_20261031.md`에는 Rust `target` 정리 이력이 있다.
  이번 확인에서는 `src-tauri/target`과 개발자 EXE가 존재하지만 빌드 최신성은 검증하지 않았다.
  다음 빌드의 캐시 상태나 소요 시간을 과거 기록만으로 단정하지 않는다.
- 기존 사용자 데이터 경로는 코드상 `%LOCALAPPDATA%\LocalTools\NudeNyang Discord Translator`다.
  업데이트 키 보관 경로는 릴리스 문서상 `%LOCALAPPDATA%\NudeNyang Discord Translator\secrets`다.
  개발 도구를 바꾸는 데 이 경로의 삭제·초기화는 필요하지 않다. 이번에 내용은 읽지 않았다.
- `NUDE_TRANSLATOR_MODEL_DIR`는 NAS 등 모델 폴더 지정에 쓰인다. 이번에 설정값을 조회하지 않았다.
  남은 모델 `.lock`을 파일 나이나 로컬 PID로 빼앗지 않는다. 모든 공유 PC의 작업 종료 후
  문서의 복구 절차를 따르며 `.gguf`, `.part`, `.sha256`을 임의 삭제하지 않는다.
- Codex 전용 MCP·스킬·자동화가 Claude에 자동으로 연결되었다고 가정하지 않는다.
  프로젝트의 CLI와 테스트는 저장소에 있고, 외부 도구 연결·권한은 새 환경에서 별도로 확인한다.

## 9. 이번 인수인계의 검증 범위

이번 변경은 `CLAUDE.md`와 이 문서, 로컬 문서 ZIP뿐이다.
문서의 파일 경로·npm 명령·버전 일치, Git diff 공백 검사 및 ZIP 문서 해시를 확인한다.
사용자 요청에 따라 앱 빌드·실행·바로가기 동기화는 생략하며, 제품 테스트/E2E를 새로
통과했다고 주장하지 않는다. 실제 실행한 검사의 결과와 로컬 커밋 해시는 작업 종료 보고에 남긴다.
