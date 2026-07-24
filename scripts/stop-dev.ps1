param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $root '.runtime'

foreach ($name in 'server', 'web') {
  $pidFile = Join-Path $runtime "$name.pid"
  if (-not (Test-Path -LiteralPath $pidFile)) {
    Write-Host "$name`: no PID file, skipped"
    continue
  }
  $targetPid = [int](Get-Content -LiteralPath $pidFile -Raw)
  $process = Get-Process -Id $targetPid -ErrorAction SilentlyContinue
  if ($process) {
    Stop-Process -Id $targetPid -Force
    Write-Host "$name stopped (PID $targetPid)"
  } else {
    Write-Host "$name`: PID $targetPid is no longer running"
  }
  Remove-Item -LiteralPath $pidFile -Force
}

