# Rust/Tauri 완전 전환 계획

## 결정

Nude Translator의 기본 데스크톱 앱과 번역 엔진을 **Tauri 2 + Rust**로 전환한다.
Python/PySide6 구현은 전환 기간의 비교·복구 자료로만 유지한다. 전환 완료 배포는
Python 인터프리터, `.venv`, PyInstaller 사이드카가 없어도 독립적으로 동작해야 한다.

OCR은 이미지 번역과 화면 기반 보조 인식에 필요한 **기본 엔진 기능**으로 유지한다.
최종 구조에서는 Rust가 OCR 모델 세션, 전·후처리와 자원 생명주기를 직접 관리한다.
Hy-MT2의 GGUF 모델과 `llama.cpp` 실행 파일은 Python 의존성이 아닌 네이티브 자원이므로,
Rust가 프로세스와 HTTP 세션을 직접 관리한다.

## 최종 구조

```text
Tauri WebView 설정 UI
  ↕ Tauri command / event
Rust 앱·엔진
  ├─ 단일 인스턴스, 창, 트레이, 단축키
  ├─ 설정·상태·SQLite 번역 캐시
  ├─ Discord 프로세스·CDP WebSocket·DOM 변경
  ├─ Hy-MT2/llama.cpp·구독 CLI·DeepL 번역기
  ├─ 이미지 캡처·OCR 모델·텍스트 합성
  └─ 업데이트·플랫폼 별 자원 관리
```

전환 중에만 기존 JSON Lines 사이드카를 호환 경계로 사용한다. 각 Rust 모듈의
동등 기능과 회귀 테스트가 확보되면 해당 Python 요청을 제거한다. 최종 배포에서는
사이드카 프로토콜과 Python 프로세스가 존재하지 않는다.

## 기능 소유권

| 영역 | 전환 전 | 전환 완료 |
|---|---|---|
| 설정창·트레이·단일 인스턴스 | Tauri/Rust | Tauri/Rust |
| 설정 저장·호환 변환 | Python | Rust |
| Discord 실행·재시작 | Python | Rust |
| CDP 연결·DOM 반영 | Python | Rust |
| Hy-MT2·llama.cpp 관리 | Python | Rust |
| 구독 CLI·DeepL 번역 | Python | Rust |
| 이미지 OCR | Python/PaddleOCR | Rust/네이티브 모델 런타임 |
| 번역 캐시 | Python/SQLite | Rust/SQLite |
| 업데이트·배포 | Python 구현 | Rust/Tauri |

## 단계와 커밋 경계

1. **기준점 고정**: 하이브리드 상태를 별도 브랜치와 커밋으로 보존한다.
2. **Rust 기반 이전**: 설정, 상태, 캐시, 업데이트, Discord 프로세스 제어를 이전한다.
3. **DOM 이전**: CDP WebSocket, DOM 감시, 언어 감지, 번역 표시/복원을 이전한다.
4. **번역기 이전**: Hy-MT2/llama.cpp, 구독 CLI, DeepL, 보호 텍스트와 재시도 정책을 이전한다.
5. **OCR 이전**: 이미지 다운로드·전처리·텍스트 감지/인식·합성을 Rust 런타임으로 이전한다.
6. **Python 제거**: Tauri 실행·빌드·테스트에서 Python, `.venv`, PyInstaller, Paddle 의존성을 제거한다.
7. **배포 검증**: Windows 릴리스 빌드와 실제 Discord, Hy-MT2, OCR 시나리오를 검증한다.

각 단계는 포팅한 Python 테스트에 대응하는 Rust 테스트, 웹 상태 테스트, Clippy와
해당 실행 경로 검증을 통과한 뒤 별도 커밋으로 마감한다.

## 전환 완료 조건

- Tauri 앱 하나만 실행해 설정, 트레이, 번역 켜기·끄기와 종료가 가능하다.
- 실시간 DOM 번역, Hy-MT2 예열/VRAM 반환, 이미지 OCR을 기존 설정과 함께 사용할 수 있다.
- Discord 디버그 렌더러가 없으면 최초 1회 동의 후 15초 안내와 안전한 자동 재시작이 동작한다.
- 엔진 종료·비정상 종료가 고아 프로세스나 중복 설정창을 만들지 않는다.
- Windows 설치·업데이트와 macOS용 네이티브 자원 경로가 Tauri 번들 규칙으로 정의된다.
- 배포 실행 경로에서 `python`, `.venv`, `discord_translate_overlay.sidecar`를 참조하지 않는다.
- 웹 상태 테스트, Rust 단위/통합 테스트, Clippy와 실제 Tauri 릴리스 빌드가 통과한다.

## 원칙

- 기능을 전환 중이라는 이유로 OCR을 숨기거나 제거하지 않는다.
- 이전 중 기존 JSON Lines 계약은 기능 단위로 제거하고, 새 내부 계약은 Rust 타입으로 표현한다.
- 네이티브 실행 파일과 모델은 Rust가 경로, 프로세스, 타임아웃, 종료를 소유한다.
- macOS 지원을 약속하기 전 Apple Silicon 실제 기기에서 Discord, Metal, OCR, 서명·공증을 검증한다.
- 전환 기간에도 기존 설정 파일과 번역 캐시를 읽을 수 있어야 한다.
