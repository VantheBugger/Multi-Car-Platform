# 无人车队云端调度系统

基于 React + Vite + Ant Design + Leaflet + MQTT 的无人车队云端调度系统，遵循 VDA5050 标准协议。

## ROS 部署入口

- ROS 1 实车部署：[REAL_DEPLOYMENT.md](./REAL_DEPLOYMENT.md)
- ROS 2 Jazzy 实车部署：[ROS2_DEPLOYMENT.md](./ROS2_DEPLOYMENT.md)
- Docker/Gazebo 仿真：`bash run-e2e.sh start`

默认保持 ROS 1 运行方式。只有部署 ROS 2 车端时才设置 `VEHICLE_ROS_VERSION=ros2`；两种版本共用现有 MQTT `vehicles/<robot_id>` 协议。

## ✨ 最新版本特性

### 🎨 界面美化 (v1.1)
- ✅ 现代化紫色渐变主题 (#667eea → #764ba2)
- ✅ 卡片悬停动画效果（上浮 + 阴影加深）
- ✅ 全局渐变背景
- ✅ 自定义滚动条样式
- ✅ 响应式布局设计
- ✅ Emoji 图标增强视觉识别
- ✅ 平滑过渡动画
- ✅ 按钮悬停上浮效果
- ✅ 输入框聚焦发光效果

## 🚀 技术栈

- **前端框架**: React 18
- **构建工具**: Vite 5
- **UI 组件库**: Ant Design 5
- **地图引擎**: Leaflet + React-Leaflet
- **实时通信**: MQTT.js (WebSocket)
- **数据可视化**: ECharts
- **协议标准**: VDA5050 (AGV/AMR行业标准)

## 📦 快速开始

### 1. 安装依赖

```bash
cd test
npm install
```

### 2. 启动开发服务器

```bash
npm run dev
```

访问 http://localhost:5173

### 3. 构建生产版本

```bash
npm run build
```

构建产物位于 `dist/` 目录，可直接部署到 Nginx、Apache 等静态文件服务器。

### 4. 预览生产版本

```bash
npm run preview
```

## 🔧 功能模块

### 1. 📊 数据看板 (Dashboard)
- **实时统计卡片**
  - 🚗 车辆总数
  - ✅ 在线车辆数
  - ⚡ 充电中车辆
  - 🔋 平均电量百分比
- **车辆列表表格**
  - 实时状态显示（在线/离线/充电/故障/暂停）
  - 电池电量进度条
  - 速度和位置信息
  - 响应式表格设计
- **数据可视化**
  - 📊 电池分布饼图（ECharts）
  - 渐变色图表主题
  - 交互式图例

### 2. 🗺️ 车队监控 (Fleet Monitor)
- **实时地图监控**
  - Leaflet 2D 地图引擎
  - OpenStreetMap 开源地图数据
  - 自定义缩放和平移
- **车辆标记系统**
  - 颜色区分状态（绿/灰/青/红/橙）
  - 方向角指示箭头
  - 脉冲动画效果
  - 点击弹出详情窗口
- **远程控制功能**
  - ▶️ 启动车辆
  - ⏸️ 暂停运行
  - ⏹️ 停止作业
  - 🛣️ 发送测试路径
- **图例说明**
  - 状态标识清晰
  - 阴影效果优化

### 3. 🚗 车辆管理 (Vehicle List)
- **车辆信息管理**
  - ➕ 添加新车辆
  - ✏️ 编辑车辆信息
  - 🗑️ 删除车辆（二次确认）
  - 📋 分页显示
- **详细数据展示**
  - 电池电量进度条（渐变色）
  - 实时速度（m/s）
  - 位置坐标（X, Y）
  - 方向角（θ）
  - 最后更新时间戳
- **响应式设计**
  - 横向滚动支持
  - 固定操作列

### 4. ⚙️ 系统设置 (Settings)
- **MQTT 连接配置**
  - 服务器地址输入
  - 端口号配置
  - 协议选择（ws/wss）
  - 连接/断开按钮
  - 实时状态显示
- **VDA5050 协议说明**
  - 主题格式规范
  - 核心主题类型
  - 通信方向说明
- **友好提示**
  - 安装指南（EMQX/Mosquitto）
  - 防火墙配置提醒
  - 常见问题解答

## 📡 MQTT 配置

### 本地开发环境

1. 安装 EMQX 或 Mosquitto
   ```bash
   # Windows (使用 Chocolatey)
   choco install emqx
   
   # macOS
   brew install emqx
   ```

2. 启动 MQTT Broker
   ```bash
   emqx start
   ```

3. 在系统设置页面配置连接:
   - 服务器地址: localhost
   - 端口号: 8083
   - 协议: ws

### VDA5050 主题规范

```
vda5050/v2/{manufacturer}/{serialNumber}/{topicType}
```

**主题类型:**
- `order` - 路径规划下发(云端 → 车辆)
- `instantActions` - 即时控制指令(云端 → 车辆)
- `state` - 车辆状态上报(车辆 → 云端)
- `visualization` - 位置可视化(车辆 → 云端)
- `connection` - 连接状态(双向)

## 🎯 核心特性

### ✅ 已实现功能

#### 1. 实时通信
- ✅ 基于 WebSocket 的 MQTT 连接
- ✅ 自动重连机制（网络异常处理）
- ✅ 通配符主题订阅（支持 + 和 #）
- ✅ 消息发布/订阅模式
- ✅ VDA5050 标准协议实现
- ✅ 连接状态实时反馈

#### 2. 车辆管理
- ✅ 统一的车辆数据中心（VehicleManager）
- ✅ 实时状态更新（位置/电量/速度）
- ✅ 统计数据自动计算
- ✅ 在线/离线数量统计
- ✅ 平均电量计算
- ✅ 监听器模式（数据变化通知）

#### 3. 地图可视化
- ✅ Leaflet 开源地图引擎
- ✅ OpenStreetMap 免费地图数据
- ✅ 自定义车辆图标（颜色区分状态）
- ✅ 方向角指示（箭头指向）
- ✅ 脉冲动画效果
- ✅ 弹窗交互控制
- ✅ 地图缩放和平移

#### 4. VDA5050 协议
- ✅ Order 订单生成（路径规划）
- ✅ InstantAction 即时指令（控制命令）
- ✅ State 状态解析（车辆上报）
- ✅ Visualization 位置解析（可视化数据）
- ✅ Connection 连接状态
- ✅ 主题自动生成

#### 5. 用户界面
- ✅ 现代化紫色渐变主题
- ✅ 卡片悬停动画效果
- ✅ 全局渐变背景
- ✅ 自定义滚动条
- ✅ 响应式布局（支持移动端）
- ✅ Emoji 图标增强视觉
- ✅ 平滑过渡动画
- ✅ 按钮悬停上浮
- ✅ 输入框聚焦发光
- ✅ 表格表头渐变
- ✅ 图表圆角阴影

#### 6. 数据处理
- ✅ 模拟数据生成器（快速测试）
- ✅ 随机车辆数据
- ✅ 移动轨迹模拟
- ✅ 电量变化模拟
- ✅ JSON 格式解析

### ⏳ 待完善功能

#### 短期优化（1-2周）
- [ ] 添加全局 Loading 状态
- [ ] 优化地图初始缩放级别（自动适配所有车辆）
- [ ] 车辆历史轨迹绘制（Polyline）
- [ ] 批量操作功能（批量启动/停止）
- [ ] 错误边界处理（Error Boundary）
- [ ] 消息通知优化（Toast/Notification）

#### 中期扩展（1-2月）
- [ ] 后端 API 集成（Node.js/Express）
- [ ] 数据库持久化（InfluxDB/PostgreSQL）
- [ ] 用户认证系统（JWT）
- [ ] 历史轨迹查询和回放
- [ ] 报表导出功能（Excel/PDF）
- [ ] 实时告警系统

#### 长期规划（3-6月）
- [ ] 路径规划算法（A*/Dijkstra）
- [ ] 交通管制系统（避碰/优先级）
- [ ] 充电调度策略（低电量自动充电）
- [ ] 任务分配引擎（订单管理）
- [ ] 多车队支持
- [ ] 电子围栏功能
- [ ] 性能监控面板

## 📝 项目结构

```
test/
├── src/
│   ├── pages/                    # 页面组件
│   │   ├── Dashboard.jsx         # 📊 数据看板
│   │   ├── Dashboard.css         # 看板样式
│   │   ├── FleetMonitor.jsx      # 🗺️ 车队监控
│   │   ├── FleetMonitor.css      # 监控样式
│   │   ├── VehicleList.jsx       # 🚗 车辆管理
│   │   ├── VehicleList.css       # 列表样式
│   │   ├── Settings.jsx          # ⚙️ 系统设置
│   │   └── Settings.css          # 设置样式
│   ├── services/                 # 服务层
│   │   ├── mqttService.js        # MQTT 通信服务
│   │   └── vehicleManager.js     # 车辆数据管理
│   ├── utils/                    # 工具类
│   │   ├── vda5050Helper.js      # VDA5050 协议工具
│   │   └── mockData.js           # 模拟数据生成器
│   ├── App.jsx                   # 🏠 主应用组件
│   ├── App.css                   # 应用样式
│   ├── main.jsx                  # 🚀 入口文件
│   └── index.css                 # 全局样式
├── public/                       # 静态资源
├── dist/                         # 构建产物
├── index.html                    # HTML 模板
├── vite.config.js                # Vite 配置
├── package.json                  # 依赖配置
├── README.md                     # 📖 完整文档
├── QUICKSTART.md                 # 🚀 快速指南
└── PROJECT_SUMMARY.md            # 📋 开发总结
```

## 🔍 开发指南

### 添加新车辆（模拟数据）

在浏览器控制台执行：

```javascript
import vehicleManager from './src/services/vehicleManager';

// 模拟车辆上线
vehicleManager.updateVehicle({
  vehicleId: 'AGV001',
  status: 'online',
  position: { x: 10, y: 20, theta: 45 },
  battery: 85,
  velocity: 1.5,
  loadState: 'NONE'
});
```

### 一键生成示例数据

在"数据看板"页面点击"🚀 生成示例数据"按钮，系统会自动创建 5 辆测试车辆。

### 订阅自定义主题

``javascript
import mqttService from './src/services/mqttService';

// 订阅所有车辆的状态
mqttService.subscribe('vda5050/v2/demo/+/state', (topic, data) => {
  console.log('收到车辆状态:', topic, data);
});

// 订阅特定车辆的可视化数据
mqttService.subscribe('vda5050/v2/demo/AGV001/visualization', (topic, data) => {
  console.log('位置更新:', data);
});
```

### 发送控制指令

``javascript
import mqttService from './src/services/mqttService';
import vda5050Helper from './src/utils/vda5050Helper';

// 发送停止指令
const topic = vda5050Helper.generateTopic('AGV001', 'instantActions');
const payload = vda5050Helper.generateInstantAction('AGV001', 'STOP');
await mqttService.publish(topic, payload);

// 发送启动指令
const startPayload = vda5050Helper.generateInstantAction('AGV001', 'START');
await mqttService.publish(topic, startPayload);
```

### 下发路径规划

``javascript
import mqttService from './src/services/mqttService';
import vda5050Helper from './src/utils/vda5050Helper';

const nodes = [
  { x: 0, y: 0, theta: 0 },
  { x: 10, y: 0, theta: 0 },
  { x: 10, y: 10, theta: 90 },
  { x: 20, y: 10, theta: 0 }
];

const edges = [
  { startNodeId: 'node_0', endNodeId: 'node_1' },
  { startNodeId: 'node_1', endNodeId: 'node_2' },
  { startNodeId: 'node_2', endNodeId: 'node_3' }
];

const topic = vda5050Helper.generateTopic('AGV001', 'order');
const order = vda5050Helper.generateOrder('AGV001', nodes, edges);
await mqttService.publish(topic, order);
```

## 🎨 界面设计规范

### 配色方案

**主色调：紫色渐变**
- 起始色：#667eea
- 结束色：#764ba2

**状态颜色：**
- ✅ 在线：#52c41a（绿色）
- ⚫ 离线：#d9d9d9（灰色）
- ⚡ 充电：#13c2c2（青色）
- ❌ 故障：#ff4d4f（红色）
- ⏸️ 暂停：#faad14（橙色）

### 组件样式

**卡片设计：**
- 圆角：12px / 16px
- 阴影：`0 4px 12px rgba(0, 0, 0, 0.08)`
- 悬停效果：上浮 4px + 阴影加深
- 背景：白色或渐变

**按钮设计：**
- 主按钮：紫色渐变背景
- 悬停效果：上浮 2px + 阴影增强
- 危险按钮：红色渐变背景
- 圆角：8px

**表格设计：**
- 表头：紫色渐变背景 + 白色文字
- 行悬停：浅蓝色背景（#f0f2ff）
- 圆角边框：8px

### 动画效果

**过渡时间：**
- 快速：0.2s
- 标准：0.3s
- 慢速：0.5s

**缓动函数：**
- 标准：`ease`
- 弹性：`cubic-bezier(0.68, -0.55, 0.265, 1.55)`

## ⚠️ 注意事项

### Windows 开发环境

1. **端口访问**：确保防火墙允许 MQTT 相关端口入站连接
   - TCP 1883（MQTT）
   - WebSocket 8083（MQTT over WebSocket）

2. **路径规范**：项目路径避免包含中文或空格
   - ❌ `C:\用户\项目` 
   - ✅ `C:\projects\fleet-management`

3. **权限管理**：若安装全局包报错，尝试以管理员身份运行终端

4. **Node.js 版本**：推荐使用 LTS v18.x 或 v20.x

### MQTT Broker 配置

**推荐方案：EMQX**

安装（Windows）：
```bash
# 使用 Chocolatey
choco install emqx

# 或直接下载安装包
# https://www.emqx.io/zh/downloads
```

启动：
```bash
emqx start
```

访问 Dashboard：
- 地址：http://localhost:18083
- 默认用户名：admin
- 默认密码：public

### 常见问题

**Q: MQTT 连接失败？**
A: 
1. 检查 EMQX 是否运行：`emqx ping`
2. 确认防火墙开放端口 8083
3. 检查浏览器控制台错误信息
4. 尝试访问 http://localhost:18083 确认 EMQX 正常

**Q: 地图无法加载？**
A:
1. 检查网络连接（需要访问 OpenStreetMap CDN）
2. 确认 Leaflet CSS 已加载
3. 查看浏览器控制台是否有 CORS 错误

**Q: 车辆位置不更新？**
A:
1. 确认 MQTT 连接成功
2. 检查是否正确订阅了 visualization 主题
3. 验证车辆是否发布了位置数据
4. 查看浏览器控制台日志

**Q: 构建失败（图标导入错误）？**
A:
1. 检查 `@ant-design/icons` 导入的图标名称
2. 部分图标不存在（如 BatteryOutlined），需替换为 ThunderboltOutlined
3. 参考 Ant Design Icons 官方文档

**Q: 如何自定义主题颜色？**
A:
1. 修改 `src/index.css` 中的渐变背景
2. 修改 `src/App.css` 中的配色方案


3. 统一替换组件中的颜色值

## 📊 性能优化建议

### 代码分割
当前项目已将 ECharts 和 Ant Design 打包在一起，如需优化可使用 CDN：

```javascript
// vite.config.js
export default defineConfig({
  build: {
    rollupOptions: {
      external: ['react', 'react-dom', 'antd', 'echarts', 'leaflet'],
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
          antd: 'antd',
          echarts: 'echarts',
          leaflet: 'L'
        }
      }
    }
  }
})
```

### 消息节流
高频位置更新可能导致页面卡顿，建议：

```javascript
// 使用 lodash throttle
import throttle from 'lodash/throttle';

const handlePositionUpdate = throttle((data) => {
  vehicleManager.updatePosition(data.vehicleId, data.position);
}, 500); // 每 500ms 最多更新一次
```

## 📄 License

MIT

---

**开发团队**: 灵码 AI Assistant  
**版本**: v1.1.0  
**最后更新**: 2024

**技术支持**: 
- GitHub Issues
- 文档查阅
- 社区交流
