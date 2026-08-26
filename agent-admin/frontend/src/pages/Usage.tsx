import { useEffect, useState } from 'react';
import { Table, Tag, Select, DatePicker, Card, Row, Col, Statistic } from 'antd';
import { usageApi, userApi, modelApi } from '../services/api';
import { useCurrencyLabels } from '../contexts/CurrencyContext';
import { useUrlSyncedParams } from '../hooks/useUrlSyncedParams';
import dayjs from 'dayjs';

const { RangePicker } = DatePicker;

export default function Usage() {
  const { labels } = useCurrencyLabels();
  const [data, setData] = useState<any>({ data: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [params, setParams] = useUrlSyncedParams<Record<string, any>>({ page: 1, per_page: 50 });
  const [stats, setStats] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [models, setModels] = useState<any[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const [res, statsRes] = await Promise.all([
        usageApi.list(params),
        usageApi.stats(params),
      ]);
      setData(res.data);
      setStats(statsRes.data);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, [params]);
  useEffect(() => {
    Promise.all([
      userApi.list({ per_page: 500 }),
      modelApi.list({ per_page: 500 }),
    ]).then(([u, m]) => {
      setUsers(u.data.data || []);
      setModels(m.data.data || []);
    });
  }, []);

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: '用户', dataIndex: ['user', 'username'] },
    { title: '模型', dataIndex: ['cloud_model', 'name'], render: (_v: string, r: any) => {
      const cm = r.cloud_model;
      if (!cm) return '-';
      const base = cm.name || cm.model_id;
      return cm.provider?.name ? `${cm.provider.name} / ${base}` : base;
    }},
    { title: '类型', dataIndex: 'type', render: (v: string) => <Tag>{v}</Tag> },
    { title: 'Tokens', dataIndex: 'total_tokens', render: (v: number) => v > 0 ? v.toLocaleString() : '-' },
    { title: '消耗', dataIndex: 'cost', render: (v: string, r: any) => {
      const val = Number(v);
      if (val <= 0) return '-';
      return r.balance_type === 'credit' ? `${val.toFixed(4)} ${labels.credit}` : `${val.toFixed(4)} ${labels.token}`;
    }},
    { title: '状态', dataIndex: 'status', render: (v: string) => <Tag color={v === 'success' ? 'green' : 'red'}>{v === 'success' ? '成功' : '失败'}</Tag> },
    { title: '时间', dataIndex: 'created_at', render: (v: string) => dayjs(v).format('MM-DD HH:mm') },
  ];

  return (
    <div>
      {stats && (
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col span={6}><Card size="small"><Statistic title="总调用次数" value={stats.total_calls} /></Card></Col>
          <Col span={6}><Card size="small"><Statistic title="总 Tokens" value={stats.total_tokens?.toLocaleString()} /></Card></Col>
          <Col span={6}><Card size="small"><Statistic title={`${labels.token}消耗`} value={Number(stats.total_token_cost || 0).toFixed(4)} /></Card></Col>
          <Col span={6}><Card size="small"><Statistic title={`${labels.credit}消耗`} value={Number(stats.total_credits || 0).toFixed(4)} /></Card></Col>
        </Row>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <Select placeholder="用户" allowClear style={{ width: 180 }} showSearch optionFilterProp="label"
          value={params.user_id}
          options={users.map(u => ({ value: u.id, label: `${u.username} (${u.nickname})` }))}
          onChange={(v) => setParams({ ...params, user_id: v, page: 1 })} />
        <Select placeholder="模型" allowClear style={{ width: 260 }} showSearch optionFilterProp="label"
          value={params.cloud_model_id}
          options={models.map(m => ({
            value: m.id,
            label: m.provider?.name ? `${m.provider.name} / ${m.name}` : m.name,
          }))}
          onChange={(v) => setParams({ ...params, cloud_model_id: v, page: 1 })} />
        <Select placeholder="类型" allowClear style={{ width: 120 }}
          value={params.type}
          options={[{ value: 'chat', label: '对话' }, { value: 'image', label: '图像' }, { value: 'embedding', label: '向量' }]}
          onChange={(v) => setParams({ ...params, type: v, page: 1 })} />
        <Select placeholder="状态" allowClear style={{ width: 120 }}
          value={params.status}
          options={[{ value: 'success', label: '成功' }, { value: 'failed', label: '失败' }]}
          onChange={(v) => setParams({ ...params, status: v, page: 1 })} />
        <RangePicker
          value={params.start_date && params.end_date
            ? [dayjs(params.start_date), dayjs(params.end_date)]
            : undefined}
          onChange={(dates) => {
            if (dates && dates[0] && dates[1]) {
              setParams({ ...params, start_date: dates[0].format('YYYY-MM-DD'), end_date: dates[1].format('YYYY-MM-DD'), page: 1 });
            } else {
              const { start_date, end_date, ...rest } = params;
              setParams({ ...rest, page: 1 });
            }
          }} />
      </div>

      <Table columns={columns} dataSource={data.data} rowKey="id" loading={loading}
        pagination={{ current: params.page, pageSize: params.per_page, total: data.total,
          onChange: (p, ps) => setParams({ ...params, page: p, per_page: ps }) }}
        size="small" />
    </div>
  );
}
