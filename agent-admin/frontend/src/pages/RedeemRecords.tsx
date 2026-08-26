import { useEffect, useState } from 'react';
import { Table, Tag, Input, Space, message } from 'antd';
import { redeemApi } from '../services/api';
import { useCurrencyLabels } from '../contexts/CurrencyContext';
import { useUrlSyncedParams } from '../hooks/useUrlSyncedParams';
import dayjs from 'dayjs';

export default function RedeemRecordsPage() {
  const { labels } = useCurrencyLabels();
  const [data, setData] = useState<any>({ data: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [params, setParams] = useUrlSyncedParams<Record<string, any>>({ page: 1, per_page: 50 });

  const load = async () => {
    setLoading(true);
    try {
      const res = await redeemApi.records(params);
      setData(res.data);
    } catch { message.error('加载失败'); }
    setLoading(false);
  };

  useEffect(() => { load(); }, [params]);

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    {
      title: '兑换时间', dataIndex: 'created_at', width: 160,
      render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-',
    },
    {
      title: '用户', dataIndex: ['user'], width: 160,
      render: (u: any, r: any) => u
        ? <span>{u.nickname || u.username} <span style={{ color: '#999' }}>#{r.user_id}</span></span>
        : `#${r.user_id}`,
    },
    {
      title: '兑换码', dataIndex: ['code'], width: 200,
      render: (c: any) => c
        ? <span style={{ fontFamily: 'monospace' }}>{c.code}</span>
        : '-',
    },
    {
      title: '类型', dataIndex: ['code', 'type'], width: 80,
      render: (v: string) => v ? <Tag>{v}</Tag> : '-',
    },
    {
      title: '奖励快照', dataIndex: 'reward_snapshot_json',
      render: (v: any) => {
        const g = v?.granted || {};
        return (
          <Space size={4} wrap>
            {(g.token ?? 0) > 0 && <Tag color="orange">{labels.token} +{g.token}</Tag>}
            {(g.credit ?? 0) > 0 && <Tag color="purple">{labels.credit} +{g.credit}</Tag>}
            {g.plan_id && <Tag color="geekblue">套餐 #{g.plan_id}{g.plan_pending ? ' (待开通)' : ''}</Tag>}
          </Space>
        );
      },
    },
    { title: 'IP', dataIndex: 'ip', width: 120, render: (v: string) => v || '-' },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space>
          <Input placeholder="用户 ID" allowClear style={{ width: 120 }}
            defaultValue={params.user_id ?? ''}
            onPressEnter={(e) => setParams({ ...params, user_id: (e.target as HTMLInputElement).value || undefined, page: 1 })} />
          <Input placeholder="兑换码 ID" allowClear style={{ width: 120 }}
            defaultValue={params.code_id ?? ''}
            onPressEnter={(e) => setParams({ ...params, code_id: (e.target as HTMLInputElement).value || undefined, page: 1 })} />
        </Space>
      </div>

      <Table columns={columns as any} dataSource={data.data} rowKey="id" loading={loading}
        pagination={{ current: params.page, pageSize: params.per_page, total: data.total,
          onChange: (p, ps) => setParams({ ...params, page: p, per_page: ps }) }}
        size="small" />
    </div>
  );
}
