import { useEffect, useState } from 'react';
import { Table, Button, Space, Tag, Modal, Form, Select, Input, InputNumber, message, Popconfirm, Alert, Radio } from 'antd';
import { PlusOutlined, EditOutlined } from '@ant-design/icons';
import { billingApi, modelApi, userApi, groupApi } from '../services/api';
import { useCurrencyLabels } from '../contexts/CurrencyContext';
import CurrencyTag from '../components/CurrencyTag';
import BatchDeleteButton from '../components/BatchDeleteButton';

type Scope = 'default' | 'batch';

export default function Billing() {
  const [data, setData] = useState<any>({ data: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [params, setParams] = useState<Record<string, any>>({ page: 1, per_page: 50 });
  const [modalOpen, setModalOpen] = useState(false);
  const [models, setModels] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();
  const [selectedKeys, setSelectedKeys] = useState<number[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const scope: Scope = Form.useWatch('scope', form) || 'default';
  const billingType = Form.useWatch('billing_type', form);
  const selectedModelId = Form.useWatch('cloud_model_id', form);
  const userIds: number[] = Form.useWatch('user_ids', form) || [];
  const groupIds: number[] = Form.useWatch('group_ids', form) || [];
  const { labels } = useCurrencyLabels();
  const typeOptions = [{ value: 'token', label: labels.token }, { value: 'credit', label: labels.credit }];
  const selectedModel = models.find((m: any) => Number(m.id) === Number(selectedModelId))
    || data.data?.find((r: any) => Number(r.cloud_model_id) === Number(selectedModelId))?.cloud_model;
  const useTokenPricingFields = billingType === 'token' || (billingType === 'credit' && selectedModel?.type === 'chat');
  const useCreditPerCallField = billingType === 'credit' && selectedModel?.type && selectedModel.type !== 'chat';
  const tokenPricingLabel = billingType === 'credit' ? labels.credit : labels.token;

  const load = async () => {
    setLoading(true);
    try { const res = await billingApi.list(params); setData(res.data); } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, [params]);
  useEffect(() => {
    Promise.all([
      modelApi.list({ per_page: 500 }),
      userApi.list({ per_page: 500 }),
      groupApi.list({ per_page: 500 }),
    ]).then(([m, u, g]) => {
      setModels(m.data.data || []);
      setUsers(u.data.data || []);
      setGroups(g.data.data || []);
    });
  }, []);

  const openEdit = (record: any) => {
    setEditingId(record.id);
    form.resetFields();
    form.setFieldsValue({
      scope: record.target_type === 'default' ? 'default' : 'batch',
      cloud_model_id: record.cloud_model_id,
      billing_type: record.billing_type,
      input_price: Number(record.input_price) || undefined,
      output_price: Number(record.output_price) || undefined,
      credit_per_call: Number(record.credit_per_call) || undefined,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    const values = await form.validateFields();
    const targetModel = models.find((m: any) => Number(m.id) === Number(values.cloud_model_id))
      || data.data?.find((r: any) => Number(r.cloud_model_id) === Number(values.cloud_model_id))?.cloud_model;
    const hasInputOutputPricing = values.billing_type === 'token' || (values.billing_type === 'credit' && targetModel?.type === 'chat');
    const hasCreditPerCallPricing = values.billing_type === 'credit' && targetModel?.type && targetModel.type !== 'chat';
    const keepExistingPricing = values.billing_type === 'credit' && !targetModel?.type;
    const billingFields = {
      billing_type: values.billing_type,
      input_price: (hasInputOutputPricing || keepExistingPricing) ? (values.input_price ?? 0) : 0,
      output_price: (hasInputOutputPricing || keepExistingPricing) ? (values.output_price ?? 0) : 0,
      credit_per_call: (hasCreditPerCallPricing || keepExistingPricing) ? (values.credit_per_call ?? 0) : 0,
    };
    setSubmitting(true);
    try {
      if (editingId) {
        await billingApi.update(editingId, {
          ...billingFields,
        });
        message.success('已更新');
      } else if (values.scope === 'default') {
        await billingApi.create({
          cloud_model_id: values.cloud_model_id,
          target_type: 'default',
          target_id: 0,
          ...billingFields,
        });
        message.success('已保存默认规则');
      } else {
        const uIds: number[] = values.user_ids || [];
        const gIds: number[] = values.group_ids || [];
        if (!uIds.length && !gIds.length) {
          message.warning('请选择至少一个用户或分组');
          setSubmitting(false);
          return;
        }
        const targets = [
          ...uIds.map(id => ({ type: 'user' as const, id })),
          ...gIds.map(id => ({ type: 'group' as const, id })),
        ];
        const res = await billingApi.batchCreate({
          cloud_model_id: values.cloud_model_id,
          targets,
          ...billingFields,
        });
        message.success(`已保存 ${res.data.affected} 条规则`);
      }
      setModalOpen(false); form.resetFields(); setEditingId(null); load();
    } catch (err: any) {
      message.error(err.response?.data?.error || '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: '模型', dataIndex: ['cloud_model', 'name'], render: (_v: string, r: any) => {
      const cm = r.cloud_model;
      if (!cm) return '-';
      const base = cm.name || cm.model_id;
      return cm.provider?.name ? `${cm.provider.name} / ${base}` : base;
    }},
    { title: '目标', render: (_: any, r: any) => {
      if (r.target_type === 'default') return <Tag>默认</Tag>;
      if (r.target_type === 'user') {
        const u = users.find((u: any) => u.id === r.target_id);
        return <Tag color="blue">用户: {u?.username || r.target_id}</Tag>;
      }
      const g = groups.find((g: any) => g.id === r.target_id);
      return <Tag color="green">分组: {g?.name || r.target_id}</Tag>;
    }},
    { title: '计费类型', dataIndex: 'billing_type', render: (v: string) => <CurrencyTag type={v} /> },
    { title: '输入价格', dataIndex: 'input_price', render: (v: string, r: any) => {
      if (r.billing_type === 'token') return Number(v) > 0 ? `${v}${labels.token}/M` : '-';
      if (r.billing_type === 'credit' && r.cloud_model?.type === 'chat') return Number(v) > 0 ? `${v}${labels.credit}/M` : '-';
      return '-';
    } },
    { title: '输出价格', dataIndex: 'output_price', render: (v: string, r: any) => {
      if (r.billing_type === 'token') return Number(v) > 0 ? `${v}${labels.token}/M` : '-';
      if (r.billing_type === 'credit' && r.cloud_model?.type === 'chat') return Number(v) > 0 ? `${v}${labels.credit}/M` : '-';
      return '-';
    } },
    { title: `${labels.credit}/次`, dataIndex: 'credit_per_call', render: (v: string, r: any) => r.billing_type === 'credit' && r.cloud_model?.type !== 'chat' && Number(v) > 0 ? v : '-' },
    {
      title: '操作', render: (_: any, r: any) => (
        <Space size={4}>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>编辑</Button>
          <Popconfirm title="确认删除？" onConfirm={async () => { await billingApi.delete(r.id); load(); }}>
            <Button size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const totalTargets = userIds.length + groupIds.length;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, gap: 8, flexWrap: 'wrap' }}>
        <Space wrap>
          <Select placeholder="模型" allowClear style={{ width: 260 }} showSearch optionFilterProp="label"
            options={models.map(m => ({
              value: m.id,
              label: m.provider?.name ? `${m.provider.name} / ${m.name}` : m.name,
            }))}
            onChange={(v) => setParams({ ...params, cloud_model_id: v, page: 1 })} />
          <Input.Search
            placeholder="按用户名 / 昵称 / 分组名搜索"
            allowClear
            style={{ width: 240 }}
            onSearch={(v) => setParams({ ...params, target_keyword: v || undefined, page: 1 })} />
        </Space>
        <Space>
          <BatchDeleteButton
            selectedKeys={selectedKeys}
            onClear={() => setSelectedKeys([])}
            batchDelete={billingApi.batchDelete}
            onDone={load}
            itemName="规则"
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditingId(null); form.resetFields(); form.setFieldsValue({ scope: 'default' }); setModalOpen(true); }}>
            添加规则
          </Button>
        </Space>
      </div>

      <Table columns={columns} dataSource={data.data} rowKey="id" loading={loading}
        rowSelection={{
          selectedRowKeys: selectedKeys,
          onChange: (keys) => setSelectedKeys(keys as number[]),
        }}
        pagination={{ current: params.page, pageSize: params.per_page, total: data.total,
          onChange: (p, ps) => setParams({ ...params, page: p, per_page: ps }) }}
        size="small" />

      <Modal title={editingId ? '编辑计费规则' : '添加计费规则'} open={modalOpen} confirmLoading={submitting}
        onOk={handleSave} onCancel={() => { setModalOpen(false); setEditingId(null); }} destroyOnClose width={560} mask={false}>
        <Form form={form} layout="vertical" initialValues={{ scope: 'default' }}>
          <Form.Item name="scope" label="规则范围" rules={[{ required: true }]}>
            <Radio.Group disabled={!!editingId}>
              <Radio.Button value="default">默认规则（所有人）</Radio.Button>
              <Radio.Button value="batch">批量指派（用户/分组多选）</Radio.Button>
            </Radio.Group>
          </Form.Item>
          <Form.Item name="cloud_model_id" label="模型" rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label" disabled={!!editingId}
              options={models.map(m => ({
                value: m.id,
                label: m.provider?.name
                  ? `${m.provider.name} / ${m.name} (${m.model_id})`
                  : `${m.name} (${m.model_id})`,
              }))} />
          </Form.Item>
          {scope === 'batch' && (
            <>
              <Alert type="info" showIcon style={{ marginBottom: 12 }}
                message={`为 ${totalTargets} 个目标配置同一条规则。已存在的自动覆盖（同 model + target 去重）。`} />
              <Form.Item name="user_ids" label="用户（可多选）">
                <Select mode="multiple" showSearch optionFilterProp="label" placeholder="选择用户"
                  maxTagCount="responsive" allowClear
                  options={users.map(u => ({ value: u.id, label: `${u.username} (${u.nickname})` }))} />
              </Form.Item>
              <Form.Item name="group_ids" label="分组（可多选）">
                <Select mode="multiple" showSearch optionFilterProp="label" placeholder="选择分组"
                  maxTagCount="responsive" allowClear
                  options={groups.map(g => ({ value: g.id, label: g.name }))} />
              </Form.Item>
            </>
          )}
          <Form.Item name="billing_type" label="计费类型" rules={[{ required: true }]}>
            <Select options={typeOptions} />
          </Form.Item>
          {useTokenPricingFields && (<>
            <Form.Item name="input_price" label={`输入价格 (${tokenPricingLabel}/M tokens)`}><InputNumber min={0} step={0.001} style={{ width: '100%' }} /></Form.Item>
            <Form.Item name="output_price" label={`输出价格 (${tokenPricingLabel}/M tokens)`}><InputNumber min={0} step={0.001} style={{ width: '100%' }} /></Form.Item>
          </>)}
          {useCreditPerCallField && (
            <Form.Item name="credit_per_call" label={`每次调用${labels.credit}`}><InputNumber min={0} step={0.1} style={{ width: '100%' }} /></Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  );
}
