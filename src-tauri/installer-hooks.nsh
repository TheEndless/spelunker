; Extra steps for the Spelunker installer, run by the Tauri NSIS template.
;
; The installer is per-user, so the Explorer entries go under HKEY_CURRENT_USER. They add
; "Search with Spelunker" to the right-click menu of folders, of the empty space inside a folder,
; and of drives, and "Search all drives with Spelunker" to the This PC icon.
;
; The dot after each folder placeholder is deliberate: a drive arrives as "D:\" and a trailing
; backslash inside quotes would escape the closing quote. The app removes the dot again. The This PC
; entry passes the words "This PC", which the app turns into every local drive.

!macro SpelunkerRegisterMenuEntry KEY LABEL ARGUMENT
  WriteRegStr HKCU "Software\Classes\${KEY}\shell\Spelunker" "" "${LABEL}"
  WriteRegStr HKCU "Software\Classes\${KEY}\shell\Spelunker" "Icon" '"$INSTDIR\${MAINBINARYNAME}.exe",0'
  WriteRegStr HKCU "Software\Classes\${KEY}\shell\Spelunker\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "${ARGUMENT}"'
!macroend

; The app records in this file that the user switched the entries off in Settings. An upgrade or a
; reinstall then leaves them off instead of quietly putting them back.
!macro NSIS_HOOK_POSTINSTALL
  IfFileExists "$APPDATA\dev.skean.spelunker\explorer-entry-off" spelunker_menu_off 0
    !insertmacro SpelunkerRegisterMenuEntry "Directory" "Search with Spelunker" "%1."
    !insertmacro SpelunkerRegisterMenuEntry "Directory\Background" "Search with Spelunker" "%V."
    !insertmacro SpelunkerRegisterMenuEntry "Drive" "Search with Spelunker" "%1."
    !insertmacro SpelunkerRegisterMenuEntry "CLSID\{20D04FE0-3AEA-1069-A2D8-08002B30309D}" "Search all drives with Spelunker" "This PC"
  spelunker_menu_off:
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DeleteRegKey HKCU "Software\Classes\Directory\shell\Spelunker"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\Spelunker"
  DeleteRegKey HKCU "Software\Classes\Drive\shell\Spelunker"
  DeleteRegKey HKCU "Software\Classes\CLSID\{20D04FE0-3AEA-1069-A2D8-08002B30309D}\shell\Spelunker"
!macroend
