$ErrorActionPreference = 'Continue'
$appRoot = $PSScriptRoot
$project = Split-Path -Parent $appRoot
$state = Join-Path $appRoot 'state'
$stdout = Join-Path $state 'runner.stdout.log'
$stderr = Join-Path $state 'runner.stderr.log'
$watchdogLog = Join-Path $state 'watchdog.log'

New-Item -ItemType Directory -Force -Path $state | Out-Null
$env:LOCAL_CONTENT = 'false'
$env:DRY_RUN = 'false'
$env:RUN_ON_START = 'true'
$env:LUNA_API_BASE_URL = 'http://43.165.167.179:18241'
$env:LUNA_MODEL = 'gpt-6-luna'
$env:LUNA_REASONING_EFFORT = 'max'

function Write-WatchdogLog([string]$message) {
  Add-Content -Encoding UTF8 -Path $watchdogLog -Value "[$([DateTime]::UtcNow.ToString('o'))] $message"
}

$record = [ordered]@{
  watchdogPid = $PID
  startedAt = [DateTime]::UtcNow.ToString('o')
  intervalMinutes = 15
  runOnStart = $true
  dryRun = $false
  localContent = $false
  model = 'gpt-6-luna'
  entrypoint = 'app/src/index.mjs'
}
$record | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $state 'runner.json')
Write-WatchdogLog "watchdog started pid=$PID"

if ([string]::IsNullOrWhiteSpace($env:LUNA_API_KEY)) {
  Write-WatchdogLog 'LUNA_API_KEY is missing; refusing to start a non-Luna publishing loop'
  exit 2
}

while ($true) {
  Write-WatchdogLog 'starting node scheduler'
  try {
    & node (Join-Path $appRoot 'src/index.mjs') >> $stdout 2>> $stderr
    $exitCode = $LASTEXITCODE
  } catch {
    $_ | Out-String | Add-Content -Encoding UTF8 $stderr
    $exitCode = 1
  }
  Write-WatchdogLog "node scheduler exited code=$exitCode; restarting in 5 seconds"
  Start-Sleep -Seconds 5
}
