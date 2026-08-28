# 웹 번역 브라우저 E2E

```sh
npm ci
npm run test:e2e:install
npm run test:e2e
```

Node.js 버전은 저장소의 jsdom 개발 의존성 요구사항을 따른다. E2E는 고정된 Playwright
버전의 Chromium을 별도로 내려받으며, 사용 중인 Chrome·Whale·Firefox 프로필과 설치된
확장, 브라우저 로그인, Native Messaging 레지스트리를 변경하지 않는다.

설치·실행 스크립트는 모두 Playwright의 공식 hermetic 설정 `PLAYWRIGHT_BROWSERS_PATH=0`을
자식 프로세스에만 적용한다. 브라우저는 `node_modules/playwright-core/.local-browsers`에
설치되므로 `npm ci` 후에는 `npm run test:e2e:install`도 다시 실행한다. 전역 환경 변수나
공유 브라우저 캐시를 변경하지 않는다. 검증 PC에서 공유 LOCALAPPDATA 캐시의 Chromium은
Windows 오류14001(SideBySide)로 시작하지 못했지만 동일 버전의 hermetic 설치는 실행됐다.
이 차이를 시스템 설정·권한 우회로 해결하지 않고 테스트 도구의 공식 격리 설치를 사용한다.
공식 설치 문서: <https://playwright.dev/docs/browsers#hermetic-install>.

## 검증 경계

각 테스트는 임시 프로필에 실제 Manifest V3 확장을 로드한다. 저장소 manifest의
`content_scripts` 순서와 실제 `content.js`, 사이트/메신저 정책, helpers, background,
privacy gate, `native-client.js`를 그대로 사용한다. Chromium의 실제 CSS·레이아웃·
MutationObserver·IntersectionObserver·이벤트·확장 메시지 경계를 거쳐 수집, 비동기 응답,
DOM 적용과 원문 복구를 확인한다.

Native Messaging **포트만** 결정적인 테스트 응답(`번역(원문)`)으로 대체한다. 테스트용
manifest에서는 `nativeMessaging` 권한도 제거하여 실수로 사용자 본체에 접속할 수 없게
한다. 따라서 Rust 브리지, OS Native Messaging 등록, 실제 AI 모델, 번역 품질을 이 결과로
검증했다고 해석하지 않는다. 이 범위는 별도 Rust 테스트와 실제 통합 확인이 필요하다.

웹페이지는 테스트가 작성한 HTML fixture이며 요청을 가로채 공급한다. 나머지 HTTP(S)
요청은 모두 차단한다. 특정 사이트 URL을 쓰는 회귀 테스트도 실제 서버나 사용자 계정을
열지 않는다. 사이트별 fixture 성공은 해당 DOM 구조에 대한 회귀 근거이며, 로그인한
실사이트 전체나 Firefox·Whale에서의 실제 동작을 보증하지 않는다.

실패하면 `test-results/extension-e2e/`에 screenshot, native 요청 목록, Playwright trace가
남는다. 저장소에 커밋하지 않는다. 다시 실행할 때 재시도로 실패를 숨기지 않는다.

## 테스트 작성

```js
import { test, expect } from "./harness.mjs";

test("도메인과 무관한 최소 DOM 재현", async ({ extension }) => {
  const p = await extension.open({
    url: "https://fixture.example.test/article/",
    html: "<main><p id=body>Original paragraph</p></main>",
  });
  await expect(p.page.locator("#body")).toHaveText("번역(Original paragraph)");
  await p.message({ type: "nudenyang-set-enabled", enabled: false });
  await expect(p.page.locator("#body")).toHaveText("Original paragraph");
});
```

`extension.open`은 `html`, `url`, `settings`, `consent`, `enabled`, `translator`,
`deferTranslations`, 추가 iframe용 `documents: { [url]: html }`을 받는다. 기본값은
로컬 모델, 웹 번역 켜짐, 메신저 동의 없음, responsive 처리다. 기본적으로 탭 상태를
먼저 OFF로 초기화하고 실제 메시지로 ON을 요청한다. `enabled:false`는 초기 OFF를
유지하고 `enabled:null`은 제품의 자동 시작 정책을 그대로 테스트한다.

`p.page`는 Playwright Page, `p.sent()`는 포트에 보낸 원문 문자열 배열,
`p.requests()`는 translate 요청 배열, `p.status()`는 content-script 상태다.
`p.pendingTranslations()`와 `p.releaseTranslations()`로 늦은 응답 경합을 재현하고,
`p.setConsent(false)`로 실제 extension storage 변경·동의 철회 broadcast를 실행한다.
메신저 테스트는 `settings:{messengerEnabled:true}, consent:true`를 명시해야 한다.

`p.releaseTranslations({count:1, keepDeferred:true})`는 현재 한 응답만 내보내고 후속
요청도 보류한다. `omitItemIds`, `emptyItemIds`, `errorCode`로 누락·빈 결과·실패를
재현할 수 있다. 인자 없는 호출은 보류 중인 응답을 모두 내보내고 이후 정상 응답한다.
