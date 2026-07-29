import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';

function readArg(name, fallback) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];

  return fallback;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const graphPath = readArg('graph', path.join(__dirname, '../public/maps/road_graph_V1.json'));
const port = Number(readArg('port', process.env.SIM_BRIDGE_PORT || 8787));
const host = readArg('host', process.env.SIM_BRIDGE_HOST || '0.0.0.0');
const vehiclePrefix = readArg('vehicle-id', process.env.SIM_VEHICLE_ID || 'robot_sim');
const defaultVehicleCount = Number(readArg('count', process.env.SIM_VEHICLE_COUNT || 3));
const speedMps = Number(readArg('speed', process.env.SIM_SPEED_MPS || 2.2));
const tickMs = Number(readArg('tick-ms', process.env.SIM_TICK_MS || 120));

const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
const adjacency = new Map(graph.nodes.map((node) => [node.id, []]));
const graphIsDirected = graph.directed === true;

graph.edges.forEach((edge) => {
  const source = nodes.get(edge.source);
  const target = nodes.get(edge.target);
  if (!source || !target) return;
  const weight = Number(edge.weight) || Math.hypot(source.x - target.x, source.y - target.y);
  adjacency.get(edge.source).push({ id: edge.target, weight });
  if (!graphIsDirected && edge.directed !== true) {
    adjacency.get(edge.target).push({ id: edge.source, weight });
  }
});

const sim = {
  active: false,
  interval: null,
  vehicles: new Map(),
};

function vehicleIdAt(index) {
  return `${vehiclePrefix}_${index}`;
}

function initialNodeFor(index, total) {
  const available = graph.nodes.length;
  if (!available) throw new Error('road graph has no nodes');
  const step = Math.max(1, Math.floor(available / Math.max(1, total)));
  return graph.nodes[(index * step) % available];
}

function createVehicleState(id, index, total) {
  const node = initialNodeFor(index, total);
  const offset = index >= graph.nodes.length ? index * 0.6 : 0;

  return {
    id,
    lastTick: Date.now(),
    pose: {
      x: node.x + offset,
      y: node.y + offset,
      yaw: 0,
      vel: 0,
      steering: 0,
      goal_x: node.x + offset,
      goal_y: node.y + offset,
    },
    route: null,
  };
}

function resetVehicles(count = defaultVehicleCount) {
  const nextCount = Math.max(1, Math.min(50, Number(count) || defaultVehicleCount));
  sim.vehicles.clear();

  for (let index = 0; index < nextCount; index += 1) {
    const id = vehicleIdAt(index);
    sim.vehicles.set(id, createVehicleState(id, index, nextCount));
  }
}

resetVehicles(defaultVehicleCount);

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      mode: 'simulation',
      active: sim.active,
      vehiclePrefix,
      vehicleCount: sim.vehicles.size,
      graph: graph.source,
    }));
    return;
  }

  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server, path: '/bridge' });

function sendJson(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcast(data) {
  const message = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

function broadcastMqtt(topic, payload) {
  broadcast({
    type: 'mqtt_message',
    topic,
    payload,
  });
}

function posePayload(vehicle) {
  return {
    id: vehicle.id,
    x: Number(vehicle.pose.x.toFixed(6)),
    y: Number(vehicle.pose.y.toFixed(6)),
    yaw: Number(vehicle.pose.yaw.toFixed(6)),
    vel: Number(vehicle.pose.vel.toFixed(3)),
    steering: Number(vehicle.pose.steering.toFixed(3)),
    goal_x: Number(vehicle.pose.goal_x.toFixed(6)),
    goal_y: Number(vehicle.pose.goal_y.toFixed(6)),
  };
}

function publishPose(vehicle) {
  broadcastMqtt(`vehicles/${vehicle.id}`, posePayload(vehicle));
}

function publishAllPoses() {
  sim.vehicles.forEach((vehicle) => publishPose(vehicle));
}

function nearestNodeId(point) {
  let bestId = graph.nodes[0]?.id;
  let bestDistance = Infinity;

  graph.nodes.forEach((node) => {
    const distance = Math.hypot(point.x - node.x, point.y - node.y);
    if (distance < bestDistance) {
      bestId = node.id;
      bestDistance = distance;
    }
  });

  return bestId;
}

function shortestPath(startId, goalId) {
  const dist = new Map(graph.nodes.map((node) => [node.id, Infinity]));
  const prev = new Map();
  const queue = new Set(graph.nodes.map((node) => node.id));
  dist.set(startId, 0);

  while (queue.size) {
    let current = null;
    let currentDist = Infinity;
    queue.forEach((id) => {
      const candidateDist = dist.get(id);
      if (candidateDist < currentDist) {
        current = id;
        currentDist = candidateDist;
      }
    });

    if (!current || current === goalId) break;
    queue.delete(current);

    adjacency.get(current).forEach((neighbor) => {
      if (!queue.has(neighbor.id)) return;
      const nextDist = currentDist + neighbor.weight;
      if (nextDist < dist.get(neighbor.id)) {
        dist.set(neighbor.id, nextDist);
        prev.set(neighbor.id, current);
      }
    });
  }

  if (startId !== goalId && !prev.has(goalId)) {
    return [];
  }

  const pathIds = [goalId];
  while (pathIds[0] !== startId) {
    const previous = prev.get(pathIds[0]);
    if (!previous) break;
    pathIds.unshift(previous);
  }

  return pathIds;
}

function buildRoute(vehicle, goal) {
  const startId = nearestNodeId(vehicle.pose);
  const goalId = goal.node_id && nodes.has(goal.node_id) ? goal.node_id : nearestNodeId(goal);
  const graphPathIds = shortestPath(startId, goalId);
  if (!graphPathIds.length) return null;
  const routePoints = [
    { x: vehicle.pose.x, y: vehicle.pose.y },
    ...graphPathIds.map((id) => {
      const node = nodes.get(id);
      return { x: node.x, y: node.y };
    }),
  ].filter((point, index, list) => {
    if (index === 0) return true;
    const previous = list[index - 1];
    return Math.hypot(point.x - previous.x, point.y - previous.y) > 0.05;
  });

  return {
    points: routePoints.length > 1 ? routePoints : [{ x: vehicle.pose.x, y: vehicle.pose.y }, { x: goal.x, y: goal.y }],
    index: 0,
    goalId,
    planningMode: 'vehicle',
  };
}

function buildRouteFromPath(vehicle, payload) {
  const points = Array.isArray(payload.points) ? payload.points : [];
  const routePoints = [
    { x: vehicle.pose.x, y: vehicle.pose.y },
    ...points.map((point) => ({
      x: Number(point.x),
      y: Number(point.y),
    })),
  ].filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .filter((point, index, list) => {
      if (index === 0) return true;
      const previous = list[index - 1];
      return Math.hypot(point.x - previous.x, point.y - previous.y) > 0.05;
    });

  return {
    points: routePoints.length > 1 ? routePoints : [{ x: vehicle.pose.x, y: vehicle.pose.y }],
    index: 0,
    goalId: payload.node_id || payload.goal_node_id || nearestNodeId(routePoints[routePoints.length - 1] || vehicle.pose),
    planningMode: 'cloud',
  };
}

function tickVehicle(vehicle, now) {
  const dt = Math.max(0.001, (now - vehicle.lastTick) / 1000);
  vehicle.lastTick = now;

  if (!vehicle.route) {
    vehicle.pose.vel = 0;
    publishPose(vehicle);
    return;
  }

  let remaining = speedMps * dt;

  while (vehicle.route && remaining > 0) {
    const from = { x: vehicle.pose.x, y: vehicle.pose.y };
    const to = vehicle.route.points[vehicle.route.index + 1];

    if (!to) {
      vehicle.pose.vel = 0;
      vehicle.route = null;
      publishPose(vehicle);
      return;
    }

    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    if (distance <= 0.001) {
      vehicle.route.index += 1;
      continue;
    }

    vehicle.pose.yaw = Math.atan2(to.y - from.y, to.x - from.x);

    if (remaining >= distance) {
      vehicle.pose.x = to.x;
      vehicle.pose.y = to.y;
      vehicle.route.index += 1;
      remaining -= distance;
    } else {
      const ratio = remaining / distance;
      vehicle.pose.x += (to.x - from.x) * ratio;
      vehicle.pose.y += (to.y - from.y) * ratio;
      remaining = 0;
    }
  }

  vehicle.pose.vel = vehicle.route ? speedMps : 0;
  publishPose(vehicle);
}

function tick() {
  if (!sim.active) return;

  const now = Date.now();
  sim.vehicles.forEach((vehicle) => tickVehicle(vehicle, now));
}

function startSimulation({ resetPose = false, count = defaultVehicleCount } = {}) {
  if (resetPose) {
    resetVehicles(count);
  }

  sim.active = true;
  const now = Date.now();
  sim.vehicles.forEach((vehicle) => {
    vehicle.lastTick = now;
  });

  if (!sim.interval) {
    sim.interval = setInterval(tick, tickMs);
  }

  publishAllPoses();
  broadcast({
    type: 'sim_status',
    active: true,
    vehiclePrefix,
    vehicleCount: sim.vehicles.size,
    graph: graph.source,
  });
}

function stopSimulation() {
  sim.active = false;

  sim.vehicles.forEach((vehicle) => {
    vehicle.pose.vel = 0;
    vehicle.route = null;
    publishPose(vehicle);
  });

  if (sim.interval) {
    clearInterval(sim.interval);
    sim.interval = null;
  }

  broadcast({
    type: 'sim_status',
    active: false,
    vehiclePrefix,
    vehicleCount: sim.vehicles.size,
    graph: graph.source,
  });
}

function handleGoal(topic, payload) {
  const match = topic.match(/^vehicles\/([^/]+)\/goal$/);
  if (!match) return;

  const targetVehicleId = match[1];
  const vehicle = sim.vehicles.get(targetVehicleId);
  if (!vehicle) return;

  const goal = typeof payload === 'string' ? JSON.parse(payload) : payload;
  if (!Number.isFinite(Number(goal.x)) || !Number.isFinite(Number(goal.y))) {
    console.warn('[sim] ignored invalid goal:', payload);
    return;
  }

  startSimulation({ resetPose: false });
  vehicle.pose.goal_x = Number(goal.x);
  vehicle.pose.goal_y = Number(goal.y);
  const route = buildRoute(vehicle, {
    ...goal,
    x: Number(goal.x),
    y: Number(goal.y),
  });
  if (!route) {
    console.warn(`[sim] ${vehicle.id} no directed route to ${goal.node_id || '(nearest)'}`);
    broadcastMqtt(`vehicles/${vehicle.id}/goal_ack`, {
      id: vehicle.id,
      node_id: goal.node_id || '',
      accepted: false,
      planning_mode: 'vehicle',
      error: 'no directed route',
      timestamp: new Date().toISOString(),
    });
    return;
  }
  vehicle.route = route;
  vehicle.route.planningMode = 'vehicle';

  console.log(`[sim] ${vehicle.id} goal ${goal.node_id || '(nearest)'} -> (${vehicle.pose.goal_x.toFixed(2)}, ${vehicle.pose.goal_y.toFixed(2)})`);
  broadcastMqtt(`vehicles/${vehicle.id}/goal_ack`, {
    id: vehicle.id,
    node_id: goal.node_id || vehicle.route.goalId,
    accepted: true,
    planning_mode: 'vehicle',
    path_node_count: vehicle.route.points.length,
    timestamp: new Date().toISOString(),
  });
}

function handlePlannedPath(topic, payload) {
  const match = topic.match(/^vehicles\/([^/]+)\/path$/);
  if (!match) return;

  const targetVehicleId = match[1];
  const vehicle = sim.vehicles.get(targetVehicleId);
  if (!vehicle) return;

  const pathPayload = typeof payload === 'string' ? JSON.parse(payload) : payload;
  if (!Array.isArray(pathPayload.points) || pathPayload.points.length < 1) {
    console.warn('[sim] ignored invalid planned path:', payload);
    return;
  }

  const lastPoint = pathPayload.points[pathPayload.points.length - 1];
  if (!Number.isFinite(Number(lastPoint?.x)) || !Number.isFinite(Number(lastPoint?.y))) {
    console.warn('[sim] ignored invalid planned path endpoint:', payload);
    return;
  }

  startSimulation({ resetPose: false });
  vehicle.pose.goal_x = Number(lastPoint.x);
  vehicle.pose.goal_y = Number(lastPoint.y);
  vehicle.route = buildRouteFromPath(vehicle, pathPayload);

  console.log(`[sim] ${vehicle.id} cloud path ${pathPayload.node_id || '(custom)'} -> (${vehicle.pose.goal_x.toFixed(2)}, ${vehicle.pose.goal_y.toFixed(2)})`);
  broadcastMqtt(`vehicles/${vehicle.id}/path_ack`, {
    id: vehicle.id,
    node_id: pathPayload.node_id || vehicle.route.goalId,
    accepted: true,
    planning_mode: 'cloud',
    path_node_count: vehicle.route.points.length,
    timestamp: new Date().toISOString(),
  });
}

function handleCancel(topic, payload) {
  const match = topic.match(/^vehicles\/([^/]+)\/cancel$/);
  if (!match) return;

  const vehicle = sim.vehicles.get(match[1]);
  if (!vehicle) return;

  const command = typeof payload === 'string' ? JSON.parse(payload) : payload;
  if (command?.id && command.id !== vehicle.id) return;

  vehicle.route = null;
  vehicle.pose.vel = 0;
  vehicle.pose.goal_x = vehicle.pose.x;
  vehicle.pose.goal_y = vehicle.pose.y;
  publishPose(vehicle);
  broadcastMqtt(`vehicles/${vehicle.id}/cancel_ack`, {
    id: vehicle.id,
    accepted: true,
    timestamp: new Date().toISOString(),
  });
}

wss.on('connection', (ws) => {
  console.log('[sim] Web client connected');
  sendJson(ws, {
    type: 'bridge_status',
    connected: true,
    mqttUrl: 'sim://local-road-graph',
    topics: [`vehicles/${vehiclePrefix}_+`, `vehicles/${vehiclePrefix}_+/goal`, `vehicles/${vehiclePrefix}_+/path`],
  });
  sendJson(ws, {
    type: 'sim_status',
    active: sim.active,
    vehiclePrefix,
    vehicleCount: sim.vehicles.size,
    graph: graph.source,
  });
  publishAllPoses();

  ws.on('message', (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (data.type === 'subscribe') {
      return;
    }

    if (data.type === 'sim_start') {
      startSimulation({
        resetPose: true,
        count: data.count,
      });
      return;
    }

    if (data.type === 'sim_stop') {
      stopSimulation();
      return;
    }

    if (data.type === 'publish' && data.topic) {
      broadcastMqtt(data.topic, data.payload);
      handleGoal(data.topic, data.payload);
      handlePlannedPath(data.topic, data.payload);
      handleCancel(data.topic, data.payload);
    }
  });
});

server.listen(port, host, () => {
  console.log(`[sim] WebSocket simulation bridge listening: ws://${host}:${port}/bridge`);
  console.log(`[sim] road graph: ${graphPath}`);
  console.log(`[sim] vehicles=${sim.vehicles.size} prefix=${vehiclePrefix} speed=${speedMps}m/s`);
});

process.on('SIGINT', () => {
  stopSimulation();
  wss.close();
  server.close(() => process.exit(0));
});
