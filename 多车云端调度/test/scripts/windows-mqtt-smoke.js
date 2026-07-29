import { WebSocket } from 'ws';

function readArg(name, fallback) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

const bridgeUrl = readArg('bridge', process.env.BRIDGE_URL || 'ws://127.0.0.1:8788/bridge');
const token = readArg('token', process.env.BRIDGE_TOKEN || '');
const url = token ? `${bridgeUrl}${bridgeUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}` : bridgeUrl;
const vehicleId = `windows_native_${Date.now()}`;
const stateTopic = `vehicles/${vehicleId}`;
const goalTopic = `vehicles/${vehicleId}/goal`;
const cancelTopic = `vehicles/${vehicleId}/cancel`;
const cancelAckTopic = `vehicles/${vehicleId}/cancel_ack`;
const expectedTopics = new Map([
  [stateTopic, 'vehicle-state'],
  [goalTopic, 'vehicle-goal'],
  [cancelTopic, 'task-cancel'],
  [cancelAckTopic, 'task-cancel-ack'],
]);
const nonce = Math.random().toString(16).slice(2);
const received = new Set();
const socket = new WebSocket(url);
const timeout = setTimeout(() => finish(1, `timeout waiting for MQTT round trip; received=${[...received].join(',')}`), 12000);
let finished = false;

function finish(code, message) {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  if (message) (code === 0 ? console.log : console.error)(message);
  try { socket.close(); } catch {}
  setTimeout(() => process.exit(code), 50);
}

function publish(topic, payload) {
  socket.send(JSON.stringify({ type: 'publish', topic, payload }));
}

socket.on('open', () => {
  for (const topic of expectedTopics.keys()) {
    socket.send(JSON.stringify({ type: 'subscribe', topic }));
  }
});

socket.on('message', (raw) => {
  let message;
  try { message = JSON.parse(raw.toString()); } catch { return; }

  if (message.type === 'bridge_status') {
    if (message.error) finish(1, `bridge error: ${message.error}`);
    if (message.connected) {
      setTimeout(() => {
        publish(stateTopic, {
          id: vehicleId,
          status: 'online',
          battery: 88,
          nonce,
          pose: { x: 1.25, y: -2.5, yaw: 0.5, vel: 0.2, steering: 0, goal_x: 2, goal_y: 3 },
        });
        publish(goalTopic, { x: 2, y: 3, yaw: 0, frame_id: 'map', nonce });
        publish(cancelTopic, {
          type: 'cancel_task',
          command: 'cancel',
          id: vehicleId,
          timestamp: new Date().toISOString(),
          nonce,
        });
        publish(cancelAckTopic, {
          id: vehicleId,
          accepted: true,
          timestamp: new Date().toISOString(),
          nonce,
        });
      }, 400);
    }
    return;
  }

  if (message.type !== 'mqtt_message' || message.payload?.nonce !== nonce) return;
  const label = expectedTopics.get(message.topic);
  if (label) received.add(label);
  if (received.size === expectedTopics.size) {
    finish(0, `MQTT round trip OK: ${[...received].join(', ')}`);
  }
});

socket.on('error', (error) => finish(1, `WebSocket error: ${error.message}`));

