# 🚀 快速启动指南

## 第一步：环境准备

确保已安装：
- ✅ Node.js (推荐 LTS v18.x 或 v20.x)
- ✅ Visual Studio Code
- ✅ 浏览器（Chrome/Edge/Firefox）

## 第二步：安装依赖（如果还没安装）

```bash
cd test
npm install
```

> 💡 提示：首次安装可能需要几分钟，请耐心等待。

## 第三步：启动开发服务器

```bash
npm run dev
```

服务器将在 **http://localhost:5173** 自动启动

## 第四步：访问系统

打开浏览器访问：**http://localhost:5173**

您将看到登录界面（如果有）或直接进入主界面。

## 第五步：生成示例数据

1. 点击左侧菜单 **"📊 数据看板"**
2. 点击页面顶部的 **"🚀 生成示例数据"** 按钮
3. 系统将自动生成 **5 辆示例车辆**
4. 查看统计卡片、车辆列表和电池分布图

## 第六步：体验功能

### 📊 数据看板
- 查看实时统计数据
- 浏览车辆列表
- 分析电池分布

### 🗺️ 车队监控
1. 切换到 **"🗺️ 车队监控"** 页面
2. 在地图上查看车辆位置
3. 点击车辆标记查看详情
4. 尝试远程控制按钮（启动/暂停/停止）
5. 点击 **"发送测试路径"** 体验路径下发

### 🚗 车辆管理
1. 切换到 **"🚗 车辆管理"** 页面
2. 点击 **"添加车辆"** 创建新车辆
3. 编辑现有车辆信息
4. 删除不需要的车辆

### ⚙️ 系统设置
1. 切换到 **"⚙️ 系统设置"** 页面
2. 配置 MQTT 连接参数
3. 点击 **"连接"** 按钮
4. 查看连接状态

## 🔌 配置 MQTT（可选）

如果需要真实的车辆通信，需要安装 MQTT Broker：

### 方案一：EMQX（推荐）

**安装：**
```bash
# Windows (使用 Chocolatey)
choco install emqx

# macOS
brew install emqx
```

**启动：**
```bash
emqx start
```

**配置：**
在系统设置页面输入：
- 服务器地址：`localhost`
- 端口号：`8083`
- 协议：`ws`

点击 **"连接"** 按钮。

### 方案二：Mosquitto

**安装：**
```bash
# Windows
# 下载安装包：https://mosquitto.org/download/

# macOS
brew install mosquitto
```

**启动：**
```bash
mosquitto -v
```

**配置：**
同 EMQX 配置方式。

## 🎯 快速测试

### 测试 1：查看车辆数据
```javascript
// 在浏览器控制台执行
import vehicleManager from './src/services/vehicleManager';
console.log('所有车辆:', vehicleManager.getAllVehicles());
console.log('统计数据:', vehicleManager.getStatistics());
```

### 测试 2：模拟车辆上线
```javascript
vehicleManager.updateVehicle({
  vehicleId: 'TEST001',
  status: 'online',
  position: { x: 50, y: 50, theta: 90 },
  battery: 95,
  velocity: 2.0
});
```

### 测试 3：订阅 MQTT 主题
```javascript
import mqttService from './src/services/mqttService';
mqttService.subscribe('vda5050/v2/+/+/state', (topic, data) => {
  console.log('收到状态:', topic, data);
});
```

## 🎨 界面特色

### 视觉效果
- ✨ **紫色渐变主题**：现代化设计风格
- 🎭 **悬停动画**：卡片上浮、阴影加深
- 🌈 **状态颜色**：直观的车辆状态标识
- 📱 **响应式布局**：支持各种屏幕尺寸

### 交互体验
- 🖱️ **鼠标悬停**：卡片和按钮有平滑动画
- 💫 **脉冲效果**：地图车辆标记有动态效果
- 🎨 **渐变背景**：全局紫色渐变背景
- 📜 **自定义滚动条**：更美观的滚动体验

## ❓ 常见问题

**Q: 页面空白怎么办？**
A: 
1. 检查浏览器控制台是否有错误
2. 确认开发服务器正在运行
3. 刷新页面（F5）

**Q: 如何停止服务器？**
A: 
在终端按 `Ctrl + C`

**Q: 如何清除示例数据？**
A: 
刷新页面即可重置数据

**Q: 地图不显示怎么办？**
A:
1. 检查网络连接
2. 确认可以访问 OpenStreetMap
3. 查看浏览器控制台错误

**Q: 想修改主题颜色？**
A:
编辑 `src/index.css` 和 `src/App.css` 中的渐变色值

## 🎉 开始使用

现在您已经完成了所有准备工作，可以开始使用无人车队云端调度系统了！

**祝您使用愉快！** 🚀

---

**提示**：如需更多帮助，请查阅 [README.md](README.md) 完整文档。
