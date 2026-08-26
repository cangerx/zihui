; Custom NSIS hooks for electron-builder.
; Auto-loaded from ${buildResources}/installer.nsh by electron-builder NSIS template.
;
; Purpose: clean up the ms-gamingoverlay protocol registry entry written by
; main process at runtime via app.setAsDefaultProtocolClient('ms-gamingoverlay').
; That entry exists to suppress the Windows Shell "Open with new app" dialog
; triggered by Chromium GPU process probing Xbox Game Bar overlay capability
; on systems where the Game Bar UWP package was uninstalled but its protocol
; registration leftover remained.
;
; Without this cleanup, after uninstall the residual key would point to a
; missing .exe and Windows Shell would prompt again next time something probes
; the protocol.

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\ms-gamingoverlay"
!macroend
