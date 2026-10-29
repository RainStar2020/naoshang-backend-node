<#
  NaoshangAI - Scheduled Task helper (2026-10-28)
  Invoked by scripts/run.js via: powershell -NoProfile -ExecutionPolicy Bypass -File taskctl.ps1

  IMPORTANT constraints discovered in this environment:
    1. Keep this file ASCII-only. Windows PowerShell 5.1 reads BOM-less UTF-8 as ANSI.
    2. A child powershell CANNOT write files under paths containing non-ASCII
       characters (silently fails, no exception). Logs therefore go to
       C:\ProgramData\NaoshangAI\ (pure ASCII).
    3. stdout of a child powershell may be swallowed by the sandbox, so the
       result is ALSO persisted to taskctl.log and read back by run.js.
    4. Do NOT use a `switch` statement here: inside a child powershell, cmdlets
       called from a switch block abort the rest of the script silently.
       Use plain if/else at the top level instead.
    5. Every cmdlet call needs its own try/catch - an unhandled error aborts
       the whole script.

  Usage:
    -Action start  -Name <task> -Exe <node.exe> -Args <args> -Dir <workdir>
    -Action stop   -Name <task>
    -Action status -Name <task>
#>
param(
  [Parameter(Mandatory = $true)][string]$Action,
  [Parameter(Mandatory = $true)][string]$Name,
  [string]$Exe = '',
  [string]$Args = '',
  [string]$Dir = ''
)

$ErrorActionPreference = 'Continue'
$ResultFile = 'C:\ProgramData\NaoshangAI\taskctl.log'
$msg = ''

if ($Action -eq 'status') {
  $t = $null
  try { $t = Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue } catch {}
  $state = 'notfound'
  if ($t) { $state = [string]$t.State }
  $msg = 'status:' + $Name + ':' + $state
}
elseif ($Action -eq 'pid') {
  # Report the PID of the running instance whose node.exe command line
  # contains $Name (a keyword such as sync_to_mysql).
  $pidFound = 0
  try {
    $procs = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue)
    foreach ($p in $procs) {
      $cl = [string]$p.CommandLine
      if ($cl -like ('*' + $Name + '*')) { $pidFound = $p.ProcessId; break }
    }
  } catch {}
  $msg = 'pid:' + $Name + ':' + $pidFound
}
elseif ($Action -eq 'stop' -or $Action -eq 'uninstall') {
  try { Stop-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue } catch {}
  try { Unregister-ScheduledTask -TaskName $Name -Confirm:$false -ErrorAction SilentlyContinue } catch {}
  # Stop-ScheduledTask only prevents future runs; an already running instance
  # must be killed explicitly. taskkill.exe is blocked in some sandboxes, so
  # use Stop-Process on the node processes matching this task's action.
  $killCount = 0
  try {
    $procs = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue)
    foreach ($p in $procs) {
      $cl = [string]$p.CommandLine
      $isApi = ($cl -match 'server\.js')
      $isSync = ($cl -match 'sync_to_mysql')
      $isViewer = ($cl -match 'db_viewer_mysql')      if ($Name -match 'Viewer' -and $isViewer) { try { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue; $killCount++ } catch {} }
      elseif ($Name -match 'Sync' -and $isSync) { try { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue; $killCount++ } catch {} }
      elseif ($Name -match 'Api' -and $isApi) { try { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue; $killCount++ } catch {} }
    }
  } catch {}
  $msg = $Action + ':' + $Name + ':killed=' + $killCount
}
elseif ($Action -eq 'start') {
  if (-not $Exe) { $msg = "error:missing -Exe" }
  else {
    $stale = $null
    try { $stale = Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue } catch {}
    if ($stale) {
      try { Stop-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue } catch {}
      try { Unregister-ScheduledTask -TaskName $Name -Confirm:$false -ErrorAction SilentlyContinue } catch {}
    }
    $ok = $true
    $err = ''
    try {
      $act = New-ScheduledTaskAction -Execute $Exe -Argument $Args -WorkingDirectory $Dir
      $trg = New-ScheduledTaskTrigger -AtStartup
      $prn = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
      $stg = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
        -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
        -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
      Register-ScheduledTask -TaskName $Name -Action $act -Trigger $trg -Principal $prn -Settings $stg | Out-Null
      Start-ScheduledTask -TaskName $Name
    } catch {
      $ok = $false
      $err = $_.Exception.Message
    }
    if ($ok) { $msg = "started:$Name" } else { $msg = "error:$err" }
  }
}
else {
  $msg = "error:unknown action '$Action'"
}

# Persist the result (stdout may be swallowed by the sandbox).
# Use Set-Content (overwrite) rather than Add-Content: in a child powershell
# Add-Content / Test-Path / New-Item on a fresh path can silently no-op.
try {
  Set-Content -Path $ResultFile -Value ("[" + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + "] " + $msg) -Encoding ascii
} catch {}

Write-Output $msg
