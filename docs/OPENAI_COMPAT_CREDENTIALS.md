# OpenAI 호환 API 인증 회귀 검증

## 수정 원인

PR #3의 최초 구현은 `openai_compat` 자격 증명 하나를 서버 주소와 무관하게 재사용했다.
서버 A를 연결한 뒤 서버 B로 주소를 바꾸고 키를 비우면 연결 확인부터 A의 키가 B로 전송됐다.
또한 API 키는 설정에 저장하지 않으므로, 키만 갱신할 때 설정 비교가 변화를 감지하지 못해
연결 확인에는 새 키를 쓰고 실제 번역기에는 이전 키가 남았다.

## 변경한 경계

- 보안 저장소의 단일 항목에 정규화한 서버 주소와 선택형 키를 함께 저장한다.
- 주소 전체의 프로토콜·호스트·포트·경로가 같은 경우에만 기존 키를 재사용한다.
- 키 없는 새 서버는 인증 헤더 없이 확인하고, 성공한 뒤 해당 서버의 키 없는 연결을 저장한다.
- 확인에 실패하면 이전 연결의 보안 저장소 항목을 유지한다.
- 서버 정보 없는 이전 개발 버전의 키는 재사용하지 않는다. 인증이 필요한 서버는 키를 다시 입력한다.
- 저장 성공 시 엔진에 공급자 갱신을 명시적으로 전달한다. 선택된 표시·보내기 경로를 다시 준비하고,
  해당 공급자를 사용하지 않는 경로에는 갱신을 요청하지 않는다.
- 일반 설정·캐시·로그에는 키나 키의 해시를 추가하지 않는다. 연결 해제·제거 시 삭제 대상도 기존 단일 항목이다.

## 회귀 테스트

`cargo test --manifest-path src-tauri/Cargo.toml --locked credential_`로 관련 테스트를 실행한다.
테스트는 개별 메모리 자격 증명 저장소와 루프백 HTTP 모사 서버를 사용하며 사용자 키를 읽거나 변경하지 않는다.

수정 전 실패를 확인한 테스트:

- `server_credential_is_not_forwarded_when_connecting_to_another_server`
- `server_credential_rejects_different_scheme_port_path_and_unbound_legacy_key`
- `openai_credential_refresh_rebuilds_selected_lanes_without_config_changes`

같은 정규화 주소에서의 재사용, 키 갱신 후 새 번역기의 인증 헤더, 실패 시 이전 연결 유지,
서버에 맞는 연결 상태 및 키 없는 연결도 검증한다. 엔진 테스트는 표시·보내기 각각의 재준비 결정과
관련 없는 경로 보존을 확인한다. 실제 상용 API·로그인 사이트나 공급자의 과금·보관 정책은 이 검증에 포함되지 않는다.

## 실행 결과 (2026-09-28)

- `cargo test --manifest-path src-tauri/Cargo.toml --locked`: 510 통과, 50 제외. 신규 회귀 테스트 6개 포함.
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`: 통과.
- `cargo build --manifest-path src-tauri/Cargo.toml --locked`: 통과. 기존 `LNK4098` 런타임 라이브러리 경고 유지.
- `npm test`: 화면 270, 랜딩 38, 확장 469, 사전 9 통과.
- `npm run test:locales`: 통과.
- 전체 `npm run test:e2e`: 199 통과 (3.6분). 브라우저 fixture·모사 번역기와 Rust 엔진 통합 검사이다.

확장 로케일 생성물의 CRLF를 검사 중에만 LF로 정규화했다. 내용 변경과 검사기 우회는 없으며
커밋에는 줄바꿈 변경을 포함하지 않는다. 공개 웹 표본 검사(`test:public`)와 실서비스 인증은 실행하지 않았다.
