import { useEffect, useState } from 'react';
import {
  Table, Button, Space, Tag, Modal, Form, Input, InputNumber, Select,
  message, Popconfirm, Tooltip, Switch, Row, Col,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { planApi, modelApi, oemProjectApi, settingApi } from '../services/api';
import { useCurrencyLabels } from '../contexts/CurrencyContext';
import BatchDeleteButton from '../components/BatchDeleteButton';

interface Plan {
  id: number;
  code: string;
  category_id?: number | null;
  category?: PlanCategory | null;
  name: string;
  description: string;
  price: number | string;
  currency: string;
  duration_days: number;
  token_quota: number | string;
  credit_quota: number | string;
  storage_quota_bytes?: number | string;
  // 余额模式：none=一次性发放；monthly=按开通日每满一月重置（上月余额不结转）
  quota_refill_cycle?: 'none' | 'monthly';
  status: string;
  sort: number;
  remark: string;
  created_at: string;
  modelAssignments?: Array<{ cloud_model_id: number; cloud_model?: any }>;
  permissions?: Array<{ policy_key: string; policy_value: string }>;
  channel_visibilities?: Array<{ channel_key: string; channel_type: string; oem_project_name?: string | null }>;
}

interface PlanCategory {
  id: number;
  name: string;
  sort_order: number;
  plans_count?: number;
}

interface PolicyRow {
  key: string;
  value: string;
  kind: 'bool' | 'number' | 'string';
}

const KNOWN_POLICIES: Array<{ key: string; label: string; kind: 'bool' | 'number'; hint?: string }> = [
  { key: 'allow_custom_provider',         label: '允许自定义模型服务商', kind: 'bool', hint: '默认全员开启；关闭后该套餐用户无法在桌面端配置 BYOK' },
  { key: 'allow_custom_embedding',        label: '允许自定义向量服务',   kind: 'bool' },
  { key: 'allow_custom_video_provider',   label: '允许自定义视频模型',   kind: 'bool' },
  { key: 'video_quota_per_day',           label: 'AI 视频日配额（次）',     kind: 'number', hint: '0 = 不限；按成功扣费任务计数' },
  { key: 'video_quota_per_month',         label: 'AI 视频月配额（次）',     kind: 'number', hint: '0 = 不限；按成功扣费任务计数' },
  { key: 'allow_image_gen',               label: '允许图像生成',         kind: 'bool' },
  { key: 'allow_knowledge_base',          label: '允许知识库',           kind: 'bool' },
  { key: 'max_context_messages',          label: '最大上下文消息数',      kind: 'number' },
  // 快速抠图（阿里 viapi）：套餐里勾选这三项即开放抠图能力 + 设置月配额
  { key: 'allow_image_matting',           label: '允许快速抠图（云端中转）', kind: 'bool',   hint: '关闭后桌面端「快速抠图」入口隐藏' },
  { key: 'allow_custom_matting_provider', label: '允许自定义抠图接口',       kind: 'bool',   hint: '开启后桌面端可填自己的阿里 AK/SK 走直连' },
  { key: 'image_matting_quota_per_month', label: '快速抠图月配额（张）',     kind: 'number', hint: '0 = 不限；超出后即使有积分余额也拒绝' },
  // 精细抠图（抠抠图 koukoutu）：开放精细抠图能力 + 设置月配额
  { key: 'allow_fine_matting',            label: '允许精细抠图（抠抠图）',   kind: 'bool',   hint: '关闭后桌面端「精细抠图」入口隐藏' },
  { key: 'fine_matting_quota_per_month',  label: '精细抠图月配额（张）',     kind: 'number', hint: '0 = 不限；超出后即使有积分余额也拒绝' },
  // 去AI标记：此权限只控制「能否使用」（显示由系统设置全局开关控制）
  { key: 'allow_ai_mark_removal',         label: '允许使用去AI标记',        kind: 'bool',   hint: '控制能否使用；显示由系统设置全局开关控制，开了「全局可用」时无需此授权' },
  { key: 'ai_mark_removal_credit_per_call', label: '去AI标记单次扣费（积分）', kind: 'number', hint: '覆盖全局单价；留空/0 走系统设置的全局单价' },
  // 「店铺商品图」权限已迁至「桌面端设置 → 店铺商品图」独立页统一管理，套餐不再附带该项。
];

export default function PlansPage() {
  const { labels } = useCurrencyLabels();
  const [data, setData] = useState<any>({ data: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [params, setParams] = useState<Record<string, any>>({ page: 1, per_page: 50 });
  const [models, setModels] = useState<any[]>([]);
  const [oemProjects, setOemProjects] = useState<any[]>([]);
  const [categories, setCategories] = useState<PlanCategory[]>([]);

  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Plan | null>(null);
  const [form] = Form.useForm();
  // 监听余额模式：monthly 时把下方额度标签提示为「每月额度」，避免管理员误填全年总额
  const refillCycle = Form.useWatch('quota_refill_cycle', form);
  const isMonthly = refillCycle === 'monthly';
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [categoryEditing, setCategoryEditing] = useState<PlanCategory | null>(null);
  const [categoryForm] = Form.useForm();
  const [policies, setPolicies] = useState<PolicyRow[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<number[]>([]);
  // 桌面端「套餐商城」入口显隐开关（system_settings.plans_store_enabled），默认显示
  const [plansStoreEnabled, setPlansStoreEnabled] = useState(true);
  const [plansStoreSaving, setPlansStoreSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await planApi.list(params);
      setData(res.data);
    } catch { message.error('加载失败'); }
    setLoading(false);
  };

  const loadModels = async () => {
    try {
      const res = await modelApi.list({ per_page: 500 });
      setModels(res.data.data || res.data);
    } catch { /* ignore */ }
  };

  const loadOemProjects = async () => {
    try {
      const res = await oemProjectApi.list({ page: 1, page_size: 500, status: 'active' });
      setOemProjects(res.data.items || []);
    } catch { /* ignore */ }
  };

  const loadCategories = async () => {
    try {
      const res = await planApi.listCategories();
      setCategories(res.data.data || []);
    } catch { /* ignore */ }
  };

  const loadPlansStoreSetting = async () => {
    try {
      const res = await settingApi.get();
      setPlansStoreEnabled(res.data?.settings?.plans_store_enabled !== false);
    } catch { /* ignore */ }
  };

  const togglePlansStore = async (checked: boolean) => {
    setPlansStoreEnabled(checked);
    setPlansStoreSaving(true);
    try {
      await settingApi.update({ plans_store_enabled: checked });
      message.success(checked ? '已开启：桌面端显示套餐商城入口' : '已关闭：桌面端隐藏套餐商城入口');
    } catch {
      setPlansStoreEnabled(!checked);
      message.error('保存失败');
    } finally {
      setPlansStoreSaving(false);
    }
  };

  useEffect(() => { load(); }, [params]);
  useEffect(() => { loadModels(); loadOemProjects(); loadCategories(); loadPlansStoreSetting(); }, []);

  // 云存储容量：DB 存字节，表单按 GB 录入/展示（1 GB = 1073741824 B），加载与提交时换算
  const BYTES_PER_GB = 1073741824;

  const openCreate = () => {
    setEditing(null);
    // 新建套餐默认带上「允许自定义模型」（与全局默认一致）
    setPolicies([{ key: 'allow_custom_provider', value: 'true', kind: 'bool' }]);
    form.resetFields();
    form.setFieldsValue({
      category_id: undefined, currency: 'CNY', duration_days: 30, token_quota: 0, credit_quota: 0, storage_quota_gb: 0, sort: 0, model_ids: [],
      channel_keys: ['default'], quota_refill_cycle: 'none',
    });
    setEditOpen(true);
  };

  const openEdit = async (row: Plan) => {
    setEditing(row);
    setEditOpen(true);
    // Fetch detail (includes relations)
    try {
      const res = await planApi.get(row.id);
      const plan: any = res.data;
      form.resetFields();
      form.setFieldsValue({
        category_id: plan.category_id || undefined,
        name: plan.name,
        description: plan.description,
        price: Number(plan.price || 0),
        currency: plan.currency,
        duration_days: plan.duration_days,
        quota_refill_cycle: plan.quota_refill_cycle || 'none',
        token_quota: Number(plan.token_quota || 0),
        credit_quota: Number(plan.credit_quota || 0),
        storage_quota_gb: Number(plan.storage_quota_bytes || 0) / BYTES_PER_GB,
        sort: plan.sort,
        remark: plan.remark,
        model_ids: (plan.modelAssignments || plan.model_assignments || []).map((x: any) => x.cloud_model_id),
        channel_keys: (plan.channel_visibilities || []).map((x: any) => x.channel_key),
      });
      setPolicies((plan.permissions || []).map((p: any) => {
        const kind = detectKind(p.policy_value);
        // policy_value 已是 JSON 字符串，反序列化为编辑器可读形式
        let editValue = p.policy_value;
        try {
          const decoded = JSON.parse(p.policy_value);
          if (kind === 'bool')   editValue = decoded ? 'true' : 'false';
          else if (kind === 'number') editValue = String(decoded);
          else editValue = String(decoded);
        } catch { /* keep raw */ }
        return { key: p.policy_key, value: editValue, kind };
      }));
    } catch { message.error('加载详情失败'); setEditOpen(false); }
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    // 表单里的 storage_quota_gb（GB）换算回 storage_quota_bytes（字节）后再提交
    const { storage_quota_gb, ...rest } = values;
    const payload = {
      ...rest,
      // 强制 CNY：我们只支持国内支付通道（微信 / 未来支付宝），币种不再由管理员选择
      currency: 'CNY',
      storage_quota_bytes: Math.round(Number(storage_quota_gb || 0) * BYTES_PER_GB),
      channel_keys: values.channel_keys?.length ? values.channel_keys : ['default'],
      policies: policiesToObj(policies),
    };
    try {
      if (editing) await planApi.update(editing.id, payload);
      else await planApi.create(payload);
      message.success('已保存');
      setEditOpen(false);
      load();
    } catch (err: any) {
      message.error(err.response?.data?.error || '保存失败');
    }
  };

  const handleDelete = async (row: Plan) => {
    try {
      const res = await planApi.delete(row.id);
      if (res.data?.archived) {
        message.warning(res.data.message || '已归档');
      } else {
        message.success('已删除');
      }
      load();
    } catch { message.error('删除失败'); }
  };

  const handleToggleStatus = async (row: Plan) => {
    try {
      await planApi.update(row.id, { status: row.status === 'active' ? 'archived' : 'active' });
      message.success('已更新');
      load();
    } catch { message.error('更新失败'); }
  };

  const openCategoryModal = (category?: PlanCategory) => {
    setCategoryEditing(category || null);
    categoryForm.setFieldsValue(category || { name: '', sort_order: 0 });
    setCategoryOpen(true);
  };

  const handleCategorySubmit = async () => {
    const values = await categoryForm.validateFields();
    try {
      if (categoryEditing) {
        await planApi.updateCategory(categoryEditing.id, values);
      } else {
        await planApi.createCategory(values);
      }
      message.success('已保存');
      setCategoryOpen(false);
      loadCategories();
      load();
    } catch (err: any) {
      message.error(err.response?.data?.error || '保存失败');
    }
  };

  const handleCategoryDelete = async (id: number) => {
    try {
      await planApi.deleteCategory(id);
      message.success('已删除');
      loadCategories();
      load();
    } catch { message.error('删除失败'); }
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    {
      title: '分类', dataIndex: 'category_id', width: 110,
      render: (_: any, r: Plan) => r.category?.name || <span style={{ color: '#bbb' }}>未分类</span>,
    },
    { title: '名称', dataIndex: 'name', width: 160 },
    {
      title: '价格', dataIndex: 'price', width: 110,
      render: (v: number, r: Plan) => `${Number(v).toFixed(2)} ${r.currency}`,
    },
    {
      title: '时长', dataIndex: 'duration_days', width: 90,
      render: (v: number) => v === 0 ? '永久' : `${v} 天`,
    },
    {
      title: '余额模式', dataIndex: 'quota_refill_cycle', width: 100,
      render: (v: string) => v === 'monthly'
        ? <Tag color="cyan">按月重置</Tag>
        : <Tag>一次性</Tag>,
    },
    {
      title: '额度', width: 160,
      render: (_: any, r: Plan) => (
        <Space size={4} wrap>
          {Number(r.token_quota) > 0 && <Tag color="orange">{labels.token} {Number(r.token_quota)}</Tag>}
          {Number(r.credit_quota) > 0 && <Tag color="purple">{labels.credit} {Number(r.credit_quota)}</Tag>}
          {Number(r.storage_quota_bytes) > 0 && <Tag color="green">{(Number(r.storage_quota_bytes) / 1073741824).toFixed(1)} GB</Tag>}
        </Space>
      ),
    },
    {
      title: '可见渠道', width: 180,
      render: (_: any, r: Plan) => {
        const list = r.channel_visibilities || [];
        if (!list.length) return <span style={{ color: '#bbb' }}>-</span>;
        return (
          <Space size={4} wrap>
            {list.slice(0, 4).map((item) => (
              <Tag key={item.channel_key} color={item.channel_key === 'default' ? 'blue' : 'purple'}>
                {item.channel_key === 'default' ? '默认渠道' : (item.oem_project_name || item.channel_key)}
              </Tag>
            ))}
            {list.length > 4 && <Tag>+{list.length - 4}</Tag>}
          </Space>
        );
      },
    },
    {
      title: '状态', dataIndex: 'status', width: 90,
      render: (v: string, r: Plan) => (
        <Switch checked={v === 'active'} size="small"
          onChange={() => handleToggleStatus(r)}
          checkedChildren="启用" unCheckedChildren="归档" />
      ),
    },
    { title: '排序', dataIndex: 'sort', width: 60 },
    {
      title: '操作', width: 140,
      render: (_: any, r: Plan) => (
        <Space size={4}>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>编辑</Button>
          <Popconfirm title="确认删除？若已被用户持有，将改为归档" onConfirm={() => handleDelete(r)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, padding: '10px 14px', border: '1px solid #f0f0f0', borderRadius: 8 }}>
        <Switch checked={plansStoreEnabled} loading={plansStoreSaving} onChange={togglePlansStore}
          checkedChildren="显示" unCheckedChildren="隐藏" />
        <span style={{ fontWeight: 500 }}>桌面端套餐商城</span>
        <span style={{ color: '#999', fontSize: 12 }}>关闭后桌面端用户中心隐藏「套餐商城」入口；兑换码 / 后台发放套餐不受影响。</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space>
          <Input.Search placeholder="搜索名称" allowClear style={{ width: 220 }}
            onSearch={(v) => setParams({ ...params, keyword: v || undefined, page: 1 })} />
          <Select placeholder="分类" allowClear style={{ width: 150 }}
            options={categories.map(c => ({ value: c.id, label: c.name }))}
            onChange={(v) => setParams({ ...params, category_id: v, page: 1 })} />
          <Select placeholder="状态" allowClear style={{ width: 120 }}
            options={[{ value: 'active', label: '启用' }, { value: 'archived', label: '归档' }]}
            onChange={(v) => setParams({ ...params, status: v, page: 1 })} />
        </Space>
        <Space>
          <Button onClick={() => openCategoryModal()}>管理分类</Button>
          <BatchDeleteButton
            selectedKeys={selectedKeys}
            onClear={() => setSelectedKeys([])}
            batchDelete={planApi.batchDelete}
            onDone={load}
            itemName="套餐"
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建套餐</Button>
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

      <Modal title={editing ? `编辑套餐 · ${editing.name}` : '新建套餐'} open={editOpen}
        onOk={handleSubmit} onCancel={() => setEditOpen(false)} destroyOnClose width={640}
        mask={false}>
        <Form form={form} layout="vertical">
          <Space size={16} style={{ width: '100%' }}>
            <Form.Item name="category_id" label="分类" style={{ flex: 1 }}>
              <Select allowClear placeholder="选择分类" options={categories.map(c => ({ value: c.id, label: c.name }))} />
            </Form.Item>
            <Form.Item name="name" label="名称" rules={[{ required: true, max: 100 }]} style={{ flex: 1 }}>
              <Input placeholder="VIP 月卡" />
            </Form.Item>
          </Space>

          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} maxLength={200} showCount placeholder="套餐描述，最多 200 字" />
          </Form.Item>

          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="duration_days" label="时长（天，0=永久）" rules={[{ required: true }]}>
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="price" label="价格（元）">
                <InputNumber min={0} step={1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="sort" label="排序">
                <InputNumber style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            name="quota_refill_cycle"
            label="余额模式"
            tooltip="决定下方 token / 积分额度的发放与重置方式；云存储容量不受影响。"
            extra={isMonthly
              ? '按月重置：开通时发放一份额度，之后按开通日每满一个月重置为下方额度，上月未用完不结转；套餐到期清零。下方额度请按「每月」额度填写。'
              : '一次性：开通时一次性发放下方额度，用完即止，套餐有效期内不重置；套餐到期清零。'}
          >
            <Select
              options={[
                { value: 'none', label: '一次性余额（开通即全额，用完即止）' },
                { value: 'monthly', label: '按月重置余额（按开通日每月重置）' },
              ]}
            />
          </Form.Item>

          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="token_quota" label={isMonthly ? `每月${labels.token}额度` : `${labels.token}赠送`}>
                <InputNumber min={0} step={1} style={{ width: '100%' }} addonAfter={labels.token} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="credit_quota" label={isMonthly ? `每月${labels.credit}额度` : `${labels.credit}赠送`}>
                <InputNumber min={0} step={1} style={{ width: '100%' }} addonAfter={labels.credit} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="storage_quota_gb" label="云存储容量"
                tooltip="该套餐赠送的云同步存储容量，按 GB 填写（支持小数，如 0.5）。0 表示不赠送。">
                <InputNumber min={0} step={1} precision={2} style={{ width: '100%' }} addonAfter="GB" placeholder="如 5 表示 5GB" />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="model_ids" label="包含模型">
            <Select mode="multiple" placeholder="选择模型" allowClear
              filterOption={(input, option) =>
                (option?.label as string)?.toLowerCase().includes(input.toLowerCase())}
              options={models.map(m => {
                const base = `${m.name || m.model_id} (${m.type})`;
                return {
                  value: m.id,
                  label: m.provider?.name ? `${m.provider.name} / ${base}` : base,
                };
              })} />
          </Form.Item>

          <Form.Item
            name="channel_keys"
            label="可见渠道"
            rules={[{ required: true, message: '请至少选择一个可见渠道' }]}
            extra="默认渠道表示普通客户端可见；OEM 项目表示该专版客户端可见。"
          >
            <Select
              mode="multiple"
              allowClear
              placeholder="选择可见渠道"
              options={[
                { value: 'default', label: '默认渠道' },
                ...oemProjects.map((p) => ({ value: p.project_key, label: `${p.name} (${p.project_key})` })),
              ]}
            />
          </Form.Item>

          <Form.Item label="权限策略">
            <PolicyEditor value={policies} onChange={setPolicies} />
          </Form.Item>

          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title={categoryEditing ? '编辑套餐分类' : '新建套餐分类'} open={categoryOpen}
        onOk={handleCategorySubmit} onCancel={() => setCategoryOpen(false)} destroyOnClose
        mask={false}>
        <Form form={categoryForm} layout="vertical">
          <Form.Item name="name" label="分类名称" rules={[{ required: true, max: 100 }]}>
            <Input placeholder="例如：基础套餐" />
          </Form.Item>
          <Form.Item name="sort_order" label="排序">
            <InputNumber min={0} style={{ width: 160 }} />
          </Form.Item>
        </Form>
        <Table
          size="small"
          rowKey="id"
          dataSource={categories}
          pagination={false}
          columns={[
            { title: '名称', dataIndex: 'name' },
            { title: '套餐数', dataIndex: 'plans_count', width: 80 },
            { title: '排序', dataIndex: 'sort_order', width: 70 },
            {
              title: '操作',
              width: 130,
              render: (_: any, c: PlanCategory) => (
                <Space size={4}>
                  <Button size="small" onClick={() => openCategoryModal(c)}>编辑</Button>
                  <Popconfirm title="确认删除？套餐将变为未分类" onConfirm={() => handleCategoryDelete(c.id)}>
                    <Button size="small" danger>删除</Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ] as any}
        />
      </Modal>
    </div>
  );
}

function PolicyEditor({ value, onChange }: { value: PolicyRow[]; onChange: (v: PolicyRow[]) => void }) {
  const add = () => onChange([...value, { key: '', value: 'true', kind: 'bool' }]);
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const update = (i: number, patch: Partial<PolicyRow>) =>
    onChange(value.map((row, idx) => idx === i ? { ...row, ...patch } : row));

  return (
    <div style={{ border: '1px solid #eee', padding: 8, borderRadius: 4 }}>
      {value.length === 0 && (
        <div style={{ color: '#999', fontSize: 12, textAlign: 'center', padding: 12 }}>
          未配置策略。套餐生效时，将按"最宽松合并"写入用户权限。
        </div>
      )}
      {value.map((row, i) => (
        <Space key={i} size={8} style={{ marginBottom: 6, display: 'flex' }} align="baseline">
          <Select
            placeholder="选择或输入策略键" showSearch allowClear
            style={{ width: 220 }}
            value={row.key || undefined}
            options={KNOWN_POLICIES.map(p => ({ value: p.key, label: p.label }))}
            onChange={(k) => {
              const known = KNOWN_POLICIES.find(p => p.key === k);
              update(i, {
                key: k || '',
                kind: known?.kind || 'string',
                value: known?.kind === 'bool' ? 'true' : (known?.kind === 'number' ? '0' : ''),
              });
            }}
            onSearch={(v) => update(i, { key: v })}
          />
          <Select value={row.kind} style={{ width: 100 }}
            options={[
              { value: 'bool',   label: '布尔'     },
              { value: 'number', label: '数字'     },
              { value: 'string', label: '字符串'   },
            ]}
            onChange={(k) => update(i, { kind: k, value: k === 'bool' ? 'true' : (k === 'number' ? '0' : '') })} />
          {row.kind === 'bool' ? (
            <Select value={row.value} style={{ width: 100 }}
              options={[{ value: 'true', label: '是' }, { value: 'false', label: '否' }]}
              onChange={(v) => update(i, { value: v })} />
          ) : row.kind === 'number' ? (
            <InputNumber value={Number(row.value || 0)} style={{ width: 140 }}
              onChange={(v) => update(i, { value: String(v ?? 0) })} />
          ) : (
            <Input value={row.value} placeholder="字符串值" style={{ width: 180 }}
              onChange={(e) => update(i, { value: e.target.value })} />
          )}
          <Tooltip title="删除此策略">
            <Button size="small" danger icon={<DeleteOutlined />} onClick={() => remove(i)} />
          </Tooltip>
        </Space>
      ))}
      <Button size="small" icon={<PlusOutlined />} onClick={add}>添加策略</Button>
    </div>
  );
}

function detectKind(value: string): 'bool' | 'number' | 'string' {
  try {
    const v = JSON.parse(value);
    if (typeof v === 'boolean') return 'bool';
    if (typeof v === 'number')  return 'number';
  } catch { /* fall through */ }
  if (value === 'true' || value === 'false') return 'bool';
  if (!isNaN(Number(value))) return 'number';
  return 'string';
}

function policiesToObj(rows: PolicyRow[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const row of rows) {
    if (!row.key) continue;
    switch (row.kind) {
      case 'bool':   out[row.key] = row.value === 'true'; break;
      case 'number': out[row.key] = Number(row.value || 0); break;
      default:       out[row.key] = row.value;
    }
  }
  return out;
}
