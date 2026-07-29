import http from 'node:http';
import { spawn } from 'node:child_process';
import mqtt from 'mqtt';
import { WebSocketServer } from 'ws';
import { URL } from 'node:url';

function readArg(name, fallback) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];

  return fallback;
}

const mqttUrl = readArg('mqtt', process.env.MQTT_URL || 'mqtt://192.168.8.102:1883');
const topicText = readArg('topic', process.env.MQTT_TOPIC || 'vehicles/+,vehicle/+,vehicles/+/goal,vehicles/+/path,vehicles/+/cancel,vehicles/+/goal_ack,vehicles/+/path_ack,vehicles/+/cancel_ack');
const topics = topicText
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const port = Number(readArg('port', process.env.BRIDGE_PORT || 8788));
const host = readArg('host', process.env.BRIDGE_HOST || '0.0.0.0');
const username = readArg('username', process.env.MQTT_USERNAME || '');
const password = readArg('password', process.env.MQTT_PASSWORD || '');
const clientId = readArg('client-id', process.env.MQTT_CLIENT_ID || `fleet_bridge_${Math.random().toString(16).slice(2, 10)}`);
const protocolVersion = Number(readArg('protocol-version', process.env.MQTT_PROTOCOL_VERSION || 5));
const connectTimeout = Number(readArg('connect-timeout', process.env.MQTT_CONNECT_TIMEOUT || 15000));
const keepalive = Number(readArg('keepalive', process.env.MQTT_KEEPALIVE || 30));
const bridgeToken = readArg('bridge-token', process.env.BRIDGE_TOKEN || '');
const vehicleRosVersion = readArg('vehicle-ros-version', process.env.VEHICLE_ROS_VERSION || 'ros1');
if (!['ros1', 'ros2'].includes(vehicleRosVersion)) {
  console.error(`[bridge] Unsupported vehicle ROS version: ${vehicleRosVersion}`);
  process.exit(1);
}
const simBackend = readArg('sim-backend', process.env.SIM_BACKEND || 'gazebo');
const simWorkspace = readArg('sim-workspace', process.env.SIM_WORKSPACE || '/home/van/real2sim0702');
const simLaunch = readArg('sim-launch', process.env.SIM_LAUNCH || 'launch/run_task_manager_sim.launch');
const simRosSetup = readArg('ros-setup', process.env.SIM_ROS_SETUP || '/opt/ros/noetic/setup.bash');
const simDockerRunner = readArg('sim-docker-runner', process.env.SIM_DOCKER_RUNNER || '/home/van/platformm_wang/多车云端调度/test/scripts/gazebo-container-run.sh');
const simMapId = readArg('sim-map-id', process.env.SIM_MAP_ID || '1');
const simRunEnable = readArg('sim-run-enable', process.env.SIM_RUN_ENABLE || 'true');
const parsedMqttUrl = new URL(mqttUrl);
const simMqttHost = readArg('sim-mqtt-host', process.env.SIM_MQTT_HOST || parsedMqttUrl.hostname || '127.0.0.1');
const simMqttPort = readArg('sim-mqtt-port', process.env.SIM_MQTT_PORT || parsedMqttUrl.port || '1883');
const simRobotId = readArg('sim-robot-id', process.env.SIM_ROBOT_ID || 'robot_0');
const simGui = readArg('sim-gui', process.env.SIM_GUI || 'false');
const simPhysicsRate = readArg('sim-physics-rate', process.env.SIM_PHYSICS_RATE || '100');

let simProcess = null;
let simActive = false;

const server = http.createServer((req, res) => {
  if (req.url?.startsWith('/health')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      mqttConnected: mqttClient.connected,
      mqttUrl,
      topics,
      tokenRequired: Boolean(bridgeToken),
      vehicleRosVersion,
    }));
    return;
  }

  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server, path: '/bridge' });

server.on('error', (error) => {
  console.error(`[bridge] HTTP/WebSocket server error: ${error.message}`);
  process.exit(1);
});

wss.on('error', (error) => {
  console.error(`[bridge] WebSocket server error: ${error.message}`);
});

const mqttClient = mqtt.connect(mqttUrl, {
  clean: true,
  clientId,
  protocolVersion,
  connectTimeout,
  keepalive,
  reconnectPeriod: 2000,
  ...(username ? { username } : {}),
  ...(password ? { password } : {}),
});

function sendJson(ws, data) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcast(data) {
  const message = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(message);
    }
  });
}

function simStatus(extra = {}) {
  return {
    type: 'sim_status',
    backend: simBackend,
    active: simActive,
    workspace: simWorkspace,
    launch: simLaunch,
    rosSetup: simRosSetup,
    dockerRunner: simDockerRunner,
    robotId: simRobotId,
    gui: simGui,
    physicsRate: simPhysicsRate,
    mqttHost: simMqttHost,
    mqttPort: simMqttPort,
    vehicleRosVersion,
    ...extra,
  };
}

function buildGazeboLaunchCommand(command = {}) {
  const mapId = command.mapId || simMapId;
  const runEnable = command.runEnable ?? simRunEnable;
  const robotId = command.vehicleId || simRobotId;

  return [
    'set -e',
    `[ -f "${simRosSetup}" ] || { echo "ROS setup not found: ${simRosSetup}"; exit 1; }`,
    `source "${simRosSetup}"`,
    `cd "${simWorkspace}"`,
    '[ ! -f devel/setup.bash ] || source devel/setup.bash',
    `roslaunch "${simLaunch}" map_id:="${mapId}" run_enable:="${runEnable}" robot_id:="${robotId}" mqtt_host:="${simMqttHost}" mqtt_port:="${simMqttPort}"`,
  ].join(' && ');
}

function startGazeboSimulation(command = {}) {
  if (simActive && simProcess) {
    return simStatus({ alreadyRunning: true });
  }

  const launchCommand = buildGazeboLaunchCommand(command);
  console.log(`[bridge] Starting Gazebo simulation: ${launchCommand}`);
  simProcess = spawn('bash', ['-lc', launchCommand], {
    cwd: simWorkspace,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  simActive = true;

  simProcess.stdout.on('data', (chunk) => {
    process.stdout.write(`[gazebo-sim] ${chunk}`);
  });

  simProcess.stderr.on('data', (chunk) => {
    process.stderr.write(`[gazebo-sim] ${chunk}`);
  });

  simProcess.on('exit', (code, signal) => {
    console.log(`[bridge] Gazebo simulation exited: code=${code} signal=${signal}`);
    simActive = false;
    simProcess = null;
    broadcast(simStatus({ exitCode: code, signal }));
  });

  return simStatus({ started: true });
}

function buildGazeboDockerCommand(command = {}) {
  const mapId = command.mapId || simMapId;
  const runEnable = command.runEnable ?? simRunEnable;
  const robotId = command.vehicleId || simRobotId;

  return [
    'bash',
    simDockerRunner,
    '--workspace', simWorkspace,
    '--launch', simLaunch,
    '--robot-id', robotId,
    '--mqtt-host', simMqttHost,
    '--mqtt-port', String(simMqttPort),
    '--map-id', String(mapId),
    '--run-enable', String(runEnable),
    '--gui', String(simGui),
    '--physics-rate', String(simPhysicsRate),
  ];
}

function startGazeboDockerSimulation(command = {}) {
  if (simActive && simProcess) {
    return simStatus({ alreadyRunning: true });
  }

  const [binary, ...args] = buildGazeboDockerCommand(command);
  console.log(`[bridge] Starting Gazebo Docker simulation: ${binary} ${args.join(' ')}`);
  simProcess = spawn(binary, args, {
    cwd: '/home/van/platformm_wang',
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  simActive = true;

  simProcess.stdout.on('data', (chunk) => {
    process.stdout.write(`[gazebo-docker] ${chunk}`);
  });

  simProcess.stderr.on('data', (chunk) => {
    process.stderr.write(`[gazebo-docker] ${chunk}`);
  });

  simProcess.on('exit', (code, signal) => {
    console.log(`[bridge] Gazebo Docker simulation exited: code=${code} signal=${signal}`);
    simActive = false;
    simProcess = null;
    broadcast(simStatus({ exitCode: code, signal }));
  });

  return simStatus({ started: true });
}

function stopGazeboSimulation() {
  if (!simProcess) {
    simActive = false;
    return simStatus({ alreadyStopped: true });
  }

  const pid = simProcess.pid;
  console.log(`[bridge] Stopping Gazebo simulation pid=${pid}`);
  try {
    process.kill(-pid, 'SIGINT');
  } catch (error) {
    console.error(`[bridge] Failed to stop Gazebo simulation pid=${pid}: ${error.message}`);
    try {
      simProcess.kill('SIGINT');
    } catch {
      // Process may have already exited.
    }
  }

  return simStatus({ stopping: true });
}

function handleBridgeCommand(ws, data) {
  if (data.type === 'sim_start') {
    if (simBackend === 'gazebo') {
      const status = startGazeboSimulation(data);
      broadcast(status);
      return true;
    }

    if (simBackend === 'gazebo-docker') {
      const status = startGazeboDockerSimulation(data);
      broadcast(status);
      return true;
    }

    if (simBackend !== 'gazebo' && simBackend !== 'gazebo-docker') {
      sendJson(ws, simStatus({ error: `unsupported sim backend: ${simBackend}` }));
      return true;
    }
  }

  if (data.type === 'sim_stop') {
    const status = stopGazeboSimulation();
    broadcast(status);
    return true;
  }

  if (data.type === 'sim_status_request') {
    sendJson(ws, simStatus());
    return true;
  }

  return false;
}

mqttClient.on('connect', () => {
  console.log(`[bridge] MQTT connected: ${mqttUrl}`);
  mqttClient.subscribe(topics, (error) => {
    if (error) {
      console.error(`[bridge] MQTT subscribe failed: ${topics.join(', ')}`, error);
      return;
    }
    console.log(`[bridge] MQTT subscribed: ${topics.join(', ')}`);
    broadcast({ type: 'bridge_status', connected: true, topics, vehicleRosVersion });
  });
});

mqttClient.on('message', (messageTopic, payloadBuffer) => {
  const payloadText = payloadBuffer.toString();
  let payload = payloadText;

  try {
    payload = JSON.parse(payloadText);
  } catch {
    // Keep non-JSON payloads as strings.
  }

  console.log(`[bridge] MQTT message ${messageTopic}: ${payloadText}`);

  broadcast({
    type: 'mqtt_message',
    topic: messageTopic,
    payload,
  });
});

mqttClient.on('error', (error) => {
  console.error('[bridge] MQTT error:', error.message);
  console.error(`[bridge] MQTT params: url=${mqttUrl}, clientId=${clientId}, protocolVersion=${protocolVersion}, username=${username || '(empty)'}, topics=${topics.join(', ')}`);
  broadcast({ type: 'bridge_status', connected: false, error: error.message });
});

mqttClient.on('close', () => {
  console.log('[bridge] MQTT disconnected');
  broadcast({ type: 'bridge_status', connected: false });
});

wss.on('connection', (ws, req) => {
  if (bridgeToken) {
    const requestUrl = new URL(req.url || '/bridge', `http://${req.headers.host || 'localhost'}`);
    const token = requestUrl.searchParams.get('token') || '';
    if (token !== bridgeToken) {
      sendJson(ws, { type: 'bridge_status', connected: false, error: 'invalid bridge token' });
      ws.close(1008, 'invalid bridge token');
      return;
    }
  }

  console.log('[bridge] Web client connected');
  sendJson(ws, {
    type: 'bridge_status',
    connected: mqttClient.connected,
    mqttUrl,
    topics,
    vehicleRosVersion,
  });
  sendJson(ws, simStatus());

  ws.on('message', (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (handleBridgeCommand(ws, data)) {
      return;
    }

    if (data.type === 'publish' && data.topic) {
      const payload = typeof data.payload === 'string' ? data.payload : JSON.stringify(data.payload ?? {});
      mqttClient.publish(data.topic, payload);
    }

    if (data.type === 'subscribe' && data.topic) {
      mqttClient.subscribe(data.topic);
    }
  });
});

server.listen(port, host, () => {
  console.log(`[bridge] WebSocket bridge listening: ws://${host}:${port}/bridge`);
  console.log(`[bridge] Forwarding MQTT ${mqttUrl} topics ${topics.join(', ')}`);
  console.log(`[bridge] MQTT options clientId=${clientId} protocolVersion=${protocolVersion} connectTimeout=${connectTimeout}ms keepalive=${keepalive}s username=${username || '(empty)'} bridgeToken=${bridgeToken ? '(enabled)' : '(disabled)'}`);
  console.log(`[bridge] Vehicle ROS version=${vehicleRosVersion}`);
  console.log(`[bridge] Simulation backend=${simBackend} workspace=${simWorkspace} launch=${simLaunch} robotId=${simRobotId} mqtt=${simMqttHost}:${simMqttPort}`);
});

process.on('SIGINT', () => {
  stopGazeboSimulation();
  wss.close();
  mqttClient.end(true);
  server.close(() => process.exit(0));
});
