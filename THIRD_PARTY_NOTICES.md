# Third-party notices

NudeNyang Discord Translator 자체 소스와 구성요소는 `GPL-3.0-only`로 배포한다. 이 라이선스는 아래
제3자 구성요소의 별도 라이선스와 저작권을 대체하지 않는다.

## Hy-MT2 내장 배포

공식 Hy-MT2 GGUF 모델을 포함하는 배포판은 Tencent가 제공한 모델 파일을 사용하며, 모델에는
Apache License 2.0이 별도로 적용된다. 각 모델의 공식 라이선스 원문과 저작권 고지는 다음
파일에 변경 없이 보관한다.

- `licenses/Hy-MT2-1.8B-GGUF-LICENSE.txt`
- `licenses/Hy-MT2-7B-GGUF-LICENSE.txt`

모델을 재양자화하거나 수정해 배포하는 경우 Apache-2.0 제4조에 따라 수정 사실을 명시해야 한다.

| 구성요소 | 용도 | 라이선스 및 출처 |
|---|---|---|
| Hy-MT2 1.8B GGUF | 기본 로컬 번역 모델 | Apache-2.0, Copyright (C) 2026 Tencent, <https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF> |
| Hy-MT2 7B GGUF | 품질 우선 로컬 번역 모델 | Apache-2.0, Copyright (C) 2026 Tencent, <https://huggingface.co/tencent/Hy-MT2-7B-GGUF> |
| TranslateGemma 4B Q4_K_M | 사용자가 선택할 수 있는 실험용 로컬 번역 모델 | Gemma Terms of Use, <https://ai.google.dev/gemma/terms>, 양자화 출처: <https://huggingface.co/SandLogicTechnologies/translategemma-4b-it-GGUF> |
| llama.cpp | GGUF 추론 서버 | MIT, <https://github.com/ggml-org/llama.cpp> |
| Microsoft Visual C++ Runtime | Windows 새 설치 환경에서 llama.cpp와 네이티브 OCR 실행 | Microsoft Visual Studio 라이선스의 재배포 조건, <https://learn.microsoft.com/cpp/windows/latest-supported-vc-redist> |
| ocr-rs | Rust OCR 전·후처리와 MNN 바인딩 | Apache-2.0, <https://github.com/zibo-chen/rust-paddle-ocr> |
| MNN | 네이티브 OCR 추론 런타임 | Apache-2.0, <https://github.com/alibaba/MNN> |
| PaddleOCR 모델 | PP-OCRv6 Small/Medium 감지·인식 및 한국어 PP-OCRv5 인식 | Apache-2.0, <https://github.com/PaddlePaddle/PaddleOCR> |
| Lingua 1.8.0 및 선택 언어 모델 | 오프라인 채팅 언어 감지 | Apache-2.0, Copyright © 2020-present Peter M. Stahl, <https://github.com/pemistahl/lingua-rs> |
| getrandom 0.3.4 | 브라우저 로컬 브리지의 시작별 인증 키 생성 | MIT OR Apache-2.0, <https://github.com/rust-random/getrandom> |
| Tabler Icons | 설정 메뉴 아이콘 | MIT, Copyright (c) 2020-2026 Paweł Kuna, <https://github.com/tabler/tabler-icons> |
| Microsoft Visual C++ Redistributable | `llama-server.exe`의 앱 로컬 Windows 런타임 | Microsoft Software License Terms, <https://learn.microsoft.com/cpp/windows/latest-supported-vc-redist> |
| Microsoft Edge WebView2 Runtime | Tauri 설정 및 트레이 UI 렌더링 | Microsoft Edge WebView2 Runtime Terms, <https://developer.microsoft.com/microsoft-edge/webview2/> |

DeepL은 모델이나 SDK를 번들하지 않고 사용자가 제공한 API 키로 공식 HTTP API를 호출한다.
사용자는 DeepL의 별도 서비스 약관과 사용량 제한을 따른다.

TranslateGemma is provided under and subject to the Gemma Terms of Use found at
<https://ai.google.dev/gemma/terms>.

## 브라우저 식별 아이콘

설정의 브라우저 연결 목록에는 각 공식 사이트에서 제공하는 원본 PNG를 변경 없이 사용한다.
아이콘은 연결할 브라우저를 식별하기 위한 것이며 NudeNyang 또는 확장 프로그램의 로고가 아니다.
Google Chrome은 Google LLC, Naver Whale은 NAVER, Firefox는 Mozilla Foundation의 상표이다.
각 아이콘의 권리는 해당 권리자에게 있으며 앱의 GPL 라이선스로 재허가하지 않는다.
이 표시는 해당 회사의 제휴·후원·보증을 의미하지 않는다.

| 로컬 파일 | 공식 원본 출처 (2026-08-28 확인) |
|---|---|
| `web/assets/browser-chrome.png` | <https://www.google.com/chrome/static/images/favicons/android-icon-192x192.png> |
| `web/assets/browser-whale.png` | <https://shared-whale.pstatic.net/favicon/icon256.png> |
| `web/assets/browser-firefox.png` | <https://www.firefox.com/media/img/favicons/firefox/browser/favicon-196x196.59e3822720be.png> |

브랜드 정책: <https://about.google/brand-resource-center/products-and-services/>,
<https://www.mozilla.org/en-US/foundation/trademarks/policy/>.
Whale 원본은 <https://whale.naver.com/>의 아이콘 링크에서 확인했다.

## 개발 및 검증 도구

| 구성요소 | 용도 | 라이선스 및 출처 |
|---|---|---|
| jsdom 30.0.1 | 브라우저 확장의 DOM 수집·상태·복구 회귀 테스트 | MIT, Copyright (c) 2010 Elijah Insua, <https://github.com/jsdom/jsdom> |
| Playwright / @playwright/test 1.62.1 | 격리된 Chromium MV3 확장의 실제 브라우저 E2E 테스트 | Apache-2.0, Copyright (c) Microsoft Corporation, <https://github.com/microsoft/playwright>, <https://github.com/microsoft/playwright/blob/v1.62.1/LICENSE>, <https://github.com/microsoft/playwright/blob/v1.62.1/NOTICE> |

jsdom은 `package.json`의 개발 의존성과 `package-lock.json`에 버전을 고정한다. 개발·심사 재현
환경에서 `npm ci`로 설치하며, Windows 앱이나 브라우저 확장 ZIP·XPI의 실행 코드에는 번들하지
않는다. jsdom의 MIT 라이선스 원문은 설치된 패키지의 `LICENSE.txt`에 포함되며, 함께 설치되는
의존성에는 각각의 라이선스가 적용된다.

Playwright도 개발 의존성으로 버전을 고정하며 앱·확장 패키지에 포함하지 않는다. 설치된
`@playwright/test`, `playwright`, `playwright-core` 패키지의 `LICENSE`·`NOTICE`를 유지한다.
Playwright에는 Apache-2.0으로 제공되는 Puppeteer 유래 코드가 포함되어 있다.
테스트 브라우저는 `npm run test:e2e:install`이 별도로 내려받는 Chrome for Testing/Chromium이며
앱·확장과 함께 재배포하지 않는다. 브라우저에는 그 배포본의 라이선스와 제3자 고지가 적용된다.
공식 확장 테스트 방식: <https://playwright.dev/docs/chrome-extensions>.

## 사전 데이터와 외부 연결

한·영·일·중 미니팩은 기능 검증을 위해 이 프로젝트에서 직접 작성했으며 앱과 같은
`GPL-3.0-only`가 적용된다.

한국어 확장팩의 기본층은 국립국어원 한국어기초사전의 2026-06-19 전체 XML 스냅샷에서
표제어, 문자 발음, 한국어 뜻풀이와 사전이 제공하는 다국어 번역 뜻을 내부 형식으로 변환한 것이다.
인용 용례와 음성·이미지·동영상은 포함하지 않는다. 텍스트 자료에는 CC BY-SA 2.0 대한민국이
적용된다. 변환에 사용한 검수 스냅샷은 `spellcheck-ko/korean-dict-nikl` 저장소의
`42c0d01889f34536e9cf94fe57f62bd2055b1bde` 리비전이다.

- Source and full dictionary download: <https://krdict.korean.go.kr/kor/mainAction>
- Reviewed XML snapshot: <https://github.com/spellcheck-ko/korean-dict-nikl/tree/42c0d01889f34536e9cf94fe57f62bd2055b1bde/krdict>
- Copyright policy: <https://krdict.korean.go.kr/kor/kboardPolicy/copyRightTermsInfo>
- CC BY-SA 2.0 KR: <https://creativecommons.org/licenses/by-sa/2.0/kr/legalcode>

한국어 확장팩의 검토 보완층에는 국립국어원 우리말샘에서 확인한 현대 전문어의 표제어,
문자 발음과 뜻풀이가 포함된다. 현재 보완층은 전체 약 1.8 GB XML 자료를 앱에 중복 포함하지 않고,
확장팩 품질 검사에서 누락이 확인된 항목만 원문 그대로 보존한다. 텍스트 자료에는
CC BY-SA 2.0 대한민국이 적용되며 용례와 매체 자료는 포함하지 않는다.

- Source and dictionary: <https://opendict.korean.go.kr/main>
- Copyright policy: <https://opendict.korean.go.kr/service/copyrightPolicy>
- CC BY-SA 2.0 KR: <https://creativecommons.org/licenses/by-sa/2.0/kr/legalcode>

한국어 확장팩은 한국어 Wiktionary의 2026-08-04 덤프를 Wiktextract/kaikki.org로 추출한 데이터를
필터링하고 내부 형식으로 변환한 것이다. 원문 항목은 CC BY-SA 4.0과 GFDL 1.1 이상으로
이중 라이선스되며, 변환팩에는 원본과 동일한 조건이 적용된다.

- Source: <https://kaikki.org/kowiktionary/rawdata.html>
- Wiktionary copyright and contributor attribution: <https://ko.wiktionary.org/wiki/위키낱말사전:저작권>
- CC BY-SA 4.0: <https://creativecommons.org/licenses/by-sa/4.0/legalcode>
- GFDL 1.1 or later: <https://www.gnu.org/licenses/fdl-1.3.html>

브라질 포르투갈어, 라틴 아메리카 스페인어, 독일어, 러시아어, 프랑스어, 이탈리아어,
폴란드어, 네덜란드어와 체코어 확장팩은 2026-08-05 영어판 Wiktionary 덤프를
Wiktextract/kaikki.org로 추출한 2026-08-20 구조화 자료에서 해당 언어의 표제어와 영어 뜻풀이를
선별한 것이다. 지역 제품 코드인 `pt-BR`과 `es-419`는 각각 일반 포르투갈어·스페인어 자료를
사용하므로, 자료에 지역 변종만 수록되었다는 의미는 아니다. 활용형·대체 표기만 설명하는 행,
예문, 음성, 이미지와 별도 라이선스 매체는 포함하지 않는다. 원문 항목은 CC BY-SA 4.0과
GFDL 1.1 이상으로 이중 라이선스되며 변환팩에는 동일한 조건이 적용된다.

- Source and per-language downloads: <https://kaikki.org/dictionary/>
- Raw extraction metadata: <https://kaikki.org/dictionary/rawdata.html>
- English Wiktionary contributor attribution: <https://en.wiktionary.org/wiki/Wiktionary:Copyrights>
- CC BY-SA 4.0: <https://creativecommons.org/licenses/by-sa/4.0/legalcode>
- GFDL 1.1 or later: <https://www.gnu.org/licenses/fdl-1.3.html>

영어 확장팩은 Open English WordNet 2025의 표제어, 발음과 synset 정의를 내부 형식으로
재배열한 것이다. 원본과 변환팩에는 CC BY 4.0이 적용된다.

- Project and download: <https://en-word.net/downloads>
- CC BY 4.0: <https://creativecommons.org/licenses/by/4.0/legalcode>

간체·번체 중국어 확장팩은 CC-CEDICT의 2026-08-20 배포본에 함께 기록된 두 표기, 병음과
영어 뜻을 각각의 검색팩으로 재배열한 것이다. 원본과 변환팩에는 CC BY-SA 4.0이 적용된다.

- Project and download: <https://www.mdbg.net/chinese/dictionary?page=cc-cedict>
- CC BY-SA 4.0: <https://creativecommons.org/licenses/by-sa/4.0/legalcode>

일본어 확장팩은 Electronic Dictionary Research and Development Group(EDRDG)의 전체 JMdict를
`jmdict-simplified` full English release `3.6.2+20260817122448`에서 변환한 것이다. JMdict와
이 파생 데이터는 CC BY-SA 4.0으로 제공된다. Copyright is held by James William BREEN and the
Electronic Dictionary Research and Development Group.

- JMdict project: <https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project>
- EDRDG licence statement: <https://www.edrdg.org/edrdg/licence.html>
- Conversion source: <https://github.com/scriptin/jmdict-simplified/releases/tag/3.6.2%2B20260817122448>

모든 확장팩은 단어, 뜻, 품사와 읽기를 선별·정규화하고 NudeNyang 사전팩 JSON 구조로 재배열한
변경본이다. 예문, 음성, 이미지와 별도 라이선스가 표시된 미디어는 포함하지 않는다. 원본 출처는
각 조회 결과와 설정의 라이선스 화면에도 표시한다. JMdict 배포 조건에 따라 일본어 데이터는
정기적으로, 최소 월 1회 최신 릴리스를 검토하고 갱신한다.

외부 사전 버튼은 라이브러리나 데이터를 번들하지 않고 사용자가 선택한 단어의 Wiktionary 검색
페이지를 기본 브라우저로 연다. 사용자는 Wiktionary의 이용 약관과 개인정보처리방침을 따른다.
