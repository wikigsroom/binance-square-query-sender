$ErrorActionPreference = 'Stop'

$appRoot = $PSScriptRoot
$projectRoot = Split-Path -Parent $appRoot
Set-Location -LiteralPath $projectRoot

$active = Get-CimInstance Win32_Process | Where-Object {
  $_.ProcessId -ne $PID -and $_.CommandLine -and (
    $_.CommandLine -match 'binance square[\\/]app[\\/]run-watchdog\.ps1' -or
    $_.CommandLine -match 'binance square[\\/]app[\\/]src[\\/]index\.mjs'
  )
}
if ($active) {
  Write-Host 'Binance Square publisher is already running; no second process was started.' -ForegroundColor Yellow
  $active | Select-Object ProcessId, Name | Format-Table -AutoSize
  exit 0
}

if ([string]::IsNullOrWhiteSpace($env:LUNA_API_KEY)) {
  Write-Host 'LUNA_API_KEY is not set for this process.' -ForegroundColor Yellow
  Write-Host 'Enter it once for this run; it will not be saved to a file.'
  $secureKey = Read-Host 'LUNA_API_KEY' -AsSecureString
  $keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
  try {
    $env:LUNA_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)
  }
}

if ([string]::IsNullOrWhiteSpace($env:LUNA_API_KEY)) {
  throw 'LUNA_API_KEY is required. Publisher was not started.'
}

$watchdog = Join-Path $appRoot 'run-watchdog.ps1'
& powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $watchdog
exit $LASTEXITCODE
