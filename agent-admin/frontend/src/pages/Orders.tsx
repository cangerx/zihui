import { useEffect, useState } from 'react';
import {
  Table, Button, Space, Tag, Modal, Input, Select, DatePicker, message, Tooltip, Descriptions, Typography, Spin, Popconfirm,
} from 'antd';
import { SyncOutlined, CopyOutlined, EyeOutlined, ReloadOutlined, DeleteOutlined } from '@ant-design/icons';
import { orderApi } from '../services/api';
import { useUrlSyncedParams } from '../hooks/useUrlSyncedParams';
import dayjs, { Dayjs } from 'dayjs';

interface PaymentOrder {
  id: number;
  order_no: string;
  user_id: number;
  plan_id: number;
  amount: number | string;
  currency: string;
  channel: string;
  order_type?: string;
  status: string;
  derived_status?: string; // pending 且已过期时后端返回 'expired'
  oem_project_key?: string | null;
  oem_project_name?: string | null;
  oem_project?: { project_key: string; name: string; app_name?: string; status?: string } | null;
  commission_user_id?: number | null;
  commission_user?: { id: number; username: string; nickname?: string } | null;
  commission_rate_snapshot?: number | string;
  commission_amount?: number | string;
  commission_status?: string;
  wx_prepay_id: string | null;
  wx_transaction_id: string | null;
  code_url: string | null;
  notify_payload: string | null;
  user_plan_id: number | null;
  upgrade_from_user_plan_id?: number | null;
  paid_at: string | null;
  closed_at: string | null;
  expires_at: string;
  created_at: string;
  remark: string;
  client_ip: string;
  plan_snapshot?: any;
  user?: { id: number; username: string; nickname?: string };
  plan?: { id: number; code: string; name: string };
}

const STATUS_LABEL: Record<string, { color: string; label: string }> = {
  pending:  { color: 'gold',    label: '待支付' },
  paid:     { color: 'green',   label: '已支付' },
  closed:   { color: 'default', label: '已关闭' },
  expired:  { color: 'default', label: '已超时' },
  failed:   { color: 'red',     label: '失败' },
  refunded: { color: 'purple',  label: '已退款' },
};

const CHANNEL_LABEL: Record<string, string> = {
  wechat_native: '微信扫码',
  tianque_native: '聚合支付',
};

const ORDER_TYPE_LABEL: Record<string, { color: string; label: string }> = {
  purchase: { color: 'blue', label: '购买' },
  renew: { color: 'cyan', label: '续费' },
  upgrade: { color: 'orange', label: '升级' },
};

const COMMISSION_STATUS_LABEL: Record<string, { color: string; label: string }> = {
  none: { color: 'default', label: '无佣金' },
  pending: { color: 'gold', label: '待确认' },
  confirmed: { color: 'green', label: '已确认' },
  settled: { color: 'blue', label: '已结算' },
  cancelled: { color: 'red', label: '已取消' },
};

export default function OrdersPage() {
  const [data, setData] = useState<any>({ data: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [params, setParams] = useUrlSyncedParams<Record<string, any>>({ page: 1, per_page: 50 });

  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<PaymentOrder | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await orderApi.list(params);
      setData(res.data);
    } catch { message.error('加载失败'); }
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [params]);

  const openDetail = async (row: PaymentOrder) => {
    setDetailOpen(true);
    setDetail(row);
    setDetailLoading(true);
    try {
      const res = await orderApi.get(row.id);
      setDetail(res.data);
    } catch { /* 保留列表数据 */ }
    setDetailLoading(false);
  };

  const handleSync = async (row: PaymentOrder) => {
    setSyncing(true);
    try {
      const res = await orderApi.sync(row.id);
      message.success(`微信状态：${res.data.wx_trade_state || '-'} / 本地：${res.data.local_status}`);
      if (detail && detail.id === row.id && res.data.order) {
        setDetail(res.data.order);
      }
      load();
    } catch (err: any) {
      message.error(err.response?.data?.error || '同步失败');
    }
    setSyncing(false);
  };

  // 判断订单是否为「无效订单」：closed / failed / expired 三种终态才允许删除。
  // derived_status 优先级高于 status（pending 且已过期会被后端返回为 'expired'）。
  const isInvalidOrder = (row: PaymentOrder) => {
    const s = row.derived_status || row.status;
    return s === 'closed' || s === 'failed' || s === 'expired';
  };

  const handleDelete = async (row: PaymentOrder) => {
    try {
      await orderApi.delete(row.id);
      message.success('已删除');
      if (detail && detail.id === row.id) setDetailOpen(false);
      load();
    } catch (err: any) {
      message.error(err.response?.data?.error || '删除失败');
    }
  };

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); message.success('已复制'); }
    catch { message.error('复制失败'); }
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    {
      title: '订单号', dataIndex: 'order_no', width: 220,
      render: (v: string) => (
        <span style={{ fontFamily: 'monospace', fontSize: 12 }}>
          {v}
          <Tooltip title="复制">
            <Button size="small" type="text" icon={<CopyOutlined />} onClick={() => copy(v)} />
          </Tooltip>
        </span>
      ),
    },
    {
      title: '用户', width: 160,
      render: (_: any, r: PaymentOrder) => r.user
        ? <span>{r.user.nickname || r.user.username} <span style={{ color: '#999' }}>#{r.user_id}</span></span>
        : `#${r.user_id}`,
    },
    {
      title: '套餐', width: 200,
      render: (_: any, r: PaymentOrder) => r.plan
        ? <span><code>{r.plan.code}</code> · {r.plan.name}</span>
        : `#${r.plan_id}`,
    },
    {
      title: '金额', dataIndex: 'amount', width: 110,
      render: (v: any, r: PaymentOrder) => `${Number(v).toFixed(2)} ${r.currency}`,
    },
    {
      title: '类型', dataIndex: 'order_type', width: 90,
      render: (v: string) => {
        const t = ORDER_TYPE_LABEL[v || 'purchase'] || { color: 'default', label: v || '购买' };
        return <Tag color={t.color}>{t.label}</Tag>;
      },
    },
    {
      title: '渠道', dataIndex: 'channel', width: 100,
      render: (v: string) => <Tag>{CHANNEL_LABEL[v] || v}</Tag>,
    },
    {
      title: 'OEM 项目', width: 150,
      render: (_: any, r: PaymentOrder) => r.oem_project_key
        ? <Space direction="vertical" size={0}><Tag color="purple">{r.oem_project_name || r.oem_project_key}</Tag></Space>
        : <span style={{ color: '#bbb' }}>-</span>,
    },
    {
      title: '佣金', width: 150,
      render: (_: any, r: PaymentOrder) => {
        const status = r.commission_status || 'none';
        const t = COMMISSION_STATUS_LABEL[status] || { color: 'default', label: status };
        return (
          <Space size={4} wrap>
            <Tag color={t.color}>{t.label}</Tag>
            {Number(r.commission_amount || 0) > 0 && <span>{Number(r.commission_amount).toFixed(2)}</span>}
          </Space>
        );
      },
    },
    {
      title: '状态', dataIndex: 'status', width: 90,
      render: (_: any, r: PaymentOrder) => {
        const key = r.derived_status || r.status;
        const t = STATUS_LABEL[key] || { color: 'default', label: key };
        return <Tag color={t.color}>{t.label}</Tag>;
      },
    },
    {
      title: '微信单号', dataIndex: 'wx_transaction_id', width: 220,
      render: (v: string | null) => v
        ? <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{v}</span>
        : <span style={{ color: '#bbb' }}>-</span>,
    },
    {
      title: '创建', dataIndex: 'created_at', width: 140,
      render: (v: string) => v ? dayjs(v).format('YY-MM-DD HH:mm') : '-',
    },
    {
      title: '操作', width: 220, fixed: 'right' as const,
      render: (_: any, r: PaymentOrder) => (
        <Space size={4}>
          <Button size="small" icon={<EyeOutlined />} onClick={() => openDetail(r)}>详情</Button>
          <Button size="small" icon={<SyncOutlined />} loading={syncing} onClick={() => handleSync(r)}>同步</Button>
          {isInvalidOrder(r) && (
            <Popconfirm
              title="删除该订单？"
              description="仅删除订单记录，不影响用户套餐 / 余额"
              onConfirm={() => handleDelete(r)}
              okText="删除"
              okButtonProps={{ danger: true }}
            >
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <Space wrap>
          <Input.Search placeholder="订单号" allowClear style={{ width: 220 }}
            defaultValue={params.order_no || ''}
            onSearch={(v) => setParams({ ...params, order_no: v || undefined, page: 1 })} />
          <Input placeholder="用户 ID" allowClear style={{ width: 120 }}
            defaultValue={params.user_id ?? ''}
            onPressEnter={(e) => setParams({ ...params, user_id: (e.target as HTMLInputElement).value || undefined, page: 1 })} />
          <Input placeholder="套餐 ID" allowClear style={{ width: 120 }}
            defaultValue={params.plan_id ?? ''}
            onPressEnter={(e) => setParams({ ...params, plan_id: (e.target as HTMLInputElement).value || undefined, page: 1 })} />
          <Select placeholder="状态" allowClear style={{ width: 120 }}
            value={params.status}
            options={Object.entries(STATUS_LABEL).map(([v, t]) => ({ value: v, label: t.label }))}
            onChange={(v) => setParams({ ...params, status: v, page: 1 })} />
          <Select placeholder="订单类型" allowClear style={{ width: 130 }}
            value={params.order_type}
            options={Object.entries(ORDER_TYPE_LABEL).map(([v, t]) => ({ value: v, label: t.label }))}
            onChange={(v) => setParams({ ...params, order_type: v, page: 1 })} />
          <Input placeholder="OEM 项目 Key" allowClear style={{ width: 160 }}
            defaultValue={params.oem_project_key ?? ''}
            onPressEnter={(e) => setParams({ ...params, oem_project_key: (e.target as HTMLInputElement).value || undefined, page: 1 })} />
          <Select placeholder="佣金状态" allowClear style={{ width: 120 }}
            value={params.commission_status}
            options={Object.entries(COMMISSION_STATUS_LABEL).map(([v, t]) => ({ value: v, label: t.label }))}
            onChange={(v) => setParams({ ...params, commission_status: v, page: 1 })} />
          <DatePicker.RangePicker
            placeholder={['开始日期', '结束日期']}
            value={params.start_date && params.end_date
              ? [dayjs(params.start_date), dayjs(params.end_date)]
              : undefined}
            onChange={(range: any) => {
              const r = range as [Dayjs | null, Dayjs | null] | null;
              setParams({
                ...params,
                start_date: r?.[0] ? r[0].format('YYYY-MM-DD') : undefined,
                end_date: r?.[1] ? r[1].format('YYYY-MM-DD') : undefined,
                page: 1,
              });
            }} />
        </Space>
        <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
      </div>

      <Table columns={columns as any} dataSource={data.data} rowKey="id" loading={loading}
        pagination={{
          current: params.page, pageSize: params.per_page, total: data.total,
          onChange: (p, ps) => setParams({ ...params, page: p, per_page: ps }),
          showSizeChanger: true,
        }}
        size="small" scroll={{ x: 1800 }} />

      <Modal title="订单详情" open={detailOpen} mask={false}
        onCancel={() => setDetailOpen(false)} width={760}
        footer={[
          <Button key="sync" icon={<SyncOutlined />} loading={syncing}
            onClick={() => detail && handleSync(detail)} disabled={!detail}>同步状态</Button>,
          <Button key="close" type="primary" onClick={() => setDetailOpen(false)}>关闭</Button>,
        ]}>
        {detail && (
          <Spin spinning={detailLoading}>
          <Descriptions column={2} size="small" bordered>
            <Descriptions.Item label="ID" span={1}>{detail.id}</Descriptions.Item>
            <Descriptions.Item label="状态" span={1}>
              {(() => {
                const key = detail.derived_status || detail.status;
                const t = STATUS_LABEL[key] || { color: 'default', label: key };
                return <Tag color={t.color}>{t.label}</Tag>;
              })()}
            </Descriptions.Item>
            <Descriptions.Item label="订单号" span={2}>
              <Typography.Text copyable code>{detail.order_no}</Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label="用户" span={1}>
              {detail.user ? `${detail.user.nickname || detail.user.username} #${detail.user_id}` : `#${detail.user_id}`}
            </Descriptions.Item>
            <Descriptions.Item label="套餐" span={1}>
              {detail.plan ? `${detail.plan.code} · ${detail.plan.name}` : `#${detail.plan_id}`}
            </Descriptions.Item>
            <Descriptions.Item label="金额" span={1}>{Number(detail.amount).toFixed(2)} {detail.currency}</Descriptions.Item>
            <Descriptions.Item label="类型" span={1}>
              {(() => {
                const t = ORDER_TYPE_LABEL[detail.order_type || 'purchase'] || { color: 'default', label: detail.order_type || '购买' };
                return <Tag color={t.color}>{t.label}</Tag>;
              })()}
            </Descriptions.Item>
            <Descriptions.Item label="渠道" span={1}>{CHANNEL_LABEL[detail.channel] || detail.channel}</Descriptions.Item>
            <Descriptions.Item label="原套餐记录" span={1}>{detail.upgrade_from_user_plan_id ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="OEM 项目" span={1}>
              {detail.oem_project?.name || detail.oem_project_name || detail.oem_project_key || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="佣金用户" span={1}>
              {detail.commission_user ? `${detail.commission_user.nickname || detail.commission_user.username} #${detail.commission_user_id}` : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="佣金比例" span={1}>{(Number(detail.commission_rate_snapshot || 0) * 100).toFixed(2)}%</Descriptions.Item>
            <Descriptions.Item label="佣金金额" span={1}>{Number(detail.commission_amount || 0).toFixed(2)}</Descriptions.Item>
            <Descriptions.Item label="佣金状态" span={1}>
              {(() => {
                const key = detail.commission_status || 'none';
                const t = COMMISSION_STATUS_LABEL[key] || { color: 'default', label: key };
                return <Tag color={t.color}>{t.label}</Tag>;
              })()}
            </Descriptions.Item>
            <Descriptions.Item label="佣金记录" span={1}>{(detail as any).commission_record?.id || '-'}</Descriptions.Item>
            <Descriptions.Item label="微信单号" span={2}>
              {detail.wx_transaction_id
                ? <Typography.Text copyable code>{detail.wx_transaction_id}</Typography.Text>
                : <span style={{ color: '#bbb' }}>-</span>}
            </Descriptions.Item>
            <Descriptions.Item label="UserPlan ID" span={1}>{detail.user_plan_id ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="客户端 IP" span={1}>{detail.client_ip || '-'}</Descriptions.Item>
            <Descriptions.Item label="创建" span={1}>{detail.created_at ? dayjs(detail.created_at).format('YYYY-MM-DD HH:mm:ss') : '-'}</Descriptions.Item>
            <Descriptions.Item label="过期" span={1}>{detail.expires_at ? dayjs(detail.expires_at).format('YYYY-MM-DD HH:mm:ss') : '-'}</Descriptions.Item>
            <Descriptions.Item label="支付时间" span={1}>{detail.paid_at ? dayjs(detail.paid_at).format('YYYY-MM-DD HH:mm:ss') : '-'}</Descriptions.Item>
            <Descriptions.Item label="关闭时间" span={1}>{detail.closed_at ? dayjs(detail.closed_at).format('YYYY-MM-DD HH:mm:ss') : '-'}</Descriptions.Item>
            <Descriptions.Item label="二维码 URL" span={2}>
              {detail.code_url ? <code style={{ fontSize: 11 }}>{detail.code_url}</code> : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="套餐快照" span={2}>
              <pre style={{ margin: 0, fontSize: 11, maxHeight: 160, overflow: 'auto' }}>
                {JSON.stringify(detail.plan_snapshot, null, 2)}
              </pre>
            </Descriptions.Item>
            <Descriptions.Item label="备注" span={2}>{detail.remark || '-'}</Descriptions.Item>
            {detail.notify_payload && (
              <Descriptions.Item label="回调原文（首部）" span={2}>
                <pre style={{ margin: 0, fontSize: 11, maxHeight: 160, overflow: 'auto' }}>
                  {detail.notify_payload}
                </pre>
              </Descriptions.Item>
            )}
          </Descriptions>
          </Spin>
        )}
      </Modal>
    </div>
  );
}
