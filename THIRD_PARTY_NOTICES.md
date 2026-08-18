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
| Tabler Icons | 설정 메뉴 아이콘 | MIT, Copyright (c) 2020-2026 Paweł Kuna, <https://github.com/tabler/tabler-icons> |
| Microsoft Visual C++ Redistributable | `llama-server.exe`의 앱 로컬 Windows 런타임 | Microsoft Software License Terms, <https://learn.microsoft.com/cpp/windows/latest-supported-vc-redist> |
| Microsoft Edge WebView2 Runtime | Tauri 설정 및 트레이 UI 렌더링 | Microsoft Edge WebView2 Runtime Terms, <https://developer.microsoft.com/microsoft-edge/webview2/> |

DeepL은 모델이나 SDK를 번들하지 않고 사용자가 제공한 API 키로 공식 HTTP API를 호출한다.
사용자는 DeepL의 별도 서비스 약관과 사용량 제한을 따른다.

TranslateGemma is provided under and subject to the Gemma Terms of Use found at
<https://ai.google.dev/gemma/terms>.

## 사전 데이터와 외부 연결

한·영·일·중 미니팩은 기능 검증을 위해 이 프로젝트에서 직접 작성했으며 앱과 같은
`GPL-3.0-only`가 적용된다.

한국어·영어·중국어 실용팩은 한국어 Wiktionary의 2026-08-04 덤프를 Wiktextract/kaikki.org로
추출한 2026년 8월 데이터를 필터링하고 내부 형식으로 변환한 것이다. 원문 항목은 CC BY-SA 4.0과
GFDL 1.1 이상으로 이중 라이선스되며, 변환팩에는 원본과 동일한 조건이 적용된다. 이 프로젝트는
예문, 음성, 이미지와 별도 라이선스가 표시된 미디어를 포함하지 않는다.

- Source: <https://kaikki.org/kowiktionary/rawdata.html>
- Wiktionary copyright and contributor attribution: <https://ko.wiktionary.org/wiki/위키낱말사전:저작권>
- CC BY-SA 4.0: <https://creativecommons.org/licenses/by-sa/4.0/legalcode>
- GFDL 1.1 or later: <https://www.gnu.org/licenses/fdl-1.3.html>

일본어 실용팩은 Electronic Dictionary Research and Development Group(EDRDG)의 JMdict를
`jmdict-simplified` common-word release `3.6.2+20260817122448`에서 필터링하고 내부 형식으로
변환한 것이다. JMdict와 이 파생 데이터는 CC BY-SA 4.0으로 제공된다. Copyright is held by
James William BREEN and the Electronic Dictionary Research and Development Group.

- JMdict project: <https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project>
- EDRDG licence statement: <https://www.edrdg.org/edrdg/licence.html>
- Conversion source: <https://github.com/scriptin/jmdict-simplified/releases/tag/3.6.2%2B20260817122448>

두 실용팩 계열 모두 단어, 뜻, 품사와 읽기를 선별·정규화하고 NudeNyang 사전팩 JSON 구조로
재배열한 변경본이다. 원본 출처는 각 조회 결과와 설정의 라이선스 화면에도 표시한다. JMdict
배포 조건에 따라 일본어 데이터는 정기적으로, 최소 월 1회 최신 릴리스를 검토하고 갱신한다.

외부 사전 버튼은 라이브러리나 데이터를 번들하지 않고 사용자가 선택한 단어의 Wiktionary 검색
페이지를 기본 브라우저로 연다. 사용자는 Wiktionary의 이용 약관과 개인정보처리방침을 따른다.
