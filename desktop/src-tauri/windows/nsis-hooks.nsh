!macro NSIS_HOOK_POSTUNINSTALL
  ; auto-launch 0.5.0 records Task Manager's per-app startup approval in
  ; addition to HKCU Run. Tauri's default NSIS uninstaller removes Run only.
  ; Keep the approval during updater-mode uninstalls, but remove Relayune's
  ; exact value on a real uninstall without touching any other startup app.
  ${If} $UpdateMode <> 1
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "${PRODUCTNAME}"
  ${EndIf}
!macroend
