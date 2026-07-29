import React, { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import { Button, Card, InputNumber, Select, Segmented, message } from 'antd';
import {
  AimOutlined,
  EnvironmentOutlined,
  ExperimentOutlined,
  NumberOutlined,
  PlayCircleOutlined,
  SendOutlined,
  StopOutlined,
} from '@ant-design/icons';
import vehicleManager from '../services/vehicleManager';
import mqttService from '../services/mqttService';
import vda5050Helper from '../utils/vda5050Helper';
import { buildCloudPathPoints, coordinateCloudPath } from '../utils/roadGraphPlanner';
import SemanticMapCanvas from '../components/SemanticMapCanvas';
import './FleetMonitor.css';

const SIM_VEHICLE_ID = 'robot_0';
const MISSION_COMPLETE_DISTANCE_METERS = 1.5;
const PLANNING_MODE_OPTIONS = [
  { label: '车端规划', value: 'vehicle' },
  { label: '云端规划', value: 'cloud' },
];
const MISSION_COLORS = [
  '#2563eb',
  '#f97316',
  '#a855f7',
  '#ef4444',
  '#06b6d4',
  '#eab308',
  '#ec4899',
  '#6366f1',
  '#14b8a6',
  '#f43f5e',
  '#8b5cf6',
  '#0ea5e9',
];

function pickMissionColor(missionStates) {
  const occupied = new Set(
    Object.entries(missionStates)
      .map(([, mission]) => mission?.color)
      .filter(Boolean),
  );

  return MISSION_COLORS.find((color) => !occupied.has(color)) || MISSION_COLORS[0];
}

function FleetMonitor({ mqttConnected }) {
  const [vehicles, setVehicles] = useState([]);
  const [showCoordinatePoints, setShowCoordinatePoints] = useState(false);
  const [recordingTrajectory, setRecordingTrajectory] = useState(false);
  const [relocatingVehicle, setRelocatingVehicle] = useState(false);
  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  const [planningMode, setPlanningMode] = useState('vehicle');
  const [roadNodes, setRoadNodes] = useState([]);
  const [roadGraph, setRoadGraph] = useState(null);
  const [selectedRoadNodeId, setSelectedRoadNodeId] = useState('');
  const [missionStates, setMissionStates] = useState({});
  const [simulationRunning, setSimulationRunning] = useState(false);
  const [simulationVehicleCount, setSimulationVehicleCount] = useState(1);
  const [selectingRoadNode, setSelectingRoadNode] = useState(false);
  const delayedDispatches = useRef(new Map());

  useEffect(() => {
    // 监听车辆数据变化
    const handleVehicleChange = (updatedVehicles) => {
      setVehicles(updatedVehicles);
    };

    vehicleManager.addListener(handleVehicleChange);
    setVehicles(vehicleManager.getAllVehicles());

    // 订阅可视化主题
    if (mqttConnected) {
      mqttService.subscribe('vda5050/v2/+/+/visualization', (topic, data) => {
        applyVisualizationPayload(data);
      });
      mqttService.subscribe('vehicles/+', (topic, data) => {
        applyVisualizationPayload(data);
      });
      mqttService.subscribe('vehicle/+', (topic, data) => {
        applyVisualizationPayload(data);
      });
    }

    return () => {
      vehicleManager.removeListener(handleVehicleChange);
    };
  }, [mqttConnected]);

  const applyVisualizationPayload = (payload) => {
    const positions = vda5050Helper.parseVisualization(payload);
    positions.forEach((pos) => {
      const previous = vehicleManager.getVehicle(pos.vehicleId)?.position;
      const dx = Number(pos.position.x) - Number(previous?.x);
      const dy = Number(pos.position.y) - Number(previous?.y);
      const movedDistance = Math.hypot(dx, dy);
      const movementTheta = movedDistance > 0.12 ? Math.atan2(-dy, dx) * 180 / Math.PI : pos.position.theta;
      vehicleManager.updateVehicle({
        vehicleId: pos.vehicleId,
        status: 'online',
        position: { ...pos.position, theta: movementTheta },
        ...(pos.velocity !== undefined ? { velocity: pos.velocity } : {}),
        ...(pos.steering !== undefined ? { steering: pos.steering } : {}),
        ...(pos.goal ? { goal: pos.goal } : {}),
        ...(pos.raw ? { rawPoseMessage: pos.raw } : {}),
      });
    });
  };

  // 发送控制指令
  const sendControl = async (vehicleId, action) => {
    if (!mqttConnected) {
      message.error('MQTT未连接');
      return;
    }

    try {
      const topic = vda5050Helper.generateTopic(vehicleId, 'instantActions');
      const payload = vda5050Helper.generateInstantAction(vehicleId, action);
      await mqttService.publish(topic, payload);
      message.success(`已发送${action}指令`);
    } catch (error) {
      message.error('发送指令失败');
      console.error(error);
    }
  };

  const resolveTargetVehicleId = () => {
    if (selectedVehicleId) return selectedVehicleId;
    return vehicles.find((vehicle) => vehicle.status === 'online')?.vehicleId || vehicles[0]?.vehicleId || '';
  };

  const sendRoadGraphGoal = async (node) => {
    if (!mqttConnected) {
      message.error('MQTT未连接');
      return;
    }

    const vehicleId = resolveTargetVehicleId();
    if (!vehicleId) {
      message.error('没有可用车辆，请先连接真车或启动仿真');
      return;
    }

    try {
      const vehicle = vehicles.find((item) => item.vehicleId === vehicleId);
      if (!vehicle?.position) {
        message.error('当前车辆尚未回传位置，无法下发导航任务');
        return;
      }
      const plannedPath = buildCloudPathPoints(roadGraph, vehicle, node);
      if (!plannedPath) {
        message.error('按当前有向路网无法到达该目标点');
        return;
      }
      if (planningMode === 'cloud' && plannedPath.requiresRecovery) {
        message.error(`车辆距可达路网 ${plannedPath.entryDistance.toFixed(2)}m，超过安全接入阈值；请先人工回到路网后再下发云端路径`);
        return;
      }
      const goalPayload = {
        type: 'road_graph_goal',
        planning_mode: 'vehicle',
        id: vehicleId,
        frame_id: 'map',
        graph: 'road_graph_V1',
        node_id: node.id,
        node_label: node.label || node.id,
        source_id: node.sourceId || node.id,
        x: node.x,
        y: node.y,
        z: node.z || 0,
        timestamp: new Date().toISOString(),
      };


      if (planningMode === 'cloud') {
        const coordinatedPath = coordinateCloudPath(plannedPath, missionStates, vehicleId);
        const pathPayload = {
          type: 'planned_path',
          planning_mode: 'cloud',
          id: vehicleId,
          frame_id: 'map',
          graph: 'road_graph_V1',
          start_node_id: plannedPath.startNodeId,
          start_node_label: plannedPath.startNodeLabel,
          start_source_id: plannedPath.startSourceId,
          entry_edge_id: plannedPath.entryEdgeId,
          entry_distance: plannedPath.entryDistance,
          start_delay_sec: coordinatedPath.startDelaySeconds,
          node_id: node.id,
          node_label: node.label || node.id,
          source_id: node.sourceId || node.id,
          x: node.x,
          y: node.y,
          z: node.z || 0,
          path_format: 'ros_path_speed_z_v1',
          points: coordinatedPath.points.map((point) => ({
            ...point,
            z: Number.isFinite(Number(point.speed)) ? Number(point.speed) : 1.5,
          })),
          timestamp: new Date().toISOString(),
        };
        const publishPath = () => mqttService.publish(`vehicles/${vehicleId}/path`, pathPayload)
          .catch((error) => console.error('delayed cloud path publish failed', error));
        if (coordinatedPath.startDelaySeconds > 0) {
          const timer = window.setTimeout(publishPath, coordinatedPath.startDelaySeconds * 1000);
          delayedDispatches.current.set(vehicleId, timer);
        } else {
          await publishPath();
        }
      } else {
        await mqttService.publish(`vehicles/${vehicleId}/goal`, goalPayload);
      }

      setSelectedVehicleId(vehicleId);
      setSelectedRoadNodeId(node.id);
      setMissionStates((current) => {
        const color = pickMissionColor(current);
        return {
          ...current,
          [vehicleId]: {
            status: 'running',
            planningMode,
            targetNodeId: node.id,
            targetNodeLabel: node.label || node.id,
            targetSourceId: node.sourceId || node.id,
            target: { x: node.x, y: node.y, z: node.z || 0 },
            entryEdgeId: plannedPath.entryEdgeId,
            entryDistance: plannedPath.entryDistance,
            pathPoints: planningMode === 'cloud' ? coordinateCloudPath(plannedPath, current, vehicleId).points : plannedPath.points,
            dispatchAt: planningMode === 'cloud' ? coordinateCloudPath(plannedPath, current, vehicleId).dispatchAt : Date.now(),
            color,
            startedAt: Date.now(),
          },
        };
      });
      message.success(`${planningMode === 'cloud' ? '云端规划路径' : '车端规划目标'}已发送到 ${vehicleId}`);
    } catch (error) {
      message.error('目标节点发送失败');
      console.error(error);
    }
  };

  const sendSelectedRoadGraphGoal = () => {
    const node = roadNodes.find((item) => item.id === selectedRoadNodeId);
    if (!node) {
      message.error('请先选择目标路点');
      return;
    }

    sendRoadGraphGoal(node);
  };

  const cancelVehicleMission = async (requestedVehicleId) => {
    if (!mqttConnected) {
      message.error('MQTT未连接');
      return;
    }

    const vehicleId = requestedVehicleId || resolveTargetVehicleId();
    if (!vehicleId) {
      message.error('请先选择需要取消任务的车辆');
      return;
    }

    try {
      await mqttService.publish(`vehicles/${vehicleId}/cancel`, {
        type: 'cancel_task',
        command: 'cancel',
        id: vehicleId,
        timestamp: new Date().toISOString(),
      });
      const delayedDispatch = delayedDispatches.current.get(vehicleId);
      if (delayedDispatch) {
        window.clearTimeout(delayedDispatch);
        delayedDispatches.current.delete(vehicleId);
      }
      setMissionStates((current) => {
        const next = { ...current };
        delete next[vehicleId];
        return next;
      });
      message.success(`${vehicleId} 的任务取消指令已发送`);
    } catch (error) {
      message.error('任务取消指令发送失败');
      console.error(error);
    }
  };

  const handleRoadGraphLoad = useCallback((graph) => {
    setRoadGraph(graph || null);
    const nodes = graph?.nodes || [];
    setRoadNodes(nodes);
  }, []);
  const handleRoadNodeSelect = useCallback((node) => {
    setSelectedRoadNodeId(node.id);
    setSelectingRoadNode(false);
  }, []);



  const startSimulation = async () => {
    if (!mqttConnected) {
      message.error('请先在系统设置中连接 bridge 服务');
      return;
    }

    try {
      await mqttService.sendBridgeCommand({
        type: 'sim_start',
        vehicleId: SIM_VEHICLE_ID,
        count: simulationVehicleCount,
      });
      setMissionStates((current) => Object.fromEntries(
        Object.entries(current).filter(([vehicleId]) => vehicleId !== SIM_VEHICLE_ID),
      ));
      setSelectedVehicleId(SIM_VEHICLE_ID);
      setSimulationRunning(true);
      message.success('仿真小车已启动，请在目标路点下拉菜单中选择并发送');
    } catch (error) {
      message.error(`启动仿真失败: ${error.message}`);
    }
  };

  const stopSimulation = async () => {
    try {
      await mqttService.sendBridgeCommand({
        type: 'sim_stop',
        vehicleId: SIM_VEHICLE_ID,
      });
      setMissionStates((current) => Object.fromEntries(
        Object.entries(current).filter(([vehicleId]) => vehicleId !== SIM_VEHICLE_ID),
      ));
      setSimulationRunning(false);
      message.info('仿真小车已停止');
    } catch (error) {
      message.error(`停止仿真失败: ${error.message}`);
    }
  };

  useEffect(() => {
    setMissionStates((current) => {
      let changed = false;
      const next = { ...current };

      vehicles.forEach((vehicle) => {
        const mission = next[vehicle.vehicleId];
        if (!mission || mission.status !== 'running' || !vehicle.position) return;

        const distance = Math.hypot(
          vehicle.position.x - mission.target.x,
          vehicle.position.y - mission.target.y,
        );

        if (distance <= MISSION_COMPLETE_DISTANCE_METERS) {
          delete next[vehicle.vehicleId];
          changed = true;
          if (selectedVehicleId === vehicle.vehicleId) {
            setSelectedVehicleId('');
          }
          if (selectedRoadNodeId === mission.targetNodeId) {
            setSelectedRoadNodeId('');
          }
          message.success(`${vehicle.vehicleId} 已到达 ${mission.targetNodeLabel || mission.targetNodeId}`);
        }
      });

      return changed ? next : current;
    });
  }, [vehicles, selectedRoadNodeId, selectedVehicleId]);

  const vehicleOptions = vehicles
      .map((vehicle) => ({
        label: `${vehicle.vehicleId} ${vehicle.status === 'online' ? '在线' : vehicle.status}`,
        value: vehicle.vehicleId,
      }));

  const roadNodeOptions = useMemo(() => (
    roadNodes.map((node) => ({
      label: `${node.label || node.id} (${node.x.toFixed(1)}, ${node.y.toFixed(1)})`,
      value: node.id,
    }))
  ), [roadNodes]);
  const taskEntries = Object.entries(missionStates);

  return (
    <div className="fleet-monitor">
      <Card
        title={<span className="map-card-title"><EnvironmentOutlined />点云语义导航地图</span>}
        className="map-card"
      >
        <div className="fleet-command-bar">
          <div className="fleet-command-primary">
            <Select
              className="fleet-vehicle-select"
              value={selectedVehicleId || undefined}
              options={vehicleOptions}
              onChange={setSelectedVehicleId}
              placeholder="选择目标车辆"
            />
            <Segmented
              options={PLANNING_MODE_OPTIONS}
              value={planningMode}
              onChange={setPlanningMode}
            />
            <Select
              showSearch
              className="fleet-node-select"
              value={selectedRoadNodeId || undefined}
              options={roadNodeOptions}
              onChange={(value) => {
                setSelectedRoadNodeId(value);
                setSelectingRoadNode(false);
              }}
              placeholder="选择目标路点"
              optionFilterProp="label"
              disabled={!roadNodeOptions.length}
            />
            <Button
              type={selectingRoadNode ? 'primary' : 'default'}
              icon={<NumberOutlined />}
              onClick={() => {
                setSelectingRoadNode((current) => !current);
                setRelocatingVehicle(false);
              }}
              disabled={!roadNodeOptions.length}
            >
              {selectingRoadNode ? '退出地图选点' : '地图选点'}
            </Button>
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={sendSelectedRoadGraphGoal}
              disabled={!selectedRoadNodeId || !resolveTargetVehicleId()}
            >
              发送目标
            </Button>
          </div>

          <div className="fleet-command-tools">
            <InputNumber
              min={1}
              max={1}
              value={simulationVehicleCount}
              onChange={(value) => setSimulationVehicleCount(Number(value) || 1)}
              addonBefore="Gazebo车辆"
              className="fleet-sim-count"
              disabled
            />
            <Button
              type={simulationRunning ? 'default' : 'primary'}
              icon={<ExperimentOutlined />}
              onClick={simulationRunning ? stopSimulation : startSimulation}
            >
              {simulationRunning ? '停止仿真' : '启动仿真'}
            </Button>
            <Button
              type={relocatingVehicle ? 'primary' : 'default'}
              icon={<AimOutlined />}
              onClick={() => {
                setRelocatingVehicle((current) => !current);
                setSelectingRoadNode(false);
              }}
            >
              {relocatingVehicle ? '退出重定位' : '重定位'}
            </Button>
            <Button
              type="default"
              danger={recordingTrajectory}
              icon={recordingTrajectory ? <StopOutlined /> : <PlayCircleOutlined />}
              onClick={() => setRecordingTrajectory((current) => !current)}
            >
              {recordingTrajectory ? '停止记录' : '开始记录'}
            </Button>
            <Button
              type={showCoordinatePoints ? 'primary' : 'default'}
              icon={<EnvironmentOutlined />}
              onClick={() => setShowCoordinatePoints((current) => !current)}
            >
              坐标显示
            </Button>
          </div>
        </div>
        <SemanticMapCanvas
          vehicles={vehicles}
          showCoordinatePoints={showCoordinatePoints}
          recordingTrails={recordingTrajectory}
          relocatingVehicle={relocatingVehicle}
          onRelocatingVehicleChange={setRelocatingVehicle}
          onControl={sendControl}
          onCancelMission={cancelVehicleMission}
          selectedVehicleId={selectedVehicleId}
          selectedRoadNodeId={selectedRoadNodeId}
          roadNodeSelectionActive={selectingRoadNode}
          missionStates={missionStates}
          onRoadGraphLoad={handleRoadGraphLoad}
          onRoadNodeSelect={handleRoadNodeSelect}
        />
      </Card>


      <section className="fleet-legend" aria-label="车辆状态图例">
        <strong>状态图例</strong>
        <span><i className="is-online" />在线</span>
        <span><i className="is-offline" />离线</span>
        <span><i className="is-charging" />充电中</span>
        <span><i className="is-error" />故障</span>
        <span><i className="is-paused" />暂停</span>
      </section>
    </div>
  );
}

export default FleetMonitor;
