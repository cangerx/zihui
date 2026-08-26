import { useEffect, useMemo, useState } from 'react';
import {
  Modal, Descriptions, Tag, Spin, Card, Statistic, Row, Col, Button, Space, Tabs, Table, Typography, Empty, message, Switch, Alert,
} from 'antd';
import { DollarOutlined, ArrowRightOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import {
  userApi, balanceApi, orderApi, planApi, usageApi, redeemApi, videoApi,
} from '../services/api';
import { useCurrencyLabels } from '../contexts/CurrencyContext';
import CurrencyTag from './CurrencyTag';

interface Props {
  open: boolean;
  userId: number | null;
  onClose: () => void;
}

const ORDER_STATUS: Record<string, { color: string; label: string }> = {
  pending:  { color: 'gold',    label: '待支付' },
  paid:     { color: 'green',   label: '已支付' },
  closed:   { color: 'default', label: '已关闭' },
  expired:  { color: 'default', label: '已超时' },
  failed:   { color: 'red',     label: '失败' },
  refunded: { color: 'purple',  label: '已退款' },
};

const PLAN_STATUS: Record<string, { color: string; label: string }> = {
  active:  { color: 'green',   label: '生效中' },
  expired: { color: 'default', label: '已过期' },
  revoked: { color: 'red',     label: '已撤销' },
};

// 展示用「有效状态」：存储 status 靠每小时定时任务才翻转，到期后短时间内仍是 'active'。
// 按 expires_at 实时派生，避免状态列「生效中」与过期时间已过自相矛盾。
function effectivePlanStatus(status: string, expiresAt: string | null): string {
  if (status === 'active' && expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
    return 'expired';
  }
  return status;
}

const PLAN_SOURCE: Record<string, string> = {
  purchase: '购买', redeem: '兑换码', admin: '后台发放', register: '注册赠送',
};

/**
 * 用户详情弹窗。
 * - 顶部：基本信息 + 钱包余额（两种）+ 所属分组
 * - 底部：Tabs（订单 / 用户套餐 / 用量记录 / 兑换记录），每个 Tab 独立分页 + 跳转入口
 *
 * 钱包余额优先用 /admin/balances?user_id=X 拉取，避免依赖列表接口里 with('balances') 的全量数据。
 * 各 Tab 数据 lazy load（切换 tab 才请求）。
 */
export default function UserDetailModal({ open, userId, onClose }: Props) {
  const { labels } = useCurrencyLabels();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [balances, setBalances] = useState<Array<{ balance_type: string; amount: number | string }>>([]);
  // 生效套餐的余量合计（token / credit）：与钱包合计成「总余额」展示，
  // 避免只看到钱包数字误以为「充值/发放没到账」
  const [planRemaining, setPlanRemaining] = useState<{ token: number; credit: number }>({ token: 0, credit: 0 });

  const [activeTab, setActiveTab] = useState<string>('orders');

  // 加载基本信息 + 钱包 + 生效套餐余量
  useEffect(() => {
    if (!open || !userId) return;
    setLoading(true);
    Promise.all([
      userApi.get(userId),
      balanceApi.list({ user_id: userId, per_page: 10 }),
      // 套餐余量是辅助信息：端点故障只降级为 0，不得拖死整个详情弹窗（用户/钱包是主信息）
      planApi.userPlans({ user_id: userId, status: 'active', per_page: 100 })
        .catch(() => ({ data: { data: [] as any[] } })),
    ]).then(([uRes, bRes, pRes]) => {
      setUser(uRes.data);
      setBalances((bRes.data?.data || []) as any[]);
      const sums = { token: 0, credit: 0 };
      for (const up of (pRes.data?.data || []) as any[]) {
        sums.token += Number(up.quota_summary?.token?.remaining || 0);
        sums.credit += Number(up.quota_summary?.credit?.remaining || 0);
      }
      setPlanRemaining(sums);
    }).catch(() => message.error('加载用户详情失败'))
      .finally(() => setLoading(false));
  }, [open, userId]);

  // 关闭时复位 tab，避免下次打开停留在上一次的 tab
  useEffect(() => {
    if (!open) {
      setActiveTab('orders');
      setUser(null);
      setBalances([]);
      setPlanRemaining({ token: 0, credit: 0 });
    }
  }, [open]);

  const tokenAmount = useMemo(
    () => Number(balances.find((b) => b.balance_type === 'token')?.amount || 0),
    [balances]
  );
  const creditAmount = useMemo(
    () => Number(balances.find((b) => b.balance_type === 'credit')?.amount || 0),
    [balances]
  );

  const goWith = (path: string, extra?: Record<string, string | number>) => {
    if (!userId) return;
    const sp = new URLSearchParams({ user_id: String(userId) });
    if (extra) {
      Object.entries(extra).forEach(([k, v]) => sp.set(k, String(v)));
    }
    navigate(`${path}?${sp.toString()}`);
    onClose();
  };

  return (
    <Modal
      title={user ? `用户详情 · ${user.nickname || user.username} #${user.id}` : '用户详情'}
      open={open}
      onCancel={onClose}
      mask={false}
      width={1080}
      footer={[<Button key="close" onClick={onClose}>关闭</Button>]}
      destroyOnClose
    >
      <Spin spinning={loading}>
        {user ? (
          <>
            {/* 基本信息 */}
            <Descriptions column={2} size="small" bordered style={{ marginBottom: 16 }}>
              <Descriptions.Item label="ID">{user.id}</Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={user.status === 'active' ? 'green' : 'default'}>
                  {user.status === 'active' ? '正常' : '禁用'}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="用户名">
                <Typography.Text copyable>{user.username}</Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label="昵称">{user.nickname || '-'}</Descriptions.Item>
              <Descriptions.Item label="邮箱">{user.email || '-'}</Descriptions.Item>
              <Descriptions.Item label="手机">{user.phone || '-'}</Descriptions.Item>
              <Descriptions.Item label="角色">
                <Tag color={user.role === 'admin' ? 'red' : 'blue'}>
                  {user.role === 'admin' ? '管理员' : '用户'}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="灵感大王">
                {user.inspiration_uploader
                  ? <Tag color="gold">已开启</Tag>
                  : <span style={{ color: '#bbb' }}>-</span>}
              </Descriptions.Item>
              <Descriptions.Item label="注册 IP">{user.register_ip || '-'}</Descriptions.Item>
              <Descriptions.Item label="注册设备 ID">
                {user.register_device_id
                  ? <Typography.Text copyable code style={{ fontSize: 12 }}>{user.register_device_id}</Typography.Text>
                  : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="创建时间">
                {user.created_at ? dayjs(user.created_at).format('YYYY-MM-DD HH:mm:ss') : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="更新时间">
                {user.updated_at ? dayjs(user.updated_at).format('YYYY-MM-DD HH:mm:ss') : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="最后登录时间" span={2}>
                {user.last_login_at
                  ? dayjs(user.last_login_at).format('YYYY-MM-DD HH:mm:ss')
                  : <span style={{ color: '#bbb' }}>从未登录</span>}
              </Descriptions.Item>
              <Descriptions.Item label="备注" span={2}>{user.remark || '-'}</Descriptions.Item>
              <Descriptions.Item label="所属分组" span={2}>
                {Array.isArray(user.groups) && user.groups.length > 0
                  ? user.groups.map((g: any) => (
                      <Tag key={g.id} color="blue" style={{ cursor: 'pointer' }} onClick={() => { navigate('/groups'); onClose(); }}>
                        {g.name}
                      </Tag>
                    ))
                  : <span style={{ color: '#bbb' }}>未加入分组</span>}
              </Descriptions.Item>
            </Descriptions>

            {/* 余额总览：总额 = 钱包 + 生效套餐余量（两账户体系合计，扣费先套餐后钱包） */}
            <Row gutter={16} style={{ marginBottom: 16 }}>
              <Col span={12}>
                <Card size="small">
                  <Row align="middle" justify="space-between">
                    <Col>
                      <Statistic
                        title={<span><CurrencyTag type="token" /> {labels.token}总余额</span>}
                        value={tokenAmount + planRemaining.token}
                        precision={4}
                        valueStyle={{ fontSize: 22 }}
                      />
                      <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
                        钱包 {tokenAmount.toFixed(2)} · 套餐 {planRemaining.token.toFixed(2)}
                      </div>
                    </Col>
                    <Col>
                      <Space>
                        <Button size="small" icon={<DollarOutlined />}
                          onClick={() => goWith('/balances', { balance_type: 'token' })}>
                          管理
                        </Button>
                      </Space>
                    </Col>
                  </Row>
                </Card>
              </Col>
              <Col span={12}>
                <Card size="small">
                  <Row align="middle" justify="space-between">
                    <Col>
                      <Statistic
                        title={<span><CurrencyTag type="credit" /> {labels.credit}总余额</span>}
                        value={creditAmount + planRemaining.credit}
                        precision={4}
                        valueStyle={{ fontSize: 22 }}
                      />
                      <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
                        钱包 {creditAmount.toFixed(2)} · 套餐 {planRemaining.credit.toFixed(2)}
                      </div>
                    </Col>
                    <Col>
                      <Space>
                        <Button size="small" icon={<DollarOutlined />}
                          onClick={() => goWith('/balances', { balance_type: 'credit' })}>
                          管理
                        </Button>
                      </Space>
                    </Col>
                  </Row>
                </Card>
              </Col>
            </Row>

            {/* 关联数据 Tabs。key={userId} 让切换用户时各 Tab 子组件重新挂载,page 回 1 */}
            <Tabs
              key={userId}
              activeKey={activeTab}
              onChange={setActiveTab}
              items={[
                {
                  key: 'capabilities',
                  label: '能力',
                  children: <CapabilitiesTab userId={userId!} onOpenVideos={(taskId) => goWith('/videos', { tab: 'tasks', ...(taskId ? { task_id: taskId } : {}) })} />,
                },
                {
                  key: 'orders',
                  label: '订单',
                  children: <OrdersTab userId={userId!} onJump={() => goWith('/orders')} />,
                },
                {
                  key: 'user-plans',
                  label: '用户套餐',
                  children: <UserPlansTab userId={userId!} onJump={() => goWith('/user-plans')} labels={labels} />,
                },
                {
                  key: 'usage',
                  label: '用量记录',
                  children: <UsageTab userId={userId!} onJump={() => goWith('/usage')} labels={labels} />,
                },
                {
                  key: 'redeem',
                  label: '兑换记录',
                  children: <RedeemTab userId={userId!} onJump={() => goWith('/redeem-records')} labels={labels} />,
                },
              ]}
            />
          </>
        ) : (
          !loading && <Empty description="无数据" />
        )}
      </Spin>
    </Modal>
  );
}

/* ---------------- 各 Tab：内联组件，独立分页 ---------------- */

function TabHeader({ onJump }: { onJump: () => void }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
      <Button size="small" type="link" icon={<ArrowRightOutlined />} onClick={onJump}>
        查看完整列表
      </Button>
    </div>
  );
}

const CAPABILITY_LABELS: Record<string, string> = {
  allow_ai_video: 'AI 视频 / 爆款复刻', allow_clawbot: '微信 ClawBot',
  allow_custom_provider: '自定义对话/生图服务商', allow_custom_video_provider: '自定义视频服务商',
  allow_image_matting: '快速抠图', allow_custom_matting_provider: '自定义抠图接口',
  allow_fine_matting: '精细抠图', allow_ai_mark_removal: '去 AI 标记',
};
const SOURCE_LABELS: Record<string, string> = { default: '系统默认', group: '用户分组', plan: '套餐', user: '用户覆盖' };
const PRICING_SOURCE_LABELS: Record<string, string> = { default: '默认价', group: '分组专属价', user: '用户专属价' };
const DIAGNOSTIC_LABELS: Record<string, string> = {
  visible: '可见', no_account: '未配置账号', account_inactive: '账号未启用或缺 Key',
  model_disabled: '模型未启用', sku_missing: '缺少 SKU', sku_disabled: 'SKU 未启用', unpriced: 'SKU 未定价',
};

function CapabilitiesTab({ userId, onOpenVideos }: { userId: number; onOpenVideos: (taskId?: string) => void }) {
  const [capabilities, setCapabilities] = useState<any[]>([]);
  const [diagnostics, setDiagnostics] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const load = async () => {
    setLoading(true);
    try {
      const [capabilityRes, diagnosticRes, taskRes] = await Promise.all([
        userApi.capabilities(userId), videoApi.catalogDiagnostics({ user_id: userId }),
        videoApi.tasks({ user_id: userId, status: 'failed', per_page: 5 }),
      ]);
      setCapabilities(capabilityRes.data.capabilities || []);
      setDiagnostics(diagnosticRes.data.models || []);
      setTasks(taskRes.data.data || []);
    } catch {
      message.error('加载用户能力失败');
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [userId]);
  const update = async (key: string, value: boolean) => {
    setSavingKey(key);
    try {
      await userApi.updateCapability(userId, key, value);
      message.success('已更新用户能力');
      await load();
    } catch (e: any) {
      message.error(e?.response?.data?.error || '更新失败');
    } finally { setSavingKey(null); }
  };
  const aiVideo = capabilities.find((item) => item.key === 'allow_ai_video');
  return <Spin spinning={loading}><Space direction="vertical" size={16} style={{ width: '100%' }}>
    {!aiVideo?.value && <Alert type="warning" showIcon message="该用户尚未开通 AI 视频" action={<Button size="small" type="primary" loading={savingKey === 'allow_ai_video'} onClick={() => update('allow_ai_video', true)}>开通 AI 视频</Button>} />}
    <Card size="small" title="生效能力"><Table size="small" rowKey="key" pagination={false} dataSource={capabilities} columns={[
      { title: '能力', render: (_: any, row: any) => CAPABILITY_LABELS[row.key] || row.key },
      { title: '来源', dataIndex: 'source', width: 130, render: (value: string) => <Tag color={value === 'user' ? 'blue' : 'default'}>{SOURCE_LABELS[value] || value}</Tag> },
      { title: '状态', width: 100, render: (_: any, row: any) => <Switch checked={!!row.value} loading={savingKey === row.key} onChange={(checked) => update(row.key, checked)} /> },
    ] as any} /></Card>
    <Card size="small" title="桌面视频目录"><Table size="small" rowKey="id" pagination={false} dataSource={diagnostics} expandable={{
      rowExpandable: (row: any) => Array.isArray(row.skus) && row.skus.some((sku: any) => sku.id),
      expandedRowRender: (row: any) => <Table size="small" rowKey="id" pagination={false} dataSource={(row.skus || []).filter((sku: any) => sku.id)} columns={[
        { title: 'SKU', render: (_: any, sku: any) => <Space direction="vertical" size={0}><Typography.Text>{sku.title || sku.sku_key}</Typography.Text><Typography.Text type="secondary">{sku.sku_key}</Typography.Text></Space> },
        { title: '规格', render: (_: any, sku: any) => [sku.mode, sku.duration_seconds ? `${sku.duration_seconds}s` : '', sku.resolution || sku.quality, sku.aspect_ratio].filter(Boolean).join(' / ') || '用户自选' },
        { title: '用户最终积分', width: 180, render: (_: any, sku: any) => sku.credit_cost === null || sku.credit_cost === undefined ? <Tag color="orange">未定价</Tag> : <Space direction="vertical" size={0}><Typography.Text strong>{sku.credit_cost}{sku.price_label ? ` · ${sku.price_label}` : ''}</Typography.Text><Typography.Text type="secondary">{PRICING_SOURCE_LABELS[sku.pricing_target_type] || '默认价'}</Typography.Text></Space> },
        { title: '状态', width: 150, render: (_: any, sku: any) => sku.visible ? <Tag color="green">可见</Tag> : <Tag color="orange">{DIAGNOSTIC_LABELS[sku.reason] || sku.reason}</Tag> },
      ] as any} />,
    }} columns={[
      { title: '模型', render: (_: any, row: any) => <Space direction="vertical" size={0}><Typography.Text>{row.display_name}</Typography.Text><Typography.Text type="secondary">{row.model_id}</Typography.Text></Space> },
      { title: '服务商', dataIndex: 'provider_key', width: 120 },
      { title: 'SKU', width: 100, render: (_: any, row: any) => `${(row.skus || []).filter((sku: any) => sku.id).length} 条` },
      { title: '目录状态', width: 180, render: (_: any, row: any) => row.visible ? <Tag color="green">可见</Tag> : <Tag color="orange">{DIAGNOSTIC_LABELS[row.reason] || row.reason}</Tag> },
    ] as any} /></Card>
    <Card size="small" title="最近失败视频任务" extra={<Button type="link" onClick={() => onOpenVideos()}>查看全部</Button>}><Table size="small" rowKey="id" pagination={false} dataSource={tasks} locale={{ emptyText: '暂无失败任务' }} columns={[
      { title: '任务 ID', dataIndex: 'id', ellipsis: true }, { title: '模型', dataIndex: 'model_name', width: 160 },
      { title: '错误', ellipsis: true, render: (_: any, row: any) => row.error_summary?.title || row.error_message || '-' }, { title: '时间', dataIndex: 'created_at', width: 170 },
      { title: '操作', width: 80, render: (_: any, row: any) => <Button size="small" type="link" onClick={() => onOpenVideos(row.id)}>详情</Button> },
    ] as any} /></Card>
  </Space></Spin>;
}

function OrdersTab({ userId, onJump }: { userId: number; onJump: () => void }) {
  const [data, setData] = useState<any>({ data: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 10;

  useEffect(() => {
    setLoading(true);
    orderApi.list({ user_id: userId, page, per_page: pageSize })
      .then((res) => setData(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [userId, page]);

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: '订单号', dataIndex: 'order_no', width: 200, render: (v: string) => <Typography.Text copyable code style={{ fontSize: 12 }}>{v}</Typography.Text> },
    {
      title: '套餐', width: 180,
      render: (_: any, r: any) => r.plan ? <span><code>{r.plan.code}</code> · {r.plan.name}</span> : `#${r.plan_id}`,
    },
    {
      title: '金额', dataIndex: 'amount', width: 100,
      render: (v: any, r: any) => <span>{Number(v).toFixed(2)} {r.currency}</span>,
    },
    {
      title: '状态', width: 90,
      render: (_: any, r: any) => {
        const key = r.derived_status || r.status;
        const t = ORDER_STATUS[key] || { color: 'default', label: key };
        return <Tag color={t.color}>{t.label}</Tag>;
      },
    },
    {
      title: '创建时间', dataIndex: 'created_at', width: 140,
      render: (v: string) => v ? dayjs(v).format('YY-MM-DD HH:mm') : '-',
    },
  ];

  return (
    <>
      <TabHeader onJump={onJump} />
      <Table size="small" rowKey="id" loading={loading}
        columns={columns as any} dataSource={data.data}
        pagination={{ current: page, pageSize, total: data.total, onChange: setPage, showSizeChanger: false, size: 'small' }}
        scroll={{ x: 760 }}
      />
    </>
  );
}

function UserPlansTab({ userId, onJump, labels }: { userId: number; onJump: () => void; labels: { token: string; credit: string } }) {
  const [data, setData] = useState<any>({ data: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 10;

  useEffect(() => {
    setLoading(true);
    planApi.userPlans({ user_id: userId, page, per_page: pageSize })
      .then((res) => setData(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [userId, page]);

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    {
      title: '套餐', width: 200,
      render: (_: any, r: any) => r.plan ? <span><code>{r.plan.code}</code> · {r.plan.name}</span> : `#${r.plan_id}`,
    },
    {
      title: '来源', dataIndex: 'source', width: 90,
      render: (v: string) => <Tag>{PLAN_SOURCE[v] || v}</Tag>,
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
      title: `${labels.token}额度`, width: 100,
      render: (_: any, r: any) => Number(r.token_granted || 0).toFixed(0),
    },
    {
      title: `${labels.credit}额度`, width: 100,
      render: (_: any, r: any) => Number(r.credit_granted || 0).toFixed(0),
    },
    {
      title: '状态', dataIndex: 'status', width: 90,
      render: (v: string, r: any) => {
        const eff = effectivePlanStatus(v, r.expires_at);
        const t = PLAN_STATUS[eff] || { color: 'default', label: eff };
        return <Tag color={t.color}>{t.label}</Tag>;
      },
    },
  ];

  return (
    <>
      <TabHeader onJump={onJump} />
      <Table size="small" rowKey="id" loading={loading}
        columns={columns as any} dataSource={data.data}
        pagination={{ current: page, pageSize, total: data.total, onChange: setPage, showSizeChanger: false, size: 'small' }}
        scroll={{ x: 900 }}
      />
    </>
  );
}

function UsageTab({ userId, onJump, labels }: { userId: number; onJump: () => void; labels: { token: string; credit: string } }) {
  const [data, setData] = useState<any>({ data: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 10;

  useEffect(() => {
    setLoading(true);
    usageApi.list({ user_id: userId, page, per_page: pageSize })
      .then((res) => setData(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [userId, page]);

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    {
      title: '模型', width: 200,
      render: (_: any, r: any) => {
        const cm = r.cloud_model;
        if (!cm) return '-';
        const base = cm.name || cm.model_id;
        return cm.provider?.name ? `${cm.provider.name} / ${base}` : base;
      },
    },
    { title: '类型', dataIndex: 'type', width: 90, render: (v: string) => <Tag>{v}</Tag> },
    { title: 'Tokens', dataIndex: 'total_tokens', width: 100, render: (v: number) => v > 0 ? v.toLocaleString() : '-' },
    {
      title: '消耗', dataIndex: 'cost', width: 130,
      render: (v: any, r: any) => {
        const val = Number(v);
        if (val <= 0) return '-';
        return r.balance_type === 'credit' ? `${val.toFixed(4)} ${labels.credit}` : `${val.toFixed(4)} ${labels.token}`;
      },
    },
    {
      title: '状态', dataIndex: 'status', width: 80,
      render: (v: string) => <Tag color={v === 'success' ? 'green' : 'red'}>{v === 'success' ? '成功' : '失败'}</Tag>,
    },
    {
      title: '时间', dataIndex: 'created_at', width: 120,
      render: (v: string) => v ? dayjs(v).format('MM-DD HH:mm') : '-',
    },
  ];

  return (
    <>
      <TabHeader onJump={onJump} />
      <Table size="small" rowKey="id" loading={loading}
        columns={columns as any} dataSource={data.data}
        pagination={{ current: page, pageSize, total: data.total, onChange: setPage, showSizeChanger: false, size: 'small' }}
        scroll={{ x: 800 }}
      />
    </>
  );
}

function RedeemTab({ userId, onJump, labels }: { userId: number; onJump: () => void; labels: { token: string; credit: string } }) {
  const [data, setData] = useState<any>({ data: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 10;

  useEffect(() => {
    setLoading(true);
    redeemApi.records({ user_id: userId, page, per_page: pageSize })
      .then((res) => setData(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [userId, page]);

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    {
      title: '兑换时间', dataIndex: 'created_at', width: 150,
      render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-',
    },
    {
      title: '兑换码', dataIndex: ['code'], width: 180,
      render: (c: any) => c ? <span style={{ fontFamily: 'monospace' }}>{c.code}</span> : '-',
    },
    {
      title: '类型', dataIndex: ['code', 'type'], width: 80,
      render: (v: string) => v ? <Tag>{v}</Tag> : '-',
    },
    {
      title: '奖励',
      render: (_: any, r: any) => {
        const g = r.reward_snapshot_json?.granted || {};
        return (
          <Space size={4} wrap>
            {(g.token ?? 0) > 0 && <Tag color="orange">{labels.token} +{g.token}</Tag>}
            {(g.credit ?? 0) > 0 && <Tag color="purple">{labels.credit} +{g.credit}</Tag>}
            {g.plan_id && <Tag color="geekblue">套餐 #{g.plan_id}{g.plan_pending ? ' (待开通)' : ''}</Tag>}
            {(g.token ?? 0) === 0 && (g.credit ?? 0) === 0 && !g.plan_id && '-'}
          </Space>
        );
      },
    },
    { title: 'IP', dataIndex: 'ip', width: 110, render: (v: string) => v || '-' },
  ];

  return (
    <>
      <TabHeader onJump={onJump} />
      <Table size="small" rowKey="id" loading={loading}
        columns={columns as any} dataSource={data.data}
        pagination={{ current: page, pageSize, total: data.total, onChange: setPage, showSizeChanger: false, size: 'small' }}
        scroll={{ x: 800 }}
      />
    </>
  );
}
