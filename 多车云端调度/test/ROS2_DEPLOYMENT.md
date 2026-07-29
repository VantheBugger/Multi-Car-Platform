# ROS 2 实车部署

## 适用范围

本文档对应 ROS 2 Jazzy 车端实现，车端工作区与现有 ROS 1 代码完全分离：

- ROS 2 车端工作区：`/home/van/platformm_wang/ros2_vehicle_ws`
- ROS 2 一键脚本：`scripts/run-vehicle-ros2.sh`
- ROS 1 车端源码：`/home/van/ros1_src0702`，未修改
- ROS 1 云端、实车和 Docker/Gazebo 入口仍保留，默认运行模式仍为 ROS 1

目标系统为 Ubuntu 24.04 + ROS 2 Jazzy。ROS 2 车端包含 MQTT、路网规划、任务管理、纯跟踪和底盘 UDP 控制，不包含未经验证的雷达驱动或定位算法移植。

现有 `run-e2e.sh` 和 Docker/Gazebo 仍使用 ROS 1 Noetic 仿真链路，本次不将它替换为 ROS 2 仿真。ROS 2 交付范围是实车与无底盘消息联调；后续如需 ROS 2 仿真，应另行建立 `ros_gz` 车辆插件和场景，而不是改写现有 ROS 1 仿真。

## 数据通路

ROS 1 和 ROS 2 共用同一套 MQTT 线上协议，云端前端不需要根据 ROS 版本改变业务消息：

| 方向 | MQTT 话题 | ROS 2 话题 |
| --- | --- | --- |
| 云端 -> 车端规划 | `vehicles/<robot_id>/goal` | `/move_base_simple/goal` |
| 云端 -> 云端规划路径 | `vehicles/<robot_id>/path` | `/cloud_planned_path` |
| 车端 -> 云端状态 | `vehicles/<robot_id>` | 由 `/localization`、`/car_state`、`/car_cmd` 组合 |
| 定位转换 | - | `/localization` -> `/current_pose` |
| 车端路网规划 | - | `/plan_path` service |
| 路径跟踪 | - | `/follow_path` action -> `/car_cmd` |
| 底盘状态 | - | UDP `8090/8080` -> `/car_state` |

`/localization` 必须为 `nav_msgs/msg/Odometry`，并使用与云端路网一致的 `map` 坐标系。如果 ROS 2 定位节点发布的话题名或消息类型不同，应在车端增加转换节点，不要修改云端 MQTT 协议。

ROS 2 工作区内的 `road_graph_web.pkl` 为 168 个节点、327 条边的 `DiGraph`。路网加密、起终点吸附和 A* 规划都保留原始边方向，不得使用旧的 211 边无向 pickle 覆盖它。

## 车端准备

将以下内容复制到 ROS 2 车端：

- 整个 `ros2_vehicle_ws` 目录
- `scripts/run-vehicle-ros2.sh`

在车端安装 ROS 2 Jazzy 后编译：

```bash
source /opt/ros/jazzy/setup.bash
cd /home/bit/ros2_vehicle_ws
rosdep install --from-paths src --ignore-src -r -y
colcon build --symlink-install --executor sequential
```

`--executor sequential` 用于限制编译并发度和内存占用。工作区内有两个包：

- `fleet_interfaces`：ROS 2 自定义 message/service/action
- `fleet_vehicle`：MQTT、规划、跟踪、任务管理和底盘驱动

## 分别启动

先在连接 MQTT Broker 的云端电脑启动 Web 和桥接：

```bash
cd /home/van/platformm_wang/多车云端调度/test
VEHICLE_ROS_VERSION=ros2 \
USE_LOCAL_MQTT=false \
MQTT_HOST=192.168.7.102 \
MQTT_PORT=1883 \
bash scripts/run-cloud-real.sh restart
```

再在 ROS 2 车端启动完整车端链路：

```bash
ROS2_WS=/home/bit/ros2_vehicle_ws \
ROBOT_ID=robot_3 \
MQTT_HOST=192.168.7.102 \
MQTT_PORT=1883 \
CAR_REMOTE_IP=192.168.8.9 \
LOCALIZATION_COMMAND='ros2 launch <定位包> <定位launch>.launch.py' \
bash /home/bit/run-vehicle-ros2.sh start
```

如果定位系统已由另一个总 launch 启动，可以省略 `LOCALIZATION_COMMAND`，但 `/localization` 必须已经发布。

状态检查和停止：

```bash
bash /home/bit/run-vehicle-ros2.sh status
bash /home/bit/run-vehicle-ros2.sh stop
```

## 云端一键启动远程车端

只有云端可以 SSH 登录车端时才使用该模式：

```bash
cd /home/van/platformm_wang/多车云端调度/test
VEHICLE_ROS_VERSION=ros2 \
VEHICLE_MODE=ssh \
VEHICLE_SSH=bit@192.168.8.9 \
REMOTE_VEHICLE_SCRIPT=/home/bit/run-vehicle-ros2.sh \
ROS2_WS=/home/bit/ros2_vehicle_ws \
ROBOT_ID=robot_3 \
USE_LOCAL_MQTT=false \
MQTT_HOST=192.168.7.102 \
MQTT_PORT=1883 \
CAR_REMOTE_IP=192.168.8.9 \
LOCALIZATION_COMMAND='ros2 launch <定位包> <定位launch>.launch.py' \
bash scripts/run-real-stack.sh restart
```

若车端仍然只允许人工启动总 launch，使用前一节的“分别启动”，不要使用 SSH 模式。

## 无底盘联调

首次验证建议先禁用 UDP 底盘输出，只验证 MQTT 和 ROS 2 话题：

```bash
START_CHASSIS_DRIVER=false \
ROS2_WS=/home/bit/ros2_vehicle_ws \
ROBOT_ID=robot_3 \
MQTT_HOST=192.168.7.102 \
bash /home/bit/run-vehicle-ros2.sh start
```

在车端检查：

```bash
source /opt/ros/jazzy/setup.bash
source /home/bit/ros2_vehicle_ws/install/setup.bash
ros2 topic echo /move_base_simple/goal
ros2 topic echo /cloud_planned_path
ros2 topic echo /car_cmd
ros2 topic echo /current_pose
```

云端可以直接检查 MQTT：

```bash
mosquitto_sub -h 192.168.7.102 -p 1883 -t 'vehicles/#' -v
```

## ROS 1 与 ROS 2 的主要区别

| 项目 | 现有 ROS 1 | 新增 ROS 2 |
| --- | --- | --- |
| 发行版 | Noetic/catkin | Jazzy/colcon + ament |
| 代码位置 | `/home/van/ros1_src0702` | `/home/van/platformm_wang/ros2_vehicle_ws` |
| 节点 API | `rospy`/`roscpp` | `rclpy` |
| 自定义接口 | ROS 1 msg/srv/action | `fleet_interfaces` ROS 2 msg/srv/action |
| 启动系统 | XML `.launch` | Python `vehicle_stack.launch.py` |
| 构建 | `catkin_make` | `colcon build --executor sequential` |
| ROS 通信 | ROS master | DDS，可用 `ROS_DOMAIN_ID` 隔离 |
| MQTT 协议 | `vehicles/<id>`、`goal`、`path` | 保持不变 |
| 路网与控制逻辑 | 已有实现 | 保留同等字段、参数和底盘 UDP 命令 |
| 定位/雷达 | ROS 1 现有硬件链路 | 需提供 ROS 2 `/localization`，本次不盲目移植硬件驱动 |
| 云端启动选择 | 默认 `VEHICLE_ROS_VERSION=ros1` | 显式设置 `VEHICLE_ROS_VERSION=ros2` |

## 实车验收顺序

1. `run-vehicle-ros2.sh status` 显示 `/localization`、`/current_pose`、`/car_state` 就绪。
2. 只开 MQTT 和导航节点，使用 `START_CHASSIS_DRIVER=false` 验证 Web 目标点和云端路径都能到达 ROS 2。
3. 检查 `/current_pose` 与 Web 路网处于同一 `map` 坐标系，目标点到路网的距离不超过 `max_adhesion_dist`。
4. 架空车轮或使用安全场地，启用底盘驱动，先限制低速测试。
5. 分别验证“车端规划”和“云端规划”，最后再进行长路径跟踪。

ROS 2 实现已通过静态语法、MQTT 协议单元测试和路网加载/规划测试；当前开发机没有安装 ROS 2 Jazzy，因此 ROS 2 launch、DDS、定位驱动和真实底盘仍需在车端按上述顺序验收。
