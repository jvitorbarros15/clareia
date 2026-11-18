param(
  [Parameter(Position = 0)][string]$Folder,
  [string]$Revoke,
  [switch]$Rollback,
  [switch]$Setup
)
# Só monta o DSN a partir de ~/.clareia/api-pg.env e chama cmd/load, que roda a busca de CPF e as cinco recusas ele mesmo.
# As variáveis valem só durante o go run e são restauradas no fim.
$ErrorActionPreference = 'Stop'

$saved = @{}
foreach ($n in 'CLAREIA_API_DSN', 'CLAREIA_API_RO_PASSWORD') { $saved[$n] = [Environment]::GetEnvironmentVariable($n, 'Process') }
try {
  if (-not $env:CLAREIA_API_DSN) {
    $file = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.clareia/api-pg.env'
    if (-not (Test-Path $file)) { throw "defina CLAREIA_API_DSN ou crie $file" }
    $cfg = @{}
    Get-Content $file | ForEach-Object { if ($_ -match '^([A-Z_]+)=(.*)$') { $cfg[$Matches[1]] = $Matches[2] } }
    $user = [uri]::EscapeDataString($cfg['API_PG_OWNER'])
    $pass = [uri]::EscapeDataString($cfg['API_PG_OWNER_PASSWORD'])
    $env:CLAREIA_API_DSN = "postgres://${user}:${pass}@127.0.0.1:$($cfg['API_PG_PORT'])/$($cfg['API_PG_DB'])"
    if ($Setup -and -not $env:CLAREIA_API_RO_PASSWORD) { $env:CLAREIA_API_RO_PASSWORD = $cfg['API_PG_RO_PASSWORD'] }
  }
  [string[]]$loadArgs = if ($Setup) { @('--setup') } elseif ($Rollback) { @('--rollback') } elseif ($Revoke) { @('--revoke', $Revoke) }
  elseif ($Folder) { @((Resolve-Path $Folder).Path) } else { throw 'uso: load.ps1 <pasta da publicação> | -Revoke <id> | -Rollback | -Setup' }
  Push-Location $PSScriptRoot
  try {
    go run ./cmd/load $loadArgs
    if ($LASTEXITCODE -ne 0) { throw "cmd/load falhou (codigo $LASTEXITCODE)" }
  } finally { Pop-Location }
} finally {
  foreach ($n in $saved.Keys) { [Environment]::SetEnvironmentVariable($n, $saved[$n], 'Process') }
}
