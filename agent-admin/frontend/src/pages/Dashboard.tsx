import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Card, Col, Row, Table, Tag, Progress, Typography, Space,
  Skeleton, Segmented, Button,
} from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined, ReloadOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer,
} from 'recharts';
import {
  userApi, orderApi, modelApi, planApi, redeemApi, usageApi,
  commissionOrderApi, videoApi, mattingApi, fineMattingApi,
  agentApi, creativeTemplateApi, inspirationApi, knowledgeBaseApi, docApi,
  announcementApi,
} from '../services/api';

/* ============================ 视觉规范（克制 / 专业 / 单主色） ============================ */
const C = {
  primary: '#1677ff',
  primarySoft: '#69b1ff',
  text: '#1f1f1f',
  sub: '#8c8c8c',
  border: '#f0f0f0',
  up: '#389e0d',
  down: '#cf1322',
  warn: '#d48806',
};

/* ============================ 类型 ============================ */
interface UserRow {
  id: number;
  username: string;
  nickname?: string;
  status?: string;
  created_at: string;
}

interface OrderRow {
  id: number;
  order_no: string;
  user_id: number;
  plan_id: number;
  amount: string | number;
  status: string;
  derived_status?: string;
  order_type?: string;
  created_at: string;
  user?: { id: number; username: string; nickname?: string };
  plan?: { id: number; code: string; name: string };
}

interface ModelStats {
  cloud_model_id: number;
  balance_type: string;
  calls: number;
  tokens: number;
  cost: number;
  cloudModel?: { id: number; model_id: string; name: string; type?: string; provider?: { id: number; name: string } };
}

interface DailyPoint {
  date: string;
  calls: number;
}

const STATUS_LABEL: Record<string, { color: string; label: string }> = {
  pending:  { color: 'gold',    label: '待支付' },
  paid:     { color: 'green',   label: '已支付' },
  closed:   { color: 'default', label: '已关闭' },
  expired:  { color: 'default', label: '已超时' },
  failed:   { color: 'red',     label: '失败' },
  refunded: { color: 'purple',  label: '已退款' },
};

type TimeRange = 'today' | 'week' | 'month' | '30d' | 'all';

const RANGE_OPTIONS: { label: string; value: TimeRange }[] = [
  { label: '今日',     value: 'today' },
  { label: '本周',     value: 'week' },
  { label: '本月',     value: 'month' },
  { label: '近 30 天', value: '30d' },
  { label: '全部',     value: 'all' },
];

function getDateRange(range: TimeRange): { start_date?: string; end_date?: string } {
  const today = dayjs().format('YYYY-MM-DD');
  switch (range) {
    case 'today': return { start_date: today, end_date: today };
    case 'week': {
      const dow = dayjs().day();
      const offset = dow === 0 ? 6 : dow - 1;
      return { start_date: dayjs().subtract(offset, 'day').format('YYYY-MM-DD'), end_date: today };
    }
    case 'month': return { start_date: dayjs().startOf('month').format('YYYY-MM-DD'), end_date: today };
    case '30d':   return { start_date: dayjs().subtract(29, 'day').format('YYYY-MM-DD'), end_date: today };
    case 'all':   return {};
  }
}

function rangeLabelOf(r: TimeRange): string {
  return RANGE_OPTIONS.find((x) => x.value === r)?.label || '';
}

/** orderApi 用 start_date/end_date；commissionOrderApi 用 created_start/created_end */
function toCommissionRange(dr: { start_date?: string; end_date?: string }): Record<string, string> {
  const p: Record<string, string> = {};
  if (dr.start_date) p.created_start = dr.start_date;
  if (dr.end_date) p.created_end = dr.end_date;
  return p;
}

/* ============================ 格式化 ============================ */
const fmtInt = (n: number | string) => Math.round(Number(n) || 0).toLocaleString();
const fmtMoney = (n: number | string) =>
  '¥' + (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const settledTotal = (r: PromiseSettledResult<any>) =>
  r.status === 'fulfilled' ? Number(r.value.data?.total ?? r.value.data?.data?.length ?? 0) : 0;

/* ============================ 组件主体 ============================ */
export default function Dashboard() {
  const [range, setRange] = useState<TimeRange>('30d');

  // 今日 KPI（固定今日 vs 昨日）
  const [todayLoading, setTodayLoading] = useState(true);
  const [today, setToday] = useState({
    newUsers: { today: 0, yesterday: 0 },
    orders:   { today: 0, yesterday: 0 },
    revenue:  { today: 0, yesterday: 0 },
    calls:    { today: 0, yesterday: 0 },
  });

  // 营收总览（随 range 变，DB 层精确聚合）
  const [revenueLoading, setRevenueLoading] = useState(true);
  const [revenue, setRevenue] = useState({
    totalPaid: 0, planPaid: 0, rechargePaid: 0,
    paidCount: 0, rechargeCount: 0,
    commission: 0, commissionConfirmed: 0,
  });

  // 业务总量（累计 KPI）
  const [totalsLoading, setTotalsLoading] = useState(true);
  const [totals, setTotals] = useState({
    users: 0, orders: 0, models: 0, plans: 0, redeemUsable: 0, calls: 0,
  });

  // AIGC 生成业务（语义固定：视频累计 / 抠图今日·本月）
  const [aigcLoading, setAigcLoading] = useState(true);
  const [aigc, setAigc] = useState<{
    video: any; matting: any; fineMatting: any; imageCalls: number;
  }>({ video: null, matting: null, fineMatting: null, imageCalls: 0 });

  // 内容生态
  const [contentLoading, setContentLoading] = useState(true);
  const [content, setContent] = useState({
    agents: 0, agentsPending: 0,
    templates: 0, templatesPending: 0,
    inspirations: 0, inspirationsPending: 0,
    knowledgeBases: 0, docs: 0, announcements: 0,
  });

  // 范围内：订单分布 / 套餐销量 / 调用趋势 / 模型 Top
  const [rangeLoading, setRangeLoading] = useState(true);
  const [orderBreakdown, setOrderBreakdown] = useState<{ byStatus: Record<string, number> }>({ byStatus: {} });
  const [planSales, setPlanSales] = useState<{ plan: string; count: number; amount: number }[]>([]);
  const [daily, setDaily] = useState<DailyPoint[]>([]);
  const [modelTop, setModelTop] = useState<ModelStats[]>([]);

  // 最近列表
  const [recentLoading, setRecentLoading] = useState(true);
  const [recentOrders, setRecentOrders] = useState<OrderRow[]>([]);
  const [recentUsers, setRecentUsers] = useState<UserRow[]>([]);

  /* -------- 今日 KPI -------- */
  const loadToday = useCallback(async () => {
    setTodayLoading(true);
    const t = dayjs().format('YYYY-MM-DD');
    const y = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
    const [uT, uY, oT, oY, payT, payY, callT, callY] = await Promise.allSettled([
      userApi.list({ start_date: t, end_date: t, per_page: 1 }),
      userApi.list({ start_date: y, end_date: y, per_page: 1 }),
      orderApi.list({ start_date: t, end_date: t, per_page: 1 }),
      orderApi.list({ start_date: y, end_date: y, per_page: 1 }),
      commissionOrderApi.list({ created_start: t, created_end: t, per_page: 1 }),
      commissionOrderApi.list({ created_start: y, created_end: y, per_page: 1 }),
      usageApi.stats({ start_date: t, end_date: t }),
      usageApi.stats({ start_date: y, end_date: y }),
    ]);
    const paid = (r: PromiseSettledResult<any>) =>
      r.status === 'fulfilled' ? Number(r.value.data?.summary?.paid_order_amount || 0) : 0;
    const calls = (r: PromiseSettledResult<any>) =>
      r.status === 'fulfilled' ? Number(r.value.data?.total_calls || 0) : 0;
    setToday({
      newUsers: { today: settledTotal(uT), yesterday: settledTotal(uY) },
      orders:   { today: settledTotal(oT), yesterday: settledTotal(oY) },
      revenue:  { today: paid(payT),       yesterday: paid(payY) },
      calls:    { today: calls(callT),     yesterday: calls(callY) },
    });
    setTodayLoading(false);
  }, []);

  /* -------- 营收总览 -------- */
  const loadRevenue = useCallback(async () => {
    setRevenueLoading(true);
    const cr = toCommissionRange(getDateRange(range));
    const [allRes, rechargeRes] = await Promise.allSettled([
      commissionOrderApi.list({ ...cr, per_page: 1 }),
      commissionOrderApi.list({ ...cr, order_type: 'recharge', per_page: 1 }),
    ]);
    const allSum = allRes.status === 'fulfilled' ? (allRes.value.data?.summary || {}) : {};
    const rcgSum = rechargeRes.status === 'fulfilled' ? (rechargeRes.value.data?.summary || {}) : {};
    const totalPaid = Number(allSum.paid_order_amount || 0);
    const rechargePaid = Number(rcgSum.paid_order_amount || 0);
    setRevenue({
      totalPaid,
      planPaid: Math.max(totalPaid - rechargePaid, 0),
      rechargePaid,
      paidCount: Number(allSum.paid_order_count || 0),
      rechargeCount: Number(rcgSum.paid_order_count || 0),
      commission: Number(allSum.commission_amount || 0),
      commissionConfirmed: Number(allSum.confirmed_commission_amount || 0),
    });
    setRevenueLoading(false);
  }, [range]);

  /* -------- 业务总量 -------- */
  const loadTotals = useCallback(async () => {
    setTotalsLoading(true);
    const [u, o, m, p, r, s] = await Promise.allSettled([
      userApi.list({ per_page: 1 }),
      orderApi.list({ per_page: 1 }),
      modelApi.list({ per_page: 1 }),
      planApi.list({ per_page: 1 }),
      redeemApi.list({ per_page: 1, status: 'unused' }),
      usageApi.stats({}),
    ]);
    setTotals({
      users:        settledTotal(u),
      orders:       settledTotal(o),
      models:       settledTotal(m),
      plans:        settledTotal(p),
      redeemUsable: settledTotal(r),
      calls:        s.status === 'fulfilled' ? Number(s.value.data?.total_calls || 0) : 0,
    });
    setTotalsLoading(false);
  }, []);

  /* -------- AIGC 生成业务 -------- */
  const loadAigc = useCallback(async () => {
    setAigcLoading(true);
    const [v, m, f, img] = await Promise.allSettled([
      videoApi.stats(),
      mattingApi.stats(),
      fineMattingApi.stats(),
      usageApi.stats({ type: 'image' }),
    ]);
    setAigc({
      video:       v.status === 'fulfilled' ? v.value.data : null,
      matting:     m.status === 'fulfilled' ? m.value.data : null,
      fineMatting: f.status === 'fulfilled' ? f.value.data : null,
      imageCalls:  img.status === 'fulfilled' ? Number(img.value.data?.total_calls || 0) : 0,
    });
    setAigcLoading(false);
  }, []);

  /* -------- 内容生态 -------- */
  const loadContent = useCallback(async () => {
    setContentLoading(true);
    const [ag, agP, tpl, tplP, insp, inspP, kb, doc, ann] = await Promise.allSettled([
      agentApi.list({ per_page: 1 }),
      agentApi.list({ per_page: 1, submission_status: 'pending' }),
      creativeTemplateApi.list({ per_page: 1 }),
      creativeTemplateApi.list({ per_page: 1, submission_status: 'pending' }),
      inspirationApi.list({ per_page: 1 }),
      inspirationApi.list({ per_page: 1, status: 'pending' }),
      knowledgeBaseApi.list({ per_page: 1 }),
      docApi.list({ per_page: 1 }),
      announcementApi.list({ per_page: 1 }),
    ]);
    setContent({
      agents: settledTotal(ag),               agentsPending: settledTotal(agP),
      templates: settledTotal(tpl),           templatesPending: settledTotal(tplP),
      inspirations: settledTotal(insp),       inspirationsPending: settledTotal(inspP),
      knowledgeBases: settledTotal(kb),       docs: settledTotal(doc),
      announcements: settledTotal(ann),
    });
    setContentLoading(false);
  }, []);

  /* -------- 范围统计 -------- */
  const loadRange = useCallback(async () => {
    setRangeLoading(true);
    const dr = getDateRange(range);
    const [oRes, sRes] = await Promise.allSettled([
      orderApi.list({ ...dr, per_page: 200 }),
      usageApi.stats(dr),
    ]);

    if (oRes.status === 'fulfilled') {
      const list: OrderRow[] = oRes.value.data?.data || [];
      const byStatus: Record<string, number> = {};
      const planAgg: Record<string, { plan: string; count: number; amount: number }> = {};
      for (const o of list) {
        const k = o.derived_status || o.status;
        byStatus[k] = (byStatus[k] || 0) + 1;
        if (o.status === 'paid' && o.order_type !== 'recharge') {
          const planName = o.plan?.name || `套餐#${o.plan_id}`;
          const cur = planAgg[planName] || { plan: planName, count: 0, amount: 0 };
          cur.count++;
          cur.amount += Number(o.amount || 0);
          planAgg[planName] = cur;
        }
      }
      setOrderBreakdown({ byStatus });
      setPlanSales(Object.values(planAgg).sort((a, b) => b.count - a.count).slice(0, 5));
    } else {
      setOrderBreakdown({ byStatus: {} });
      setPlanSales([]);
    }

    if (sRes.status === 'fulfilled') {
      const s = sRes.value.data || {};
      setDaily(s.daily || []);
      setModelTop(
        (s.by_model || [])
          .slice()
          .sort((a: ModelStats, b: ModelStats) => (b.calls || 0) - (a.calls || 0))
          .slice(0, 5)
      );
    } else {
      setDaily([]);
      setModelTop([]);
    }
    setRangeLoading(false);
  }, [range]);

  /* -------- 最近列表 -------- */
  const loadRecent = useCallback(async () => {
    setRecentLoading(true);
    const [oRes, uRes] = await Promise.allSettled([
      orderApi.list({ per_page: 6 }),
      userApi.list({ per_page: 6 }),
    ]);
    if (oRes.status === 'fulfilled') setRecentOrders((oRes.value.data?.data || []).slice(0, 6));
    if (uRes.status === 'fulfilled') setRecentUsers((uRes.value.data?.data || []).slice(0, 6));
    setRecentLoading(false);
  }, []);

  useEffect(() => { loadToday(); }, [loadToday]);
  useEffect(() => { loadTotals(); }, [loadTotals]);
  useEffect(() => { loadAigc(); }, [loadAigc]);
  useEffect(() => { loadContent(); }, [loadContent]);
  useEffect(() => { loadRevenue(); }, [loadRevenue]);
  useEffect(() => { loadRange(); }, [loadRange]);
  useEffect(() => { loadRecent(); }, [loadRecent]);

  const refreshAll = () => {
    loadToday(); loadTotals(); loadAigc(); loadContent();
    loadRevenue(); loadRange(); loadRecent();
  };

  const totalStatusCount = useMemo(
    () => Object.values(orderBreakdown.byStatus).reduce((a, b) => a + b, 0),
    [orderBreakdown.byStatus]
  );

  const chartData = useMemo<DailyPoint[]>(() => {
    const dr = getDateRange(range);
    if (!dr.start_date || !dr.end_date || daily.length === 0) return daily;
    const map = new Map(daily.map((d) => [d.date, d.calls]));
    const out: DailyPoint[] = [];
    let cur = dayjs(dr.start_date);
    const end = dayjs(dr.end_date);
    while (cur.isBefore(end) || cur.isSame(end, 'day')) {
      const d = cur.format('YYYY-MM-DD');
      out.push({ date: d, calls: Number(map.get(d) || 0) });
      cur = cur.add(1, 'day');
    }
    return out;
  }, [daily, range]);

  const planSharePct = revenue.totalPaid > 0 ? Math.round((revenue.planPaid / revenue.totalPaid) * 100) : 0;
  const rgLabel = rangeLabelOf(range);

  return (
    <div>
      {/* 顶部 */}
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0, color: C.text }}>仪表盘</Typography.Title>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          运营全景概览 · 数据实时聚合
        </Typography.Text>
        <div style={{ flex: 1 }} />
        <Segmented size="small" value={range} onChange={(v) => setRange(v as TimeRange)} options={RANGE_OPTIONS} />
        <Button size="small" icon={<ReloadOutlined />} onClick={refreshAll}>刷新</Button>
      </div>

      {/* 今日概览 */}
      <Section title="今日概览" desc="对比昨日同口径">
        <Row gutter={[16, 16]}>
          <Col xs={12} md={6}><StatCard title="今日新增用户" value={today.newUsers.today} prev={today.newUsers.yesterday} suffix=" 人" loading={todayLoading} /></Col>
          <Col xs={12} md={6}><StatCard title="今日成交金额" value={today.revenue.today} prev={today.revenue.yesterday} money loading={todayLoading} /></Col>
          <Col xs={12} md={6}><StatCard title="今日订单" value={today.orders.today} prev={today.orders.yesterday} suffix=" 单" loading={todayLoading} /></Col>
          <Col xs={12} md={6}><StatCard title="今日模型调用" value={today.calls.today} prev={today.calls.yesterday} suffix=" 次" loading={todayLoading} /></Col>
        </Row>
      </Section>

      {/* 营收总览 */}
      <Section title="营收总览" desc={`统计区间：${rgLabel}`} extra={<Link to="/orders">订单管理</Link>}>
        <Row gutter={[16, 16]}>
          <Col xs={12} md={6}>
            <StatCard title="区间成交总额" value={revenue.totalPaid} money loading={revenueLoading}
              hint={`${fmtInt(revenue.paidCount)} 笔已支付`} accent />
          </Col>
          <Col xs={12} md={6}>
            <StatCard title="套餐购买收入" value={revenue.planPaid} money loading={revenueLoading}
              hint={`占比 ${planSharePct}%`} />
          </Col>
          <Col xs={12} md={6}>
            <StatCard title="余额充值入金" value={revenue.rechargePaid} money loading={revenueLoading}
              hint={`${fmtInt(revenue.rechargeCount)} 笔`} />
          </Col>
          <Col xs={12} md={6}>
            <StatCard title="分销佣金" value={revenue.commission} money loading={revenueLoading}
              hint={`已确认 ${fmtMoney(revenue.commissionConfirmed)}`} />
          </Col>
        </Row>
        {!revenueLoading && revenue.totalPaid > 0 && (
          <Card size="small" style={{ marginTop: 16 }} styles={{ body: { padding: '12px 16px' } }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>收入构成</Typography.Text>
              <Space size={16}>
                <LegendDot color={C.primary} label={`套餐 ${planSharePct}%`} />
                <LegendDot color={C.primarySoft} label={`充值 ${100 - planSharePct}%`} />
              </Space>
            </div>
            <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: '#f5f5f5' }}>
              <div style={{ width: `${planSharePct}%`, background: C.primary }} />
              <div style={{ width: `${100 - planSharePct}%`, background: C.primarySoft }} />
            </div>
          </Card>
        )}
      </Section>

      {/* 业务总量 */}
      <Section title="业务总量" desc="平台累计存量">
        <Row gutter={[12, 12]}>
          <Col xs={12} sm={8} md={4}><MiniLinkCard to="/users" title="用户总数" value={totals.users} loading={totalsLoading} /></Col>
          <Col xs={12} sm={8} md={4}><MiniLinkCard to="/orders" title="订单总数" value={totals.orders} loading={totalsLoading} /></Col>
          <Col xs={12} sm={8} md={4}><MiniLinkCard to="/models" title="在售模型" value={totals.models} loading={totalsLoading} /></Col>
          <Col xs={12} sm={8} md={4}><MiniLinkCard to="/plans" title="在售套餐" value={totals.plans} loading={totalsLoading} /></Col>
          <Col xs={12} sm={8} md={4}><MiniLinkCard to="/redeem-codes" title="可用兑换码" value={totals.redeemUsable} loading={totalsLoading} /></Col>
          <Col xs={12} sm={8} md={4}><MiniLinkCard to="/usage" title="累计调用" value={totals.calls} loading={totalsLoading} /></Col>
        </Row>
      </Section>

      {/* AIGC 生成业务 */}
      <Section title="AIGC 生成业务" desc="视频为累计口径 · 抠图为今日 / 本月口径">
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={12} lg={6}>
            <BizCard title="视频生成" to="/videos" loading={aigcLoading}
              metrics={[
                { label: '总任务', value: fmtInt(aigc.video?.tasks || 0) },
                { label: '进行中', value: fmtInt(aigc.video?.pending_tasks || 0) },
                { label: '已完成', value: fmtInt(aigc.video?.completed_tasks || 0) },
                { label: '消耗积分', value: fmtInt(aigc.video?.credits_used || 0), accent: true },
              ]} />
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <BizCard title="图像生成" to="/usage" loading={aigcLoading}
              metrics={[
                { label: '累计调用', value: fmtInt(aigc.imageCalls), accent: true },
              ]} />
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <BizCard title="AI 抠图" to="/matting" loading={aigcLoading}
              metrics={[
                { label: '今日任务', value: fmtInt(aigc.matting?.today?.total || 0) },
                { label: '本月任务', value: fmtInt(aigc.matting?.month?.total || 0) },
                { label: '本月消耗', value: fmtInt(aigc.matting?.month?.credits || 0), accent: true },
              ]} />
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <BizCard title="精细抠图" to="/fine-matting" loading={aigcLoading}
              metrics={[
                { label: '今日任务', value: fmtInt(aigc.fineMatting?.today?.total || 0) },
                { label: '本月任务', value: fmtInt(aigc.fineMatting?.month?.total || 0) },
                { label: '本月消耗', value: fmtInt(aigc.fineMatting?.month?.credits || 0), accent: true },
              ]} />
          </Col>
        </Row>
      </Section>

      {/* 模型调用分析 */}
      <Section title="模型调用分析" desc={`统计区间：${rgLabel}`} extra={<Link to="/usage">用量明细</Link>}>
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={14}>
            <Card title="调用趋势" size="small">
              {rangeLoading ? <Skeleton active paragraph={{ rows: 5 }} /> : <DailyChart data={chartData} />}
            </Card>
          </Col>
          <Col xs={24} lg={10}>
            <Card title="模型调用 Top 5" size="small">
              {rangeLoading ? <Skeleton active paragraph={{ rows: 4 }} /> : (
                modelTop.length === 0 ? <Empty text="该区间暂无调用数据" /> : (
                  <Space direction="vertical" style={{ width: '100%' }} size={12}>
                    {modelTop.map((m, idx) => {
                      const max = modelTop[0]?.calls || 1;
                      const percent = Math.round(((m.calls || 0) / max) * 100);
                      const baseName = m.cloudModel?.name || m.cloudModel?.model_id || `#${m.cloud_model_id}`;
                      const providerName = m.cloudModel?.provider?.name;
                      const name = providerName ? `${providerName} / ${baseName}` : baseName;
                      const detail = Number(m.tokens || 0) > 0
                        ? `${Number(m.tokens).toLocaleString()} tokens`
                        : `${Number(m.cost || 0).toFixed(2)} credits`;
                      return (
                        <RankRow key={`${m.cloud_model_id}-${m.balance_type}`} rank={idx} name={name}
                          right={`${fmtInt(m.calls)} 次 · ${detail}`} percent={percent} tag={m.balance_type} />
                      );
                    })}
                  </Space>
                )
              )}
            </Card>
          </Col>
        </Row>
      </Section>

      {/* 内容生态 */}
      <Section title="内容生态" desc="数字员工 / 模板 / 灵感 / 知识库 / 文档">
        <Row gutter={[12, 12]}>
          <Col xs={12} sm={8} lg={4}><CountCard to="/agents" title="数字员工" value={content.agents} pending={content.agentsPending} loading={contentLoading} /></Col>
          <Col xs={12} sm={8} lg={4}><CountCard to="/creative-templates" title="工作流模板" value={content.templates} pending={content.templatesPending} loading={contentLoading} /></Col>
          <Col xs={12} sm={8} lg={4}><CountCard to="/inspirations" title="灵感广场" value={content.inspirations} pending={content.inspirationsPending} loading={contentLoading} /></Col>
          <Col xs={12} sm={8} lg={4}><CountCard to="/knowledge-bases" title="知识库" value={content.knowledgeBases} loading={contentLoading} /></Col>
          <Col xs={12} sm={8} lg={4}><CountCard to="/docs" title="帮助文档" value={content.docs} loading={contentLoading} /></Col>
          <Col xs={12} sm={8} lg={4}><CountCard to="/announcements" title="公告" value={content.announcements} loading={contentLoading} /></Col>
        </Row>
      </Section>

      {/* 订单分析 */}
      <Section title="订单分析" desc={`统计区间：${rgLabel}`}>
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={12}>
            <Card title="订单状态分布" extra={<Link to="/orders">查看全部</Link>} size="small">
              {rangeLoading ? <Skeleton active paragraph={{ rows: 4 }} /> : (
                Object.entries(orderBreakdown.byStatus).length === 0 ? <Empty text="该区间暂无订单数据" /> : (
                  <Space direction="vertical" style={{ width: '100%' }} size={10}>
                    {Object.entries(orderBreakdown.byStatus).sort((a, b) => b[1] - a[1]).map(([key, count]) => {
                      const percent = totalStatusCount > 0 ? Math.round((count / totalStatusCount) * 100) : 0;
                      const t = STATUS_LABEL[key] || { color: 'default', label: key };
                      return (
                        <div key={key}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span>
                              <Tag color={t.color} style={{ marginRight: 8 }}>{t.label}</Tag>
                              <Typography.Text type="secondary" style={{ fontSize: 12 }}>{count} 单</Typography.Text>
                            </span>
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>{percent}%</Typography.Text>
                          </div>
                          <Progress percent={percent} showInfo={false} strokeLinecap="butt" size="small" strokeColor={C.primary} />
                        </div>
                      );
                    })}
                  </Space>
                )
              )}
            </Card>
          </Col>
          <Col xs={24} lg={12}>
            <Card title="套餐销量 Top 5" extra={<Link to="/plans">套餐管理</Link>} size="small">
              {rangeLoading ? <Skeleton active paragraph={{ rows: 4 }} /> : (
                planSales.length === 0 ? <Empty text="该区间暂无成交订单" /> : (
                  <Space direction="vertical" style={{ width: '100%' }} size={12}>
                    {planSales.map((s, idx) => {
                      const max = planSales[0]?.count || 1;
                      const percent = Math.round((s.count / max) * 100);
                      return (
                        <RankRow key={s.plan} rank={idx} name={s.plan}
                          right={`${s.count} 单 · ${fmtMoney(s.amount)}`} percent={percent} />
                      );
                    })}
                  </Space>
                )
              )}
            </Card>
          </Col>
        </Row>
      </Section>

      {/* 近期动态 */}
      <Section title="近期动态">
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={12}>
            <Card title="最近订单" extra={<Link to="/orders">查看全部</Link>} size="small">
              <Table
                size="small" pagination={false} loading={recentLoading} dataSource={recentOrders}
                rowKey="id" locale={{ emptyText: '暂无订单' }}
                columns={[
                  {
                    title: '订单 / 用户', dataIndex: 'order_no', ellipsis: true,
                    render: (v: string, r: OrderRow) => (
                      <Space direction="vertical" size={0} style={{ lineHeight: 1.4 }}>
                        <Typography.Text style={{ fontFamily: 'monospace', fontSize: 12 }} ellipsis={{ tooltip: v }}>{v}</Typography.Text>
                        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                          {r.user?.nickname || r.user?.username || `用户#${r.user_id}`}
                        </Typography.Text>
                      </Space>
                    ),
                  },
                  { title: '套餐', dataIndex: 'plan', width: 110, ellipsis: true, render: (_: any, r: OrderRow) => r.plan?.name || `#${r.plan_id}` },
                  { title: '金额', dataIndex: 'amount', width: 90, render: (v: any) => fmtMoney(v) },
                  {
                    title: '状态 / 时间', dataIndex: 'status', width: 110,
                    render: (_: any, r: OrderRow) => {
                      const k = r.derived_status || r.status;
                      const t = STATUS_LABEL[k] || { color: 'default', label: k };
                      return (
                        <Space direction="vertical" size={0} style={{ lineHeight: 1.4 }}>
                          <Tag color={t.color} style={{ marginRight: 0 }}>{t.label}</Tag>
                          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                            {r.created_at ? dayjs(r.created_at).format('MM-DD HH:mm') : '-'}
                          </Typography.Text>
                        </Space>
                      );
                    },
                  },
                ]}
              />
            </Card>
          </Col>
          <Col xs={24} lg={12}>
            <Card title="最近注册用户" extra={<Link to="/users">用户管理</Link>} size="small">
              <Table
                size="small" pagination={false} loading={recentLoading} dataSource={recentUsers}
                rowKey="id" locale={{ emptyText: '暂无用户' }}
                columns={[
                  {
                    title: '用户', dataIndex: 'username',
                    render: (_: any, r: UserRow) => (
                      <Space>
                        <Typography.Text strong>{r.nickname || r.username}</Typography.Text>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>#{r.id}</Typography.Text>
                      </Space>
                    ),
                  },
                  {
                    title: '状态', dataIndex: 'status', width: 90,
                    render: (v?: string) => v === 'disabled' ? <Tag color="red">已禁用</Tag> : <Tag color="green">正常</Tag>,
                  },
                  { title: '注册时间', dataIndex: 'created_at', width: 130, render: (v: string) => v ? dayjs(v).format('MM-DD HH:mm') : '-' },
                ]}
              />
            </Card>
          </Col>
        </Row>
      </Section>
    </div>
  );
}

/* ============================ 子组件 ============================ */

/** 分区容器：标题 + 说明 + 右侧操作 */
function Section({ title, desc, extra, children }: {
  title: string; desc?: string; extra?: ReactNode; children: ReactNode;
}) {
  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
        <Typography.Text strong style={{ fontSize: 15, color: C.text }}>{title}</Typography.Text>
        {desc && <Typography.Text type="secondary" style={{ fontSize: 12 }}>{desc}</Typography.Text>}
        <div style={{ flex: 1 }} />
        {extra && <span style={{ fontSize: 13 }}>{extra}</span>}
      </div>
      {children}
    </div>
  );
}

/** 指标卡：标题 + 数值 +（环比 或 副文本）。无图标方块，强调数据本身。 */
function StatCard({ title, value, prev, hint, money, suffix, precision = 0, accent, loading }: {
  title: string;
  value: number;
  prev?: number;
  hint?: ReactNode;
  money?: boolean;
  suffix?: string;
  precision?: number;
  accent?: boolean;
  loading?: boolean;
}) {
  const display = money ? fmtMoney(value) : (precision > 0 ? Number(value).toFixed(precision) : fmtInt(value));
  return (
    <Card styles={{ body: { padding: 16 } }} loading={loading}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>{title}</Typography.Text>
      <div style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.3, marginTop: 4, color: accent ? C.primary : C.text }}>
        {display}{suffix ? <span style={{ fontSize: 13, fontWeight: 400, color: C.sub }}>{suffix}</span> : null}
      </div>
      <div style={{ marginTop: 6, minHeight: 18 }}>
        {prev !== undefined ? <TrendText value={value} prev={prev} money={money} /> : (
          hint ? <Typography.Text type="secondary" style={{ fontSize: 12 }}>{hint}</Typography.Text> : null
        )}
      </div>
    </Card>
  );
}

/** 环比趋势文本 */
function TrendText({ value, prev, money }: { value: number; prev: number; money?: boolean }) {
  const diff = value - prev;
  const percent = prev > 0 ? Math.round((diff / prev) * 100) : (value > 0 ? 100 : 0);
  const isUp = diff > 0, isDown = diff < 0;
  const color = isUp ? C.up : isDown ? C.down : C.sub;
  const Icon = isUp ? ArrowUpOutlined : isDown ? ArrowDownOutlined : null;
  const diffStr = money ? fmtMoney(Math.abs(diff)) : fmtInt(Math.abs(diff));
  return (
    <Typography.Text style={{ fontSize: 12, color: C.sub }}>
      较昨日{' '}
      <span style={{ color, fontWeight: 500 }}>
        {Icon ? <Icon style={{ marginRight: 2, fontSize: 11 }} /> : null}
        {diff === 0 ? '持平' : `${diffStr}（${isUp ? '+' : isDown ? '-' : ''}${Math.abs(percent)}%）`}
      </span>
    </Typography.Text>
  );
}

/** 可点击的紧凑总量卡 */
function MiniLinkCard({ to, title, value, loading }: { to: string; title: string; value: number; loading?: boolean }) {
  return (
    <Link to={to} style={{ display: 'block' }}>
      <Card size="small" hoverable styles={{ body: { padding: 12 } }} loading={loading}>
        <Typography.Text type="secondary" style={{ fontSize: 11 }}>{title}</Typography.Text>
        <div style={{ fontSize: 18, fontWeight: 600, lineHeight: 1.3, marginTop: 2, color: C.text }}>
          {fmtInt(value)}
        </div>
      </Card>
    </Link>
  );
}

/** AIGC 业务卡：标题（可跳转）+ 一组小指标 */
function BizCard({ title, to, metrics, loading }: {
  title: string; to?: string; loading?: boolean;
  metrics: { label: string; value: string; accent?: boolean }[];
}) {
  const head = to
    ? <Link to={to} style={{ color: C.text }}>{title}</Link>
    : <span style={{ color: C.text }}>{title}</span>;
  return (
    <Card size="small" title={head} loading={loading} styles={{ body: { padding: 16 } }}>
      <Row gutter={[8, 12]}>
        {metrics.map((m) => (
          <Col span={metrics.length <= 1 ? 24 : 12} key={m.label}>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>{m.label}</Typography.Text>
            <div style={{ fontSize: 18, fontWeight: 600, lineHeight: 1.3, color: m.accent ? C.primary : C.text }}>
              {m.value}
            </div>
          </Col>
        ))}
      </Row>
    </Card>
  );
}

/** 内容生态计数卡：总量 + 可选待审核 */
function CountCard({ to, title, value, pending, loading }: {
  to: string; title: string; value: number; pending?: number; loading?: boolean;
}) {
  return (
    <Link to={to} style={{ display: 'block' }}>
      <Card size="small" hoverable styles={{ body: { padding: 12 } }} loading={loading}>
        <Typography.Text type="secondary" style={{ fontSize: 11 }}>{title}</Typography.Text>
        <div style={{ fontSize: 18, fontWeight: 600, lineHeight: 1.3, marginTop: 2, color: C.text }}>
          {fmtInt(value)}
        </div>
        <div style={{ marginTop: 4, minHeight: 16 }}>
          {pending && pending > 0 ? (
            <Tag color="warning" style={{ marginInlineEnd: 0, fontSize: 11, lineHeight: '16px', padding: '0 6px' }}>
              待审核 {fmtInt(pending)}
            </Tag>
          ) : null}
        </div>
      </Card>
    </Link>
  );
}

/** 排行榜行：名次圆点（Top1 主色实心）+ 名称 + 数值 + 进度条 */
function RankRow({ rank, name, right, percent, tag }: {
  rank: number; name: string; right: string; percent: number; tag?: string;
}) {
  const isTop = rank === 0;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, gap: 8 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 20, height: 20, borderRadius: '50%',
            background: isTop ? C.primary : '#f0f0f0',
            color: isTop ? '#fff' : C.sub,
            fontSize: 11, fontWeight: 600, flexShrink: 0,
          }}>{rank + 1}</span>
          <Typography.Text strong ellipsis={{ tooltip: name }} style={{ minWidth: 0 }}>{name}</Typography.Text>
          {tag && <Tag style={{ marginLeft: 4, flexShrink: 0 }}>{tag}</Tag>}
        </span>
        <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>{right}</Typography.Text>
      </div>
      <Progress percent={percent} showInfo={false} strokeLinecap="butt" size="small"
        strokeColor={isTop ? C.primary : C.primarySoft} />
    </div>
  );
}

/** 图例小圆点 */
function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.sub }}>
      <span style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
      {label}
    </span>
  );
}

/** 空态占位 */
function Empty({ text }: { text: string }) {
  return (
    <div style={{ padding: '24px 0', textAlign: 'center' }}>
      <Typography.Text type="secondary" style={{ fontSize: 13 }}>{text}</Typography.Text>
    </div>
  );
}

/** 调用趋势图 */
function DailyChart({ data }: { data: DailyPoint[] }) {
  if (!data || data.length === 0) {
    return (
      <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography.Text type="secondary">暂无调用数据</Typography.Text>
      </div>
    );
  }
  const sum = data.reduce((s, d) => s + (d.calls || 0), 0);
  const max = data.reduce((m, d) => Math.max(m, d.calls || 0), 0);
  return (
    <div>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={data} margin={{ top: 6, right: 8, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id="callGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={C.primary} stopOpacity={0.25} />
              <stop offset="100%" stopColor={C.primary} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
          <XAxis dataKey="date" tickFormatter={(d) => dayjs(d).format('MM-DD')} interval="preserveStartEnd"
            minTickGap={28} tick={{ fontSize: 11, fill: '#999' }} axisLine={{ stroke: '#f0f0f0' }} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: '#999' }} axisLine={false} tickLine={false} allowDecimals={false} width={36} />
          <RTooltip formatter={(v: any) => [Number(v ?? 0).toLocaleString() + ' 次', '调用']}
            labelFormatter={(d) => dayjs(d).format('YYYY-MM-DD')} contentStyle={{ fontSize: 12, borderRadius: 6 }} />
          <Area type="monotone" dataKey="calls" stroke={C.primary} strokeWidth={2} fill="url(#callGradient)" />
        </AreaChart>
      </ResponsiveContainer>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 11 }}>
        <Typography.Text type="secondary" style={{ fontSize: 11 }}>{data[0]?.date}</Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
          区间合计 {sum.toLocaleString()} 次 · 峰值 {max.toLocaleString()}
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 11 }}>{data[data.length - 1]?.date}</Typography.Text>
      </div>
    </div>
  );
}
