import React, { useState, useEffect } from 'react';
import { Card, Table, Tag, Button, Space, Modal, Form, Input, message, Progress } from 'antd';
import { 
  DeleteOutlined, 
  EditOutlined,
  ThunderboltOutlined
} from '@ant-design/icons';
import vehicleManager from '../services/vehicleManager';
import './VehicleList.css';

function VehicleList() {
  const [vehicles, setVehicles] = useState([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => {
    // 监听车辆数据变化
    const handleVehicleChange = (updatedVehicles) => {
      setVehicles(updatedVehicles);
    };

    vehicleManager.addListener(handleVehicleChange);
    setVehicles(vehicleManager.getAllVehicles());

    return () => {
      vehicleManager.removeListener(handleVehicleChange);
    };
  }, []);

  // 删除车辆
  const handleDelete = (vehicleId) => {
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除车辆 ${vehicleId} 吗?`,
      onOk: () => {
        vehicleManager.removeVehicle(vehicleId);
        message.success('删除成功');
      }
    });
  };

  // 表格列定义
  const columns = [
    {
      title: '车辆ID',
      dataIndex: 'vehicleId',
      key: 'vehicleId',
      width: 150,
      fixed: 'left',
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
      title: '电池电量',
      dataIndex: 'battery',
      key: 'battery',
      render: (battery) => (
        <div style={{ minWidth: 150 }}>
          <Progress 
            percent={battery} 
            status={battery > 50 ? 'success' : battery > 20 ? 'normal' : 'exception'}
            strokeColor={{
              '0%': battery > 50 ? '#52c41a' : battery > 20 ? '#faad14' : '#ff4d4f',
              '100%': battery > 50 ? '#95de64' : battery > 20 ? '#ffd666' : '#ff7875',
            }}
          />
        </div>
      ),
    },
    {
      title: '速度(m/s)',
      dataIndex: 'velocity',
      key: 'velocity',
      render: (velocity) => velocity.toFixed(2),
    },
    {
      title: '位置X',
      dataIndex: ['position', 'x'],
      key: 'positionX',
      render: (x) => x.toFixed(2),
    },
    {
      title: '位置Y',
      dataIndex: ['position', 'y'],
      key: 'positionY',
      render: (y) => y.toFixed(2),
    },
    {
      title: '方向角',
      dataIndex: ['position', 'theta'],
      key: 'theta',
      render: (theta) => `${theta.toFixed(1)}°`,
    },
    {
      title: '最后更新',
      dataIndex: 'lastUpdate',
      key: 'lastUpdate',
      render: (timestamp) => {
        const date = new Date(timestamp);
        return date.toLocaleTimeString();
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 150,
      fixed: 'right',
      render: (_, record) => (
        <Space size="small">
          <Button 
            type="link" 
            icon={<EditOutlined />}
            onClick={() => {
              form.setFieldsValue(record);
              setModalVisible(true);
            }}
          >
            编辑
          </Button>
          <Button 
            type="link" 
            danger 
            icon={<DeleteOutlined />}
            onClick={() => handleDelete(record.vehicleId)}
          >
            删除
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div className="vehicle-list">
      <Card 
        title="车辆管理"
        extra={
          <Button type="primary" onClick={() => {
            form.resetFields();
            setModalVisible(true);
          }}>
            添加车辆
          </Button>
        }
      >
        <Table
          dataSource={vehicles}
          columns={columns}
          rowKey="vehicleId"
          scroll={{ x: 1200 }}
          pagination={{ pageSize: 10 }}
        />
      </Card>

      {/* 添加/编辑车辆对话框 */}
      <Modal
        title={form.getFieldValue('vehicleId') ? '编辑车辆' : '添加车辆'}
        open={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          form.resetFields();
        }}
        onOk={() => {
          form.validateFields().then(values => {
            vehicleManager.updateVehicle(values);
            message.success('保存成功');
            setModalVisible(false);
            form.resetFields();
          });
        }}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="vehicleId"
            label="车辆ID"
            rules={[{ required: true, message: '请输入车辆ID' }]}
          >
            <Input placeholder="例如: AGV001" disabled={!!form.getFieldValue('vehicleId')} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

export default VehicleList;
