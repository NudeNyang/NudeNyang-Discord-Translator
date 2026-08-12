# 20개 채팅 언어 지원

## 제품 언어 카탈로그

텍스트 채팅의 수신 번역, 보내는 메시지 번역, 표시 언어 선택은 다음 20개 BCP 47 계열 코드를
공통 카탈로그로 사용한다.

| 코드 | 표시 이름 | 코드 | 표시 이름 |
|---|---|---|---|
| `ko` | 한국어 | `en` | English |
| `ja` | 日本語 | `zh` | 简体中文 |
| `zh-Hant` | 繁體中文 | `pt-BR` | Português (Brasil) |
| `es-419` | Español (Latinoamérica) | `de` | Deutsch |
| `fr` | Français | `id` | Bahasa Indonesia |
| `hi` | हिन्दी | `vi` | Tiếng Việt |
| `pl` | Polski | `ru` | Русский |
| `uk` | Українська | `tr` | Türkçe |
| `ar` | العربية | `it` | Italiano |
| `nl` | Nederlands | `ms` | Bahasa Melayu |

`zh-Hans`, `pt`, `es`는 이전 설정이나 공급자 입력을 읽기 위한 별칭으로만 허용하고 저장할 때는
각각 `zh`, `pt-BR`, `es-419`로 정규화한다. 지원하지 않는 코드는 표시 언어에서 `ko`, 보내는
언어에서 `auto`로 안전하게 되돌린다.

## 감지 정책

- 한글, 가나, 데바나가리, 아랍 문자는 문자 체계가 충분히 나타날 때 즉시 판정한다.
- 간체·번체는 서로 다른 힌트 글자를 사용하고, 한자만 있는 짧은 문장은 최근 중국어/일본어
  문맥이 없으면 `und`로 보류한다.
- 나머지는 Lingua 1.8.0을 제품의 19개 기본 언어 모델로 제한해 사용한다. 기본 승인 기준은
  신뢰도 `0.35`, 1·2위 격차 `0.17`이다.
- 인도네시아어/말레이어와 러시아어/우크라이나어는 1·2위가 같은 혼동군일 때만 신뢰도 `0.50`,
  격차 `0.03`을 별도 적용한다.
- URL, Discord 멘션·채널 태그·커스텀 이모지, 코드 펜스 표식은 통계 입력에서 제거한다.
- `gg`, `lol`, `nice`, `no`, `si`, 숫자·URL만 있는 메시지는 억지로 판정하지 않는다. 기존 제품
  회귀를 막기 위해 `hello`, `please`, `welcome`처럼 명백한 영어 신호는 짧아도 영어로 유지한다.

오판보다 `und` 보류를 우선한다. 자동 감지가 보류되면 최근 채널 언어 또는 사용자가 선택한
언어를 사용하며, 감지 결과가 달라져도 다른 원문 언어의 캐시를 재사용하지 않는다.

## 번역 공급자 능력표

`src-tauri/src/language.rs`가 공급자별 원문/대상 코드를 한 곳에서 관리하고 모든 조합을 테스트한다.

| 공급자 | 20개 언어 코드 | 검증 수준 |
|---|---|---|
| Hy-MT2 1.8B/7B | 제품 코드와 언어 이름 | 1.8B 로컬 실번역 스모크 완료 |
| TranslateGemma 4B | 제품 코드, 중국어 `zh-CN`/`zh-TW` | 코드 계약 테스트 |
| ChatGPT·Claude·Gemini CLI | 제품 코드와 언어 이름 | 프롬프트·스키마 계약 테스트; 계정별 실호출은 별도 |
| DeepL | 원문 `ZH/PT/ES`, 대상 `ZH-HANS/ZH-HANT/PT-BR/ES-419` 등 | 20개 요청 매핑 테스트; API 키별 실호출은 별도 |

외부 공급자의 언어 목록이나 계정 권한이 바뀌면 요청이 실패할 수 있으므로 원문을 유지하고 오류를
표시한다. 존재하지 않는 언어로 조용히 대체하지 않는다.

## 품질 안전장치

- 원문 반복, 빈 결과, 비정상적인 장문 환각, 번역 거부 문구를 캐시하지 않는다.
- 한국어·일본어·중국어·힌디어·아랍어·러시아어·우크라이나어 대상에서 필요한 문자 체계가 전혀
  없으면 한 차례 교정 번역하고, 그래도 실패하면 오역 대신 원문을 유지한다.
- 중국어→한국어에서 남은 `繁體/繁体/簡體/简体/中文`은 의미가 고정된 언어명만 결정론적으로
  정리한다.
- 한국어 `-(으)ㄹ래(요)?`가 독일어·포르투갈어·러시아어·우크라이나어·네덜란드어에서
  1인칭 복수 제안으로 바뀌는 회귀를 별도 검사하고 2인칭 질문으로 보정한다.
- 마크다운, 줄바꿈, 코드 블록, 멘션, URL, 이모지는 모델 입력 전 보호하고 결과에 정확히 복원한다.
- 프롬프트/후처리 변경은 `meaning-preserving-v10` 캐시 이름 공간으로 격리한다.

## OCR 범위

20개 언어는 텍스트 채팅 기준이다. 현재 이미지 번역은 PP-OCRv6-small과 한국어 PP-OCRv5
인식기의 고정 문자셋 범위 안에서만 제공한다.

- 문자셋 표본 100%: `ko`, `en`, `ja`, `zh`, `zh-Hant`, `pt-BR`, `es-419`, `de`, `fr`,
  `id`, `pl`, `tr`, `it`, `nl`, `ms`
- 부분(광고하지 않음): `vi` 91%
- 현재 인식기 미지원: `hi`, `ru`, `uk`, `ar`

100%는 글자 사전에 있다는 뜻이며 실제 이미지 정확도 보장은 아니다. 공통 감지 모델은 글자 영역을
찾을 수 있어도 인식 문자셋에 없는 문자는 복원할 수 없다. 이 네 문자 체계는 해당 PaddleOCR
인식 모델을 추가하고 렌더링 이미지 평가를 통과하기 전까지 OCR 지원으로 표시하지 않는다.

## 재현 방법

```powershell
# 빠른 감지 회귀
powershell -ExecutionPolicy Bypass -File scripts/multilingual-benchmark.ps1 -Mode Detection

# 설치된 Hy-MT2 1.8B를 실제로 실행하는 양방향 번역·형식 검사
powershell -ExecutionPolicy Bypass -File scripts/multilingual-benchmark.ps1 -Mode Translation

# 고정 OCR 모델의 언어별 문자셋 범위 검사
powershell -ExecutionPolicy Bypass -File scripts/multilingual-benchmark.ps1 -Mode Ocr

# 세 검사를 순서대로 실행
powershell -ExecutionPolicy Bypass -File scripts/multilingual-benchmark.ps1 -Mode All
```

보고서는 Git에 넣지 않는 `artifacts/multilingual-benchmark/`에 생성된다. 2026-08-12 기준 결과는
감지 50/50, Hy-MT2 1.8B 양방향 38건과 Discord 형식 1건 통과였다. warm 번역은 이 Windows
GPU 환경에서 원문→한국어 약 0.13~0.28초, 한국어→대상 언어 약 0.11~0.63초였다. 이 검사는
문자 체계·보호 토큰·알려진 의미 회귀를 자동 판정하지만, 실제 서버 표본의 사람 평가는 계속
필요하다.
