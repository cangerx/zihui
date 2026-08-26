import { useEffect, useState } from 'react';
import {
  Table, Button, Space, Tag, Modal, Form, Input, InputNumber, Select,
  DatePicker, message, Popconfirm, Tooltip,
} from 'antd';
import { PlusOutlined, AppstoreAddOutlined, CopyOutlined, DownloadOutlined } from '@ant-design/icons';
import { redeemApi, planApi } from '../services/api';
import BatchDeleteButton from '../components/BatchDeleteButton';
import { useCurrencyLabels, type CurrencyLabels } from '../contexts/CurrencyContext';
import dayjs, { Dayjs } from 'dayjs';

interface RedeemCode {
  id: number;
  code: string;
  type: string;
  reward_json: { token?: number; credit?: number; plan_id?: number | null };
  max_uses: number;
  used_count: number;
  per_user_limit: number;
  starts_at: string | null;
  expires_at: string | null;
  status: string;
  batch_id: string | null;
  remark: string;
  created_at: string;
}

function buildTypeLabel(labels: CurrencyLabels): Record<string, { label: string; color: string }> {
  return {
    balance: { label: labels.token, color: 'orange' },
    credit:  { label: labels.credit, color: 'purple' },
    plan:    { label: '套餐', color: 'geekblue' },
    bundle:  { label: '组合', color: 'cyan' },
  };
}

interface PlanOption {
  id: number;
  code: string;
  name: string;
  status: string;
}

export default function RedeemCodesPage() {
  const { labels } = useCurrencyLabels();
  const TYPE_LABEL = buildTypeLabel(labels);
  const [data, setData] = useState<any>({ data: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [params, setParams] = useState<Record<string, any>>({ page: 1, per_page: 50 });
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [singleOpen, setSingleOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [generatedOpen, setGeneratedOpen] = useState(false);
  const [generatedCodes, setGeneratedCodes] = useState<string[]>([]);
  const [generatedBatchId, setGeneratedBatchId] = useState('');
  const [singleForm] = Form.useForm();
  const [batchForm] = Form.useForm();
  const [selectedKeys, setSelectedKeys] = useState<number[]>([]);
  const singleType = Form.useWatch('type', singleForm);
  const batchType = Form.useWatch('type', batchForm);

  const load = async () => {
    setLoading(true);
    try {
      const res = await redeemApi.list(params);
      setData(res.data);
    } catch { message.error('加载失败'); }
    setLoading(false);
  };

  useEffect(() => { load(); }, [params]);

  useEffect(() => {
    planApi.list({ per_page: 500 })
      .then(res => setPlans((res.data?.data || []) as PlanOption[]))
      .catch(() => setPlans([]));
  }, []);

  const handleCreateSingle = async () => {
    const values = await singleForm.validateFields();
    const payload = normalizePayload(values);
    try {
      await redeemApi.create(payload);
      message.success('已创建');
      setSingleOpen(false);
      singleForm.resetFields();
      load();
    } catch (err: any) {
      message.error(err.response?.data?.error || '创建失败');
    }
  };

  const handleBatch = async () => {
    const values = await batchForm.validateFields();
    const payload = normalizePayload(values);
    try {
      const res = await redeemApi.batchGenerate(payload);
      setGeneratedCodes(res.data.codes || []);
      setGeneratedBatchId(res.data.batch_id || '');
      setBatchOpen(false);
      setGeneratedOpen(true);
      batchForm.resetFields();
      load();
    } catch (err: any) {
      message.error(err.response?.data?.error || '生成失败');
    }
  };

  const handleToggleStatus = async (row: RedeemCode) => {
    try {
      await redeemApi.update(row.id, { status: row.status === 'active' ? 'disabled' : 'active' });
      message.success('已更新');
      load();
    } catch { message.error('更新失败'); }
  };

  const handleDelete = async (row: RedeemCode) => {
    try {
      await redeemApi.delete(row.id);
      message.success('已删除');
      load();
    } catch { message.error('删除失败'); }
  };

  const copyAll = () => {
    navigator.clipboard.writeText(generatedCodes.join('\n'));
    message.success('已复制全部兑换码');
  };

  const downloadCsv = () => {
    const csv = ['code'].concat(generatedCodes).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `redeem-${generatedBatchId || 'codes'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    {
      title: '兑换码', dataIndex: 'code', width: 180,
      render: (v: string) => (
        <span style={{ fontFamily: 'monospace' }}>
          {v}
          <Tooltip title="复制">
            <Button size="small" type="text" icon={<CopyOutlined />}
              onClick={() => { navigator.clipboard.writeText(v); message.success('已复制'); }} />
          </Tooltip>
        </span>
      ),
    },
    {
      title: '类型', dataIndex: 'type', width: 80,
      render: (v: string) => {
        const t = TYPE_LABEL[v] || { label: v, color: 'default' };
        return <Tag color={t.color}>{t.label}</Tag>;
      },
    },
    {
      title: '奖励', dataIndex: 'reward_json',
      render: (v: any) => (
        <Space size={4} wrap>
          {v?.token > 0 && <Tag color="orange">{labels.token} +{v.token}</Tag>}
          {v?.credit > 0 && <Tag color="purple">{labels.credit} +{v.credit}</Tag>}
          {v?.plan_id && <Tag color="geekblue">套餐 #{v.plan_id}</Tag>}
        </Space>
      ),
    },
    {
      title: '使用', width: 100,
      render: (_: any, r: RedeemCode) => (
        <span>{r.used_count}/{r.max_uses === 0 ? '∞' : r.max_uses}</span>
      ),
    },
    {
      title: '每人限次', dataIndex: 'per_user_limit', width: 90,
      render: (v: number) => v === 0 ? '不限' : v,
    },
    {
      title: '有效期', width: 180,
      render: (_: any, r: RedeemCode) => (
        <span style={{ fontSize: 12, color: '#666' }}>
          {r.starts_at ? dayjs(r.starts_at).format('YY-MM-DD') : '-'}
          <span style={{ margin: '0 4px' }}>→</span>
          {r.expires_at ? dayjs(r.expires_at).format('YY-MM-DD') : '永久'}
        </span>
      ),
    },
    {
      title: '状态', dataIndex: 'status', width: 80,
      render: (v: string) => <Tag color={v === 'active' ? 'green' : 'red'}>{v === 'active' ? '启用' : '禁用'}</Tag>,
    },
    { title: '批次', dataIndex: 'batch_id', width: 140, ellipsis: true, render: (v: string) => v || '-' },
    {
      title: '操作', width: 160,
      render: (_: any, r: RedeemCode) => (
        <Space size={4}>
          <Button size="small" onClick={() => handleToggleStatus(r)}>
            {r.status === 'active' ? '禁用' : '启用'}
          </Button>
          <Popconfirm title="确认删除？删除后记录保留" onConfirm={() => handleDelete(r)}>
            <Button size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space>
          <Input.Search placeholder="搜索兑换码" allowClear style={{ width: 200 }}
            onSearch={(v) => setParams({ ...params, code: v || undefined, page: 1 })} />
          <Select placeholder="类型" allowClear style={{ width: 120 }}
            options={Object.entries(TYPE_LABEL).map(([v, t]) => ({ value: v, label: t.label }))}
            onChange={(v) => setParams({ ...params, type: v, page: 1 })} />
          <Select placeholder="状态" allowClear style={{ width: 120 }}
            options={[{ value: 'active', label: '启用' }, { value: 'disabled', label: '禁用' }]}
            onChange={(v) => setParams({ ...params, status: v, page: 1 })} />
        </Space>
        <Space>
          <BatchDeleteButton
            selectedKeys={selectedKeys}
            onClear={() => setSelectedKeys([])}
            batchDelete={redeemApi.batchDelete}
            onDone={load}
            itemName="兑换码"
          />
          <Button icon={<PlusOutlined />} onClick={() => { singleForm.resetFields(); setSingleOpen(true); }}>
            单条创建
          </Button>
          <Button type="primary" icon={<AppstoreAddOutlined />} onClick={() => { batchForm.resetFields(); setBatchOpen(true); }}>
            批量生成
          </Button>
        </Space>
      </div>

      <Table columns={columns as any} dataSource={data.data} rowKey="id" loading={loading}
        rowSelection={{
          selectedRowKeys: selectedKeys,
          onChange: (keys) => setSelectedKeys(keys as number[]),
        }}
        pagination={{ current: params.page, pageSize: params.per_page, total: data.total,
          onChange: (p, ps) => setParams({ ...params, page: p, per_page: ps }) }}
        size="small" />

      {/* Single create modal */}
      <Modal title="创建兑换码" open={singleOpen}
        onOk={handleCreateSingle} onCancel={() => setSingleOpen(false)} destroyOnClose width={500}
        mask={false}>
        <SharedFormFields form={singleForm} type={singleType} plans={plans} allowCustomCode />
      </Modal>

      {/* Batch generate modal */}
      <Modal title="批量生成" open={batchOpen}
        onOk={handleBatch} onCancel={() => setBatchOpen(false)} destroyOnClose width={520}
        mask={false}>
        <SharedFormFields form={batchForm} type={batchType} plans={plans} batchMode />
      </Modal>

      {/* Generated codes viewer */}
      <Modal title={`已生成 ${generatedCodes.length} 个兑换码`} open={generatedOpen}
        onCancel={() => setGeneratedOpen(false)} width={600} mask={false}
        footer={[
          <Button key="copy" icon={<CopyOutlined />} onClick={copyAll}>复制全部</Button>,
          <Button key="csv" type="primary" icon={<DownloadOutlined />} onClick={downloadCsv}>下载 CSV</Button>,
        ]}>
        <div style={{ marginBottom: 8, fontSize: 12, color: '#666' }}>
          批次: <span style={{ fontFamily: 'monospace' }}>{generatedBatchId}</span>
        </div>
        <Input.TextArea value={generatedCodes.join('\n')} autoSize={{ minRows: 8, maxRows: 16 }}
          readOnly style={{ fontFamily: 'monospace', fontSize: 12 }} />
      </Modal>
    </div>
  );
}

interface SharedFieldsProps {
  form: any;
  type: string;
  plans: PlanOption[];
  batchMode?: boolean;
  allowCustomCode?: boolean;
}

function SharedFormFields({ form, type, plans, batchMode, allowCustomCode }: SharedFieldsProps) {
  const { labels } = useCurrencyLabels();
  const TYPE_LABEL = buildTypeLabel(labels);
  const planOptions = plans
    .filter(p => p.status === 'active')
    .map(p => ({ value: p.id, label: `${p.name} (#${p.id} · ${p.code})` }));
  return (
    <Form form={form} layout="vertical" initialValues={{
      type: 'bundle', max_uses: 1, per_user_limit: 1, length: 12, count: 10,
    }}>
      {batchMode && (
        <>
          <Form.Item name="count" label="生成数量" rules={[{ required: true }]}>
            <InputNumber min={1} max={10000} step={10} style={{ width: 200 }} />
          </Form.Item>
          <Space>
            <Form.Item name="prefix" label="前缀（可选）" style={{ flex: 1 }}>
              <Input placeholder="例如 VIP" maxLength={16} style={{ width: 200 }} />
            </Form.Item>
            <Form.Item name="length" label="随机段长度">
              <InputNumber min={4} max={32} style={{ width: 100 }} />
            </Form.Item>
          </Space>
        </>
      )}

      {allowCustomCode && (
        <Form.Item name="code" label="自定义兑换码（留空自动生成）"
          tooltip="允许 4-64 个字符；大小写将被统一为大写">
          <Input maxLength={64} placeholder="例如 VIP-2026" style={{ fontFamily: 'monospace' }} />
        </Form.Item>
      )}

      <Form.Item name="type" label="类型" rules={[{ required: true }]}>
        <Select options={Object.entries(TYPE_LABEL).map(([v, t]) => ({ value: v, label: t.label }))} />
      </Form.Item>

      <Form.Item label="奖励配置" required tooltip="按类型填写对应奖励；组合类型至少填一项" style={{ marginBottom: 8 }}>
        {(type === 'balance' || type === 'credit' || type === 'bundle') && (
          <Space.Compact block>
            {(type === 'balance' || type === 'bundle') && (
              <Form.Item name={['reward', 'token']} noStyle>
                <InputNumber min={0} step={1} placeholder={labels.token} style={{ width: '50%' }} addonBefore={labels.token} />
              </Form.Item>
            )}
            {(type === 'credit' || type === 'bundle') && (
              <Form.Item name={['reward', 'credit']} noStyle>
                <InputNumber min={0} step={1} placeholder={labels.credit} style={{ width: '50%' }} addonBefore={labels.credit} />
              </Form.Item>
            )}
          </Space.Compact>
        )}
      </Form.Item>

      {(type === 'plan' || type === 'bundle') && (
        <Form.Item
          name={['reward', 'plan_id']}
          label="套餐"
          rules={type === 'plan' ? [{ required: true, message: '请选择套餐' }] : []}
        >
          <Select
            placeholder="选择套餐"
            options={planOptions}
            allowClear={type === 'bundle'}
            showSearch
            optionFilterProp="label"
            notFoundContent={plans.length === 0 ? '加载中或无可用套餐' : '无匹配套餐'}
          />
        </Form.Item>
      )}

      <Space>
        <Form.Item name="max_uses" label="总次数上限" tooltip="0 表示不限">
          <InputNumber min={0} style={{ width: 160 }} />
        </Form.Item>
        <Form.Item name="per_user_limit" label="每人限次" tooltip="0 表示不限">
          <InputNumber min={0} style={{ width: 160 }} />
        </Form.Item>
      </Space>

      <Space>
        <Form.Item name="starts_at" label="生效时间"
          getValueFromEvent={(v: Dayjs | null) => v ? v.toISOString() : undefined}
          getValueProps={(v?: string) => ({ value: v ? dayjs(v) : undefined })}>
          <DatePicker showTime format="YYYY-MM-DD HH:mm" />
        </Form.Item>
        <Form.Item name="expires_at" label="过期时间"
          getValueFromEvent={(v: Dayjs | null) => v ? v.toISOString() : undefined}
          getValueProps={(v?: string) => ({ value: v ? dayjs(v) : undefined })}>
          <DatePicker showTime format="YYYY-MM-DD HH:mm" />
        </Form.Item>
      </Space>

      <Form.Item name="remark" label="备注">
        <Input.TextArea rows={2} maxLength={500} />
      </Form.Item>
    </Form>
  );
}

function normalizePayload(v: any) {
  const out: any = { ...v };
  out.reward = v.reward || {};
  return out;
}
