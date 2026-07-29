[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet('start', 'stop', 'restart', 'status', 'logs')]
  [string]$Action = 'start'
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function Env-Or {
  param([string]$Name, [string]$Default)
  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) { return $Default }
  return $value
}

function As-Bool {
  param([string]$Value)
  switch ($Value.Trim().ToLowerInvariant()) {
    '1' { return $true }
    'true' { return $true }
    'yes' { return $true }
    'on' { return $true }
    '0' { return $false }
    'false' { return $false }
    'no' { return $false }
    'off' { return $false }
    default { throw "invalid boolean: $Value" }
  }
}

function Log { param([string]$Message) Write-Host "[cloud-native] $Message" }

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir
$Runtime = Join-Path $Root '.runtime\real-cloud-windows'
$Logs = Join-Path $Runtime 'logs'
$Pids = Join-Path $Runtime 'pids'
New-Item -ItemType Directory -Force -Path $Logs, $Pids | Out-Null

$UseLocalMqtt = As-Bool (Env-Or 'USE_LOCAL_MQTT' 'true')
$MqttHost = Env-Or 'MQTT_HOST' '127.0.0.1'
$MqttPort = [int](Env-Or 'MQTT_PORT' '1883')
$MqttUrl = Env-Or 'MQTT_URL' "mqtt://${MqttHost}:$MqttPort"
$ProtocolDefault = if ($UseLocalMqtt) { '4' } else { '5' }
$MqttProtocolVersion = [int](Env-Or 'MQTT_PROTOCOL_VERSION' $ProtocolDefault)
$WebPort = [int](Env-Or 'WEB_PORT' '5173')
$WebUrl = Env-Or 'WEB_URL' "http://127.0.0.1:$WebPort"
$BridgePort = [int](Env-Or 'BRIDGE_PORT' '8788')
$BridgeHost = Env-Or 'BRIDGE_HOST' '0.0.0.0'
$BridgeHealth = Env-Or 'BRIDGE_HEALTH_URL' "http://127.0.0.1:$BridgePort/health"
$BridgeToken = Env-Or 'BRIDGE_TOKEN' ''
$VehicleRosVersion = (Env-Or 'VEHICLE_ROS_VERSION' 'ros1').ToLowerInvariant()
if ($VehicleRosVersion -eq '1') { $VehicleRosVersion = 'ros1' }
if ($VehicleRosVersion -eq '2') { $VehicleRosVersion = 'ros2' }
if ($VehicleRosVersion -notin @('ros1', 'ros2')) { throw "VEHICLE_ROS_VERSION must be ros1 or ros2" }

$NodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if ($null -eq $NodeCommand) { throw 'node.exe not found; install Node.js LTS for Windows' }
$NodeExe = $NodeCommand.Source

$WebOut = Join-Path $Logs 'web.log'
$WebErr = Join-Path $Logs 'web.err.log'
$BridgeOut = Join-Path $Logs 'bridge.log'
$BridgeErr = Join-Path $Logs 'bridge.err.log'
$MqttOut = Join-Path $Logs 'mqtt.log'
$MqttErr = Join-Path $Logs 'mqtt.err.log'

function Pid-File { param([string]$Name) return (Join-Path $Pids "$Name.pid") }

function Save-Pid {
  param([string]$Name, [int]$ProcessId)
  Set-Content -LiteralPath (Pid-File $Name) -Value $ProcessId -Encoding ASCII
}

function Read-Pid {
  param([string]$Name)
  $file = Pid-File $Name
  if (-not (Test-Path -LiteralPath $file)) { return $null }
  $text = Get-Content -LiteralPath $file -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($text -match '^\d+$') { return [int]$text }
  return $null
}

function Stop-Owned {
  param([string]$Name, [string]$Marker)
  $processId = Read-Pid $Name
  if ($null -eq $processId) { return }
  $info = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
  if ($null -eq $info) {
    Remove-Item -LiteralPath (Pid-File $Name) -Force -ErrorAction SilentlyContinue
    return
  }
  if ([string]::IsNullOrEmpty($info.CommandLine) -or $info.CommandLine.IndexOf($Marker, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
    Write-Host "[cloud-native][warn] stale $Name pid=$processId was not stopped" -ForegroundColor Yellow
    Remove-Item -LiteralPath (Pid-File $Name) -Force -ErrorAction SilentlyContinue
    return
  }
  Log "stopping $Name pid=$processId"
  Stop-Process -Id $processId -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 400
  if (Get-Process -Id $processId -ErrorAction SilentlyContinue) { Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue }
  Remove-Item -LiteralPath (Pid-File $Name) -Force -ErrorAction SilentlyContinue
}

function Tcp-Ready {
  param([string]$HostName, [int]$Port, [int]$Timeout = 1500)
  $client = New-Object Net.Sockets.TcpClient
  try {
    $pending = $client.BeginConnect($HostName, $Port, $null, $null)
    if (-not $pending.AsyncWaitHandle.WaitOne($Timeout, $false)) { return $false }
    $client.EndConnect($pending)
    return $true
  } catch { return $false } finally { $client.Close() }
}

function Web-Ready {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $WebUrl -TimeoutSec 2
    return $response.StatusCode -eq 200 -and $response.Content.Contains('/src/main.jsx')
  } catch { return $false }
}

function Bridge-Health {
  try { return Invoke-RestMethod -Uri $BridgeHealth -TimeoutSec 2 } catch { return $null }
}

function Bridge-Ready {
  $health = Bridge-Health
  return $null -ne $health -and $health.ok -eq $true -and $health.mqttConnected -eq $true -and $health.mqttUrl -eq $MqttUrl -and $health.vehicleRosVersion -eq $VehicleRosVersion
}

function Wait-Ready {
  param([scriptblock]$Check, [int]$Seconds, [string]$Name)
  $until = [DateTime]::UtcNow.AddSeconds($Seconds)
  while ([DateTime]::UtcNow -lt $until) {
    if (& $Check) { return }
    Start-Sleep -Milliseconds 500
  }
  throw "timeout waiting for $Name"
}

function Reset-Logs { param([string[]]$Files) foreach ($file in $Files) { Set-Content -LiteralPath $file -Value '' -Encoding UTF8 } }

function Start-Mqtt {
  if (Tcp-Ready $MqttHost $MqttPort) { Log "MQTT already reachable at ${MqttHost}:$MqttPort"; return }
  $entry = Join-Path $Root 'scripts\windows-mqtt-broker.js'
  if (-not (Test-Path -LiteralPath $entry)) { throw "missing $entry" }
  Reset-Logs @($MqttOut, $MqttErr)
  Log "starting Windows-native MQTT broker at ${MqttHost}:$MqttPort"
  $process = Start-Process -FilePath $NodeExe -ArgumentList @($entry, '--host=0.0.0.0', "--port=$MqttPort") -WorkingDirectory $Root -RedirectStandardOutput $MqttOut -RedirectStandardError $MqttErr -WindowStyle Hidden -PassThru
  Save-Pid 'mqtt' $process.Id
  Wait-Ready { Tcp-Ready $MqttHost $MqttPort } 20 'MQTT broker'
}

function Start-Web {
  if (Web-Ready) { Log "web already ready: $WebUrl"; return }
  if (Tcp-Ready '127.0.0.1' $WebPort) { throw "port $WebPort is occupied" }
  $entry = Join-Path $Root 'node_modules\vite\bin\vite.js'
  if (-not (Test-Path -LiteralPath $entry)) { throw "run npm ci first: $Root" }
  Reset-Logs @($WebOut, $WebErr)
  Log 'starting Windows-native Vite server'
  $process = Start-Process -FilePath $NodeExe -ArgumentList @($entry, '--host', '0.0.0.0', '--port', "$WebPort", '--strictPort') -WorkingDirectory $Root -RedirectStandardOutput $WebOut -RedirectStandardError $WebErr -WindowStyle Hidden -PassThru
  Save-Pid 'web' $process.Id
  Wait-Ready { Web-Ready } 60 'web server'
}

function Start-Bridge {
  if (Bridge-Ready) { Log "bridge already healthy -> $MqttUrl"; return }
  Stop-Owned 'bridge' 'mqtt-bridge.js'
  if (Tcp-Ready '127.0.0.1' $BridgePort) { throw "port $BridgePort is occupied" }
  $entry = Join-Path $Root 'scripts\mqtt-bridge.js'
  $args = @($entry, "--mqtt=$MqttUrl", "--host=$BridgeHost", "--port=$BridgePort", "--protocol-version=$MqttProtocolVersion", '--sim-backend=none', "--vehicle-ros-version=$VehicleRosVersion")
  if ($BridgeToken) { $args += "--bridge-token=$BridgeToken" }
  Reset-Logs @($BridgeOut, $BridgeErr)
  Log "starting Windows-native bridge -> $MqttUrl (MQTT protocol $MqttProtocolVersion)"
  $process = Start-Process -FilePath $NodeExe -ArgumentList $args -WorkingDirectory $Root -RedirectStandardOutput $BridgeOut -RedirectStandardError $BridgeErr -WindowStyle Hidden -PassThru
  Save-Pid 'bridge' $process.Id
  Wait-Ready { Bridge-Ready } 60 'bridge'
}

function Stop-All {
  Stop-Owned 'bridge' 'mqtt-bridge.js'
  Stop-Owned 'web' 'vite.js'
  Stop-Owned 'mqtt' 'windows-mqtt-broker.js'
}

function Log-Hints {
  Log "logs: $Logs"
}

function Start-All {
  if (-not (Test-Path -LiteralPath (Join-Path $Root 'node_modules'))) { throw "run npm ci first: $Root" }
  if ($UseLocalMqtt) { Start-Mqtt } elseif (-not (Tcp-Ready $MqttHost $MqttPort 3000)) { throw "external MQTT unreachable: ${MqttHost}:$MqttPort" }
  Start-Web
  Start-Bridge
  Log 'all native Windows services are ready'
  Log "URLs: $WebUrl  ws://127.0.0.1:$BridgePort/bridge"
  Log-Hints
}

function Status-All {
  $web = if (Web-Ready) { 'ready' } else { 'down' }
  $bridge = if (Bridge-Ready) { 'healthy' } else { 'down' }
  $mqtt = if (Tcp-Ready $MqttHost $MqttPort) { 'ready' } else { 'down' }
  Write-Host "vehicle:  $VehicleRosVersion"
  Write-Host "web:      $web"
  Write-Host "bridge:   $bridge"
  Write-Host "mqtt:     $mqtt ($MqttUrl)"
  Log-Hints
}

function Show-Logs {
  foreach ($file in @($WebOut, $WebErr, $BridgeOut, $BridgeErr, $MqttOut, $MqttErr)) {
    if (Test-Path -LiteralPath $file) { Write-Host "`n===== $file ====="; Get-Content -LiteralPath $file -Tail 80 }
  }
}

try {
  switch ($Action) {
    'start' { Start-All }
    'stop' { Stop-All }
    'restart' { Stop-All; Start-All }
    'status' { Status-All }
    'logs' { Show-Logs }
  }
} catch {
  Write-Host "[cloud-native][error] $($_.Exception.Message)" -ForegroundColor Red
  Log-Hints
  exit 1
}

