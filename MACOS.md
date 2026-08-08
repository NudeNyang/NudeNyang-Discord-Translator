# macOS Apple Silicon 지원 준비 계획

macOS는 아직 지원 운영체제가 아니다. 현재 Windows 기능을 유지하면서 나중에 Apple Silicon용
앱을 만들 수 있도록 Rust 공통 코어와 플랫폼 경계를 준비한다. Intel Mac은 초기 대상이 아니다.

## 이미 준비된 공통 기반

- Tauri 2 앱 셸과 Rust 엔진 단일 구조
- 운영체제와 독립적인 CDP, DOM, 언어 판별, 번역 캐시와 번역기 계약
- `.app/Contents/Resources/runtime/llama/llama-server` 탐색 경로
- `.app/Contents/Resources/runtime/models/hy-mt2/...` 내장 모델 탐색 경로
- Windows `.exe` 여부를 분리한 llama-server 실행
- macOS 사용자 캐시 경로
- 시스템 글꼴 후보를 사용하는 이미지 합성
- Python/PySide/Paddle 사이드카 없는 네이티브 OCR 구조

## 남은 구현 순서

### 1. Apple Silicon CI

- macOS arm64에서 `cargo test`, Clippy, 웹 테스트를 실행한다.
- vendored `ocr-rs`와 MNN arm64 바이너리가 재현 가능하게 링크되는지 확인한다.
- Tauri 개발 앱이 서명 없이 로컬에서 실행되는지 확인한다.

### 2. Discord 실행과 CDP

- Stable/PTB/Canary의 `.app` 위치를 탐색한다.
- `--remote-debugging-port=9222`를 전달해 안전하게 재시작한다.
- PID 변경 확인, 15초 카운트다운, 한 번만 재시작 정책을 macOS 구현에 연결한다.
- Discord 설치 파일을 영구 수정하지 않는다.

### 3. 트레이와 전역 단축키

- 메뉴 막대 아이콘 클릭과 설정창 단일 인스턴스를 검증한다.
- Tauri 전역 단축키 플러그인의 macOS 권한·충돌 흐름을 연결한다.
- 권한을 거부해도 트레이와 설정 UI는 계속 사용할 수 있어야 한다.

### 4. Hy-MT2와 Metal

- Apple Silicon용 llama-server를 Metal 활성화로 빌드한다.
- 실행 파일과 동적 라이브러리를 Tauri Resources에 포함하고 서명한다.
- 1.8B/7B 내장·다운로드 모델의 크기와 SHA-256 검증을 확인한다.
- 자동/CPU 모드, 모델 예열 유지, 번역 끄기 시 메모리 반환을 실제 기기에서 측정한다.

### 5. 네이티브 OCR

- MNN arm64에서 감지 모델과 다국어/한국어 인식 모델을 실제 이미지로 검증한다.
- macOS TTC 글꼴과 한중일 글리프 렌더링을 검증한다.
- Retina 배율에서 CDP 스크린샷 좌표와 합성 결과를 확인한다.

### 6. 패키징·서명·업데이트

- 앱과 llama-server를 Developer ID로 서명하고 Apple 공증을 통과시킨다.
- Gatekeeper가 켜진 새 사용자 환경에서 첫 실행을 확인한다.
- Windows PowerShell 교체 방식 대신 서명된 `.app` 전체를 안전하게 교체하고 롤백하는 업데이트
  방식을 구현한다. 그전에는 새 버전 알림과 릴리스 페이지 이동만 제공한다.

## 공개 지원 체크리스트

- Discord Stable/Canary CDP 연결과 재시작 복구
- 한국어·일본어·영어·중국어 DOM 번역
- 이미지 OCR과 원문/번역 전환
- Apple Silicon Metal/CPU 실행과 메모리 반환
- 잠자기·로그아웃·Discord 업데이트 뒤 재연결
- 메뉴 막대·단축키 권한 거부 시 정상적인 기능 저하
- 앱과 포함 바이너리의 서명·공증·Gatekeeper 검증
- 업데이트 실패 시 롤백

이 항목을 실제 Apple Silicon 기기에서 반복 검증하기 전에는 README의 macOS 상태를 “지원”으로
바꾸지 않는다.
