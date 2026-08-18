# 개인정보 처리방침 / Privacy Policy

최종 수정일: 2026-08-19

NudeNyang Discord Translator는 별도의 운영 서버를 두지 않으며, 개발자가 Discord 메시지, 이미지, 번역 기록 또는 인증 정보를 수집하거나 보관하지 않습니다.

## 로컬 처리

- Hy-MT2와 TranslateGemma 번역은 사용자 PC에서 처리됩니다.
- 이미지 픽셀은 PC 안에서 OCR과 합성에 사용되며 외부 번역 서비스로 전송되지 않습니다.
- 설정, 번역 캐시와 번역 기록은 Windows 사용자 데이터 폴더에 저장됩니다. 보관 기간은 앱 설정에서 변경할 수 있습니다.
- 진단 로그에는 메시지 본문, 로컬 모델 프롬프트와 인증 비밀 값을 기록하지 않습니다.

## 선택형 외부 서비스

사용자가 ChatGPT, Claude, Gemini 또는 DeepL을 번역 서비스로 직접 선택한 경우에만 번역에 필요한 텍스트가 해당 서비스로 전송됩니다. 이미지 번역에서는 PC 안에서 인식한 텍스트만 선택한 서비스로 전달되며 이미지 파일이나 픽셀은 전달하지 않습니다.

외부 서비스의 데이터 처리는 각 공급자의 약관과 개인정보 처리방침을 따릅니다. 구독형 서비스 연결은 각 공급자의 공식 로컬 CLI 인증을 사용하며, DeepL API 키는 Windows 자격 증명 관리자에 저장합니다.

## 네트워크 사용

앱은 사용자가 요청한 기능을 위해 다음 네트워크 연결을 사용할 수 있습니다.

- 앱 업데이트 확인과 설치 파일 다운로드
- 사용자가 선택한 로컬 번역 모델 및 OCR 모델 다운로드
- 사용자가 선택한 외부 번역 서비스 연결과 번역 요청

사용자가 외부 번역 서비스를 선택하지 않으면 번역할 대화 텍스트를 외부 번역 서비스로 보내지 않습니다.

## 문의

개인정보 또는 데이터 처리에 관한 문의는 [GitHub Issues](https://github.com/NudeNyang/NudeNyang-Discord-Translator/issues)에 남길 수 있습니다.

---

## English

NudeNyang Discord Translator does not operate a developer-controlled backend and does not collect or retain Discord messages, images, translation history, or credentials.

Local models process translation on the user's PC. Image pixels remain local for OCR and compositing. If the user explicitly selects ChatGPT, Claude, Gemini, or DeepL, only the text required for translation is sent to that provider under its own terms and privacy policy. Settings, caches, and history remain in the Windows user data directory. DeepL credentials are stored in Windows Credential Manager, and subscription providers use their official local CLI authentication.

Network access is limited to user-requested update checks, model downloads, and calls to an external translation provider selected by the user.
