# PR #6 검토 기록

검토일: 2026-10-17

- PR: [CodeBuddy 개인 설정 흔적과 중복 주석 정리](https://github.com/NudeNyang/NudeNyang-Discord-Translator/pull/6)
- 기준 커밋: `1a175d2b2896d8c32fa46194f6cf872e4c305877`
- 검토 커밋: `2b82ef8b5f6d3cc234a87c0475ababdf955e9b17`
- 결론: 병합 가능. 현재 동작을 깨뜨리는 변경이나 병합을 막을 문제는 발견하지 못했다.

## 변경 내용 확인

CodeBuddy 설명에 들어 있던 개인 라우트명 `viito`를 제거하고, 선택한 모델과 서비스에 따라 사용량이 달라진다는 안내로 바꾼다. 문서와 영어·일본어·중국어 기본 문구, 추가 14개 언어의 번역에 반영했다. 변경된 번역은 JSON 원본과 실행용 모듈에 동일하게 들어 있다.

Rust 설정·제공자·CodeBuddy 번역 모듈 네 파일과 `web/app.js`는 주석을 제외한 실행 코드가 기준 커밋과 같다. 모델 검색, 저장한 모델 선택, CLI 인자, 캐시 구분, 번역 재시도, 연결 처리와 아코디언 배치는 바뀌지 않는다.

## 권장 보완: 모델 ID 테스트 유지

개인 모델 예시를 삭제하면서 아래 검사 사례도 함께 줄었다.

- `src-tauri/src/config.rs:1298`: 명시한 전체 모델 ID가 설정에 보존되는 사례를 제거했다.
- `src-tauri/src/translation/codebuddy_cli.rs:478`: 전체 모델 ID를 CLI에 그대로 넘기는 사례가 기본값 `hy3`로 바뀌었다.
- `src-tauri/src/translation/codebuddy_cli.rs:555`: 도움말에서 사용자 지정 모델 ID를 추출하는 사례를 제거했다.
- `web/test/state.test.mjs:433`: 콜론·슬래시가 들어간 모델 ID 정규화 사례를 제거했다.

현재 실행 코드는 바뀌지 않았고, UI 모델 목록 검사에는 전체 ID 보존 사례가 남아 있으므로 병합을 막을 결함으로 보지는 않는다. 다만 개인 환경과 무관한 테스트 전용 ID, 예를 들어 `fixture:provider/model-v1.2`, 로 기존 검사 범위를 유지하는 편이 좋다. 실제 제공 모델로 소개할 필요는 없다.

## 실행한 검증

별도 검토 작업 폴더에서 PR 커밋을 검사했다.

| 명령 또는 검사 | 결과 |
| --- | --- |
| `cargo test --manifest-path src-tauri/Cargo.toml codebuddy -- --nocapture` | Windows 테스트 바이너리 빌드 성공. 30개 통과, 실제 계정 호출 1개 제외 |
| `npm run test:web` | 284개 통과 |
| `PLAYWRIGHT_BROWSERS_PATH=0 npx playwright test --config web/e2e/playwright.config.mjs` | 설정 화면 14개 통과 |
| `npm run test:locales` | 28개 언어, 문구 703개 검증 통과 |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | 통과 |
| `git diff --check 1a175d2...HEAD` | 통과 |
| 실행 코드 비교·변경된 번역 원본/모듈 대조 | 실행 코드 동일, 변경 문구 일치 |

GitHub에 등록된 자동 검사는 검토 시점에 없었다. 전체 Rust·확장 E2E, 실제 CodeBuddy 계정 번역, ARM64 빌드·실행은 이번 검토에서 수행하지 않았다. PR의 변경 범위는 문구·주석·테스트 정리이며, 위 결과를 실제 서비스 전체 검증으로 해석하지 않는다.

리뷰 기록만 로컬 커밋으로 남긴다. PR 병합, 원격 리뷰 게시, 푸시, 릴리스, 사용자 실행본 교체는 수행하지 않는다.
