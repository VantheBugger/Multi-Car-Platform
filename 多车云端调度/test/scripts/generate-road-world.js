#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

function readArg(name, fallback) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];

  return fallback;
}

function escapeXml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function formatNumber(value) {
  return Number(value).toFixed(6);
}

function makeMaterial(ambient, diffuse) {
  return [
    '<material>',
    `  <ambient>${ambient}</ambient>`,
    `  <diffuse>${diffuse}</diffuse>`,
    '  <specular>0.05 0.05 0.05 1</specular>',
    '  <emissive>0 0 0 1</emissive>',
    '</material>',
  ].join('\n');
}

function visualBox(name, pose, size, material, shadow = false) {
  return [
    `    <visual name="${escapeXml(name)}">`,
    `      <cast_shadows>${shadow ? '1' : '0'}</cast_shadows>`,
    `      <pose>${pose}</pose>`,
    '      <geometry>',
    '        <box>',
    `          <size>${size}</size>`,
    '        </box>',
    '      </geometry>',
    material,
    '    </visual>',
  ].join('\n');
}

function visualCylinder(name, pose, radius, length, material, shadow = false) {
  return [
    `    <visual name="${escapeXml(name)}">`,
    `      <cast_shadows>${shadow ? '1' : '0'}</cast_shadows>`,
    `      <pose>${pose}</pose>`,
    '      <geometry>',
    '        <cylinder>',
    `          <radius>${formatNumber(radius)}</radius>`,
    `          <length>${formatNumber(length)}</length>`,
    '        </cylinder>',
    '      </geometry>',
    material,
    '    </visual>',
  ].join('\n');
}

const graphPath = readArg('graph', '');
const outputPath = readArg('output', '');
const worldName = readArg('world-name', 'road_graph_minimal');
const worldOffsetY = Number(readArg('world-offset-y', '0.15'));
const margin = Number(readArg('margin', '8'));
const roadWidth = Number(readArg('road-width', '0.28'));
const roadHeight = Number(readArg('road-height', '0.012'));
const nodeRadius = Number(readArg('node-radius', '0.14'));
const nodeHeight = Number(readArg('node-height', '0.03'));
const physicsRate = Math.max(10, Number(readArg('physics-rate', '100')));
const maxStepSize = 1 / physicsRate;

if (!graphPath || !outputPath) {
  console.error('usage: generate-road-world.js --graph <road_graph.json> --output <world.sdf>');
  process.exit(2);
}

const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
const edges = Array.isArray(graph.edges) ? graph.edges : [];

if (!nodes.length || !edges.length) {
  console.error('road graph is empty');
  process.exit(1);
}

const nodeMap = new Map(nodes.map((node) => [node.id, node]));
const xs = nodes.map((node) => Number(node.x));
const ys = nodes.map((node) => Number(node.y));
const minX = Math.min(...xs);
const maxX = Math.max(...xs);
const minY = Math.min(...ys);
const maxY = Math.max(...ys);
const centerX = (minX + maxX) / 2;
const centerY = (minY + maxY) / 2 + worldOffsetY;
const groundWidth = Math.max(100, maxX - minX + margin * 2);
const groundHeight = Math.max(100, maxY - minY + margin * 2);

const asphaltMaterial = makeMaterial('0.18 0.19 0.21 1', '0.18 0.19 0.21 1');
const laneMaterial = makeMaterial('0.16 0.52 0.91 1', '0.16 0.52 0.91 1');
const nodeMaterial = makeMaterial('0.95 0.65 0.18 1', '0.95 0.65 0.18 1');
const directionMaterial = makeMaterial('0.95 0.95 0.95 1', '0.95 0.95 0.95 1');

const visuals = [];

visuals.push(
  visualBox(
    'road_patch',
    `${formatNumber(centerX)} ${formatNumber(centerY)} 0.001000 0 0 0`,
    `${formatNumber(groundWidth)} ${formatNumber(groundHeight)} 0.002000`,
    asphaltMaterial,
  ),
);

edges.forEach((edge, index) => {
  const source = nodeMap.get(edge.source);
  const target = nodeMap.get(edge.target);
  if (!source || !target) return;

  const x1 = Number(source.x);
  const y1 = Number(source.y) + worldOffsetY;
  const x2 = Number(target.x);
  const y2 = Number(target.y) + worldOffsetY;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return;

  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const yaw = Math.atan2(dy, dx);
  visuals.push(
    visualBox(
      `edge_${index}_${edge.source}_${edge.target}`,
      `${formatNumber(midX)} ${formatNumber(midY)} 0.007000 0 0 ${formatNumber(yaw)}`,
      `${formatNumber(length)} ${formatNumber(roadWidth)} ${formatNumber(roadHeight)}`,
      laneMaterial,
    ),
  );

  const directed = graph.directed === true || edge.directed === true;
  if (directed) {
    const arrowX = x1 + dx * 0.82;
    const arrowY = y1 + dy * 0.82;
    visuals.push(
      visualBox(
        `arrow_${index}_${edge.source}_${edge.target}`,
        `${formatNumber(arrowX)} ${formatNumber(arrowY)} 0.020000 0 0 ${formatNumber(yaw)}`,
        `${formatNumber(Math.min(0.35, length * 0.18))} ${formatNumber(roadWidth * 0.45)} 0.010000`,
        directionMaterial,
      ),
    );
  }
});

nodes.forEach((node, index) => {
  visuals.push(
    visualCylinder(
      `node_${index}_${node.id}`,
      `${formatNumber(Number(node.x))} ${formatNumber(Number(node.y) + worldOffsetY)} 0.020000 1.570796 0 0`,
      nodeRadius,
      nodeHeight,
      nodeMaterial,
    ),
  );
});

const world = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<sdf version="1.6">',
  `  <world name="${escapeXml(worldName)}">`,
  '    <light name="sun" type="directional">',
  '      <cast_shadows>1</cast_shadows>',
  '      <pose>0 0 30 0 0 0</pose>',
  '      <diffuse>0.85 0.85 0.85 1</diffuse>',
  '      <specular>0.15 0.15 0.15 1</specular>',
  '      <attenuation>',
  '        <range>1000</range>',
  '        <constant>0.9</constant>',
  '        <linear>0.01</linear>',
  '        <quadratic>0.001</quadratic>',
  '      </attenuation>',
  '      <direction>-0.35 0.2 -0.9</direction>',
  '    </light>',
  '    <model name="ground_plane">',
  '      <static>1</static>',
  '      <link name="link">',
  '        <collision name="collision">',
  '          <geometry>',
  '            <plane>',
  '              <normal>0 0 1</normal>',
  `              <size>${formatNumber(Math.max(groundWidth + 20, 120))} ${formatNumber(Math.max(groundHeight + 20, 120))}</size>`,
  '            </plane>',
  '          </geometry>',
  '          <surface>',
  '            <friction>',
  '              <ode>',
  '                <mu>100</mu>',
  '                <mu2>100</mu2>',
  '              </ode>',
  '            </friction>',
  '          </surface>',
  '        </collision>',
  '        <visual name="visual">',
  '          <cast_shadows>0</cast_shadows>',
  '          <geometry>',
  '            <plane>',
  '              <normal>0 0 1</normal>',
  `              <size>${formatNumber(Math.max(groundWidth + 20, 120))} ${formatNumber(Math.max(groundHeight + 20, 120))}</size>`,
  '            </plane>',
  '          </geometry>',
  makeMaterial('0.94 0.95 0.97 1', '0.94 0.95 0.97 1'),
  '        </visual>',
  '      </link>',
  '    </model>',
  '    <model name="road_graph_overlay">',
  '      <static>1</static>',
  '      <link name="overlay">',
  visuals.join('\n'),
  '      </link>',
  '    </model>',
  '    <gravity>0 0 -9.8</gravity>',
  '    <magnetic_field>6e-06 2.3e-05 -4.2e-05</magnetic_field>',
  '    <atmosphere type="adiabatic"/>',
  '    <scene>',
  '      <ambient>0.55 0.55 0.55 1</ambient>',
  '      <background>0.98 0.98 0.99 1</background>',
  '      <shadows>1</shadows>',
  '    </scene>',
  '    <physics name="default_physics" default="1" type="ode">',
  `      <max_step_size>${formatNumber(maxStepSize)}</max_step_size>`,
  '      <real_time_factor>1</real_time_factor>',
  `      <real_time_update_rate>${formatNumber(physicsRate)}</real_time_update_rate>`,
  '    </physics>',
  '  </world>',
  '</sdf>',
  '',
].join('\n');

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, world);

console.log(JSON.stringify({
  ok: true,
  output: outputPath,
  nodeCount: nodes.length,
  edgeCount: edges.length,
  physicsRate,
  bounds: {
    minX,
    maxX,
    minY,
    maxY,
    worldOffsetY,
  },
}, null, 2));
