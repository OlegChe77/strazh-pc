; Find/close the running app WITHOUT WMI.
; The default electron-builder check uses Get-CimInstance Win32_Process (and tasklist/taskkill
; as a fallback). Where WMI is broken ("Invalid class") all of them fail: the app is neither
; seen nor closed and setup ends with "StrazhPC cannot be closed".
; Get-Process / Stop-Process use plain Win32 calls and work everywhere.
!include "getProcessInfo.nsh"
Var pid

; _RETURN = 0 when a process of ours is running, 1 otherwise.
; Match by NAME only: setup is 32-bit, so its PowerShell cannot read .Path of x64 processes.
!macro STRAZH_FIND _RETURN
  nsExec::Exec `"$PowerShellPath" -NoProfile -NonInteractive -C "if (@(Get-Process -ErrorAction SilentlyContinue | ? {($$_.Name + '.exe') -eq '${APP_EXECUTABLE_FILENAME}'}).Count -gt 0) { exit 0 } else { exit 1 }"`
  Pop ${_RETURN}
!macroend

; _MODE = soft (ask the window to close) or hard (kill)
!macro STRAZH_KILL _MODE
  !if "${_MODE}" == "soft"
    nsExec::Exec `"$PowerShellPath" -NoProfile -NonInteractive -C "Get-Process -ErrorAction SilentlyContinue | ? {($$_.Name + '.exe') -eq '${APP_EXECUTABLE_FILENAME}'} | % { [void]$$_.CloseMainWindow() }"`
  !else
    nsExec::Exec `"$PowerShellPath" -NoProfile -NonInteractive -C "Get-Process -ErrorAction SilentlyContinue | ? {($$_.Name + '.exe') -eq '${APP_EXECUTABLE_FILENAME}'} | Stop-Process -Force -ErrorAction SilentlyContinue"`
  !endif
  Pop $0
!macroend

!macro customCheckAppRunning
  ${GetProcessInfo} 0 $pid $1 $2 $3 $4
  ${if} $3 != "${APP_EXECUTABLE_FILENAME}"
    ${if} ${isUpdated}
      Sleep 300
    ${endIf}

    !insertmacro STRAZH_FIND $R0
    ${if} $R0 == 0
      ${if} ${isUpdated}
        Sleep 1000
        Goto doStopProcess
      ${endIf}
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK doStopProcess
      Quit

      doStopProcess:
      DetailPrint "$(appClosing)"
      !insertmacro STRAZH_KILL soft
      Sleep 1500

      StrCpy $R1 0
      loop:
        IntOp $R1 $R1 + 1

        !insertmacro STRAZH_FIND $R0
        ${if} $R0 == 0
          !insertmacro STRAZH_KILL hard
          Sleep 500
          !insertmacro STRAZH_FIND $R0
          ${if} $R0 == 0
            DetailPrint `Waiting for "${PRODUCT_NAME}" to close.`
            Sleep 2000
          ${else}
            Goto not_running
          ${endIf}
        ${else}
          Goto not_running
        ${endIf}

        ${if} $R1 > 1
          MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY loop
          Quit
        ${else}
          Goto loop
        ${endIf}
      not_running:
    ${endIf}
  ${endIf}
!macroend
