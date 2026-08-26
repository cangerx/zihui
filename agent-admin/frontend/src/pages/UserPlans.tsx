import { useEffect, useState } from 'react';
import {
  Table, Button, Space, Tag, Modal, Form, Select, Input, message, Popconfirm, Alert, Progress, Typography,
} from 'antd';
import { PlusOutlined, AppstoreAddOutlined } from '@ant-design/icons';
import { planApi, userApi, groupApi } from '../services/api';
import { useCurrencyLabels } from '../contexts/CurrencyContext';
import { useUrlSyncedParams } from '../hooks/useUrlSyncedParams';
import dayjs from 'dayjs';

interface UserPlan {
  id: number;
  user_id: number;
  plan_id: number;
  source: string;
  activated_at: string | null;
  expires_at: string | null;
  status: string;
  token_granted: number | string;
  credit_granted: number | string;
  quota_summary?: Record<string, { granted: number; consumed: number; remaining: number }>;
  quota_bucket_count?: number;
  quota_refill_cycle?: string;
  next_quota_refill_at?: string | null;
  upgraded_from_user_plan_id?: number | null;
  remark: string;
  created_at: string;
  user?: { id: number; username: string; nickname?: string };
  plan?: { id: number; code: string; name: string };
}

const STATUS_LABEL: Record<string, { color: string; label: string }> = {
  active:  { color: 'green',  label: '生效中' },
  expired: { color: 'default', label: '已过期' },
  revoked: { color: 'red',    label: '已撤销' },
};

// 展示用「有效状态」：存储的 status 靠每小时一次的定时任务（plan:expire）才翻转，
// 到期后最长约 1 小时内仍是 'active'。按 expires_at 实时派生，避免状态列显示
// 「生效中」绿标与同行「过期时间已过」自相矛盾。
function effectivePlanStatus(status: string, expiresAt: string | null): string {
  if (status === 'active' && expiresAt && dayjs(expiresAt).valueOf() <= Date.now()) {
    return 'expired';
  }
  return status;
}

const SOURCE_LABEL: Record<string, string> = {
  purchase: '购买',
  redeem:   '兑换码',
  admin:    '后台发放',
  register: '注册赠送',
  upgrade:  '升级',
  renew:    '续费',
};

const SOURCE_COLOR: Record<string, string> = {
  purchase: 'blue',
  redeem: 'purple',
  admin: 'default',
  register: 'green',
  upgrade: 'orange',
  renew: 'cyan',
};

function num(value: number | string | undefined): number {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function fmt(value: number | string | undefined): string {
  const n = num(value);
  return Number.isInteger(n) ? String(n) : n.toFixed(4);
}

export default function UserPlansPage() {
  const { labels } = useCurrencyLabels();
  const [data, setData] = useState<any>({ data: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [params, setParams] = useUrlSyncedParams<Record<string, any>>({ page: 1, per_page: 50 });
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  const [grantOpen, setGrantOpen] = useState(false);
  const [batchGrantOpen, setBatchGrantOpen] = useState(false);
  const [users, setUsers] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [batchRevoking, setBatchRevoking] = useState(false);
  const [grantForm] = Form.useForm();
  const [batchForm] = Form.useForm();
  const batchUserIds: number[] = Form.useWatch('user_ids', batchForm) || [];
  const batchGroupIds: number[] = Form.useWatch('group_ids', batchForm) || [];

  const load = async () => {
    setLoading(true);
    try {
      const res = await planApi.userPlans(params);
      setData(res.data);
    } catch { message.error('加载失败'); }
    setLoading(false);
  };

  useEffect(() => { load(); }, [params]);

  const loadOptions = async () => {
    try {
      const [u, p, g] = await Promise.all([
        userApi.list({ per_page: 500 }),
        planApi.list({ status: 'active', per_page: 200 }),
        groupApi.list({ per_page: 500 }),
      ]);
      setUsers((u.data.data || u.data) as any[]);
      setPlans((p.data.data || p.data) as any[]);
      setGroups((g.data.data || g.data) as any[]);
    } catch { /* ignore */ }
  };

  const openGrant = async () => {
    setGrantOpen(true);
    await loadOptions();
  };

  const openBatchGrant = async () => {
    setBatchGrantOpen(true);
    await loadOptions();
  };

  const handleGrant = async () => {
    const values = await grantForm.validateFields();
    try {
      await planApi.grant(values.user_id, { plan_id: values.plan_id, remark: values.remark || '' });
      message.success('已发放');
      setGrantOpen(false);
      grantForm.resetFields();
      load();
    } catch (err: any) {
      message.error(err.response?.data?.error || '发放失败');
    }
  };

  const handleBatchGrant = async () => {
    const values = await batchForm.validateFields();
    const uIds: number[] = values.user_ids || [];
    const gIds: number[] = values.group_ids || [];
    if (!uIds.length && !gIds.length) {
      message.warning('请选择至少一个用户或分组');
      return;
    }
    setSubmitting(true);
    try {
      const res = await planApi.batchGrant({
        plan_id: values.plan_id,
        user_ids: uIds,
        group_ids: gIds,
        remark: values.remark || '',
      });
      const r = res.data;
      if (r.failed?.length) {
        message.warning(`成功 ${r.success}/${r.total}，失败 ${r.failed.length} 条`);
      } else {
        message.success(`已发放 ${r.success} 条`);
      }
      setBatchGrantOpen(false);
      batchForm.resetFields();
      load();
    } catch (err: any) {
      message.error(err.response?.data?.error || '发放失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (row: UserPlan) => {
    try {
      await planApi.revoke(row.id);
      message.success('已撤销');
      load();
    } catch (err: any) {
      message.error(err.response?.data?.error || '撤销失败');
    }
  };

  const handleBatchRevoke = async () => {
    if (!selectedRowKeys.length) return;
    setBatchRevoking(true);
    try {
      const res = await planApi.batchRevoke(selectedRowKeys.map(k => Number(k)));
      const r = res.data;
      if (r.failed?.length) {
        message.warning(`撤销 ${r.success} 条，跳过 ${r.skipped} 条，失败 ${r.failed.length} 条`);
      } else {
        message.success(`已撤销 ${r.success} 条，跳过 ${r.skipped} 条`);
      }
      setSelectedRowKeys([]);
      load();
    } catch (err: any) {
      message.error(err.response?.data?.error || '批量撤销失败');
    } finally {
      setBatchRevoking(false);
    }
  };

  const renderQuota = (r: UserPlan, type: 'token' | 'credit', fallbackGranted: number | string) => {
    const item = r.quota_summary?.[type];
    const granted = item ? num(item.granted) : num(fallbackGranted);
    const consumed = item ? num(item.consumed) : 0;
    const remain = item ? num(item.remaining) : granted;
    const percent = granted > 0 ? Math.min(100, Math.round((consumed / granted) * 100)) : 0;
    return (
      <div style={{ minWidth: 180 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
          <Typography.Text strong>{fmt(remain)}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>剩余</Typography.Text>
        </div>
        <Progress percent={percent} size="small" status={percent >= 90 ? 'exception' : 'normal'} />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          已用 {fmt(consumed)} / 授予 {fmt(granted)}
        </Typography.Text>
      </div>
    );
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    {
      title: '用户', width: 180,
      render: (_: any, r: UserPlan) => r.user
        ? <span>{r.user.nickname || r.user.username} <span style={{ color: '#999' }}>#{r.user_id}</span></span>
        : `#${r.user_id}`,
    },
    {
      title: '套餐', width: 200,
      render: (_: any, r: UserPlan) => r.plan
        ? <span><code>{r.plan.code}</code> · {r.plan.name}</span>
        : `#${r.plan_id}`,
    },
    {
      title: '来源', dataIndex: 'source', width: 100,
      render: (v: string) => <Tag color={SOURCE_COLOR[v] || 'default'}>{SOURCE_LABEL[v] || v}</Tag>,
    },
    {
      title: '生效', dataIndex: 'activated_at', width: 130,
      render: (v: string) => v ? dayjs(v).format('YY-MM-DD HH:mm') : '-',
    },
    {
      title: '过期', dataIndex: 'expires_at', width: 130,
      render: (v: string) => v ? dayjs(v).format('YY-MM-DD HH:mm') : '永久',
    },
    {
      title: `${labels.token}余量`, width: 230,
      render: (_: any, r: UserPlan) => renderQuota(r, 'token', r.token_granted),
    },
    {
      title: `${labels.credit}余量`, width: 230,
      render: (_: any, r: UserPlan) => renderQuota(r, 'credit', r.credit_granted),
    },
    {
      title: '状态', dataIndex: 'status', width: 90,
      render: (v: string, r: UserPlan) => {
        const eff = effectivePlanStatus(v, r.expires_at);
        const t = STATUS_LABEL[eff] || { color: 'default', label: eff };
        return <Tag color={t.color}>{t.label}</Tag>;
      },
    },
    {
      title: '操作', width: 100,
      render: (_: any, r: UserPlan) => (
        r.status === 'active' ? (
          <Popconfirm title="确认撤销？将清理套餐发放的模型/权限" onConfirm={() => handleRevoke(r)}>
            <Button size="small" danger>撤销</Button>
          </Popconfirm>
        ) : null
      ),
    },
  ];

  const activeSelectableCount = (data.data as UserPlan[]).filter(r => r.status === 'active').length;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 16 }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>用户套餐</Typography.Title>
          <Typography.Text type="secondary">查看用户持有套餐、状态和真实套餐余量。</Typography.Text>
        </div>
        <Space>
          <Popconfirm
            title={`确认批量撤销选中的 ${selectedRowKeys.length} 条？`}
            disabled={!selectedRowKeys.length}
            onConfirm={handleBatchRevoke}
          >
            <Button danger disabled={!selectedRowKeys.length} loading={batchRevoking}>
              批量撤销 ({selectedRowKeys.length})
            </Button>
          </Popconfirm>
          <Button icon={<PlusOutlined />} onClick={openGrant}>单条发放</Button>
          <Button type="primary" icon={<AppstoreAddOutlined />} onClick={openBatchGrant}>批量发放</Button>
        </Space>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="列表中的余量只统计套餐额度，不包含钱包余额。用户实际可用额度可在费用管理中结合钱包余额判断。"
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space>
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
        </Space>
      </div>

      <Table columns={columns as any} dataSource={data.data} rowKey="id" loading={loading}
        rowSelection={{
          selectedRowKeys,
          onChange: setSelectedRowKeys,
          getCheckboxProps: (r: UserPlan) => ({ disabled: r.status !== 'active' }),
        }}
        pagination={{ current: params.page, pageSize: params.per_page, total: data.total,
          onChange: (p, ps) => setParams({ ...params, page: p, per_page: ps }) }}
        size="small" scroll={{ x: 1320 }} />
      <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
        当前页可撤销（active）{activeSelectableCount} 条
      </div>

      {/* 单条发放 */}
      <Modal title="发放套餐" open={grantOpen} mask={false}
        onOk={handleGrant} onCancel={() => setGrantOpen(false)} destroyOnClose width={500}>
        <Form form={grantForm} layout="vertical">
          <Form.Item name="user_id" label="用户" rules={[{ required: true }]}>
            <Select placeholder="选择用户" showSearch
              filterOption={(input, option) =>
                (option?.label as string)?.toLowerCase().includes(input.toLowerCase())}
              options={users.map(u => ({
                value: u.id,
                label: `${u.nickname || u.username} (#${u.id})`,
              }))} />
          </Form.Item>
          <Form.Item name="plan_id" label="套餐" rules={[{ required: true }]}>
            <Select placeholder="选择套餐"
              options={plans.map(p => ({
                value: p.id,
                label: `${p.code} · ${p.name} (${p.duration_days === 0 ? '永久' : p.duration_days + '天'})`,
              }))} />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 批量发放 */}
      <Modal title="批量发放套餐" open={batchGrantOpen} mask={false} width={600}
        confirmLoading={submitting}
        onOk={handleBatchGrant} onCancel={() => setBatchGrantOpen(false)} destroyOnClose>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={`为 ${batchUserIds.length} 个用户 + ${batchGroupIds.length} 个分组发放同一套餐。分组会展开为其全部成员，已重复的按 PlanService 规则处理。`}
        />
        <Form form={batchForm} layout="vertical">
          <Form.Item name="plan_id" label="套餐" rules={[{ required: true }]}>
            <Select placeholder="选择套餐" showSearch optionFilterProp="label"
              options={plans.map(p => ({
                value: p.id,
                label: `${p.code} · ${p.name} (${p.duration_days === 0 ? '永久' : p.duration_days + '天'})`,
              }))} />
          </Form.Item>
          <Form.Item name="user_ids" label="用户（可多选）">
            <Select mode="multiple" showSearch optionFilterProp="label" placeholder="选择用户"
              maxTagCount="responsive" allowClear
              options={users.map(u => ({
                value: u.id,
                label: `${u.nickname || u.username} (#${u.id})`,
              }))} />
          </Form.Item>
          <Form.Item name="group_ids" label="分组（可多选，展开为成员）">
            <Select mode="multiple" showSearch optionFilterProp="label" placeholder="选择分组"
              maxTagCount="responsive" allowClear
              options={groups.map(g => ({ value: g.id, label: g.name }))} />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
