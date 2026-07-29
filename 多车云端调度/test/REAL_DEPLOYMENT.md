# Real Deployment Scripts

> 本文档是现有 ROS 1 车端的部署说明，其实车、云端和仿真逻辑继续保留。ROS 2 Jazzy 请参阅 [ROS2_DEPLOYMENT.md](./ROS2_DEPLOYMENT.md)。

## 有向路网更新

车端路网现为 `DiGraph`，与 Web `road_graph_V1.json` 的 168 个节点、327 条有向边一致。同步到实车时必须同时替换：

- `src/path_planner/src/path_planner_node.py`
- `src/path_planner/src/road_graph_web.pkl`

替换后在车端工作区执行：

```bash
cd /home/bit/ros1_van
catkin_make -j1 -l1
```

验证加载的图没有被降级为无向图：

```bash
python3 -c "import pickle; p='/home/bit/ros1_van/src/path_planner/src/road_graph_web.pkl'; g=pickle.load(open(p,'rb')); print(type(g).__name__, g.is_directed(), g.number_of_nodes(), g.number_of_edges())"
```

预期输出：`DiGraph True 168 327`。若仍显示 `Graph False 168 211`，说明车端仍在使用旧路网。

## 当前实车推荐运行方式

你的实车场景是：车端只启动自己的总 `launch`，云端电脑连接小车 WiFi 后，通过小车 WiFi 上的 MQTT Broker 和车端通信。

这种情况下，云端不要启动本地 MQTT Broker，必须连接车端正在使用的外部 MQTT 地址。

假设小车 WiFi/MQTT 地址是 `192.168.7.102:1883`：

```bash
cd /home/van/platformm_wang/多车云端调度/test
USE_LOCAL_MQTT=false MQTT_HOST=192.168.7.102 MQTT_PORT=1883 bash scripts/run-cloud-real.sh restart
```

如果你的 MQTT 地址是 `192.168.8.9:1883`，就改成：

```bash
cd /home/van/platformm_wang/多车云端调度/test
USE_LOCAL_MQTT=false MQTT_HOST=192.168.8.9 MQTT_PORT=1883 bash scripts/run-cloud-real.sh restart
```

然后打开：

```text
http://127.0.0.1:5173
```

或从同网段其他设备访问：

```text
http://<云端电脑在小车WiFi下的IP>:5173
```

## 车端要求

车端不需要 `platformm_wang`，也不需要运行云端脚本。

车端只需要按原方式启动自己的总 `launch`，但总 `launch` 里需要包含或等价启动：

- `mqtt_vehicle_pub`：向 MQTT 上报车辆状态
- `mqtt_goal_sub`：订阅 `vehicles/<robot_id>/goal`，用于车端规划目标点
- `mqtt_path_sub.py`：订阅 `vehicles/<robot_id>/path`，用于云端规划路径
- `task_manager/run_real.launch`
- `pathtrack/run.launch`
- `car_ctr` 和定位链路

## MQTT 话题

车端规划模式发送：

```text
vehicles/<robot_id>/goal
```

云端规划模式发送：

```text
vehicles/<robot_id>/path
```

车辆状态上报通常监听：

```text
vehicles/+          # 单层状态上报
vehicle/+           # 兼容旧单层状态上报
vehicles/+/goal     # 目标点下发
vehicles/+/path     # 云端路径下发
vehicles/+/goal_ack
vehicles/+/path_ack
```

如果要直接确认云端规划路径是否真的发到了 MQTT，用：

```bash
mosquitto_sub -h 192.168.7.102 -p 1883 -t 'vehicles/#' -v
```

然后在网页里选择“云端规划”并发送目标点，应该能看到：

```text
vehicles/<robot_id>/path {...}
```

## 状态与停止

```bash
bash scripts/run-cloud-real.sh status
bash scripts/run-cloud-real.sh stop
```

如果之前误启动过本地 MQTT 或旧 bridge，直接执行推荐的 `restart` 命令即可。脚本会清理当前项目启动的旧 `mqtt-bridge.js` 进程，并重新连接指定的 `MQTT_HOST:MQTT_PORT`。

## 旧的本地仿真/本机联调方式

只有在你希望云端电脑自己启动一个本地 MQTT Broker 时，才使用：

```bash
cd /home/van/platformm_wang/多车云端调度/test
USE_LOCAL_MQTT=true bash scripts/run-cloud-real.sh start
```

实车接入小车 WiFi 时不要用 `USE_LOCAL_MQTT=true`，否则网页会连到云端电脑自己的临时 Broker，而不是车端正在使用的 Broker。
