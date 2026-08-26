import { useEffect, useState, useCallback } from 'react';
import {
  Card, Switch, Table, Button, Space, Modal, Form, Input, Select,
  Upload, Image, message, Popconfirm, Tag, Tabs, InputNumber, Tooltip,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, UploadOutlined,
  ReloadOutlined, CheckOutlined, CloseOutlined,
  ShareAltOutlined, CloudUploadOutlined, RollbackOutlined,
} from '@ant-design/icons';
import { inspirationApi, inspirationHubApi } from '../services/api';
import { makeThumbnailBlob } from '../utils/makeThumbnail';

const STATUS_TAG: Record<string, { color: string; label: string }> = {
  pending: { color: 'gold', label: '待审核' },
  approved: { color: 'green', label: '已通过' },
  rejected: { color: 'red', label: '已拒绝' },
};

interface Category {
  id: number;
  name: string;
  sort_order: number;
}

interface InspirationItem {
  id: number;
  category_id: number;
  title: string;
  cover_image: string;
  ref_images?: string[];
  generation_size?: string | null;
  prompt_cn: string;
  prompt_en: string;
  sort_order: number;
  category?: Category;
  uploader_user_id?: number | null;
  uploader_nickname?: string;
  status: 'pending' | 'approved' | 'rejected';
  is_visible: boolean;
  // 共享灵感库相关
  hub_shared_id?: number | null;
  hub_status?: 'pending' | 'approved' | 'rejected' | null;
  hub_status_synced_at?: string | null;
  from_hub_inspiration_id?: number | null;
  from_hub_source_site_name?: string | null;
}

// hub 端返回的分类，与本地 InspirationCategory 不是同一张表
interface HubCategory {
  id: number;
  name: string;
  slug: string;
  sort_order?: number;
}

const HUB_STATUS_TAG: Record<string, { color: string; label: string }> = {
  pending: { color: 'gold', label: 'Hub 待审' },
  approved: { color: 'green', label: 'Hub 通过' },
  rejected: { color: 'red', label: 'Hub 拒绝' },
};

export default function Inspirations() {
  const [skipAudit, setSkipAudit] = useState<boolean>(false);
  const [skipAuditLoading, setSkipAuditLoading] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<InspirationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 });
  const [filterCategoryId, setFilterCategoryId] = useState<number | undefined>();
  const [filterStatus, setFilterStatus] = useState<string | undefined>();
  const [searchText, setSearchText] = useState('');
  const [uploaderKeyword, setUploaderKeyword] = useState('');

  // 共享灵感库（hub）状态
  //   - hubReady: 本站是否启用 + 配齐 endpoint/origin（控制操作列「分享/撤回」是否显示）
  //   - hubCategories: 分享 Modal 内的 hub 分类下拉数据（首次打开 Modal 时懒加载）
  const [hubReady, setHubReady] = useState(false);
  const [hubCategories, setHubCategories] = useState<HubCategory[]>([]);
  const [hubCategoriesLoading, setHubCategoriesLoading] = useState(false);
  const [shareModalItem, setShareModalItem] = useState<InspirationItem | null>(null);
  const [shareSubmitting, setShareSubmitting] = useState(false);
  const [shareForm] = Form.useForm<{ hub_category_id: number }>();
  const [syncingStatus, setSyncingStatus] = useState(false);

  // Category modal
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [catEditing, setCatEditing] = useState<Category | null>(null);
  const [catForm] = Form.useForm();

  // Inspiration modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<InspirationItem | null>(null);
  const [form] = Form.useForm();
  const [fileList, setFileList] = useState<any[]>([]);
  const [refFileList, setRefFileList] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Load config
  const loadConfig = useCallback(async () => {
    try {
      const res = await inspirationApi.getConfig();
      setSkipAudit(!!res.data.skip_audit);
    } catch { /* ignore */ }
  }, []);

  // 加载 hub 就绪状态（仅用于判断表格是否显示 hub 相关列 / 操作）
  const loadHubStatus = useCallback(async () => {
    try {
      const res = await inspirationHubApi.adminGetSettings();
      setHubReady(!!res.data?.ready);
    } catch {
      setHubReady(false);
    }
  }, []);

  // hub 分享 Modal 打开时懒加载 hub 分类列表。
  // 不在页面 mount 时预加载：hub 未启用 / 未配置时该接口会 503，避免页面初加载报错。
  // 返回最新值给调用方直接用（避免 setState 异步 + 闭包旧值导致的预选 miss）。
  // 显式泛型修正 useCallback 在 React 19 下对 async 函数返回值类型推断为 void 的问题。
  const loadHubCategories = useCallback<() => Promise<HubCategory[]>>(async () => {
    if (hubCategories.length > 0) return hubCategories;
    setHubCategoriesLoading(true);
    try {
      const res = await inspirationHubApi.categories();
      const arr: HubCategory[] = Array.isArray(res.data) ? res.data : (res.data?.data || res.data?.items || []);
      setHubCategories(arr);
      return arr;
    } catch (e: any) {
      message.error(e?.response?.data?.error || '加载 Hub 分类失败');
      return [];
    } finally {
      setHubCategoriesLoading(false);
    }
  }, [hubCategories]);

  // Load categories
  const loadCategories = useCallback(async () => {
    try {
      const res = await inspirationApi.listCategories();
      setCategories(res.data.data || []);
    } catch { /* ignore */ }
  }, []);

  // 载入列表后 silent 同步本页处于 hub pending / 未同步的灵感的最新 hub_status：
  //   - schedule 任务每 5 分钟全量同步一次（见 SyncHubStatus 命令）
  //   - 但管理员刚刷新页面时希望立即看到「Hub 通过」/「Hub 拒绝」最新结果
  //   - 这里只同步本页里 hub_shared_id != null 且 hub_status ∈ {null, 'pending'} 的灵感（成本低）
  // fire-and-forget：不阻塞页面 loading，结果回来后用 setItems 局部 patch 受影响行
  const silentSyncHubStatus = useCallback(async (rows: InspirationItem[]) => {
    const pendingIds = rows
      .filter(i => i.hub_shared_id && (!i.hub_status || i.hub_status === 'pending'))
      .map(i => i.id);
    if (pendingIds.length === 0) return;
    try {
      const res = await inspirationHubApi.statusBatch(pendingIds);
      const updated: Array<{
        local_id: number;
        hub_status?: 'pending' | 'approved' | 'rejected' | null;
        hub_status_synced_at?: string | null;
      }> = res.data?.items || [];
      if (updated.length === 0) return;
      const map = new Map(updated.map(u => [u.local_id, u]));
      setItems(prev => prev.map(it => {
        const u = map.get(it.id);
        if (!u) return it;
        return {
          ...it,
          hub_status: u.hub_status ?? it.hub_status,
          hub_status_synced_at: u.hub_status_synced_at ?? it.hub_status_synced_at,
        };
      }));
    } catch { /* silent：管理员可手动点「同步 Hub 状态」按钮兜底 */ }
  }, []);

  // Load inspirations
  const loadItems = useCallback(async (page = 1, perPage = 20) => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page, per_page: perPage };
      if (filterCategoryId) params.category_id = filterCategoryId;
      if (filterStatus) params.status = filterStatus;
      if (searchText) params.search = searchText;
      if (uploaderKeyword) params.uploader_keyword = uploaderKeyword;
      const res = await inspirationApi.list(params);
      const data = res.data.data || [];
      setItems(data);
      setPagination({
        current: res.data.current_page || page,
        pageSize: res.data.per_page || perPage,
        total: res.data.total || 0,
      });
      // hub 启用时静默对齐本页 pending 项的最新状态，让用户不用点「同步」按钮也能立即看到结果
      if (hubReady) {
        silentSyncHubStatus(data);
      }
    } catch { message.error('加载失败'); }
    setLoading(false);
  }, [filterCategoryId, filterStatus, searchText, uploaderKeyword, hubReady, silentSyncHubStatus]);

  useEffect(() => { loadConfig(); loadCategories(); loadHubStatus(); }, [loadConfig, loadCategories, loadHubStatus]);
  useEffect(() => { loadItems(); }, [loadItems]);

  // Toggle skip_audit
  const handleSkipAuditChange = async (checked: boolean) => {
    setSkipAuditLoading(true);
    try {
      await inspirationApi.updateConfig({ skip_audit: checked });
      setSkipAudit(checked);
      message.success(checked ? '已开启免审：桌面端上传直接生效' : '已关闭免审：桌面端上传走审核流');
    } catch { message.error('切换失败'); }
    setSkipAuditLoading(false);
  };

  // Category CRUD
  const openCatModal = (cat?: Category) => {
    setCatEditing(cat || null);
    catForm.setFieldsValue(cat || { name: '', sort_order: 0 });
    setCatModalOpen(true);
  };

  const handleCatSubmit = async () => {
    const values = await catForm.validateFields();
    try {
      if (catEditing) {
        await inspirationApi.updateCategory(catEditing.id, values);
      } else {
        await inspirationApi.createCategory(values);
      }
      message.success('保存成功');
      setCatModalOpen(false);
      loadCategories();
    } catch { message.error('保存失败'); }
  };

  const handleCatDelete = async (id: number) => {
    try {
      await inspirationApi.deleteCategory(id);
      message.success('已删除');
      loadCategories();
      loadItems();
    } catch { message.error('删除失败（分类下可能还有灵感数据）'); }
  };

  // Inspiration CRUD
  const openModal = (item?: InspirationItem) => {
    setEditing(item || null);
    if (item) {
      form.setFieldsValue({
        category_id: item.category_id,
        title: item.title,
        prompt_cn: item.prompt_cn,
        prompt_en: item.prompt_en,
        sort_order: item.sort_order,
        generation_size: item.generation_size || '',
      });
      if (item.cover_image) {
        setFileList([{ uid: '-1', name: 'cover', status: 'done', url: item.cover_image }]);
      } else {
        setFileList([]);
      }
      setRefFileList((item.ref_images || []).map((url, index) => ({
        uid: `ref-${index}`,
        name: `参考图 ${index + 1}`,
        status: 'done',
        url,
      })));
    } else {
      form.resetFields();
      setFileList([]);
      setRefFileList([]);
    }
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('category_id', String(values.category_id));
      fd.append('title', values.title);
      fd.append('prompt_cn', values.prompt_cn || '');
      fd.append('prompt_en', values.prompt_en || '');
      fd.append('sort_order', String(values.sort_order || 0));
      fd.append('generation_size', values.generation_size || '');

      if (fileList.length > 0 && fileList[0].originFileObj) {
        fd.append('cover_image', fileList[0].originFileObj);
        // 随封面附带缩略图（网格列表用），失败则跳过、云端回退原图
        const coverThumb = await makeThumbnailBlob(fileList[0].originFileObj, 720);
        if (coverThumb) fd.append('cover_thumb', coverThumb, 'thumb.jpg');
      } else if (editing && !fileList.length && editing.cover_image) {
        fd.append('remove_cover', '1');
      }

      const existingRefImages = refFileList
        .filter(file => !file.originFileObj && file.url)
        .map(file => file.url);
      fd.append('existing_ref_images', JSON.stringify(existingRefImages));
      refFileList
        .filter(file => file.originFileObj)
        .forEach(file => fd.append('ref_images[]', file.originFileObj));

      if (editing) {
        fd.append('_method', 'PUT');
        await inspirationApi.update(editing.id, fd);
      } else {
        await inspirationApi.create(fd);
      }
      message.success('保存成功');
      setModalOpen(false);
      loadItems(pagination.current);
    } catch (e: any) {
      message.error(e?.response?.data?.error || '保存失败');
    }
    setSubmitting(false);
  };

  const handleDelete = async (id: number) => {
    try {
      await inspirationApi.delete(id);
      message.success('已删除');
      loadItems(pagination.current);
    } catch { message.error('删除失败'); }
  };

  const handleApprove = async (id: number) => {
    try {
      await inspirationApi.approve(id);
      message.success('已通过审核');
      loadItems(pagination.current);
    } catch { message.error('操作失败'); }
  };

  const handleReject = async (id: number) => {
    try {
      await inspirationApi.reject(id);
      message.success('已拒绝');
      loadItems(pagination.current);
    } catch { message.error('操作失败'); }
  };

  const handleSetVisibility = async (id: number, visible: boolean) => {
    try {
      await inspirationApi.setVisibility(id, visible);
      message.success(visible ? '已显示' : '已隐藏');
      loadItems(pagination.current);
    } catch { message.error('操作失败'); }
  };

  // 打开分享 Modal（并懒加载 hub 分类）
  const openShareModal = async (item: InspirationItem) => {
    setShareModalItem(item);
    shareForm.resetFields();
    // 用 loadHubCategories 的返回值做预选，避免 setState 异步导致首次匹配为空
    const cats = await loadHubCategories();
    const localCat = item.category?.name;
    if (localCat) {
      const matched = cats.find(c => c.name === localCat);
      if (matched) shareForm.setFieldValue('hub_category_id', matched.id);
    }
  };

  const handleShareSubmit = async () => {
    if (!shareModalItem) return;
    const values = await shareForm.validateFields();
    setShareSubmitting(true);
    try {
      await inspirationHubApi.shareToHub(shareModalItem.id, { hub_category_id: values.hub_category_id });
      message.success('已提交到灵感共享市场，等待审核');
      setShareModalItem(null);
      loadItems(pagination.current);
    } catch (e: any) {
      const err = e?.response?.data?.error;
      const msg = e?.response?.data?.message;
      if (err === 'cover_image_unreachable') {
        message.error(msg || '封面图无公网 URL，请先在「系统设置」配置存储或 APP_URL');
      } else if (err === 'already_shared') {
        message.warning('该灵感已分享过，请先撤回后重试');
        loadItems(pagination.current);
      } else if (err === 'inspiration_hub_not_configured') {
        message.error('灵感共享市场未配置，请先去「系统设置 · 灵感共享市场」填写');
      } else {
        message.error(msg || err || '分享失败');
      }
    } finally {
      setShareSubmitting(false);
    }
  };

  const handleWithdraw = async (item: InspirationItem) => {
    try {
      await inspirationHubApi.withdrawFromHub(item.id);
      message.success('已撤回分享');
      loadItems(pagination.current);
    } catch (e: any) {
      message.error(e?.response?.data?.message || e?.response?.data?.error || '撤回失败');
    }
  };

  // 手动同步当前页所有已分享灵感的 hub 状态。
  // 后台有 schedule 任务每 5 分钟同步一次，但管理员希望立刻看到最新状态时可手倒。
  const handleSyncStatus = async () => {
    const ids = items.filter(i => i.hub_shared_id).map(i => i.id);
    if (ids.length === 0) {
      message.info('当前页没有已分享的灵感');
      return;
    }
    setSyncingStatus(true);
    try {
      const res = await inspirationHubApi.statusBatch(ids);
      const count = res.data?.items?.length || 0;
      message.success(`已同步 ${count} 条状态`);
      loadItems(pagination.current);
    } catch (e: any) {
      message.error(e?.response?.data?.error || '同步失败');
    } finally {
      setSyncingStatus(false);
    }
  };

  const columns = [
    {
      title: '封面',
      dataIndex: 'cover_image',
      width: 80,
      render: (url: string) => url ? <Image src={url} width={50} height={50} style={{ objectFit: 'cover', borderRadius: 4 }} /> : '-',
    },
    { title: '标题', dataIndex: 'title', width: 150 },
    {
      title: '分类',
      dataIndex: 'category',
      width: 100,
      render: (cat: Category | undefined) => cat ? <Tag>{cat.name}</Tag> : '-',
    },
    {
      title: '上传者',
      dataIndex: 'uploader_nickname',
      width: 110,
      render: (v: string | undefined, r: InspirationItem) =>
        v ? <Tag color="gold">@{v}</Tag>
          : <span style={{ color: '#bbb', fontSize: 12 }}>{r.uploader_user_id ? '用户已删除' : '管理员'}</span>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (v: string) => {
        const t = STATUS_TAG[v] || STATUS_TAG.approved;
        return <Tag color={t.color}>{t.label}</Tag>;
      },
    },
    {
      title: '显示',
      dataIndex: 'is_visible',
      width: 70,
      render: (v: boolean, r: InspirationItem) => (
        <Switch
          size="small"
          checked={!!v}
          onChange={(c) => handleSetVisibility(r.id, c)}
          disabled={r.status === 'rejected'}
        />
      ),
    },
    {
      title: '中文提示词',
      dataIndex: 'prompt_cn',
      ellipsis: true,
      render: (v: string) => v ? v.slice(0, 60) + (v.length > 60 ? '...' : '') : '-',
    },
    {
      title: '英文提示词',
      dataIndex: 'prompt_en',
      ellipsis: true,
      render: (v: string) => v ? v.slice(0, 60) + (v.length > 60 ? '...' : '') : '-',
    },
    {
      title: '参考图',
      dataIndex: 'ref_images',
      width: 80,
      render: (v: string[] | undefined) => (v?.length ? <Tag color="blue">{v.length} 张</Tag> : '-'),
    },
    {
      title: '尺寸',
      dataIndex: 'generation_size',
      width: 90,
      render: (v: string | null | undefined) => v ? <Tag>{v}</Tag> : '-',
    },
    { title: '排序', dataIndex: 'sort_order', width: 60 },
    // 共享库状态列 - 仅 hub 启用时显示
    ...(hubReady ? [{
      title: '共享库',
      key: 'hub_status_col',
      width: 130,
      render: (_: any, r: InspirationItem) => {
        // 优先判断：该灵感是从 hub 拉来的 -> 「来自 Hub」 Tag
        if (r.from_hub_inspiration_id) {
          return (
            <Tooltip title={r.from_hub_source_site_name ? `来源：${r.from_hub_source_site_name}` : '从共享库拉取'}>
              <Tag color="blue">来自 Hub</Tag>
            </Tooltip>
          );
        }
        // 本地原生灵感 + 已分享
        if (r.hub_shared_id) {
          const t = r.hub_status ? HUB_STATUS_TAG[r.hub_status] : { color: 'default', label: 'Hub 未同步' };
          return (
            <Tooltip title={`Hub ID: ${r.hub_shared_id}${r.hub_status_synced_at ? ` · 同步于 ${r.hub_status_synced_at}` : ''}`}>
              <Tag color={t.color}>{t.label}</Tag>
            </Tooltip>
          );
        }
        return <span style={{ color: '#bbb', fontSize: 12 }}>未分享</span>;
      },
    }] : []),
    {
      title: '操作',
      width: hubReady ? 320 : 240,
      fixed: 'right' as const,
      render: (_: any, record: InspirationItem) => (
        <Space size="small" wrap>
          {record.status === 'pending' && (
            <>
              <Popconfirm
                title="通过审核？"
                description="桌面端将立即可见该灵感"
                onConfirm={() => handleApprove(record.id)}
                okText="通过"
              >
                <Button size="small" type="primary" icon={<CheckOutlined />}>通过</Button>
              </Popconfirm>
              <Popconfirm
                title="拒绝审核？"
                description="拒绝后桌面端不可见，可后续删除释放存储"
                onConfirm={() => handleReject(record.id)}
                okText="拒绝"
                okButtonProps={{ danger: true }}
              >
                <Button size="small" danger icon={<CloseOutlined />}>拒绝</Button>
              </Popconfirm>
            </>
          )}
          {record.status === 'rejected' && (
            <Popconfirm
              title="重新通过审核？"
              onConfirm={() => handleApprove(record.id)}
              okText="通过"
            >
              <Button size="small" icon={<CheckOutlined />}>重新通过</Button>
            </Popconfirm>
          )}
          {/* 共享灵感库操作。仅 hub 就绪 + status=approved + 非从 hub 拉取的本地灵感才可分享。 */}
          {hubReady && record.status === 'approved' && !record.from_hub_inspiration_id && (
            record.hub_shared_id ? (
              <Popconfirm
                title="撤回共享？"
                description="从灵感共享市场下架这条灵感。其他云控端将不再看到。"
                onConfirm={() => handleWithdraw(record)}
                okText="撤回"
                okButtonProps={{ danger: true }}
              >
                <Button size="small" icon={<RollbackOutlined />}>撤回</Button>
              </Popconfirm>
            ) : (
              <Button
                size="small"
                type="primary"
                ghost
                icon={<ShareAltOutlined />}
                onClick={() => openShareModal(record)}
              >
                分享
              </Button>
            )
          )}
          <Button size="small" icon={<EditOutlined />} onClick={() => openModal(record)} />
          <Popconfirm
            title="删除该灵感？"
            description="将同步删除封面图片文件（本地或云存储），无法恢复"
            onConfirm={() => handleDelete(record.id)}
            okText="删除"
            okButtonProps={{ danger: true }}
          >
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Card size="small" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 500 }}>免审：</span>
          <Switch
            checked={skipAudit}
            onChange={handleSkipAuditChange}
            loading={skipAuditLoading}
            checkedChildren="开"
            unCheckedChildren="关"
          />
          <span style={{ color: '#888', fontSize: 12 }}>
            {skipAudit
              ? '桌面端用户上传后直接审核通过，无需管理员介入'
              : '桌面端上传需管理员审核后才会出现在灵感广场'}
          </span>
        </div>
      </Card>

      <Tabs
        items={[
          {
            key: 'items',
            label: '灵感列表',
            children: (
              <>
                <div style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Select
                    allowClear
                    placeholder="按分类筛选"
                    style={{ width: 160 }}
                    value={filterCategoryId}
                    onChange={(v) => setFilterCategoryId(v)}
                    options={categories.map(c => ({ label: c.name, value: c.id }))}
                  />
                  <Select
                    allowClear
                    placeholder="状态筛选"
                    style={{ width: 130 }}
                    value={filterStatus}
                    onChange={(v) => setFilterStatus(v)}
                    options={[
                      { value: 'pending', label: '待审核' },
                      { value: 'approved', label: '已通过' },
                      { value: 'rejected', label: '已拒绝' },
                    ]}
                  />
                  <Input.Search
                    placeholder="搜索标题/提示词..."
                    style={{ width: 240 }}
                    onSearch={(v) => setSearchText(v)}
                    allowClear
                  />
                  <Input.Search
                    placeholder="按上传者昵称/用户名..."
                    style={{ width: 220 }}
                    onSearch={(v) => setUploaderKeyword(v)}
                    allowClear
                  />
                  <Button icon={<ReloadOutlined />} onClick={() => loadItems()}>刷新</Button>
                  {hubReady && (
                    <Tooltip title="手动同步当前页已分享灵感的 Hub 状态（后台每 5 分钟自动同步一次）">
                      <Button
                        icon={<CloudUploadOutlined />}
                        onClick={handleSyncStatus}
                        loading={syncingStatus}
                      >
                        同步 Hub 状态
                      </Button>
                    </Tooltip>
                  )}
                  <Button type="primary" icon={<PlusOutlined />} onClick={() => openModal()}>新增</Button>
                </div>
                <Table
                  rowKey="id"
                  columns={columns}
                  dataSource={items}
                  loading={loading}
                  size="small"
                  scroll={{ x: 1400 }}
                  pagination={{
                    ...pagination,
                    showSizeChanger: true,
                    onChange: (page, pageSize) => loadItems(page, pageSize),
                  }}
                />
              </>
            ),
          },
          {
            key: 'categories',
            label: '分类管理',
            children: (
              <>
                <div style={{ marginBottom: 12 }}>
                  <Button type="primary" icon={<PlusOutlined />} onClick={() => openCatModal()}>
                    新增分类
                  </Button>
                </div>
                <Table
                  rowKey="id"
                  size="small"
                  dataSource={categories}
                  columns={[
                    { title: '分类名', dataIndex: 'name' },
                    { title: '排序', dataIndex: 'sort_order', width: 80 },
                    {
                      title: '操作',
                      width: 120,
                      render: (_: any, record: Category) => (
                        <Space size="small">
                          <Button size="small" icon={<EditOutlined />} onClick={() => openCatModal(record)} />
                          <Popconfirm title="删除该分类会一并删除其下所有灵感数据，确定？" onConfirm={() => handleCatDelete(record.id)}>
                            <Button size="small" danger icon={<DeleteOutlined />} />
                          </Popconfirm>
                        </Space>
                      ),
                    },
                  ]}
                  pagination={false}
                />
              </>
            ),
          },
        ]}
      />

      {/* Category Modal */}
      <Modal
        title={catEditing ? '编辑分类' : '新增分类'}
        open={catModalOpen}
        onOk={handleCatSubmit}
        onCancel={() => setCatModalOpen(false)}
        destroyOnClose
      >
        <Form form={catForm} layout="vertical">
          <Form.Item name="name" label="分类名" rules={[{ required: true, message: '请输入分类名' }]}>
            <Input maxLength={50} />
          </Form.Item>
          <Form.Item name="sort_order" label="排序（越小越靠前）">
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Inspiration Modal */}
      <Modal
        title={editing ? '编辑灵感' : '新增灵感'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        confirmLoading={submitting}
        width={640}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="category_id" label="分类" rules={[{ required: true, message: '请选择分类' }]}>
            <Select
              options={categories.map(c => ({ label: c.name, value: c.id }))}
              placeholder="请选择分类"
            />
          </Form.Item>
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item label="封面图片" extra="支持 PNG/JPEG/WEBP，最大 5MB">
            <Upload
              listType="picture-card"
              fileList={fileList}
              beforeUpload={() => false}
              onChange={({ fileList: fl }) => setFileList(fl.slice(-1))}
              accept="image/png,image/jpeg,image/webp"
              maxCount={1}
            >
              {fileList.length < 1 && (
                <div>
                  <UploadOutlined />
                  <div style={{ marginTop: 8 }}>上传</div>
                </div>
              )}
            </Upload>
          </Form.Item>
          <Form.Item label="参考图" extra="支持 PNG/JPEG/WEBP，单张最大 5MB，最多 8 张">
            <Upload
              listType="picture-card"
              fileList={refFileList}
              beforeUpload={() => false}
              onChange={({ fileList: fl }) => setRefFileList(fl.slice(0, 8))}
              accept="image/png,image/jpeg,image/webp"
              multiple
              maxCount={8}
            >
              {refFileList.length < 8 && (
                <div>
                  <UploadOutlined />
                  <div style={{ marginTop: 8 }}>上传</div>
                </div>
              )}
            </Upload>
          </Form.Item>
          <Form.Item name="generation_size" label="尺寸（可选）">
            <Input maxLength={50} placeholder="例如 1:1、16:9、1024x1024" />
          </Form.Item>
          <Form.Item name="prompt_cn" label="中文提示词" extra="中英文至少填写一个">
            <Input.TextArea rows={4} maxLength={5000} placeholder="输入中文提示词内容" />
          </Form.Item>
          <Form.Item name="prompt_en" label="英文提示词">
            <Input.TextArea rows={4} maxLength={5000} placeholder="输入英文提示词内容" />
          </Form.Item>
          <Form.Item name="sort_order" label="排序（越小越靠前）">
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Share to Hub Modal —— 把本地灵感分享到共享灵感库。
          需选择 hub 端的分类（与本地分类不是同一张表）。提交后由后端转发到 agent-build /api/inspiration-hub/submit */}
      <Modal
        title="分享到灵感共享市场"
        open={!!shareModalItem}
        onOk={handleShareSubmit}
        onCancel={() => setShareModalItem(null)}
        confirmLoading={shareSubmitting}
        width={520}
        destroyOnClose
        maskStyle={{ display: 'none' }}
      >
        {shareModalItem && (
          <>
            <Card size="small" style={{ marginBottom: 12, background: '#fafafa' }}>
              <Space>
                {shareModalItem.cover_image && (
                  <Image src={shareModalItem.cover_image} width={56} height={56}
                    style={{ objectFit: 'cover', borderRadius: 4 }} preview={false} />
                )}
                <div>
                  <div style={{ fontWeight: 500 }}>{shareModalItem.title}</div>
                  <div style={{ color: '#888', fontSize: 12 }}>
                    本地分类：{shareModalItem.category?.name || '—'}
                  </div>
                </div>
              </Space>
            </Card>
            <Form form={shareForm} layout="vertical">
              <Form.Item
                name="hub_category_id"
                label="共享库分类"
                rules={[{ required: true, message: '请选择共享库分类' }]}
                extra="共享库的分类列表与本地相互独立，由 hub 管理员维护"
              >
                <Select
                  loading={hubCategoriesLoading}
                  placeholder="选择 Hub 分类"
                  showSearch
                  optionFilterProp="label"
                  options={hubCategories.map(c => ({ label: c.name, value: c.id }))}
                  notFoundContent={hubCategoriesLoading ? '加载中...' : 'Hub 暂无分类'}
                />
              </Form.Item>
              <div style={{ color: '#888', fontSize: 12, lineHeight: 1.7 }}>
                <div>· 提交后该灵感进入共享审核，由审核员投票后通过</div>
                <div>· Hub 状态变化会自动同步回本地（每 5 分钟一次），也可点列表上方「同步 Hub 状态」手动触发</div>
                <div>· 撤回分享后，其他云控端将不再看到本条灵感</div>
              </div>
            </Form>
          </>
        )}
      </Modal>
    </div>
  );
}
