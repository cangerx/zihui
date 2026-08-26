import { useEffect, useState } from 'react';
import { Table, Button, Space, Tag, Modal, Form, Select, message, Popconfirm, Alert } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { assignmentApi, modelApi, userApi, groupApi } from '../services/api';
import BatchDeleteButton from '../components/BatchDeleteButton';

export default function Assignments() {
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
  const userIds: number[] = Form.useWatch('user_ids', form) || [];
  const groupIds: number[] = Form.useWatch('group_ids', form) || [];
  const modelIds: number[] = Form.useWatch('cloud_model_ids', form) || [];

  const load = async () => {
    setLoading(true);
    try { const res = await assignmentApi.list(params); setData(res.data); } catch {}
    setLoading(false);
  };

  const loadOptions = async () => {
    try {
      const [m, u, g] = await Promise.all([
        modelApi.list({ per_page: 500, status: 'active' }),
        userApi.list({ per_page: 500 }),
        groupApi.list({ per_page: 500 }),
      ]);
      setModels(m.data.data || []);
      setUsers(u.data.data || []);
      setGroups(g.data.data || []);
    } catch {}
  };

  useEffect(() => { load(); loadOptions(); }, [params]);

  const handleSave = async () => {
    const values = await form.validateFields();
    const cmIds: number[] = values.cloud_model_ids || [];
    const uIds: number[] = values.user_ids || [];
    const gIds: number[] = values.group_ids || [];
    if (!cmIds.length) { message.warning('请选择至少一个模型'); return; }
    if (!uIds.length && !gIds.length) { message.warning('请选择至少一个用户或分组'); return; }
    const targets = [
      ...uIds.map(id => ({ type: 'user' as const, id })),
      ...gIds.map(id => ({ type: 'group' as const, id })),
    ];
    setSubmitting(true);
    try {
      const res = await assignmentApi.batchMatrix({ cloud_model_ids: cmIds, targets });
      message.success(`已创建 ${res.data.created} 条，跳过已存在 ${res.data.skipped} 条`);
      setModalOpen(false); form.resetFields(); load();
    } catch (err: any) {
      message.error(err.response?.data?.error || '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: '模型', dataIndex: ['cloud_model', 'name'], render: (v: string, r: any) => v || r.cloud_model?.model_id },
    { title: '服务商', dataIndex: ['cloud_model', 'provider', 'name'] },
    { title: '分配类型', dataIndex: 'assignee_type', render: (v: string) => <Tag>{v === 'user' ? '用户' : '分组'}</Tag> },
    { title: '分配对象', dataIndex: 'assignee_id', render: (v: number, r: any) => {
      if (r.assignee_type === 'user') {
        const u = users.find((u: any) => u.id === v);
        return u ? `${u.username} (${u.nickname})` : v;
      }
      const g = groups.find((g: any) => g.id === v);
      return g ? g.name : v;
    }},
    {
      title: '操作', render: (_: any, r: any) => (
        <Popconfirm title="确认移除？" onConfirm={async () => { await assignmentApi.delete(r.id); load(); }}>
          <Button size="small" danger>移除</Button>
        </Popconfirm>
      ),
    },
  ];

  const totalPreview = modelIds.length * (userIds.length + groupIds.length);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space>
          <Select placeholder="分配类型" allowClear style={{ width: 140 }}
            options={[{ value: 'user', label: '用户' }, { value: 'group', label: '分组' }]}
            onChange={(v) => setParams({ ...params, assignee_type: v, page: 1 })} />
        </Space>
        <Space>
          <BatchDeleteButton
            selectedKeys={selectedKeys}
            onClear={() => setSelectedKeys([])}
            batchDelete={assignmentApi.batchDelete}
            onDone={load}
            itemName="分配"
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); setModalOpen(true); }}>
            批量分配
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

      <Modal title="批量分配模型" open={modalOpen} width={640} confirmLoading={submitting}
        onOk={handleSave} onCancel={() => setModalOpen(false)} destroyOnClose mask={false}>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={`矩阵式分配：${modelIds.length} 模型 × ${userIds.length + groupIds.length} 目标 = ${totalPreview} 条记录。已存在的自动跳过。`}
        />
        <Form form={form} layout="vertical">
          <Form.Item name="cloud_model_ids" label="模型（可多选）" rules={[{ required: true, message: '请选择模型' }]}>
            <Select mode="multiple" showSearch optionFilterProp="label" placeholder="选择模型"
              maxTagCount="responsive"
              options={models.map(m => ({
                value: m.id,
                label: m.provider?.name
                  ? `${m.provider.name} / ${m.name} (${m.model_id})`
                  : `${m.name} (${m.model_id})`,
              }))} />
          </Form.Item>
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
        </Form>
      </Modal>
    </div>
  );
}
