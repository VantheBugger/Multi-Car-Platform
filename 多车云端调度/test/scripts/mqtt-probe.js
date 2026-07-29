import mqtt from 'mqtt';

function readArg(name, fallback) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];

  return fallback;
}

const mqttUrl = readArg('mqtt', process.env.MQTT_URL || 'mqtt://192.168.8.102:1883');
const topic = readArg('topic', process.env.MQTT_TOPIC || 'vehicles/+');
const username = readArg('username', process.env.MQTT_USERNAME || '');
const password = readArg('password', process.env.MQTT_PASSWORD || '');
const clientId = readArg('client-id', process.env.MQTT_CLIENT_ID || `fleet_probe_${Math.random().toString(16).slice(2, 10)}`);
const protocolVersion = Number(readArg('protocol-version', process.env.MQTT_PROTOCOL_VERSION || 5));
const connectTimeout = Number(readArg('connect-timeout', process.env.MQTT_CONNECT_TIMEOUT || 15000));

console.log(`[probe] Connecting ${mqttUrl}`);
console.log(`[probe] Options clientId=${clientId} protocolVersion=${protocolVersion} username=${username || '(empty)'}`);

const client = mqtt.connect(mqttUrl, {
  clean: true,
  clientId,
  protocolVersion,
  connectTimeout,
  reconnectPeriod: 0,
  ...(username ? { username } : {}),
  ...(password ? { password } : {}),
});

client.on('connect', () => {
  console.log('[probe] MQTT connected');
  client.subscribe(topic, (error) => {
    if (error) {
      console.error(`[probe] Subscribe failed: ${topic}`, error);
      client.end(true);
      process.exitCode = 1;
      return;
    }

    console.log(`[probe] Subscribed: ${topic}`);
    console.log('[probe] Waiting for messages. Press Ctrl+C to stop.');
  });
});

client.on('message', (messageTopic, payload) => {
  console.log(`[probe] ${messageTopic}: ${payload.toString()}`);
});

client.on('error', (error) => {
  console.error('[probe] MQTT error:', error.message);
  client.end(true);
  process.exitCode = 1;
});

client.on('close', () => {
  console.log('[probe] MQTT disconnected');
});

process.on('SIGINT', () => {
  client.end(true, () => process.exit(0));
});
