# 公网部署路线

目标：电脑关机后，仍可从其他设备访问一个 HTTPS 网站查看车队监控，并向实车下发目标点。

## 推荐免费路线

推荐使用：

- 前端静态网站：Cloudflare Pages
- 车端或现场网关：运行 `mqtt-bridge.js`
- 公网访问桥接服务：Cloudflare Tunnel
- MQTT Broker：继续使用现场 Broker，或迁移到云端 MQTT Broker

这个方案的关键点是：`mqtt-bridge.js` 必须运行在一个不会关机的设备上。可以是小车主机、现场工控机、树莓派、NAS、实验室常开服务器。它负责连接现场 MQTT Broker，然后通过 Cloudflare Tunnel 暴露为公网 `wss://.../bridge`。

## 架构

```text
手机/平板/其他电脑
  |
  | HTTPS
  v
Cloudflare Pages 静态前端
  |
  | WSS /bridge
  v
Cloudflare Tunnel
  |
  | HTTP WebSocket
  v
现场常开设备: mqtt-bridge.js
  |
  | mqtt://192.168.x.x:1883
  v
现场 MQTT Broker
  |
  v
ROS1 / 实车
```

## 1. 构建前端

```bash
cd /home/van/platformm_wang/多车云端调度/test
npm install
npm run build
```

把 `dist/` 部署到 Cloudflare Pages。

Cloudflare Pages 设置：

- Build command: `npm run build`
- Build output directory: `dist`
- Root directory: `多车云端调度/test`

## 2. 在现场常开设备启动 bridge

不要在个人电脑上运行这一步，否则电脑关机后公网系统会断开。

```bash
cd /home/van/platformm_wang/多车云端调度/test
BRIDGE_TOKEN='替换成一串长随机密码' \
MQTT_URL='mqtt://192.168.8.102:1883' \
MQTT_TOPIC='vehicles/+,vehicle/+,vehicles/+/goal_ack' \
npm run bridge
```

确认本地健康检查：

```bash
curl http://127.0.0.1:8787/health
```

## 3. 用 Cloudflare Tunnel 暴露 bridge

在现场常开设备安装并登录 `cloudflared` 后，创建一个 Public Hostname：

```text
bridge.example.com -> http://localhost:8787
```

Cloudflare 会对外提供：

```text
wss://bridge.example.com/bridge
```

## 4. Web 页面连接配置

公网网站打开后，在“系统设置”中填写：

```text
服务器地址: bridge.example.com
端口号: 443
协议: bridge-wss
桥接访问令牌: 上面 BRIDGE_TOKEN 的值
```

连接成功后，车队监控页面会继续订阅：

```text
vehicles/+
vehicle/+
```

目标点下发仍是：

```text
vehicles/<vehicleId>/goal
```

## 5. 实车侧要求

实车或现场 ROS1 侧保持当前逻辑：

- 每辆车发布不同的 `id`
- topic 建议为 `vehicles/<robot_id>`
- 接收目标 topic 为 `vehicles/<robot_id>/goal`
- `mqtt_goal_sub` 将目标转成 `/move_base_simple/goal`

## 备选路线

### Oracle Cloud Always Free VM

可以把 MQTT Broker 和 `mqtt-bridge.js` 都放到免费云主机上。优点是不用现场设备暴露服务；缺点是实车也必须能访问公网 MQTT Broker。

### 免费 MQTT Cloud

可以用于演示或短期测试，但不建议直接用于实车控制。免费 MQTT 服务通常有连接数、流量、可用性或休眠限制，而且需要确认是否支持 WebSocket/TLS。

## 安全注意事项

- 不要把未加 token 的 bridge 暴露到公网。
- 更推荐同时启用 Cloudflare Access，只允许指定邮箱访问。
- 控制类 topic 不要使用公共测试 MQTT Broker。
- `BRIDGE_TOKEN` 不应提交到 Git。
