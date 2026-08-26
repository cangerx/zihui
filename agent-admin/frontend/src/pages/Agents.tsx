import { useEffect, useState, useCallback } from 'react';
import {
  Card, Switch, Table, Button, Space, Modal, Form, Input, Select,
  Upload, Image, message, Popconfirm, Tag, Tabs, InputNumber, Checkbox, Tooltip, Radio,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, UploadOutlined,
  ReloadOutlined, CheckOutlined, CloseOutlined,
  ShareAltOutlined, CloudUploadOutlined, RollbackOutlined,
} from '@ant-design/icons';
import { agentApi, agentHubApi, userApi, groupApi, knowledgeBaseApi } from '../services/api';
import { makeThumbnailBlob } from '../utils/makeThumbnail';
import BatchDeleteButton from '../components/BatchDeleteButton';

// 桌面端预设的 6 个内置小工具（builtin_* 全平台固定 ID）。
const BUILTIN_TOOLS = [
  { id: 'builtin_current_time', name: '当前时间' },
  { id: 'builtin_calculator', name: '数学计算器' },
  { id: 'builtin_fetch_webpage', name: '网页获取' },
  { id: 'builtin_json_tool', name: 'JSON 处理' },
  { id: 'builtin_text_tool', name: '文本处理' },
  { id: 'builtin_random_generator', name: '随机生成器' },
];
const ALL_TOOL_IDS = BUILTIN_TOOLS.map((t) => t.id);

const APPROVAL_OPTIONS = [
  { value: 'off', label: '关闭（所有工具自动执行）' },
  { value: 'destructive', label: '仅破坏性（写文件 / 命令前确认）' },
  { value: 'all', label: '全部（每个工具调用都确认）' },
];

const STATUS_TAG: Record<string, { color: string; label: string }> = {
  pending: { color: 'gold', label: '待审核' },
  approved: { color: 'green', label: '已通过' },
  rejected: { color: 'red', label: '已驳回' },
  withdrawn: { color: 'default', label: '已撤回' },
};

// 共享库（Agent Hub）状态 Tag
const HUB_STATUS_TAG: Record<string, { color: string; label: string }> = {
  pending: { color: 'gold', label: 'Hub 待审' },
  approved: { color: 'green', label: 'Hub 通过' },
  rejected: { color: 'red', label: 'Hub 拒绝' },
};

interface Category {
  id: number;
  name: string;
  description?: string;
  sort_order: number;
  is_visible: boolean;
  agents_count?: number;
}

// hub 端返回的分类，与本地 AgentCategory 不是同一张表
interface HubCategory {
  id: number;
  name: string;
  slug?: string;
  sort_order?: number;
}

interface AgentItem {
  id: number;
  name: string;
  description: string;
  avatar: string;
  system_prompt: string;
  template_schema_version?: number;
  template_version?: number;
  role_profile?: {
    role_summary?: string;
    responsibilities?: string[];
    boundaries?: string[];
    standard_inputs?: string[];
    deliverables?: string[];
  };
  workflow_templates?: Array<{ title: string; content: string }>;
  acceptance_templates?: Array<{ title: string; content: string }>;
  recommended_skill_dirs?: string[];
  connector_requirements?: string[];
  tool_skill_ids: string[];
  tool_approval: string;
  enable_image_gen: boolean;
  // 云端知识库绑定
  kb_only?: boolean;
  kb_top_k?: number;
  knowledge_bases?: Array<{ id: number; name: string }>;
  tags: string[];
  download_count: number;
  rating_avg: number | string;
  rating_count: number;
  sort_order: number;
  is_visible: boolean;
  submission_status: 'pending' | 'approved' | 'rejected' | 'withdrawn';
  source_type: 'admin' | 'user';
  submitted_by_nickname?: string;
  reject_reason?: string;
  created_at?: string;
  // 分类
  category_id?: number | null;
  category?: Category;
  // 定价 & 可见范围
  price?: number | string;
  price_balance_type?: 'token' | 'credit';
  visibility_scope?: 'public' | 'restricted';
  visibilities?: Array<{ assignee_type: 'user' | 'group'; assignee_id: number }>;
  // 数字员工共享库（hub）相关
  hub_shared_id?: number | null;
  hub_status?: 'pending' | 'approved' | 'rejected' | null;
  hub_status_synced_at?: string | null;
  from_hub_agent_id?: number | null;
  from_hub_source_site_name?: string | null;
}

// 2:3 竖图校验：h/w = 1.5，允许 ±0.1 容差
function checkAvatarAspect(file: File): Promise<boolean> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const ratio = img.height / img.width;
      if (Math.abs(ratio - 1.5) > 0.1) {
        message.error(`形象图需为 2:3 竖图（当前 ${img.width}x${img.height}）`);
        resolve(false);
      } else {
        resolve(true);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); message.error('无法解析图片'); resolve(false); };
    img.src = url;
  });
}

const joinLines = (items?: string[]) => (items || []).join('\n');
const splitLines = (value?: string) => String(value || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
const joinTemplates = (items?: Array<{ title: string; content: string }>) =>
  (items || []).map((item) => `${item.title}｜${item.content}`).join('\n');
const splitTemplates = (value?: string) => splitLines(value).map((line) => {
  const index = line.indexOf('｜');
  return index > 0 ? { title: line.slice(0, index).trim(), content: line.slice(index + 1).trim() } : { title: line.slice(0, 40), content: line };
}).filter((item) => item.title && item.content);

export default function Agents() {
  const [activeTab, setActiveTab] = useState<'items' | 'categories'>('items');
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<AgentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 });
  const [filterCategoryId, setFilterCategoryId] = useState<number | undefined>();
  const [filterStatus, setFilterStatus] = useState<string | undefined>();
  const [filterSource, setFilterSource] = useState<string | undefined>();
  const [searchText, setSearchText] = useState('');
  const [uploaderKeyword, setUploaderKeyword] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<number[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AgentItem | null>(null);
  const [form] = Form.useForm();
  const [fileList, setFileList] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [users, setUsers] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [kbOptions, setKbOptions] = useState<Array<{ id: number; name: string }>>([]);
  const visibilityScope: string = Form.useWatch('visibility_scope', form);

  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // Category modal
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [catEditing, setCatEditing] = useState<Category | null>(null);
  const [catForm] = Form.useForm();

  // 数字员工共享库（hub）状态
  //   - hubReady: 本站是否启用 + 配齐 endpoint/origin（控制操作列「分享/撤回」是否显示）
  //   - hubCategories: 分享 Modal 内的 hub 分类下拉数据（首次打开 Modal 时懒加载）
  const [hubReady, setHubReady] = useState(false);
  const [hubCategories, setHubCategories] = useState<HubCategory[]>([]);
  const [hubCategoriesLoading, setHubCategoriesLoading] = useState(false);
  const [shareModalItem, setShareModalItem] = useState<AgentItem | null>(null);
  const [shareSubmitting, setShareSubmitting] = useState(false);
  const [shareForm] = Form.useForm<{ hub_category_id: number }>();
  const [syncingStatus, setSyncingStatus] = useState(false);

  // 加载本地分类
  const loadCategories = useCallback(async () => {
    try {
      const res = await agentApi.listCategories();
      setCategories(res.data.data || []);
    } catch { /* ignore */ }
  }, []);

  // 加载 hub 就绪状态（仅用于判断表格是否显示 hub 相关列 / 操作）
  const loadHubStatus = useCallback(async () => {
    try {
      const res = await agentHubApi.adminGetSettings();
      setHubReady(!!res.data?.ready);
    } catch {
      setHubReady(false);
    }
  }, []);

  // hub 分享 Modal 打开时懒加载 hub 分类列表。
  // 不在页面 mount 时预加载：hub 未启用 / 未配置时该接口会 503，避免页面初加载报错。
  // 返回最新值给调用方直接用（避免 setState 异步 + 闭包旧值导致的预选 miss）。
  const loadHubCategories = useCallback<() => Promise<HubCategory[]>>(async () => {
    if (hubCategories.length > 0) return hubCategories;
    setHubCategoriesLoading(true);
    try {
      const res = await agentHubApi.categories();
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

  // 载入列表后 silent 同步本页处于 hub pending / 未同步的数字员工的最新 hub_status。
  // 只同步本页里 hub_shared_id != null 且 hub_status ∈ {null, 'pending'} 的项（成本低）。
  // fire-and-forget：不阻塞页面 loading，结果回来后用 setItems 局部 patch 受影响行。
  const silentSyncHubStatus = useCallback(async (rows: AgentItem[]) => {
    const pendingIds = rows
      .filter(i => i.hub_shared_id && (!i.hub_status || i.hub_status === 'pending'))
      .map(i => i.id);
    if (pendingIds.length === 0) return;
    try {
      const res = await agentHubApi.statusBatch(pendingIds);
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

  const loadItems = useCallback(async (page = 1, perPage = 20) => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page, per_page: perPage };
      if (filterCategoryId) params.category_id = filterCategoryId;
      if (filterStatus) params.submission_status = filterStatus;
      if (filterSource) params.source_type = filterSource;
      if (searchText) params.search = searchText;
      if (uploaderKeyword) params.uploader_keyword = uploaderKeyword;
      const res = await agentApi.list(params);
      const data = res.data.data || [];
      setItems(data);
      setPagination({
        current: res.data.current_page || page,
        pageSize: res.data.per_page || perPage,
        total: res.data.total || 0,
      });
      // hub 启用时静默对齐本页 pending 项的最新状态
      if (hubReady) {
        silentSyncHubStatus(data);
      }
    } catch { message.error('加载失败'); }
    setLoading(false);
  }, [filterCategoryId, filterStatus, filterSource, searchText, uploaderKeyword, hubReady, silentSyncHubStatus]);

  useEffect(() => { loadCategories(); loadHubStatus(); }, [loadCategories, loadHubStatus]);
  useEffect(() => { loadItems(); }, [loadItems]);
  // 加载用户 / 用户组，供「指定可见」选择器使用
  useEffect(() => {
    Promise.all([userApi.list({ per_page: 500 }), groupApi.list({ per_page: 500 })])
      .then(([u, g]) => { setUsers(u.data.data || []); setGroups(g.data.data || []); })
      .catch(() => { /* ignore */ });
  }, []);
  // 加载知识库列表，供「绑定知识库」多选使用
  useEffect(() => {
    knowledgeBaseApi.options()
      .then((res) => setKbOptions(res.data.data || []))
      .catch(() => { /* ignore */ });
  }, []);

  const openModal = (item?: AgentItem) => {
    setEditing(item || null);
    if (item) {
      const vis = item.visibilities || [];
      form.setFieldsValue({
        name: item.name,
        description: item.description,
        category_id: item.category_id ?? undefined,
        system_prompt: item.system_prompt,
        template_version: item.template_version || 1,
        role_summary: item.role_profile?.role_summary || '',
        responsibilities_text: joinLines(item.role_profile?.responsibilities),
        boundaries_text: joinLines(item.role_profile?.boundaries),
        standard_inputs_text: joinLines(item.role_profile?.standard_inputs),
        deliverables_text: joinLines(item.role_profile?.deliverables),
        workflow_templates_text: joinTemplates(item.workflow_templates),
        acceptance_templates_text: joinTemplates(item.acceptance_templates),
        recommended_skill_dirs: item.recommended_skill_dirs || [],
        connector_requirements: item.connector_requirements || [],
        tool_skill_ids: item.tool_skill_ids?.length ? item.tool_skill_ids : ALL_TOOL_IDS,
        tool_approval: item.tool_approval || 'destructive',
        enable_image_gen: !!item.enable_image_gen,
        knowledge_base_ids: (item.knowledge_bases || []).map((k) => k.id),
        kb_only: !!item.kb_only,
        kb_top_k: item.kb_top_k ?? 6,
        tags: item.tags || [],
        sort_order: item.sort_order || 0,
        is_visible: !!item.is_visible,
        price: Number(item.price) || 0,
        price_balance_type: item.price_balance_type || 'credit',
        visibility_scope: item.visibility_scope || 'public',
        visible_user_ids: vis.filter((v) => v.assignee_type === 'user').map((v) => v.assignee_id),
        visible_group_ids: vis.filter((v) => v.assignee_type === 'group').map((v) => v.assignee_id),
      });
      setFileList(item.avatar ? [{ uid: '-1', name: 'avatar', status: 'done', url: item.avatar }] : []);
    } else {
      form.resetFields();
      form.setFieldsValue({
        category_id: undefined,
        tool_skill_ids: ALL_TOOL_IDS,
        template_version: 1,
        recommended_skill_dirs: [],
        connector_requirements: [],
        tool_approval: 'destructive',
        enable_image_gen: false,
        knowledge_base_ids: [],
        kb_only: false,
        kb_top_k: 6,
        is_visible: true,
        sort_order: 0,
        tags: [],
        price: 0,
        price_balance_type: 'credit',
        visibility_scope: 'public',
        visible_user_ids: [],
        visible_group_ids: [],
      });
      setFileList([]);
    }
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('name', values.name);
      fd.append('description', values.description || '');
      fd.append('category_id', values.category_id != null ? String(values.category_id) : '');
      fd.append('system_prompt', values.system_prompt || '');
      fd.append('template_version', String(values.template_version || 1));
      fd.append('role_profile', JSON.stringify({
        role_summary: values.role_summary || '',
        responsibilities: splitLines(values.responsibilities_text),
        boundaries: splitLines(values.boundaries_text),
        standard_inputs: splitLines(values.standard_inputs_text),
        deliverables: splitLines(values.deliverables_text),
      }));
      fd.append('workflow_templates', JSON.stringify(splitTemplates(values.workflow_templates_text)));
      fd.append('acceptance_templates', JSON.stringify(splitTemplates(values.acceptance_templates_text)));
      fd.append('recommended_skill_dirs', JSON.stringify(values.recommended_skill_dirs || []));
      fd.append('connector_requirements', JSON.stringify(values.connector_requirements || []));
      fd.append('tool_skill_ids', JSON.stringify(values.tool_skill_ids || []));
      fd.append('tool_approval', values.tool_approval || 'destructive');
      fd.append('enable_image_gen', values.enable_image_gen ? '1' : '0');
      fd.append('knowledge_base_ids', JSON.stringify(values.knowledge_base_ids || []));
      fd.append('kb_only', values.kb_only ? '1' : '0');
      fd.append('kb_top_k', String(values.kb_top_k ?? 6));
      fd.append('tags', JSON.stringify(values.tags || []));
      fd.append('sort_order', String(values.sort_order || 0));
      fd.append('is_visible', values.is_visible ? '1' : '0');
      fd.append('price', String(values.price ?? 0));
      fd.append('price_balance_type', values.price_balance_type || 'credit');
      fd.append('visibility_scope', values.visibility_scope || 'public');
      fd.append('visible_user_ids', JSON.stringify(values.visibility_scope === 'restricted' ? (values.visible_user_ids || []) : []));
      fd.append('visible_group_ids', JSON.stringify(values.visibility_scope === 'restricted' ? (values.visible_group_ids || []) : []));

      if (fileList.length > 0 && fileList[0].originFileObj) {
        fd.append('avatar', fileList[0].originFileObj);
        // 随形象图附带缩略图（市场网格用），失败则跳过、云端回退原图
        const avatarThumb = await makeThumbnailBlob(fileList[0].originFileObj, 512);
        if (avatarThumb) fd.append('avatar_thumb', avatarThumb, 'thumb.jpg');
      } else if (editing && !fileList.length && editing.avatar) {
        fd.append('remove_avatar', '1');
      }

      if (editing) {
        fd.append('_method', 'PUT');
        await agentApi.update(editing.id, fd);
      } else {
        await agentApi.create(fd);
      }
      message.success('保存成功');
      setModalOpen(false);
      loadItems(pagination.current);
    } catch (e: any) {
      if (e?.errorFields) { setSubmitting(false); return; }
      const details = e?.response?.data?.details;
      const firstDetail = details && typeof details === 'object' ? (Object.values(details)[0] as any)?.[0] : null;
      message.error(firstDetail || e?.response?.data?.message || e?.response?.data?.error || '保存失败');
    }
    setSubmitting(false);
  };

  const handleDelete = async (id: number) => {
    try {
      await agentApi.delete(id);
      message.success('已删除');
      loadItems(pagination.current);
    } catch { message.error('删除失败'); }
  };

  const handleApprove = async (id: number) => {
    try {
      await agentApi.approve(id);
      message.success('已通过审核');
      loadItems(pagination.current);
    } catch { message.error('操作失败'); }
  };

  const doReject = async () => {
    if (rejectingId == null) return;
    try {
      await agentApi.reject(rejectingId, rejectReason);
      message.success('已驳回');
      setRejectingId(null);
      setRejectReason('');
      loadItems(pagination.current);
    } catch { message.error('操作失败'); }
  };

  const handleSetVisibility = async (id: number, visible: boolean) => {
    try {
      await agentApi.setVisibility(id, visible);
      message.success(visible ? '已上架' : '已下架');
      loadItems(pagination.current);
    } catch (e: any) {
      message.error(e?.response?.data?.message || e?.response?.data?.error || '操作失败');
    }
  };

  const batchSetVisibility = async (visible: boolean) => {
    if (!selectedKeys.length) { message.warning('请先选择数字员工'); return; }
    try {
      const res = await agentApi.batchSetVisibility(selectedKeys, visible);
      message.success(`已${visible ? '上架' : '下架'} ${res.data.affected ?? selectedKeys.length} 个`);
      setSelectedKeys([]);
      loadItems(pagination.current);
    } catch (e: any) {
      message.error(e?.response?.data?.error || '批量操作失败');
    }
  };

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
        await agentApi.updateCategory(catEditing.id, values);
      } else {
        await agentApi.createCategory(values);
      }
      message.success('已保存');
      setCatModalOpen(false);
      loadCategories();
    } catch { message.error('保存失败'); }
  };

  const handleCatDelete = async (id: number) => {
    try {
      await agentApi.deleteCategory(id);
      message.success('已删除');
      loadCategories();
      loadItems(pagination.current);
    } catch { message.error('删除失败（分类下可能还有数字员工数据）'); }
  };

  // ===== 共享库（hub）=====
  // 打开分享 Modal（并懒加载 hub 分类）
  const openShareModal = async (item: AgentItem) => {
    setShareModalItem(item);
    shareForm.resetFields();
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
      await agentHubApi.shareToHub(shareModalItem.id, { hub_category_id: values.hub_category_id });
      message.success('已提交到数字员工共享市场，等待审核');
      setShareModalItem(null);
      loadItems(pagination.current);
    } catch (e: any) {
      const err = e?.response?.data?.error;
      const msg = e?.response?.data?.message;
      if (err === 'avatar_unreachable' || err === 'cover_image_unreachable') {
        message.error(msg || '形象图无公网 URL，请先在「系统设置」配置存储或 APP_URL');
      } else if (err === 'already_shared') {
        message.warning('该数字员工已分享过，请先撤回后重试');
        loadItems(pagination.current);
      } else if (err === 'agent_hub_not_configured') {
        message.error('数字员工共享市场未配置，请先去「系统设置」填写');
      } else {
        message.error(msg || err || '分享失败');
      }
    } finally {
      setShareSubmitting(false);
    }
  };

  const handleWithdraw = async (item: AgentItem) => {
    try {
      await agentHubApi.withdrawFromHub(item.id);
      message.success('已撤回分享');
      loadItems(pagination.current);
    } catch (e: any) {
      message.error(e?.response?.data?.message || e?.response?.data?.error || '撤回失败');
    }
  };

  // 手动同步当前页所有已分享数字员工的 hub 状态。
  const handleSyncStatus = async () => {
    const ids = items.filter(i => i.hub_shared_id).map(i => i.id);
    if (ids.length === 0) {
      message.info('当前页没有已分享的数字员工');
      return;
    }
    setSyncingStatus(true);
    try {
      const res = await agentHubApi.statusBatch(ids);
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
      title: '形象',
      dataIndex: 'avatar',
      width: 70,
      render: (url: string) => url
        ? <Image src={url} width={40} height={60} style={{ objectFit: 'cover', borderRadius: 4 }} />
        : '-',
    },
    { title: '名称', dataIndex: 'name', width: 130, ellipsis: true },
    {
      title: '分类',
      dataIndex: 'category',
      width: 100,
      render: (cat: Category | undefined) => cat ? <Tag>{cat.name}</Tag> : '-',
    },
    { title: '描述', dataIndex: 'description', ellipsis: true, render: (v: string) => v || '-' },
    {
      title: '标签',
      dataIndex: 'tags',
      width: 140,
      render: (v: string[] | undefined) => (v?.length ? v.map((t) => <Tag key={t}>{t}</Tag>) : '-'),
    },
    {
      title: '工具',
      dataIndex: 'tool_skill_ids',
      width: 70,
      render: (v: string[] | undefined) => <Tag color="blue">{v?.length ?? 0} 个</Tag>,
    },
    {
      title: '来源',
      dataIndex: 'source_type',
      width: 100,
      render: (v: string, r: AgentItem) => v === 'user'
        ? <Tag color="gold">@{r.submitted_by_nickname || '用户'}</Tag>
        : <span style={{ color: '#bbb', fontSize: 12 }}>管理员</span>,
    },
    {
      title: '状态',
      dataIndex: 'submission_status',
      width: 90,
      render: (v: string) => {
        const t = STATUS_TAG[v] || STATUS_TAG.approved;
        return <Tag color={t.color}>{t.label}</Tag>;
      },
    },
    {
      title: '上架',
      dataIndex: 'is_visible',
      width: 70,
      render: (v: boolean, r: AgentItem) => (
        <Switch
          size="small"
          checked={!!v}
          onChange={(c) => handleSetVisibility(r.id, c)}
          disabled={r.submission_status !== 'approved'}
        />
      ),
    },
    {
      title: '定价',
      dataIndex: 'price',
      width: 90,
      render: (v: number | string, r: AgentItem) => {
        const p = Number(v) || 0;
        if (p <= 0) return <span style={{ color: '#bbb', fontSize: 12 }}>免费</span>;
        return <Tag color="orange">{p} {r.price_balance_type === 'token' ? '金币' : '积分'}</Tag>;
      },
    },
    {
      title: '可见',
      dataIndex: 'visibility_scope',
      width: 90,
      render: (v: string) => v === 'restricted'
        ? <Tag color="purple">指定可见</Tag>
        : <span style={{ color: '#bbb', fontSize: 12 }}>全员</span>,
    },
    { title: '下载', dataIndex: 'download_count', width: 70 },
    {
      title: '评分',
      dataIndex: 'rating_avg',
      width: 90,
      render: (v: number | string, r: AgentItem) => r.rating_count
        ? <span>{Number(v).toFixed(1)} <span style={{ color: '#bbb' }}>({r.rating_count})</span></span>
        : '-',
    },
    { title: '排序', dataIndex: 'sort_order', width: 60 },
    // 共享库状态列 - 仅 hub 启用时显示
    ...(hubReady ? [{
      title: '共享库',
      key: 'hub_status_col',
      width: 130,
      render: (_: any, r: AgentItem) => {
        // 优先判断：该数字员工是从 hub 拉来的 -> 「来自 Hub」 Tag
        if (r.from_hub_agent_id) {
          return (
            <Tooltip title={r.from_hub_source_site_name ? `来源：${r.from_hub_source_site_name}` : '从共享库拉取'}>
              <Tag color="blue">来自 Hub</Tag>
            </Tooltip>
          );
        }
        // 本地原生数字员工 + 已分享
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
      width: hubReady ? 280 : 200,
      fixed: 'right' as const,
      render: (_: any, record: AgentItem) => (
        <Space size="small" wrap>
          {record.submission_status === 'pending' && (
            <>
              <Popconfirm title="通过审核？" description="通过后将自动上架到数字员工市场" onConfirm={() => handleApprove(record.id)} okText="通过">
                <Button size="small" type="primary" icon={<CheckOutlined />}>通过</Button>
              </Popconfirm>
              <Button size="small" danger icon={<CloseOutlined />} onClick={() => { setRejectingId(record.id); setRejectReason(''); }}>驳回</Button>
            </>
          )}
          {record.submission_status === 'rejected' && (
            <Popconfirm title="重新通过审核？" onConfirm={() => handleApprove(record.id)} okText="通过">
              <Button size="small" icon={<CheckOutlined />}>重新通过</Button>
            </Popconfirm>
          )}
          {/* 数字员工共享库操作。仅 hub 就绪 + status=approved + 非从 hub 拉取的本地数字员工才可分享。 */}
          {hubReady && record.submission_status === 'approved' && !record.from_hub_agent_id && (
            record.hub_shared_id ? (
              <Popconfirm
                title="撤回共享？"
                description="从数字员工共享市场下架这条数字员工。其他云控端将不再看到。"
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
                disabled={!record.is_visible}
                onClick={() => openShareModal(record)}
              >
                分享
              </Button>
            )
          )}
          <Button size="small" icon={<EditOutlined />} onClick={() => openModal(record)} />
          <Popconfirm title="删除该数字员工？" description="将同步删除形象图文件，无法恢复" onConfirm={() => handleDelete(record.id)} okText="删除" okButtonProps={{ danger: true }}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Tabs
        activeKey={activeTab}
        onChange={k => setActiveTab(k as 'items' | 'categories')}
        items={[
          {
            key: 'items',
            label: '数字员工列表',
            children: (
              <>
                <div style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Select
                    allowClear placeholder="按分类筛选" style={{ width: 160 }}
                    value={filterCategoryId} onChange={(v) => setFilterCategoryId(v)}
                    options={categories.map(c => ({ label: c.name, value: c.id }))}
                  />
                  <Select
                    allowClear placeholder="状态筛选" style={{ width: 130 }}
                    value={filterStatus} onChange={(v) => setFilterStatus(v)}
                    options={[
                      { value: 'pending', label: '待审核' },
                      { value: 'approved', label: '已通过' },
                      { value: 'rejected', label: '已驳回' },
                      { value: 'withdrawn', label: '已撤回' },
                    ]}
                  />
                  <Select
                    allowClear placeholder="来源筛选" style={{ width: 120 }}
                    value={filterSource} onChange={(v) => setFilterSource(v)}
                    options={[
                      { value: 'admin', label: '管理员' },
                      { value: 'user', label: '用户投稿' },
                    ]}
                  />
                  <Input.Search placeholder="搜索名称/描述..." style={{ width: 220 }} onSearch={(v) => setSearchText(v)} allowClear />
                  <Input.Search placeholder="按投稿者昵称/用户名..." style={{ width: 200 }} onSearch={(v) => setUploaderKeyword(v)} allowClear />
                  <Button icon={<ReloadOutlined />} onClick={() => loadItems(pagination.current)}>刷新</Button>
                  {hubReady && (
                    <Tooltip title="手动同步当前页已分享数字员工的 Hub 状态（后台每 5 分钟自动同步一次）">
                      <Button icon={<CloudUploadOutlined />} onClick={handleSyncStatus} loading={syncingStatus}>
                        同步 Hub 状态
                      </Button>
                    </Tooltip>
                  )}
                  <Button disabled={!selectedKeys.length} onClick={() => batchSetVisibility(true)}>批量上架 ({selectedKeys.length})</Button>
                  <Button disabled={!selectedKeys.length} onClick={() => batchSetVisibility(false)}>批量下架 ({selectedKeys.length})</Button>
                  <BatchDeleteButton
                    selectedKeys={selectedKeys}
                    onClear={() => setSelectedKeys([])}
                    batchDelete={agentApi.batchDelete}
                    onDone={() => loadItems(pagination.current)}
                    itemName="数字员工"
                  />
                  <Button type="primary" icon={<PlusOutlined />} onClick={() => openModal()}>新建数字员工</Button>
                </div>

                <Table
                  rowKey="id"
                  columns={columns}
                  dataSource={items}
                  loading={loading}
                  size="small"
                  scroll={{ x: 1500 }}
                  rowSelection={{ selectedRowKeys: selectedKeys, onChange: (keys) => setSelectedKeys(keys as number[]) }}
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
                  <Button type="primary" icon={<PlusOutlined />} onClick={() => openCatModal()}>新增分类</Button>
                </div>
                <Table
                  rowKey="id"
                  size="small"
                  dataSource={categories}
                  columns={[
                    { title: '名称', dataIndex: 'name', width: 200 },
                    { title: '描述', dataIndex: 'description', ellipsis: true, render: (v: string) => v || '-' },
                    { title: '数字员工数', dataIndex: 'agents_count', width: 100, render: (v: number) => <Tag color={v ? 'cyan' : 'default'}>{v ?? 0}</Tag> },
                    { title: '排序', dataIndex: 'sort_order', width: 80 },
                    {
                      title: '可见', dataIndex: 'is_visible', width: 80,
                      render: (v: boolean) => v ? <Tag color="green">是</Tag> : <Tag>否</Tag>,
                    },
                    {
                      title: '操作',
                      width: 160,
                      render: (_: any, record: Category) => (
                        <Space size="small">
                          <Button size="small" icon={<EditOutlined />} onClick={() => openCatModal(record)}>编辑</Button>
                          <Popconfirm
                            title="删除该分类？"
                            description="该分类下的数字员工将解除分类归属"
                            okText="删除"
                            okButtonProps={{ danger: true }}
                            onConfirm={() => handleCatDelete(record.id)}
                          >
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

      <Modal
        title={editing ? '编辑数字员工' : '新建数字员工'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        confirmLoading={submitting}
        width={640}
        destroyOnClose
        mask={false}
      >
        <Form form={form} layout="vertical">
          <Form.Item label="形象（2:3 竖图）" extra="支持 PNG/JPEG/WEBP，最大 3MB，需 2:3 比例（如 600x900）">
            <Upload
              listType="picture-card"
              fileList={fileList}
              accept="image/png,image/jpeg,image/webp"
              maxCount={1}
              beforeUpload={async (file) => {
                const ok = await checkAvatarAspect(file);
                return ok ? false : Upload.LIST_IGNORE;
              }}
              onChange={({ fileList: fl }) => setFileList(fl.slice(-1))}
            >
              {fileList.length < 1 && (
                <div><UploadOutlined /><div style={{ marginTop: 8 }}>上传</div></div>
              )}
            </Upload>
          </Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input maxLength={100} placeholder="给数字员工起个名字" />
          </Form.Item>
          <Form.Item name="category_id" label="分类">
            <Select
              allowClear
              placeholder="请选择分类（可不选）"
              options={categories.map(c => ({ label: c.name, value: c.id }))}
            />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input maxLength={500} placeholder="简要描述数字员工的用途" />
          </Form.Item>
          <Card size="small" title="岗位模板" style={{ marginBottom: 16 }}>
            <Form.Item name="template_version" label="模板版本" extra="内容发生变化时递增；桌面端据此判断是否有更新">
              <InputNumber min={1} max={1000000} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="role_summary" label="一句话职责">
              <Input maxLength={500} placeholder="例如：负责商品主图、详情页和活动视觉" />
            </Form.Item>
            <Form.Item name="responsibilities_text" label="负责事项" extra="每行一项">
              <Input.TextArea rows={3} placeholder={'制作商品主图\n维护品牌视觉一致性'} />
            </Form.Item>
            <Form.Item name="boundaries_text" label="职责边界" extra="每行一项，不可被高级提示词覆盖">
              <Input.TextArea rows={3} placeholder={'发布前必须由用户确认\n不得覆盖原始素材'} />
            </Form.Item>
            <Form.Item name="standard_inputs_text" label="标准输入" extra="每行一项">
              <Input.TextArea rows={2} placeholder="产品图、品牌规范、目标平台" />
            </Form.Item>
            <Form.Item name="deliverables_text" label="标准交付物" extra="每行一项">
              <Input.TextArea rows={2} placeholder="可发布图片、源文件、修改说明" />
            </Form.Item>
            <Form.Item name="workflow_templates_text" label="工作流程模板" extra="每行一条，格式：标题｜内容">
              <Input.TextArea rows={3} placeholder="商品主图流程｜确认素材 → 生成方案 → 用户确认 → 导出" />
            </Form.Item>
            <Form.Item name="acceptance_templates_text" label="验收标准模板" extra="每行一条，格式：标题｜内容">
              <Input.TextArea rows={3} placeholder="主图验收｜尺寸符合平台要求，文字无错漏" />
            </Form.Item>
            <Form.Item name="recommended_skill_dirs" label="推荐 Skills" extra="只声明推荐项；桌面端仅绑定已经安装的 Skill，不自动安装代码">
              <Select mode="tags" tokenSeparators={[',']} placeholder="输入 Skill 目录名后回车" />
            </Form.Item>
            <Form.Item name="connector_requirements" label="连接器需求" extra="只声明需要的服务，不包含 API Key 或本地路径">
              <Select mode="tags" tokenSeparators={[',']} placeholder="例如：企业微信、飞书、Figma" />
            </Form.Item>
          </Card>
          <Form.Item name="system_prompt" label="系统提示词" extra="决定数字员工的行为/人设，桌面端保存到本地时会据此自动创建人格">
            <Input.TextArea rows={5} maxLength={20000} placeholder="例如：你是一名专业的 PPT 演示文稿创作专家..." />
          </Form.Item>
          <Form.Item name="tool_skill_ids" label="绑定小工具" extra="默认绑定桌面端预设的 6 个内置小工具">
            <Checkbox.Group options={BUILTIN_TOOLS.map((t) => ({ label: t.name, value: t.id }))} />
          </Form.Item>
          <Form.Item name="tool_approval" label="工具调用确认">
            <Select options={APPROVAL_OPTIONS} />
          </Form.Item>
          <Form.Item name="enable_image_gen" label="生图能力" valuePropName="checked" extra="开启后该数字员工对话中可调用生图工具">
            <Switch />
          </Form.Item>
          <Form.Item
            name="knowledge_base_ids" label="绑定云端知识库"
            extra="可多选；用户在桌面端使用该数字员工对话时，将在线检索所选知识库（内容留云端，权限随数字员工授权传递）"
          >
            <Select
              mode="multiple"
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="选择知识库（不绑定则不使用云端知识库）"
              options={kbOptions.map((kb) => ({ value: kb.id, label: kb.name }))}
            />
          </Form.Item>
          <Form.Item
            name="kb_only" label="仅依据知识库回答" valuePropName="checked"
            extra="开启后对话优先/仅使用知识库检索结果作答"
          >
            <Switch />
          </Form.Item>
          <Form.Item name="kb_top_k" label="知识库检索条数（Top K）" extra="每次对话检索召回的片段数量">
            <InputNumber min={1} max={20} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="tags" label="标签">
            <Select mode="tags" tokenSeparators={[',']} placeholder="输入标签后回车，最多 10 个" maxTagCount={10} />
          </Form.Item>
          <Form.Item name="sort_order" label="排序（越小越靠前）">
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="is_visible" label="上架到市场" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item label="定价" extra="0 表示免费；大于 0 时用户在桌面端需用对应余额购买后才能保存到本地">
            <Space.Compact style={{ width: '100%' }}>
              <Form.Item name="price" noStyle>
                <InputNumber min={0} precision={2} style={{ width: '70%' }} placeholder="0（免费）" />
              </Form.Item>
              <Form.Item name="price_balance_type" noStyle>
                <Select
                  style={{ width: '30%' }}
                  options={[{ value: 'credit', label: '积分' }, { value: 'token', label: '金币' }]}
                />
              </Form.Item>
            </Space.Compact>
          </Form.Item>
          <Form.Item name="visibility_scope" label="可见范围">
            <Radio.Group>
              <Radio value="public">全员可见</Radio>
              <Radio value="restricted">指定用户 / 用户组</Radio>
            </Radio.Group>
          </Form.Item>
          {visibilityScope === 'restricted' && (
            <>
              <Form.Item name="visible_user_ids" label="指定用户（可多选）">
                <Select
                  mode="multiple" showSearch optionFilterProp="label" allowClear
                  placeholder="选择可见用户" maxTagCount="responsive"
                  options={users.map((u) => ({ value: u.id, label: `${u.username}${u.nickname ? ` (${u.nickname})` : ''}` }))}
                />
              </Form.Item>
              <Form.Item name="visible_group_ids" label="指定用户组（可多选）" extra="指定后，仅名单内用户能在桌面端市场看到并保存此数字员工">
                <Select
                  mode="multiple" showSearch optionFilterProp="label" allowClear
                  placeholder="选择可见用户组" maxTagCount="responsive"
                  options={groups.map((g) => ({ value: g.id, label: g.name }))}
                />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>

      {/* Category Modal */}
      <Modal
        title={catEditing ? '编辑分类' : '新增分类'}
        open={catModalOpen}
        onOk={handleCatSubmit}
        onCancel={() => setCatModalOpen(false)}
        okText="保存"
        destroyOnClose
        mask={false}
      >
        <Form form={catForm} layout="vertical" preserve={false}>
          <Form.Item name="name" label="分类名称" rules={[{ required: true, max: 50, message: '请输入分类名称' }]}>
            <Input placeholder="例如：办公助手 / 编程开发 / 创意写作" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} maxLength={500} showCount placeholder="可选，简短说明该分类的用途" />
          </Form.Item>
          <Form.Item name="sort_order" label="排序（数字越小越靠前）">
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="is_visible" label="桌面端可见" valuePropName="checked" initialValue>
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="驳回投稿"
        open={rejectingId != null}
        onOk={doReject}
        onCancel={() => { setRejectingId(null); setRejectReason(''); }}
        okButtonProps={{ danger: true }}
        okText="确认驳回"
        destroyOnClose
        mask={false}
      >
        <Tooltip title="驳回原因会同步回投稿用户的桌面端">
          <Input.TextArea
            rows={3}
            maxLength={500}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="填写驳回原因（可选）"
          />
        </Tooltip>
      </Modal>

      {/* Share to Hub Modal —— 把本地数字员工分享到数字员工共享库。
          需选择 hub 端的分类（与本地分类不是同一张表）。 */}
      <Modal
        title="分享到数字员工共享市场"
        open={!!shareModalItem}
        onOk={handleShareSubmit}
        onCancel={() => setShareModalItem(null)}
        confirmLoading={shareSubmitting}
        width={520}
        destroyOnClose
        mask={false}
      >
        {shareModalItem && (
          <>
            <Card size="small" style={{ marginBottom: 12, background: '#fafafa' }}>
              <Space>
                {shareModalItem.avatar && (
                  <Image src={shareModalItem.avatar} width={40} height={60}
                    style={{ objectFit: 'cover', borderRadius: 4 }} preview={false} />
                )}
                <div>
                  <div style={{ fontWeight: 500 }}>{shareModalItem.name}</div>
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
                <div>· 提交后该数字员工进入共享审核，由审核员投票后通过</div>
                <div>· Hub 状态变化会自动同步回本地（每 5 分钟一次），也可点列表上方「同步 Hub 状态」手动触发</div>
                <div>· 撤回分享后，其他云控端将不再看到本条数字员工</div>
              </div>
            </Form>
          </>
        )}
      </Modal>
    </div>
  );
}
