# Windows 原生版使用说明

项目位置：`D:\platformm_wang_windows`

该目录是 WSL 项目的独立副本。原 WSL 目录未被改写。Windows 版保留 React/Vite 前端、语义地图、路径规划、VDA5050 工具、MQTT bridge、车辆状态订阅与目标/路径/取消话题发布。

Windows 版本的全部运行进程均为原生 `node.exe` / `powershell.exe`，不会调用 `wsl.exe`、`bash`、Linux Docker 或 Gazebo。

## 一键启动本地模式

```powershell
cd "D:\platformm_wang_windows\多车云端调度\test"
$env:USE_LOCAL_MQTT="true"
$env:MQTT_HOST="127.0.0.1"
$env:MQTT_PORT="1883"
.\scripts\run-cloud-real.ps1 restart
```

本地 broker 使用项目依赖 Aedes，在 Windows Node.js 中提供标准 MQTT 3.1.1 TCP 服务，无需管理员权限、Docker 或 Windows 服务。

## 连接真实 MQTT broker

```powershell
cd "D:\platformm_wang_windows\多车云端调度\test"
$env:USE_LOCAL_MQTT="false"
$env:MQTT_HOST="192.168.7.9"
$env:MQTT_PORT="1883"
.\scripts\run-cloud-real.ps1 restart
```

外部 broker 默认按 MQTT v5 连接。如果目标 broker 只支持 MQTT 3.1.1：

```powershell
$env:MQTT_PROTOCOL_VERSION="4"
```

支持的可选环境变量包括 `MQTT_URL`、`MQTT_USERNAME`、`MQTT_PASSWORD`、`MQTT_TOPIC`、`BRIDGE_TOKEN`、`WEB_PORT`、`BRIDGE_PORT` 和 `VEHICLE_ROS_VERSION`。

## 管理与验证

```powershell
.\scripts\run-cloud-real.ps1 status
.\scripts\run-cloud-real.ps1 logs
.\scripts\run-cloud-real.ps1 stop
.\scripts\run-cloud-real.ps1 restart
node .\scripts\windows-mqtt-smoke.js
```

- 页面：<http://127.0.0.1:5173>
- WebSocket bridge：`ws://127.0.0.1:8788/bridge`
- 日志：`多车云端调度\test\.runtime\real-cloud-windows\logs`

也可使用 CMD：

```cmd
cd /d D:\platformm_wang_windows\多车云端调度\test
set USE_LOCAL_MQTT=true
scripts\run-cloud-real.cmd restart
```

端到端自检会通过浏览器同款 WebSocket bridge 发布并回收：

- `vehicles/<windows_test_id>`：车辆状态
- `vehicles/<windows_test_id>/goal`：目标点

## 保留但不在 Windows 本机运行的功能

- Gazebo / real2sim 仿真
- ROS 1 Noetic 本机节点
- ROS 2 Jazzy 本机节点
- Linux Docker 启动流程

相关源文件和部署文档仍完整保留。真实 ROS 车辆继续在 Linux 车端运行，通过 MQTT 与 Windows 云端通信；`VEHICLE_ROS_VERSION=ros1` 或 `ros2` 仍可配置 bridge 协议标识。

