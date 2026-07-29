// 车辆数据管理
class VehicleManager {
  constructor() {
    this.vehicles = new Map(); // 车辆列表
    this.listeners = []; // 数据变化监听器
    this.onlineTimeoutMs = 15000;
    this.refreshTimer = setInterval(() => {
      if (this.listeners.length > 0) {
        this.notifyListeners();
      }
    }, 2000);
  }

  normalizeVehicle(vehicle, now = Date.now()) {
    if (!vehicle) return null;
    const lastUpdate = Number(vehicle.lastUpdate || 0);
    const isStale = lastUpdate > 0 && now - lastUpdate > this.onlineTimeoutMs;
    return {
      ...vehicle,
      status: isStale ? 'offline' : vehicle.status,
    };
  }

  // 添加或更新车辆
  updateVehicle(vehicleData) {
    const { vehicleId, ...data } = vehicleData;

    if (!this.vehicles.has(vehicleId)) {
      // 新增车辆
      this.vehicles.set(vehicleId, {
        vehicleId,
        status: 'offline',
        position: { x: 0, y: 0, theta: 0 },
        battery: 0,
        velocity: 0,
        loadState: 'NONE',
        errors: [],
        lastUpdate: Date.now(),
        ...data
      });
    } else {
      // 更新车辆
      const vehicle = this.vehicles.get(vehicleId);
      Object.assign(vehicle, data, { lastUpdate: Date.now() });
    }

    this.notifyListeners();
  }

  // 获取所有车辆
  getAllVehicles() {
    const now = Date.now();
    return Array.from(this.vehicles.values()).map((vehicle) => this.normalizeVehicle(vehicle, now));
  }

  // 获取单个车辆
  getVehicle(vehicleId) {
    return this.normalizeVehicle(this.vehicles.get(vehicleId));
  }

  // 删除车辆
  removeVehicle(vehicleId) {
    this.vehicles.delete(vehicleId);
    this.notifyListeners();
  }

  // 更新车辆位置
  updatePosition(vehicleId, position) {
    const vehicle = this.vehicles.get(vehicleId);
    if (vehicle) {
      vehicle.position = position;
      vehicle.lastUpdate = Date.now();
      this.notifyListeners();
    }
  }

  // 更新车辆状态
  updateStatus(vehicleId, status) {
    const vehicle = this.vehicles.get(vehicleId);
    if (vehicle) {
      vehicle.status = status;
      vehicle.lastUpdate = Date.now();
      this.notifyListeners();
    }
  }

  // 更新电池电量
  updateBattery(vehicleId, battery) {
    const vehicle = this.vehicles.get(vehicleId);
    if (vehicle) {
      vehicle.battery = battery;
      this.notifyListeners();
    }
  }

  // 注册数据变化监听器
  addListener(callback) {
    this.listeners.push(callback);
  }

  // 移除监听器
  removeListener(callback) {
    this.listeners = this.listeners.filter(cb => cb !== callback);
  }

  // 通知所有监听器
  notifyListeners() {
    const vehicles = this.getAllVehicles();
    this.listeners.forEach(callback => callback(vehicles));
  }

  // 清空所有车辆
  clearAll() {
    this.vehicles.clear();
    this.notifyListeners();
  }

  // 获取在线车辆数量
  getOnlineCount() {
    return this.getAllVehicles().filter(v => v.status === 'online').length;
  }

  // 获取统计数据
  getStatistics() {
    const vehicles = this.getAllVehicles();
    return {
      total: vehicles.length,
      online: vehicles.filter(v => v.status === 'online').length,
      offline: vehicles.filter(v => v.status === 'offline').length,
      charging: vehicles.filter(v => v.status === 'charging').length,
      error: vehicles.filter(v => v.errors && v.errors.length > 0).length,
      avgBattery: vehicles.length > 0
        ? (vehicles.reduce((sum, v) => sum + v.battery, 0) / vehicles.length).toFixed(1)
        : 0
    };
  }
}

// 导出单例
export default new VehicleManager();
