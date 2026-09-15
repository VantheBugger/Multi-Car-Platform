[CmdletBinding()]
param([string]$HostName="127.0.0.1",[int]$WebPort=5173,[int]$BridgePort=8788,[string]$MqttHost="127.0.0.1",[int]$MqttPort=1883,[int]$TimeoutSec=3)
$ErrorActionPreference="Continue"
$pass=0; $warn=0; $fail=0
function Info([string]$m){Write-Host "[INFO] $m" -ForegroundColor Cyan}
function Pass([string]$m){$script:pass++;Write-Host "[PASS] $m" -ForegroundColor Green}
function Warn([string]$m){$script:warn++;Write-Host "[WARN] $m" -ForegroundColor Yellow}
function Fail([string]$m){$script:fail++;Write-Host "[FAIL] $m" -ForegroundColor Red}
function CheckFile([string]$p){if(Test-Path -LiteralPath $p){Pass "file: $p"}else{Fail "missing file: $p"}}
function TestTcp([string]$h,[int]$p){try{return [bool](Test-NetConnection -ComputerName $h -Port $p -WarningAction SilentlyContinue).TcpTestSucceeded}catch{return $false}}
$scriptDir=Split-Path -Parent $MyInvocation.MyCommand.Path
$testDir=Split-Path -Parent $scriptDir
Info "Cloud diagnostics (read-only)"
Info "test directory: $testDir"
@(
 (Join-Path $testDir "package.json"),
 (Join-Path $testDir "scripts\run-cloud-real.ps1"),
 (Join-Path $testDir "scripts\run-cloud-real.cmd"),
 (Join-Path $testDir "scripts\mqtt-bridge.js"),
 (Join-Path $testDir "src\pages\FleetMonitor.jsx"),
 (Join-Path $testDir "src\utils\roadGraphPlanner.js")
)|ForEach-Object{CheckFile $_}
foreach($exe in @("node.exe","npm.cmd")){if(Get-Command $exe -ErrorAction SilentlyContinue){$v=(&$exe --version 2>$null|Select-Object -First 1);Pass "$exe available ($v)"}else{Fail "$exe not found in PATH"}}
$procs=@(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue)
if($procs.Count -eq 0){Warn "no node.exe process found"}else{$procs|ForEach-Object{Info ("PID {0}: {1}" -f $_.ProcessId,$_.CommandLine)};if($procs|Where-Object{$_.CommandLine -match "mqtt-bridge|run-cloud-real"}){Pass "cloud node process detected"}else{Warn "cloud command line was not detected"}}
foreach($p in @($WebPort,$BridgePort,$MqttPort)){$listeners=@(Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue);if($listeners.Count -gt 0){Pass "TCP listener on $p"}else{Warn "no local TCP listener on $p"}}
try{$r=Invoke-WebRequest -UseBasicParsing -Uri ("http://{0}:{1}/" -f $HostName,$WebPort) -TimeoutSec $TimeoutSec;Pass "web endpoint returned HTTP $($r.StatusCode)"}catch{Warn "web endpoint check failed: $($_.Exception.Message)"}
try{$r=Invoke-WebRequest -UseBasicParsing -Uri ("http://{0}:{1}/health" -f $HostName,$BridgePort) -TimeoutSec $TimeoutSec;Pass "MQTT bridge health HTTP $($r.StatusCode): $($r.Content)"}catch{Warn "MQTT bridge health check failed: $($_.Exception.Message)"}
if(TestTcp $MqttHost $MqttPort){Pass "MQTT TCP reachable at ${MqttHost}:$MqttPort"}else{Warn "MQTT TCP not reachable at ${MqttHost}:$MqttPort"}
$fm=Join-Path $testDir "src\pages\FleetMonitor.jsx"
$planner=Join-Path $testDir "src\utils\roadGraphPlanner.js"
if(Test-Path -LiteralPath $fm){$t=Get-Content -Raw -LiteralPath $fm;foreach($n in @("cancelVehicleMission","cancel_ack","vehicles/+/cancel","segment_encoding","top_level_index_v1","ros_path_speed_z_v2")){if($t.Contains($n)){Pass "frontend contains $n"}else{Fail "frontend missing $n"}}}
if(Test-Path -LiteralPath $planner){$pt=Get-Content -Raw -LiteralPath $planner;if($pt.Contains("graph_turn_v1")){Pass "planner contains graph_turn_v1"}else{Fail "planner missing graph_turn_v1"}}else{Fail "missing planner: $planner"}
if(Test-Path -LiteralPath (Join-Path $testDir "dist\index.html")){Pass "built frontend exists: dist\index.html"}else{Warn "dist/index.html not found; run npm run build before deployment"}
Write-Host ""
Write-Host ("SUMMARY PASS={0} WARN={1} FAIL={2}" -f $pass,$warn,$fail)
if($fail -gt 0){exit 1}else{exit 0}
