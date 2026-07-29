import net from 'node:net';
import { Aedes } from 'aedes';

const portArg = process.argv.find((arg) => arg.startsWith('--port='));
const hostArg = process.argv.find((arg) => arg.startsWith('--host='));
const port = Number(portArg?.slice(7) || process.env.MQTT_PORT || 1883);
const host = hostArg?.slice(7) || process.env.MQTT_LISTEN_HOST || '0.0.0.0';
const broker = await Aedes.createBroker();
const server = net.createServer(broker.handle);

broker.on('clientReady', (client) => console.log(`[mqtt-win] client connected: ${client?.id || '(unknown)'}`));
broker.on('clientDisconnect', (client) => console.log(`[mqtt-win] client disconnected: ${client?.id || '(unknown)'}`));
broker.on('publish', (packet, client) => {
  if (client && !packet.topic.startsWith('$SYS/')) console.log(`[mqtt-win] publish ${client.id}: ${packet.topic}`);
});

server.on('error', (error) => {
  console.error(`[mqtt-win] server error: ${error.message}`);
  process.exitCode = 1;
});
server.listen(port, host, () => console.log(`[mqtt-win] MQTT 3.1.1 broker listening on mqtt://${host}:${port}`));

function shutdown() {
  server.close(() => broker.close(() => process.exit(0)));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
