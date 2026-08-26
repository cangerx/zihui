import { useEffect, useState } from 'react';
import {
  Button, Card, Col, Empty, Form, Input, message, Popconfirm, Progress,
  Row, Space, Statistic, Table, Tag, Tooltip,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { CloudServerOutlined, ReloadOutlined, SyncOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { syncStorageApi } from '../services/api';

interface StorageUser {
  user_id: number;
  username: string;
  nickname?: string | null;
  used_bytes: number;
  total_quota: number;
  unlimited: boolean;
  blob_count: number;
  last_sync_at: string | null;
}

interface StorageStats {
  used_total: number;
  user_count: number;
  blob_count: number;
  blob_bytes: number;
  record_count: number;
  by_category: { image: number; video: number; data: number };
  by_driver: { local: number; cos: number; oss: number };
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export default function SyncStoragePage() {
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [list, setList] = useState<{ data: StorageUser[]; total: number }>({ data: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [params, setParams] = useState<Record<string, any>>({ page: 1, per_page: 20 });

  const loadStats = async () => {
    try {
      const res = await syncStorageApi.stats();
      setStats(res.data);
    } catch (e: any) {
      message.error('加载统计失败：' + (e?.response?.data?.error || e?.message));
    }
  };

  const loadList = async () => {
    setLoading(true);
    try {
      const res = await syncStorageApi.users(params);
      setList(res.data);
    } catch (e: any) {
      message.error('加载列表失败：' + (e?.response?.data?.error || e?.message));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadStats(); }, []);
  useEffect(() => { loadList(); /* eslint-disable-next-line */ }, [params]);

  const refreshAll = () => { loadStats(); loadList(); };

  const doReconcile = async () => {
    setReconciling(true);
    try {
      await syncStorageApi.reconcile();
      message.success('对账完成');
      refreshAll();
    } catch (e: any) {
      message.error('对账失败：' + (e?.response?.data?.error || e?.message));
    } finally {
      setReconciling(false);
    }
  };

  const doRecompute = async (userId: number) => {
    try {
      await syncStorageApi.recompute(userId);
      message.success('已重算');
      refreshAll();
    } catch (e: any) {
      message.error('重算失败：' + (e?.response?.data?.error || e?.message));
    }
  };

  const columns: ColumnsType<StorageUser> = [
    { title: '用户', render: (_, r) => (
      <Tooltip title={`用户 ID: ${r.user_id}`}>
        <span>{r.nickname || r.username || `#${r.user_id}`}</span>
      </Tooltip>
    ) },
    { title: '已用容量', dataIndex: 'used_bytes', width: 120, render: (v: number) => formatBytes(v) },
    { title: '配额', width: 120, render: (_, r) => (r.unlimited ? <Tag>不限</Tag> : formatBytes(r.total_quota)) },
    { title: '占用率', width: 180, render: (_, r) => {
      if (r.unlimited || r.total_quota <= 0) return <span style={{ color: '#bbb' }}>—</span>;
      const pct = Math.min(100, Math.round((r.used_bytes * 100) / r.total_quota));
      return <Progress percent={pct} size="small" status={pct >= 100 ? 'exception' : 'normal'} />;
    } },
    { title: '媒体数', dataIndex: 'blob_count', width: 90 },
    { title: '最后同步', dataIndex: 'last_sync_at', width: 170,
      render: (v: string | null) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-') },
    { title: '操作', width: 90, fixed: 'right', render: (_, r) => (
      <Popconfirm title="重算该用户已用容量？" okText="重算" cancelText="取消" onConfirm={() => doRecompute(r.user_id)}>
        <Button size="small" type="link">重算</Button>
      </Popconfirm>
    ) },
  ];

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>
        <CloudServerOutlined /> 云同步存储
      </h2>
      <p style={{ color: '#888', marginTop: -8 }}>
        各账号上传到云端的同步数据与媒体占用情况。容量计费在「系统设置 → 数据同步」开启，套餐容量在「套餐」配置。
      </p>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={8} md={4}>
          <Card size="small"><Statistic title="总占用" value={formatBytes(stats?.used_total ?? 0)} /></Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small"><Statistic title="用户数" value={stats?.user_count ?? 0} /></Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small"><Statistic title="媒体文件" value={stats?.blob_count ?? 0} /></Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small"><Statistic title="媒体占用" value={formatBytes(stats?.blob_bytes ?? 0)} /></Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic title="图/视/数据"
              value={`${formatBytes(stats?.by_category.image ?? 0)} / ${formatBytes(stats?.by_category.video ?? 0)} / ${formatBytes(stats?.by_category.data ?? 0)}`}
              valueStyle={{ fontSize: 13 }} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic title="本地/腾讯/阿里"
              value={`${stats?.by_driver.local ?? 0}/${stats?.by_driver.cos ?? 0}/${stats?.by_driver.oss ?? 0}`} />
          </Card>
        </Col>
      </Row>

      <Card size="small" style={{ marginBottom: 12 }}>
        <Form layout="inline" onFinish={(v: any) => setParams({ ...params, ...v, page: 1 })}>
          <Form.Item name="keyword">
            <Input.Search placeholder="用户名 / 昵称" allowClear style={{ width: 200 }} />
          </Form.Item>
          <Form.Item name="user_id">
            <Input placeholder="用户 ID" type="number" style={{ width: 110 }} />
          </Form.Item>
          <Form.Item>
            <Button htmlType="submit" type="primary">筛选</Button>
          </Form.Item>
          <Form.Item>
            <Button icon={<ReloadOutlined />} onClick={refreshAll}>刷新</Button>
          </Form.Item>
        </Form>
      </Card>

      <Space style={{ marginBottom: 12 }}>
        <Popconfirm title="对全部用户重算已用容量？" okText="对账" cancelText="取消" onConfirm={doReconcile}>
          <Button icon={<SyncOutlined />} loading={reconciling}>全量对账</Button>
        </Popconfirm>
      </Space>

      <Table<StorageUser>
        rowKey="user_id"
        size="small"
        loading={loading}
        dataSource={list.data || []}
        columns={columns}
        scroll={{ x: 900 }}
        locale={{ emptyText: <Empty description="暂无同步数据" /> }}
        pagination={{
          current: params.page,
          pageSize: params.per_page,
          total: list.total,
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 条`,
          onChange: (p, ps) => setParams({ ...params, page: p, per_page: ps }),
        }}
      />
    </div>
  );
}
