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
    RMDir /r "$LOCALAPPDATA\LocalTools\NudeNyang Discord Translator"
    RMDir /r "$LOCALAPPDATA\LocalTools\DiscordTranslateOverlay"
    RMDir "$LOCALAPPDATA\LocalTools"
    RMDir /r "$LOCALAPPDATA\NudeNyang Discord Translator"
    RMDir /r "$LOCALAPPDATA\NudeNyang Translator"
    nsExec::ExecToLog '"$SYSDIR\cmdkey.exe" /delete:"deepl.NudeNyang Discord Translator"'
    nsExec::ExecToLog '"$SYSDIR\cmdkey.exe" /delete:"deepl.NudeNyang Translator"'
    nsExec::ExecToLog '"$SYSDIR\cmdkey.exe" /delete:"deepl.Nude Translator"'
  ${EndIf}
!macroend
