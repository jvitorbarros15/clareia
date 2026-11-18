param(
  [Parameter(Position = 0)][string]$Folder,
  [string]$Revoke,
  [switch]$Rollback
)
# Entrada única da carga: busca de CPF, as cinco recusas, depois cmd/load. Qualquer falha aborta.
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

function Step($what, [scriptblock]$run) {
  Write-Host "== $what"
  & $run
  if ($LASTEXITCODE -ne 0) { throw "falhou: $what (código $LASTEXITCODE)" }
}

if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
  $env:PATH = "C:\Program Files\Go\bin;$env:PATH"
}

if (-not $env:CLAREIA_API_DSN) {
  $file = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.clareia/api-pg.env'
  if (-not (Test-Path $file)) { throw "defina CLAREIA_API_DSN ou crie $file" }
  $cfg = @{}
  Get-Content $file | ForEach-Object { if ($_ -match '^([A-Z_]+)=(.*)$') { $cfg[$Matches[1]] = $Matches[2] } }
  $env:CLAREIA_API_DSN = "postgres://$($cfg['API_PG_OWNER']):$($cfg['API_PG_OWNER_PASSWORD'])@127.0.0.1:$($cfg['API_PG_PORT'])/$($cfg['API_PG_DB'])"
  if (-not $env:CLAREIA_API_RO_PASSWORD) { $env:CLAREIA_API_RO_PASSWORD = $cfg['API_PG_RO_PASSWORD'] }
}

if ($Revoke -or $Rollback) {
  Push-Location (Join-Path $root 'api')
  try {
    if ($Revoke) { Step "revogar $Revoke" { go run ./cmd/load --revoke $Revoke } }
    else { Step 'rollback' { go run ./cmd/load --rollback } }
  } finally { Pop-Location }
  return
}

if (-not $Folder) { throw 'uso: load.ps1 <pasta da publicação> | -Revoke <id> | -Rollback' }
$folder = (Resolve-Path $Folder).Path

Push-Location $root
try {
  Step 'busca de CPF' { npm run scan:cpf -- $folder }
  Step 'cinco recusas' { npx tsx api/scripts/check-publication.ts $folder }
  Push-Location (Join-Path $root 'api')
  try { Step 'carga' { go run ./cmd/load $folder } } finally { Pop-Location }
} finally { Pop-Location }
