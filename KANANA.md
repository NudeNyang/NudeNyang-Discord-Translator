# Kanana-2 1.3B 적용 기록

이 문서는 Nude Translator 프로토타입에서 Kanana-2 1.3B를 사용하는 방식과
배포 경계를 고정한다. 정식 배포 결정문이 아니라 실제 사용 평가를 위한 현재 기준이다.

## 선택한 구성

- 모델: `kakaocorp/kanana-2-1.3b-instruct`
- 모델 리비전: `bf4786aa2a1908adce942d53976270132732f720`
- 실행 방식: Hugging Face Transformers와 카카오 공식 원본 가중치
- 런타임 격리: OCR/Paddle과 별도 Python worker 프로세스 및 별도 가상환경
- 기본 메모리 모드: bitsandbytes NF4 INT4
- 입력 문맥 상한: 512토큰
- 출력 상한: 96토큰
- 한 번에 처리하는 메시지: 최대 2개
- 장치 선택: 여유 VRAM이 있는 NVIDIA GPU 우선, 불가능하면 CPU

모델은 약 12.9억 개 파라미터이며 공식 BF16 가중치 다운로드 크기는 약 2.6GB다. INT4는
실행 메모리를 줄이지만 최초 다운로드 파일 자체를 줄이지는 않는다. Windows에서 Hugging
Face의 일반 캐시가 가중치를 두 번 복사하는 경우를 피하도록 앱 전용 리비전 폴더에 필요한
파일을 한 번만 저장한다. Discord 화면에 보이는
짧은 메시지만 번역하므로 모델이 지원하는 32K 문맥은 사용하지 않는다.

## GitHub와 모델 배포 원칙

1. GitHub에는 프로그램 소스, Kanana 어댑터, 설치 및 다운로드 스크립트만 올린다.
2. Kanana 원본·양자화 가중치, Hugging Face 캐시, 모델에서 내려받은 Python 코드를 저장소,
   GitHub Release, EXE 또는 설치 파일에 포함하지 않는다.
3. 사용자가 Kanana를 선택한 경우에만 카카오 공식 Hugging Face 저장소에서 사용자 PC의
   로컬 캐시로 직접 내려받는다.
4. 모델 코드는 공급망 변경을 막기 위해 위의 커밋으로 고정한다.
5. 설정 화면과 실행 알림에 `Powered by Kanana`를 명확하게 표시한다.
6. 정식 배포나 판매 전에는 당시 Kanana Open License를 다시 검토하고, 모델 내장 배포가
   필요하다면 카카오의 서면 확인 또는 별도 라이선스를 먼저 받는다.

공식 모델: <https://huggingface.co/kakaocorp/kanana-2-1.3b-instruct>

공식 라이선스: <https://huggingface.co/kakaocorp/kanana-2-1.3b-instruct/blob/main/LICENSE>

## 친구들 PC를 위한 기준

기본 앱과 DeepL 모드는 Kanana/PyTorch를 설치하지 않아도 작동해야 한다. Kanana는 완전히
선택형이다.

- NVIDIA PC: INT4 기준 GPU 여유 메모리 2GB 이상을 확인하고 CUDA를 사용한다.
- NVIDIA가 없거나 VRAM이 부족한 PC: CPU로 폴백한다.
- CPU INT4: 시스템 여유 RAM이 4GB 미만이면 실행하지 않고 이해하기 쉬운 오류를 보여준다.
- 원본 정밀도 비교 모드: GPU 4GB 또는 CPU 7GB 이상의 여유 메모리를 요구한다.
- AMD/Intel GPU 직접 가속은 현재 프로토타입 범위 밖이며 CPU 폴백으로 동작한다.
- 낮은 사양에서 지연이 길면 DeepL을 계속 선택할 수 있다.

기본 EXE에는 Kanana, PyTorch, 모델을 넣지 않는다. 프로토타입에서는
`scripts/setup_kanana_runtime.ps1`이 만드는 전용 환경으로 실행하고, 정식 배포 단계에서는
기본 앱과 별도 `Kanana Runtime` 추가 구성요소로
나누는 것을 원칙으로 한다. 그래야 DeepL만 쓰는 친구가 수 GB짜리 런타임을 받을 필요가 없다.

Paddle GPU(CUDA 12.9)와 PyTorch GPU(CUDA 12.8)를 같은 Windows 프로세스에 설치하면
`paddleocr`가 PyTorch를 먼저 불러오는 경로에서 cuBLAS DLL 충돌이 재현됐다. 반대 순서에서는
PyTorch cuDNN 로딩이 실패했다. 따라서 단순한 import 순서 조정이 아니라 프로세스·환경 격리를
필수 제약으로 둔다. 자동 테스트도 기본 OCR 환경에 `torch`, `transformers`, `bitsandbytes`가
들어오지 않는지 확인한다.

이 수치는 앱 전체의 확정 최소 사양이 아니라 모델 로딩 전의 보수적인 여유 메모리 검사값이다.
실제 최소 사양은 서로 다른 PC에서 속도·메모리·품질을 측정한 뒤 정한다.

## 현재 제약과 평가 항목

Kanana-2는 공식 설명상 한국어·영어에 중점을 둔 모델이라 일본어 번역은 별도로 품질을
검증해야 한다. 비공식 GGUF는 모델의 hybrid sliding-window attention과 레이어별 RoPE를
정확하게 구현했는지 확인되지 않았으므로 현재 기본 경로에서 사용하지 않는다.

다음 항목을 실제 Discord 혼합 채팅으로 기록한다.

- 영어→한국어, 일본어→한국어의 자연스러움과 누락 여부
- 한국어→영어·일본어 결과
- 최초 모델 로딩 시간과 이후 메시지별 지연
- GPU VRAM, 시스템 RAM, CPU 사용률
- INT4와 원본 정밀도의 번역 품질 차이
- OCR 결과가 흔들릴 때 잘못된 번역을 캐시하지 않는지

번역 캐시는 엔진별로 분리한다. DeepL 번역이 Kanana 결과로 잘못 재사용되거나 그 반대가
일어나지 않으며, 같은 Kanana 원문과 표시 언어는 재시작 후에도 로컬 캐시를 즉시 사용한다.

## 2026-08-04 프로토타입 실측

측정 PC는 Ryzen 9 9950X3D, RAM 64GB, RTX 5090이다. 아래 값은 친구들 PC의 보장 수치가
아니라 첫 기준점이다.

| 모드 | 첫 2문장(모델 로딩 포함) | 로딩 후 1문장 | 프로세스 RAM | CUDA 할당 |
|---|---:|---:|---:|---:|
| CUDA INT4 | 7.4초 | 0.25초 | 약 1.84GB | 약 0.94GB |
| CPU INT4 | 14.3초 | 2.25초 | 약 2.16GB | 없음 |

영어와 일본어 예문을 한국어로 번역했고 둘 다 의미가 맞는 결과를 확인했다. 출력 예시는
`This sandwich is cheaper than in Korea.` → `이 샌드위치는 한국에서보다 저렴합니다.`,
`3歳だから仕方ないね。言葉は難しいもんね。` → `3살이라서 어쩔 수 없겠네. 말은 어려운
거니까.`였다. 실제 Discord OCR과 함께 실행한 결과는 별도로 계속 갱신한다.

실제 Discord 화면에서는 첫 프레임에 메시지 4개를 검출하고 2개를 Kanana로 번역하는 데
8.86초가 걸렸다. 같은 화면으로 앱을 재시작했을 때는 `cache=2`, `translated=0`으로 확인됐고
전체 OCR 프레임 처리는 0.70초였다. 즉 이미 번역한 문장은 worker를 시작하거나 모델을 다시
로드하지 않고 SQLite 캐시에서 바로 표시됐다.
