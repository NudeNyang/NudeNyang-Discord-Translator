# 웹 확장 0.7.8 스토어 제출

## 고정 범위

- 확장: `0.7.8`, 호환 Windows 본체: `0.7.3-beta`.
- 기존 로컬 AI 전용·브라우저별 동의 버전 2·개인 대화 임시 메모리 정책을 유지한다.
- 이번 제출에는 브라우저 연결 안내와 연결 전용 알람을 포함한다. 캐시 정책 개정과 사이트 어댑터 리팩토링은 다음 작업으로 분리한다.
- 본체 업데이트 후 기존 웹 번역 활성 설정은 설치 안내를 위해 한 번 꺼진다. 사용자가 다시 켜면 이후 재시작에도 유지되며, 브라우저별 메신저 개인정보 동의는 별도로 유지된다.
- 사용할 브라우저가 이미 연결되어 있으면 웹 번역을 켤 때 설치 안내를 생략한다. 브라우저별 연결 해제는 본체 사용 중지이며 확장 삭제나 개인정보 동의 철회가 아니다. 자동 연결 신호는 해제 상태를 취소하지 않는다.
- 업로드, 심사 요청, 심사 승인, 공개는 서로 다른 단계다. 로컬 검증 통과를 스토어 승인으로 표현하지 않는다.

## 패키지와 항목

| 대상 | 업로드 파일 (`release/browser-extension/`) | 기존 항목 ID |
| --- | --- | --- |
| Chrome 웹 스토어 | `NudeNyang-Web-Translator-Chromium-0.7.8.zip` | `kpagdcdgomdlnnphakjakpodmgnhgaia` |
| Whale 스토어 | 위와 동일한 Chromium ZIP | `afnknfkmicnmdcfgmddelbpmkadcgifk` |
| Firefox AMO | `NudeNyang-Web-Translator-Firefox-0.7.8.xpi` | `web-translator@nudenyang.github.io` |
| Firefox 소스 검토 | `NudeNyang-Web-Translator-Firefox-0.7.8-source.zip` | XPI의 생성 전 소스와 재현 절차 |

기존 항목을 업데이트한다. 별도 항목을 만들거나 개인 개발용 ID를 스토어 ID로 사용하지 않는다.
Chromium ZIP에는 개발용 `key`가 없어야 한다. Firefox XPI는 AMO 제출용 미서명 파일이며,
일반 사용자에게 영구 설치용 서명 파일인 것처럼 전달하지 않는다.

## 제출 전 차단 조건

다음 조건을 모두 확인한 뒤 심사를 요청한다.

- [ ] 최종 소스가 커밋되어 있고, 해당 소스로 만든 패키지의 버전·내용·해시가 기록되어 있다.
- [ ] 확장·웹 테스트, Rust 관련 테스트, 구문·포맷 검사 및 Firefox lint가 통과한다.
- [ ] Firefox 소스 ZIP만 풀어 의존성을 설치하고 확장을 재생성할 수 있다. 재생성된 XPI의 파일 내용이 제출 XPI와 일치한다.
- [ ] [호환 본체 0.7.3-beta](https://github.com/NudeNyang/NudeNyang-Discord-Translator/releases/tag/v0.7.3-beta)에 x64·ARM64 설치형이 모두 공개되어 있다.
- [ ] [공개 개인정보 처리방침](https://github.com/NudeNyang/NudeNyang-Discord-Translator/blob/main/PRIVACY.md)이 동의 버전 2와 메신저 처리 범위를 설명한다.
- [ ] 본체 Native Messaging 허용 목록에 Chrome·Whale 항목 ID와 Firefox Add-on ID가 포함되어 있다.
- [ ] 각 스토어의 설명·개인정보 응답·심사 안내가 실제 동작과 일치한다. 예전의 “개인 메시지를 처리하지 않음”이나 `0.7.0-beta` 본체 안내가 남아 있지 않다.
- [ ] 기존 심사 중 버전의 상태와 새 버전 업로드 방식을 확인한다. 기존 심사나 게시를 임의로 취소하지 않는다.
- [ ] 설치·본체 연결·일반 웹 번역·원문 복원과 동의 거부/철회 동작을 제출 환경에서 확인한다. 미검증 항목은 구분해 기록한다.

개인 DM, 연락처, 계정 정보, 인증 정보가 포함된 화면이나 로그는 제출 자료에 넣지 않는다.
로그인 기능 검증을 위해 심사자가 테스트 계정을 요청하면 개인 계정 대신 별도로 허가된 테스트
환경을 준비한다. 실제 계정 검증을 완료하지 않은 메신저를 모두 검증했다고 주장하지 않는다.

## 스토어 설명 — 한국어

NudeNyang Web Translator는 Windows용 NudeNyang 본체의 번역 엔진으로 웹페이지의 보이는 글을 번역합니다. 링크와 기존 페이지 구조를 유지하며 팝업이나 단축키로 번역과 원문을 전환할 수 있습니다.

Windows 10 또는 Windows 11과 별도로 설치하는 NudeNyang 본체 0.7.3-beta가 필요합니다. 로컬 AI 모델은 본체에서 다운로드합니다. 일반 웹페이지에서는 사용자가 선택한 외부 번역 서비스도 사용할 수 있으며 해당 서비스의 계정과 이용 조건이 적용될 수 있습니다.

웹 메신저 읽기 번역은 기본적으로 꺼져 있습니다. 본체 설정과 브라우저별 개인정보 동의를 모두 완료하면 식별 가능한 현재 대화의 보이는 본문을 로컬 AI로만 번역합니다. 웹 Discord에서는 현재 대화의 링크 미리보기 텍스트와 현재 서버의 보이는 채널명도 포함합니다. 개인 대화는 일반 디스크 캐시·번역 기록·본문 로그에 저장하지 않습니다. 작성 중인 입력, 연락처, 전송 기능, 첨부 파일과 이미지 내용은 대상이 아닙니다.

일반 페이지의 로그인·계정·결제 영역과 브라우저 내부 페이지는 번역하지 않습니다. 사이트 구조에 따라 일부 텍스트가 원문으로 남을 수 있습니다. 개발자는 번역 내용을 수집하는 서버를 운영하지 않습니다.

본체: https://github.com/NudeNyang/NudeNyang-Discord-Translator/releases/tag/v0.7.3-beta

개인정보 처리방침: https://github.com/NudeNyang/NudeNyang-Discord-Translator/blob/main/PRIVACY.md

## Store summary — English

Translate visible webpage text through the NudeNyang Windows app while preserving page layout.

## Store description — English

NudeNyang Web Translator translates visible webpage text using the separately installed NudeNyang Windows companion while preserving links and page structure. Use the popup or a shortcut to translate and restore the original text.

Requires Windows 10 or Windows 11 and NudeNyang companion 0.7.3-beta. Download a local AI model in the companion. Ordinary webpage translation also supports external providers explicitly selected by the user; those services may require their own account or subscription.

Optional web-messenger reading is off by default and requires both the companion setting and explicit consent in each browser profile. It translates visible text in the identifiable current conversation using local AI only. In web Discord, this also includes link-preview text in that conversation and visible channel names in the current server. Private text is not written to ordinary disk caches, translation history, or message-body logs. Drafts, contact lists, send actions, attachments, and image contents are excluded.

Generic translation excludes login, account, payment, and browser-internal pages. Some text may remain untranslated when a site's structure is unsupported. The developer does not operate a server that collects translation content.

Companion: https://github.com/NudeNyang/NudeNyang-Discord-Translator/releases/tag/v0.7.3-beta

Privacy: https://github.com/NudeNyang/NudeNyang-Discord-Translator/blob/main/PRIVACY.md

## 개인정보·권한과 검토 안내

- 단일 목적·데이터 범주·권한별 사용 이유는 `BROWSER_STORE_PRIVACY.md`를 사용한다. `alarms`도 연결 전용 목적을 설명한다.
- Chrome에서는 Website content, Web history, Personal communications 처리 범위를 고지한다. 메시지 자체에 민감 정보가 포함될 수 있으므로 “개인정보를 전혀 처리하지 않음”으로 답하지 않는다.
- Firefox 필수 범주는 `websiteContent`, `browsingActivity`, 선택 범주는 `personalCommunications`다. Native Messaging으로 같은 PC에 보내는 데이터도 고지한다.
- Firefox 심사 메모에는 `FIREFOX_AMO_REVIEW.md`의 본체 설치·모델 준비·일반 페이지·메신저 동의 검증 절차와 재현 빌드 절차를 제공한다.
- 자체 번역 기능은 무료지만 선택형 외부 서비스의 이용 조건은 별도다. 결제 관련 질문은 스토어 문항의 실제 범위를 확인해 답한다.
- 일반 번역 화면의 중립적인 기존 이미지만 사용한다. Whale의 권장 스크린샷 규격은 1280×800, 아이콘은 128×128이다.

## 재현 명령

```powershell
npm ci
npm run test:extension
npm run test:web
npm run extension:chromium
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package_firefox_amo.ps1
npx --yes web-ext@10.6.0 lint --source-dir dist/firefox-extension --warnings-as-errors
```

## 공식 기준

- [Chrome 제출 준비](https://developer.chrome.com/docs/webstore/prepare)
- [Chrome 사용자 데이터 고지](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
- [Firefox Add-on Policies](https://extensionworkshop.com/documentation/publish/add-on-policies/)
- [Whale 스토어 등록](https://developers.whale.naver.com/distribution/)
