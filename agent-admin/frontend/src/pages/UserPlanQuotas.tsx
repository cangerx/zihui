import { useEffect, useState } from 'react';
import { Alert, Card, Col, DatePicker, Progress, Row, Select, Space, Statistic, Table, Tag, Typography } from 'antd';
import { planApi, userApi } from '../services/api';
import { useCurrencyLabels } from '../contexts/CurrencyContext';
import { useUrlSyncedParams } from '../hooks/useUrlSyncedParams';
import CurrencyTag from '../components/CurrencyTag';
import dayjs from 'dayjs';

interface UserPlanQuota {
  id: number;
  user_id: number;
  user_plan_id: number;
  plan_id: number;
  balance_type: 'token' | 'credit';
  granted: number | string;
  consumed: number | string;
  expires_at: string | null;
  status: string;
  created_at?: string;
  user?: { id: number; username: string; nickname?: string };
  plan?: { id: number; code: string; name: string };
  user_plan?: { id: number; status: string; source: string; expires_at: string | null };
}

const STATUS_LABEL: Record<string, { color: string; label: string }> = {
  active: { color: 'green', label: '可用' },
  expired: { color: 'default', label: '已过期' },
  revoked: { color: 'red', label: '已撤销' },
};

// 展示用「有效状态」：存储 status 靠每小时定时任务（expirePlanQuotas）才翻转，
// 到期后短时间内仍是 'active'。按 expires_at 实时派生，避免「可用」绿标与过期时间矛盾。
function effectiveQuotaStatus(status: string, expiresAt: string | null): string {
  if (status === 'active' && expiresAt && dayjs(expiresAt).valueOf() <= Date.now()) {
    return 'expired';
  }
  return status;
}

function num(value: number | string | undefined): number {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function fmt(value: number | string | undefined): string {
  const n = num(value);
  return Number.isInteger(n) ? String(n) : n.toFixed(4);
}

function remaining(row: UserPlanQuota): number {
  return Math.max(0, num(row.granted) - num(row.consumed));
}

function usagePercent(row: UserPlanQuota): number {
  const granted = num(row.granted);
  if (granted <= 0) return 0;
  return Math.min(100, Math.round((num(row.consumed) / granted) * 100));
}

export default function UserPlanQuotasPage() {
  const { labels } = useCurrencyLabels();
  const [data, setData] = useState<any>({ data: [], total: 0, summary: {} });
  const [loading, setLoading] = useState(false);
  const [params, setParams] = useUrlSyncedParams<Record<string, any>>({ page: 1, per_page: 50 });
  const [users, setUsers] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await planApi.userPlanQuotas(params);
      setData(res.data);
    } catch {
      setData({ data: [], total: 0, summary: {}, available_summary: {} });
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [params]);
  useEffect(() => {
    Promise.all([
      userApi.list({ per_page: 500 }),
      planApi.list({ per_page: 500 }),
    ]).then(([u, p]) => {
      setUsers((u.data.data || u.data) as any[]);
      setPlans((p.data.data || p.data) as any[]);
    }).catch(() => {});
  }, []);

  const summary = data.available_summary || data.summary || {};
  const tokenSummary = summary.token || {};
  const creditSummary = summary.credit || {};

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 70 },
    {
      title: '用户', width: 180,
      render: (_: any, r: UserPlanQuota) => r.user
        ? <span>{r.user.nickname || r.user.username} <span style={{ color: '#999' }}>#{r.user_id}</span></span>
        : `#${r.user_id}`,
    },
    {
      title: '套餐', width: 220,
      render: (_: any, r: UserPlanQuota) => r.plan
        ? <span><code>{r.plan.code}</code> · {r.plan.name}</span>
        : `#${r.plan_id}`,
    },
    { title: '用户套餐', dataIndex: 'user_plan_id', width: 100, render: (v: number) => <Typography.Text code>#{v}</Typography.Text> },
    { title: '类型', dataIndex: 'balance_type', width: 100, render: (v: string) => <CurrencyTag type={v} /> },
    {
      title: '额度使用', width: 240,
      render: (_: any, r: UserPlanQuota) => {
        const percent = usagePercent(r);
        return (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
              <span>已用 {fmt(r.consumed)}</span>
              <span style={{ color: '#666' }}>剩余 {fmt(remaining(r))}</span>
            </div>
            <Progress percent={percent} size="small" status={percent >= 90 ? 'exception' : 'active'} />
          </div>
        );
      },
    },
    { title: '授予', dataIndex: 'granted', width: 110, align: 'right' as const, render: (v: string) => fmt(v) },
    { title: '剩余', width: 110, align: 'right' as const, render: (_: any, r: UserPlanQuota) => <strong>{fmt(remaining(r))}</strong> },
    {
      title: '状态', dataIndex: 'status', width: 90,
      render: (v: string, r: UserPlanQuota) => {
        const eff = effectiveQuotaStatus(v, r.expires_at);
        const t = STATUS_LABEL[eff] || { color: 'default', label: eff };
        return <Tag color={t.color}>{t.label}</Tag>;
      },
    },
    {
      title: '到期时间', dataIndex: 'expires_at', width: 150,
      render: (v: string | null) => v ? dayjs(v).format('YY-MM-DD HH:mm') : '随套餐永久',
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 16 }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>套餐额度明细</Typography.Title>
          <Typography.Text type="secondary">查看每个套餐额度桶的授予、消耗、剩余和到期状态。</Typography.Text>
        </div>
      </div>

      <Row gutter={12} style={{ marginBottom: 16 }}>
        <Col xs={24} md={12}>
          <Card size="small">
            <Statistic title={`${labels.token}当前可用套餐剩余`} value={fmt(tokenSummary.remaining)} />
            <Typography.Text type="secondary">已用 {fmt(tokenSummary.consumed)} / 授予 {fmt(tokenSummary.granted)}</Typography.Text>
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card size="small">
            <Statistic title={`${labels.credit}当前可用套餐剩余`} value={fmt(creditSummary.remaining)} />
            <Typography.Text type="secondary">已用 {fmt(creditSummary.consumed)} / 授予 {fmt(creditSummary.granted)}</Typography.Text>
          </Card>
        </Col>
      </Row>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="这里展示的是套餐额度，不包含钱包余额。用户实际可用额度 = 钱包余额 + 有效套餐剩余额度。"
      />

      <Space wrap style={{ marginBottom: 16 }}>
        <Select placeholder="用户" allowClear showSearch optionFilterProp="label" style={{ width: 200 }}
          value={params.user_id}
          options={users.map(u => ({ value: u.id, label: `${u.nickname || u.username} (#${u.id})` }))}
          onChange={(v) => setParams({ ...params, user_id: v, page: 1 })} />
        <Select placeholder="套餐" allowClear showSearch optionFilterProp="label" style={{ width: 220 }}
          value={params.plan_id}
          options={plans.map(p => ({ value: p.id, label: `${p.code} · ${p.name}` }))}
          onChange={(v) => setParams({ ...params, plan_id: v, page: 1 })} />
        <Select placeholder="类型" allowClear style={{ width: 130 }}
          value={params.balance_type}
          options={[{ value: 'token', label: labels.token }, { value: 'credit', label: labels.credit }]}
          onChange={(v) => setParams({ ...params, balance_type: v, page: 1 })} />
        <Select placeholder="状态" allowClear style={{ width: 130 }}
          value={params.status}
          options={Object.entries(STATUS_LABEL).map(([value, item]) => ({ value, label: item.label }))}
          onChange={(v) => setParams({ ...params, status: v, page: 1 })} />
        <DatePicker placeholder="到期不晚于" value={params.expires_before ? dayjs(params.expires_before) : undefined}
          onChange={(d) => setParams({ ...params, expires_before: d ? d.format('YYYY-MM-DD') : undefined, page: 1 })} />
      </Space>

      <Table columns={columns as any} dataSource={data.data} rowKey="id" loading={loading}
        pagination={{ current: params.page, pageSize: params.per_page, total: data.total,
          showSizeChanger: true,
          onChange: (p, ps) => setParams({ ...params, page: p, per_page: ps }) }}
        size="small" scroll={{ x: 1280 }} />
    </div>
  );
}
