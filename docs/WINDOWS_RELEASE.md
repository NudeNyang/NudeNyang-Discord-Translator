# Windows 프리릴리스와 자동 업데이트

## 유지할 조건

- 본체 버전은 `src-tauri/tauri.conf.json`을 따른다. `-beta` 버전은 GitHub 프리릴리스이며 정식 최신 릴리스로 승격하지 않는다.
- 프리릴리스 여부는 GitHub의 표시·분류이고, 앱은 기존 정적 업데이트 목록을 조회한다. ARM64 지원에 정식 전환은 필요하지 않다.
- 업데이트 주소는 `https://raw.githubusercontent.com/NudeNyang/NudeNyang-Discord-Translator/main/updates/beta/latest.json`을 유지한다.
- 기존 `plugins.updater.pubkey`와 저장소 밖의 `updater.key`를 유지한다. 패키징 중 새 키를 생성하지 않는다. 키 비밀번호는 프로세스 환경으로만 전달하고 종료 시 복구하며 로그·명령 인수·저장소에 기록하지 않는다.
- 공개 파일은 x64·ARM64 설치형 두 개와 각각의 `.sig`, `latest.json`, `SHA256SUMS.txt`다. 포터블판은 포함하지 않는다.
- Tauri 업데이트 서명은 Authenticode와 별개다. 현재 Microsoft 코드 서명이 있다고 표현하지 않는다.

## 생성·검증·공개의 순서

1. 소스·버전·개인정보 처리방침·릴리스 노트를 검증하고 커밋한다. 작업 트리가 깨끗한지 확인한다.
2. `scripts/package_github_release.ps1`을 실행한다. 내부에서 `package_windows_variants.ps1`로 두 아키텍처를 함께 빌드하고 각 설치 파일을 서명한다.
3. `node scripts/release-updates.mjs validate`로 두 서명과 SHA-256, 플랫폼별 URL, 버전, 빌드 소스 커밋을 다시 검증한다. 파일이나 항목이 하나라도 빠지면 중단한다.
4. 빌드한 소스 커밋을 원격 `main`에 푸시한다. 이 단계에서는 기존 업데이트 목록을 유지한다.
5. `scripts/deploy_github_release.ps1`을 실행한다. 새 초안에 검증한 여섯 파일을 올린 뒤 GitHub가 보고한 크기·SHA-256을 대조한다. 확인한 초안만 공개하며, `-beta`는 `--prerelease --latest=false`로 게시한다. 기존 같은 버전의 릴리스나 파일을 덮어쓰지 않는다.
6. 공개 확인 뒤 스크립트가 복사한 `updates/beta/latest.json`을 검토·커밋·푸시한다. 원격 JSON과 두 다운로드 주소가 실제로 열리는지 확인한다.

로컬 생성이나 초안 업로드만으로 기존 사용자의 업데이트가 활성화되지는 않는다. 중간 실패 시 이미 만들어진 초안을 임의로 삭제하거나 서명 검사를 생략하지 않는다. `-SkipBuild`는 이미 검증한 동일 소스 빌드의 재패키징용이며 다른 커밋의 설치 파일을 재사용해서는 안 된다.

업데이트 목록을 커밋한 뒤에는 HEAD가 빌드 커밋보다 앞서므로, 재검증 시 `node scripts/release-updates.mjs validate --commit <latest.json의 source_commit>`으로 실제 빌드 커밋을 지정한다. 패키징 기록 `release/<버전>/windows-build.json`은 두 설치 파일의 해시와 빌드 커밋을 묶으며 저장소나 공개 첨부 파일에는 포함하지 않는다.

## 누락 방지

`latest.json`은 `windows-x86_64`와 `windows-aarch64` 각각에 해당 설치형의 URL·서명·SHA-256을 가진다. 서명 검사는 Tauri의 base64 인코딩된 Minisign 형식과 기존 공개 키를 사용해 실제 설치 파일 및 신뢰 주석을 검증한다. 파일 이름만 맞거나 서명 파일이 존재하는 것만으로 통과하지 않는다. 공개 키와 업데이트 주소를 바꾸지 않는다.

ARM64 바이너리 형식·번들 구성·서명·업데이트 경로 검증은 실제 ARM64 장치에서의 설치·업데이트 실행 검증을 대체하지 않는다. 실제 장치 검증을 하지 않았다면 릴리스 노트에 그 한계를 명시한다.

## 기준 문서

- [Tauri 업데이트 플러그인](https://v2.tauri.app/plugin/updater/)
- [Minisign 서명 형식](https://jedisct1.github.io/minisign/#signature-format)
- [코드 서명 정책](../CODE_SIGNING_POLICY.md)
