import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Card, Tabs, Table, Button, Space, Modal, Form, Input, Select,
  Image, message, Popconfirm, Tag, InputNumber, Switch, Divider,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined,
  EyeOutlined,
} from '@ant-design/icons';
import { creativeTemplateApi, creativeTemplateHubApi } from '../services/api';
import type { CreativeTemplateVariable } from '../services/api';

const SOURCE_LABEL: Record<string, { color: string; label: string }> = {
  manual: { color: 'blue', label: '手动输入' },
  image: { color: 'purple', label: '图片反推' },
  inspiration: { color: 'orange', label: '来自灵感' },
};

const SUBMISSION_STATUS_LABEL: Record<string, { color: string; label: string }> = {
  pending: { color: 'gold', label: '待审核' },
  approved: { color: 'green', label: '已通过' },
  rejected: { color: 'red', label: '已驳回' },
  withdrawn: { color: 'default', label: '已撤回' },
};

const HUB_STATUS_LABEL: Record<string, { color: string; label: string }> = {
  pending: { color: 'gold', label: 'Hub 待审' },
  approved: { color: 'green', label: 'Hub 已通过' },
  rejected: { color: 'red', label: 'Hub 已驳回' },
};

interface Category {
  id: number;
  name: string;
  description?: string;
  sort_order: number;
  is_visible: boolean;
  templates_count?: number;
}

interface TemplateItem {
  id: number;
  category_id: number;
  title: string;
  description: string;
  cover_image: string;
  example_ref_images?: string[];
  default_size: string;
  requires_ref_image: boolean;
  prompt_template: string;
  variables: CreativeTemplateVariable[];
  source_type: 'manual' | 'image' | 'inspiration';
  source_image?: string;
  source_inspiration_id?: number | null;
  sort_order: number;
  is_visible: boolean;
  created_by_user_id?: number | null;
  submission_status?: 'pending' | 'approved' | 'rejected' | 'withdrawn';
  submitted_by_user_id?: number | null;
  submitted_by_nickname?: string;
  reviewed_by_user_id?: number | null;
  reviewed_at?: string | null;
  reject_reason?: string;
  source_local_template_id?: string;
  submitted_at?: string | null;
  published_at?: string | null;
  hub_shared_id?: number | null;
  hub_status?: 'pending' | 'approved' | 'rejected' | null;
  hub_status_synced_at?: string | null;
  from_hub_template_id?: number | null;
  from_hub_source_site_name?: string | null;
  category?: Category;
  updated_at?: string;
}

interface HubCategory {
  id: number;
  name: string;
  slug?: string;
}

export default function CreativeTemplates() {
  // ===== 全局 =====
  const [activeTab, setActiveTab] = useState<'templates' | 'categories'>('templates');
  const [categories, setCategories] = useState<Category[]>([]);

  // ===== 模板列表 =====
  const [items, setItems] = useState<TemplateItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 });
  const [filterCategoryId, setFilterCategoryId] = useState<number | undefined>();
  const [filterVisible, setFilterVisible] = useState<string | undefined>();
  const [filterSource, setFilterSource] = useState<string | undefined>();
  const [filterSubmissionStatus, setFilterSubmissionStatus] = useState<string | undefined>();
  const [searchText, setSearchText] = useState('');

  // ===== 分类管理 =====
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [catEditing, setCatEditing] = useState<Category | null>(null);
  const [catForm] = Form.useForm();

  // ===== 预览 Modal =====
  const [previewItem, setPreviewItem] = useState<TemplateItem | null>(null);
  const [previewValues, setPreviewValues] = useState<Record<string, any>>({});

  const [hubCategories, setHubCategories] = useState<HubCategory[]>([]);
  const [shareItem, setShareItem] = useState<TemplateItem | null>(null);
  const [shareSubmitting, setShareSubmitting] = useState(false);
  const [shareForm] = Form.useForm<{ hub_category_id: number }>();

  // ===== Load =====
  const loadCategories = useCallback(async () => {
    try {
      const res = await creativeTemplateApi.listCategories();
      setCategories(res.data.data || []);
    } catch {
      message.error('加载分类失败');
    }
  }, []);

  const loadHubCategories = useCallback(async () => {
    try {
      const res = await creativeTemplateHubApi.categories();
      const arr = Array.isArray(res.data) ? res.data : (res.data?.data || res.data?.items || []);
      setHubCategories(arr);
    } catch {
      setHubCategories([]);
    }
  }, []);

  const loadItems = useCallback(async (page = 1, perPage = 20) => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page, per_page: perPage };
      if (filterCategoryId) params.category_id = filterCategoryId;
      if (filterVisible !== undefined && filterVisible !== '') params.is_visible = filterVisible;
      if (filterSource) params.source_type = filterSource;
      if (filterSubmissionStatus) params.submission_status = filterSubmissionStatus;
      if (searchText) params.search = searchText;
      const res = await creativeTemplateApi.list(params);
      setItems(res.data.data || []);
      setPagination({
        current: res.data.current_page || page,
        pageSize: res.data.per_page || perPage,
        total: res.data.total || 0,
      });
    } catch {
      message.error('加载模板失败');
    }
    setLoading(false);
  }, [filterCategoryId, filterVisible, filterSource, filterSubmissionStatus, searchText]);

  useEffect(() => { loadCategories(); loadHubCategories(); }, [loadCategories, loadHubCategories]);
  useEffect(() => { loadItems(); }, [loadItems]);

  // ===== Category CRUD =====
  const openCatModal = (cat?: Category) => {
    setCatEditing(cat || null);
    catForm.setFieldsValue(cat ? {
      name: cat.name,
      description: cat.description || '',
      sort_order: cat.sort_order,
      is_visible: cat.is_visible,
    } : { name: '', description: '', sort_order: 0, is_visible: true });
    setCatModalOpen(true);
  };

  const handleCatSubmit = async () => {
    const values = await catForm.validateFields();
    try {
      if (catEditing) {
        await creativeTemplateApi.updateCategory(catEditing.id, values);
      } else {
        await creativeTemplateApi.createCategory(values);
      }
      message.success('已保存');
      setCatModalOpen(false);
      loadCategories();
    } catch {
      message.error('保存失败');
    }
  };

  const handleCatDelete = async (id: number) => {
    try {
      await creativeTemplateApi.deleteCategory(id);
      message.success('已删除');
      loadCategories();
      loadItems(pagination.current);
    } catch {
      message.error('删除失败');
    }
  };

  const handleTemplateDelete = async (id: number) => {
    try {
      await creativeTemplateApi.delete(id);
      message.success('已删除');
      loadItems(pagination.current);
    } catch {
      message.error('删除失败');
    }
  };

  const handleToggleVisible = async (item: TemplateItem, value: boolean) => {
    try {
      await creativeTemplateApi.setVisibility(item.id, value);
      message.success(value ? '已显示' : '已隐藏');
      loadItems(pagination.current);
    } catch {
      message.error('操作失败');
    }
  };

  const handleSortOrderChange = async (item: TemplateItem, value: number | null) => {
    try {
      await creativeTemplateApi.setSortOrder(item.id, Number(value) || 0);
      message.success('排序已保存');
      loadItems(pagination.current);
    } catch {
      message.error('保存排序失败');
    }
  };

  const handleApprove = async (item: TemplateItem) => {
    try {
      await creativeTemplateApi.approve(item.id);
      message.success('已通过审核并上架');
      loadItems(pagination.current);
    } catch {
      message.error('审核操作失败');
    }
  };

  const handleReject = async (item: TemplateItem) => {
    let reason = '';
    Modal.confirm({
      title: '驳回模板投稿',
      content: (
        <Input.TextArea
          rows={3}
          maxLength={500}
          showCount
          placeholder="可填写驳回原因，桌面端同步状态后可看到"
          onChange={e => { reason = e.target.value; }}
        />
      ),
      okText: '驳回',
      okButtonProps: { danger: true },
      cancelText: '取消',
      async onOk() {
        try {
          await creativeTemplateApi.reject(item.id, reason);
          message.success('已驳回');
          loadItems(pagination.current);
        } catch {
          message.error('驳回失败');
        }
      },
    });
  };

  const openShareModal = (item: TemplateItem) => {
    setShareItem(item);
    shareForm.resetFields();
    const matched = hubCategories.find(c => c.name === item.category?.name);
    if (matched) shareForm.setFieldValue('hub_category_id', matched.id);
  };

  const handleShareSubmit = async () => {
    if (!shareItem) return;
    const values = await shareForm.validateFields();
    setShareSubmitting(true);
    try {
      await creativeTemplateHubApi.shareToHub(shareItem.id, values);
      message.success('已分享到工作流模板共享市场');
      setShareItem(null);
      loadItems(pagination.current, pagination.pageSize);
    } catch (e: any) {
      message.error(e?.response?.data?.message || e?.response?.data?.error || '分享失败');
    } finally {
      setShareSubmitting(false);
    }
  };

  const handleWithdrawHubShare = async (item: TemplateItem) => {
    try {
      await creativeTemplateHubApi.withdrawFromHub(item.id);
      message.success('已撤回 Hub 分享');
      loadItems(pagination.current, pagination.pageSize);
    } catch (e: any) {
      message.error(e?.response?.data?.message || e?.response?.data?.error || '撤回失败');
    }
  };

  const handleSyncHubStatus = async () => {
    const ids = items.filter(it => it.hub_shared_id).map(it => it.id);
    if (ids.length === 0) {
      message.info('当前页没有已分享到 Hub 的模板');
      return;
    }
    try {
      await creativeTemplateHubApi.statusBatch(ids);
      message.success('Hub 状态已同步');
      loadItems(pagination.current, pagination.pageSize);
    } catch (e: any) {
      message.error(e?.response?.data?.message || e?.response?.data?.error || '同步失败');
    }
  };

  // ===== Preview =====
  const openPreview = (item: TemplateItem) => {
    const init: Record<string, any> = {};
    (item.variables || []).forEach(v => { init[v.key] = v.default || ''; });
    setPreviewValues(init);
    setPreviewItem(item);
  };

  const renderedPreviewPrompt = useMemo(() => {
    if (!previewItem) return '';
    return (previewItem.prompt_template || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
      const val = previewValues[key];
      if (Array.isArray(val)) return val.join(', ');
      return val ? String(val) : `{{${key}}}`;
    });
  }, [previewItem, previewValues]);

  // ===== Columns =====
  const columns = [
    {
      title: '封面', dataIndex: 'cover_image', width: 80,
      render: (url: string) => url ? <Image src={url} width={48} height={48} style={{ objectFit: 'cover', borderRadius: 4 }} /> : '-',
    },
    { title: '标题', dataIndex: 'title', width: 180, ellipsis: true },
    {
      title: '分类', dataIndex: 'category', width: 100,
      render: (cat: Category | undefined) => cat ? <Tag>{cat.name}</Tag> : '-',
    },
    {
      title: '审核状态', dataIndex: 'submission_status', width: 100,
      render: (v: string | undefined, r: TemplateItem) => {
        const t = SUBMISSION_STATUS_LABEL[v || 'approved'] || SUBMISSION_STATUS_LABEL.approved;
        return (
          <Space direction="vertical" size={2}>
            <Tag color={t.color}>{t.label}</Tag>
            {v === 'rejected' && r.reject_reason ? <span style={{ color: '#999', fontSize: 12 }}>{r.reject_reason}</span> : null}
          </Space>
        );
      },
    },
    {
      title: '投稿人', dataIndex: 'submitted_by_nickname', width: 130,
      render: (_: string, r: TemplateItem) => r.submitted_by_nickname
        ? <span>{r.submitted_by_nickname}{r.submitted_by_user_id ? ` (#${r.submitted_by_user_id})` : ''}</span>
        : <Tag>管理员</Tag>,
    },
    {
      title: '来源', dataIndex: 'source_type', width: 100,
      render: (v: string) => {
        const t = SOURCE_LABEL[v] || SOURCE_LABEL.manual;
        return <Tag color={t.color}>{t.label}</Tag>;
      },
    },
    {
      title: 'Hub 状态', dataIndex: 'hub_status', width: 130,
      render: (v: string | null | undefined, r: TemplateItem) => {
        if (r.from_hub_template_id) {
          return <Tag color="blue">来自 Hub</Tag>;
        }
        if (!r.hub_shared_id) return <Tag>未分享</Tag>;
        const t = HUB_STATUS_LABEL[v || 'pending'] || HUB_STATUS_LABEL.pending;
        return (
          <Space direction="vertical" size={2}>
            <Tag color={t.color}>{t.label}</Tag>
            <span style={{ color: '#999', fontSize: 12 }}>#{r.hub_shared_id}</span>
          </Space>
        );
      },
    },
    {
      title: '变量', dataIndex: 'variables', width: 80,
      render: (v: CreativeTemplateVariable[] | undefined) => v?.length ? <Tag color="cyan">{v.length} 个</Tag> : '-',
    },
    {
      title: '示例参考图', dataIndex: 'example_ref_images', width: 110,
      render: (v: string[] | undefined) => v?.length ? <Tag color="blue">{v.length} 张</Tag> : '-',
    },
    {
      title: '需参考图', dataIndex: 'requires_ref_image', width: 100,
      render: (v: boolean) => v ? <Tag color="red">需要</Tag> : <Tag>不需要</Tag>,
    },
    { title: '默认尺寸', dataIndex: 'default_size', width: 100, render: (v: string) => v ? <Tag>{v}</Tag> : '-' },
    {
      title: '显示', dataIndex: 'is_visible', width: 80,
      render: (v: boolean, r: TemplateItem) => (
        <Switch size="small" checked={!!v} disabled={r.submission_status !== 'approved'} onChange={c => handleToggleVisible(r, c)} />
      ),
    },
    {
      title: '排序', dataIndex: 'sort_order', width: 100,
      render: (v: number, r: TemplateItem) => (
        <InputNumber min={0} size="small" defaultValue={v || 0} onBlur={e => handleSortOrderChange(r, Number(e.target.value) || 0)} />
      ),
    },
    {
      title: '操作', key: 'op', fixed: 'right' as const, width: 240,
      render: (_: any, r: TemplateItem) => (
        <Space size="small">
          <Button size="small" icon={<EyeOutlined />} onClick={() => openPreview(r)}>预览</Button>
          {r.submission_status === 'pending' && (
            <>
              <Button size="small" type="primary" onClick={() => handleApprove(r)}>通过</Button>
              <Button size="small" danger onClick={() => handleReject(r)}>驳回</Button>
            </>
          )}
          {r.from_hub_template_id ? null : r.hub_shared_id ? (
            <Popconfirm
              title="撤回 Hub 分享？"
              description="撤回后该模板会从工作流模板共享市场删除，本地模板不受影响"
              onConfirm={() => handleWithdrawHubShare(r)}
            >
              <Button size="small">撤回分享</Button>
            </Popconfirm>
          ) : (
            <Button
              size="small"
              disabled={r.submission_status !== 'approved' || !r.is_visible}
              onClick={() => openShareModal(r)}
            >
              分享 Hub
            </Button>
          )}
          <Popconfirm
            title="删除该模板？"
            description="同步删除封面 / 示例参考图 / 反推源图文件，不可恢复"
            okText="删除"
            okButtonProps={{ danger: true }}
            onConfirm={() => handleTemplateDelete(r.id)}
          >
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // ===== Render =====
  return (
    <div>
      <Tabs
        activeKey={activeTab}
        onChange={k => setActiveTab(k as 'templates' | 'categories')}
        items={[
          {
            key: 'templates',
            label: '模板列表',
            children: (
              <Card variant="outlined">
                <Space style={{ marginBottom: 16 }} wrap>
                  <Select
                    allowClear placeholder="筛选分类" style={{ width: 180 }}
                    value={filterCategoryId}
                    onChange={v => setFilterCategoryId(v)}
                    options={categories.map(c => ({ label: c.name, value: c.id }))}
                  />
                  <Select
                    allowClear placeholder="筛选来源" style={{ width: 140 }}
                    value={filterSource}
                    onChange={v => setFilterSource(v)}
                    options={Object.entries(SOURCE_LABEL).map(([k, v]) => ({ label: v.label, value: k }))}
                  />
                  <Select
                    allowClear placeholder="可见性" style={{ width: 110 }}
                    value={filterVisible}
                    onChange={v => setFilterVisible(v)}
                    options={[
                      { label: '已显示', value: '1' },
                      { label: '已隐藏', value: '0' },
                    ]}
                  />
                  <Select
                    allowClear placeholder="审核状态" style={{ width: 130 }}
                    value={filterSubmissionStatus}
                    onChange={v => setFilterSubmissionStatus(v)}
                    options={Object.entries(SUBMISSION_STATUS_LABEL).map(([value, meta]) => ({ label: meta.label, value }))}
                  />
                  <Input.Search
                    placeholder="搜索标题 / 描述 / 提示词" style={{ width: 280 }}
                    value={searchText}
                    onChange={e => setSearchText(e.target.value)}
                    onSearch={() => loadItems(1, pagination.pageSize)}
                    allowClear
                  />
                  <Button icon={<ReloadOutlined />} onClick={() => loadItems(pagination.current, pagination.pageSize)}>刷新</Button>
                  <Button onClick={handleSyncHubStatus}>同步 Hub 状态</Button>
                </Space>
                <Table
                  rowKey="id"
                  columns={columns}
                  dataSource={items}
                  loading={loading}
                  scroll={{ x: 1280 }}
                  pagination={{
                    current: pagination.current,
                    pageSize: pagination.pageSize,
                    total: pagination.total,
                    showSizeChanger: true,
                    showTotal: t => `共 ${t} 个模板`,
                    onChange: (p, s) => loadItems(p, s),
                  }}
                />
              </Card>
            ),
          },
          {
            key: 'categories',
            label: '分类管理',
            children: (
              <Card
                variant="outlined"
                extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => openCatModal()}>新建分类</Button>}
              >
                <Table
                  rowKey="id"
                  dataSource={categories}
                  columns={[
                    { title: '名称', dataIndex: 'name', width: 200 },
                    { title: '描述', dataIndex: 'description', ellipsis: true },
                    { title: '模板数', dataIndex: 'templates_count', width: 100, render: (v: number) => <Tag color={v ? 'cyan' : 'default'}>{v ?? 0}</Tag> },
                    { title: '排序', dataIndex: 'sort_order', width: 80 },
                    {
                      title: '可见', dataIndex: 'is_visible', width: 80,
                      render: (v: boolean) => v ? <Tag color="green">是</Tag> : <Tag>否</Tag>,
                    },
                    {
                      title: '操作', key: 'op', width: 160,
                      render: (_: any, r: Category) => (
                        <Space size="small">
                          <Button size="small" icon={<EditOutlined />} onClick={() => openCatModal(r)}>编辑</Button>
                          <Popconfirm
                            title="删除分类？"
                            description="同时删除该分类下的所有模板（含文件），不可恢复"
                            okText="删除"
                            okButtonProps={{ danger: true }}
                            onConfirm={() => handleCatDelete(r.id)}
                          >
                            <Button size="small" danger icon={<DeleteOutlined />} />
                          </Popconfirm>
                        </Space>
                      ),
                    },
                  ]}
                  pagination={false}
                />
              </Card>
            ),
          },
        ]}
      />

      {/* 分类编辑 Modal */}
      <Modal
        title={catEditing ? '编辑分类' : '新建分类'}
        open={catModalOpen}
        onCancel={() => setCatModalOpen(false)}
        onOk={handleCatSubmit}
        okText="保存"
        destroyOnHidden
      >
        <Form form={catForm} layout="vertical" preserve={false}>
          <Form.Item name="name" label="分类名称" rules={[{ required: true, max: 50 }]}>
            <Input placeholder="例如：人像写实 / 商品海报 / 国潮插画" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} maxLength={500} showCount placeholder="可选，简短说明该分类的用途" />
          </Form.Item>
          <Form.Item name="sort_order" label="排序（数字越小越靠前）"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="is_visible" label="桌面端可见" valuePropName="checked" initialValue><Switch /></Form.Item>
        </Form>
      </Modal>

      <Modal
        title={shareItem ? `分享到工作流模板共享市场：${shareItem.title}` : '分享到工作流模板共享市场'}
        open={!!shareItem}
        onCancel={() => setShareItem(null)}
        onOk={handleShareSubmit}
        okText="分享"
        confirmLoading={shareSubmitting}
        destroyOnHidden
        maskStyle={{ display: 'none' }}
      >
        <Form form={shareForm} layout="vertical" preserve={false}>
          <Form.Item
            name="hub_category_id"
            label="Hub 分类"
            rules={[{ required: true, message: '请选择 Hub 分类' }]}
          >
            <Select
              placeholder="选择共享库分类"
              options={hubCategories.map(c => ({ label: c.name, value: c.id }))}
            />
          </Form.Item>
          <div style={{ color: '#888', fontSize: 12 }}>
            分享时 Hub 仅保存本站公开图片 URL；其他云控端拉取时会下载并本地化保存图片。
          </div>
        </Form>
      </Modal>

      {/* 模板预览 Modal：渲染最终 prompt + 变量表单 */}
      <Modal
        title={previewItem ? `预览：${previewItem.title}` : '预览'}
        open={!!previewItem}
        onCancel={() => setPreviewItem(null)}
        footer={<Button onClick={() => setPreviewItem(null)}>关闭</Button>}
        width={720}
        destroyOnHidden
      >
        {previewItem && (
          <div>
            {previewItem.cover_image && (
              <Image src={previewItem.cover_image} style={{ maxHeight: 200, marginBottom: 12, borderRadius: 6 }} />
            )}
            {previewItem.description && <p style={{ color: '#888' }}>{previewItem.description}</p>}
            <Divider>填写变量预览</Divider>
            {(previewItem.variables || []).map(v => (
              <Form.Item key={v.key} label={`${v.label}（${v.key}）`} required={v.required}>
                {v.type === 'textarea' ? (
                  <Input.TextArea rows={2} placeholder={v.placeholder} value={previewValues[v.key] || ''} onChange={e => setPreviewValues(p => ({ ...p, [v.key]: e.target.value }))} />
                ) : v.type === 'select' ? (
                  <Select value={previewValues[v.key]} options={(v.options || []).map(o => ({ label: o, value: o }))} onChange={val => setPreviewValues(p => ({ ...p, [v.key]: val }))} allowClear />
                ) : v.type === 'multi_select' ? (
                  <Select mode="multiple" value={previewValues[v.key] || []} options={(v.options || []).map(o => ({ label: o, value: o }))} onChange={val => setPreviewValues(p => ({ ...p, [v.key]: val }))} allowClear />
                ) : (
                  <Input placeholder={v.placeholder} value={previewValues[v.key] || ''} onChange={e => setPreviewValues(p => ({ ...p, [v.key]: e.target.value }))} />
                )}
              </Form.Item>
            ))}
            <Divider>最终提示词</Divider>
            <Input.TextArea rows={8} value={renderedPreviewPrompt} readOnly />
            {previewItem.example_ref_images?.length ? (
              <>
                <Divider>示例参考图</Divider>
                <Image.PreviewGroup>
                  <Space wrap>
                    {previewItem.example_ref_images.map((u, i) => (
                      <Image key={i} src={u} width={96} height={96} style={{ objectFit: 'cover', borderRadius: 4 }} />
                    ))}
                  </Space>
                </Image.PreviewGroup>
              </>
            ) : null}
          </div>
        )}
      </Modal>
    </div>
  );
}
