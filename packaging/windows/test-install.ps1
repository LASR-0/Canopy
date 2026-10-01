# Install Canopy for real with its NSIS installer, check the controller service
# end to end, then uninstall it. Needs an elevated PowerShell, and nothing else
# on ports 7001 and 1883.
#
#   .\packaging\windows\test-install.ps1 -Installer "dist-build\Canopy Setup 0.1.0.exe"
#
# CI runs it on a Windows runner, the one place with admin rights
# (.github/workflows/package.yml). The grow data it creates in
# %ProgramData%\Canopy is left behind, as an uninstall would leave it.
param([Parameter(Mandatory = $true)][string]$Installer)

$ErrorActionPreference = "Stop"
$health = "http://127.0.0.1:7001"
$data = Join-Path $env:ProgramData "Canopy"
$installer = (Resolve-Path $Installer).Path
$uninstaller = Join-Path $env:ProgramFiles "Canopy\Uninstall Canopy.exe"

function Step($message) { Write-Host "`n== $message" }
function Pass($message) { Write-Host "   ok   $message" }
function Fail($message) {
  Write-Host "   FAIL $message"
  Get-ChildItem (Join-Path $data "logs") -Filter *.log -ErrorAction SilentlyContinue |
    ForEach-Object { Write-Host "--- $($_.Name)"; Get-Content $_.FullName -Tail 30 }
  exit 1
}

function Wait-Healthy([int]$seconds) {
  $until = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $until) {
    try { Invoke-RestMethod "$health/health" | Out-Null; return $true } catch { Start-Sleep -Milliseconds 500 }
  }
  return $false
}

function Get-Controller { Get-CimInstance Win32_Service -Filter "Name='Canopy'" }

# node.exe under WinSW, whose PID is what a restart changes.
function Get-NodePid {
  $node = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.ExecutablePath -like "$env:ProgramFiles\Canopy\controller\*" } | Select-Object -First 1
  if ($node) { $node.ProcessId } else { $null }
}

# The installer launches the app when it finishes; the window plays no part
# here, and a running Canopy.exe would only get in the uninstaller's way.
function Close-App { Get-Process Canopy -ErrorAction SilentlyContinue | Stop-Process -Force }

function Install-Canopy {
  Start-Process -FilePath $installer -ArgumentList "/S" -Wait
  Close-App
}

# "stopped cleanly" lines in the controller's own log, so a check can tell
# whether a stop added one.
function Count-CleanStops {
  @(Get-ChildItem (Join-Path $data "logs") -Filter "*.out.log" -ErrorAction SilentlyContinue |
    Select-String -Pattern "stopped cleanly").Count
}

Step "install"
Install-Canopy
if (-not (Wait-Healthy 60)) { Fail "the controller did not answer within 60 s of installing" }
Pass "answers on $health"

$svc = Get-Controller
if (-not $svc) { Fail "no service named Canopy" }
if ($svc.State -ne "Running") { Fail "the service is $($svc.State)" }
if ($svc.StartMode -ne "Auto") { Fail "the service starts $($svc.StartMode), not automatically" }
if ($svc.StartName -ne "NT SERVICE\Canopy") { Fail "the service runs as $($svc.StartName), not NT SERVICE\Canopy" }
Pass "service Canopy running, automatic, as NT SERVICE\Canopy"

$status = (Invoke-RestMethod "$health/controller/status").data
if (-not $status.installed) { Fail "the controller does not report itself installed" }
if ($status.dataDir -ne $data) { Fail "the data directory is $($status.dataDir), not $data" }
Pass "reports installed, data in $data"

$owner = Invoke-CimMethod -InputObject (Get-CimInstance Win32_Process -Filter "ProcessId=$(Get-NodePid)") -MethodName GetOwner
if ("$($owner.Domain)\$($owner.User)" -ne "NT SERVICE\Canopy") { Fail "node.exe runs as $($owner.Domain)\$($owner.User)" }
Pass "node.exe runs as NT SERVICE\Canopy"

Step "data folder and firewall"
$acl = Get-Acl $data
if (-not $acl.AreAccessRulesProtected) { Fail "the data folder still inherits ProgramData's permissions" }
$serviceSid = (New-Object Security.Principal.NTAccount "NT SERVICE\Canopy").Translate([Security.Principal.SecurityIdentifier]).Value
$allowed = @("S-1-5-18", "S-1-5-32-544", $serviceSid)
foreach ($rule in $acl.Access) {
  $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
  if ($allowed -notcontains $sid) { Fail "the data folder grants access to $($rule.IdentityReference)" }
}
Pass "data folder: SYSTEM, Administrators and the service only"

$rules = @(Get-NetFirewallRule -DisplayName "Canopy controller" -ErrorAction SilentlyContinue)
if ($rules.Count -ne 2) { Fail "expected 2 firewall rules, found $($rules.Count)" }
foreach ($rule in $rules) {
  if ("$($rule.Profile)" -ne "Domain, Private") { Fail "a firewall rule applies to $($rule.Profile)" }
}
Pass "firewall: 1883/TCP and 5353/UDP, private and domain networks only"

Step "stop and start"
$clean = Count-CleanStops
Stop-Service Canopy
if ((Count-CleanStops) -le $clean) { Fail "no clean shutdown in the controller's log: the stop signal did not reach Node" }
Pass "a stop shuts down cleanly"
Start-Service Canopy
if (-not (Wait-Healthy 30)) { Fail "did not come back after start" }
Pass "starts again"

Step "crash"
$before = Get-NodePid
Stop-Process -Id $before -Force
if (-not (Wait-Healthy 60)) { Fail "not restarted within 60 s of being killed" }
if ((Get-NodePid) -eq $before) { Fail "the same process is still running" }
Pass "restarted after being killed"

Step "upgrade (reinstall)"
$before = Get-NodePid
Install-Canopy
if (-not (Wait-Healthy 60)) { Fail "not answering after the upgrade" }
if ((Get-NodePid) -eq $before) { Fail "an upgrade did not restart the controller onto the new files" }
if ((Get-Controller).StartName -ne "NT SERVICE\Canopy") { Fail "an upgrade changed the service account" }
Pass "an upgrade restarts the controller and keeps its account"

Set-Service Canopy -StartupType Disabled
Stop-Service Canopy
Install-Canopy
if ((Get-Controller).State -ne "Stopped") { Fail "an upgrade started a controller that was Disabled" }
Pass "an upgrade leaves a Disabled controller off"
Set-Service Canopy -StartupType Automatic
Start-Service Canopy
if (-not (Wait-Healthy 30)) { Fail "did not start again" }

Step "uninstall"
Close-App
# The uninstaller copies itself to %TEMP% and runs from there, so -Wait returns
# early; wait for the service to go instead.
Start-Process -FilePath $uninstaller -ArgumentList "/S" -Wait
$until = (Get-Date).AddSeconds(90)
while ((Get-Controller) -and (Get-Date) -lt $until) { Start-Sleep -Seconds 1 }
if (Get-Controller) { Fail "the service is still registered" }
try { Invoke-RestMethod "$health/health" | Out-Null; Fail "the controller still answers" } catch { }
Pass "service removed and stopped"
if (@(Get-NetFirewallRule -DisplayName "Canopy controller" -ErrorAction SilentlyContinue).Count -ne 0) { Fail "the firewall rules are still there" }
Pass "firewall rules removed"
if (-not (Test-Path (Join-Path $data "canopy.db"))) { Fail "the grow data was deleted" }
Pass "grow data kept in $data"

Write-Host "`nAll checks passed for $(Split-Path $installer -Leaf)."
