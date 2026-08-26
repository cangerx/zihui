import { useEffect, useState } from 'react';
import { Table, Button, Space, Tag, Modal, Form, Select, Input, message, Popconfirm, Switch, Alert } from 'antd';
import { PlusOutlined, EditOutlined } from '@ant-design/icons';
import { permissionApi, userApi, groupApi } from '../services/api';
import BatchDeleteButton from '../components/BatchDeleteButton';

const policyKeys = [
  { value: 'allow_custom_provider', label: '允许自定义模型服务商', type: 'boolean' },
  { value: 'allow_custom_embedding', label: '允许自定义向量服务（关闭后强制走云端）', type: 'boolean' },
  { value: 'allow_custom_video_provider', label: '允许自定义视频模型（开启后桌面端「视频模型」入口可见）', type: 'boolean' },
  { value: 'allow_ai_video', label: '允许使用云控 AI 视频 / 爆款复刻成片（默认关）', type: 'boolean' },
  { value: 'video_quota_per_day', label: 'AI 视频日配额（次，0=不限）', type: 'number' },
  { value: 'video_quota_per_month', label: 'AI 视频月配额（次，0=不限）', type: 'number' },
  { value: 'allow_image_gen', label: '允许图像生成（占位，未实际实现功能）', type: 'boolean' },
  { value: 'allow_knowledge_base', label: '允许知识库（占位，未实际实现功能）', type: 'boolean' },
  { value: 'max_context_messages', label: '最大上下文条数（占位，未实际实现功能）', type: 'number' },
  // 快速抠图（阿里 viapi）：桌面端「快速抠图」入口 + 「自定义抠图接口」tab 受这三个 key 控制
  { value: 'allow_image_matting', label: '允许快速抠图（云端中转，关闭后桌面端入口隐藏）', type: 'boolean' },
  { value: 'allow_custom_matting_provider', label: '允许自定义抠图接口（开启后桌面端可填阿里 AK/SK 直连）', type: 'boolean' },
  { value: 'image_matting_quota_per_month', label: '快速抠图月配额（张，0=不限）', type: 'number' },
  // 精细抠图（抠抠图 koukoutu）：桌面端「精细抠图」入口 + 月配额
  { value: 'allow_fine_matting', label: '允许精细抠图（抠抠图，关闭后桌面端入口隐藏）', type: 'boolean' },
  { value: 'fine_matting_quota_per_month', label: '精细抠图月配额（张，0=不限）', type: 'number' },
  // 去AI标记：此权限只控制「能否使用」（是否显示由系统设置的全局开关控制）；
  // 系统设置开了「全局可用」时，所有人免此授权即可使用，此权限不再必需。
  { value: 'allow_ai_mark_removal', label: '允许使用去AI标记（显示由系统设置全局开关控制）', type: 'boolean' },
  { value: 'ai_mark_removal_credit_per_call', label: '去AI标记单次扣费（积分，覆盖全局单价；留空/0 走全局设置）', type: 'number' },
  // 微信 ClawBot：此权限只控制「能否使用」（默认拒绝）；菜单显示/隐藏由「桌面端设置 → 菜单配置」管理，与此权限无关。
  { value: 'allow_clawbot', label: '允许使用微信 ClawBot（菜单显示由菜单配置管理）', type: 'boolean' },
  // 「店铺商品图」per-user 门控已迁至「桌面端设置 → 店铺商品图」独立页统一管理，这里不再提供。
];
const nonCreatablePolicyKeys = new Set(['allow_image_gen', 'allow_knowledge_base', 'max_context_messages']);

export default function Permissions() {
  const [data, setData] = useState<any>({ data: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [params, setParams] = useState<Record<string, any>>({ page: 1, per_page: 50 });
  const [modalOpen, setModalOpen] = useState(false);
  const [users, setUsers] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();
  const [selectedKeys, setSelectedKeys] = useState<number[]>([]);
  // 编辑态：非 null 表示正在编辑这条现有策略（Modal 禁用 targets / policy_key 选择，仅改 value）
  const [editing, setEditing] = useState<any | null>(null);
  const policyKey = Form.useWatch('policy_key', form);
  const userIds: number[] = Form.useWatch('user_ids', form) || [];
  const groupIds: number[] = Form.useWatch('group_ids', form) || [];

  const load = async () => {
    setLoading(true);
    try { const res = await permissionApi.list(params); setData(res.data); } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, [params]);
  useEffect(() => {
    Promise.all([
      userApi.list({ per_page: 500 }),
      groupApi.list({ per_page: 500 }),
    ]).then(([u, g]) => {
      setUsers(u.data.data || []);
      setGroups(g.data.data || []);
    });
  }, []);

  const openEdit = (record: any) => {
    // 套餐发放的策略 source_plan_id 非空，后端 update 会拒，前端直接拦住更友好
    if (record.source_plan_id) {
      message.warning('套餐发放的策略不可直接编辑，请通过套餐管理修改');
      return;
    }
    setEditing(record);
    const pk = policyKeys.find(k => k.value === record.policy_key);
    // policy_value 从后端回来可能是 JSON 字符串或原始值
    let parsed: any = record.policy_value;
    if (typeof parsed === 'string') {
      try { parsed = JSON.parse(parsed); } catch { /* 保留原字符串 */ }
    }
    if (pk?.type === 'boolean') parsed = !!parsed;
    form.resetFields();
    form.setFieldsValue({
      // 仅用于展示，编辑态下禁用
      user_ids: record.target_type === 'user' ? [record.target_id] : [],
      group_ids: record.target_type === 'group' ? [record.target_id] : [],
      policy_key: record.policy_key,
      policy_value: parsed,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    const values = await form.validateFields();
    const pk = policyKeys.find(k => k.value === values.policy_key);
    let policyValue = values.policy_value;
    if (pk?.type === 'boolean') policyValue = !!policyValue;
    if (pk?.type === 'number') policyValue = Number(policyValue);

    setSubmitting(true);
    try {
      if (editing) {
        // 编辑单条：只允许改 policy_value（后端 update 只接受此字段）
        await permissionApi.update(editing.id, { policy_value: policyValue });
        message.success('已更新策略');
      } else {
        if (!values.user_ids?.length && !values.group_ids?.length) {
          message.warning('请选择至少一个用户或分组');
          setSubmitting(false);
          return;
        }
        const targets = [
          ...(values.user_ids || []).map((id: number) => ({ type: 'user' as const, id })),
          ...(values.group_ids || []).map((id: number) => ({ type: 'group' as const, id })),
        ];
        const res = await permissionApi.batchCreate({
          targets,
          policy_key: values.policy_key,
          policy_value: policyValue,
        });
        message.success(`已保存 ${res.data.affected} 条策略`);
      }
      setModalOpen(false); setEditing(null); form.resetFields(); load();
    } catch (err: any) {
      message.error(err.response?.data?.error || '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: '目标', dataIndex: 'target_type', render: (v: string, r: any) => {
      if (v === 'user') {
        const u = users.find((u: any) => u.id === r.target_id);
        return <Tag color="blue">用户: {u?.username || r.target_id}</Tag>;
      }
      const g = groups.find((g: any) => g.id === r.target_id);
      return <Tag color="green">分组: {g?.name || r.target_id}</Tag>;
    }},
    { title: '策略', dataIndex: 'policy_key', render: (v: string) => {
      const pk = policyKeys.find(k => k.value === v);
      return pk?.label || v;
    }},
    { title: '值', dataIndex: 'policy_value', render: (v: any) => {
      const parsed = typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return v; } })() : v;
      if (typeof parsed === 'boolean') return <Tag color={parsed ? 'green' : 'red'}>{parsed ? '是' : '否'}</Tag>;
      return String(parsed);
    }},
    {
      title: '操作', width: 150, render: (_: any, r: any) => (
        <Space size={4}>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} disabled={!!r.source_plan_id}>编辑</Button>
          <Popconfirm title="确认删除？" onConfirm={async () => { await permissionApi.delete(r.id); load(); }}>
            <Button size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const currentPk = policyKeys.find(k => k.value === policyKey);
  const totalTargets = userIds.length + groupIds.length;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space>
          <Select placeholder="目标类型" allowClear style={{ width: 140 }}
            options={[{ value: 'user', label: '用户' }, { value: 'group', label: '分组' }]}
            onChange={(v) => setParams({ ...params, target_type: v, page: 1 })} />
        </Space>
        <Space>
          <BatchDeleteButton
            selectedKeys={selectedKeys}
            onClear={() => setSelectedKeys([])}
            batchDelete={permissionApi.batchDelete}
            onDone={load}
            itemName="策略"
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditing(null); form.resetFields(); setModalOpen(true); }}>
            批量添加策略
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

      <Modal title={editing ? `编辑策略 #${editing.id}` : '批量添加权限策略'} open={modalOpen} width={600} confirmLoading={submitting}
        onOk={handleSave} onCancel={() => { setModalOpen(false); setEditing(null); }} destroyOnClose mask={false}>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={editing
            ? `正在编辑单条策略，目标和策略键不可变，仅可修改策略值。`
            : `为 ${totalTargets} 个目标配置同一条策略。已存在的自动覆盖（同 target + policy_key 去重）。`}
        />
        <Form form={form} layout="vertical">
          <Form.Item name="user_ids" label="用户（可多选）">
            <Select mode="multiple" showSearch optionFilterProp="label" placeholder="选择用户"
              maxTagCount="responsive" allowClear disabled={!!editing}
              options={users.map(u => ({ value: u.id, label: `${u.username} (${u.nickname})` }))} />
          </Form.Item>
          <Form.Item name="group_ids" label="分组（可多选）">
            <Select mode="multiple" showSearch optionFilterProp="label" placeholder="选择分组"
              maxTagCount="responsive" allowClear disabled={!!editing}
              options={groups.map(g => ({ value: g.id, label: g.name }))} />
          </Form.Item>
          <Form.Item name="policy_key" label="策略" rules={[{ required: true }]}>
            <Select disabled={!!editing} options={(editing ? policyKeys : policyKeys.filter(k => !nonCreatablePolicyKeys.has(k.value))).map(k => ({ value: k.value, label: k.label }))} />
          </Form.Item>
          <Form.Item name="policy_value" label="值" rules={[{ required: true }]} valuePropName={currentPk?.type === 'boolean' ? 'checked' : 'value'}>
            {currentPk?.type === 'boolean'
              ? <Switch checkedChildren="是" unCheckedChildren="否" />
              : <Input type={currentPk?.type === 'number' ? 'number' : 'text'} />}
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
