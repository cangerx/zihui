import { useEffect, useState } from 'react';
import { Button, Card, DatePicker, Descriptions, Input, InputNumber, message, Modal, Select, Space, Statistic, Table, Tag, Typography } from 'antd';
import { EyeOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { commissionOrderApi } from '../services/api';
import { useUrlSyncedParams } from '../hooks/useUrlSyncedParams';

const { Text } = Typography;

const ORDER_STATUS: Record<string, { color: string; label: string }> = {
  pending: { color: 'gold', label: '待支付' },
  paid: { color: 'green', label: '已支付' },
  closed: { color: 'default', label: '已关闭' },
  failed: { color: 'red', label: '失败' },
  refunded: { color: 'purple', label: '已退款' },
};

const COMMISSION_STATUS: Record<string, { color: string; label: string }> = {
  none: { color: 'default', label: '无佣金' },
  pending: { color: 'gold', label: '待确认' },
  confirmed: { color: 'green', label: '已确认' },
  settled: { color: 'blue', label: '已结算' },
  cancelled: { color: 'red', label: '已取消' },
};

const ORDER_TYPE: Record<string, { color: string; label: string }> = {
  purchase: { color: 'blue', label: '购买' },
  renew: { color: 'cyan', label: '续费' },
  upgrade: { color: 'orange', label: '升级' },
};

const PAY_CHANNEL: Record<string, string> = {
  wechat_native: '微信扫码',
  tianque_native: '聚合支付',
};

export default function CommissionOrdersPage() {
  const [data, setData] = useState<any>({ data: [], total: 0, summary: {} });
  const [loading, setLoading] = useState(false);
  const [params, setParams] = useUrlSyncedParams<Record<string, any>>({ page: 1, per_page: 50 });
  const [options, setOptions] = useState<{ projects: any[]; members: any[] }>({ projects: [], members: [] });
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await commissionOrderApi.list(params);
      setData(res.data);
    } catch (err: any) {
      message.error(err.response?.data?.error || '加载佣金订单失败');
    }
    setLoading(false);
  };

  const loadOptions = async () => {
    try {
      const res = await commissionOrderApi.options();
      setOptions({ projects: res.data.projects || [], members: res.data.members || [] });
    } catch { }
  };

  useEffect(() => { loadOptions(); }, []);
  useEffect(() => { load(); }, [params]);

  const openDetail = async (row: any) => {
    setDetail(row);
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      const res = await commissionOrderApi.get(row.id);
      setDetail(res.data);
    } catch { }
    setDetailLoading(false);
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 70 },
    { title: '订单号', dataIndex: 'order_no', width: 220, render: (v: string) => <Text code copyable style={{ fontSize: 12 }}>{v}</Text> },
    {
      title: 'OEM 项目', width: 180,
      render: (_: any, row: any) => row.oem_project
        ? <Space direction="vertical" size={0}><Text>{row.oem_project.name}</Text><Text type="secondary" style={{ fontSize: 12 }}>{row.oem_project_key}</Text></Space>
        : <Text type="secondary">{row.oem_project_key || '-'}</Text>,
    },
    {
      title: '买家', width: 150,
      render: (_: any, row: any) => row.user ? `${row.user.nickname || row.user.username} #${row.user_id}` : `#${row.user_id}`,
    },
    {
      title: '佣金用户', width: 150,
      render: (_: any, row: any) => row.commission_user ? `${row.commission_user.nickname || row.commission_user.username} #${row.commission_user_id}` : (row.commission_user_id ? `#${row.commission_user_id}` : '-'),
    },
    {
      title: '套餐', width: 180,
      render: (_: any, row: any) => row.plan ? <span><Text code>{row.plan.code}</Text> · {row.plan.name}</span> : `#${row.plan_id}`,
    },
    { title: '订单金额', dataIndex: 'amount', width: 110, align: 'right' as const, render: (v: any, row: any) => `${Number(v).toFixed(2)} ${row.currency}` },
    { title: '佣金比例', dataIndex: 'commission_rate_snapshot', width: 100, align: 'right' as const, render: (v: any) => `${(Number(v || 0) * 100).toFixed(2)}%` },
    { title: '佣金金额', dataIndex: 'commission_amount', width: 110, align: 'right' as const, render: (v: any) => <Text strong>{Number(v || 0).toFixed(2)}</Text> },
    {
      title: '佣金状态', dataIndex: 'commission_status', width: 100,
      render: (v: string) => {
        const t = COMMISSION_STATUS[v] || { color: 'default', label: v || '-' };
        return <Tag color={t.color}>{t.label}</Tag>;
      },
    },
    {
      title: '订单状态', dataIndex: 'status', width: 100,
      render: (v: string) => {
        const t = ORDER_STATUS[v] || { color: 'default', label: v || '-' };
        return <Tag color={t.color}>{t.label}</Tag>;
      },
    },
    {
      title: '类型', dataIndex: 'order_type', width: 90,
      render: (v: string) => {
        const t = ORDER_TYPE[v] || { color: 'default', label: v || '-' };
        return <Tag color={t.color}>{t.label}</Tag>;
      },
    },
    { title: '支付时间', dataIndex: 'paid_at', width: 150, render: (v: string | null) => v ? dayjs(v).format('YY-MM-DD HH:mm') : '-' },
    { title: '操作', width: 90, fixed: 'right' as const, render: (_: any, row: any) => <Button size="small" icon={<EyeOutlined />} onClick={() => openDetail(row)}>详情</Button> },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }} wrap>
        <Card size="small"><Statistic title="订单总额" value={Number(data.summary?.order_amount || 0)} precision={2} /></Card>
        <Card size="small"><Statistic title="已支付订单总额" value={Number(data.summary?.paid_order_amount || 0)} precision={2} /></Card>
        <Card size="small"><Statistic title="佣金总额" value={Number(data.summary?.commission_amount || 0)} precision={2} /></Card>
        <Card size="small"><Statistic title="已确认佣金" value={Number(data.summary?.confirmed_commission_amount || 0)} precision={2} /></Card>
      </Space>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <Space wrap>
          <Input.Search placeholder="订单号 / 用户 / 项目" allowClear style={{ width: 230 }} defaultValue={params.keyword || ''}
            onSearch={(keyword) => setParams({ ...params, keyword: keyword || undefined, page: 1 })} />
          <Select placeholder="OEM 项目" allowClear showSearch style={{ width: 180 }} value={params.oem_project_key}
            optionFilterProp="label"
            options={options.projects.map((p) => ({ value: p.project_key, label: `${p.name} (${p.project_key})` }))}
            onChange={(oem_project_key) => setParams({ ...params, oem_project_key, page: 1 })} />
          <Select placeholder="佣金用户" allowClear showSearch style={{ width: 170 }} value={params.commission_user_id}
            optionFilterProp="label"
            options={options.members.map((m) => ({ value: m.user_id, label: `${m.nickname || m.username} #${m.user_id}` }))}
            onChange={(commission_user_id) => setParams({ ...params, commission_user_id, page: 1 })} />
          <Select placeholder="佣金状态" allowClear style={{ width: 120 }} value={params.commission_status}
            options={Object.entries(COMMISSION_STATUS).map(([value, item]) => ({ value, label: item.label }))}
            onChange={(commission_status) => setParams({ ...params, commission_status, page: 1 })} />
          <Select placeholder="订单状态" allowClear style={{ width: 120 }} value={params.order_status}
            options={Object.entries(ORDER_STATUS).map(([value, item]) => ({ value, label: item.label }))}
            onChange={(order_status) => setParams({ ...params, order_status, page: 1 })} />
          <Select placeholder="订单类型" allowClear style={{ width: 120 }} value={params.order_type}
            options={Object.entries(ORDER_TYPE).map(([value, item]) => ({ value, label: item.label }))}
            onChange={(order_type) => setParams({ ...params, order_type, page: 1 })} />
          <Select placeholder="支付渠道" allowClear style={{ width: 120 }} value={params.pay_channel}
            options={Object.entries(PAY_CHANNEL).map(([value, label]) => ({ value, label }))}
            onChange={(pay_channel) => setParams({ ...params, pay_channel, page: 1 })} />
          <DatePicker.RangePicker
            placeholder={['创建开始', '创建结束']}
            value={params.created_start && params.created_end ? [dayjs(params.created_start), dayjs(params.created_end)] : undefined}
            onChange={(range: any) => {
              const r = range as [Dayjs | null, Dayjs | null] | null;
              setParams({
                ...params,
                created_start: r?.[0] ? r[0].format('YYYY-MM-DD') : undefined,
                created_end: r?.[1] ? r[1].format('YYYY-MM-DD') : undefined,
                page: 1,
              });
            }} />
          <InputNumber placeholder="佣金下限" min={0} style={{ width: 110 }} value={params.commission_min}
            onChange={(commission_min) => setParams({ ...params, commission_min: commission_min ?? undefined, page: 1 })} />
          <InputNumber placeholder="佣金上限" min={0} style={{ width: 110 }} value={params.commission_max}
            onChange={(commission_max) => setParams({ ...params, commission_max: commission_max ?? undefined, page: 1 })} />
        </Space>
        <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
      </div>

      <Table columns={columns as any} dataSource={data.data || []} rowKey="id" loading={loading}
        pagination={{
          current: Number(params.page || 1),
          pageSize: Number(params.per_page || 50),
          total: data.total || 0,
          showSizeChanger: true,
          onChange: (page, per_page) => setParams({ ...params, page, per_page }),
        }}
        size="small"
        scroll={{ x: 1800 }} />

      <Modal title="佣金订单详情" open={detailOpen} onCancel={() => setDetailOpen(false)} footer={null} width={820} mask={false}>
        <Table loading={detailLoading} dataSource={[]} pagination={false} showHeader={false} style={{ display: 'none' }} />
        {detail && (
          <Descriptions column={2} size="small" bordered>
            <Descriptions.Item label="订单号" span={2}><Text code copyable>{detail.order_no}</Text></Descriptions.Item>
            <Descriptions.Item label="OEM 项目" span={1}>{detail.oem_project?.name || detail.oem_project_key || '-'}</Descriptions.Item>
            <Descriptions.Item label="佣金用户" span={1}>{detail.commission_user ? `${detail.commission_user.nickname || detail.commission_user.username} #${detail.commission_user_id}` : '-'}</Descriptions.Item>
            <Descriptions.Item label="买家" span={1}>{detail.user ? `${detail.user.nickname || detail.user.username} #${detail.user_id}` : `#${detail.user_id}`}</Descriptions.Item>
            <Descriptions.Item label="套餐" span={1}>{detail.plan ? `${detail.plan.code} · ${detail.plan.name}` : `#${detail.plan_id}`}</Descriptions.Item>
            <Descriptions.Item label="订单金额" span={1}>{Number(detail.amount || 0).toFixed(2)} {detail.currency}</Descriptions.Item>
            <Descriptions.Item label="佣金金额" span={1}>{Number(detail.commission_amount || 0).toFixed(2)}</Descriptions.Item>
            <Descriptions.Item label="佣金比例" span={1}>{(Number(detail.commission_rate_snapshot || 0) * 100).toFixed(2)}%</Descriptions.Item>
            <Descriptions.Item label="佣金状态" span={1}>{(() => { const t = COMMISSION_STATUS[detail.commission_status] || { color: 'default', label: detail.commission_status || '-' }; return <Tag color={t.color}>{t.label}</Tag>; })()}</Descriptions.Item>
            <Descriptions.Item label="订单状态" span={1}>{(() => { const t = ORDER_STATUS[detail.status] || { color: 'default', label: detail.status || '-' }; return <Tag color={t.color}>{t.label}</Tag>; })()}</Descriptions.Item>
            <Descriptions.Item label="订单类型" span={1}>{(() => { const t = ORDER_TYPE[detail.order_type] || { color: 'default', label: detail.order_type || '-' }; return <Tag color={t.color}>{t.label}</Tag>; })()}</Descriptions.Item>
            <Descriptions.Item label="支付渠道" span={1}>{PAY_CHANNEL[detail.channel] || detail.channel}</Descriptions.Item>
            <Descriptions.Item label="支付时间" span={1}>{detail.paid_at ? dayjs(detail.paid_at).format('YYYY-MM-DD HH:mm:ss') : '-'}</Descriptions.Item>
            <Descriptions.Item label="创建时间" span={1}>{detail.created_at ? dayjs(detail.created_at).format('YYYY-MM-DD HH:mm:ss') : '-'}</Descriptions.Item>
            <Descriptions.Item label="佣金记录" span={2}>
              <pre style={{ margin: 0, fontSize: 11, maxHeight: 180, overflow: 'auto' }}>{JSON.stringify(detail.commission_record || detail.commissionRecord || null, null, 2)}</pre>
            </Descriptions.Item>
          </Descriptions>
        )}
      </Modal>
    </div>
  );
}
