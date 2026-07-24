param(
  [string]$Username = 'admin',
  [string]$Password = 'Admin@123'
)

$ErrorActionPreference = 'Stop'

function Test-Url([string]$Uri) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 2
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch {
    return $false
  }
}

if (-not (Test-Url 'http://127.0.0.1:5173/login')) {
  & (Join-Path $PSScriptRoot 'start-dev.ps1')
}

$loginBody = @{ username = $Username; password = $Password } | ConvertTo-Json
$login = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3000/api/auth/login' `
  -ContentType 'application/json' -Body $loginBody
if (-not $login.token) {
  throw 'Login did not return a token.'
}

$headers = @{
  Authorization = "Bearer $($login.token)"
  'X-Request-Id' = "smoke-$([guid]::NewGuid())"
}

$checks = @(
  @{ Name = 'Web login'; Run = { Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5173/login' } },
  @{ Name = 'Current user'; Run = { Invoke-RestMethod -Headers $headers -Uri 'http://127.0.0.1:3000/api/auth/me' } },
  @{ Name = 'RBAC users'; Run = { Invoke-RestMethod -Headers $headers -Uri 'http://127.0.0.1:3000/api/rbac/users' } },
  @{ Name = 'Receiving arrivals'; Run = { Invoke-RestMethod -Headers $headers -Uri 'http://127.0.0.1:3000/api/receiving/arrivals' } },
  @{ Name = 'Inventory lots'; Run = { Invoke-RestMethod -Headers $headers -Uri 'http://127.0.0.1:3000/api/inventory/lots' } },
  @{ Name = 'Integration logs'; Run = { Invoke-RestMethod -Headers $headers -Uri 'http://127.0.0.1:3000/api/integration/logs' } },
  @{ Name = 'Mock U8'; Run = { Invoke-RestMethod -Uri 'http://127.0.0.1:3000/mock-u8/purchase-orders' } }
)

foreach ($check in $checks) {
  & $check.Run | Out-Null
  Write-Host "[PASS] $($check.Name)" -ForegroundColor Green
}

Write-Host "Smoke test passed: $($checks.Count)/$($checks.Count)" -ForegroundColor Green
