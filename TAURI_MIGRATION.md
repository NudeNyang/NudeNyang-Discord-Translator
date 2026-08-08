# Tauri 전환 결정 및 구현 경계

## 결정

Nude Translator의 기본 데스크톱 앱을 PySide6에서 **Tauri 2 + Rust**로 전환한다.
새 기능은 Tauri 앱을 기준으로 추가하며 기존 PySide6 창은 전환 기간의 비교·복구 수단으로만
유지한다. 공개 배포를 다시 시작하기 전에는 PySide6 UI와 중복 기능을 정리한다.

OCR은 제거하지 않는다. 이미지 번역과 향후 화면 기반 보조 인식에 필요한 **기본 엔진 기능**으로
유지한다. 다만 무거운 PaddleOCR·Hy-MT2 실행 환경까지 처음부터 Rust로 재작성하면 제품 기능
개발이 멈추므로, 초기 전환에서는 Python 헤드리스 사이드카가 이를 담당한다.

## 현재 목표 구조

```text
Tauri WebView 설정 UI
  ↕ Tauri command / event
Rust 앱 셸
  ├─ 단일 인스턴스, 창, 트레이, 프로세스 생명주기
  ├─ 사용자 동의와 Discord 재연결 UX
  └─ JSON Lines 엔진 클라이언트
       ↕ stdin / stdout (protocol v1)
Python 헤드리스 엔진
  ├─ Discord CDP/DOM 번역
  ├─ Hy-MT2·구독 CLI·DeepL 번역기
  ├─ PaddleOCR 이미지 번역
  └─ 캐시와 기존 설정 호환
```

이 구조는 “Tauri로 UI만 감싸고 기존 앱을 두 개 실행”하는 방식이 아니다. Python은 창과 트레이를
만들지 않는 계산 엔진이며, 사용자가 조작하는 앱과 생명주기의 소유자는 Rust다.

## 책임 경계

| 영역 | 현재 소유자 | 장기 소유자 |
|---|---|---|
| 설정창·트레이·단일 인스턴스 | Tauri/Rust | Tauri/Rust |
| 설정 저장과 호환 변환 | Python 사이드카 | Rust |
| Discord 실행·재시작 | Python 플랫폼 서비스 | Rust |
| CDP 연결·DOM 반영 | Python 사이드카 | Rust 후보 |
| Hy-MT2·llama.cpp 관리 | Python 사이드카 | Rust 후보 |
| 이미지 OCR | Python 사이드카 | Python 사이드카 |
| 번역 캐시 | Python 사이드카 | Rust 후보 |
| 업데이트·서명·배포 | 전환 중 | Tauri updater + 플랫폼 서명 |

OCR은 Rust 이전의 성공 조건이 아니다. 안정적인 Python OCR 프로세스를 명시적인 프로토콜 뒤에
두면 Windows와 macOS 모두 같은 앱 셸에서 사용할 수 있고, OCR 라이브러리를 바꿀 때도 UI를
다시 만들 필요가 없다.

## 단계

1. **앱 셸 전환**: Tauri 설정창, 트레이, 단일 인스턴스와 Python 엔진 IPC를 기본 실행 경로로 만든다.
2. **배포 경계 고정**: Python 엔진을 창 없는 사이드카로 패키징하고 Rust가 시작·종료·복구한다.
3. **Rust 코어 확대**: 설정, Discord 프로세스 제어, CDP와 캐시를 위험도가 낮은 순서로 이전한다.
4. **플랫폼 배포**: Windows 서명·업데이트를 완성한 뒤 Apple Silicon 서명·공증 빌드를 추가한다.
5. **레거시 제거**: 동등 기능과 회귀 테스트가 확보되면 PySide6 설정창·트레이를 삭제한다.

## 전환 완료 조건

- Tauri 앱 하나만 실행해 설정, 트레이, 번역 켜기·끄기와 종료가 가능하다.
- 실시간 DOM 번역, Hy-MT2 예열/VRAM 반환, 이미지 OCR을 기존 설정과 함께 사용할 수 있다.
- Discord 디버그 렌더러가 없으면 최초 1회 동의 후 15초 안내와 안전한 자동 재시작이 동작한다.
- 엔진 종료·비정상 종료가 고아 프로세스나 여러 설정창을 만들지 않는다.
- Windows 설치·업데이트와 macOS용 사이드카 경로가 Tauri 번들 규칙으로 정의된다.
- 웹 상태 테스트, Rust 테스트·Clippy, Python 전체 테스트와 실제 Tauri 빌드가 통과한다.

## 원칙

- 기능을 전환 중이라는 이유로 OCR을 숨기거나 삭제하지 않는다.
- UI와 엔진 사이에는 버전이 있는 JSON Lines 계약만 사용한다.
- Rust에서 Python 내부 객체를 직접 다루지 않는다.
- macOS 지원을 약속하기 전 Apple Silicon 실제 기기에서 Discord, Metal, OCR, 서명·공증을 검증한다.
- 전환 기간에도 기존 설정 파일을 읽을 수 있어야 한다.
