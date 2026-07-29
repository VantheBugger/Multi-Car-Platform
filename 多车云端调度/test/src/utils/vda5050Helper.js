/**
 * VDA5050协议工具类
 * 处理AGV/AMR标准通信协议
 */
class VDA5050Helper {
  constructor() {
    this.manufacturer = 'demo'; // 制造商
  }

  /**
   * 生成订单(路径规划)
   * @param {string} vehicleId - 车辆ID
   * @param {Array} nodes - 节点数组 [{nodeId, x, y, theta}]
   * @param {Array} edges - 边数组 [{edgeId, startNodeId, endNodeId}]
   * @returns {Object} VDA5050订单对象
   */
  generateOrder(vehicleId, nodes = [], edges = []) {
    return {
      headerId: Date.now(),
      timestamp: new Date().toISOString(),
      version: '2.0.0',
      manufacturer: this.manufacturer,
      serialNumber: vehicleId,
      orderId: `order_${Date.now()}`,
      orderUpdateId: Date.now(),
      nodes: nodes.map((node, index) => ({
        nodeId: node.nodeId || `node_${index}`,
        sequenceId: index,
        released: true,
        position: {
          x: node.x || 0,
          y: node.y || 0,
          theta: node.theta || 0
        },
        actions: []
      })),
      edges: edges.map((edge, index) => ({
        edgeId: edge.edgeId || `edge_${index}`,
        sequenceId: index,
        released: true,
        startNodeId: edge.startNodeId,
        endNodeId: edge.endNodeId,
        maxSpeed: 1.5,
        maxHeight: 3.0,
        orientation: 0
      }))
    };
  }

  /**
   * 生成即时控制指令
   * @param {string} vehicleId - 车辆ID
   * @param {string} action - 动作类型: START, STOP, PAUSE, CONTINUE
   * @returns {Object} VDA5050即时指令对象
   */
  generateInstantAction(vehicleId, action) {
    const actionMap = {
      'START': 'start',
      'STOP': 'stop',
      'PAUSE': 'pause',
      'CONTINUE': 'continue'
    };

    return {
      headerId: Date.now(),
      timestamp: new Date().toISOString(),
      version: '2.0.0',
      manufacturer: this.manufacturer,
      serialNumber: vehicleId,
      instantActions: [{
        actionId: `action_${Date.now()}`,
        actionType: actionMap[action] || action,
        blockingType: 'NONE',
        parameters: []
      }]
    };
  }

  /**
   * 解析车辆状态消息
   * @param {Object} stateData - 原始状态数据
   * @returns {Object} 解析后的状态对象
   */
  parseState(stateData) {
    if (!stateData) return null;

    return {
      vehicleId: stateData.serialNumber,
      status: this.parseStatus(stateData),
      position: {
        x: stateData.position?.x || 0,
        y: stateData.position?.y || 0,
        theta: stateData.position?.theta || 0
      },
      battery: stateData.batteryState?.batteryCharge || 0,
      velocity: stateData.velocity || 0,
      loadState: stateData.loadState?.loadHandlingActive ? 'LOADING' : 'NONE',
      errors: stateData.errors || [],
      operatingMode: stateData.operatingMode,
      paused: stateData.paused || false,
      lastUpdate: stateData.timestamp || Date.now()
    };
  }

  /**
   * 解析车辆状态
   * @param {Object} stateData - 状态数据
   * @returns {string} 状态字符串
   */
  parseStatus(stateData) {
    if (stateData.batteryState?.charging) {
      return 'charging';
    }
    if (stateData.paused) {
      return 'paused';
    }
    if (stateData.errors && stateData.errors.length > 0) {
      return 'error';
    }
    if (stateData.operatingMode === 'AUTOMATIC') {
      return 'online';
    }
    return 'offline';
  }

  /**
   * 生成主题名称
   * @param {string} vehicleId - 车辆ID
   * @param {string} topicType - 主题类型: order, state, connection等
   * @returns {string} MQTT主题
   */
  generateTopic(vehicleId, topicType) {
    return `vda5050/v2/${this.manufacturer}/${vehicleId}/${topicType}`;
  }

  /**
   * 解析可视化位置信息
   * @param {Object} visualizationData - 可视化数据
   * @returns {Array} 位置数组
   */
  parseVisualization(visualizationData) {
    if (!visualizationData) {
      return [];
    }

    const normalizeRobotPose = (pose) => ({
      vehicleId: pose.id,
      position: {
        x: Number(pose.x) || 0,
        y: Number(pose.y) || 0,
        // ROS yaw is CCW from east; CSS rotation is clockwise from an up-facing icon.
        theta: -((Number(pose.yaw) || 0) * 180) / Math.PI,
      },
      velocity: Number(pose.vel) || 0,
      steering: Number(pose.steering) || 0,
      goal: {
        x: Number(pose.goal_x) || 0,
        y: Number(pose.goal_y) || 0,
      },
      raw: pose,
    });

    if (visualizationData.id && Object.prototype.hasOwnProperty.call(visualizationData, 'x')) {
      return [normalizeRobotPose(visualizationData)];
    }

    if (Array.isArray(visualizationData)) {
      return visualizationData
        .filter((pose) => pose?.id && Object.prototype.hasOwnProperty.call(pose, 'x'))
        .map(normalizeRobotPose);
    }

    if (!visualizationData.agents) {
      return [];
    }

    return visualizationData.agents.map(agent => ({
      vehicleId: agent.serialNumber,
      position: {
        x: agent.position?.x || 0,
        y: agent.position?.y || 0,
        theta: agent.position?.theta || 0
      },
      color: agent.color || '#1890ff'
    }));
  }
}

// 导出单例
export default new VDA5050Helper();
