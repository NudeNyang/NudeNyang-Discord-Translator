# PR #5 검토 기록

검토일: 2026-10-15

- PR: [CodeBuddy CLI 번역 제공자와 모델 선택 추가](https://github.com/NudeNyang/NudeNyang-Discord-Translator/pull/5)
- 기준 커밋: `762d4e0e07ff77510cddb503d74516a8b5ba13ad`
- 검토 커밋: `91ab38a29499db946cf4ce677c7d06ff9a6df599`
- 결론: 아래 두 문제를 수정한 뒤 병합한다.

CodeBuddy 제공자를 기존 번역기 인터페이스에 연결하고 모델 변경 시 번역 작업을 다시 준비하는 구성은 기존 구조에 맞는다. 다만 수신 번역의 공통 실패 처리에서 회귀가 생겼고, 웹 확장의 전송 제한 연결이 빠져 있다.

## 1. 실패한 메시지가 다시 나타나면 외부 번역 요청을 반복한다 — P1

위치: `src-tauri/src/translation/service.rs:1803–1807`

수신 번역은 `keep_rejected_parts=true`로 실행된다. 품질 검사에 실패한 부분을 원문으로 채워 `Ok`로 반환하면서 실패 여부가 사라진다. 작업 스레드는 이를 성공으로 받아 `replay.clear_failure()`를 호출하지만, `DisplayReplay::store()`는 원문 그대로인 결과를 저장하지 않는다. 따라서 해당 메시지가 화면에서 사라져 임시 표시 상태가 정리되면, 다시 나타날 때 이전 실패를 기억하지 못한다.

원문을 그대로 돌려주는 로컬 OpenAI 호환 API와 가상 Discord 화면으로 재현했다. `while(true)`에 대해 최초 요청과 품질 보완 요청이 총 2회 발생한 뒤, 메시지를 화면에서 제거했다가 같은 내용으로 다시 넣으면 총 4회가 된다. 메시지 내용이나 번역 설정은 바꾸지 않았다. CodeBuddy를 선택하지 않아도 기존 제공자에서 발생한다.

PR에 원래 포함돼 있던 `extension/e2e/discord-retry.spec.mjs`의 `failed message survives remount, edits and explicit retry work, other messages still translate` 검사도 같은 이유로 실패했다. 176행에서 요청 수 2회를 기대하지만 실제 값은 4회다.

기준 커밋 `762d4e0`으로 전환해 두 검사를 똑같이 실행하면 모두 통과한다. 제거·재등장 검사에서도 요청은 최초 2회로 유지된다. 기존 문제가 남아 있는 것이 아니라 이번 PR에서 생긴 회귀다. 비교 후 작업 폴더는 PR 검토 커밋으로 복원했다.

정상 번역 부분을 표시하는 동작은 유지하되, 원문으로 남긴 실패 부분의 상태와 재시도 중단 기록을 별도로 전달해야 한다. 원문을 성공한 번역으로 캐시하는 방식은 피한다. 화면에서 사라졌다가 다시 나타나는 경우까지 회귀 검사에 포함한다.

## 2. CodeBuddy에는 웹페이지 외부 전송량 제한이 적용되지 않는다 — P2

위치: `src-tauri/src/engine.rs:4535–4540`

새 제공자는 앱의 공통 번역기로 등록되므로 웹 확장에서도 사용된다. 그러나 `extension/content.js:32`의 `EXTERNAL_TRANSLATORS`에는 `codebuddy`가 없다. 확장은 이를 외부 서비스로 분류하지 않아 본문과 삽입 영상 제목의 `externalPageCharLimit` 검사를 건너뛴다. 사용자가 설정한 한도보다 많은 텍스트가 전송될 수 있다.

기존 DOM 테스트의 전송 한도 fixture에서 제공자만 바꿔 비교했다. 한도는 10,000자, 먼저 보낼 본문은 9,988자, 이후 영상 제목은 20자다.

| 제공자 | 추가 제목 요청 | 누적 전송 문자 | 결과 |
| --- | --- | ---: | --- |
| DeepL | `limited`로 차단 | 9,988 | 기존 검사 통과 |
| CodeBuddy | 전송됨 | 10,008 | 동일 검사 실패 |

확장에서도 CodeBuddy를 외부 서비스로 인식하도록 연결하고, 본문·영상 제목 양쪽의 한도를 검사해야 한다. 이미 배포된 확장과 새 본체를 함께 쓰는 경우도 고려해야 한다.

## 실행한 검증

PR 검토 커밋을 별도 작업 폴더에서 검사했다.

| 명령 또는 검사 | 결과 |
| --- | --- |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | 통과 |
| `cargo test --manifest-path src-tauri/Cargo.toml --no-fail-fast` | 565개 통과, 51개 제외, 실패 없음. Windows x64 테스트 바이너리 빌드 포함 |
| `npm test` | 통과. 웹 UI·랜딩·확장·사전 검사 포함 |
| `npm run test:locales` | 28개 언어, 문구 703개 검사 통과 |
| `PLAYWRIGHT_BROWSERS_PATH=0 npx playwright test --config web/e2e/playwright.config.mjs` | 설정 화면 10개 통과 |
| `npm run test:e2e` | 202개 통과, 1개 실패, 같은 직렬 그룹의 후속 2개 미실행 |
| `PLAYWRIGHT_BROWSERS_PATH=0 npx playwright test --config extension/e2e/playwright.config.mjs extension/e2e/discord-retry.spec.mjs --grep 'server errors\|a transient server' --workers=1 --output test-results/pr5-retry-followup` | PR 커밋에서 후속 2개를 별도로 실행해 모두 통과 |
| CodeBuddy 전송 한도 추가 검사 | 실패. 기존 DeepL 대조군은 통과 |
| 메시지 제거·재등장 추가 검사 | 실패. 요청 수 2회 → 4회 |
| 기준 커밋의 기존 재등장 검사·추가 제거/재등장 검사 | 2개 통과. 요청 수 2회 유지 |

추가 검사는 기존 fixture를 복사한 임시 파일에서 실행했으며, 제품 소스는 수정하지 않았다. 전송 한도 검사는 DOM과 브리지 응답을 모사했다. 재시도 검사는 실제 Rust 제어기·CDP·번역 작업 스레드와 로컬 모의 API를 사용했다. 실제 Discord 대화나 외부 유료 서비스에는 요청하지 않았다.

GitHub에 등록된 자동 검사 결과는 검토 시점에 없었다. 이 PC에는 CodeBuddy CLI가 없어 실제 계정 로그인, 설치된 CLI의 모델 목록, 실제 서비스 응답은 검증하지 않았다. ARM64 패키징과 실제 로그인 사이트 검증도 이번 코드 리뷰 범위에 포함하지 않았다.

최초 검토에서는 결과와 재현 기록만 저장했다.

## 수정 반영 — 2026-10-16

두 문제는 `e81ad9d`에서 수정했다. 품질 검사에서 거부된 부분을 정상 번역과 구분해 전달하고, 같은 번역 설정 안에서는 메시지가 다시 나타나도 실패 기록을 유지한다. CodeBuddy도 확장의 외부 서비스 전송량 제한을 적용받는다. 위에서 실패했던 재등장·전송 한도 검사는 회귀 검사로 남겼다.

이후 설정 화면에서 CodeBuddy를 DeepL과 OpenAI 호환 API 사이로 옮기고, 기존 연결·해제 아이콘을 펼친 영역 안에 배치했다. 연결 버튼과 구분선 사이의 여백도 수정했다. Discord가 비활성 창일 때 기존 보안 연결에 재접속하지 않던 문제는 `a763984`에서 별도로 수정했다.

사용자 확인을 거쳐 PR 원본과 후속 수정사항을 함께 0.7.11-beta에 반영한다. 배포 범위와 실제 계정·장치 검증의 한계는 [0.7.11-beta 변경 내역](releases/0.7.11-beta.md)에 정리했다. 설치된 브라우저 확장에는 별도 확장 업데이트가 필요하다.
