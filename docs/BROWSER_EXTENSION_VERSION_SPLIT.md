# 공유용 0.7.10과 개발용 0.7.11

Firefox에서 이미 업로드 후 삭제된 0.7.9 번호를 다시 사용할 수 없어, 사용자가 보관한
0.7.9를 **기능 변경 없이 0.7.10으로 재패키징**했다. Chrome·Whale도 같은 번호로 맞춘다.
현재 개발 소스는 이 스냅샷과 다르므로 **0.7.11**로 올려 구분한다.

| 용도 | 버전 | 소스 기준 | 산출물 |
| --- | --- | --- | --- |
| Chrome·Whale 제출 | 0.7.10 | 보관한 0.7.9 | `release/browser-extension/0.7.10-share/NudeNyang-Web-Translator-Chromium-0.7.10.zip` |
| Firefox 직접 배포 서명 요청 | 0.7.10 | 보관한 0.7.9 | 같은 폴더의 `NudeNyang-Web-Translator-Firefox-0.7.10.xpi` |
| Firefox 검토용 소스 | 0.7.10 | 위 XPI 재현 소스 | 같은 폴더의 `NudeNyang-Web-Translator-Firefox-0.7.10-source.zip` |
| 개인용 개발 확장 | 0.7.11 | 현재 개발 소스 | `dist/chromium-personal-extension` |
| 0.7.11 제출 패키지 | 0.7.11 | 현재 개발 소스 | `release/browser-extension/0.7.11-submission` |

Chrome과 Whale은 동일한 Chromium ZIP을 제출한다. 기존 스토어 ID·Firefox Add-on ID와
개인용 ID `bdkkgjjmocmdknffadjgbljmnhdcchjl`은 바꾸지 않는다. 기존 0.7.9 파일도 보존한다.
개인용 폴더를 갱신해도 실행 중인 브라우저에 자동 반영되지는 않으므로 확장 관리 화면에서
새로고침하고 0.7.11 표시를 확인해야 한다.

## 소스와 개인정보 정책 구분

공유용은 0.7.9의 동의 v2·메신저 로컬 전용·임시 메모리 정책을 그대로 사용한다.
함께 사용할 본체는 기존에 공개한 호환 0.7.3-beta이다. 개발 중인 동의 v3·공통 번역기·
암호화 캐시 정책이나 이후 DOM/F4 개선을 이 패키지에 섞지 않는다.
본체의 제품 버전 문자열만으로 정책 호환성을 판단해서는 안 된다.

현재 소스에서 일반 패키징 명령을 실행하면 개발·제출용 0.7.11이 생성된다. **그 결과를
공유용 0.7.10으로 이름만 바꾸어 제출하지 않는다.** 0.7.11은 현재 본체·개인정보 정책과 함께
별도 심사하며 [0.7.11 제출 자료](BROWSER_STORE_SUBMISSION_0.7.11.md)를 따른다. 공유용 검토에는 해당 소스 ZIP에
포함된 개인정보 설명과 검토자 안내를 사용하며, 최신 개발 문서를 대신 첨부하지 않는다.

원본은 `release/browser-extension`에 보관된 다음 파일이다. SHA-256:

```text
1eeb58edafabe8528d7425c8bc3916c8b85d7037c04b1dce341021202c4af596  NudeNyang-Web-Translator-Chromium-0.7.9.zip
6b71e49a93e2f0f6f5714d161b803ea3dab4c2c368a8fd0dd2a282dfcf2fbc92  NudeNyang-Web-Translator-Firefox-0.7.9.xpi
6a65a6a8c5b0479268e1584889447ff07db108f03052983a53b110f6825c4dc2  NudeNyang-Web-Translator-Firefox-0.7.9-source.zip
```

원본 소스 ZIP을 독립 폴더에 풀고 아래 다섯 파일만 수정했다.

- `extension/manifest.json`, `extension/manifest.firefox.json`: 0.7.9 → 0.7.10.
- `extension/test/localization.test.mjs`: 기대 버전 0.7.10.
- `docs/FIREFOX_AMO_REVIEW.md`: 재제출 사유와 직접 배포(unlisted) 안내.
- `extension/test/firefox-compatibility.test.mjs`: 문서의 배포 채널 기대값을 직접 배포로 변경.

실행 파일·권한·정책·로케일은 수정하지 않았다. Chromium 64개, Firefox 65개 압축 항목을
원본과 비교했으며 `manifest.json`의 `version` 외에는 바이트 단위로 동일하다.

## 재현 방법

공유용 소스 ZIP을 새 폴더에 풀고 **그 폴더에서** 실행한다.
Node.js 요구 버전은 포함된 `docs/FIREFOX_AMO_REVIEW.md`를 따른다.

```powershell
npm ci
npm run extension:locales
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package_chromium_extension.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package_firefox_extension.ps1
npm run test:extension
npx --yes web-ext@10.6.0 lint --source-dir dist/firefox-extension --warnings-as-errors
```

ZIP/XPI 외부 체크섬은 압축 시각에 따라 달라질 수 있으므로 재현 비교는 전체 항목 목록과
각 항목의 내용으로 한다. 소스 ZIP을 다시 풀어 재빌드·테스트한 결과 394개가 통과했고,
재생성한 Chromium·Firefox 패키지의 전체 항목이 전달용 파일과 일치했다. 제출용 파일 SHA-256:

```text
8ec7459db56b8ac010934fbc6857695f8ad72f0cfb9b22549a14bf2504c739a4  NudeNyang-Web-Translator-Chromium-0.7.10.zip
9457522e99792f4612ceeb06d7d717ea91e126531dbdd2dd1c568b213cb53cfd  NudeNyang-Web-Translator-Firefox-0.7.10.xpi
ace460c33c0d9f7cf33f2dc2905254ffb92d6af2225f55177c8cfd2e9d5981f2  NudeNyang-Web-Translator-Firefox-0.7.10-source.zip
```

## 검증 범위

- 공유용 `npm run test:extension`: 394개 통과. 직접 배포 문서로 바꾼 첫 검사는 기존
  `public listing` 기대값 때문에 1개 실패했고, 배포 채널 검사만 수정한 뒤 전체 재검증했다.
- 공유용 `web-ext@10.6.0 lint --warnings-as-errors`: 오류·알림·경고 모두 0.
- 개발용 `npm test`: 741개 통과(웹 246, landing 37, 확장 449, 사전 9).
- 개발용 `npm run test:e2e`: 95개 통과. 실제 Chromium + 합성 페이지 + 모사 Native Messaging
  검사이며 실제 로그인 사이트·Whale·Firefox·AI 모델 검증을 대신하지 않는다.
- 개발용 `npm run test:locales`, `npm run extension:personal` 실행.
- 본체 버전은 0.7.3-beta로 유지하고 `npm run tauri:build`로 로컬 no-bundle 실행본을 생성.

## Firefox 공유 순서

생성한 XPI는 **서명 요청용 미서명 파일**이다. 현재 AMO의 직접 배포 화면에 XPI를 올리고,
소스 요청에는 `-source.zip`을 제공한다. Mozilla가 서명한 XPI를 내려받은 뒤 친구에게
전달한다. 소스 ZIP은 설치 파일이 아니다. 서명되지 않은 파일을 설치하도록 보안 설정을
낮추지 않는다. 별도 `update_url`은 추가하지 않았으므로 직접 배포 업데이트도 서명한
파일을 전달하는 방식으로 관리한다.

공식 안내: [Mozilla 직접 배포 제출](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/#self-distribution).
이 작업에서는 스토어 업로드·서명 요청·푸시·공개 릴리스를 수행하지 않는다.
