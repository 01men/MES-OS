param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $root '.runtime'
New-Item -ItemType Directory -Path $runtime -Force | Out-Null

foreach ($port in 3000, 5173) {
  $existing = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if ($existing) {
    throw "Port $port is already in use by PID $($existing.OwningProcess). Stop it explicitly before starting MES."
  }
}

$serverOut = Join-Path $runtime 'server.out.log'
$serverErr = Join-Path $runtime 'server.err.log'
$webOut = Join-Path $runtime 'web.out.log'
$webErr = Join-Path $runtime 'web.err.log'

Start-Process -FilePath 'npm.cmd' -ArgumentList @('run', 'start:dev') `
  -WorkingDirectory (Join-Path $root 'server') -WindowStyle Hidden `
  -RedirectStandardOutput $serverOut -RedirectStandardError $serverErr | Out-Null

Start-Process -FilePath 'npm.cmd' -ArgumentList @('run', 'dev', '--', '--host', '127.0.0.1') `
  -WorkingDirectory (Join-Path $root 'web') -WindowStyle Hidden `
  -RedirectStandardOutput $webOut -RedirectStandardError $webErr | Out-Null

$deadline = (Get-Date).AddSeconds(30)
do {
  Start-Sleep -Milliseconds 300
  $serverListener = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
  $webListener = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue
} while ((-not $serverListener -or -not $webListener) -and (Get-Date) -lt $deadline)

if (-not $serverListener -or -not $webListener) {
  Get-Content -LiteralPath $serverErr -Tail 30 -ErrorAction SilentlyContinue
  Get-Content -LiteralPath $webErr -Tail 30 -ErrorAction SilentlyContinue
  throw 'MES services did not become ready within 30 seconds.'
}

Set-Content -LiteralPath (Join-Path $runtime 'server.pid') -Value $serverListener.OwningProcess
Set-Content -LiteralPath (Join-Path $runtime 'web.pid') -Value $webListener.OwningProcess

Write-Host "API ready: http://localhost:3000 (PID $($serverListener.OwningProcess))" -ForegroundColor Green
Write-Host "Web ready: http://127.0.0.1:5173/login (PID $($webListener.OwningProcess))" -ForegroundColor Green
Write-Host "Logs: $runtime"
