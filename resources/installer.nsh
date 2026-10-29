; Included by electron-builder (electron-builder.json → nsis.include).
; Uninstalling removes Orbi's Claude Code hooks (customUnInit) and the "Iniciar com o Windows"
; entry (LOGIN_ITEM_NAME in src/main/index.ts); an update keeps both.
!macro customUnInit
  ; Before the files go away: remove Orbi's hooks from Claude Code's settings
  ; (a real uninstall only; an update keeps the connection).
  ${ifNot} ${isUpdated}
    ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --orbi-disconnect'
  ${endIf}
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Orbi"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "Orbi"
  ${endIf}
!macroend
