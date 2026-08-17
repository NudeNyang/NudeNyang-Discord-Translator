LangString deleteLocalModels ${LANG_ENGLISH} "Delete downloaded local AI models"
LangString deleteLocalModels ${LANG_KOREAN} "다운로드한 로컬 AI 모델 삭제하기"
LangString deleteLocalModels ${LANG_JAPANESE} "ダウンロードしたローカルAIモデルを削除する"
LangString deleteLocalModels ${LANG_SIMPCHINESE} "删除已下载的本地 AI 模型"
LangString deleteLocalModels ${LANG_TRADCHINESE} "刪除已下載的本機 AI 模型"
LangString deleteLocalModels ${LANG_PORTUGUESEBR} "Excluir modelos de IA locais baixados"
LangString deleteLocalModels ${LANG_SPANISHINTERNATIONAL} "Eliminar modelos de IA locales descargados"
LangString deleteLocalModels ${LANG_GERMAN} "Heruntergeladene lokale KI-Modelle löschen"
LangString deleteLocalModels ${LANG_RUSSIAN} "Удалить загруженные локальные модели ИИ"
LangString deleteLocalModels ${LANG_FRENCH} "Supprimer les modèles d’IA locaux téléchargés"
LangString deleteLocalModels ${LANG_TURKISH} "İndirilen yerel yapay zekâ modellerini sil"
LangString deleteLocalModels ${LANG_ARABIC} "حذف نماذج الذكاء الاصطناعي المحلية التي تم تنزيلها"
LangString deleteLocalModels ${LANG_VIETNAMESE} "Xóa các mô hình AI cục bộ đã tải xuống"
LangString deleteLocalModels ${LANG_ITALIAN} "Elimina i modelli IA locali scaricati"
LangString deleteLocalModels ${LANG_UKRAINIAN} "Видалити завантажені локальні моделі ШІ"
LangString deleteLocalModels ${LANG_DUTCH} "Gedownloade lokale AI-modellen verwijderen"

!macro NSIS_HOOK_POSTINSTALL
  IfFileExists "$LOCALAPPDATA\NudeNyang Translator\NudeNyangTranslator.log" 0 desktop_previous_shortcut
  IfFileExists "$LOCALAPPDATA\NudeNyang Discord Translator\NudeNyangDiscordTranslator.log" desktop_previous_shortcut 0
    CreateDirectory "$LOCALAPPDATA\NudeNyang Discord Translator"
    Rename "$LOCALAPPDATA\NudeNyang Translator\NudeNyangTranslator.log" "$LOCALAPPDATA\NudeNyang Discord Translator\NudeNyangDiscordTranslator.log"
    RMDir "$LOCALAPPDATA\NudeNyang Translator"

  desktop_previous_shortcut:
  IfFileExists "$DESKTOP\NudeNyang Translator.lnk" 0 desktop_legacy_shortcut
    CreateShortcut "$DESKTOP\NudeNyang Discord Translator.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Delete "$DESKTOP\NudeNyang Translator.lnk"

  desktop_legacy_shortcut:
  IfFileExists "$DESKTOP\Nude Translator.lnk" 0 desktop_tauri_shortcut
    CreateShortcut "$DESKTOP\NudeNyang Discord Translator.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Delete "$DESKTOP\Nude Translator.lnk"

  desktop_tauri_shortcut:
  IfFileExists "$DESKTOP\Nude Translator (Tauri).lnk" 0 start_menu_shortcut
    CreateShortcut "$DESKTOP\NudeNyang Discord Translator.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Delete "$DESKTOP\Nude Translator (Tauri).lnk"

  start_menu_shortcut:
  IfFileExists "$SMPROGRAMS\NudeNyang Translator.lnk" 0 start_menu_legacy_shortcut
    CreateShortcut "$SMPROGRAMS\NudeNyang Discord Translator.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Delete "$SMPROGRAMS\NudeNyang Translator.lnk"

  start_menu_legacy_shortcut:
  IfFileExists "$SMPROGRAMS\Nude Translator.lnk" 0 start_menu_tauri_shortcut
    CreateShortcut "$SMPROGRAMS\NudeNyang Discord Translator.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Delete "$SMPROGRAMS\Nude Translator.lnk"

  start_menu_tauri_shortcut:
  IfFileExists "$SMPROGRAMS\Nude Translator (Tauri).lnk" 0 shortcut_migration_done
    CreateShortcut "$SMPROGRAMS\NudeNyang Discord Translator.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Delete "$SMPROGRAMS\Nude Translator (Tauri).lnk"

  shortcut_migration_done:
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --restore-discord-startup'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  Delete "$DESKTOP\NudeNyang Discord Translator.lnk"
  Delete "$DESKTOP\NudeNyang Translator.lnk"
  Delete "$DESKTOP\Nude Translator.lnk"
  Delete "$DESKTOP\Nude Translator (Tauri).lnk"
  Delete "$SMPROGRAMS\NudeNyang Discord Translator.lnk"
  Delete "$SMPROGRAMS\NudeNyang Translator.lnk"
  Delete "$SMPROGRAMS\Nude Translator.lnk"
  Delete "$SMPROGRAMS\Nude Translator (Tauri).lnk"

  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    Delete "$LOCALAPPDATA\LocalTools\NudeNyang Discord Translator\settings.json"
    Delete "$LOCALAPPDATA\LocalTools\NudeNyang Discord Translator\*.*"
    Delete "$LOCALAPPDATA\LocalTools\NudeNyang Discord Translator\Cache\*.*"
    RMDir /r "$LOCALAPPDATA\LocalTools\NudeNyang Discord Translator\Cache\image-translations"
    RMDir /r "$LOCALAPPDATA\LocalTools\NudeNyang Discord Translator\Cache\subscription-cli"
    Delete "$LOCALAPPDATA\LocalTools\DiscordTranslateOverlay\*.*"
    Delete "$LOCALAPPDATA\LocalTools\DiscordTranslateOverlay\Cache\*.*"
    RMDir /r "$LOCALAPPDATA\LocalTools\DiscordTranslateOverlay\Cache\image-translations"
    RMDir /r "$LOCALAPPDATA\LocalTools\DiscordTranslateOverlay\Cache\subscription-cli"
    RMDir /r "$LOCALAPPDATA\NudeNyang Discord Translator"
    RMDir /r "$LOCALAPPDATA\NudeNyang Translator"
    nsExec::ExecToLog '"$SYSDIR\cmdkey.exe" /delete:"deepl.NudeNyang Discord Translator"'
    nsExec::ExecToLog '"$SYSDIR\cmdkey.exe" /delete:"deepl.NudeNyang Translator"'
    nsExec::ExecToLog '"$SYSDIR\cmdkey.exe" /delete:"deepl.Nude Translator"'
  ${EndIf}

  ${If} $DeleteLocalModelsCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    RMDir /r "$LOCALAPPDATA\LocalTools\NudeNyang Discord Translator\Cache\models"
    RMDir /r "$LOCALAPPDATA\LocalTools\NudeNyang Discord Translator\Cache\ocr-rust"
    RMDir /r "$LOCALAPPDATA\LocalTools\DiscordTranslateOverlay\Cache\models"
    RMDir /r "$LOCALAPPDATA\LocalTools\DiscordTranslateOverlay\Cache\ocr-rust"
  ${EndIf}

  RMDir "$LOCALAPPDATA\LocalTools\NudeNyang Discord Translator\Cache"
  RMDir "$LOCALAPPDATA\LocalTools\NudeNyang Discord Translator"
  RMDir "$LOCALAPPDATA\LocalTools\DiscordTranslateOverlay\Cache"
  RMDir "$LOCALAPPDATA\LocalTools\DiscordTranslateOverlay"
  RMDir "$LOCALAPPDATA\LocalTools"
!macroend
