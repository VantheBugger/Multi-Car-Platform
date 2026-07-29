const ENDPOINT_EPSILON = 1e-6;

const ROS2_PATH_SAMPLE_SPACING_METERS = 0.1;

function edgeIsDirected(roadGraph, edge) {
  return roadGraph.directed === true || edge.directed === true;
}

function createGraphIndex(roadGraph) {
  const nodes = roadGraph?.nodes || [];
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const adjacency = new Map(nodes.map((node) => [node.id, []]));

  (roadGraph?.edges || []).forEach((edge) => {
    const source = nodeMap.get(edge.source);
    const target = nodeMap.get(edge.target);
    if (!source || !target) return;
    const fallbackLength = Math.hypot(target.x - source.x, target.y - source.y);
    const weight = Number(edge.weight) || fallbackLength;
    adjacency.get(edge.source)?.push({ id: edge.target, weight });
    if (!edgeIsDirected(roadGraph, edge)) {
      adjacency.get(edge.target)?.push({ id: edge.source, weight });
    }
  });

  return { nodeMap, adjacency };
}

function shortestPathResult(index, startId, goalId) {
  if (!startId || !goalId || !index.nodeMap.has(startId) || !index.nodeMap.has(goalId)) {
    return null;
  }
  if (startId === goalId) return { path: [startId], distance: 0 };

  const distances = new Map(Array.from(index.nodeMap.keys(), (id) => [id, Infinity]));
  const previous = new Map();
  const queue = new Set(index.nodeMap.keys());
  distances.set(startId, 0);

  while (queue.size) {
    let currentId = '';
    let currentDistance = Infinity;
    queue.forEach((candidateId) => {
      const candidateDistance = distances.get(candidateId);
      if (candidateDistance < currentDistance) {
        currentDistance = candidateDistance;
        currentId = candidateId;
      }
    });

    if (!currentId || !Number.isFinite(currentDistance)) break;
    queue.delete(currentId);
    if (currentId === goalId) break;

    (index.adjacency.get(currentId) || []).forEach((neighbor) => {
      if (!queue.has(neighbor.id)) return;
      const nextDistance = currentDistance + neighbor.weight;
      if (nextDistance < distances.get(neighbor.id)) {
        distances.set(neighbor.id, nextDistance);
        previous.set(neighbor.id, currentId);
      }
    });
  }

  if (!Number.isFinite(distances.get(goalId))) return null;
  const path = [goalId];
  while (path[0] !== startId) {
    const previousId = previous.get(path[0]);
    if (!previousId) return null;
    path.unshift(previousId);
  }
  return { path, distance: distances.get(goalId) };
}

export function shortestPath(roadGraph, startId, goalId) {
  return shortestPathResult(createGraphIndex(roadGraph), startId, goalId)?.path || [];
}

function projectToEdge(point, source, target) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const denominator = dx * dx + dy * dy;
  const ratio = denominator > 0
    ? Math.max(0, Math.min(1, ((point.x - source.x) * dx + (point.y - source.y) * dy) / denominator))
    : 0;
  const x = source.x + ratio * dx;
  const y = source.y + ratio * dy;
  return { x, y, ratio, distance: Math.hypot(point.x - x, point.y - y) };
}

export function nearestReachableRoadEntry(roadGraph, point, goalId) {
  if (!roadGraph?.nodes?.length || !roadGraph?.edges?.length || !point || !goalId) return null;
  const index = createGraphIndex(roadGraph);
  if (!index.nodeMap.has(goalId)) return null;
  const routeCache = new Map();
  const routeFrom = (nodeId) => {
    if (!routeCache.has(nodeId)) {
      routeCache.set(nodeId, shortestPathResult(index, nodeId, goalId));
    }
    return routeCache.get(nodeId);
  };
  let best = null;
  const projectedEdges = roadGraph.edges.map((edge) => {
    const source = index.nodeMap.get(edge.source);
    const target = index.nodeMap.get(edge.target);
    if (!source || !target) return null;
    return { edge, source, target, projection: projectToEdge(point, source, target) };
  }).filter(Boolean);
  const nearestDistance = Math.min(...projectedEdges.map(({ projection }) => projection.distance));

  projectedEdges.forEach(({ edge, source, target, projection }) => {
    if (projection.distance > nearestDistance + ENDPOINT_EPSILON) return;
    const edgeLength = Number(edge.weight)
      || Math.hypot(target.x - source.x, target.y - source.y);
    const options = [{ nodeId: edge.target, alongDistance: edgeLength * (1 - projection.ratio) }];

    if (!edgeIsDirected(roadGraph, edge)) {
      options.push({ nodeId: edge.source, alongDistance: edgeLength * projection.ratio });
    }
    if (projection.ratio <= ENDPOINT_EPSILON) {
      options.push({ nodeId: edge.source, alongDistance: 0 });
    }
    if (projection.ratio >= 1 - ENDPOINT_EPSILON) {
      options.push({ nodeId: edge.target, alongDistance: 0 });
    }

    options.forEach((option) => {
      const route = routeFrom(option.nodeId);
      if (!route) return;
      const candidate = {
        edge,
        projection,
        entryNodeId: option.nodeId,
        graphPath: route.path,
        roadDistance: option.alongDistance + route.distance,
      };
      if (
        !best
        || candidate.projection.distance < best.projection.distance - ENDPOINT_EPSILON
        || (
          Math.abs(candidate.projection.distance - best.projection.distance) <= ENDPOINT_EPSILON
          && candidate.roadDistance < best.roadDistance
        )
      ) {
        best = candidate;
      }
    });
  });

  return best;
}

function deduplicatePoints(points) {
  return points.filter((point, index) => {
    if (index === 0) return true;
    const previousPoint = points[index - 1];
    return Math.hypot(point.x - previousPoint.x, point.y - previousPoint.y) > 0.05;
  });
}

function resamplePathForRos2(points, spacing = ROS2_PATH_SAMPLE_SPACING_METERS) {
  if (points.length < 2) return points;
  const sampled = [points[0]];

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const distance = Math.hypot(current.x - previous.x, current.y - previous.y);
    const steps = Math.max(1, Math.ceil(distance / spacing));

    for (let step = 1; step <= steps; step += 1) {
      const ratio = step / steps;
      sampled.push({
        ...current,
        x: previous.x + (current.x - previous.x) * ratio,
        y: previous.y + (current.y - previous.y) * ratio,
      });
    }
  }

  return sampled;
}

function timelineFor(points, startAt, speed = 1.5) {
  let time = startAt;
  return points.slice(1).map((point, index) => {
    const previous = points[index];
    const duration = Math.max(0.5, Math.hypot(point.x - previous.x, point.y - previous.y) / speed);
    const segment = { from: previous, to: point, start: time, end: time + duration };
    time = segment.end;
    return segment;
  });
}

function segmentsConflict(first, second, headwayMs) {
  const sameDirection = Math.hypot(first.from.x - second.from.x, first.from.y - second.from.y) < 0.2
    && Math.hypot(first.to.x - second.to.x, first.to.y - second.to.y) < 0.2;
  const oppositeDirection = Math.hypot(first.from.x - second.to.x, first.from.y - second.to.y) < 0.2
    && Math.hypot(first.to.x - second.from.x, first.to.y - second.from.y) < 0.2;
  return (sameDirection || oppositeDirection)
    && first.start < second.end + headwayMs
    && second.start < first.end + headwayMs;
}

// Reserve only the time interval of each segment. A clear shortest route is never delayed.
export function coordinateCloudPath(path, missions, vehicleId, now = Date.now()) {
  const activeSegments = Object.entries(missions || {})
    .filter(([id, mission]) => id !== vehicleId && mission?.status === 'running' && mission.pathPoints?.length > 1)
    .flatMap(([, mission]) => timelineFor(mission.pathPoints, mission.dispatchAt || mission.startedAt || now));
  const headwayMs = 2500;
  for (let delaySeconds = 0; delaySeconds <= 60; delaySeconds += 2) {
    const candidate = timelineFor(path.points, now + delaySeconds * 1000);
    const conflict = candidate.some((segment) => activeSegments.some((reserved) => segmentsConflict(segment, reserved, headwayMs)));
    if (!conflict) return { ...path, startDelaySeconds: delaySeconds, dispatchAt: now + delaySeconds * 1000 };
  }
  return { ...path, startDelaySeconds: 60, dispatchAt: now + 60000 };
}

export function buildCloudPathPoints(roadGraph, vehicle, targetNode) {
  const position = vehicle?.position;
  if (!position || !targetNode) return null;
  const entry = nearestReachableRoadEntry(roadGraph, position, targetNode.id);
  if (!entry) return null;

  const nodeMap = new Map(roadGraph.nodes.map((node) => [node.id, node]));
  const startNode = nodeMap.get(entry.entryNodeId);
  const points = resamplePathForRos2(deduplicatePoints([
    {
      x: entry.projection.x,
      y: entry.projection.y,
      z: 0,
      speed: 0.6,
      phase: 'road_entry',
      edge_id: entry.edge.id,
      edge_source: entry.edge.source,
      edge_target: entry.edge.target,
    },
    ...entry.graphPath.map((nodeId, index) => {
      const node = nodeMap.get(nodeId);
      return node ? {
        x: Number(node.x),
        y: Number(node.y),
        z: Number(node.z) || 0,
        speed: 1.5,
        phase: 'road',
        node_id: node.id,
        node_label: node.label || node.id,
        source_id: node.sourceId || node.id,
        sequence: index,
      } : null;
    }).filter(Boolean),
  ]));

  if (points.length < 2) return null;
  return {
    startNodeId: entry.entryNodeId,
    startNodeLabel: startNode?.label || entry.entryNodeId,
    startSourceId: startNode?.sourceId || entry.entryNodeId,
    entryEdgeId: entry.edge.id,
    entryDistance: entry.projection.distance,
    // No off-road recovery segment is emitted. The vehicle must already be
    // close enough to this directed road entry for tracking to begin safely.
    requiresRecovery: entry.projection.distance > 3.0,
    nodeIds: entry.graphPath,
    points,
  };
}
