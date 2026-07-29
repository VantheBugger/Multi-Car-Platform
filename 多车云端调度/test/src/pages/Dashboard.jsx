import React, { useState, useEffect } from 'react';
import { Card, Row, Col, Statistic, Table, Tag, Button, message } from 'antd';
import { 
  CarOutlined, 
  ThunderboltOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  RocketOutlined
} from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import vehicleManager from '../services/vehicleManager';
import mqttService from '../services/mqttService';
import vda5050Helper from '../utils/vda5050Helper';
import { initDemoVehicles } from '../utils/mockData';
import './Dashboard.css';

function Dashboard({ mqttConnected }) {
  const [vehicles, setVehicles] = useState([]);
  const [statistics, setStatistics] = useState({});

  useEffect(() => {
    // 监听车辆数据变化
    const handleVehicleChange = (updatedVehicles) => {
      setVehicles(updatedVehicles);
      setStatistics(vehicleManager.getStatistics());
    };

    vehicleManager.addListener(handleVehicleChange);
    setVehicles(vehicleManager.getAllVehicles());
    setStatistics(vehicleManager.getStatistics());

    // 订阅所有车辆状态主题
    if (mqttConnected) {
      mqttService.subscribe('vda5050/v2/+/+/state', (topic, data) => {
        const state = vda5050Helper.parseState(data);
        if (state) {
          vehicleManager.updateVehicle(state);
        }
      });
    }

    return () => {
      vehicleManager.removeListener(handleVehicleChange);
    };
  }, [mqttConnected]);

  // 表格列定义
  const columns = [
    {
      title: '车辆ID',
      dataIndex: 'vehicleId',
      key: 'vehicleId',
      width: 120,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status) => {
        const colorMap = {
          online: 'success',
          offline: 'default',
          charging: 'processing',
          error: 'error',
          paused: 'warning'
        };
        return <Tag color={colorMap[status]}>{status.toUpperCase()}</Tag>;
      },
    },
    {
      title: '电量',
      dataIndex: 'battery',
      key: 'battery',
      render: (battery) => (
        <span>
          <ThunderboltOutlined /> {battery}%
        </span>
      ),
    },
    {
      title: '速度(m/s)',
      dataIndex: 'velocity',
      key: 'velocity',
      render: (velocity) => velocity.toFixed(2),
    },
    {
      title: '位置',
      key: 'position',
      render: (_, record) => (
        <span>({record.position.x.toFixed(1)}, {record.position.y.toFixed(1)})</span>
      ),
    },
  ];

  // 电池分布图表配置
  const batteryOption = {
    backgroundColor: 'transparent',
    grid: { top: 24, right: 24, bottom: 28, left: 48 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#252526',
      borderColor: '#464647',
      textStyle: { color: '#f0f0f0' },
    },
    xAxis: {
      type: 'category',
      data: vehicles.map((vehicle) => vehicle.vehicleId),
      axisLine: { lineStyle: { color: '#464647' } },
      axisLabel: { color: '#b3b3b3' },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      max: 100,
      axisLabel: { color: '#b3b3b3' },
      splitLine: { lineStyle: { color: '#333333' } },
    },
    series: [{
      data: vehicles.map((vehicle) => ({
        value: vehicle.battery,
        itemStyle: {
          color: vehicle.battery > 50 ? '#4ec9b0' : vehicle.battery > 20 ? '#cca700' : '#f14c4c',
          borderRadius: [3, 3, 0, 0],
        },
      })),
      type: 'bar',
      barMaxWidth: 36,
    }],
  };

  return (
    <div className="dashboard">
      {/* 操作按钮 */}
      <div style={{ marginBottom: 16 }}>
        <Button 
          type="primary" 
          icon={<RocketOutlined />}
          onClick={() => {
            initDemoVehicles();
            message.success('已生成5辆示例车辆数据');
          }}
        >
          生成示例数据
        </Button>
      </div>

      {/* 统计卡片 */}
      <Row gutter={[24, 24]} style={{ marginBottom: 32 }}>
        <Col xs={24} sm={12} md={6}>
          <Card className="statistic-card">
            <Statistic
              title="车辆总数"
              value={statistics.total || 0}
              prefix={<CarOutlined />}
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card className="statistic-card">
            <Statistic
              title="在线车辆"
              value={statistics.online || 0}
              prefix={<CheckCircleOutlined />}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card className="statistic-card">
            <Statistic
              title="充电中"
              value={statistics.charging || 0}
              prefix={<ThunderboltOutlined />}
              valueStyle={{ color: '#13c2c2' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card className="statistic-card">
            <Statistic
              title="平均电量"
              value={`${statistics.avgBattery || 0}%`}
              valueStyle={{ color: '#faad14' }}
            />
          </Card>
        </Col>
      </Row>

      {/* 车辆列表 */}
      <Card title="车辆列表" className="table-card" style={{ marginBottom: 24 }}>
        <Table
          dataSource={vehicles}
          columns={columns}
          rowKey="vehicleId"
          pagination={false}
          size="small"
          locale={{ emptyText: '暂无车辆数据' }}
        />
      </Card>

      {/* 电池分布图 */}
      {vehicles.length > 0 && (
        <Card title="电池分布" className="chart-card">
          <ReactECharts option={batteryOption} style={{ height: 350 }} />
        </Card>
      )}
    </div>
  );
}

export default Dashboard;
