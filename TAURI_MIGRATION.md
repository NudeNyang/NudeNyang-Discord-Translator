# Rust/Tauri 완전 전환 기록

## 결정과 완료 상태

NudeNyang Translator의 기본 앱과 엔진을 Tauri 2 + Rust로 통합한다. Python/PySide6/PaddleOCR
구현은 새 배포에서 제거하고 Git 이력으로만 보존한다. 전환 전 하이브리드 기준점은 커밋
`6d3839d`이며 작업 브랜치는 `feature/full-rust-engine`이다.

설정 UI는 Tauri WebView이므로 HTML/CSS/JavaScript를 사용한다. “Rust 완전 전환”의 범위는
앱 기능, 상태, 네이티브 통합, 번역/OCR 엔진, 실행·빌드·배포 경로이며 UI 마크업 자체를 Rust로
재작성한다는 뜻은 아니다.

## 최종 구조

```text
Tauri WebView
  ↕ command / event
Rust 앱·엔진
  ├─ 창·트레이·단축키·설정
  ├─ Discord 프로세스·CDP·DOM
  ├─ Hy-MT2/llama.cpp·구독 CLI·DeepL
  ├─ OCR·이미지 합성
  ├─ SQLite 캐시
  └─ 업데이트·플랫폼 자원
```

JSON Lines Python 사이드카와 `.venv`, PyInstaller, Paddle 런타임은 더 이상 존재하지 않는다.

## 단계별 기록

| 단계 | 결과 | 대표 커밋 |
|---|---|---|
| 하이브리드 기준점 | 복구 가능한 기준 커밋 고정 | `6d3839d` |
| 설정·상태 | Rust 설정 저장, 이전, 상태 계약 | `7cecdf5` |
| 업데이트·Discord | 업데이트와 디버그 포트 프로세스 제어 | `d95ad00` |
| 캐시 | Rust SQLite + 메모리 LRU | `929c779` |
| CDP·DOM | Rust WebSocket, 스냅샷, 적용, 복원 | `cbedd77`, `2d6edbb` |
| 번역 | 언어 감지, Hy-MT2, 품질 복구, 구독 CLI | `414bda8`~`6543eba` |
| OCR 기반 | 네이티브 MNN OCR, 고정 모델 검증 | `f814d45`, `e92f4e1` |
| 이미지 번역 | DOM 버튼, OCR, 번역, PNG 합성 | `9217a7b` |
| Python 제거 | 소스·테스트·패키징을 Rust 단일 경로로 정리 | 완료 |

## 완료 조건

- Tauri 앱 하나로 설정, 트레이, 단축키, 번역 켜기·끄기와 종료가 가능하다.
- 메시지·채널 DOM 번역, 언어 변경, 모델 변경, 원문 복원이 Rust에서 동작한다.
- Hy-MT2 예열 유지와 즉시 VRAM 반환을 Rust가 관리한다.
- 이미지 OCR과 번역 이미지 합성이 Python 없이 동작한다.
- 최초 동의와 15초 Discord 재시작 흐름이 Rust 상태로 관리된다.
- 실행·빌드·패키징 경로가 `python`, `.venv`, PyInstaller를 참조하지 않는다.
- 웹 테스트, Rust 테스트, Clippy, Windows 릴리스 빌드를 통과한다.
- 릴리스 실행 중 Python 프로세스가 생성되지 않는다.

## 롤백

작업은 기능 단위 커밋으로 나뉘어 있다. 문제가 발견되면 전체 저장소를 지우거나 강제로
초기화하지 않고, 필요한 커밋을 revert하거나 하이브리드 기준점 `6d3839d`에서 별도 브랜치를
만들어 비교한다.
