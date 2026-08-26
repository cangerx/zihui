import { useEffect, useState } from 'react';
import { Table, Button, Space, Tag, Modal, Form, Input, InputNumber, Select, message, Popconfirm, Typography } from 'antd';
import { PlusOutlined, CloudDownloadOutlined } from '@ant-design/icons';
import { assignmentApi, billingApi, groupApi, modelApi, providerApi } from '../services/api';
import OfficialRefPanel, { OfficialRefText } from '../components/OfficialRefPanel';
import BatchDeleteButton from '../components/BatchDeleteButton';

const HAND_FILL = '__hand_fill__';

export default function Models() {
  const [data, setData] = useState<any>({ data: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [params, setParams] = useState<Record<string, any>>({ page: 1, per_page: 50 });
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [providers, setProviders] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [fetchModal, setFetchModal] = useState(false);
  const [fetchProvider, setFetchProvider] = useState<number | null>(null);
  const [remoteModels, setRemoteModels] = useState<any[]>([]);
  const [selectedRemote, setSelectedRemote] = useState<string[]>([]);
  const [importInputPrice, setImportInputPrice] = useState<number | null>(null);
  const [importOutputPrice, setImportOutputPrice] = useState<number | null>(null);
  const [importCreditPerCall, setImportCreditPerCall] = useState<number | null>(null);
  const [createRemoteIds, setCreateRemoteIds] = useState<string[]>([]);
  const [handFill, setHandFill] = useState(false);
  const [form] = Form.useForm();
  const [selectedKeys, setSelectedKeys] = useState<number[]>([]);

  const load = async () => {
    setLoading(true);
    try { const res = await modelApi.list(params); setData(res.data); } catch {}
    setLoading(false);
  };

  const loadProviders = async () => {
    try { const res = await providerApi.list({ per_page: 200, status: 'active' }); setProviders(res.data.data || []); } catch {}
  };

  const loadGroups = async () => {
    try { const res = await groupApi.list({ per_page: 200 }); setGroups(res.data.data || res.data || []); } catch {}
  };

  useEffect(() => { load(); loadProviders(); loadGroups(); }, [params]);

  const defaultModelTypeOf = (providerId: number | null | undefined): 'chat' | 'image' => {
    const p = providers.find(x => x.id === providerId);
    return p?.type === 'duomi' ? 'image' : 'chat';
  };

  const watchedProviderId = Form.useWatch('provider_id', form) as number | undefined;
  const watchedType = Form.useWatch('type', form) as string | undefined;
  const watchedModelId = Form.useWatch('model_id', form) as string | undefined;
  const currentProviderId: number | undefined = editing?.provider_id ?? watchedProviderId;
  const isDuomiSelected = providers.some(p => p.id === currentProviderId && p.type === 'duomi');
  const officialModality = (watchedType === 'image' ? 'image' : 'chat');

  useEffect(() => {
    if (editing || !watchedProviderId || isDuomiSelected) {
      setCreateRemoteIds([]);
      return;
    }
    let cancelled = false;
    providerApi.fetchModels(watchedProviderId)
      .then((res) => {
        if (!cancelled) setCreateRemoteIds((res.data.models || []).map((item: any) => item.id).filter(Boolean));
      })
      .catch(() => { if (!cancelled) setCreateRemoteIds([]); });
    return () => { cancelled = true; };
  }, [watchedProviderId, editing, isDuomiSelected]);

  const writeDefaultBilling = async (cloudModelId: number, type: string, values: any) => {
    if (type === 'image') {
      if (values.credit_per_call === undefined || values.credit_per_call === null || values.credit_per_call === '') return;
      await billingApi.create({
        cloud_model_id: cloudModelId,
        target_type: 'default',
        billing_type: 'credit',
        credit_per_call: Number(values.credit_per_call),
      });
      return;
    }
    const hasInput = values.input_price !== undefined && values.input_price !== null && values.input_price !== '';
    const hasOutput = values.output_price !== undefined && values.output_price !== null && values.output_price !== '';
    if (!hasInput && !hasOutput) return;
    await billingApi.create({
      cloud_model_id: cloudModelId,
      target_type: 'default',
      billing_type: 'token',
      input_price: hasInput ? Number(values.input_price) : 0,
      output_price: hasOutput ? Number(values.output_price) : 0,
    });
  };

  const handleSave = async () => {
    const values = await form.validateFields();
    try {
      if (editing) {
        await modelApi.update(editing.id, {
          name: values.name,
          type: values.type,
          status: values.status,
        });
        message.success('已更新');
      } else {
        const created = await modelApi.create({
          provider_id: values.provider_id,
          model_id: values.model_id,
          name: values.name,
          type: values.type,
          status: values.status,
        });
        const id = created.data.id;
        try {
          await writeDefaultBilling(id, values.type, values);
        } catch {
          message.warning('模型已建、计费未写');
        }
        if (values.group_ids?.length) {
          try {
            await assignmentApi.batchMatrix({
              cloud_model_ids: [id],
              targets: values.group_ids.map((gid: number) => ({ type: 'group', id: gid })),
            });
          } catch {
            message.warning('模型已建、分配未写');
          }
        }
        message.success('已创建');
      }
      setModalOpen(false); form.resetFields(); setEditing(null); setHandFill(false); load();
    } catch (err: any) { message.error(err.response?.data?.error || '操作失败'); }
  };

  const handleFetch = async () => {
    if (!fetchProvider) return;
    try {
      const res = await providerApi.fetchModels(fetchProvider);
      setRemoteModels(res.data.models || []);
    } catch (err: any) {
      message.error(err.response?.data?.error || '获取失败');
    }
  };

  const handleImport = async () => {
    if (!fetchProvider || !selectedRemote.length) return;
    const t = defaultModelTypeOf(fetchProvider);
    const models = selectedRemote.map(id => ({ model_id: id, name: id, type: t }));
    try {
      const res = await modelApi.batchCreate({ provider_id: fetchProvider, models });
      const createdIds: number[] = res.data.created_ids || [];
      let billingFailed = 0;
      const billingValues = t === 'image'
        ? { credit_per_call: importCreditPerCall }
        : { input_price: importInputPrice, output_price: importOutputPrice };
      for (const id of createdIds) {
        try {
          await writeDefaultBilling(id, t, billingValues);
        } catch {
          billingFailed++;
        }
      }
      message.success(`已创建: ${res.data.created}, 已跳过: ${res.data.skipped}`);
      if (billingFailed) message.warning('模型已建、计费未写');
      setFetchModal(false); setRemoteModels([]); setSelectedRemote([]);
      setImportInputPrice(null); setImportOutputPrice(null); setImportCreditPerCall(null);
      load();
    } catch (err: any) { message.error(err.response?.data?.error || '导入失败'); }
  };

  const createModelOptions = [
    ...createRemoteIds.map((id) => ({ value: id, label: id })),
    { value: HAND_FILL, label: '列表没有，手填' },
  ];

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: '模型ID', dataIndex: 'model_id', ellipsis: true },
    { title: '名称', dataIndex: 'name' },
    { title: '服务商', dataIndex: ['provider', 'name'] },
    { title: '类型', dataIndex: 'type', render: (v: string) => <Tag>{v}</Tag> },
    { title: '状态', dataIndex: 'status', render: (v: string) => <Tag color={v === 'active' ? 'green' : 'default'}>{v === 'active' ? '正常' : '禁用'}</Tag> },
    {
      title: '开通', width: 160, render: (_: any, r: any) => (
        <Space size={4} wrap>
          {!r.has_default_billing && <Tag color="red">未定价</Tag>}
          {!r.is_assigned && <Tag color="red">未分配</Tag>}
          {r.has_default_billing && r.is_assigned && <Tag color="green">已开通</Tag>}
        </Space>
      ),
    },
    {
      title: '操作', render: (_: any, r: any) => (
        <Space size="small">
          <Button size="small" onClick={() => { setEditing(r); setHandFill(false); form.setFieldsValue(r); setModalOpen(true); }}>编辑</Button>
          <Popconfirm title="确认删除？" onConfirm={async () => { await modelApi.delete(r.id); load(); }}>
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
          <Select placeholder="服务商" allowClear style={{ width: 200 }}
            options={providers.map(p => ({ value: p.id, label: p.name }))}
            onChange={(v) => setParams({ ...params, provider_id: v, page: 1 })} />
          <Select placeholder="类型" allowClear style={{ width: 120 }}
            options={[{ value: 'chat', label: '对话' }, { value: 'image', label: '图像' }, { value: 'embedding', label: '向量' }]}
            onChange={(v) => setParams({ ...params, type: v, page: 1 })} />
        </Space>
        <Space>
          <BatchDeleteButton
            selectedKeys={selectedKeys}
            onClear={() => setSelectedKeys([])}
            batchDelete={modelApi.batchDelete}
            onDone={load}
            itemName="模型"
          />
          <Button icon={<CloudDownloadOutlined />} onClick={() => setFetchModal(true)}>远程获取</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditing(null); setHandFill(false); setCreateRemoteIds([]); form.resetFields(); setModalOpen(true); }}>添加模型</Button>
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

      <Modal title={editing ? '编辑模型' : '添加模型'} open={modalOpen}
        onOk={handleSave} onCancel={() => { setModalOpen(false); setEditing(null); setHandFill(false); }} destroyOnClose width={640}>
        <Form
          form={form}
          layout="vertical"
          onValuesChange={(changed) => {
            if (typeof changed.provider_id === 'number') {
              const p = providers.find(x => x.id === changed.provider_id);
              if (p?.type === 'duomi') {
                form.setFieldsValue({ model_id: 'gpt-image-2', type: 'image' });
                setHandFill(false);
              }
            }
          }}
        >
          {!editing && <Form.Item name="provider_id" label="服务商" rules={[{ required: true }]}>
            <Select options={providers.map(p => ({ value: p.id, label: p.name }))} />
          </Form.Item>}
          {editing || isDuomiSelected ? (
            <Form.Item name="model_id" label="模型 ID" rules={[{ required: true }]}
              extra={isDuomiSelected ? '多米 API 仅支持 gpt-image-2，已锁定' : undefined}>
              <Input disabled={isDuomiSelected || !!editing} />
            </Form.Item>
          ) : (
            <>
              <Form.Item label="模型 ID" required>
                <Select
                  showSearch
                  optionFilterProp="label"
                  placeholder="搜索或选择模型 ID"
                  options={createModelOptions}
                  value={handFill ? HAND_FILL : (watchedModelId || undefined)}
                  onChange={(value) => {
                    if (value === HAND_FILL) {
                      setHandFill(true);
                      form.setFieldValue('model_id', '');
                      return;
                    }
                    setHandFill(false);
                    form.setFieldValue('model_id', value);
                    if (!form.getFieldValue('name')) form.setFieldValue('name', value);
                  }}
                />
              </Form.Item>
              <Form.Item name="model_id" hidden rules={[{ required: true, message: '请填写模型 ID' }]}>
                <Input />
              </Form.Item>
              {handFill && (
                <Form.Item label="手填模型 ID" required>
                  <Input
                    placeholder="如 gpt-4o"
                    value={watchedModelId}
                    onChange={(e) => form.setFieldValue('model_id', e.target.value)}
                  />
                </Form.Item>
              )}
            </>
          )}
          <OfficialRefPanel modelId={watchedModelId} modality={officialModality} />
          <Form.Item name="name" label="显示名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="type" label="类型" rules={[{ required: true }]}
            extra={isDuomiSelected ? '多米 API 是图生服务，已锁定为「图像」' : undefined}>
            <Select disabled={isDuomiSelected}
              options={[{ value: 'chat', label: '对话' }, { value: 'image', label: '图像' }, { value: 'embedding', label: '向量' }]} />
          </Form.Item>
          <Form.Item name="status" label="状态" initialValue="active">
            <Select options={[{ value: 'active', label: '正常' }, { value: 'disabled', label: '禁用' }]} />
          </Form.Item>
          {!editing && watchedType === 'image' && (
            <Form.Item name="credit_per_call" label="本站售价（每次调用积分）" tooltip="对照官方参考后自行填写，不会回填人民币金额">
              <InputNumber min={0} precision={4} placeholder="留空为待定价" style={{ width: '100%' }} />
            </Form.Item>
          )}
          {!editing && watchedType && watchedType !== 'image' && (
            <>
              <Form.Item name="input_price" label="本站售价（输入 Token）" tooltip="对照官方参考后自行填写">
                <InputNumber min={0} precision={8} placeholder="留空为待定价" style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="output_price" label="本站售价（输出 Token）">
                <InputNumber min={0} precision={8} placeholder="留空为待定价" style={{ width: '100%' }} />
              </Form.Item>
            </>
          )}
          {!editing && (
            <Form.Item name="group_ids" label="分配用户组（可选）" extra="不选也能保存，列表会标未分配">
              <Select mode="multiple" allowClear showSearch optionFilterProp="label" placeholder="可选，不默认全员"
                options={groups.map((g: any) => ({ value: g.id, label: g.name }))} />
            </Form.Item>
          )}
        </Form>
      </Modal>

      <Modal title="远程获取模型" open={fetchModal}
        onCancel={() => { setFetchModal(false); setRemoteModels([]); setSelectedRemote([]); }}
        footer={[
          <Button key="cancel" onClick={() => setFetchModal(false)}>取消</Button>,
          <Button key="import" type="primary" disabled={!selectedRemote.length} onClick={handleImport}>
            导入已选 ({selectedRemote.length})
          </Button>,
        ]} width={760}>
        <div style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
          <Select style={{ flex: 1 }} placeholder="选择服务商" value={fetchProvider}
            onChange={setFetchProvider}
            options={providers.map(p => ({ value: p.id, label: p.name }))} />
          <Button onClick={handleFetch} disabled={!fetchProvider}>获取</Button>
        </div>
        {remoteModels.length > 0 && (
          <>
            <Space style={{ marginBottom: 12 }} wrap>
              <Typography.Text type="secondary">导入后仅为新建行写默认定费，不覆盖已存在模型</Typography.Text>
              {defaultModelTypeOf(fetchProvider) === 'image' ? (
                <InputNumber min={0} precision={4} value={importCreditPerCall} onChange={(v) => setImportCreditPerCall(v === null ? null : Number(v))} placeholder="每次调用积分，可空" />
              ) : (
                <>
                  <InputNumber min={0} precision={8} value={importInputPrice} onChange={(v) => setImportInputPrice(v === null ? null : Number(v))} placeholder="输入 Token 价，可空" />
                  <InputNumber min={0} precision={8} value={importOutputPrice} onChange={(v) => setImportOutputPrice(v === null ? null : Number(v))} placeholder="输出 Token 价，可空" />
                </>
              )}
            </Space>
            <Table size="small" dataSource={remoteModels} rowKey="id" pagination={false}
              scroll={{ y: 300 }}
              rowSelection={{ selectedRowKeys: selectedRemote, onChange: (keys) => setSelectedRemote(keys as string[]) }}
              columns={[
                { title: '模型ID', dataIndex: 'id' },
                { title: '所属', dataIndex: 'owned_by' },
                { title: '官方参考', render: (_: any, row: any) => <OfficialRefText modelId={row.id} modality={defaultModelTypeOf(fetchProvider)} compact /> },
              ]} />
          </>
        )}
      </Modal>
    </div>
  );
}
