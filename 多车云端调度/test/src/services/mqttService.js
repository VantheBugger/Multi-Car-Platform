import mqtt from 'mqtt';

class MQTTService {
  constructor() {
    this.client = null;
    this.connected = false;
    this.messageHandlers = [];
    this.config = {
      host: 'localhost',
      port: 8788,
      protocol: 'bridge',
      token: '',
      clientId: `fleet_client_${Math.random().toString(16).substr(2, 8)}`,
    };
  }

  // 连接MQTT Broker
  connect(options = {}) {
    const config = { ...this.config, ...options };
    this.config = config;

    if (this.connected && this.client) {
      return Promise.resolve(this.client);
    }

    if (this.client) {
      this.disconnect();
    }

    if (config.protocol === 'bridge' || config.protocol === 'bridge-wss') {
      return this.connectBridge(config);
    }

    const websocketProtocols = ['ws', 'wss'];
    const path = websocketProtocols.includes(config.protocol) ? '/mqtt' : '';
    const url = `${config.protocol}://${config.host}:${config.port}${path}`;

    return new Promise((resolve, reject) => {
      try {
        this.client = mqtt.connect(url, {
          clientId: config.clientId,
          clean: true,
          connectTimeout: 4000,
          reconnectPeriod: 1000,
        });

        this.client.on('connect', () => {
          console.log('✅ MQTT连接成功');
          this.connected = true;
          resolve(this.client);
        });

        this.client.on('error', (err) => {
          console.error('❌ MQTT连接错误:', err);
          this.connected = false;
          this.client = null;
          reject(err);
        });

        this.client.on('close', () => {
          console.log('🔌 MQTT连接关闭');
          this.connected = false;
          this.client = null;
        });

        this.client.on('message', (topic, message) => {
          this.handleMessage(topic, message);
        });

        this.client.on('reconnect', () => {
          console.log('🔄 MQTT重新连接...');
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  // 连接本地 MQTT 桥接服务，供浏览器间接读取 mqtt:// Broker 数据
  connectBridge(config) {
    const scheme = config.protocol === 'bridge-wss' ? 'wss' : 'ws';
    const port = String(config.port || '').trim();
    const shouldIncludePort = port && !(
      (scheme === 'wss' && port === '443') ||
      (scheme === 'ws' && port === '80')
    );
    const token = config.token ? `?token=${encodeURIComponent(config.token)}` : '';
    const url = `${scheme}://${config.host}${shouldIncludePort ? `:${port}` : ''}/bridge${token}`;

    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      let settled = false;

      socket.onopen = () => {
        this.client = socket;
        this.connected = true;
        settled = true;
        console.log('✅ MQTT桥接连接成功');
        resolve(socket);
      };

      socket.onerror = (error) => {
        console.error('❌ MQTT桥接连接错误:', error);
        this.connected = false;
        this.client = null;
        if (!settled) {
          settled = true;
          reject(new Error(`无法连接桥接服务: ${url}`));
        }
      };

      socket.onclose = () => {
        console.log('🔌 MQTT桥接连接关闭');
        this.connected = false;
        this.client = null;
      };

      socket.onmessage = (event) => {
        this.handleBridgeMessage(event.data);
      };
    });
  }

  // 断开连接
  disconnect() {
    if (this.client) {
      if (typeof this.client.end === 'function') {
        this.client.end();
      } else if (typeof this.client.close === 'function') {
        this.client.close();
      }
    }

    this.client = null;
    this.connected = false;
  }

  // 订阅主题
  subscribe(topic, callback) {
    if (!this.client || !this.connected) {
      console.warn('⚠️ MQTT未连接,无法订阅');
      return;
    }

    if (this.client instanceof WebSocket) {
      this.client.send(JSON.stringify({ type: 'subscribe', topic }));
      if (callback) {
        this.messageHandlers.push({ topic, callback });
      }
      console.log(`✅ 桥接订阅主题: ${topic}`);
      return;
    }

    this.client.subscribe(topic, (err) => {
      if (err) {
        console.error(`❌ 订阅主题失败: ${topic}`, err);
      } else {
        console.log(`✅ 订阅主题: ${topic}`);
      }
    });

    if (callback) {
      this.messageHandlers.push({ topic, callback });
    }
  }

  // 取消订阅
  unsubscribe(topic) {
    if (!this.client || !this.connected) return;
    
    this.client.unsubscribe(topic, (err) => {
      if (err) {
        console.error(`❌ 取消订阅失败: ${topic}`, err);
      } else {
        console.log(`✅ 取消订阅: ${topic}`);
      }
    });

    this.messageHandlers = this.messageHandlers.filter(h => h.topic !== topic);
  }

  // 发布消息
  publish(topic, payload, options = {}) {
    if (!this.client || !this.connected) {
      console.warn('⚠️ MQTT未连接,无法发布消息');
      return Promise.reject(new Error('MQTT未连接'));
    }

    if (this.client instanceof WebSocket) {
      this.client.send(JSON.stringify({ type: 'publish', topic, payload }));
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const message = typeof payload === 'object' ? JSON.stringify(payload) : payload;
      
      this.client.publish(topic, message, options, (err) => {
        if (err) {
          console.error(`❌ 发布消息失败: ${topic}`, err);
          reject(err);
        } else {
          console.log(`✅ 发布消息到: ${topic}`);
          resolve();
        }
      });
    });
  }

  sendBridgeCommand(command) {
    if (!this.client || !this.connected || !(this.client instanceof WebSocket)) {
      return Promise.reject(new Error('当前未连接 bridge 服务'));
    }

    this.client.send(JSON.stringify(command));
    return Promise.resolve();
  }

  // 处理接收到的消息
  handleMessage(topic, message) {
    const payload = message.toString();
    
    // 触发所有匹配的处理器
    this.messageHandlers.forEach(({ topic: filterTopic, callback }) => {
      // 支持通配符匹配
      if (this.topicMatch(topic, filterTopic)) {
        try {
          const data = JSON.parse(payload);
          callback(topic, data);
        } catch (e) {
          callback(topic, payload);
        }
      }
    });
  }

  handleBridgeMessage(message) {
    let data;
    try {
      data = JSON.parse(message);
    } catch {
      return;
    }

    if (data.type !== 'mqtt_message') {
      return;
    }

    this.messageHandlers.forEach(({ topic: filterTopic, callback }) => {
      if (this.topicMatch(data.topic, filterTopic)) {
        callback(data.topic, data.payload);
      }
    });
  }

  // 主题匹配(支持通配符)
  topicMatch(topic, filter) {
    if (topic === filter) return true;
    
    const topicParts = topic.split('/');
    const filterParts = filter.split('/');
    
    if (filterParts.length > topicParts.length) return false;
    
    for (let i = 0; i < filterParts.length; i++) {
      if (filterParts[i] === '#') return true;
      if (filterParts[i] !== '+' && filterParts[i] !== topicParts[i]) {
        return false;
      }
    }
    
    return filterParts.length === topicParts.length;
  }

  // 获取连接状态
  isConnected() {
    return this.connected;
  }

  // 生成VDA5050标准主题
  generateVDA5050Topic(manufacturer, serialNumber, topicType) {
    return `vda5050/v2/${manufacturer}/${serialNumber}/${topicType}`;
  }
}

// 导出单例
export default new MQTTService();
