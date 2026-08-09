# Nude Translator

제품 내 사용자 노출 문구의 작성 기준은 [제품 문체 원칙](PRODUCT_LANGUAGE.md)을 따릅니다.

Nude Translator는 Windows 10/11의 Discord 화면을 한국어·일본어·영어·중국어로 바꿔
표시하는 Tauri 2 + Rust 데스크톱 앱이다. Discord API, 사용자 토큰, self-bot을 사용하지
않고 원격 디버깅 포트로 현재 렌더러의 DOM만 변경한다.

## 현재 구조

```text
Tauri WebView 설정·트레이 UI
  ↕ Tauri command / event
Rust 앱·번역 엔진
  ├─ 설정·상태·전역 단축키·단일 인스턴스
  ├─ Discord 실행·15초 재시작 안내·CDP WebSocket
  ├─ DOM 메시지·채널명 번역과 원문 복원
  ├─ Hy-MT2/llama.cpp·구독 CLI·DeepL
  ├─ 네이티브 OCR·이미지 번역 합성
  ├─ 메모리 LRU·SQLite 캐시
  └─ 업데이트·플랫폼 자원 관리
```

Python 인터프리터, `.venv`, PyInstaller, PaddleOCR 사이드카는 실행·빌드·배포에 필요하지
않다. 설정 화면은 WebView 기술 특성상 HTML/CSS/JavaScript를 사용하지만 앱 기능과 엔진,
프로세스 제어, OCR은 Rust가 담당한다. 이전 Python 구현은 Git 이력의
`6d3839d` 기준 커밋에서 비교할 수 있다.

## 주요 기능

- Discord 메시지와 채널명을 언어별로 판별해 선택한 표시 언어로 번역
- 한국어·일본어·영어·중국어 간 번역 및 같은 언어 원문 유지
- 최근 대화 언어를 기준으로 보내는 메시지를 번역하고, 장문은 텍스트 파일 하나로 전송
- Hy-MT2 1.8B/7B 로컬 번역, ChatGPT·Gemini 구독 CLI, DeepL, Mock 엔진
- 번역을 꺼도 로컬 모델을 VRAM에 유지하거나 즉시 반환하는 예열 옵션
- Discord 첨부 이미지에 나타나는 `이미지 번역` 버튼과 원문/번역 전환
- Rust 네이티브 PP-OCR 계열 감지·다국어/한국어 이중 인식 및 이미지 재합성
- 설정 가능한 전역 단축키, 트레이 상태 동기화, 설정창 단일 인스턴스
- 최초 동의 뒤 CDP 연결 실패 시 15초 안내 후 Discord 안전 재시작
- GitHub Release 기반 업데이트 확인·다운로드·SHA-256 검증

## 지원 범위

| 운영체제 | 상태 |
|---|---|
| Windows 10/11 x64 | 현재 지원·배포 대상 |
| macOS Apple Silicon | Rust 공통 코어와 자원 경로 기반만 준비, 아직 미지원 |
| macOS Intel | 계획 없음 |

Discord DOM 방식은 Discord가 공식 지원하는 확장 방식이 아니다. 클라이언트 업데이트로 깨질
수 있고 정책상 위험이 생길 수 있으므로 실시간 번역은 사용자의 최초 동의 없이 자동으로
켜지지 않는다. Discord 설치 파일과 서버 데이터는 수정하지 않는다.

## 개발 실행

필수 도구는 Rust stable, Node.js/npm, Windows WebView2 빌드 환경이다.

```powershell
npm install
powershell -ExecutionPolicy Bypass -File scripts/setup_hymt_runtime.ps1
npm run tauri:dev
```

Hy-MT2 모델은 처음 선택할 때 공식 Hugging Face 저장소에서 이어받기 가능한 방식으로 내려받고
크기와 SHA-256을 검증한다. OCR 모델도 첫 이미지 번역 때 고정된 리비전에서 내려받아 같은
검증을 거친다. 캐시와 설정은 기존 사용자 경로를 호환해 사용한다.

설정의 `번역 서비스 연결`에서 ChatGPT·Gemini 공식 CLI를 설치하고 계정 로그인을 진행할 수
있다. CLI와 Node.js 20 이상이 없으면 Windows 앱 설치 관리자를 통해 자동으로 준비한다. DeepL
API 키는 연결 시 유효성을 확인하고 Windows 자격 증명 관리자에 저장하며 설정 JSON에는 기록하지
않는다. 앱은 API 결제용 환경 변수를 구독 CLI 자식 프로세스에서 제거하고, 이미지 픽셀은 외부
서비스로 보내지 않으며 OCR로 추출된 텍스트만 선택한 외부 번역기로 전달한다. ChatGPT,
Claude, Gemini 구독 연결은 각 공급자의 공식 로컬 CLI 인증을 사용한다.

## 검사와 빌드

```powershell
npm run test:web
cd src-tauri
cargo test --no-fail-fast
cargo clippy --bin nude-translator-tauri -- -D warnings
cargo build --release
```

Windows 배포 ZIP은 다음 명령으로 만든다. 기본 패키지는 Tauri/Rust 앱, llama.cpp와
Hy-MT2 1.8B 모델을 내장한다. `-IncludeLargeModel`을 추가하면 7B 모델도 포함한다.

```powershell
powershell -ExecutionPolicy Bypass -File scripts/package.ps1 -Clean
```

## 문서

- [아키텍처와 안전 경계](ARCHITECTURE.md)
- [Rust/Tauri 전환 기록](TAURI_MIGRATION.md)
- [macOS 준비 계획](MACOS.md)
- [Hy-MT2 런타임](HYMT.md)
- [제3자 고지](THIRD_PARTY_NOTICES.md)

## 라이선스

Copyright (C) 2026 NudeNyang

앱 자체 소스는 GNU General Public License version 3 전용(`GPL-3.0-only`)이다.
Hy-MT2, llama.cpp, OCR 모델과 런타임에는 각 구성요소의 라이선스가 별도로 적용된다.
자세한 내용은 [LICENSE](LICENSE), [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md),
[licenses](licenses)에서 확인할 수 있다.
