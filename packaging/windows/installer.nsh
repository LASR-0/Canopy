; Installs, upgrades and removes the Canopy controller service. Included in
; electron-builder's NSIS installer (electron-builder.cjs, nsis.include), which
; installs per machine, so these run elevated.
;
; The controller is in $INSTDIR\controller: node.exe, the bundle, and WinSW as
; canopy-service.exe with its canopy-service.xml.
;
; On an upgrade the new installer first runs the OLD uninstaller with
; --updated, and that calls customUnInstall before any file is removed. It is
; the one moment to stop the controller, whose node.exe is otherwise locked
; and cannot be replaced.

; Each macro declares its own variables rather than using $0, $1 and the
; other registers, which electron-builder's install section uses around them.
; Declared inside the macro because the installer and the uninstaller are
; compiled separately, and a variable one of them never uses is a warning,
; which electron-builder treats as an error.

!macro customInstall
  Var /GLOBAL canopyData
  Var /GLOBAL canopyExit
  ; Read rather than $APPDATA, whose meaning depends on the shell context.
  ReadEnvStr $canopyData PROGRAMDATA
  StrCpy $canopyData "$canopyData\Canopy"
  CreateDirectory "$canopyData"

  ; Registered on a first install only: an upgrade keeps the service, its
  ; start mode and its recovery settings. sc query fails with 1060 if the
  ; service does not exist.
  nsExec::ExecToLog 'sc.exe query Canopy'
  Pop $canopyExit
  ${if} $canopyExit != 0
    nsExec::ExecToLog '"$INSTDIR\controller\canopy-service.exe" install'
    Pop $canopyExit
    ; Devices on the LAN connect to the broker, and mDNS answers come back on
    ; 5353. Private and domain networks only: a laptop on public Wi-Fi should
    ; not offer a broker that can switch hardware. Scoped to Canopy's node.exe.
    nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Canopy controller" dir=in action=allow protocol=TCP localport=1883 program="$INSTDIR\controller\node.exe" profile=private,domain'
    Pop $canopyExit
    nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Canopy controller" dir=in action=allow protocol=UDP localport=5353 program="$INSTDIR\controller\node.exe" profile=private,domain'
    Pop $canopyExit
  ${endif}

  ; Every time, because both are idempotent:
  ; - Run as the service's own virtual account, not LocalSystem.
  nsExec::ExecToLog 'sc.exe config Canopy obj= "NT SERVICE\Canopy"'
  Pop $canopyExit
  ; - Only SYSTEM, Administrators and the service may touch the data. By
  ;   default ProgramData lets every user read it, and the database holds the
  ;   whole grow. SIDs rather than names, which are localised.
  nsExec::ExecToLog 'icacls "$canopyData" /inheritance:r /grant:r *S-1-5-18:(OI)(CI)F *S-1-5-32-544:(OI)(CI)F "NT SERVICE\Canopy:(OI)(CI)M"'
  Pop $canopyExit

  ; Starts it on a first install, and again after an upgrade. A service an
  ; administrator set to Disabled refuses to start (error 1058) and stays off.
  nsExec::ExecToLog 'sc.exe start Canopy'
  Pop $canopyExit
!macroend

!macro customUnInstall
  Var /GLOBAL canopyUnExit
  ; net stop waits until the service has stopped; sc stop only asks.
  nsExec::ExecToLog 'net stop Canopy'
  Pop $canopyUnExit

  ${ifNot} ${isUpdated}
    nsExec::ExecToLog '"$INSTDIR\controller\canopy-service.exe" uninstall'
    Pop $canopyUnExit
    nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Canopy controller"'
    Pop $canopyUnExit
    ; The data in ProgramData\Canopy is kept: uninstalling never deletes grow
    ; history.
  ${endif}
!macroend
