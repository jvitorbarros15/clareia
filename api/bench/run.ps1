param(
  [Parameter(Mandatory = $true)][string]$Name,
  [Parameter(Mandatory = $true)][string]$StaticData,
  [int]$RefRate = 100,
  [int]$WarmSecs = 20,
  [int]$RunSecs = 90,
  [int]$Runs = 5,
  [int]$ProbeSecs = 20,
  [int]$StartProbe = 50,
  [int]$MaxProbe = 12000,
  [string[]]$Steps = @('static', 'noidx', 'idx'),
  [int]$Seed = 20261118
)
# Reproduces the whole benchmark: env record, fixture, static baseline, API without extra indexes, API with indexes, 304 vs 200, EXPLAIN.
# Credentials come only from ~/.clareia/api-pg.env, live only in this process and are never printed or written.
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$api = Split-Path $here -Parent
$k6 = 'C:\Program Files\k6\k6.exe'
if (-not (Get-Command go -ErrorAction SilentlyContinue)) { $env:PATH += ';C:\Program Files\Go\bin' }
$out = Join-Path $here "results\$Name"
$tmp = Join-Path $here 'out'
New-Item -ItemType Directory -Force $out, $tmp, (Join-Path $here 'bin') | Out-Null
$container = 'clareia-api-pg'
$benchDb = 'clareia_api_bench_noidx'
$apiPort = 8787
$staticPort = 8788

$cfg = @{}
Get-Content (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.clareia/api-pg.env') | ForEach-Object { if ($_ -match '^([A-Z_]+)=(.*)$') { $cfg[$Matches[1]] = $Matches[2] } }
$realDb = $cfg['API_PG_DB']
if ($realDb -eq $benchDb) { throw "API_PG_DB não pode ser ${benchDb}: esse banco é apagado e recriado pelo passo (a)" }
foreach ($p in $apiPort, $staticPort) {
  $c = New-Object Net.Sockets.TcpClient
  try { $c.Connect('127.0.0.1', $p); throw "a porta $p já está em uso: o benchmark mediria outro servidor" } catch [Net.Sockets.SocketException] { } finally { $c.Close() }
}
$env:PGPASSWORD = $cfg['API_PG_OWNER_PASSWORD']
function Esc($s) { [uri]::EscapeDataString($s) }
function RoDsn($db) { "postgres://clareia_api_ro:$(Esc $cfg['API_PG_RO_PASSWORD'])@127.0.0.1:$($cfg['API_PG_PORT'])/$db" }

function Psql([string]$db, [string[]]$a) {
  $r = docker exec -e PGPASSWORD $container psql -U $cfg['API_PG_OWNER'] -d $db -v ON_ERROR_STOP=1 @a
  if ($LASTEXITCODE -ne 0) { throw "psql falhou em $db" }
  $r
}
function PsqlFile([string]$db, [string]$file, [string]$dest) {
  docker cp $file "${container}:/tmp/$dest" | Out-Null
  Psql $db @('-f', "/tmp/$dest")
}

$commit = (git -c safe.directory=* -C $api rev-parse --short HEAD).Trim()
$dirty = [bool](git -c safe.directory=* -C $api status --porcelain -- . | Where-Object { $_ -notmatch 'bench/results|bench\\results' })

# 1. environment
$os = Get-CimInstance Win32_OperatingSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$cs = Get-CimInstance Win32_ComputerSystem
$disk = try { Get-PhysicalDisk | Select-Object FriendlyName, MediaType, BusType, @{n = 'SizeGB'; e = { [math]::Round($_.Size / 1GB) } } } catch { 'unknown' }
$bat = try { Get-CimInstance Win32_Battery | Select-Object -First 1 BatteryStatus, EstimatedChargeRemaining } catch { $null }
$wsl = try { (wsl --version | Out-String) -replace "`0", '' } catch { 'unknown' }
$pub = (Psql $realDb @('-Atc', 'select folder_id from api.publication')).Trim()
$env_ = [ordered]@{
  commit = $commit; dirtyWorktree = $dirty; publication = $pub
  go = (go version); k6 = ((& $k6 version) -join ' ')
  postgres = (Psql $realDb @('-Atc', 'show server_version')).Trim()
  cpu = $cpu.Name.Trim(); physicalCores = $cpu.NumberOfCores; logicalProcessors = $cpu.NumberOfLogicalProcessors
  ramGB = [math]::Round($cs.TotalPhysicalMemory / 1GB, 1); disk = $disk
  windows = "$($os.Caption) $($os.Version)"
  docker = (docker version --format 'client {{.Client.Version}} / server {{.Server.Version}}')
  wsl = ($wsl.Trim())
  powerPlan = ((powercfg /getactivescheme) -join ' ')
  battery = $bat
  startedAt = (Get-Date).ToString('s')
}
$env_ | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $out 'env.json') -Encoding utf8

# 2. fixture (ids, worst case, supplier keys, labels, search terms; all from the active publication)
PsqlFile $realDb (Join-Path $here 'fixture.sql') 'fixture.sql' | Out-Null
$fixture = Join-Path $tmp 'fixture.json'
docker cp "${container}:/tmp/fixture.json" $fixture | Out-Null
$fx = Get-Content $fixture -Raw -Encoding utf8 | ConvertFrom-Json
if ($fx.pub -ne $pub) { throw 'fixture de outra publicação' }
$fixtureNote = [ordered]@{ deputies = $fx.deputies.Count; worstDeputy = $fx.worst.id; worstRecords = $fx.worst.n; supplierKeys = $fx.keys.Count; labels = $fx.labels.Count; terms = $fx.terms.Count; seed = $Seed }
$fixtureNote | ConvertTo-Json | Set-Content (Join-Path $out 'fixture.json') -Encoding utf8

# 3. binaries
Push-Location $api
try {
  go build -ldflags "-X main.version=bench-$commit" -o (Join-Path $here 'bin\server.exe') ./cmd/server
  if ($LASTEXITCODE -ne 0) { throw 'build do servidor falhou' }
  go build -o (Join-Path $here 'bin\static.exe') ./bench/static
  if ($LASTEXITCODE -ne 0) { throw 'build do estático falhou' }
} finally { Pop-Location }

# 4. benchmark database without the extra indexes: a copy of the real one; the real database is never altered
function Setup-NoIdx {
  $busy = Psql $realDb @('-Atc', "select count(*) from pg_stat_activity where datname = '$realDb' and pid <> pg_backend_pid()")
  if ([int]$busy -ne 0) { throw "há conexões em $realDb; o CREATE DATABASE ... TEMPLATE precisa dela livre" }
  Psql 'postgres' @('-c', "DROP DATABASE IF EXISTS $benchDb") | Out-Null
  Psql 'postgres' @('-c', "CREATE DATABASE $benchDb TEMPLATE $realDb") | Out-Null
  $sch = "pub_$pub"
  $sql = @"
DO `$`$ DECLARE r record; BEGIN
  FOR r IN SELECT conrelid::regclass::text AS t, conname FROM pg_constraint WHERE contype IN ('p','u') AND connamespace = '$sch'::regnamespace
           AND conrelid::regclass::text IN ('$sch.expenses','$sch.supplier_cells','$sch.deputy_months','$sch.deputy_categories','$sch.suppliers') LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.t, r.conname);
  END LOOP;
  FOR r IN SELECT schemaname, indexname FROM pg_indexes WHERE schemaname = '$sch' AND tablename IN ('expenses','supplier_cells','deputy_months','deputy_categories','suppliers') LOOP
    EXECUTE format('DROP INDEX %I.%I', r.schemaname, r.indexname);
  END LOOP;
END `$`$;
ANALYZE;
"@
  $f = Join-Path $tmp 'noidx.sql'
  Set-Content $f $sql -Encoding utf8
  PsqlFile $benchDb $f 'noidx.sql' | Out-Null
  $left = Psql $benchDb @('-Atc', "select tablename || '.' || indexname from pg_indexes where schemaname = '$sch' order by 1")
  $left | Set-Content (Join-Path $out 'noidx-remaining-indexes.txt') -Encoding utf8
}

# 5. process helpers
function Start-Proc($exe, $argv, $log) {
  $a = @{ FilePath = $exe; PassThru = $true; WindowStyle = "Hidden"; RedirectStandardOutput = "$log.out"; RedirectStandardError = "$log.err" }
  if ($argv) { $a.ArgumentList = $argv }
  Start-Process @a
}
function Wait-Http($url) {
  for ($i = 0; $i -lt 60; $i++) {
    try { $r = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 2; if ($r.StatusCode -eq 200) { return } } catch { Start-Sleep -Milliseconds 500 }
  }
  throw "sem resposta em $url"
}

function Run-K6([string]$script, [string[]]$kv, [string]$name, [string]$dir, $svc, [int]$secs) {
  $json = Join-Path $dir "$name.json"
  $argv = @('run', '--quiet', '--no-usage-report') + ($kv | ForEach-Object { @('-e', $_) }) + @('-e', "OUT=$($json -replace '\\','/')", (Join-Path $here $script))
  $svcCpu0 = if ($svc) { (Get-Process -Id $svc.Id).TotalProcessorTime.TotalSeconds } else { 0 }
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $p = Start-Process -FilePath $k6 -ArgumentList $argv -PassThru -NoNewWindow -RedirectStandardOutput (Join-Path $tmp "$name.k6.log") -RedirectStandardError (Join-Path $tmp "$name.k6.err")
  $null = $p.Handle
  $pgCpu = $null
  if ($secs -ge 10) {
    Start-Sleep -Seconds ([int]($secs / 2))
    $pgCpu = try { (docker stats --no-stream --format '{{.CPUPerc}}' $container).Trim() } catch { $null }
  }
  $p.WaitForExit()
  $wall = $sw.Elapsed.TotalSeconds
  $svcCpu1 = if ($svc) { (Get-Process -Id $svc.Id).TotalProcessorTime.TotalSeconds } else { 0 }
  $proc = [ordered]@{ exitCode = $p.ExitCode; wallS = [math]::Round($wall, 1); k6CpuCores = [math]::Round($p.TotalProcessorTime.TotalSeconds / $wall, 2); serverCpuCores = [math]::Round(($svcCpu1 - $svcCpu0) / $wall, 2); postgresContainerCpuPctMidRun = $pgCpu }
  $proc | ConvertTo-Json | Set-Content (Join-Path $dir "$name.proc.json") -Encoding utf8
  if (-not (Test-Path $json)) { throw "k6 não gerou $json (código $($p.ExitCode)); veja $tmp\$name.k6.err" }
  $proc
}

function Run-Step([string]$step) {
  $dir = Join-Path $out $step
  New-Item -ItemType Directory -Force $dir | Out-Null
  Get-ChildItem $dir -File | Remove-Item -Force
  $svc = $null
  $env:CLAREIA_API_RO_DSN = $null
  if ($step -eq 'static') {
    $svc = Start-Proc (Join-Path $here 'bin\static.exe') @("`"$StaticData`"", $staticPort) (Join-Path $tmp 'static')
    $base = "http://127.0.0.1:$staticPort"; $target = 'static'
    Wait-Http "$base/index.json"
  } else {
    $db = if ($step -eq 'noidx') { $benchDb } else { $realDb }
    $env:CLAREIA_API_RO_DSN = RoDsn $db
    $env:CLAREIA_API_PORT = "$apiPort"
    $svc = Start-Proc (Join-Path $here 'bin\server.exe') @() (Join-Path $tmp "server-$step")
    $env:CLAREIA_API_RO_DSN = $null
    $base = "http://127.0.0.1:$apiPort"; $target = 'api'
    Wait-Http "$base/healthz"
  }
  try {
    $common = @("BASE=$base", "TARGET=$target", "FIXTURE=$($fixture -replace '\\','/')", "SEED=$Seed")
    $log = [ordered]@{ step = $step; refRate = $RefRate; warmSecs = $WarmSecs; runSecs = $RunSecs; probeSecs = $ProbeSecs; runs = @(); runCount = $Runs; probes = @() }
    Write-Host "[$step] warm-up ${WarmSecs}s @ $RefRate/s"
    $null = Run-K6 'mix.js' ($common + @("RATE=$RefRate", "DURATION=${WarmSecs}s")) 'warmup' $dir $svc $WarmSecs
    foreach ($i in 1..$Runs) {
      Write-Host "[$step] run $i ${RunSecs}s @ $RefRate/s"
      $p = Run-K6 'mix.js' ($common + @("RATE=$RefRate", "DURATION=${RunSecs}s")) "run$i" $dir $svc $RunSecs
      $log.runs += "run$i"
    }
    $rate = $StartProbe
    $best = 0
    while ($rate -le $MaxProbe) {
      Write-Host "[$step] probe ${ProbeSecs}s @ $rate/s"
      $p = Run-K6 'mix.js' ($common + @("RATE=$rate", "DURATION=${ProbeSecs}s")) "probe-$rate" $dir $svc $ProbeSecs
      $log.probes += $rate
      if ($p.exitCode -ne 0) { break }
      $best = $rate
      $rate = [int][math]::Round($rate * 1.5)
    }
    $log.maxSustainableRate = $best
    if ($step -eq 'idx') {
      foreach ($i in 1..3) {
        Write-Host "[$step] etag 304 vs 200 run $i"
        $null = Run-K6 'etag.js' @("BASE=$base", "FIXTURE=$($fixture -replace '\\','/')", 'RATE=40', 'DUR=20') "etag$i" $dir $svc 46
      }
    }
    $log | ConvertTo-Json | Set-Content (Join-Path $dir 'steps.json') -Encoding utf8
  } finally {
    if ($svc -and -not $svc.HasExited) { Stop-Process -Id $svc.Id -Force }
  }
}

# 6. EXPLAIN (ANALYZE, BUFFERS): run twice per database, keep the second (warm cache)
function Explain([string]$db, [string]$file) {
  $f = Join-Path $here 'explain.sql'
  docker cp $f "${container}:/tmp/explain.sql" | Out-Null
  $null = Psql $db @('-f', '/tmp/explain.sql')
  (Psql $db @('-f', '/tmp/explain.sql')) | Set-Content (Join-Path $out $file) -Encoding utf8
}

try {
  if ($Steps -contains 'noidx') { Setup-NoIdx }
  foreach ($s in $Steps) { Run-Step $s }
  Write-Host 'EXPLAIN'
  Explain $realDb 'explain-with-indexes.txt'
  if ($Steps -contains 'noidx') { Explain $benchDb 'explain-without-extra-indexes.txt' }
  $env_.finishedAt = (Get-Date).ToString('s')
  $env_ | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $out 'env.json') -Encoding utf8
} finally {
  $env:PGPASSWORD = $null
  $env:CLAREIA_API_RO_DSN = $null
  if ($Steps -contains 'noidx') { try { $env:PGPASSWORD = $cfg['API_PG_OWNER_PASSWORD']; Psql 'postgres' @('-c', "DROP DATABASE IF EXISTS $benchDb") | Out-Null } catch { Write-Warning "não removeu $benchDb" } finally { $env:PGPASSWORD = $null } }
  Get-Process -Name server, static -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$here*" } | Stop-Process -Force
}
Write-Host "pronto: $out"
