/**
 * 模拟车辆数据生成器
 * 用于开发和测试阶段生成示例数据
 */

import vehicleManager from '../services/vehicleManager';

/**
 * 生成随机车辆数据
 */
export function generateRandomVehicle(vehicleId) {
  return {
    vehicleId,
    status: ['online', 'offline', 'charging', 'paused'][Math.floor(Math.random() * 4)],
    position: {
      x: Math.random() * 100,
      y: Math.random() * 100,
      theta: Math.random() * 360
    },
    battery: Math.floor(Math.random() * 100),
    velocity: Math.random() * 2,
    loadState: Math.random() > 0.5 ? 'LOADING' : 'NONE',
    lastUpdate: Date.now()
  };
}

/**
 * 初始化示例车辆数据
 */
export function initDemoVehicles() {
  const vehicleIds = ['AGV001', 'AGV002', 'AGV003', 'AGV004', 'AGV005'];
  
  vehicleIds.forEach(id => {
    vehicleManager.updateVehicle(generateRandomVehicle(id));
  });

  console.log('✅ 已初始化', vehicleIds.length, '辆示例车辆');
}

/**
 * 模拟车辆位置更新
 */
export function simulateVehicleMovement() {
  const vehicles = vehicleManager.getAllVehicles();
  
  vehicles.forEach(vehicle => {
    if (vehicle.status === 'online') {
      // 模拟小幅移动
      const newPos = {
        x: vehicle.position.x + (Math.random() - 0.5) * 2,
        y: vehicle.position.y + (Math.random() - 0.5) * 2,
        theta: (vehicle.position.theta + (Math.random() - 0.5) * 10) % 360
      };
      
      vehicleManager.updatePosition(vehicle.vehicleId, newPos);
      
      // 模拟电量变化
      if (Math.random() > 0.9) {
        const newBattery = Math.max(0, vehicle.battery - 1);
        vehicleManager.updateBattery(vehicle.vehicleId, newBattery);
      }
    }
  });
}

/**
 * 启动模拟
 */
export function startSimulation(interval = 2000) {
  initDemoVehicles();
  
  const intervalId = setInterval(() => {
    simulateVehicleMovement();
  }, interval);

  return () => clearInterval(intervalId);
}
