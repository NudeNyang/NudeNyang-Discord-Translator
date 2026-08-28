# 웹 번역 DOM 리팩터링

기준: 2026-08-28, `codex/web-translation-dom-refactor`. 시작 커밋 `81c130e`.
앱 `0.7.3-beta`·확장 `0.7.9` 버전은 유지한다. 로컬 개발 변경이며 푸시·릴리스하지 않는다.

## 무엇을 바꿨는가

사이트를 하나씩 추가할 때마다 본문 선택자와 감시 영역을 늘리던 처리를 줄였다.
공개 페이지의 공통 수집·보호 판단은 `extension/dom-policy.js`, 긴 텍스트의 전송 분할과
완료 상태는 `extension/text-segments.js`, 대기열·화면 적용은 기존 `extension/content.js`가 맡는다.
Tauri/Rust 번역 엔진과 Native Messaging 규격은 바꾸지 않았다.

| 확인한 원인 | 수정 |
|---|---|
| CSS로 표시 상태가 바뀌었는데 일부 사이트의 지정된 영역만 재수집했다. | 공통 속성 변경 감시와 의미 있는 상호작용 범위를 사용하고, 같은 하위 트리 변경은 120ms 동안 합친다. |
| 수집 당시의 허용 여부만 믿으면 응답 대기 중 편집기·보호 영역이 된 노드에 결과를 덮어쓸 수 있었다. | 전송·표시·캐시 재사용마다 현재 보호 상태와 페이지를 다시 확인한다. 보호된 노드는 원문 복원 명목으로도 덮어쓰지 않는다. |
| 전송 한도와 수집 조건이 섞여 한 글자와 4,000자 초과 노드를 버렸다. | 한 글자 자연어를 허용하고 긴 노드는 전송 조각으로만 나눈다. 모든 조각이 완료돼야 원래 Text 노드를 한 번 바꾼다. 숫자·기호만 있는 노드는 유지한다. |

DLsite 서클 리포트의 본문별 class/id 선택자와 BOOTH의 중복 본문 선택자는 범용 문서 수집으로
대체했다. TAKARA TOMY·ShoPro의 별도 `visibilityRoots`는 제거했다. 새로운 사이트 selector
예외는 추가하지 않았다. DLsite의 기존 계정 수치 보호는 리포트에도 공유한다.

## 그대로 남긴 사용자 규칙

- X·Discord 등의 닉네임·핸들·작성자, 코드·편집기·사용자 입력값은 보호한다.
- URL·도메인·이메일 주소 자체인 링크 문구와 `href`는 바꾸지 않는다.
  일반 문장으로 쓰인 링크 문구는 기존처럼 번역한다. “모든 링크 문구 제외”로 바꾸지 않는다.
- 기존에 허용한 공개 메뉴·카드 검색의 고정 라벨·X 기사·YouTube 제목 등의 범위를 유지한다.
- 메신저는 전용 서비스 범위, 현재 대화, 화면 가시성, 동의, 로컬 모델 조건을 유지한다.
  일반 공개 페이지 수집기를 DM에 적용하지 않는다.
- Text 노드와 링크·이벤트를 유지하며 원문 복원, OFF/ON 캐시, 취소·페이지 이동과 전송 한도를 유지한다.

따라서 사이트 설정을 전부 삭제한 것은 아니다. 공개 UI의 기존 허용 범위와 개인정보 보호에
필요한 사이트 정책은 남겼고, 본문 모양·표시 시점에 대한 중복 보정을 공통 엔진으로 옮겼다.

## 재현과 회귀 검사

시작 코드의 기존 DOM 테스트 101개가 통과하는 상태에서 `example.org`의 최소 HTML로
문제를 재현했다. CSS 가시성 2개, 보호 상태 전환 후 응답·캐시 재사용 12개, 긴 노드와
한 글자 인라인 문장 1개, 총 15개가 수정 전에 단위 테스트와 실제 Chromium E2E 양쪽에서
실패했다. 해당 실패를 확인한 뒤 공통 코드를 수정했다.

리팩터링 중 기존 숫자 라벨 보호 회귀도 잡았다. 한 글자 자연어와 숫자·기호를 함께 둔
최소 HTML 테스트를 먼저 실패시킨 뒤, 글자 존재 여부를 판단하는 공통 조건으로 수정했다.
허용된 탐색 링크 안의 중첩 제목, 계정 수치, 표시 프레임 직전 민감 경로 이동도 회귀 검사에 포함한다.

| 검사 파일 | 확인 범위 |
|---|---|
| `extension/test/content-dom.test.mjs`와 `fixtures/dom-translation.mjs` | 도메인 독립 최소 재현, 수집·보호·복원과 비동기 경합 |
| `extension/test/site-adapters.test.mjs` | 기존 서비스 범위·민감 경로·공개 UI 소유 문맥 |
| `extension/test/text-segments.test.mjs` | 유니코드·공백 보존, 순서가 바뀐 응답, 중복·오류·취소 |
| `extension/e2e/compatibility.spec.mjs` | 기존 공개 사이트 및 8개 메신저 서비스의 합성 DOM 호환성 43개 |
| `extension/e2e/dom-regression.spec.mjs` | 실제 CSS·MutationObserver·보호 전환·긴 노드·한 글자 처리 |
| `extension/e2e/transport-regression.spec.mjs` | 20,000자 단일 노드의 여러 요청, 부분 응답, 취소·편집·SPA 이동·누락·오류·외부 전송 한도 |

기존 호환성 E2E 43개는 공통 로직 수정 전에도 통과했다. 전송 경합 테스트는 새 분할 구현의
추가 회귀 검사이며, 모두 구버전에서 먼저 실패시킨 테스트라고 주장하지 않는다.

재실행:

```powershell
npm ci
npm run test:e2e:install
npm test
npm run test:e2e
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml browser_translation
cargo test --manifest-path src-tauri/Cargo.toml browser_bridge::tests
npm run tauri:build
npm run extension:personal
```

## 검증의 경계

2026-08-28 최종 검사: `npm test` 728개(앱 웹 249·랜딩 37·확장 433·사전 도구 9),
사전팩 검사, 전체 Chromium E2E 68개, 관련 Rust 테스트 12개와 Rust 포맷 검사가 통과했다.
E2E는 재시도 0회로 실행했으며 제외·실패한 테스트는 없다. 실행 로그와 실패 재현 자료는
커밋하지 않는 `artifacts/web-dom-refactor/`에 보관한다.

`npm run tauri:build`로 로컬 실행 파일을 빌드했다. 첫 시도는 자동 재실행된 Native Messaging
호스트의 파일 잠금으로 실패했으며, 빌드 대상과 경로가 같은 호스트만 정리한 뒤 재실행해
성공했다. 개인용 확장과 검증용 Chromium ZIP·Firefox XPI도 생성하고 새 모듈의 원본 일치와
테스트 코드 미포함을 확인했다. 설치형 생성·스토어 제출·공개 릴리스는 하지 않았다.

E2E는 격리된 Chromium 프로필에서 실제 MV3 콘텐츠 스크립트·백그라운드·메시징을 실행한다.
웹페이지는 합성 HTML이며 Native Messaging 포트만 결정적인 응답으로 대체한다.
실제 사이트·계정이나 사용자의 브라우저 프로필·본체 설정을 변경하지 않는다.
실패 시 trace·화면·요청 기록을 남기고 재시도로 실패를 숨기지 않는다.

이 결과가 실제 AI의 번역 품질, 모든 로그인 사이트의 최신 DOM, Whale·Firefox의 실행,
OS Native Messaging 등록까지 검증한다는 뜻은 아니다. 기존 지원 범위의 회귀 방지가 목표지만
실사이트 전체를 완벽 지원한다고 선언하지 않는다. 임의의 CSS 형제 관계·`:has()`·스타일시트
교체에 의한 모든 가시성 변화, 이미지 OCR·PDF·임의 iframe 등도 이번 변경의 검증 범위가 아니다.

실행 환경과 포트 모사의 상세 경계는 [E2E 안내](../extension/e2e/README.md), 제품별 지원 범위는
[브라우저 확장 문서](BROWSER_EXTENSION.md)를 참조한다.
