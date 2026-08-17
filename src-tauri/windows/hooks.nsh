Var DeleteLocalModelsLabel

!define NN_LANG_ARABIC 1025
!define NN_LANG_TRADCHINESE 1028
!define NN_LANG_GERMAN 1031
!define NN_LANG_ENGLISH 1033
!define NN_LANG_FRENCH 1036
!define NN_LANG_ITALIAN 1040
!define NN_LANG_JAPANESE 1041
!define NN_LANG_KOREAN 1042
!define NN_LANG_DUTCH 1043
!define NN_LANG_PORTUGUESEBR 1046
!define NN_LANG_RUSSIAN 1049
!define NN_LANG_TURKISH 1055
!define NN_LANG_UKRAINIAN 1058
!define NN_LANG_VIETNAMESE 1066
!define NN_LANG_SIMPCHINESE 2052
!define NN_LANG_SPANISHINTERNATIONAL 3082

Function un.ResolveDeleteLocalModelsLabel
  StrCpy $DeleteLocalModelsLabel "Delete downloaded local AI models"

  ${If} $LANGUAGE == ${NN_LANG_KOREAN}
    StrCpy $DeleteLocalModelsLabel "다운로드한 로컬 AI 모델 삭제하기"
  ${ElseIf} $LANGUAGE == ${NN_LANG_JAPANESE}
    StrCpy $DeleteLocalModelsLabel "ダウンロードしたローカルAIモデルを削除する"
  ${ElseIf} $LANGUAGE == ${NN_LANG_SIMPCHINESE}
    StrCpy $DeleteLocalModelsLabel "删除已下载的本地 AI 模型"
  ${ElseIf} $LANGUAGE == ${NN_LANG_TRADCHINESE}
    StrCpy $DeleteLocalModelsLabel "刪除已下載的本機 AI 模型"
  ${ElseIf} $LANGUAGE == ${NN_LANG_PORTUGUESEBR}
    StrCpy $DeleteLocalModelsLabel "Excluir modelos de IA locais baixados"
  ${ElseIf} $LANGUAGE == ${NN_LANG_SPANISHINTERNATIONAL}
    StrCpy $DeleteLocalModelsLabel "Eliminar modelos de IA locales descargados"
  ${ElseIf} $LANGUAGE == ${NN_LANG_GERMAN}
    StrCpy $DeleteLocalModelsLabel "Heruntergeladene lokale KI-Modelle löschen"
  ${ElseIf} $LANGUAGE == ${NN_LANG_RUSSIAN}
    StrCpy $DeleteLocalModelsLabel "Удалить загруженные локальные модели ИИ"
  ${ElseIf} $LANGUAGE == ${NN_LANG_FRENCH}
    StrCpy $DeleteLocalModelsLabel "Supprimer les modèles d’IA locaux téléchargés"
  ${ElseIf} $LANGUAGE == ${NN_LANG_TURKISH}
    StrCpy $DeleteLocalModelsLabel "İndirilen yerel yapay zekâ modellerini sil"
  ${ElseIf} $LANGUAGE == ${NN_LANG_ARABIC}
    StrCpy $DeleteLocalModelsLabel "حذف نماذج الذكاء الاصطناعي المحلية التي تم تنزيلها"
  ${ElseIf} $LANGUAGE == ${NN_LANG_VIETNAMESE}
    StrCpy $DeleteLocalModelsLabel "Xóa các mô hình AI cục bộ đã tải xuống"
  ${ElseIf} $LANGUAGE == ${NN_LANG_ITALIAN}
    StrCpy $DeleteLocalModelsLabel "Elimina i modelli IA locali scaricati"
  ${ElseIf} $LANGUAGE == ${NN_LANG_UKRAINIAN}
    StrCpy $DeleteLocalModelsLabel "Видалити завантажені локальні моделі ШІ"
  ${ElseIf} $LANGUAGE == ${NN_LANG_DUTCH}
    StrCpy $DeleteLocalModelsLabel "Gedownloade lokale AI-modellen verwijderen"
  ${EndIf}
FunctionEnd

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
