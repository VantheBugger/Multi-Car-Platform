import React, { useState, useEffect } from 'react';
import { ConfigProvider, Layout, Menu, theme as antdTheme } from 'antd';
import {
  DashboardOutlined,
  CarOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import Dashboard from './pages/Dashboard';
import FleetMonitor from './pages/FleetMonitor';
import VehicleList from './pages/VehicleList';
import Settings from './pages/Settings';
import './App.css';
import mqttService from './services/mqttService';
import vehicleManager from './services/vehicleManager';

const { Header, Sider, Content } = Layout;

function App() {
  const [currentMenu, setCurrentMenu] = useState('monitor');
  const [mqttConnected, setMqttConnected] = useState(false);
  const [onlineVehicleCount, setOnlineVehicleCount] = useState(0);

  useEffect(() => {
    let active = true;

    const syncVehiclePresence = () => {
      if (!active) return;
      setOnlineVehicleCount(vehicleManager.getOnlineCount());
    };

    const autoConnectLocalBridge = async () => {
      if (mqttService.isConnected()) {
        if (active) setMqttConnected(true);
        syncVehiclePresence();
        return;
      }

      try {
        await mqttService.connect({
          host: 'localhost',
          port: 8788,
          protocol: 'bridge',
        });
        if (active) setMqttConnected(true);
      } catch (error) {
        if (active) setMqttConnected(false);
        console.error('自动连接本地 bridge 失败:', error);
      }
      syncVehiclePresence();
    };

    const handleVehicleChange = () => {
      syncVehiclePresence();
    };

    vehicleManager.addListener(handleVehicleChange);
    syncVehiclePresence();
    autoConnectLocalBridge();

    return () => {
      active = false;
      vehicleManager.removeListener(handleVehicleChange);
    };
  }, []);

  const menuItems = [
    {
      key: 'dashboard',
      icon: <DashboardOutlined />,
      label: '数据看板',
    },
    {
      key: 'monitor',
      icon: <CarOutlined />,
      label: '车队监控',
    },
    {
      key: 'vehicles',
      icon: <CarOutlined />,
      label: '车辆管理',
    },
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: '系统设置',
    },
  ];

  const renderContent = () => {
    switch (currentMenu) {
      case 'dashboard':
        return <Dashboard mqttConnected={mqttConnected} />;
      case 'monitor':
        return <FleetMonitor mqttConnected={mqttConnected} />;
      case 'vehicles':
        return <VehicleList />;
      case 'settings':
        return <Settings mqttConnected={mqttConnected} onConnectChange={setMqttConnected} />;
      default:
        return <Dashboard mqttConnected={mqttConnected} />;
    }
  };

  return (
    <ConfigProvider
      theme={{
        algorithm: antdTheme.darkAlgorithm,
        token: {
          colorPrimary: '#3794ff',
          colorInfo: '#3794ff',
          colorSuccess: '#4ec9b0',
          colorWarning: '#cca700',
          colorError: '#f14c4c',
          colorBgBase: '#181818',
          colorBgContainer: '#252526',
          colorBgElevated: '#2d2d30',
          colorText: '#f0f0f0',
          colorTextSecondary: '#b3b3b3',
          colorBorder: '#3c3c3c',
          borderRadius: 6,
          controlHeight: 34,
        },
        components: {
          Layout: { bodyBg: '#181818', headerBg: '#1f1f1f', siderBg: '#181818' },
          Menu: { darkItemBg: '#181818', darkItemSelectedBg: '#37373d' },
          Card: { headerBg: '#252526' },
          Table: { headerBg: '#2d2d30', rowHoverBg: '#2a2d2e' },
        },
      }}
    >
      <Layout className="app-shell">
        <Sider width={208} theme="dark" className="app-sider">
          <div className="logo">
            <CarOutlined />
            <span>车队调度</span>
          </div>
          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={[currentMenu]}
            items={menuItems}
            onClick={({ key }) => setCurrentMenu(key)}
          />
          <div className="app-status">
            <div className={mqttConnected ? 'is-connected' : 'is-disconnected'}>
              <i />
              {mqttConnected ? 'Bridge/Broker 已连接' : 'Bridge/Broker 未连接'}
            </div>
            <div className={onlineVehicleCount > 0 ? 'is-connected' : 'is-idle'}>
              <i />
              在线车辆 {onlineVehicleCount}
            </div>
          </div>
        </Sider>
        <Layout className="app-main">
          <Header className="app-header">
            <h1>无人车队云端调度系统</h1>
            <span>V1.0</span>
          </Header>
          <Content className="app-content">
            {renderContent()}
          </Content>
        </Layout>
      </Layout>
    </ConfigProvider>
  );
}

export default App;
