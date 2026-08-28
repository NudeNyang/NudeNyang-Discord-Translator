# 링크 미리보기 설명 번역 누락 조사와 수정

2026-08-28 · `codex/web-translation-dom-refactor` · 조사 기준 `9129cf1`

## 결론과 범위

한 BOOTH 미리보기는 제목만 번역되고 설명은 일본어로 남으며, 다른 미리보기는
설명까지 번역되는 사례를 조사했다. 첫 설명은 **수집 누락이 아니라 내부 보호 표식의
오탐 → 품질 검사 탈락 → 설명 전체 원문 반환** 경로였다. 도메인이나 링크 허용 목록의
차이가 아니므로 사이트별 선택자 추가로 해결할 문제가 아니다.

최초 조사 커밋 `3a0613d`에서는 조사 기록만 남겼다. 아래 조사 증거는 수정 전 기준이며,
이후 적용한 공통 보호 표식 수정과 검증은 마지막 절에 구분해 기록한다.

## 확인한 증거

- 첫 화면의 설명과 공개 상품 메타데이터로 확인한 134자 원문의 SHA-256은
  `2cb8353707c9aa09c129d8ff093d3b803172a05ae91358abc3f1e9e936b3b583`이다.
  [원본 상품 페이지](https://capettiya.booth.pm/items/8708127)의 전체 설명과
  Discord에 표시된 잘린 설명은 구분했다.
- 앱 로그에서 같은 해시의 `translation-quality: final result rejected`와
  `incoming-translation: item kept as original; attempts=2`를 확인했다.
  마지막 대조 기록은 `2026-08-28T10:38:29.796Z`이다.
- 이미 실행 중인 Hy-MT2 1.8B 로컬 서버에 원문을 재생했다. 실제 보호 처리,
  Hy-MT 프롬프트·말투 보정, ResilientTranslator, incoming 서비스 경로를 사용했고,
  캐시는 별도 메모리 캐시였다. 실제 대화 화면을 수정하거나 외부 번역기로 보내지 않았다.
- 원문 그대로는 설명 전체가 원문으로 반환됐다. 장식 줄의 `ー`만 제거한 대조 입력은
  번역 결과가 적용됐다. 다만 적용된 결과에도 의미 오류가 있어 번역 정확성까지 통과한
  것으로 보지 않는다.

## 근본 원인

`protected_text.rs`는 이모지·URL 등을 `ZXQKEEP000QXZ` 같은 내부 표식으로 잠시
바꾼다. 그런데 `MARKER_ARTIFACT_RE`는 표식 앞에 Unicode 단어 경계 `\b`를 요구한다.
일본어 글자와 장음 기호 `ー`도 단어 문자여서 표식이 바로 이어지면 정규식이 놓친다.

`contains_unexpected_marker_artifact`는 개별 표식의 동일성을 비교하지 않고,
원문에는 정규식 일치가 없는데 결과에는 있으면 새로 생긴 표식으로 판단한다.
번역 중 괄호나 공백 위치가 달라지는 정상적인 경우도 여기에 걸린다.

상품·사이트와 무관한 최소 재현은 다음과 같다.

```text
원문:       【限定販売🎉】 新しい衣装です
보호 후:    【限定販売ZXQKEEP000QXZ】 新しい衣装です
번역 결과:  【한정 판매】ZXQKEEP000QXZ 새로운 의상입니다
```

동일한 표식이 그대로 있어도 원문에서는 일본어 뒤여서 감지되지 않고,
결과에서는 `】` 뒤여서 감지된다. 이 경우 `invented_marker=true`가 되어 실패한다.

수정 전 `protected_text.rs`에서 확인한 최소 기대값은 다음과 같다.
조사 당시 코드에서는 마지막 검증이 실패했다.

```rust
#[test]
fn preserves_existing_emoji_marker_next_to_japanese_text() {
    let source = protect_text("【限定販売🎉】 新しい衣装です");
    let result = "【한정 판매】ZXQKEEP000QXZ 새로운 의상입니다";
    assert!(!contains_unexpected_marker_artifact(&source.masked, result));
}
```

첫 설명의 실제 재생에서도 조립된 결과에 대해 `marker=true`, `max_kana_run=0`,
`remaining_han=0`, `hangul=81`, `kana_suffix=false`를 확인했다. 즉 장식 줄을
일본어 미번역 문장으로 판정한 것이 직접 원인은 아니다. 장식 줄을 제거한 대조군에서는
다른 보호 표식 앞에 공백이 생겨 원문에서도 표식이 감지되므로 오탐이 발생하지 않았다.

`resilient.rs::translation_needs_repair`는 이 오탐을 품질 실패로 취급한다.
`service.rs`의 incoming 경로는 재시도 후에도 실패하면 텍스트 전체를 원문으로 반환한다.
제목과 설명은 독립 텍스트이므로 제목만 번역된 상태가 가능하다.

추가로 데스크톱 `engine.rs`는 원문 반환도 `PartState`에 기록한다. 같은 노드와 표시값이
유지되면 완료된 값과 같다고 보고 건너뛰므로 즉시 다시 시도하지 않을 수 있다.
이 화면 상태와 번역 성공 결과의 영구 캐시는 별개다. 메모리 캐시만 쓴 재생에서도
실패했으므로 이번 실패에 기존 디스크 캐시는 필요조건이 아니다.

## 재현 검사와 제한

조사용 임시 Rust 테스트를 추가해 실행하고, 원래 코드로 정확히 복원했다.
재현 코드와 로그는 로컬 `artifacts/preview-investigation/`에만 보관했다.

| 검사 | 결과 |
|---|---|
| `investigate_preview_quality_with_existing_local_server` | 실제 로컬 모델 재생에서 예상과 달리 원문 반환. 실패 1개로 증상 재현 |
| `temporary_preview_quality_predicates` | 조립된 결과의 표식 오탐 확인. 실패 1개 |
| `temporary_adjacent_protected_marker_reproduction` | 위 합성 문장만으로 동일 오탐. 실패 1개 |

진단 코드를 복원한 뒤 기존 검사를 다시 실행했다.

| 명령 | 결과 |
|---|---|
| `cargo test --manifest-path src-tauri/Cargo.toml translation::` | 181개 통과, 19개 선택 실행 테스트 제외 |
| `npm run test:e2e` | 전체 Chromium 확장 E2E 139개 통과, 2.2분 |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | 통과 |
| `git diff --check` | 통과 |

위 검사는 수정 성공을 뜻하지 않는다. 두 번째 스크린샷의 실제 DOM·원문 전체·번역 당시
응답은 직접 확보하지 않았으므로 그 카드의 세부 처리 이력까지 검증한 것은 아니다.
두 번째 카드가 번역됐다는 관찰과, 첫 번째의 실패 원인을 구분한다.
로그는 데스크톱 incoming 경로에서 확인했으며 웹 메신저는 공통 보호 표식·품질 검사를
공유하므로 잠재 영향은 있지만 웹 화면에서도 같은 현상을 직접 재현했다고 주장하지 않는다.
기존 DOM E2E는 번역 엔진을 모사하므로 실제 로컬 모델 내부의 보호 표식 조립·검사 오류를
통과 결과만으로 배제할 수 없다.

## 조사 당시 제안한 수정 방향

1. 기존 보호 표식을 식별할 때 주변 언어의 단어 경계에 의존하지 않도록 한다.
   원문에 있던 표식의 보존·이동과 새로 생성되거나 깨진 표식을 구분한다.
2. 위 합성 문장 외에도 한글·일본어·장식 문자 인접, 공백·괄호 이동, 여러 이모지,
   실제 누출 표식 및 일반 사용자 텍스트를 함께 회귀 검사한다.
3. 품질 실패 상태와 번역 완료 상태를 분리하고, 제한 있는 재시도로 복구 가능하게 한다.
   실제 미번역·누락 검사를 통째로 끄거나 무한 재시도를 도입하지 않는다.
4. 수정 후 전체 E2E와 실제 로컬 모델 재생을 각각 실행한다. 이번에 함께 드러난 말투
   보정·잘린 단어의 의미 오류는 표식 오탐 해결과 별도의 정확성 문제로 검증한다.

## 적용한 공통 수정

- 완전한 내부 표식은 앞뒤 문자의 언어·공백·괄호와 무관하게 식별한다. 불완전한 표식은
  ASCII 단어 경계를 사용해 일본어·한글 옆에서도 감지하면서 `ZXQKEEPER` 같은 일반
  단어는 지우지 않는다.
- 원문과 결과의 표식 **식별자와 개수**를 비교한다. 같은 표식의 이동, 대소문자·공백과
  선행 0의 변화는 기존 복원 규칙대로 허용하지만 새로운 번호·깨진 표식·중복은 감지한다.
- 정리할 때는 예상하지 못한 표식만 제거한다. 사용자가 원래 적었던 표식 모양의 문구까지
  일괄 삭제하지 않는다. 이모지·URL 복원, 닉네임·입력·대화 보호, 동의·캐시 정책은 유지한다.
- BOOTH나 Discord 전용 선택자·예외는 추가하지 않았다. DOM 수집·적용 경로와 데스크톱
  `PartState` 상태 머신도 변경하지 않았다. 이번 수정은 품질 검사의 오탐 원인을 없애며,
  모든 품질 실패에 대한 자동 재시도 설계를 바꾸는 작업은 아니다.

### 추가한 재현·회귀 검사

`protected_text.rs`의 기존 테스트에 일본어·한글·중국어·장식 줄·라틴 문자 인접,
표식 이동·유연한 복원, 새 번호·조각·중복 감지, 원문 리터럴 보존을 추가했다.
`service.rs`에서는 실제 보호·품질 검사와 메모리 캐시를 사용해 incoming과 web 경로를
각각 검증한다. 번역기 응답만 고정한 이 서비스 재현과 보호 표식 검사 4개가 수정 전에
실패했으며, 수정 뒤 표식 관련 검사 12개가 모두 통과했다.

브라우저 E2E에는 사이트와 무관한 `article`·제목 링크·이모지 포함 설명의 최소 HTML을
추가했다. 고정 번역 응답으로 번역 적용, 원문으로 다시 그려진 노드의 캐시 복원,
OFF/ON 시 원문·번역 복원, 링크 목적지 보존, 불필요한 재전송이 없음을 검사한다.
이 검사는 Rust 엔진을 모사하므로 엔진 수정의 재현 증거와 구분한다.

별도 선택 실행 테스트 `live_local_model_translates_decorated_preview_without_marker_rejection`는
기존에 설치된 실제 Hy-MT2 1.8B와 같은 134자 공개 설명을 사용한다. 이모지와 장식 줄이
보존된 한국어 결과가 반환되고 캐시 재사용도 통과했다. 개인 대화를 읽거나 외부 번역기로
전송하지 않았다. 다만 잘린 끝부분의 단어는 여전히 어색하게 번역되어, 이번 결과를
번역 정확성 전체의 검증으로 보지는 않는다. 실제 로그인 Discord 화면의 재확인은 별개다.

### 수정 후 검증 결과

| 명령 | 결과 |
|---|---|
| `cargo test --manifest-path src-tauri/Cargo.toml marker -- --nocapture` | 수정 전 7개 통과·5개 실패 → 수정 후 12개 통과 |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 443개 통과, 46개 선택 실행 테스트 제외 |
| `cargo test --manifest-path src-tauri/Cargo.toml live_local_model_translates_decorated_preview_without_marker_rejection -- --ignored --nocapture` | 실제 로컬 모델 재현 1개 통과 |
| `npm test` | 앱·랜딩·확장·사전 JavaScript 검사 738개 통과, 사전 검증 통과 |
| `npm run test:e2e` | 전체 Chromium 확장 E2E 140개 통과, 2.1분. 사이트 HTML과 번역 응답은 fixture |
| `npm run test:public` | 공개 표본 6개 통과. 번역 응답을 모사한 수집·적용 검사 |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` / `git diff --check` | 통과 |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | 기존 경고 3건으로 실패. 아래 제한 참조 |

Clippy 실패는 변경하지 않은 `retry_incomplete_context_parts`, `outgoing_ui_script`의
인자 개수와 `subscription_cli.rs` 테스트의 `cmp_owned`이다. 이 작업에서 관련 없는
함수의 리팩터링이나 경고 억제는 하지 않았다.

첫 전체 Rust 실행은 로그 경로 환경 변수를 지정해 기존 로그 마이그레이션 검사 1개가
실패했다. 해당 변수를 제거한 최종 전체 실행에서는 443개가 모두 통과했다.
로그·모델 출력·브라우저 추적 파일은 무시되는 로컬 `artifacts/preview-fix/` 및
`test-results/`에만 보관하고 커밋에는 넣지 않는다.
