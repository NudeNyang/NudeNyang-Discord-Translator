# 랜딩 페이지

`landing/index.html`은 NudeNyang Discord Translator의 홍보용 정적 랜딩 페이지입니다.

## 로컬 확인

```powershell
npm run landing:serve
```

브라우저에서 `http://127.0.0.1:4173/landing/`을 엽니다.

## UI 언어

앱과 같은 28개 UI 언어를 지원하며, 생성된 번역은 `locales.generated.mjs`에 저장됩니다. 랜딩 문구를 추가하거나 바꾼 뒤에는 아래 명령으로 전체 언어 파일을 다시 만듭니다.

```powershell
npm run landing:locales
```

이 명령은 앱에 이미 있는 번역을 우선 재사용하고, 나머지 랜딩 전용 문구를 번역합니다. 제품명과 `Discord`, `Windows`, 번역 제공자 이름은 번역되지 않도록 보호됩니다. 배포 전에는 주요 유입 언어를 원어민에게 한 번 검수받는 것을 권장합니다.

## 미디어 교체 위치

HTML에서 `data-media-slot`을 검색하면 교체할 위치를 확인할 수 있습니다.

- `hero`: `assets/hero-discord-translation-masked.mp4`를 사용하며, 포스터는 `assets/hero-discord-translation-masked-poster.jpg`입니다.
- `workflow`: `assets/workflow-discord-translation-masked.mp4`를 사용하는 수신 번역부터 답장 전송까지의 영상, 1920 × 1080
- `image-translation`: 이미지 번역 전후 사진, 1200 × 900
- `settings`: 라이트 모드 설정 화면, 1600 × 1000

나머지 슬롯의 `div.media-stage`는 `video` 또는 `picture` 요소로 교체합니다. 기존 `media-stage` 클래스와 비율 클래스를 유지하면 레이아웃과 모서리 규칙이 그대로 적용됩니다.

히어로 영상은 모션 줄이기 설정이 꺼져 있을 때 무음으로 자동 재생되며, 탭이 보이지 않거나 모션 줄이기 설정이 켜지면 일시 정지됩니다.

## 배포 전 확인

- 다운로드 링크가 공개 배포 주소를 가리키는지 확인합니다.
- 영상에는 개인 계정, 서버명과 메시지 내용이 노출되지 않도록 처리합니다.
- 공유 미리보기 이미지는 `assets/social-thumbnail.png`이며 Open Graph와 Twitter 메타 태그에 연결되어 있습니다.

## 방문 통계

랜딩 페이지는 Cloudflare Web Analytics 비콘을 사용해 페이지 조회수, 유입 경로, 접속 국가와 기기 정보를 집계합니다. 개인 방문자를 식별하는 용도로 사용하지 않으며, 통계는 Cloudflare 대시보드의 **Analytics & Logs → Web Analytics**에서 확인합니다.
