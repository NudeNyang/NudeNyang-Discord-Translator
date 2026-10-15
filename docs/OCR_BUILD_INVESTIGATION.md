# 비 MSVC 환경의 OCR 충돌 제보 조사

2026-10-15, PR #5 로컬 확인본 기준.

제보는 MSVC 이외의 환경에서 OCR을 빌드하면 segmentation fault가 발생한다는 내용이다.
운영체제, 컴파일러, 빌드 명령과 오류 로그는 제공되지 않았다. 빌드 도중인지, 빌드한 프로그램이
모델을 읽거나 추론하는 시점인지도 구분되지 않는다. 제보자가 재현 환경과 원인을 확인하기로
남겨두며, 이번 작업에서는 OCR 코드를 수정하지 않는다.

## 코드에서 확인한 내용

- 앱은 `src-tauri/src/ocr.rs`에서 로컬 `vendor/ocr-rs`와 MNN을 사용한다. 공식 Windows
  설치 파일은 x64·ARM64 모두 MSVC 타깃으로 빌드한다.
- `vendor/ocr-rs/build_support.rs`는 Windows MSVC에만 해당 Windows 사전 빌드 MNN을
  선택한다. Windows GNU에는 같은 파일을 그대로 연결하지 않고 소스 빌드 경로를 사용한다.
- `build.rs`의 NMake와 MSVC 런타임 플래그도 Windows MSVC 조건 안에 있다. 소스만 보고
  비 MSVC 환경에 이 플래그가 무조건 적용된다고 판단할 근거는 없다.
- `cpp/src/mnn_wrapper.cpp`의 `init_schedule_config`는 호출자가 만든 backend 객체를
  참조한다. 함수 내부 임시 객체의 주소를 반환하는 형태는 아니다. 이 구현은 OCR 도입 커밋
  `f814d45`부터 존재하며, 이번 PR에서 새로 고친 부분이 아니다. 이 한 가지 확인으로 다른
  네이티브 메모리 오류까지 배제할 수는 없다.

## 실행한 검사와 한계

이 PC에 설치된 Rust 타깃은 `x86_64-pc-windows-msvc`와 `aarch64-pc-windows-msvc`다.
GNU 타깃이나 다른 운영체제에서의 OCR 실행은 검사하지 않았다.

다음 명령으로 x64 MSVC 환경에서 실제 OCR 모델을 로드하고 저장소의 이미지 파일을 처리했다.

```powershell
cargo test --manifest-path src-tauri/Cargo.toml ocr::tests::live_native_ocr_models_load_and_run_without_python -- --exact --ignored --nocapture
```

1개 검사가 통과했다. 고정된 모델의 로드와 이미지 처리 확인이며, 여러 글자 표본의 인식 정확도
검사나 비 MSVC 충돌 재현은 아니다. 디버그 테스트 링크에는 기존 `LNK4098` CRT 충돌 경고가
남아 있다. 이 경고와 제보된 충돌 사이의 인과관계는 확인되지 않았다.

추가 조사에는 실패한 운영체제·아키텍처, 컴파일러 버전, 빌드 명령·기능 플래그, MNN을 구한
경로와 버전, 처음 충돌한 함수가 포함된 스택 추적이 필요하다. 현재 증거로는 제보 원인이나
해결 여부를 확정할 수 없다.
