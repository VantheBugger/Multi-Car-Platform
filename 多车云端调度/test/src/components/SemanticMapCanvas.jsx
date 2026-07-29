import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Slider, Space, Spin, Tag } from 'antd';
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import {
  DownOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  StopOutlined,
  ZoomInOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import './SemanticMapCanvas.css';

const MAP_URL = '/maps/global_s.semantic.json';
const REGISTRATION_URL = '/maps/global_s.registration.json';
const ROAD_GRAPH_URL = '/maps/road_graph_V1.json';
const ROAD_GRAPH_LABELS_URL = '/maps/road_graph_V1.labels.json';
const CALIBRATION_STORAGE_KEY = 'pcd-map-calibration-global-s-fixed-v3';
const BASE_TILE_SOURCES = [
  {
    name: 'OpenStreetMap',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    subdomains: ['a', 'b', 'c'],
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  },
  {
    name: 'CARTO Light',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    subdomains: ['a', 'b', 'c', 'd'],
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
  },
];
const CALIBRATION_STEP_METERS = 5;
const SEMANTIC_OPACITY = 0.68;
const POINT_CLOUD_OPACITY = 0.82;
const ROAD_NODE_SELECTION_ZOOM = 21;
const ROAD_NODE_MAGNIFIER_DEFAULT_SCALE = 4;
const ROAD_NODE_MAGNIFIER_MIN_SCALE = 1;
const ROAD_NODE_MAGNIFIER_MAX_SCALE = 64;
const ROAD_NODE_MAGNIFIER_DEFAULT_ZOOM = ROAD_NODE_SELECTION_ZOOM + Math.log2(ROAD_NODE_MAGNIFIER_DEFAULT_SCALE);
const ROAD_NODE_MAGNIFIER_MIN_ZOOM = ROAD_NODE_SELECTION_ZOOM + Math.log2(ROAD_NODE_MAGNIFIER_MIN_SCALE);
const ROAD_NODE_MAGNIFIER_MAX_ZOOM = ROAD_NODE_SELECTION_ZOOM + Math.log2(ROAD_NODE_MAGNIFIER_MAX_SCALE);
const ROAD_NODE_MAGNIFIER_POINTER_GAP = 22;
const ROAD_NODE_MAGNIFIER_WHEEL_SENSITIVITY = 1 / 240;
const ROAD_NODE_LABEL_OFFSETS = [
  [0, -12],
  [9, -9],
  [12, 0],
  [9, 9],
  [0, 12],
  [-9, 9],
  [-12, 0],
  [-9, -9],
];
const TRAIL_MIN_DISTANCE_METERS = 0.2;
const ROAD_NODE_LABEL_RADII = [12, 18, 24, 30, 36, 42, 48, 54, 60];
const TRAIL_MAX_POINTS = 3000;
const COORDINATE_REFERENCE_POINTS = [
  { x: -3, y: 3 },
  { x: 0, y: 3 },
  { x: 3, y: 3 },
  { x: -3, y: 0 },
  { x: 0, y: 0 },
  { x: 3, y: 0 },
  { x: -3, y: -3 },
  { x: 0, y: -3 },
  { x: 3, y: -3 },
];

const defaultCalibration = {
  eastMeters: 0,
  northMeters: 0,
  rotationDeg: 0,
  scale: 1,
  vehicleScale: 1,
  vehicleRotationDeg: 0,
};

const vehicleColors = {
  online: '#22c55e',
  offline: '#94a3b8',
  charging: '#06b6d4',
  error: '#ef4444',
  paused: '#f59e0b',
};

const relocationCursorIcon = L.divIcon({
  className: 'semantic-relocation-cursor',
  html: '<div class="semantic-relocation-cursor-inner"><span></span></div>',
  iconSize: [34, 34],
  iconAnchor: [17, 17],
});

function createVehicleIcon(vehicle, headingOffset = 0, markerState = 'normal', missionColor = '') {
  const stateColor = markerState === 'running' ? missionColor : markerState === 'selected' ? '#2563eb' : null;
  const color = stateColor || vehicleColors[vehicle.status] || '#2563eb';
  const rotation = (vehicle.position?.theta || 0) + headingOffset;
  const stateClass = markerState === 'running' ? ' semantic-leaflet-vehicle-running' : markerState === 'selected' ? ' semantic-leaflet-vehicle-selected' : '';

  return L.divIcon({
    className: 'semantic-leaflet-vehicle',
    html: `
      <div class="semantic-leaflet-vehicle-wrap${stateClass}" style="--mission-color:${color};">
        <div class="semantic-leaflet-vehicle-inner" style="--vehicle-color:${color}; transform: rotate(${rotation}deg);">
          <span class="semantic-leaflet-vehicle-arrow"></span>
        </div>
        <span class="semantic-leaflet-vehicle-label">${vehicle.vehicleId}</span>
      </div>
    `,
    iconSize: [124, 34],
    iconAnchor: [21, 17],
  });
}

function createCoordinateIcon(point) {
  const label = `(${point.x}, ${point.y})`;

  return L.divIcon({
    className: 'semantic-coordinate-marker',
    html: `
      <div class="semantic-coordinate-marker-inner">
        <span class="semantic-coordinate-dot"></span>
        <span class="semantic-coordinate-label">${label}</span>
      </div>
    `,
    iconSize: [88, 28],
    iconAnchor: [9, 14],
  });
}

function roadNodeLabelsOverlap(first, second) {
  return !(
    first.right + 1 <= second.left
    || first.left >= second.right + 1
    || first.bottom + 1 <= second.top
    || first.top >= second.bottom + 1
  );
}

function formatMagnifierScale(zoom) {
  const scale = 2 ** (zoom - ROAD_NODE_SELECTION_ZOOM);
  const rounded = Math.round(scale * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function layoutRoadNodeLabels(nodes, zoom = ROAD_NODE_SELECTION_ZOOM, magnified = false) {
  const placedLabels = [];

  return nodes.map((node, index) => {
    const point = L.CRS.EPSG3857.latLngToPoint(L.latLng(node.latLng), zoom);
    const label = String(node.label || node.id);
    const labelWidth = magnified ? Math.max(24, label.length * 7 + 8) : Math.max(15, label.length * 5 + 5);
    const labelHeight = magnified ? 24 : 15;
    const order = Number.isFinite(Number(node.order)) ? Number(node.order) : index;
    const startDirection = Math.abs(order) % ROAD_NODE_LABEL_OFFSETS.length;
    let selectedOffset = ROAD_NODE_LABEL_OFFSETS[startDirection];
    let selectedBounds = null;

    for (const radius of ROAD_NODE_LABEL_RADII) {
      for (let directionIndex = 0; directionIndex < ROAD_NODE_LABEL_OFFSETS.length; directionIndex += 1) {
        const direction = ROAD_NODE_LABEL_OFFSETS[(startDirection + directionIndex) % ROAD_NODE_LABEL_OFFSETS.length];
        const scale = radius / 12;
        const offset = [Math.round(direction[0] * scale), Math.round(direction[1] * scale)];
        const centerX = point.x + offset[0];
        const centerY = point.y + offset[1];
        const bounds = {
          left: centerX - labelWidth / 2,
          right: centerX + labelWidth / 2,
          top: centerY - labelHeight / 2,
          bottom: centerY + labelHeight / 2,
        };

        if (!placedLabels.some((placed) => roadNodeLabelsOverlap(bounds, placed))) {
          selectedOffset = offset;
          selectedBounds = bounds;
          break;
        }
      }

      if (selectedBounds) break;
    }

    if (!selectedBounds) {
      const centerX = point.x + selectedOffset[0];
      const centerY = point.y + selectedOffset[1];
      selectedBounds = {
        left: centerX - labelWidth / 2,
        right: centerX + labelWidth / 2,
        top: centerY - labelHeight / 2,
        bottom: centerY + labelHeight / 2,
      };
    }

    placedLabels.push(selectedBounds);
    return selectedOffset;
  });
}

function createRoadNodeIcon(node, markerState = 'normal', missionColor = '', showLabel = false, labelOffset = [0, -12], magnified = false) {
  const stateClass = markerState === 'running' ? ' semantic-road-node-marker-running' : markerState === 'selected' ? ' semantic-road-node-marker-selected' : '';
  const labelClass = showLabel ? ' semantic-road-node-marker-labeled' : '';
  const magnifierClass = magnified ? ' semantic-road-node-marker-magnified' : '';
  const label = node.label || node.id;
  const style = ` style="--mission-color:${missionColor || '#0e639c'};--label-x:${labelOffset[0]}px;--label-y:${labelOffset[1]}px;"`;

  const iconSize = magnified ? 24 : 14;

  return L.divIcon({
    className: `semantic-road-node-marker${stateClass}${labelClass}${magnifierClass}`,
    html: `
      <div class="semantic-road-node-marker-inner"${style}>
        <span class="semantic-road-node-dot"></span>
        ${showLabel ? `<span class="semantic-road-node-label">${label}</span>` : ''}
      </div>
    `,
    iconSize: [iconSize, iconSize],
    iconAnchor: [iconSize / 2, iconSize / 2],
    title: `${label} / ${node.sourceId || node.id}: (${node.x.toFixed(1)}, ${node.y.toFixed(1)})`,
  });
}
function createRoadEdgeArrowIcon(angleDeg) {
  return L.divIcon({
    className: 'semantic-road-edge-arrow',
    html: `
      <span class="semantic-road-edge-arrow-inner" style="transform: rotate(${angleDeg}deg);"></span>
    `,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

function applyRoadGraphLabels(graph, labelsData) {
  if (!graph?.nodes?.length) return graph;

  const labelMap = new Map(
    (labelsData?.labels || [])
      .filter((item) => item?.sourceId && item?.label)
      .map((item) => [String(item.sourceId), String(item.label)]),
  );

  if (!labelMap.size) return graph;

  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const sourceId = String(node.sourceId || node.id);
      return {
        ...node,
        sourceId,
        label: labelMap.get(sourceId) || node.label || node.id,
      };
    }),
  };
}

function metersToLatLng(center, eastMeters, northMeters) {
  const lat = center[0] + northMeters / 111320;
  const lng = center[1] + eastMeters / (111320 * Math.cos((center[0] * Math.PI) / 180));
  return [lat, lng];
}

function latLngToMeters(center, latLng) {
  const lat = Array.isArray(latLng) ? latLng[0] : latLng.lat;
  const lng = Array.isArray(latLng) ? latLng[1] : latLng.lng;
  return {
    east: (lng - center[1]) * 111320 * Math.cos((center[0] * Math.PI) / 180),
    north: (lat - center[0]) * 111320,
  };
}

function rotateMeters(eastMeters, northMeters, rotationDeg = 0) {
  const rad = (rotationDeg * Math.PI) / 180;
  return {
    east: eastMeters * Math.cos(rad) - northMeters * Math.sin(rad),
    north: eastMeters * Math.sin(rad) + northMeters * Math.cos(rad),
  };
}

function pcdBoundsCenter(semanticMap) {
  const bounds = semanticMap.bounds;
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
}

function pcdToLatLng(x, y, semanticMap, registration) {
  const bounds = semanticMap.bounds;
  const center = pcdBoundsCenter(semanticMap);
  const scale = registration.metersPerPcdMeter || 1;
  const rotated = rotateMeters((x - center.x) * scale, (y - center.y) * scale, registration.rotationDeg || 0);
  return metersToLatLng(registration.center, rotated.east, rotated.north);
}

function latLngToPcd(latLng, semanticMap, registration) {
  const center = pcdBoundsCenter(semanticMap);
  const scale = registration.metersPerPcdMeter || 1;
  const meters = latLngToMeters(registration.center, latLng);
  const unrotated = rotateMeters(meters.east, meters.north, -(registration.rotationDeg || 0));

  return {
    x: center.x + unrotated.east / scale,
    y: center.y + unrotated.north / scale,
  };
}

function vehicleTransformRotation(registration, calibrationRotationDeg = 0) {
  return (registration.vehicleTransform?.rotationDeg || 0) + calibrationRotationDeg;
}

function applyVehicleTransform(localPosition, registration, calibrationScale = 1, calibrationRotationDeg = 0) {
  const vehicleTransform = registration.vehicleTransform || {};
  const origin = vehicleTransform.origin || [0, 0];
  const scale = (vehicleTransform.scale || 1) * calibrationScale;
  const rotated = rotateMeters(
    (localPosition.x - origin[0]) * scale,
    (localPosition.y - origin[1]) * scale,
    vehicleTransformRotation(registration, calibrationRotationDeg),
  );

  return {
    x: origin[0] + rotated.east,
    y: origin[1] + rotated.north,
  };
}

function localToLatLng(localPosition, semanticMap, registration, calibrationScale = 1, calibrationRotationDeg = 0) {
  const transformedPosition = applyVehicleTransform(localPosition, registration, calibrationScale, calibrationRotationDeg);
  return pcdToLatLng(transformedPosition.x, transformedPosition.y, semanticMap, registration);
}

function addDisplayOffset(displayPosition, offset) {
  return {
    x: displayPosition.x + offset.x,
    y: displayPosition.y + offset.y,
  };
}

function displayPositionToLatLng(displayPosition, semanticMap, registration, offset = { x: 0, y: 0 }) {
  const shifted = addDisplayOffset(displayPosition, offset);
  return pcdToLatLng(shifted.x, shifted.y, semanticMap, registration);
}

function shouldAppendTrailPoint(points, point) {
  const lastPoint = points[points.length - 1];
  if (!lastPoint) return true;
  return Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y) >= TRAIL_MIN_DISTANCE_METERS;
}

function cloneVehiclePoint(position) {
  return {
    x: Number(position.x) || 0,
    y: Number(position.y) || 0,
  };
}

function latestVehicle(mappedVehicles) {
  return mappedVehicles.reduce((latest, current) => {
    if (!latest) return current;
    return (current.vehicle.lastUpdate || 0) > (latest.vehicle.lastUpdate || 0) ? current : latest;
  }, null);
}

function applyCalibration(registration, calibration) {
  if (!registration) return null;
  return {
    ...registration,
    center: metersToLatLng(registration.center, calibration.eastMeters, calibration.northMeters),
    rotationDeg: (registration.rotationDeg || 0) + calibration.rotationDeg,
    metersPerPcdMeter: (registration.metersPerPcdMeter || 1) * calibration.scale,
  };
}

function overlayCorners(semanticMap, registration) {
  const bounds = semanticMap.bounds;
  return {
    topLeft: pcdToLatLng(bounds.minX, bounds.maxY, semanticMap, registration),
    topRight: pcdToLatLng(bounds.maxX, bounds.maxY, semanticMap, registration),
    bottomLeft: pcdToLatLng(bounds.minX, bounds.minY, semanticMap, registration),
    bottomRight: pcdToLatLng(bounds.maxX, bounds.minY, semanticMap, registration),
  };
}

function cornerBounds(corners) {
  return L.latLngBounds([
    corners.topLeft,
    corners.topRight,
    corners.bottomLeft,
    corners.bottomRight,
  ]);
}

function fitFallbackBounds(semanticMap, registration) {
  if (registration.bounds?.southWest && registration.bounds?.northEast) {
    return L.latLngBounds(registration.bounds.southWest, registration.bounds.northEast);
  }

  const bounds = semanticMap.bounds;
  const widthMeters = (bounds.maxX - bounds.minX) * (registration.metersPerPcdMeter || 1);
  const heightMeters = (bounds.maxY - bounds.minY) * (registration.metersPerPcdMeter || 1);
  const halfWidth = widthMeters / 2;
  const halfHeight = heightMeters / 2;

  return L.latLngBounds([
    metersToLatLng(registration.center, -halfWidth, -halfHeight),
    metersToLatLng(registration.center, halfWidth, halfHeight),
  ]);
}

function FixInitialView({ center, zoom }) {
  const map = useMap();
  const appliedRef = React.useRef(false);

  useEffect(() => {
    if (appliedRef.current) return;
    if (!center) return;

    map.setView(center, zoom || 18, { animate: false });
    appliedRef.current = true;

    return () => {
      appliedRef.current = false;
    }
  }, [map, center, zoom]);

  return null;
}

function RoadNodeSelectionZoom({ active }) {
  const map = useMap();

  useEffect(() => {
    if (!active) return undefined;

    const previousMinZoom = map.getMinZoom();
    map.setMinZoom(ROAD_NODE_SELECTION_ZOOM);
    if (map.getZoom() < ROAD_NODE_SELECTION_ZOOM) {
      map.setZoom(ROAD_NODE_SELECTION_ZOOM, { animate: true });
    }

    return () => map.setMinZoom(previousMinZoom);
  }, [active, map]);

  return null;
}


function RotatedOverlay({ url, corners, opacity, className, imageSize }) {
  const map = useMap();

  useEffect(() => {
    const image = L.DomUtil.create('img', `leaflet-image-layer ${className}`);
    const width = imageSize?.width || 1;
    const height = imageSize?.height || 1;

    image.src = url;
    image.alt = '';
    image.style.width = `${width}px`;
    image.style.height = `${height}px`;
    image.style.opacity = String(opacity);

    const updateTransform = () => {
      const topLeft = map.latLngToLayerPoint(corners.topLeft);
      const topRight = map.latLngToLayerPoint(corners.topRight);
      const bottomLeft = map.latLngToLayerPoint(corners.bottomLeft);
      const a = (topRight.x - topLeft.x) / width;
      const b = (topRight.y - topLeft.y) / width;
      const c = (bottomLeft.x - topLeft.x) / height;
      const d = (bottomLeft.y - topLeft.y) / height;
      image.style.transform = `matrix(${a}, ${b}, ${c}, ${d}, ${topLeft.x}, ${topLeft.y})`;
    };

    map.getPanes().overlayPane.appendChild(image);
    updateTransform();
    map.on('zoom move moveend zoomend viewreset resize', updateTransform);

    return () => {
      map.off('zoom move moveend zoomend viewreset resize', updateTransform);
      image.remove();
    };
  }, [map, url, corners, opacity, className, imageSize]);

  return null;
}

function calculateMagnifierFrame(map, containerPoint) {
  const size = map.getSize();
  const compact = window.innerWidth <= 860;
  const availableWidth = Math.max(160, size.x - 24);
  const availableHeight = Math.max(140, size.y - 24);
  const width = Math.min(compact ? 300 : 340, availableWidth);
  const height = Math.min(compact ? 220 : 260, availableHeight);

  return {
    left: Math.round(containerPoint.x + ROAD_NODE_MAGNIFIER_POINTER_GAP),
    top: Math.round(containerPoint.y + ROAD_NODE_MAGNIFIER_POINTER_GAP),
    width,
    height,
  };
}

function MagnifierTracker({ active, onCenterChange, onPositionChange, onZoomChange }) {
  const map = useMap();

  useMapEvents({
    mousemove(event) {
      if (!active) return;
      onCenterChange(event.latlng);
      onPositionChange(calculateMagnifierFrame(map, event.containerPoint));
    },
  });

  useEffect(() => {
    if (!active) {
      onPositionChange(null);
      return;
    }

    const center = map.getCenter();
    onCenterChange(center);
    onPositionChange(calculateMagnifierFrame(map, map.latLngToContainerPoint(center)));
  }, [active, map, onCenterChange, onPositionChange]);

  useEffect(() => {
    const container = map.getContainer();
    const handleWheel = (event) => {
      if (!active) return;

      event.preventDefault();
      event.stopPropagation();
      const pixelDelta = event.deltaMode === 1
        ? event.deltaY * 16
        : event.deltaMode === 2
          ? event.deltaY * map.getSize().y
          : event.deltaY;
      const zoomDelta = -Math.max(-160, Math.min(160, pixelDelta))
        * ROAD_NODE_MAGNIFIER_WHEEL_SENSITIVITY;
      onZoomChange((current) => Math.min(
        ROAD_NODE_MAGNIFIER_MAX_ZOOM,
        Math.max(ROAD_NODE_MAGNIFIER_MIN_ZOOM, current + zoomDelta),
      ));
    };

    container.addEventListener('wheel', handleWheel, { passive: false, capture: true });
    return () => {
      container.removeEventListener('wheel', handleWheel, true);
    };
  }, [active, map, onZoomChange]);

  return null;
}

function SyncMagnifierView({ center, zoom }) {
  const map = useMap();

  useEffect(() => {
    if (center) map.setView(center, zoom, { animate: false });
  }, [center, map, zoom]);

  return null;
}

function RoadNodeMagnifier({
  center,
  position,
  zoom,
  tileSource,
  corners,
  registration,
  roadGraphLayer,
  missionPathLines,
  roadNodeMarkerState,
  roadNodeMissionColor,
  onRoadNodeSelect,
}) {
  return (
    <div className="semantic-road-magnifier" style={position}>
      <div className="semantic-road-magnifier-badge">
        <ZoomInOutlined />
        <span>{formatMagnifierScale(zoom)}×</span>
      </div>
      <span className="semantic-road-magnifier-reticle" />
      <MapContainer
        className="semantic-road-magnifier-map"
        center={center}
        zoom={zoom}
        minZoom={ROAD_NODE_MAGNIFIER_MIN_ZOOM}
        maxZoom={ROAD_NODE_MAGNIFIER_MAX_ZOOM}
        zoomSnap={0}
        zoomControl={false}
        attributionControl={false}
        dragging={false}
        scrollWheelZoom={false}
        doubleClickZoom={false}
        boxZoom={false}
        keyboard={false}
      >
        <SyncMagnifierView center={center} zoom={zoom} />
        <TileLayer
          url={tileSource.url}
          subdomains={tileSource.subdomains}
          crossOrigin="anonymous"
          maxNativeZoom={19}
          maxZoom={ROAD_NODE_MAGNIFIER_MAX_ZOOM}
        />
        {corners && (
          <RotatedOverlay
            url={registration.image.semantic}
            corners={corners}
            opacity={SEMANTIC_OPACITY}
            className="pcd-semantic-overlay"
            imageSize={registration.image}
          />
        )}
        {corners && (
          <RotatedOverlay
            url={registration.image.pointCloud}
            corners={corners}
            opacity={POINT_CLOUD_OPACITY}
            className="pcd-pointcloud-overlay"
            imageSize={registration.image}
          />
        )}
        {roadGraphLayer.edges.map((edge) => (
          <Polyline
            key={`magnifier-${edge.id}`}
            positions={edge.positions}
            pathOptions={{ color: '#0f766e', weight: 4, opacity: 0.9 }}
            interactive={false}
          />
        ))}
        {missionPathLines.map((mission) => (
          <Polyline
            key={`magnifier-mission-${mission.vehicleId}`}
            positions={mission.positions}
            pathOptions={{ color: mission.color, weight: 6, opacity: 0.96 }}
            interactive={false}
          />
        ))}
        {roadGraphLayer.nodes.map((node) => (
          <Marker
            key={`magnifier-${node.id}`}
            position={node.latLng}
            icon={createRoadNodeIcon(
              node,
              roadNodeMarkerState(node.id),
              roadNodeMissionColor(node.id),
              true,
              node.magnifierLabelOffset,
              true,
            )}
            zIndexOffset={1000}
            interactive={false}
          />
        ))}
      </MapContainer>
    </div>
  );
}


function RelocationPicker({ active, cursorLatLng, onCursorChange, onPick }) {
  useMapEvents({
    mousemove(event) {
      if (active) onCursorChange(event.latlng);
    },
    click(event) {
      if (active) onPick(event.latlng);
    },
  });

  useEffect(() => {
    if (!active) onCursorChange(null);
  }, [active, onCursorChange]);

  if (!active || !cursorLatLng) return null;

  return <Marker position={cursorLatLng} icon={relocationCursorIcon} interactive={false} />;
}

function SemanticMapCanvas({
  vehicles,
  showCoordinatePoints = false,
  recordingTrails = false,
  relocatingVehicle = false,
  onRelocatingVehicleChange,
  onControl,
  onCancelMission,
  selectedVehicleId = '',
  selectedRoadNodeId = '',
  roadNodeSelectionActive = false,
  missionStates = {},
  onRoadGraphLoad,
  onRoadNodeSelect,
}) {
  const [semanticMap, setSemanticMap] = useState(null);
  const [registration, setRegistration] = useState(null);
  const [calibration, setCalibration] = useState(() => {
    try {
      return { ...defaultCalibration, ...JSON.parse(localStorage.getItem(CALIBRATION_STORAGE_KEY) || '{}') };
    } catch (_err) {
      return defaultCalibration;
    }
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [roadGraph, setRoadGraph] = useState(null);
  const [vehicleTrails, setVehicleTrails] = useState({});
  const [relocationOffset, setRelocationOffset] = useState({ x: 0, y: 0 });
  const [relocationCursorLatLng, setRelocationCursorLatLng] = useState(null);
  const [tileSourceIndex, setTileSourceIndex] = useState(0);
  const [registrationPanelOpen, setRegistrationPanelOpen] = useState(false);
  const [magnifierCenter, setMagnifierCenter] = useState(null);
  const [magnifierPosition, setMagnifierPosition] = useState(null);
  const [magnifierZoom, setMagnifierZoom] = useState(ROAD_NODE_MAGNIFIER_DEFAULT_ZOOM);

  useEffect(() => {
    if (roadNodeSelectionActive) {
      setMagnifierZoom(ROAD_NODE_MAGNIFIER_DEFAULT_ZOOM);
    }
  }, [roadNodeSelectionActive]);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetch(MAP_URL).then((response) => {
        if (!response.ok) throw new Error(`语义地图加载失败: ${response.status}`);
        return response.json();
      }),
      fetch(REGISTRATION_URL).then((response) => {
        if (!response.ok) throw new Error(`配准文件加载失败: ${response.status}`);
        return response.json();
      }),
      fetch(ROAD_GRAPH_URL).then((response) => {
        if (!response.ok) return null;
        return response.json();
      }),
      fetch(ROAD_GRAPH_LABELS_URL).then((response) => {
        if (!response.ok) return null;
        return response.json();
      }).catch(() => null),
    ])
      .then(([mapData, registrationData, roadGraphData, roadGraphLabels]) => {
        if (!cancelled) {
          const labeledRoadGraph = applyRoadGraphLabels(roadGraphData, roadGraphLabels);
          setSemanticMap(mapData);
          setRegistration(registrationData);
          setRoadGraph(labeledRoadGraph);
          onRoadGraphLoad?.(labeledRoadGraph);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(calibration));
  }, [calibration]);

  useEffect(() => {
    setTileSourceIndex(0);
  }, [registration?.center?.[0], registration?.center?.[1], registration?.zoom]);

  const effectiveRegistration = useMemo(() => applyCalibration(registration, calibration), [registration, calibration]);

  const corners = useMemo(() => {
    if (!semanticMap || !effectiveRegistration) return null;
    return overlayCorners(semanticMap, effectiveRegistration);
  }, [semanticMap, effectiveRegistration]);

  const mappedVehicles = useMemo(() => {
    if (!semanticMap || !effectiveRegistration) return [];
    return vehicles
      .filter((vehicle) => vehicle.position)
      .map((vehicle) => ({
        vehicle,
        baseDisplayPosition: applyVehicleTransform(
          vehicle.position,
          effectiveRegistration,
          calibration.vehicleScale,
          calibration.vehicleRotationDeg,
        ),
      }))
      .map(({ vehicle, baseDisplayPosition }) => ({
        vehicle,
        baseDisplayPosition,
        displayPosition: addDisplayOffset(baseDisplayPosition, relocationOffset),
        latLng: displayPositionToLatLng(baseDisplayPosition, semanticMap, effectiveRegistration, relocationOffset),
      }));
  }, [vehicles, semanticMap, effectiveRegistration, calibration.vehicleScale, calibration.vehicleRotationDeg, relocationOffset]);

  const trailLines = useMemo(() => {
    if (!semanticMap || !effectiveRegistration) return [];
    return Object.entries(vehicleTrails).map(([vehicleId, points]) => ({
      vehicleId,
      positions: points.map((point) => {
        const displayPoint = applyVehicleTransform(
          point,
          effectiveRegistration,
          calibration.vehicleScale,
          calibration.vehicleRotationDeg,
        );
        return displayPositionToLatLng(displayPoint, semanticMap, effectiveRegistration, relocationOffset);
      }),
    }));
  }, [vehicleTrails, semanticMap, effectiveRegistration, calibration.vehicleScale, calibration.vehicleRotationDeg, relocationOffset]);

  const coordinateMarkers = useMemo(() => {
    if (!showCoordinatePoints || !semanticMap || !effectiveRegistration) return [];

    return COORDINATE_REFERENCE_POINTS.map((point) => ({
      point,
      latLng: pcdToLatLng(point.x, point.y, semanticMap, effectiveRegistration),
    }));
  }, [
    showCoordinatePoints,
    semanticMap,
    effectiveRegistration,
  ]);

  const roadGraphLayer = useMemo(() => {
    if (!roadGraph || !semanticMap || !effectiveRegistration) {
      return { nodes: [], edges: [] };
    }

    const nodesById = new Map(roadGraph.nodes.map((node) => [
      node.id,
      {
        ...node,
        latLng: pcdToLatLng(node.x, node.y, semanticMap, effectiveRegistration),
      },
    ]));

    const nodes = Array.from(nodesById.values());
    const labelOffsets = layoutRoadNodeLabels(nodes);
    const magnifierLabelOffsets = layoutRoadNodeLabels(nodes, magnifierZoom, true);

    return {
      nodes: nodes.map((node, index) => ({
        ...node,
        labelOffset: labelOffsets[index],
        magnifierLabelOffset: magnifierLabelOffsets[index],
      })),
      edges: roadGraph.edges
        .map((edge) => {
          const source = nodesById.get(edge.source);
          const target = nodesById.get(edge.target);
          if (!source || !target) return null;
          const arrowPosition = [
            source.latLng[0] + (target.latLng[0] - source.latLng[0]) * 0.9,
            source.latLng[1] + (target.latLng[1] - source.latLng[1]) * 0.9,
          ];
          const arrowAngleDeg = (Math.atan2(
            source.latLng[0] - target.latLng[0],
            target.latLng[1] - source.latLng[1],
          ) * 180) / Math.PI;
          return {
            ...edge,
            positions: [source.latLng, target.latLng],
            arrowPosition,
            arrowAngleDeg,
            directed: roadGraph.directed === true || edge.directed === true,
          };
        })
        .filter(Boolean),
    };
  }, [roadGraph, semanticMap, effectiveRegistration, magnifierZoom]);

  const missionPathLines = useMemo(() => {
    if (!semanticMap || !effectiveRegistration) return [];

    return Object.entries(missionStates)
      .filter(([, mission]) => mission?.status === 'running' && mission.pathPoints?.length > 1)
      .map(([vehicleId, mission]) => ({
        vehicleId,
        color: mission.color,
        positions: mission.pathPoints.map((point) => (
          pcdToLatLng(Number(point.x) || 0, Number(point.y) || 0, semanticMap, effectiveRegistration)
        )),
      }));
  }, [missionStates, semanticMap, effectiveRegistration]);

  const runningTargetNodeIds = useMemo(() => {
    const targets = new Map();
    Object.values(missionStates)
      .filter((mission) => mission?.status === 'running')
      .forEach((mission) => {
        if (!mission.targetNodeId || targets.has(mission.targetNodeId)) return;
        targets.set(mission.targetNodeId, mission.color);
      });
    return targets;
  }, [missionStates]);

  const missionItems = useMemo(() => (
    Object.entries(missionStates)
      .filter(([, mission]) => mission?.status === 'running')
      .map(([vehicleId, mission]) => ({
        vehicleId,
        ...mission,
      }))
      .sort((a, b) => a.startedAt - b.startedAt)
  ), [missionStates]);

  const vehicleMarkerState = (vehicleId) => {
    if (missionStates[vehicleId]?.status === 'running') return 'running';
    if (selectedVehicleId && selectedVehicleId === vehicleId) return 'selected';
    return 'normal';
  };

  const roadNodeMarkerState = (nodeId) => {
    if (runningTargetNodeIds.has(nodeId)) return 'running';
    if (selectedRoadNodeId && selectedRoadNodeId === nodeId) return 'selected';
    return 'normal';
  };

  const vehicleMissionColor = (vehicleId) => missionStates[vehicleId]?.color || '';
  const roadNodeMissionColor = (nodeId) => runningTargetNodeIds.get(nodeId) || '';

  useEffect(() => {
    if (!recordingTrails) {
      setVehicleTrails({});
      return;
    }

    setVehicleTrails((currentTrails) => {
      let changed = false;
      const nextTrails = { ...currentTrails };

      mappedVehicles.forEach(({ vehicle }) => {
        const currentPoints = nextTrails[vehicle.vehicleId] || [];
        const nextPoint = cloneVehiclePoint(vehicle.position);
        if (!shouldAppendTrailPoint(currentPoints, nextPoint)) return;

        nextTrails[vehicle.vehicleId] = [...currentPoints, nextPoint].slice(-TRAIL_MAX_POINTS);
        changed = true;
      });

      return changed ? nextTrails : currentTrails;
    });
  }, [mappedVehicles, recordingTrails]);

  const pickRelocationTarget = (targetLatLng) => {
    if (!semanticMap || !effectiveRegistration) return;

    const anchorVehicle = latestVehicle(mappedVehicles);
    if (anchorVehicle) {
      const targetDisplayPosition = latLngToPcd(targetLatLng, semanticMap, effectiveRegistration);
      setRelocationOffset({
        x: targetDisplayPosition.x - anchorVehicle.baseDisplayPosition.x,
        y: targetDisplayPosition.y - anchorVehicle.baseDisplayPosition.y,
      });
    }

    setRelocationCursorLatLng(null);
    onRelocatingVehicleChange?.(false);
  };

  const updateCalibration = (patch) => {
    setCalibration((current) => ({ ...current, ...patch }));
  };

  const updateVehicleDisplayCalibration = (patch) => {
    const nextVehicleScale = patch.vehicleScale ?? calibration.vehicleScale;
    const nextVehicleRotationDeg = patch.vehicleRotationDeg ?? calibration.vehicleRotationDeg;
    const anchorVehicle = latestVehicle(mappedVehicles);

    if (anchorVehicle && effectiveRegistration) {
      const nextBaseDisplayPosition = applyVehicleTransform(
        anchorVehicle.vehicle.position,
        effectiveRegistration,
        nextVehicleScale,
        nextVehicleRotationDeg,
      );
      setRelocationOffset({
        x: anchorVehicle.displayPosition.x - nextBaseDisplayPosition.x,
        y: anchorVehicle.displayPosition.y - nextBaseDisplayPosition.y,
      });
    }

    updateCalibration(patch);
  };

  const nudgeCalibration = (eastMeters, northMeters) => {
    setCalibration((current) => ({
      ...current,
      eastMeters: Number((current.eastMeters + eastMeters).toFixed(1)),
      northMeters: Number((current.northMeters + northMeters).toFixed(1)),
    }));
  };

  const resetCalibration = () => {
    setCalibration(defaultCalibration);
  };

  if (loading) {
    return (
      <div className="semantic-map-loading">
        <Spin />
      </div>
    );
  }

  if (error) {
    return <Alert type="error" message="点云地图加载失败" description={error} showIcon />;
  }

  return (
    <div className="semantic-map-shell">
      <div className="semantic-map-toolbar">
        <div>
          <strong>北理工中关村校区6号楼点云配准地图</strong>
          <span>
            {semanticMap.source}: {semanticMap.pointCount.toLocaleString()} 点 / {semanticMap.cells.length.toLocaleString()} 栅格 /
            分辨率 {semanticMap.resolution}m
          </span>
        </div>
        <div className="semantic-map-tags">
          {Object.entries(semanticMap.semantics).map(([key, item]) => (
            <Tag key={key} color={item.color}>
              {item.label}
            </Tag>
          ))}
        </div>
      </div>

      <div className="semantic-map-tool-row">
        <Button
          className="semantic-registration-toggle"
          icon={<ToolOutlined />}
          onClick={() => setRegistrationPanelOpen((current) => !current)}
          aria-expanded={registrationPanelOpen}
        >
          点云手动匹配
          <DownOutlined className={registrationPanelOpen ? 'is-open' : ''} />
        </Button>
        {roadNodeSelectionActive && (
          <Tag color="processing" className="semantic-selection-status">
            地图选点模式 · {formatMagnifierScale(magnifierZoom)}× 跟随放大
          </Tag>
        )}
        {relocatingVehicle && (
          <Tag color="processing" className="semantic-relocation-status">
            重定位模式: 移动鼠标预览，点击地图确认
          </Tag>
        )}
      </div>

      <div className="semantic-registration-controls" hidden={!registrationPanelOpen}>
        <div className="semantic-registration-nudge">
          <Button size="small" onClick={() => nudgeCalibration(0, CALIBRATION_STEP_METERS)}>
            北移
          </Button>
          <Button size="small" onClick={() => nudgeCalibration(0, -CALIBRATION_STEP_METERS)}>
            南移
          </Button>
          <Button size="small" onClick={() => nudgeCalibration(-CALIBRATION_STEP_METERS, 0)}>
            西移
          </Button>
          <Button size="small" onClick={() => nudgeCalibration(CALIBRATION_STEP_METERS, 0)}>
            东移
          </Button>
          <Button size="small" onClick={resetCalibration}>
            重置
          </Button>
        </div>
        <label>
          旋转
          <Slider
            className="semantic-registration-slider"
            min={-180}
            max={180}
            step={0.5}
            value={calibration.rotationDeg}
            onChange={(value) => updateCalibration({ rotationDeg: value })}
          />
          <span>{calibration.rotationDeg.toFixed(1)}°</span>
        </label>
        <label>
          缩放
          <Slider
            className="semantic-registration-slider"
            min={0.6}
            max={1.6}
            step={0.01}
            value={calibration.scale}
            onChange={(value) => updateCalibration({ scale: value })}
          />
          <span>{calibration.scale.toFixed(2)}x</span>
        </label>
        <label>
          车辆比例
          <Slider
            className="semantic-registration-slider"
            min={0.5}
            max={12}
            step={0.1}
            value={calibration.vehicleScale}
            onChange={(value) => updateVehicleDisplayCalibration({ vehicleScale: value })}
          />
          <span>{(((effectiveRegistration.vehicleTransform?.scale || 1) * calibration.vehicleScale)).toFixed(1)}x</span>
        </label>
        <label>
          车辆旋转
          <Slider
            className="semantic-registration-slider"
            min={-180}
            max={180}
            step={0.5}
            value={calibration.vehicleRotationDeg}
            onChange={(value) => updateVehicleDisplayCalibration({ vehicleRotationDeg: value })}
          />
          <span>{vehicleTransformRotation(effectiveRegistration, calibration.vehicleRotationDeg).toFixed(1)}°</span>
        </label>
      </div>

      <div className="semantic-map-body">
        <aside className="semantic-mission-panel">
          <div className="semantic-mission-panel-title">任务列表</div>
          {missionItems.length ? (
            <div className="semantic-mission-list">
              {missionItems.map((mission) => (
                <div
                  key={mission.vehicleId}
                  className="semantic-mission-item"
                  style={{ '--mission-color': mission.color }}
                >
                  <span className="semantic-mission-swatch"></span>
                  <div>
                    <strong>{mission.vehicleId}</strong>
                    <span>目标 {mission.targetNodeLabel || mission.targetNodeId}</span>
                  </div>
                  <Button size="small" danger icon={<StopOutlined />} onClick={() => onCancelMission?.(mission.vehicleId)}>
                    取消
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="semantic-mission-empty">暂无执行中任务</div>
          )}
        </aside>

        <div className="semantic-map-stage">
        <MapContainer
          className={`semantic-leaflet-map${roadNodeSelectionActive ? ' is-selecting-road-node' : ''}`}
          center={registration.center}
          zoom={registration.zoom || 18}
          minZoom={16}
          maxZoom={21}
          scrollWheelZoom
        >
        <FixInitialView center={registration.center} zoom={registration.zoom || 18} />
        <RoadNodeSelectionZoom active={roadNodeSelectionActive} />
        <MagnifierTracker
          active={roadNodeSelectionActive}
          onCenterChange={setMagnifierCenter}
          onPositionChange={setMagnifierPosition}
          onZoomChange={setMagnifierZoom}
        />
        <TileLayer
          key={tileSourceIndex}
          attribution={BASE_TILE_SOURCES[tileSourceIndex].attribution}
          url={BASE_TILE_SOURCES[tileSourceIndex].url}
          subdomains={BASE_TILE_SOURCES[tileSourceIndex].subdomains}
          crossOrigin="anonymous"
          maxNativeZoom={19}
          maxZoom={21}
          eventHandlers={{
            tileerror: () => {
              setTileSourceIndex((current) => {
                if (current >= BASE_TILE_SOURCES.length - 1) return current;
                return current + 1;
              });
            },
          }}
        />

        {corners && (
          <RotatedOverlay
            url={registration.image.semantic}
            corners={corners}
            opacity={SEMANTIC_OPACITY}
            className="pcd-semantic-overlay"
            imageSize={registration.image}
          />
        )}
        {corners && (
          <RotatedOverlay
            url={registration.image.pointCloud}
            corners={corners}
            opacity={POINT_CLOUD_OPACITY}
            className="pcd-pointcloud-overlay"
            imageSize={registration.image}
          />
        )}

        <RelocationPicker
          active={relocatingVehicle}
          cursorLatLng={relocationCursorLatLng}
          onCursorChange={setRelocationCursorLatLng}
          onPick={pickRelocationTarget}
        />

        {roadGraphLayer.edges.map((edge) => (
          <Polyline
            key={edge.id}
            positions={edge.positions}
            pathOptions={{ color: '#0f766e', weight: 5, opacity: 0.9 }}
          />
        ))}

        {missionPathLines.map((mission) => (
          <Polyline
            key={`mission-${mission.vehicleId}`}
            positions={mission.positions}
            pathOptions={{
              color: mission.color,
              weight: 7,
              opacity: 0.96,
              lineCap: 'round',
              lineJoin: 'round',
            }}
            interactive={false}
          />
        ))}

        {roadGraphLayer.edges
          .filter((edge) => edge.directed)
          .map((edge) => (
            <Marker
              key={`${edge.id}-arrow`}
              position={edge.arrowPosition}
              icon={createRoadEdgeArrowIcon(edge.arrowAngleDeg)}
              interactive={false}
            />
          ))}

        {roadGraphLayer.nodes.map((node) => (
          <Marker
            key={node.id}
            position={node.latLng}
            icon={createRoadNodeIcon(
              node,
              roadNodeMarkerState(node.id),
              roadNodeMissionColor(node.id),
              roadNodeSelectionActive,
              node.labelOffset,
            )}
            interactive={roadNodeSelectionActive}
            zIndexOffset={roadNodeMarkerState(node.id) === 'normal' ? 400 : 800}
            eventHandlers={roadNodeSelectionActive ? { click: () => onRoadNodeSelect?.(node) } : undefined}
          />
        ))}

        {trailLines.map(({ vehicleId, positions }) => (
          positions.length > 1 ? (
            <Polyline
              key={vehicleId}
              positions={positions}
              pathOptions={{ color: '#2563eb', weight: 4, opacity: 0.86 }}
            />
          ) : null
        ))}

        {coordinateMarkers.map(({ point, latLng }) => (
          <Marker
            key={`${point.x}-${point.y}`}
            position={latLng}
            icon={createCoordinateIcon(point)}
            interactive={false}
          />
        ))}

        {mappedVehicles.map(({ vehicle, latLng, displayPosition }) => (
          <Marker
            key={vehicle.vehicleId}
            position={latLng}
            icon={createVehicleIcon(
              vehicle,
              (effectiveRegistration.rotationDeg || 0) + vehicleTransformRotation(effectiveRegistration, calibration.vehicleRotationDeg),
              vehicleMarkerState(vehicle.vehicleId),
              vehicleMissionColor(vehicle.vehicleId),
            )}
          >
            <Popup>
              <div className="semantic-popup">
                <strong>{vehicle.vehicleId}</strong>
                <span>状态: {vehicle.status}</span>
                <span>电量: {vehicle.battery}%</span>
                <span>
                  原始坐标: {vehicle.position.x.toFixed(1)}, {vehicle.position.y.toFixed(1)}
                </span>
                <span>
                  显示坐标: {displayPosition.x.toFixed(1)}, {displayPosition.y.toFixed(1)}
                </span>
                <Space wrap>
                  <Button size="small" icon={<PlayCircleOutlined />} onClick={() => onControl(vehicle.vehicleId, 'START')}>
                    启动
                  </Button>
                  <Button size="small" icon={<PauseCircleOutlined />} onClick={() => onControl(vehicle.vehicleId, 'PAUSE')}>
                    暂停
                  </Button>
                  <Button size="small" icon={<StopOutlined />} onClick={() => onControl(vehicle.vehicleId, 'STOP')}>
                    停止
                  </Button>
                </Space>
              </div>
            </Popup>
          </Marker>
        ))}
        </MapContainer>
        {roadNodeSelectionActive && magnifierPosition && (
          <RoadNodeMagnifier
            center={magnifierCenter || registration.center}
            position={magnifierPosition}
            zoom={magnifierZoom}
            tileSource={BASE_TILE_SOURCES[tileSourceIndex]}
            corners={corners}
            registration={registration}
            roadGraphLayer={roadGraphLayer}
            missionPathLines={missionPathLines}
            roadNodeMarkerState={roadNodeMarkerState}
            roadNodeMissionColor={roadNodeMissionColor}
            onRoadNodeSelect={onRoadNodeSelect}
          />
        )}
        </div>
      </div>

      <div className="semantic-map-footer">
        <span>
          当前中心: {effectiveRegistration.center[0].toFixed(6)}, {effectiveRegistration.center[1].toFixed(6)}，
          旋转 {effectiveRegistration.rotationDeg.toFixed(1)}°，平移 E {calibration.eastMeters.toFixed(1)}m / N{' '}
          {calibration.northMeters.toFixed(1)}m
        </span>
        <span>{registration.description}</span>
      </div>
    </div>
  );
}

export default SemanticMapCanvas;
