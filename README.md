# Nude Translator

Windows 10/11의 Discord에서 한국어·일본어·영어·중국어 메시지를 메시지별로 판별하고,
선택한 언어로 바꿔 표시하는 실시간 번역기다.

기본 모드는 Discord API, 봇, 사용자 토큰, self-bot, DOM 변조를 사용하지 않는다. 실제
Discord 메시지는 수정되지 않고 화면 위의 클릭 통과형 창만 바뀐다. 화면 합성의 한계를 피하기
위한 실험적 DOM 모드도 공개 소스에 포함하지만, 비공식 방식이라는 위험 고지를 확인하고
사용자가 직접 선택해야 한다.

## 현재 아키텍처

```text
Discord HWND 추적
  → Windows UI Automation (일반 메시지·임베드·채널명과 물리 좌표)
  → UIA 메시지 행을 사용할 수 없을 때만 DXGI/OCR 폴백
       → 프레임 차이/해시 (변경 영역만)
       → PP-OCRv6-small 공통 텍스트 검출
       → PP-OCRv6-small-rec ┐
                              ├ 신뢰도 + 문자 종류 + 직전 문맥으로 결과 선택
         Korean PP-OCRv5-rec ┘
  → 메시지별 KO/JA/EN/ZH 판별
  → SQLite 캐시 조회
  → Hy-MT2 1.8B·7B/ChatGPT/Claude/Gemini/DeepL/Mock/원문 Translator
  → Win32 캡처 제외 + 클릭 통과 PySide6 오버레이
```

모듈 책임은 다음처럼 분리돼 있다.

- `capture/`: 전면 Discord 창·DPI·모니터 추적, 다중 출력 DXGI 합성, 변경 영역 검출
- `accessibility/`: Windows UI Automation으로 Discord의 화면에 보이는 메시지·임베드·채널명과
  물리 좌표를 읽는다. Discord API나 DOM에는 접근하지 않으며, Chromium 접근성 트리가 없는
  경우 기존 OCR 경로로 자동 전환한다.
- `ocr/`: 공통 검출, v6/한국어-v5 이중 인식, 메시지 본문 묶기
- `language.py`: 문자 종류와 직전 문맥을 이용한 메시지별 언어 판별. 한글·가나·라틴 문자가
  표시 언어와 일치하면 OCR의 언어 표결이 틀렸어도 번역기 호출 전에 차단한다.
- `channels.py`: 왼쪽 채널명과 상단 현재 채널명을 별도로 인식·번역한다. 짧은 채널명은
  Discord 용어에 맞춘 로컬 용어집으로 자연스럽게 표시하며, 읽지 않음 배지·음성 연결 상태·
  팔로우 버튼·헤더 동작 버튼은 가리지 않는다. 화면 공유처럼 채널 패널이 없는 화면도 제외한다.
- `translation/`: 교체 가능한 번역 인터페이스와 Hy-MT2/ChatGPT/Claude/Gemini/DeepL/Mock/원문 구현
- `cache.py`: 스크롤 재등장·중복 번역 방지용 SQLite 캐시
- `pipeline.py`: UIA 우선/OCR 보조 → 번역 → 캐시 → 화면 순서 병합
- `ui/`: 클릭 통과 오버레이, 트레이, 설정, 전역 단축키, 영역 선택. 복잡한 메시지는
  원문에 투명 구멍을 내지 않고 번역문과 캡처한 인라인 이모티콘을 다시 배치하는
  메시지 단위 합성 렌더러를 사용한다.

실험적 DOM 방식도 GitHub 소스와 Release에 포함한다. 기본값은 외부 오버레이 방식이며,
DOM 기능은 사용자 토큰이나 Discord API를 사용하지 않고 현재 렌더링 세션의 표시만 바꾼다.
공식 확장 방식이 아니어서 약관 위반 및 계정 제재 가능성이 있다는 고지와 세부 안전 경계는
`ARCHITECTURE.md`에 기록돼 있다.

## 설치

Python 3.11 또는 3.12와 [uv](https://docs.astral.sh/uv/)를 권장한다. PaddleOCR 3.7의
기본 OCR 설치는 아래 한 줄로 구성된다.

```powershell
# NVIDIA GPU (CUDA 12.9, RTX 50 계열 포함)
uv sync --extra ocr-gpu --extra dev

# CPU 폴백
uv sync --extra ocr-cpu --extra dev
```

첫 OCR 실행 때 공식 모델 저장소에서 다음 모델을 내려받는다.

- `PP-OCRv6_small_det`
- `PP-OCRv6_small_rec`
- `korean_PP-OCRv5_mobile_rec`

공식 문서상 PP-OCRv6는 영어·일본어를 지원하지만 한국어는 지원 목록에 없다. 따라서 이
프로젝트는 한국어 v5 인식 모델을 반드시 함께 실행한다. 모델 다운로드가 Hugging Face에서
막히는 환경을 고려해 공식 BOS 미러를 기본값으로 사용한다.

기본 로컬 번역기 Hy-MT2를 실행할 `llama.cpp`도 한 번 설치한다. 소스 실행 환경에서만
필요한 단계이며, 패키징된 배포 폴더에는 런타임이 포함된다.

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup_hymt_runtime.ps1
```

### 구독 플랜으로 ChatGPT·Claude·Gemini 사용

별도 API 키나 API 사용료 없이 각 서비스의 공식 CLI에 로그인된 구독 플랜을 번역 엔진으로
선택할 수 있다. 앱 설정의 `번역 모델`에서 원하는 서비스를 고른다.

- **ChatGPT Plus/Pro**: Codex CLI를 설치하고 `codex login`으로 ChatGPT 계정에 로그인한다.
  `codex login status`에서 ChatGPT 로그인을 확인할 수 있다.
- **Claude Pro/Max**: Claude Code를 설치하고 `claude auth login`으로 구독 계정에 로그인한다.
  `claude auth status`로 상태를 확인한다.
- **Google AI Pro/Ultra**: Antigravity CLI를 설치하고 `agy`를 한 번 실행해 Google 계정 로그인을
  마친다.

이 엔진들을 실행할 때 앱은 `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` 등 API
결제에 쓰일 수 있는 환경 변수를 제거한다. ChatGPT와 Claude는 구독 계정 로그인 상태도
확인하며, API 키 로그인으로 판단되면 실행하지 않는다. 화면 이미지는 전송하지 않고 UI
Automation 또는 OCR로 추출된 번역 대상 텍스트만 선택한 서비스로 보낸다.

구독 CLI는 요청마다 모델 실행을 시작하므로 Hy-MT2 로컬 번역보다 첫 응답이 느리다. 대신 한
화면의 여러 문장을 한 요청으로 묶고 결과를 SQLite에 저장해, 같은 문장은 다시 호출하지 않는다.
서비스의 플랜 사용량 제한과 공정 사용 정책은 그대로 적용된다.

## 정적 이미지 POC

먼저 Discord 화면을 로컬 파일로 캡처한다.

```powershell
uv run python scripts/capture_discord.py
```

Mock 번역으로 OCR 좌표와 덮어쓰기를 확인한다.

```powershell
uv run discord-translate-poc artifacts/discord-chat.png --translator mock --target ko
```

결과는 `artifacts/poc-overlay.png`, OCR 후보·신뢰도·언어·좌표는
`artifacts/poc-result.json`에 기록된다.

## 실시간 실행

API 키 없이도 기본값인 **Hy-MT2 1.8B 로컬 번역**으로 실행된다.

```powershell
uv run discord-translate-overlay
```

실험적 DOM 모드는 별도 명령으로 실행한다. 최초 실행 때 Discord를 디버그 포트와 함께 다시
열 수 있으며 현재 렌더링 세션의 표시만 바꾼다.

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start_dom_translate.ps1
```

DOM 모드에서는 Discord 메시지와 채널명뿐 아니라 첨부 이미지 및 링크 미리보기의 글자도
선택적으로 번역할 수 있다. 번역이 켜진 상태에서 이미지 위에 마우스를 올린 뒤
`이미지 번역`을 누르면, 화면에 보이는 이미지 한 장만 로컬로 캡처하여 OCR하고 번역된
이미지로 해당 `<img>` 표시를 교체한다. 별도의 Windows 오버레이는 사용하지 않으며
`원문 보기`와 `번역 보기`로 즉시 전환할 수 있다. GIF·동영상·스티커·프로필 사진은 대상에서
제외한다.

이미지의 픽셀은 외부 번역 서비스로 전송하지 않고, OCR로 추출한 문장만 현재 선택된 번역기에
전달한다. 결과 이미지는 대상 언어와 번역 모델별로 로컬 캐시에 저장하므로 같은 이미지를 다시
열 때 OCR과 번역을 반복하지 않는다. PaddleOCR 모델은 첫 이미지 번역 요청 때만 지연
초기화되며, 최초 실행에는 모델 다운로드와 준비 시간이 추가될 수 있다.

DeepL을 쓰려면 프로젝트 루트의 `.env` 또는 패키징된 EXE 옆의 `.env`에 키를 넣는다.
`.env`는 Git에서 제외되며 소스에 포함되지 않는다.

```dotenv
DEEPL_API_KEY=발급받은-키
```

PowerShell 환경 변수 방식도 계속 지원한다. 환경 변수 값이 `.env`보다 우선한다.

```powershell
$env:DEEPL_API_KEY = "발급받은-키"
uv run discord-translate-overlay
```

DeepL 모드에서 외부로 전송되는 정보는 UI Automation 또는 OCR로 추출된 번역 대상 문자열뿐이다. 화면 이미지,
사용자 토큰, Discord 내부 데이터는 보내지 않는다. 실제 `Discord.exe`가 전면에 있을 때만
화면을 캡처하며, 다른 창이 Discord 위를 덮고 있거나 번역이 꺼져 있으면 자동 영역 탐색도
실행하지 않는다. 언어를 판별할 수 없는 기호와 한 글자 라틴 OCR 잡음은 번역 API에 보내지
않는다.

URL이 포함된 줄은 URL 픽셀을 그대로 유지한다. `参加先 https://...`처럼 URL 앞에 설명이
있으면 설명 부분만 따로 번역하며, 사용자명·멘션·채널 링크는 번역문 안에서 보존한다.
`@everyone`, `@here`, 일반 멘션, 유니코드 이모지와 `^_^`, `T_T`, `(・ω・)`,
`m(__)m` 같은 문자 이모티콘도 번역 전에 보호하고 결과와 채널명에 원문 그대로 복원한다.
보호 대상만 있거나 이모티콘 옆에 OCR 잡음 몇 글자만 붙은 줄은 번역기에 보내지 않는다.
이모티콘이 포함된 문장은 비슷한 문장 캐시를 쓰지 않고 원문이 정확히 같은 캐시만 사용해
표정 문자가 다른 메시지와 섞이지 않게 한다.
UI Automation이 알려 주는 멘션·링크·커스텀 이모지 좌표는 덮어쓰기 영역에서 투명하게
빼 원본 Discord 픽셀을 유지한다. OCR 폴백에서도 조각 사이의 큰 간격을 같은 방식으로
처리하고 나머지 문장만 번역한다.
번역 배경도 채팅 행 끝까지 칠하지 않고 원문 또는 번역문에 필요한 폭까지만 그려서 뒤쪽
이모지와 반응 버튼을 가리지 않는다.

메시지 본문은 하이브리드 렌더링을 사용한다. 번역문이 원문 상자에 12/10.5pt로 들어가면
정확히 같은 상자만 교체하고, 들어가지 않으면 해당 메시지의 안전한 본문 폭을 쓰는 하나의
번역 카드로 바꾼다. UI Automation에서 다음 링크·이미지·임베드·반응 영역의 시작 위치를
계산하므로 카드는 그 경계를 넘지 않는다. 넓은 카드에서 한 줄로 들어가면 원래 행 높이를
유지하고, 그래도 공간이 부족한 경우에만 1pt 축소와 말줄임표를 사용한다.

배경색은 채팅 전체의 한 가지 테마색을 재사용하지 않는다. 각 메시지·호버 행·임베드와
채널명 주변의 평평한 픽셀을 별도로 샘플링해 해당 번역 표면에 적용한다. 이모지·멘션·링크가
있는 카드는 원본 픽셀을 윗줄에 보존하고 번역 본문을 그 아래에서 시작해 글자가 이모지
구멍에 잘리는 현상을 막는다.

번역 결과 캐시는 메모리와 SQLite의 2단계 구조다. 최근 4,096건은 메모리 LRU에서 먼저
찾아 화면 갱신 경로에서 파일 입출력을 피하고, 메모리에 없는 결과만
`%LOCALAPPDATA%\LocalTools\DiscordTranslateOverlay\Cache\cache.db`에서 찾는다. 새 번역은
메모리에서 즉시 사용할 수 있게 한 뒤 전용 백그라운드 작업이 SQLite에 영구 저장하며,
정상 종료할 때 저장 대기분을 모두 기록한다. 전체 DB를 메모리에 미리 올리지 않으므로 오래
사용해도 메모리가 계속 늘어나지 않는다. 같은 문장이 화면의 다른 위치에 다시 나타나거나
프로그램을 재시작해도 저장된 번역을 사용하므로 로컬 모델을 다시 실행하거나 DeepL 글자 수를
다시 소비하지 않는다. 공백·대소문자·문자
정규화 차이는 같은 문장으로 취급하며, 8자 이상 문장은 OCR 한 글자 오차까지 보수적으로
재사용한다. 단, 멘션·이모지·문자 이모티콘이 포함된 문장은 정확히 일치할 때만 재사용한다.
원문이 실제로 편집된 경우에는 새 문장으로 번역하고 캐시를 갱신한다.
채널명도 같은 캐시 원칙을 사용하며, 채널 목록과 상단 현재 채널 영역은 약 2초 간격으로
변경 여부만 확인한다. 채널의 `#`, 스피커, 장식 이모지 같은 앞쪽 아이콘은 번역 영역에서
분리해 Discord 원본 픽셀로 유지한다. 채널 번역은 한 줄 안에서만 글자를 최대 2pt 줄이고,
그래도 넘치면 말줄임표로 끝내 다음 채널 행을 침범하지 않는다.

일반 메시지와 임베드는 UI Automation의 TextPattern에서 Discord가 실제로 사용하는 글꼴
이름과 크기를 함께 읽는다. 현재 Discord에서 일반 본문은 12pt, 임베드 본문은 10.5pt로
확인됐으며, 고정 15pt를 사용하지 않고 각 원문 값을 기준으로 렌더링한다. `gg sans`는
Windows에 설치된 글꼴이 아니라서 Qt가 엉뚱한 글꼴로 대체하지 않도록 이 PC에서는 가장
가까운 시스템 글꼴인 Segoe UI를 쓰되, 측정된 12/10.5pt 크기는 그대로 적용한다. 번역이 길어도
먼저 2pt까지만 줄이고 그 뒤에는 세로 공간을 사용한다. 스크롤 경계에서 원문의 70% 미만만
보이는 메시지는 전체 문장이 좁은 조각에 눌려 그려지지 않도록 잠시 표시를 보류한다.

첫 캡처에서 GPU/DXGI 세션이 중단되면 로컬 화면 캡처로 자동 전환하고 30초 뒤 DXGI 복구를
재시도한다. 첫 UIA/OCR이나 번역이 일시적으로 실패해도 변경 감지를 초기화하고 전체 화면을
다시 처리하므로 사용자가 채팅을 스크롤할 필요가 없다.

### 설정창과 기본 단축키

- `F12`: 번역 켜기/끄기
- `Ctrl+Alt+O`: 원문/번역 전환
- `Ctrl+Alt+H`: 오버레이 일시 숨김
- `Ctrl+Alt+C`: 마우스에 가장 가까운 번역문 복사

트레이 아이콘을 누르면 `Nude Translator 설정` 창이 열린다. 번역 모델, 표시 언어, 말투,
라이트·다크 테마, 오버레이 모양과 단축키를 여기에서 바꿀 수 있다. 번역 켜기·끄기를 포함한
모든 단축키는 고정값이 아니며 설정창에서 변경할 수 있다. 트레이 아이콘과 메뉴도 설정창의
청록색 테마 및 번역 상태를 함께 반영한다.

GitHub Release가 게시되면 시작 뒤 백그라운드에서 최신 버전을 확인한다. 패키징된 실행
파일은 정확한 `NudeTranslator-Windows-x64.zip` 자산만 받고 GitHub가 제공하는 SHA-256
digest를 검증한 뒤 업데이트를 준비한다. 사용자가 트레이의 `재시작하여 업데이트`를 눌러야
현재 설치 폴더를 교체하고 다시 시작한다. 소스 실행 환경에서는 새 릴리스 알림만 표시한다.

## Hy-MT2 로컬 번역

기본 엔진은 번역 특화 `Hy-MT2 1.8B Q4_K_M`이다. 모델 파일은 약 1.13GB이고 CPU만으로도
실행할 수 있다. 설정에서 품질 우선 `Hy-MT2 7B Q4_K_M`을 고르면 약 4.62GB 모델을 받는다.
두 모델 모두 Apache 2.0이고 한국어·일본어·영어·중국어 간체·중국어 번체를 지원한다.
설정의 `번역 말투`에서 원문 격식 자동 유지, 항상 존댓말·격식체, 항상 반말·비격식체를
고를 수 있다. 자동 모드는 한·일·영·중의 명시적인 말투 단서를 판별하며, 말투별 번역 캐시를
분리해 이전 말투의 결과를 잘못 재사용하지 않는다.
화면 이미지와 OCR 텍스트는 PC 밖으로 전송되지 않는다.

첫 번역 때 Tencent 공식 Hugging Face 저장소에서 모델을 이어받기 가능한 방식으로 내려받고,
공식 Git LFS SHA-256과 파일 크기를 모두 검증한 뒤 사용자 캐시에 저장한다. 모델별 캐시와
번역 결과 캐시가 분리되므로 1.8B의 기존 결과를 7B 결과로 잘못 재사용하지 않는다. 자세한
선정 근거와 현재 실측 결과는 [HYMT.md](HYMT.md)에 기록했다.

## 테스트와 패키징

```powershell
uv run pytest
uv run ruff check .
powershell -ExecutionPolicy Bypass -File scripts/package.ps1 -Clean
```

PyInstaller 출력은 `dist/NudeTranslator/`에 생성된다. Paddle와 Hy-MT2 모델은 첫
실행 때 사용자 캐시에 다운로드되므로 실행 파일에 모델 가중치를 중복 포함하지 않는다.
배포 폴더에는 Hy-MT2 실행에 필요한 `llama.cpp` Windows 런타임을 함께 넣는다.
GitHub Release에 올릴 파일은 `release/NudeTranslator-Windows-x64.zip`으로 생성된다.

```powershell
.\dist\NudeTranslator\NudeTranslator.exe
```

창 없는 배포 실행에서도 시작 오류를 확인할 수 있도록 기본 로그를
`%LOCALAPPDATA%\NudeTranslator\overlay.log`에 남긴다. 별도 경로가 필요하면
`--log-file <경로>`를 사용하면 된다.

현재 패키징 스크립트는 Paddle/PaddleX와 CUDA DLL을 안전하게 모두 수집하는 검증용 구성이라
GPU 빌드의 배포 폴더가 약 3.7 GB다. 모델 가중치는 별도지만 미사용 Paddle 기능까지 포함된
크기다. 설치 프로그램을 배포하기 전에는 전용 PyInstaller hook으로 OCR 런타임만 선별해야 한다.

## 이 PC에서 확인한 결과

- Windows 11 + RTX 5090에서 Paddle GPU 자체 검사를 통과했다.
- 혼합 fixture를 KO/JA/EN/ZH와 KO·JA·ZH 문맥 한자까지 메시지별로 판별했다.
- warm GPU 기준 실제 Discord 자동 채팅 영역 전체 OCR은 약 1.53초, 300px 변경 영역은
  약 0.15초였다. 번역 API 왕복 시간은 별도다.
- 실제 Discord 접근성 트리 1,400여 개 요소를 일괄 캐시 요청으로 읽는 데 약 0.31~0.44초가
  걸렸고, 첫 프레임에서 스크롤 없이 일반 메시지 3개·번역 조각 8개·채널명 30개·현재 채널명
  1개를 읽었다. 이 경로에서는 OCR 호출이 0회인 것도 통합 검사했다.
- UI Automation TextPattern에서 일반 메시지 12pt와 임베드 10.5pt를 읽어 오버레이에 전달했고,
  실제 Discord 재실행에서 메시지 8개와 채널명 28개가 각 좌표에 표시되는 것을 확인했다.
- Hy-MT2 공식 최소 프롬프트로 새 캐시 36건을 생성해 내부 지시문 혼입이 0건인 것을 확인했다.
- 실제 Discord UIA 행 25개를 mock 표시 언어로 바꿔 하이브리드 배치를 계산했으며, 카드가
  다음 링크·이미지·반응 안전 경계를 넘어간 경우는 0건이고 로컬 배경색은 25개 모두 감지했다.
- 짧은 교체·긴 카드·임베드·이모지 보존을 묶은 시각 fixture에서 CJK 글꼴, 카드 배경,
  한 줄/여러 줄 줄바꿈과 이모지 아래 본문 시작을 확인했다.
- 실제 Discord에서 좌표 추적, 스크롤 클릭 통과, 숨김 단축키, 최소화 연동을 확인했다.
- PyInstaller EXE로 OCR 모델 초기화와 실제 Discord 위 오버레이 표시를 확인했다.
- Hy-MT2 1.8B Q4 실제 모델로 JA/EN/ZH→KO 번역을 실행했다. 최초 기동 포함 일본어 1.47초,
  warm 상태 영어 0.10초, 중국어 0.08초를 기록했다. 일본어 `肉まん`을 잘못 옮긴 사례가 있어
  실제 Discord 표본으로 7B·DeepL과 품질 비교가 더 필요하다.

## 알려진 화면 기반 제약

- 일반 Discord 메시지·임베드·채널은 Windows UI Automation이 본문과 좌표를 분리해 주므로
  이를 우선 사용한다. Discord 업데이트나 특수 캔버스 때문에 접근성 행이 노출되지 않는
  화면만 시간 문자열과 줄 간격을 판별하는 OCR로 처리한다. 폴백 오인식이 있으면
  `OCR 영역 직접 선택`으로 채팅 본문을 좁힐 수 있다.
- 번역문이 길면 줄바꿈 → 글자 축소 → 세로 확장 순으로 배치한다. 아래 메시지와 충돌하는
  경우 그 직전까지만 확장하므로 아주 긴 번역은 일부 잘릴 수 있다.
- Discord가 최소화·종료됐거나 다른 창이 전면에 있으면 오버레이를 숨긴다.
- Discord를 다른 모니터로 옮기거나 크기·DPI를 바꾸면 물리 좌표를 즉시 다시 계산한다.
  창이 모니터 경계에 걸친 경우 각 DXGI 출력을 한 프레임으로 합치며, 이전 크기로 처리 중이던
  OCR 결과는 버리고 새 크기에서 전체 인식한다.
- Windows 10 2004 이상에서는 `WDA_EXCLUDEFROMCAPTURE`로 오버레이를 DXGI 캡처에서 제외해
  번역문이 다시 OCR되는 피드백을 막는다.
- 그래픽 드라이버 전환 뒤 DXGI가 빈 프레임을 계속 반환하면 로컬 화면 캡처로 자동 전환하고,
  백그라운드에서 30초 간격으로 DXGI 복구를 다시 시도한다.

## 기술 근거

- [PaddleOCR 3.7 공식 문서](https://www.paddleocr.ai/main/en/version3.x/pipeline_usage/OCR.html)
- [PP-OCRv6 모델 소개](https://www.paddleocr.ai/latest/en/version3.x/algorithm/PP-OCRv6/PP-OCRv6.html)
- [Windows Graphics Capture](https://learn.microsoft.com/windows/apps/develop/media-authoring-processing/screen-capture)
