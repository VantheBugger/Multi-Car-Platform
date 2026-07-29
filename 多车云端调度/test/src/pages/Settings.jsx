import React, { useEffect, useState } from 'react';
import { Card, Form, Input, Button, Space, message, Divider, Select } from 'antd';
import { RocketOutlined, PoweroffOutlined } from '@ant-design/icons';
import mqttService from '../services/mqttService';
import './Settings.css';

function Settings({ mqttConnected, onConnectChange }) {
  const [form] = Form.useForm();
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    setConnected(mqttConnected || mqttService.isConnected());
  }, [mqttConnected]);

  const handleConnect = async (values) => {
    setConnecting(true);
    try {
      await mqttService.connect({
        host: values.host || 'localhost',
        port: values.port ? parseInt(values.port, 10) : undefined,
        protocol: values.protocol || 'bridge',
        token: values.token || '',
      });

      setConnected(true);
      onConnectChange(true);
      message.success('Bridge/Broker连接成功');
    } catch (error) {
      message.error(`连接失败: ${error.message}`);
      console.error(error);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = () => {
    mqttService.disconnect();
    setConnected(false);
    onConnectChange(false);
    message.info('已断开连接');
  };

  return (
    <div className="settings">
      <Card title="MQTT连接配置">
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            host: 'localhost',
            port: '8788',
            protocol: 'bridge',
            token: '',
          }}
          onFinish={handleConnect}
        >
          <Form.Item
            name="host"
            label="服务器地址"
            rules={[{ required: true, message: '请输入服务器地址' }]}
          >
            <Input placeholder="例如: localhost 或 broker.emqx.io" />
          </Form.Item>

          <Form.Item
            name="port"
            label="端口号"
          >
            <Input placeholder="本地 bridge: 8788；公网 bridge-wss: 443；WebSocket MQTT: 8083" />
          </Form.Item>

          <Form.Item
            name="protocol"
            label="协议"
            rules={[{ required: true, message: '请选择协议' }]}
          >
            <Select
              options={[
                { label: 'bridge - 本地后端桥接', value: 'bridge' },
                { label: 'bridge-wss - 公网安全桥接', value: 'bridge-wss' },
                { label: 'ws - MQTT over WebSocket', value: 'ws' },
                { label: 'wss - 加密 WebSocket', value: 'wss' },
                { label: 'mqtt - 原生 MQTT TCP', value: 'mqtt' },
              ]}
            />
          </Form.Item>

          <Form.Item
            name="token"
            label="桥接访问令牌"
          >
            <Input.Password placeholder="公网 bridge 配置了 BRIDGE_TOKEN 时填写" />
          </Form.Item>

          <Form.Item>
            <Space>
              <Button
                type="primary"
                htmlType="submit"
                icon={<RocketOutlined />}
                loading={connecting}
                disabled={connected}
              >
                连接
              </Button>
              <Button
                danger
                icon={<PoweroffOutlined />}
                onClick={handleDisconnect}
                disabled={!connected}
              >
                断开
              </Button>
            </Space>
          </Form.Item>
        </Form>

        <Divider />

        <div style={{ marginTop: 24 }}>
          <h3>连接状态</h3>
          <p>
            当前 Bridge/Broker 状态:
            <span style={{
              color: connected ? '#52c41a' : '#ff4d4f',
              marginLeft: 8,
              fontWeight: 'bold'
            }}>
              {connected ? '已连接' : '未连接'}
            </span>
          </p>
          <p className="settings-note">
            这只表示网页已经连上 bridge，且 bridge 已连上 MQTT Broker，不代表真实车辆已经在线。
          </p>

          <h4>说明:</h4>
          <ul className="settings-help-list">
            <li>bridge 模式连接本地桥接服务，默认端口 8788</li>
            <li>bridge-wss 模式用于 HTTPS 网站连接公网桥接服务，通常端口 443</li>
            <li>桥接服务负责连接真实 MQTT Broker 的 1883 端口</li>
            <li>ws/wss 模式用于 Broker 已开启 MQTT over WebSocket 的场景</li>
            <li>公网部署时建议给桥接服务配置 BRIDGE_TOKEN 或使用 Cloudflare Access</li>
          </ul>
        </div>
      </Card>

      <Card title="VDA5050协议配置" style={{ marginTop: 16 }}>
        <p>本系统遵循 VDA5050 标准协议进行车辆通信。</p>
        <p><strong>主题格式:</strong> vda5050/v2/{'{制造商}'}/{'{车辆序列号}'}/{'{主题类型}'}</p>
        <p><strong>支持的主题类型:</strong></p>
        <ul>
          <li><code>order</code> - 路径规划下发</li>
          <li><code>instantActions</code> - 即时控制指令</li>
          <li><code>state</code> - 车辆状态上报</li>
          <li><code>visualization</code> - 位置可视化</li>
          <li><code>connection</code> - 连接状态</li>
        </ul>
      </Card>
    </div>
  );
}

export default Settings;
