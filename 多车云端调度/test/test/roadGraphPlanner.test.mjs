import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCloudPathPoints,
  nearestReachableRoadEntry,
  shortestPath,
} from '../src/utils/roadGraphPlanner.js';


const nodes = [
  { id: 'A', x: 0, y: 0 },
  { id: 'B', x: 10, y: 0 },
  { id: 'C', x: 20, y: 0 },
];

test('directed shortest path never traverses an edge backwards', () => {
  const graph = {
    directed: true,
    nodes,
    edges: [
      { id: 'AB', source: 'A', target: 'B', weight: 10, directed: true },
      { id: 'BC', source: 'B', target: 'C', weight: 10, directed: true },
    ],
  };
  assert.deepEqual(shortestPath(graph, 'A', 'C'), ['A', 'B', 'C']);
  assert.deepEqual(shortestPath(graph, 'C', 'A'), []);
  assert.equal(nearestReachableRoadEntry(graph, { x: 5, y: 1 }, 'A'), null);
});

test('cloud path enters a one-way edge at its projection and continues forward', () => {
  const graph = {
    directed: true,
    nodes,
    edges: [
      { id: 'AB', source: 'A', target: 'B', weight: 10, directed: true },
      { id: 'BC', source: 'B', target: 'C', weight: 10, directed: true },
    ],
  };
  const result = buildCloudPathPoints(
    graph,
    { position: { x: 5, y: 2 }, velocity: 0 },
    nodes[2],
  );
  assert.equal(result.entryEdgeId, 'AB');
  assert.deepEqual(result.nodeIds, ['B', 'C']);
  assert.deepEqual(
    result.points.map((point) => [point.x, point.y]),
    [[5, 2], [5, 0], [10, 0], [20, 0]],
  );
});

test('a reverse directed edge permits recovery toward the source geometry', () => {
  const graph = {
    directed: true,
    nodes,
    edges: [
      { id: 'AB', source: 'A', target: 'B', weight: 10, directed: true },
      { id: 'BA', source: 'B', target: 'A', weight: 10, directed: true },
    ],
  };
  const entry = nearestReachableRoadEntry(graph, { x: 5, y: 1 }, 'A');
  assert.equal(entry.edge.id, 'BA');
  assert.deepEqual(entry.graphPath, ['A']);
});

test('an undirected graph remains traversable in either direction', () => {
  const graph = {
    directed: false,
    nodes,
    edges: [{ id: 'AB', source: 'A', target: 'B', weight: 10 }],
  };
  assert.deepEqual(shortestPath(graph, 'B', 'A'), ['B', 'A']);
  const entry = nearestReachableRoadEntry(graph, { x: 5, y: 1 }, 'A');
  assert.equal(entry.entryNodeId, 'A');
});


test('entry selection never skips an unreachable nearest road for a farther road', () => {
  const graph = {
    directed: true,
    nodes: [
      ...nodes,
      { id: 'D', x: 20, y: 10 },
    ],
    edges: [
      { id: 'AB', source: 'A', target: 'B', weight: 10, directed: true },
      { id: 'CD', source: 'C', target: 'D', weight: 10, directed: true },
    ],
  };
  const entry = nearestReachableRoadEntry(graph, { x: 5, y: 1 }, 'D');
  assert.equal(entry, null);
});
