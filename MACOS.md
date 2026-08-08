# macOS 지원 준비 계획

> 2026년 전환 결정: macOS의 앱 셸은 PySide6가 아니라 Tauri 2를 사용한다. 이미지 OCR과
> Hy-MT2는 Python 헤드리스 사이드카로 유지하며, Tauri의 Apple Silicon 번들에 포함한다.
> 공통 전환 경계는 [TAURI_MIGRATION.md](TAURI_MIGRATION.md)를 따른다.

## 현재 상태

macOS는 아직 지원 운영체제가 아니다. 이 문서는 “현재 사용할 수 있다”는 안내가 아니라,
Windows 기능을 유지하면서 나중에 Apple Silicon용 앱을 만들기 위한 기술 계약과 작업 순서를
고정한다. 첫 macOS 대상은 Apple Silicon이며 Intel Mac용 별도 바이너리는 계획하지 않는다.

현재 코드에 마련된 기반은 다음과 같다.

- `platforms/`에서 Windows, macOS와 미지원 운영체제를 명시적으로 구분한다.
- Hy-MT2 실행기는 플랫폼별 llama.cpp 파일 이름과 번들 위치를 사용한다.
- macOS `.app`에서는 `Contents/Resources/runtime/llama/llama-server`를 우선적인 패키지
  계약으로 사용할 수 있다.
- `dxcam`과 `pywin32`는 Windows에서만 설치되도록 의존성 마커를 둔다.
- Windows 전역 단축키 백엔드는 다른 운영체제에서도 모듈 import를 막지 않는다.
- Windows PowerShell 방식 자동 업데이트는 macOS에서 실행되지 않는다.
- 향후 macOS Release 자산 이름은 `NudeTranslator-macOS-arm64.zip`으로 예약한다.

## 유지할 공통 코어

macOS 때문에 번역기를 다시 작성하지 않는다. 아래 코드는 Windows와 macOS가 공유한다.

- Hy-MT2 1.8B·7B GGUF 모델과 번역 프롬프트
- llama.cpp의 로컬 HTTP API를 호출하는 번역 클라이언트
- Discord CDP 연결, DOM 탐색과 번역문 표시
- 언어 판별, 보호 문자열, 번역 캐시와 설정 형식
- Tauri 설정창, 트레이 메뉴와 테마
- ChatGPT·Claude·Gemini CLI 및 DeepL 번역 어댑터

새로운 macOS 작업은 공통 코어를 수정하기보다 플랫폼 서비스 구현을 채우는 방식으로 진행한다.
Windows 전용 OCR·UI Automation·DXGI 오버레이는 macOS 이식 대상에서 제외하고 DOM 모드만
지원한다.

## 구현 순서

### 1. macOS 개발 환경과 CI

- Apple Silicon macOS에서 Python 3.11/3.12 의존성 잠금을 검증한다.
- DOM 엔트리포인트가 Win32 모듈 없이 import되고 단위 테스트가 통과하는지 확인한다.
- GitHub Actions의 macOS arm64 테스트 작업을 추가한다.

완료 조건은 앱 패키징이 아니라 공통 코어 테스트를 macOS에서 지속적으로 실행할 수 있는 것이다.

### 2. Discord 디버그 포트 실행

- 설치된 `Discord.app`과 Discord PTB/Canary 후보를 탐색한다.
- 이미 실행 중인 Discord를 안전하게 처리하고 `--remote-debugging-port=9222` 인수를 적용한다.
- 사용자가 직접 지정한 Discord 경로와 포트를 설정으로 덮어쓸 수 있게 한다.
- 실행 후 `/json` 대상에서 Discord 렌더러를 확인하고 실패 이유를 사용자에게 안내한다.

Discord 앱 파일이나 DOM 소스를 영구 수정하지 않는다는 현재 원칙은 그대로 유지한다.

### 3. Tauri 창·트레이와 전역 단축키

- Tauri 전역 단축키 플러그인과 macOS 권한 흐름을 연결한다.
- 필요한 경우 접근성 권한 요청 이유와 시스템 설정 이동 방법을 표시한다.
- 메뉴 막대 아이콘 클릭, 설정창 단일 인스턴스, Dock 표시 정책을 macOS 방식으로 검증한다.

권한이 없을 때도 트레이 메뉴와 설정창으로 번역을 조작할 수 있어야 하며 앱 시작을 막으면 안 된다.

### 4. Hy-MT2와 Metal

- Apple Silicon용 `llama-server`를 Metal 활성화 상태로 빌드한다.
- 서버와 필요한 동적 라이브러리를 `.app/Contents/Resources/runtime/llama`에 포함한다.
- CPU 강제 모드와 Metal 자동 모드를 모두 검증한다.
- 1.8B·7B 모델 다운로드, SHA-256 검증, VRAM 예열 유지·반환 동작을 확인한다.

모델 파일은 Windows와 같은 공식 Hy-MT2 GGUF를 사용하므로 번역 모델을 별도로 만들지 않는다.

### 5. Tauri 패키징과 배포

- Python OCR 엔진을 arm64 사이드카로 만들고 Tauri `.app` Resources에 포함한다.
- 앱 아이콘, 번들 식별자, 버전과 최소 macOS 버전을 고정한다.
- 앱과 포함된 `llama-server`를 Developer ID로 서명하고 Apple 공증을 통과시킨다.
- Gatekeeper가 켜진 새 사용자 환경에서 설치와 첫 실행을 검증한다.

로컬 개발용 `.app`이 실행되는 것과 공개 배포 준비 완료는 별도의 단계로 취급한다.

### 6. macOS 자동 업데이트

현재 Windows 업데이트 설치기는 PowerShell로 실행 중인 폴더를 교체하므로 macOS에서 재사용하지
않는다. 서명·공증된 전체 앱 번들을 안전하게 교체하고 롤백할 수 있는 방식을 별도로 선택한 뒤
`auto_update_supported`를 활성화한다. 그전에는 새 버전 알림과 릴리스 페이지 이동만 허용한다.

## 공개 지원 전 체크리스트

- Discord Stable 및 Canary에서 디버그 포트 연결
- 한국어·일본어·영어·중국어 DOM 번역 회귀 테스트
- Apple Silicon Metal/CPU 실행과 VRAM 반환 확인
- 설정·캐시·로그가 macOS 표준 사용자 디렉터리에 저장되는지 확인
- 잠자기·로그아웃·Discord 업데이트 이후 재연결 확인
- 단축키 권한 거부 상태에서 정상적인 기능 저하 확인
- 앱과 포함 바이너리 서명, 공증, Gatekeeper 확인
- macOS 전용 업데이트와 복구 시나리오 확인

이 체크리스트를 모두 통과하고 실제 Mac에서 반복 검증하기 전에는 README의 macOS 상태를
“지원”으로 변경하지 않는다.
