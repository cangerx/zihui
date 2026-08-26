import { useEffect, useMemo, useState } from 'react';
import { Card, Col, Row, Statistic, Table, Tag, Tooltip, Button, Popconfirm, message, Typography, Space } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { ResponsiveContainer, BarChart, Bar, XAxis, Tooltip as RechartsTooltip } from 'recharts';
import { providerApi } from '../services/api';

/**
 * 健康看板：基于 cloud_provider_metrics 24h 聚合数据。
 *
 * 数据源：GET /admin/cloud-providers/health（CloudProviderController::health）。
 * 写入源：ProbeProviders Command 每 5 分钟跑一次基础探测（GET /models 不消耗 token），
 *        把成功/失败/延迟按小时桶 UPSERT 到 cloud_provider_metrics。
 *
 * 顶部统计：服务商总数 / 活跃数 / 熔断数 / 24h 整体可用率。
 * 表格：每行一个 provider，含 24h ok-fail 堆叠迷你柱图（按小时）。
 * 操作：recover（解除自动熔断）。
 */

interface HealthRow {
  id: number;
  name: string;
  type: string;
  status: string;
  suspended_at: string | null;
  suspended_reason: string | null;
  ok_24h: number;
  fail_24h: number;
  availability_24h: number | null;
  latency_p99_24h: number;
  latest_error: string;
  hourly: Array<{
    bucket_hour: string;
    ok_count: number;
    fail_count: number;
    latency_ms_p99: number;
  }>;
}

interface HealthSummary {
  total: number;
  active: number;
  suspended: number;
  availability_24h: number | null;
  samples_24h: number;
  window_started_at: string;
}

/**
 * 用整 24 小时填充 hourly 数据（缺失桶补 0），让所有 provider 的图横轴一致。
 */
function fillHourlyBuckets(hourly: HealthRow['hourly']): HealthRow['hourly'] {
  const map = new Map<string, HealthRow['hourly'][number]>();
  for (const h of hourly) {
    map.set(dayjs(h.bucket_hour).format('YYYY-MM-DD HH:00:00'), h);
  }
  const result: HealthRow['hourly'] = [];
  const start = dayjs().subtract(23, 'hour').startOf('hour');
  for (let i = 0; i < 24; i++) {
    const t = start.add(i, 'hour');
    const k = t.format('YYYY-MM-DD HH:00:00');
    const hit = map.get(k);
    result.push(hit ?? {
      bucket_hour:    k,
      ok_count:       0,
      fail_count:     0,
      latency_ms_p99: 0,
    });
  }
  return result;
}

/**
 * 可用率徽章颜色：≥99% 绿、≥95% 蓝、≥80% 橙、<80% 红、N/A 灰。
 */
function availabilityColor(v: number | null): string {
  if (v === null) return 'default';
  if (v >= 99) return 'green';
  if (v >= 95) return 'blue';
  if (v >= 80) return 'orange';
  return 'red';
}

export default function Health() {
  const [summary, setSummary] = useState<HealthSummary | null>(null);
  const [rows, setRows] = useState<HealthRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await providerApi.health();
      setSummary(res.data?.summary ?? null);
      setRows(res.data?.providers ?? []);
    } catch (err: any) {
      message.error(err?.response?.data?.error || '加载健康数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // 30 秒自动刷新（探测器是 5 分钟 1 次，30s 刷新足够看到新数据）
  useEffect(() => {
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  const handleRecover = async (id: number, reactivateCredentials: boolean) => {
    try {
      await providerApi.recover(id, reactivateCredentials);
      message.success(reactivateCredentials ? '已解除熔断并重置凭证池' : '已解除熔断');
      load();
    } catch (err: any) {
      message.error(err?.response?.data?.error || '解除熔断失败');
    }
  };

  const enrichedRows = useMemo(() => rows.map(r => ({
    ...r,
    hourly_filled: fillHourlyBuckets(r.hourly),
    is_suspended: !!r.suspended_at,
    samples_24h:  r.ok_24h + r.fail_24h,
  })), [rows]);

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    {
      title: '服务商', dataIndex: 'name', width: 200,
      render: (v: string, r: HealthRow & { is_suspended: boolean }) => (
        <Space direction="vertical" size={2}>
          <span style={{ fontWeight: 500 }}>{v}</span>
          <span style={{ fontSize: 11, color: '#999' }}>{r.type}</span>
        </Space>
      ),
    },
    {
      title: '状态', dataIndex: 'status', width: 110,
      render: (_: any, r: HealthRow & { is_suspended: boolean }) => {
        if (r.is_suspended) {
          return (
            <Tooltip title={r.suspended_reason || ''}>
              <Tag color="red">已熔断</Tag>
            </Tooltip>
          );
        }
        return r.status === 'active'
          ? <Tag color="green">正常</Tag>
          : <Tag color="default">禁用</Tag>;
      },
    },
    {
      title: '24h 可用率', dataIndex: 'availability_24h', width: 120,
      sorter: (a: any, b: any) => (a.availability_24h ?? -1) - (b.availability_24h ?? -1),
      render: (v: number | null) => v === null
        ? <Typography.Text type="secondary" style={{ fontSize: 12 }}>无数据</Typography.Text>
        : <Tag color={availabilityColor(v)}>{v.toFixed(2)}%</Tag>,
    },
    {
      title: '24h 样本', dataIndex: 'samples_24h', width: 100,
      render: (_: any, r: any) => (
        <Tooltip title={`成功 ${r.ok_24h}，失败 ${r.fail_24h}`}>
          <span>{r.samples_24h}</span>
        </Tooltip>
      ),
    },
    {
      title: 'P99 延迟', dataIndex: 'latency_p99_24h', width: 100,
      render: (v: number) => v > 0
        ? <span>{v} ms</span>
        : <Typography.Text type="secondary" style={{ fontSize: 12 }}>-</Typography.Text>,
    },
    {
      title: '24h 趋势', width: 200,
      render: (_: any, r: any) => (
        <div style={{ height: 40, width: 180 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={r.hourly_filled} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
              <XAxis dataKey="bucket_hour" hide />
              <RechartsTooltip
                cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                contentStyle={{ fontSize: 11, padding: 6 }}
                labelFormatter={(label) => dayjs(String(label)).format('MM-DD HH:00')}
              />
              <Bar dataKey="ok_count"   stackId="a" fill="#52c41a" />
              <Bar dataKey="fail_count" stackId="a" fill="#ff4d4f" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ),
    },
    {
      title: '最近错误', dataIndex: 'latest_error', ellipsis: true,
      render: (v: string) => v
        ? <Tooltip title={v}><Typography.Text type="danger" style={{ fontSize: 12 }}>{v}</Typography.Text></Tooltip>
        : <span style={{ color: '#ccc' }}>-</span>,
    },
    {
      title: '操作', width: 200,
      render: (_: any, r: HealthRow & { is_suspended: boolean }) => (
        r.is_suspended ? (
          <Space size="small">
            <Popconfirm
              title="确认解除熔断？"
              description="服务商重新参与路由"
              onConfirm={() => handleRecover(r.id, false)}
            >
              <Button size="small" type="primary">恢复</Button>
            </Popconfirm>
            <Popconfirm
              title="解除熔断 + 重置凭证池？"
              description="所有 invalid 凭证 fail_count 归零并恢复 active"
              onConfirm={() => handleRecover(r.id, true)}
            >
              <Button size="small">完整恢复</Button>
            </Popconfirm>
          </Space>
        ) : <Typography.Text type="secondary" style={{ fontSize: 12 }}>-</Typography.Text>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>健康看板</Typography.Title>
        <Space>
          {summary && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              数据窗口：{dayjs(summary.window_started_at).format('MM-DD HH:00')} 至今
            </Typography.Text>
          )}
          <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
        </Space>
      </div>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card>
            <Statistic title="服务商总数" value={summary?.total ?? 0} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="活跃" value={summary?.active ?? 0} valueStyle={{ color: '#52c41a' }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="已熔断"
              value={summary?.suspended ?? 0}
              valueStyle={{ color: (summary?.suspended ?? 0) > 0 ? '#ff4d4f' : undefined }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="24h 整体可用率"
              value={summary?.availability_24h !== null && summary?.availability_24h !== undefined ? summary.availability_24h : '-'}
              suffix={summary?.availability_24h !== null && summary?.availability_24h !== undefined ? '%' : ''}
              precision={2}
              valueStyle={{ color: availabilityColor(summary?.availability_24h ?? null) === 'red' ? '#ff4d4f' : '#1677ff' }}
            />
            <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>样本 {summary?.samples_24h ?? 0}</div>
          </Card>
        </Col>
      </Row>

      <Table
        rowKey="id"
        dataSource={enrichedRows}
        columns={columns as any}
        loading={loading}
        size="small"
        pagination={false}
      />

      <div style={{ marginTop: 12, fontSize: 12, color: '#999' }}>
        探测器每 5 分钟跑一次 GET /models（不消耗 token）。连续失败到阈值会自动熔断；网关同时跳过该服务商，可在此页或服务商列表手动恢复。
      </div>
    </div>
  );
}
