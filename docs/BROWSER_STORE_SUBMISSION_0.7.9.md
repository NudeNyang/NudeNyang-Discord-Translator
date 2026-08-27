# NudeNyang Web Translator 0.7.9 제출 자료

본체는 공개된 `0.7.3-beta`를 유지한다. 확장만 `0.7.9`로 올리며 0.7.8의 메신저 동의·번역 범위·로컬 AI 원칙을 바꾸지 않는다. 이 작업의 범위는 로컬 빌드·검증·커밋이며 푸시·스토어 업로드·공개 릴리스는 포함하지 않는다.

## 변경 내용

- 본체와 연결되지 않을 때 설치·연결 안내를 표시한다. 세 번 연속 실패하기 전에는 설치 안내를 펼치지 않는다.
- 연결한 적이 있거나 본체 실행 문제인 경우 연결 복구를 우선 안내한다. 사용자가 본체에서 해제한 브라우저에는 설정 안내만 유지한다.
- 닫은 안내는 다시 펼치기 전까지 접어 둔다. 연결되면 안내를 숨기며 개인정보 동의는 그대로 유지한다.
- 다운로드 안내를 직접 열면 기존 공개 업데이트 목록에서 프리릴리스를 포함한 최신 버전과 x64·ARM64 설치형을 확인한다. 확장 업데이트 없이 새 본체 배포를 안내할 수 있다.
- 연결 확인이 긴 번역 요청에 막히거나 그 요청을 취소하지 않도록 별도 연결을 사용한다.

## 산출물

- 개인용 개발 확장: `dist/chromium-personal-extension` (기존 개인 ID 유지)
- Chrome·Whale 공용 제출 ZIP: `release/browser-extension/NudeNyang-Web-Translator-Chromium-0.7.9.zip` (개발용 key 제외)
- Firefox: `release/browser-extension/NudeNyang-Web-Translator-Firefox-0.7.9.xpi`
- Firefox 소스: `release/browser-extension/NudeNyang-Web-Translator-Firefox-0.7.9-source.zip`

개인용은 브라우저 확장 관리 화면에서 해당 폴더의 확장을 새로고침해야 반영된다. 스토어 설치본은 로컬 빌드만으로 업데이트되지 않는다.

## 새로운 기능 (영문)

```text
Added setup and connection help for the NudeNyang Windows companion.

Temporary connection failures are retried before showing guidance. Previously connected users see recovery help first, and browsers explicitly disconnected in the app are handled separately. Dismissed guidance stays collapsed.

The download guide now checks the latest published companion build, including prereleases, and offers separate x64 and ARM64 installers. It opens only when requested; downloads require a separate click.

Translation behavior and web-messenger privacy consent are unchanged.
```

## Firefox 검토자 안내 (3,000자 미만)

```text
Requires Firefox 142+ on Windows 10/11 and the NudeNyang Windows companion 0.7.3-beta, running and connected via Native Messaging.
Companion: https://github.com/NudeNyang/NudeNyang-Discord-Translator/releases/tag/v0.7.3-beta

Install and run the companion (installer registers the native host), download a local Hy-MT2 model, and enable web translation. On a public page, use the popup, F4, or Ctrl+Shift+L. Turn translation off to restore the original text.

0.7.9 adds a dismissible setup/recovery card after repeated connection failures. A successful-connection flag prioritizes recovery. Explicit browser disable never becomes an install prompt. No consent or translation setting is enabled by these checks.

Only a user click opens the bundled download guide. It fetches the existing public GitHub updates/beta/latest.json without cookies, referrers, page addresses, text, or conversations. The guide displays the published version (including prereleases) and x64/ARM64 installers. Another click starts a download. No remote code, analytics, new permission, or automatic install is added. Two local preferences remember successful connection and help dismissal.

Messenger reading is off by default. Enable it in the companion, explicitly consent in this browser profile, and grant optional personalCommunications permission. Denial/withdrawal must block it. Translation is local AI only, with no external fallback, ordinary disk cache, translation history, or body logs. Current-conversation text, Discord previews, and visible current-server channel names are eligible; drafts, contacts, sending, attachments, and image contents are excluded.

Source: NudeNyang-Web-Translator-Firefox-0.7.9-source.zip
Windows, Node.js 24.17.0, npm 11.13.0, PowerShell 5.1:
npm ci
npm run extension:firefox
Output: release/browser-extension/NudeNyang-Web-Translator-Firefox-0.7.9.xpi
Validate: npm run test:extension
npx --yes web-ext@10.6.0 lint --source-dir dist/firefox-extension --warnings-as-errors
Full instructions and limitations: docs/FIREFOX_AMO_REVIEW.md in the source archive. No claim of live testing of every messenger or ARM64 hardware is made.
```

## 제출 전 확인

- 기존 권한 사유와 일반 설명은 0.7.8 자료를 기반으로 유지한다. 다운로드 안내의 사용자 클릭 기반 GitHub 조회와 로컬 도움말 설정 추가는 개인정보 설명에 반영한다.
- `PRIVACY.md` 변경이 공개 URL에도 반영된 뒤 제출한다. 로컬 문서 수정만으로 공개 정책이 갱신되지는 않는다.
- 이번 빌드의 실제 테스트·화면 확인 범위와 미검증 항목은 완료 보고를 확인한다. 자동 테스트나 XPI 생성만으로 스토어 승인 또는 모든 브라우저 실사용 성공을 주장하지 않는다.
- 향후 본체 배포에서도 두 설치형이 공개된 후 기존 `updates/beta/latest.json`을 갱신한다. 이 목록이 확장의 최신 다운로드 기준이다.
