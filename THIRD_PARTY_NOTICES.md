# Third-party notices

NudeNyang Translator 자체 소스와 구성요소는 `GPL-3.0-only`로 배포한다. 이 라이선스는 아래
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
| llama.cpp | GGUF 추론 서버 | MIT, <https://github.com/ggml-org/llama.cpp> |
| ocr-rs | Rust OCR 전·후처리와 MNN 바인딩 | Apache-2.0, <https://github.com/zibo-chen/rust-paddle-ocr> |
| MNN | 네이티브 OCR 추론 런타임 | Apache-2.0, <https://github.com/alibaba/MNN> |
| PaddleOCR 모델 | PP-OCRv6 감지·인식 및 한국어 PP-OCRv5 인식 | Apache-2.0, <https://github.com/PaddlePaddle/PaddleOCR> |

DeepL은 모델이나 SDK를 번들하지 않고 사용자가 제공한 API 키로 공식 HTTP API를 호출한다.
사용자는 DeepL의 별도 서비스 약관과 사용량 제한을 따른다.
