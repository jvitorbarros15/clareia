param([Parameter(Mandatory = $true)][string]$Name)
# Turns the stored k6 summaries of one run into the markdown tables of RESULTS.md. Prints to stdout and writes results/<Name>/tables.md.
$ErrorActionPreference = 'Stop'
$dir = Join-Path $PSScriptRoot "results\$Name"
function J($p) { Get-Content $p -Raw | ConvertFrom-Json }
function Med($v) { $s = @($v | Sort-Object); $s[[int][math]::Floor(($s.Count - 1) / 2)] }
function F($x, $d = 1) { ([double]$x).ToString("N$d", [Globalization.CultureInfo]::InvariantCulture) }
function NRuns($d) { @(Get-ChildItem $d -Filter 'run*.json' | ? Name -notlike '*proc*').Count }
function Tri($v, $d = 1) { "$(F (Med $v) $d) ($(F ($v | Measure-Object -Minimum).Minimum $d) to $(F ($v | Measure-Object -Maximum).Maximum $d))" }
$names = @{ static = '(0) static files'; noidx = '(a) API, full-scan cost (no extra indexes)'; idx = '(b) API, with indexes' }
$o = New-Object System.Collections.Generic.List[string]

$o.Add("### Runs per step at the reference rate ($Name): median (min to max), ms")
$o.Add('')
$o.Add('| step | rate | p50 | p95 | p99 | achieved req/s | dropped | error rate | KB/response | server CPU cores | k6 CPU cores |')
$o.Add('|---|---|---|---|---|---|---|---|---|---|---|')
foreach ($s in 'static', 'noidx', 'idx') {
  $d = Join-Path $dir $s
  if (-not (Test-Path $d)) { continue }
  $n = NRuns $d; $r = 1..$n | ForEach-Object { J (Join-Path $d "run$_.json") }
  $pr = 1..$n | ForEach-Object { J (Join-Path $d "run$_.proc.json") }
  $o.Add("| $($names[$s]) | $($r[0].rate)/s | $(Tri ($r | % { $_.latencyMs.p50 }) 2) | $(Tri ($r | % { $_.latencyMs.p95 }) 2) | $(Tri ($r | % { $_.latencyMs.p99 }) 2) | $(Tri ($r | % { $_.rps }) 1) | $(($r | % { $_.dropped }) -join '/') | $(($r | % { F ($_.failedRate * 100) 3 }) -join '/')% | $(F (Med ($r | % { $_.kbPerReq })) 1) | $(Tri ($pr | % { $_.serverCpuCores }) 2) | $(Tri ($pr | % { $_.k6CpuCores }) 2) |")
}

$o.Add('')
$o.Add("### p95 by endpoint at the reference rate, median of 3 runs, ms")
$o.Add('')
$eps = 'profile', 'expenses', 'expenses_worst', 'suppliers_list', 'suppliers_search', 'supplier_detail', 'meta'
$o.Add('| step | ' + ($eps -join ' | ') + ' |')
$o.Add('|---|' + (($eps | % { '---' }) -join '|') + '|')
foreach ($s in 'static', 'noidx', 'idx') {
  $d = Join-Path $dir $s
  if (-not (Test-Path $d)) { continue }
  $n = NRuns $d; $r = 1..$n | ForEach-Object { J (Join-Path $d "run$_.json") }
  $cells = $eps | ForEach-Object { $e = $_; $v = $r | ? { $_.byEndpoint.$e } | % { $_.byEndpoint.$e.p95 }; if ($v -and (Med $v) -gt 0) { F (Med $v) 2 } else { '-' } }
  $o.Add("| $($names[$s]) | $($cells -join ' | ') |")
}

$o.Add('')
$o.Add('### Rate ladder (one run per rung, step x1.5); valid = zero dropped, errors under 0.1%, p99 under 1 s')
foreach ($s in 'static', 'noidx', 'idx') {
  $d = Join-Path $dir $s
  if (-not (Test-Path $d)) { continue }
  $st = J (Join-Path $d 'steps.json')
  $o.Add('')
  $o.Add("**$($names[$s])**: max sustainable rate $($st.maxSustainableRate) req/s")
  $o.Add('')
  $o.Add('| target req/s | achieved req/s | p50 | p95 | p99 | dropped | error rate | valid | server CPU cores | k6 CPU cores |')
  $o.Add('|---|---|---|---|---|---|---|---|---|---|')
  foreach ($rate in @($st.probes)) {
    $r = J (Join-Path $d "probe-$rate.json"); $p = J (Join-Path $d "probe-$rate.proc.json")
    $o.Add("| $rate | $(F $r.rps 1) | $(F $r.latencyMs.p50 2) | $(F $r.latencyMs.p95 2) | $(F $r.latencyMs.p99 2) | $($r.dropped) | $(F ($r.failedRate * 100) 3)% | $(if ($p.exitCode -eq 0) { 'yes' } else { 'no' }) | $($p.serverCpuCores) | $($p.k6CpuCores) |")
  }
}

$ed = Join-Path $dir 'idx\etag1.json'
if (Test-Path $ed) {
  $e = 1..3 | ForEach-Object { J (Join-Path $dir "idx\etag$_.json") }
  $o.Add('')
  $o.Add("### 304 versus 200 latency, same URL, 40 req/s, 20 s each, median (min to max) of 3 runs, ms")
  $o.Add('')
  $o.Add('| endpoint | 200 p50 | 200 p95 | 304 p50 | 304 p95 |')
  $o.Add('|---|---|---|---|---|')
  foreach ($ep in 'profile', 'expenses_worst', 'suppliers_list') {
    $c = foreach ($k in '200', '304') { foreach ($q in 'p50', 'p95') { Tri ($e | % { $_.byEndpoint.$ep.$k.$q }) 2 } }
    $o.Add("| $ep | $($c -join ' | ') |")
  }
  $o.Add("dropped iterations: $(($e | % { $_.dropped }) -join '/')")
}
$o | Set-Content (Join-Path $dir 'tables.md') -Encoding utf8
$o
