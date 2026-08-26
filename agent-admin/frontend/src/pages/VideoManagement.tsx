import { useEffect, useMemo, useState, type Key, type ReactNode } from 'react';
import { Alert, Button, Card, Checkbox, Col, Descriptions, Form, Input, InputNumber, message, Modal, Popconfirm, Row, Select, Space, Statistic, Steps, Switch, Table, Tabs, Tag, Typography } from 'antd';
import { EditOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import { groupApi, userApi, videoApi } from '../services/api';
import { OfficialRefText } from '../components/OfficialRefPanel';
import VideoModelOnboardFields from '../components/VideoModelOnboardFields';
import { useCurrencyLabels } from '../contexts/CurrencyContext';

const STATUS_COLORS: Record<string, string> = {
  active: 'green', disabled: 'default', pending: 'default', submitting: 'processing', submitted: 'processing', running: 'processing', completed: 'success', failed: 'error', canceled: 'warning', success: 'success', ok: 'success', warning: 'warning', error: 'error',
};

const STATUS_LABELS: Record<string, string> = {
  active: '正常',
  disabled: '禁用',
  pending: '待处理',
  submitting: '提交中',
  submitted: '已提交',
  running: '生成中',
  completed: '已完成',
  failed: '失败',
  canceled: '已取消',
  success: '成功',
  ok: '通过',
  warning: '警告',
  error: '失败',
};

const STATUS_FILTER_OPTIONS = ['active', 'disabled', 'pending', 'completed', 'failed'].map(value => ({ value, label: STATUS_LABELS[value] }));
const ENABLED_STATUS_OPTIONS = ['active', 'disabled'].map(value => ({ value, label: STATUS_LABELS[value] }));
const TARGET_TYPE_LABELS: Record<string, string> = { user: '用户计费', group: '分组计费' };
const PROTOCOL_OPTIONS = [{ value: 'seedance', label: 'Seedance（多米）' }, { value: 'volcengine_ark', label: '火山方舟官方' }, { value: 'veo', label: 'VEO' }, { value: 'grok', label: 'GROK' }, { value: 'kling', label: '可灵 Kling' }, { value: 'wan', label: 'Wan 3.0 / 算力超市' }, { value: 'openai_video', label: 'OpenAI 兼容视频' }, { value: 'minimax_h3', label: 'MiniMax H3' }];
const DRIVER_OPTIONS = [{ value: 'duomi', label: '多米 API' }, { value: 'volcengine_ark', label: '火山方舟官方' }, { value: 'openai_video', label: 'OpenAI 兼容视频' }, { value: 'wan', label: 'Wan / 算力超市任务接口' }, { value: 'minimax_h3', label: 'MiniMax H3' }];
const AUTH_STYLE_OPTIONS = [{ value: 'bearer', label: 'Bearer Token（OpenAI 风格）' }, { value: 'raw_authorization_header', label: '原始 Authorization 头（多米风格）' }];
const GENERATION_TYPE_OPTIONS = [{ value: 'text_to_video', label: '文生视频' }, { value: 'image_to_video', label: '图生视频' }, { value: 'text_or_image_to_video', label: '文/图生视频' }, { value: 'multimodal_video', label: '多模态视频' }];
const MODE_OPTIONS = [{ value: 'text_to_video', label: '文生视频' }, { value: 'image_to_video', label: '图生视频' }, { value: 'first_last_frame', label: '首尾帧' }, { value: 'standard', label: '标准' }, { value: 'fast', label: '快速' }];
const RESOLUTION_OPTIONS = ['480p', '720p', '1080p', '4k', '480P', '720P', '1080P', '768P', '2K'].map(v => ({ value: v, label: v }));
const ASPECT_RATIO_OPTIONS = ['adaptive', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9'].map(v => ({ value: v, label: v }));
const DURATION_OPTIONS = [2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30].map(v => ({ value: v, label: `${v}s` }));
const PRICING_STATUS_OPTIONS = [{ value: 'priced', label: '已定价' }, { value: 'unpriced', label: '待定价' }];
const CATALOG_REASON_LABELS: Record<string, string> = {
  visible: '桌面可见', no_account: '未配置账号', account_inactive: '账号未启用或缺 Key',
  model_disabled: '模型未启用', sku_missing: '缺少 SKU', sku_disabled: 'SKU 未启用', unpriced: 'SKU 未定价',
};

// L2 计费维度模型：SKU 只锁定「影响价格的维度」（非空字段），其余维度留空＝用户生成时在模型能力内自选、不影响价格。
type DimKey = 'mode' | 'duration' | 'resolution' | 'aspect_ratio';
const DIMENSION_FIELDS: Array<{ key: DimKey; label: string }> = [
  { key: 'mode', label: '生成模式' },
  { key: 'duration', label: '时长' },
  { key: 'resolution', label: '清晰度' },
  { key: 'aspect_ratio', label: '画面比例' },
];
// 各协议「按什么计费」→ 批量生成时默认勾选的锁定维度
const PROTOCOL_LOCKED_DIMS: Record<string, DimKey[]> = {
  seedance: ['mode', 'duration'],
  volcengine_ark: ['duration', 'resolution'],
  veo: ['duration', 'resolution'],
  grok: ['duration', 'resolution'],
  // 可灵按 清晰度(std=720p/pro=1080p) × 时长 计费
  kling: ['duration', 'resolution'],
  wan: ['duration', 'resolution'],
  openai_video: ['duration', 'resolution'],
  minimax_h3: ['duration', 'resolution'],
};
const recommendedLockedDims = (protocol: string): DimKey[] => PROTOCOL_LOCKED_DIMS[String(protocol || '')] || ['duration'];
// 某 SKU 实际锁定（非空）的维度集合
const skuLockedDimKeys = (sku: any): DimKey[] => {
  const out: DimKey[] = [];
  if (String(sku?.mode ?? '') !== '') out.push('mode');
  if (Number(sku?.duration_seconds ?? 0) > 0) out.push('duration');
  if (String(sku?.resolution ?? '') !== '') out.push('resolution');
  if (String(sku?.aspect_ratio ?? '') !== '') out.push('aspect_ratio');
  return out;
};
const dimSignature = (dims: string[]) => DIMENSION_FIELDS.filter((d) => dims.includes(d.key)).map((d) => d.key).join(',');
const dimLabels = (dims: string[]) => DIMENSION_FIELDS.filter((d) => dims.includes(d.key)).map((d) => d.label);

const relationModel = (row: any) => row?.model_spec || row?.modelSpec || null;
const relationSku = (row: any) => row?.sku || null;
const toArray = (value: any) => Array.isArray(value) ? value.filter((item) => item !== null && item !== undefined && item !== '') : [];
const shortList = (value: any, suffix = '') => {
  const list = toArray(value);
  if (!list.length) return '-';
  return list.map((item) => `${item}${suffix}`).join(' / ');
};
const roundNumber = (value: number, precision = 4) => {
  const factor = 10 ** precision;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
};
const numberText = (value: any) => {
  if (value === null || value === undefined || value === '') return '-';
  const num = Number(value);
  if (Number.isNaN(num)) return '-';
  const rounded = roundNumber(num);
  return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(/\.?0+$/, '');
};
const signedNumberText = (value: any) => {
  if (value === null || value === undefined || value === '') return '-';
  const num = roundNumber(Number(value || 0));
  return num > 0 ? `+${numberText(num)}` : numberText(num);
};
const diffNumber = (left: any, right: any) => roundNumber(Number(left || 0) - Number(right || 0));
const isUnpriced = (sku: any) => sku?.default_credit_cost === null || sku?.default_credit_cost === undefined || sku?.default_credit_cost === '';
const priceText = (value: any) => isUnpriced({ default_credit_cost: value })
  ? <Tag color="orange">待定价</Tag>
  : <Typography.Text strong>{numberText(value)}</Typography.Text>;
const stringifyHeaders = (headers: any): string => {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return '';
  return Object.keys(headers).length ? JSON.stringify(headers, null, 2) : '';
};
const parseHeaders = (text: any): Record<string, string> => {
  const raw = typeof text === 'string' ? text.trim() : '';
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid headers');
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (k && (typeof v === 'string' || typeof v === 'number')) out[k] = String(v);
  }
  return out;
};
const parseAdvancedParams = (text: any): Record<string, any> => {
  const raw = typeof text === 'string' ? text.trim() : '';
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid params');
  return parsed;
};

export default function VideoManagementPage() {
  const { labels } = useCurrencyLabels();
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'stats';
  const [tab, setTab] = useState(initialTab);
  const [onboardingStep, setOnboardingStep] = useState(initialTab === 'accounts' ? 0 : initialTab === 'tasks' ? 3 : initialTab === 'models' ? 1 : 0);
  const [advancedOpen, setAdvancedOpen] = useState(searchParams.has('tab'));
  const [stats, setStats] = useState<any>({});
  const [accounts, setAccounts] = useState<any>({ data: [], total: 0 });
  const [models, setModels] = useState<any[]>([]);
  const [catalogDiagnostics, setCatalogDiagnostics] = useState<Record<number, any>>({});
  const [skus, setSkus] = useState<any[]>([]);
  const [allSkus, setAllSkus] = useState<any[]>([]);
  const [rules, setRules] = useState<any>({ data: [], total: 0 });
  const [users, setUsers] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any>({ data: [], total: 0 });
  const [usage, setUsage] = useState<any>({ data: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [params, setParams] = useState<Record<string, any>>({ page: 1, per_page: 20, user_id: searchParams.get('user_id') || undefined, keyword: searchParams.get('keyword') || undefined });
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountEditing, setAccountEditing] = useState<any>(null);
  const [modelEditing, setModelEditing] = useState<any>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const [modelCreating, setModelCreating] = useState(false);
  const [skuEditing, setSkuEditing] = useState<any>(null);
  const [skuOpen, setSkuOpen] = useState(false);
  const [skuCreating, setSkuCreating] = useState(false);
  const [batchSkuOpen, setBatchSkuOpen] = useState(false);
  const [batchSkuModelId, setBatchSkuModelId] = useState<number | undefined>();
  const [batchSkuLoading, setBatchSkuLoading] = useState(false);
  const [batchLockedDims, setBatchLockedDims] = useState<string[]>([]);
  const [fetchModelsOpen, setFetchModelsOpen] = useState(false);
  const [fetchModelsAccount, setFetchModelsAccount] = useState<any>(null);
  const [fetchModelsList, setFetchModelsList] = useState<any[]>([]);
  const [fetchModelsSelected, setFetchModelsSelected] = useState<Key[]>([]);
  const [fetchModelsLoading, setFetchModelsLoading] = useState(false);
  const [importCreditCost, setImportCreditCost] = useState<number | null>(null);
  const [skuModelFilter, setSkuModelFilter] = useState<number | undefined>();
  const [skuProviderFilter, setSkuProviderFilter] = useState<string | undefined>();
  const [selectedSkuIds, setSelectedSkuIds] = useState<Key[]>([]);
  const [inlineEditingSkuId, setInlineEditingSkuId] = useState<number | null>(null);
  const [inlineCreditCost, setInlineCreditCost] = useState<number | null>(null);
  const [inlineSavingSkuId, setInlineSavingSkuId] = useState<number | null>(null);
  const [ruleOpen, setRuleOpen] = useState(false);
  const [ruleEditing, setRuleEditing] = useState<any>(null);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [detailTask, setDetailTask] = useState<any>(null);
  const [accountForm] = Form.useForm();
  const [modelForm] = Form.useForm();
  const [skuForm] = Form.useForm();
  const [ruleForm] = Form.useForm();
  const [discountForm] = Form.useForm();
  const discountModelIds = Form.useWatch('video_model_spec_ids', discountForm);
  const discountTargetType = Form.useWatch('target_type', discountForm) || 'user';
  const discountTargetIds = Form.useWatch('target_ids', discountForm);
  const discountPercent = Form.useWatch('discount_percent', discountForm);
  const accountDriver = Form.useWatch('driver', accountForm) || 'duomi';
  const skuModelSpecId = Form.useWatch('video_model_spec_id', skuForm);

  const loadStats = async () => setStats((await videoApi.stats()).data);
  const loadAccounts = async () => setAccounts((await videoApi.accounts(params)).data);
  const loadModels = async () => {
    const [modelRes, diagnosticRes] = await Promise.all([videoApi.models(params), videoApi.catalogDiagnostics()]);
    setModels(modelRes.data.models || []);
    setCatalogDiagnostics(Object.fromEntries((diagnosticRes.data.models || []).map((item: any) => [Number(item.id), item])));
  };
  const loadSkus = async () => {
    const list = (await videoApi.skus(params)).data.skus || [];
    setSkus(list);
    if (!params.provider_protocol && !params.status && !params.pricing_status) setAllSkus(list);
  };
  const loadRules = async () => setRules((await videoApi.pricingRules(params)).data);
  const loadTasks = async () => setTasks((await videoApi.tasks(params)).data);
  const loadUsage = async () => setUsage((await videoApi.usage(params)).data);

  const visibleSkus = useMemo(() => {
    let list = skus;
    if (skuModelFilter) list = list.filter((sku) => Number(sku.video_model_spec_id) === Number(skuModelFilter));
    if (skuProviderFilter) list = list.filter((sku) => sku.provider_key === skuProviderFilter);
    return list;
  }, [skus, skuModelFilter, skuProviderFilter]);

  const skuProviderOptions = useMemo(() => {
    const src = allSkus.length ? allSkus : skus;
    const keys = Array.from(new Set([...models.map((m) => m.provider_key), ...src.map((s) => s.provider_key)].filter(Boolean)));
    return keys.map((k) => ({ value: k, label: k }));
  }, [models, allSkus, skus]);

  const ruleSkus = allSkus.length ? allSkus : skus;

  const skuOptions = useMemo(() => ruleSkus.map((sku) => ({
    value: sku.id,
    disabled: isUnpriced(sku),
    label: `${relationModel(sku)?.display_name || sku.model_id} / ${sku.title} / ${sku.duration_seconds || '-'}s / ${sku.resolution || sku.quality || '-'} / ${sku.aspect_ratio || '-'}${isUnpriced(sku) ? ' / 待定价' : ''}`,
  })), [ruleSkus]);
  const userOptions = useMemo(() => users.map((user) => ({
    value: user.id,
    label: `${user.username}${user.nickname ? ` (${user.nickname})` : ''}`,
  })), [users]);
  const groupOptions = useMemo(() => groups.map((group) => ({ value: group.id, label: group.name })), [groups]);
  const discountModelOptions = useMemo(() => models.map((model) => {
    const skuList = ruleSkus.filter((sku) => Number(sku.video_model_spec_id) === Number(model.id));
    const fallbackSkus = toArray(model.skus);
    const list = skuList.length ? skuList : fallbackSkus;
    const pricedCount = list.filter((sku: any) => sku.status === 'active' && !isUnpriced(sku)).length;
    return {
      value: model.id,
      disabled: pricedCount <= 0,
      label: `${model.display_name} / ${model.model_id} / ${pricedCount} 已定价 / ${list.length} 总 SKU`,
    };
  }), [models, ruleSkus]);
  const discountPreview = useMemo(() => {
    const modelIds = toArray(discountModelIds).map((id) => Number(id)).filter((id) => id > 0);
    const targetIds = toArray(discountTargetIds).map((id) => Number(id)).filter((id) => id > 0);
    const percent = Number(discountPercent);
    const selectedSkus = ruleSkus.filter((sku) => modelIds.includes(Number(sku.video_model_spec_id)));
    const pricedSkus = selectedSkus.filter((sku) => sku.status === 'active' && !isUnpriced(sku));
    const skippedUnpriced = selectedSkus.filter((sku) => sku.status === 'active' && isUnpriced(sku)).length;
    const skippedDisabled = selectedSkus.filter((sku) => sku.status !== 'active').length;
    const examples = Number.isNaN(percent) ? [] : pricedSkus.slice(0, 3).map((sku) => ({
      sku,
      credit_cost: roundNumber(Number(sku.default_credit_cost || 0) * percent / 100),
    }));
    return {
      model_count: modelIds.length,
      sku_count: pricedSkus.length,
      target_count: targetIds.length,
      total: pricedSkus.length * targetIds.length,
      skipped_unpriced: skippedUnpriced,
      skipped_disabled: skippedDisabled,
      examples,
    };
  }, [discountModelIds, discountTargetIds, discountPercent, ruleSkus]);

  const batchSkuModel = useMemo(() => models.find((m) => Number(m.id) === Number(batchSkuModelId)) || null, [models, batchSkuModelId]);
  const batchSkuCombos = useMemo(() => {
    const m = batchSkuModel;
    const combos: Array<{ mode: string; duration_seconds: number; resolution: string; aspect_ratio: string }> = [];
    if (!m) return combos;
    // 只对「勾选为计费维度」的字段做组合，未勾选的维度留空（用户生成时自选、不影响价格）
    const locked = (key: DimKey) => batchLockedDims.includes(key);
    const modes = locked('mode') && toArray(m.supported_modes).length ? toArray(m.supported_modes) : [''];
    const durations = locked('duration') && toArray(m.supported_durations).length ? toArray(m.supported_durations) : [0];
    const resolutions = locked('resolution') && toArray(m.supported_resolutions).length ? toArray(m.supported_resolutions) : [''];
    const ratios = locked('aspect_ratio') && toArray(m.supported_aspect_ratios).length ? toArray(m.supported_aspect_ratios) : [''];
    for (const mode of modes) for (const d of durations) for (const resolution of resolutions) for (const aspect_ratio of ratios) {
      combos.push({ mode: String(mode || ''), duration_seconds: Number(d) || 0, resolution: String(resolution || ''), aspect_ratio: String(aspect_ratio || '') });
    }
    return combos;
  }, [batchSkuModel, batchLockedDims]);

  const ensureSkus = async () => {
    if (allSkus.length) return allSkus;
    const res = await videoApi.skus();
    const list = res.data.skus || [];
    setAllSkus(list);
    if (!skus.length) setSkus(list);
    return list;
  };
  const ensureModels = async () => {
    const res = await videoApi.models();
    const list = res.data.models || [];
    setModels(list);
    return list;
  };
  const loadTargetOptions = async () => {
    const [userRes, groupRes] = await Promise.all([
      userApi.list({ per_page: 500 }),
      groupApi.list({ per_page: 500 }),
    ]);
    setUsers(userRes.data.data || userRes.data || []);
    setGroups(groupRes.data.data || groupRes.data || []);
  };

  const loadCurrent = async () => {
    setLoading(true);
    try {
      await loadStats();
      if (tab === 'accounts') await loadAccounts();
      if (tab === 'models') await loadModels();
      if (tab === 'skus') await Promise.all([loadModels(), loadSkus()]);
      if (tab === 'pricing') await Promise.all([loadRules(), ensureSkus(), loadTargetOptions()]);
      if (tab === 'tasks') await loadTasks();
      if (tab === 'usage') await loadUsage();
    } catch (e: any) {
      message.error(e?.response?.data?.error || '加载失败');
    } finally { setLoading(false); }
  };

  useEffect(() => { loadCurrent(); }, [tab, params]);
  useEffect(() => {
    const taskId = searchParams.get('task_id');
    if (!taskId) return;
    videoApi.getTask(taskId)
      .then((res) => setDetailTask(res.data.task))
      .catch(() => message.error('加载视频任务详情失败'));
  }, []);

  const openAccount = (row?: any) => {
    setAccountEditing(row || null);
    accountForm.resetFields();
    if (row) {
      accountForm.setFieldsValue({
        provider_key: row.provider_key,
        driver: row.driver || (row.provider_key === 'duomi' ? 'duomi' : (['wan', 'likeadmin', 'dashscope'].includes(String(row.provider_key || '')) ? 'wan' : (['minimax', 'minimax_h3', 'hailuo'].includes(String(row.provider_key || '')) ? 'minimax_h3' : (['volcengine', 'volcengine_ark', 'ark', 'jimeng'].includes(String(row.provider_key || '')) ? 'volcengine_ark' : 'openai_video')))),
        name: row.name,
        base_url: row.base_url,
        auth_style: row.auth_style || 'bearer',
        status: row.status,
        remark: row.remark,
        verify_ssl: row.verify_ssl !== false,
        proxy: row.proxy || '',
        extra_headers: stringifyHeaders(row.extra_headers),
      });
    } else {
      accountForm.setFieldsValue({ driver: 'openai_video', provider_key: '', base_url: '', auth_style: 'bearer', status: 'active', verify_ssl: true });
    }
    setAccountOpen(true);
  };
  const onAccountDriverChange = (driver: string) => {
    if (driver === 'duomi') {
      accountForm.setFieldsValue({
        provider_key: (accountForm.getFieldValue('provider_key') || '').trim() || 'duomi',
        base_url: (accountForm.getFieldValue('base_url') || '').trim() || 'https://duomiapi.com',
        auth_style: 'raw_authorization_header',
      });
    } else if (driver === 'wan') {
      accountForm.setFieldsValue({
        provider_key: (accountForm.getFieldValue('provider_key') || '').trim() || 'wan',
        base_url: (accountForm.getFieldValue('base_url') || '').trim() || 'https://api.likeadmin.cn',
        auth_style: 'bearer',
      });
    } else if (driver === 'minimax_h3') {
      accountForm.setFieldsValue({
        provider_key: (accountForm.getFieldValue('provider_key') || '').trim() || 'minimax',
        base_url: (accountForm.getFieldValue('base_url') || '').trim() || 'https://api.minimaxi.com',
        auth_style: 'bearer',
      });
    } else if (driver === 'volcengine_ark') {
      accountForm.setFieldsValue({
        provider_key: (accountForm.getFieldValue('provider_key') || '').trim() || 'volcengine',
        base_url: (accountForm.getFieldValue('base_url') || '').trim() || 'https://ark.cn-beijing.volces.com',
        auth_style: 'bearer',
      });
    } else if ((accountForm.getFieldValue('auth_style') || '') === 'raw_authorization_header') {
      accountForm.setFieldsValue({ auth_style: 'bearer' });
    }
  };
  const saveAccount = async () => {
    let values: any;
    try {
      values = await accountForm.validateFields();
    } catch (e: any) {
      if (e?.errorFields) return;
      throw e;
    }
    let extraHeaders: Record<string, string> = {};
    try {
      extraHeaders = parseHeaders(values.extra_headers);
    } catch {
      message.error('额外请求头需为合法 JSON 对象');
      return;
    }
    const payload: Record<string, any> = {
      provider_key: (values.provider_key || '').trim() || values.driver,
      driver: values.driver,
      name: values.name,
      base_url: (values.base_url || '').trim(),
      auth_style: values.auth_style,
      status: values.status,
      remark: values.remark || '',
      verify_ssl: values.verify_ssl !== false,
      proxy: (values.proxy || '').trim(),
      extra_headers: extraHeaders,
    };
    if (values.api_key) payload.api_key = values.api_key;
    try {
      if (accountEditing) await videoApi.updateAccount(accountEditing.id, payload);
      else await videoApi.createAccount(payload);
    } catch (e: any) {
      message.error(e?.response?.data?.error || '保存账号失败');
      return;
    }
    message.success('已保存账号');
    setAccountOpen(false);
    loadCurrent();
  };
  const openFetchModels = async (account: any) => {
    setFetchModelsAccount(account);
    setFetchModelsList([]);
    setFetchModelsSelected([]);
    setImportCreditCost(null);
    setFetchModelsOpen(true);
    setFetchModelsLoading(true);
    try {
      const res = await videoApi.fetchProviderModels(account.id);
      const list = (res.data.models || []).map((m: any, idx: number) => ({ key: m.id || String(idx), ...m }));
      setFetchModelsList(list);
      setFetchModelsSelected(list.filter((m: any) => !m.exists).map((m: any) => m.key));
    } catch (e: any) {
      message.error(e?.response?.data?.error || '拉取模型失败');
      setFetchModelsOpen(false);
    } finally {
      setFetchModelsLoading(false);
    }
  };
  const importFetchedModels = async () => {
    const account = fetchModelsAccount;
    if (!account) return;
    const chosen = fetchModelsList.filter((m) => fetchModelsSelected.includes(m.key) && !m.exists);
    if (!chosen.length) {
      message.warning('请选择至少一个未导入的模型');
      return;
    }
    if (importCreditCost === null || importCreditCost <= 0) {
      message.warning(`请先确认每次生成的默认${labels.credit}，且必须大于 0`);
      return;
    }
    setFetchModelsLoading(true);
    try {
      const res = await videoApi.importProviderModels(account.id, {
        models: chosen.map((item) => ({ id: item.id, name: item.name || item.id })),
        default_credit_cost: importCreditCost,
      });
      const created = res.data.created || [];
      const failures = res.data.failures || [];
      if (created.length) message.success(`已导入并定价 ${created.length} 个模型${failures.length ? `，${failures.length} 个需处理` : ''}`);
      if (failures.length) Modal.warning({ title: '部分导入未完成', content: <pre style={{ whiteSpace: 'pre-wrap' }}>{failures.map((item: any) => `${item.id}：${item.error}`).join('\n')}</pre> });
      setFetchModelsOpen(false);
      loadCurrent();
    } catch (e: any) {
      message.error(e?.response?.data?.error || '导入模型失败');
    } finally {
      setFetchModelsLoading(false);
    }
  };
  const fillModelForm = (row: any) => {
    const pp = row?.provider_params || {};
    const { submit_path, query_path, ...restPP } = pp;
    modelForm.setFieldsValue({
      provider_key: row?.provider_key || '',
      provider_protocol: row?.provider_protocol || 'openai_video',
      model_id: row?.model_id || '',
      display_name: row?.display_name || '',
      generation_type: row?.generation_type || 'text_or_image_to_video',
      supported_modes: toArray(row?.supported_modes),
      supported_durations: toArray(row?.supported_durations).map((v: any) => Number(v)),
      supported_resolutions: toArray(row?.supported_resolutions),
      supported_aspect_ratios: toArray(row?.supported_aspect_ratios),
      max_reference_images: row?.max_reference_images ?? 0,
      submit_path: submit_path || '',
      query_path: query_path || '',
      advanced_params: Object.keys(restPP).length ? JSON.stringify(restPP, null, 2) : '',
      description: row?.description || '',
      sort_order: row?.sort_order ?? 0,
      status: row?.status || 'active',
    });
  };
  const openModel = (row: any) => {
    setModelCreating(false);
    setModelEditing(row);
    modelForm.resetFields();
    fillModelForm(row);
    setModelOpen(true);
  };
  const openModelCreate = (providerKey?: string) => {
    setModelCreating(true);
    setModelEditing(null);
    modelForm.resetFields();
    fillModelForm({
      provider_key: providerKey || '',
      provider_protocol: 'openai_video',
      generation_type: 'text_or_image_to_video',
      supported_modes: ['text_to_video', 'image_to_video'],
      supported_durations: [5],
      supported_resolutions: ['720p', '1080p'],
      supported_aspect_ratios: ['16:9', '9:16', '1:1'],
      max_reference_images: 1,
      provider_params: { submit_path: '/v1/videos', query_path: '/v1/videos/{task_id}' },
      status: 'active',
      sort_order: 0,
    });
    setModelOpen(true);
  };
  const saveModel = async () => {
    let values: any;
    try {
      values = await modelForm.validateFields();
    } catch (e: any) {
      if (e?.errorFields) return;
      throw e;
    }
    let advanced: Record<string, any> = {};
    try {
      advanced = parseAdvancedParams(values.advanced_params);
    } catch {
      message.error('高级参数需为合法 JSON 对象');
      return;
    }
    const providerParams: Record<string, any> = { ...advanced };
    if ((values.submit_path || '').trim()) providerParams.submit_path = values.submit_path.trim();
    if ((values.query_path || '').trim()) providerParams.query_path = values.query_path.trim();

    const payload: Record<string, any> = {
      display_name: values.display_name,
      provider_protocol: values.provider_protocol,
      generation_type: values.generation_type,
      status: values.status,
      sort_order: values.sort_order ?? 0,
      description: values.description || '',
      supported_modes: toArray(values.supported_modes),
      supported_durations: toArray(values.supported_durations).map((v: any) => Number(v)).filter((v: number) => v > 0),
      supported_resolutions: toArray(values.supported_resolutions),
      supported_aspect_ratios: toArray(values.supported_aspect_ratios),
      max_reference_images: values.max_reference_images ?? 0,
      provider_params: providerParams,
    };
    try {
      if (modelCreating) {
        payload.provider_key = (values.provider_key || '').trim();
        payload.model_id = (values.model_id || '').trim();
        if (!payload.provider_key || !payload.model_id) {
          message.error('请填写服务商标识与模型 ID');
          return;
        }
        const created = await videoApi.createModel(payload);
        const spec = created.data?.model;
        const cost = values.default_credit_cost;
        if (spec?.id && cost !== undefined && cost !== null && cost !== '') {
          try {
            await videoApi.createSku({
              video_model_spec_id: spec.id,
              title: `${values.display_name || payload.model_id} 默认规格`,
              duration_seconds: toArray(values.supported_durations).map((v: any) => Number(v)).find((v: number) => v > 0) || 5,
              resolution: toArray(values.supported_resolutions)[0] || '720p',
              default_credit_cost: Number(cost),
              status: 'active',
            });
          } catch (skuErr: any) {
            message.warning(skuErr?.response?.data?.error ? `模型已建、定价未写：${skuErr.response.data.error}` : '模型已建、定价未写');
          }
        }
      } else {
        await videoApi.updateModel(modelEditing.id, payload);
      }
    } catch (e: any) {
      message.error(e?.response?.data?.error || '保存模型失败');
      return;
    }
    message.success('已保存模型');
    setModelOpen(false);
    setModelEditing(null);
    setModelCreating(false);
    loadCurrent();
  };
  const deleteModel = async (row: any) => {
    try {
      const res = await videoApi.deleteModel(row.id);
      message.success(res.data?.message || '已删除模型');
      loadCurrent();
    } catch (e: any) {
      message.error(e?.response?.data?.error || '删除模型失败');
    }
  };
  const fillSkuForm = (row: any) => {
    skuForm.setFieldsValue({
      video_model_spec_id: row?.video_model_spec_id,
      title: row?.title || '',
      mode: row?.mode || undefined,
      duration_seconds: row?.duration_seconds || undefined,
      resolution: row?.resolution || undefined,
      aspect_ratio: row?.aspect_ratio || undefined,
      quality: row?.quality || '',
      default_credit_cost: isUnpriced(row || {}) ? undefined : Number(row?.default_credit_cost),
      provider_cost_text: row?.provider_cost_text || '',
      provider_cost_source: row?.provider_cost_source || '',
      status: row?.status || 'active',
      sort_order: row?.sort_order ?? 0,
    });
  };
  const openSku = (row: any) => {
    setSkuCreating(false);
    setSkuEditing(row);
    skuForm.resetFields();
    fillSkuForm(row);
    setSkuOpen(true);
  };
  const openSkuCreate = async () => {
    try {
      await ensureModels();
    } catch (e: any) {
      message.error(e?.response?.data?.error || '加载模型失败');
      return;
    }
    setSkuCreating(true);
    setSkuEditing(null);
    skuForm.resetFields();
    skuForm.setFieldsValue({ video_model_spec_id: skuModelFilter || undefined, status: 'active', sort_order: 0 });
    setSkuOpen(true);
  };
  const saveSku = async () => {
    let values: any;
    try {
      values = await skuForm.validateFields();
    } catch (e: any) {
      if (e?.errorFields) return;
      throw e;
    }
    const cost = values.default_credit_cost;
    const payload: Record<string, any> = {
      title: values.title,
      mode: values.mode || '',
      duration_seconds: values.duration_seconds ? Number(values.duration_seconds) : 0,
      resolution: values.resolution || '',
      aspect_ratio: values.aspect_ratio || '',
      quality: values.quality || '',
      default_credit_cost: (cost === undefined || cost === null || cost === '') ? null : Number(cost),
      provider_cost_text: values.provider_cost_text || '',
      provider_cost_source: values.provider_cost_source || '',
      status: values.status,
      sort_order: values.sort_order ?? 0,
    };
    // 计费维度一致性校验：同模型其它启用 SKU 必须锁定相同维度，否则桌面端规格选项 / 计费匹配会异常
    if (payload.status === 'active') {
      const targetModelId = skuCreating ? values.video_model_spec_id : skuEditing?.video_model_spec_id;
      const siblings = (allSkus.length ? allSkus : skus).filter((s) => Number(s.video_model_spec_id) === Number(targetModelId) && s.status === 'active' && Number(s.id) !== Number(skuEditing?.id || 0));
      const sibSigs = Array.from(new Set(siblings.map((s) => dimSignature(skuLockedDimKeys(s)))));
      const thisDims = skuLockedDimKeys(payload);
      if (sibSigs.length === 1 && sibSigs[0] !== dimSignature(thisDims)) {
        const proceed = await new Promise<boolean>((resolve) => {
          Modal.confirm({
            title: '计费维度不一致',
            mask: false,
            content: `该模型现有启用 SKU 锁定维度为「${dimLabels(skuLockedDimKeys(siblings[0])).join('、') || '无'}」，本次为「${dimLabels(thisDims).join('、') || '无'}」。同一模型所有 SKU 必须锁定相同维度，否则桌面端的规格选项与计费匹配会异常。是否仍要保存？`,
            okText: '仍要保存',
            cancelText: '返回修改',
            onOk: () => resolve(true),
            onCancel: () => resolve(false),
          });
        });
        if (!proceed) return;
      }
    }
    try {
      let nextSku: any;
      if (skuCreating) {
        payload.video_model_spec_id = values.video_model_spec_id;
        nextSku = (await videoApi.createSku(payload)).data.sku;
      } else {
        nextSku = (await videoApi.updateSku(skuEditing.id, payload)).data.sku;
      }
      if (nextSku) {
        const upsert = (list: any[]) => list.some((sku) => Number(sku.id) === Number(nextSku.id))
          ? list.map((sku) => Number(sku.id) === Number(nextSku.id) ? nextSku : sku)
          : [...list, nextSku];
        setSkus(upsert);
        setAllSkus(upsert);
      }
    } catch (e: any) {
      message.error(e?.response?.data?.error || '保存 SKU 失败');
      return;
    }
    message.success('已保存 SKU');
    setSkuOpen(false);
    setSkuEditing(null);
    setSkuCreating(false);
    loadCurrent();
  };
  const deleteSku = async (row: any) => {
    try {
      const res = await videoApi.deleteSku(row.id);
      message.success(res.data?.message || '已删除 SKU');
      loadCurrent();
    } catch (e: any) {
      message.error(e?.response?.data?.error || '删除 SKU 失败');
    }
  };
  const openBatchSku = async () => {
    let modelList: any[] = [];
    try {
      [modelList] = await Promise.all([ensureModels(), ensureSkus()]);
    } catch (e: any) {
      message.error(e?.response?.data?.error || '加载数据失败');
      return;
    }
    const initialId = skuModelFilter || undefined;
    setBatchSkuModelId(initialId);
    const m = modelList.find((x) => Number(x.id) === Number(initialId));
    setBatchLockedDims(m ? recommendedLockedDims(m.provider_protocol) : []);
    setBatchSkuOpen(true);
  };
  const runBatchSku = async () => {
    const m = batchSkuModel;
    if (!m) { message.warning('请选择模型'); return; }
    if (!batchSkuCombos.length) { message.warning('该模型没有可生成的规格组合'); return; }
    const existing = (allSkus.length ? allSkus : skus).filter((s) => Number(s.video_model_spec_id) === Number(m.id));
    const existsCombo = (c: { mode: string; duration_seconds: number; resolution: string; aspect_ratio: string }) => existing.some((s) => (s.mode || '') === c.mode && Number(s.duration_seconds || 0) === c.duration_seconds && (s.resolution || '') === c.resolution && (s.aspect_ratio || '') === c.aspect_ratio);
    setBatchSkuLoading(true);
    let created = 0; let skipped = 0; let failed = 0;
    for (const combo of batchSkuCombos) {
      if (existsCombo(combo)) { skipped += 1; continue; }
      const modeLabel = MODE_OPTIONS.find((o) => o.value === combo.mode)?.label || '';
      const title = [m.display_name, modeLabel, combo.duration_seconds ? `${combo.duration_seconds}s` : '', combo.resolution, combo.aspect_ratio].filter(Boolean).join(' ');
      try {
        await videoApi.createSku({ video_model_spec_id: m.id, title, mode: combo.mode, duration_seconds: combo.duration_seconds, resolution: combo.resolution, aspect_ratio: combo.aspect_ratio, status: 'active' });
        created += 1;
      } catch {
        failed += 1;
      }
    }
    setBatchSkuLoading(false);
    message.success(`已生成 ${created} 个 SKU${skipped ? `，跳过 ${skipped} 个已存在` : ''}${failed ? `，${failed} 个失败` : ''}，请到列表统一定价`);
    setBatchSkuOpen(false);
    loadCurrent();
  };
  const startInlineEditSku = (sku: any) => {
    setInlineEditingSkuId(Number(sku.id));
    setInlineCreditCost(isUnpriced(sku) ? null : Number(sku.default_credit_cost));
  };
  const saveInlineSkuPrice = async (sku: any) => {
    setInlineSavingSkuId(Number(sku.id));
    try {
      const res = await videoApi.updateSku(sku.id, { default_credit_cost: inlineCreditCost });
      const nextSku = res.data.sku;
      if (nextSku) {
        setSkus((list) => list.map((item) => Number(item.id) === Number(nextSku.id) ? nextSku : item));
        setAllSkus((list) => list.map((item) => Number(item.id) === Number(nextSku.id) ? nextSku : item));
      }
      message.success('已保存默认积分');
      setInlineEditingSkuId(null);
      setInlineCreditCost(null);
    } catch (e: any) {
      message.error(e?.response?.data?.error || '保存默认积分失败');
    } finally {
      setInlineSavingSkuId(null);
    }
  };
  const batchUpdateSkuStatus = async (status: 'active' | 'disabled') => {
    if (!selectedSkuIds.length) {
      message.warning('请先选择 SKU');
      return;
    }
    try {
      const res = await videoApi.batchUpdateSkus({ ids: selectedSkuIds.map((id) => Number(id)), status });
      const nextSkus = res.data.skus || [];
      if (nextSkus.length) {
        const nextMap = new Map(nextSkus.map((sku: any) => [Number(sku.id), sku]));
        setSkus((list) => list.map((sku) => nextMap.get(Number(sku.id)) || sku));
        setAllSkus((list) => list.map((sku) => nextMap.get(Number(sku.id)) || sku));
      }
      message.success(`已${status === 'active' ? '启用' : '禁用'} ${res.data.affected || selectedSkuIds.length} 个 SKU`);
      setSelectedSkuIds([]);
      loadCurrent();
    } catch (e: any) {
      message.error(e?.response?.data?.error || '批量更新 SKU 失败');
    }
  };
  const openRule = async (row?: any) => {
    try {
      await Promise.all([ensureSkus(), loadTargetOptions()]);
    } catch (e: any) {
      message.error(e?.response?.data?.error || '加载 SKU 失败');
      return;
    }
    if (row?.target_type === 'default') {
      message.warning('默认扣费请在 SKU 与价格中维护');
      return;
    }
    setRuleEditing(row || null);
    ruleForm.resetFields();
    ruleForm.setFieldsValue(row
      ? { ...row, video_sku_price_id: row.video_sku_price_id, target_id: row.target_id }
      : { target_type: 'user', target_ids: [], status: 'active' });
    setRuleOpen(true);
  };
  const saveRule = async () => {
    try {
      const values = await ruleForm.validateFields();
      if (ruleEditing) {
        await videoApi.updatePricingRule(ruleEditing.id, {
          credit_cost: values.credit_cost,
          status: values.status,
          remark: values.remark || '',
        });
        message.success('已保存计费规则');
      } else {
        const targetIds = toArray(values.target_ids).map((id) => Number(id)).filter((id) => id > 0);
        if (!targetIds.length) {
          message.warning('请选择至少一个用户或分组');
          return;
        }
        const res = await videoApi.batchCreatePricingRules({
          video_sku_price_id: values.video_sku_price_id,
          target_type: values.target_type,
          target_ids: targetIds,
          credit_cost: values.credit_cost,
          status: values.status,
          remark: values.remark || '',
        });
        message.success(`已保存 ${res.data.affected} 条计费规则`);
      }
      setRuleOpen(false);
      loadCurrent();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.response?.data?.error || '保存计费规则失败');
    }
  };
  const openDiscountRule = async () => {
    try {
      await Promise.all([ensureModels(), ensureSkus(), loadTargetOptions()]);
    } catch (e: any) {
      message.error(e?.response?.data?.error || '加载批量折扣配置失败');
      return;
    }
    discountForm.resetFields();
    discountForm.setFieldsValue({
      video_model_spec_ids: [],
      target_type: 'user',
      target_ids: [],
      discount_percent: 80,
      conflict_strategy: 'overwrite',
      status: 'active',
    });
    setDiscountOpen(true);
  };
  const saveDiscountRule = async () => {
    try {
      const values = await discountForm.validateFields();
      const modelIds = toArray(values.video_model_spec_ids).map((id) => Number(id)).filter((id) => id > 0);
      const targetIds = toArray(values.target_ids).map((id) => Number(id)).filter((id) => id > 0);
      if (!modelIds.length) {
        message.warning('请选择至少一个视频模型');
        return;
      }
      if (!targetIds.length) {
        message.warning('请选择至少一个用户或分组');
        return;
      }
      if (discountPreview.total <= 0) {
        message.warning('所选模型下没有已启用且已定价的 SKU');
        return;
      }
      if (discountPreview.total > 20000) {
        message.warning('本次批量规则数量过大，请减少模型或目标数量后重试');
        return;
      }
      const res = await videoApi.batchCreatePricingRuleDiscounts({
        video_model_spec_ids: modelIds,
        target_type: values.target_type,
        target_ids: targetIds,
        discount_percent: values.discount_percent,
        conflict_strategy: values.conflict_strategy,
        status: values.status,
        remark: values.remark || '',
      });
      const data = res.data || {};
      const targetLabel = values.target_type === 'group' ? '用户组' : '用户';
      message.success(`已处理 ${data.model_count || 0} 个模型、${data.sku_count || 0} 个 SKU、${data.target_count || 0} 个${targetLabel}，新增 ${data.created || 0} 条，更新 ${data.updated || 0} 条${data.skipped_existing ? `，跳过 ${data.skipped_existing} 条` : ''}`);
      setDiscountOpen(false);
      loadCurrent();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.response?.data?.error || '批量设置模型折扣失败');
    }
  };

  const statusTag = (v: string) => <Tag color={STATUS_COLORS[v] || 'default'}>{STATUS_LABELS[v] || v || '-'}</Tag>;
  const softTag = (v: ReactNode) => <Tag>{v || '-'}</Tag>;
  const pageChange = (page: number, per_page: number) => setParams({ ...params, page, per_page });
  const pagination = (data: any) => ({ current: params.page, pageSize: params.per_page, total: data.total || 0, onChange: pageChange });
  const openModelSkus = (model: any) => {
    setSkuModelFilter(model.id);
    setTab('skus');
    setParams({ page: 1, per_page: 20, provider_protocol: model.provider_protocol });
  };
  const skuSpecText = (sku: any) => `${sku.duration_seconds ? `${sku.duration_seconds}s` : '-'} / ${sku.resolution || sku.quality || '-'} / ${sku.aspect_ratio || '-'}`;
  const ruleTarget = (rule: any) => {
    const targetId = Number(rule.target_id);
    const targetName = rule.target_type === 'user'
      ? userOptions.find((item) => Number(item.value) === targetId)?.label
      : groupOptions.find((item) => Number(item.value) === targetId)?.label;
    return <Tag color={rule.target_type === 'user' ? 'blue' : 'purple'}>{TARGET_TYPE_LABELS[rule.target_type] || rule.target_type}：{targetName || `ID ${targetId}`}</Tag>;
  };

  const statsCards = (
    <Row gutter={[16, 16]}>
      <Col xs={24} sm={12} lg={6}><Card><Statistic title="服务商账号" value={stats.active_accounts || 0} suffix={`/ ${stats.accounts || 0}`} /></Card></Col>
      <Col xs={24} sm={12} lg={6}><Card><Statistic title="模型 / SKU" value={stats.models || 0} suffix={`/ ${stats.skus || 0}`} /></Card></Col>
      <Col xs={24} sm={12} lg={6}><Card><Statistic title="待定价 SKU" value={stats.unpriced_skus || 0} /></Card></Col>
      <Col xs={24} sm={12} lg={6}><Card><Statistic title={`累计消耗${labels.credit}`} precision={2} value={Number(stats.credits_used || 0)} /></Card></Col>
    </Row>
  );

  const filters = (extra?: ReactNode) => (
    <Space style={{ marginBottom: 16 }} wrap>
      <Select placeholder="协议" allowClear style={{ width: 140 }} options={PROTOCOL_OPTIONS} onChange={(v) => setParams({ ...params, provider_protocol: v, page: 1 })} />
      <Select placeholder="状态" allowClear style={{ width: 140 }} options={STATUS_FILTER_OPTIONS} onChange={(v) => setParams({ ...params, status: v, page: 1 })} />
      {extra}
      <Button icon={<ReloadOutlined />} onClick={loadCurrent}>刷新</Button>
    </Space>
  );

  const onboardingContent = [
    <Card key="accounts" title="1. 配置视频线路" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => openAccount()}>新增线路</Button>}>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="先填写 API Key 并测试连通；支持模型列表的线路可直接进入导入。" />
      <Table rowKey="id" size="small" loading={loading} dataSource={accounts.data || []} pagination={pagination(accounts)} columns={[
        { title: '线路', render: (_: any, row: any) => <Space direction="vertical" size={0}><Typography.Text strong>{row.name}</Typography.Text><Typography.Text type="secondary">{row.provider_key} · {DRIVER_OPTIONS.find(item => item.value === row.driver)?.label || row.driver}</Typography.Text></Space> },
        { title: 'Key', width: 100, render: (_: any, row: any) => row.has_api_key ? <Tag color="green">已配置</Tag> : <Tag color="orange">未配置</Tag> },
        { title: '状态', dataIndex: 'status', width: 100, render: statusTag },
        { title: '操作', width: 240, render: (_: any, row: any) => <Space><Button size="small" onClick={() => openAccount(row)}>编辑</Button><Button size="small" onClick={async () => { const res = await videoApi.testAccount(row.id); message[res.data.ok ? 'success' : 'error'](res.data.message); loadCurrent(); }}>测试</Button>{row.supports_model_fetch && <Button size="small" type="primary" onClick={() => openFetchModels(row)}>拉取模型</Button>}</Space> },
      ] as any} />
    </Card>,
    <Card key="models" title="2. 确认模型能力" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => openModelCreate()}>新增模型</Button>}>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="确认模型的模式、时长、清晰度和比例；原始 JSON 参数在编辑窗口的高级区域。" />
      <Table rowKey="id" size="small" loading={loading} dataSource={models} pagination={false} columns={[
        { title: '模型', render: (_: any, row: any) => <Space direction="vertical" size={0}><Typography.Text strong>{row.display_name}</Typography.Text><Typography.Text type="secondary">{row.model_id}</Typography.Text></Space> },
        { title: '协议', dataIndex: 'provider_protocol', width: 130, render: softTag },
        { title: '能力', render: (_: any, row: any) => `${shortList(row.supported_durations, 's')} · ${shortList(row.supported_resolutions)} · ${shortList(row.supported_aspect_ratios)}` },
        { title: '操作', width: 100, render: (_: any, row: any) => <Button size="small" onClick={() => openModel(row)}>编辑</Button> },
      ] as any} />
    </Card>,
    <Card key="diagnostics" title="3. 检查桌面可见性">
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="体检只判断账号、模型、SKU 和定价；上游分组无渠道只能在任务失败后确认。" />
      <Table rowKey="id" size="small" loading={loading} dataSource={models.map(model => catalogDiagnostics[Number(model.id)] || model)} pagination={false} expandable={{
        rowExpandable: (row: any) => Array.isArray(row.skus) && row.skus.some((sku: any) => sku.id),
        expandedRowRender: (row: any) => <Table rowKey="id" size="small" pagination={false} dataSource={(row.skus || []).filter((sku: any) => sku.id)} columns={[
          { title: 'SKU', dataIndex: 'title' }, { title: `默认${labels.credit}`, dataIndex: 'default_credit_cost', width: 140, render: (value: any) => value === null || value === undefined ? <Tag color="orange">未定价</Tag> : value },
          { title: '状态', width: 180, render: (_: any, sku: any) => sku.visible ? <Tag color="green">桌面可见</Tag> : <Tag color="orange">{CATALOG_REASON_LABELS[sku.reason] || sku.reason}</Tag> },
        ] as any} />,
      }} columns={[
        { title: '模型', render: (_: any, row: any) => row.display_name || row.model_id },
        { title: '服务商', dataIndex: 'provider_key', width: 140 },
        { title: '官方参考', width: 220, render: (_: any, row: any) => <OfficialRefText modelId={row.model_id} modality="video" compact /> },
        { title: '体检结果', width: 220, render: (_: any, row: any) => row.visible ? <Tag color="green">桌面可见</Tag> : <Tag color="orange">{CATALOG_REASON_LABELS[row.reason] || row.reason || '待加载'}</Tag> },
        { title: '下一步', width: 120, render: (_: any, row: any) => !row.visible && <Button size="small" onClick={() => { setAdvancedOpen(true); openModelSkus(row); }}>管理 SKU</Button> },
      ] as any} />
    </Card>,
    <Card key="tasks" title="4. 查看任务结果">
      <Table rowKey="id" size="small" loading={loading} dataSource={tasks.data || []} pagination={pagination(tasks)} columns={[
        { title: '任务 ID', dataIndex: 'id', ellipsis: true }, { title: '模型', dataIndex: 'model_name', width: 180 },
        { title: '状态', dataIndex: 'status', width: 100, render: statusTag }, { title: '结果/失败原因', render: (_: any, row: any) => row.status === 'failed' ? (row.error_summary?.title || row.error_message || '-') : (row.result?.video_url ? '已生成' : '-') },
        { title: '操作', width: 100, render: (_: any, row: any) => <Button size="small" onClick={() => setDetailTask(row)}>详情</Button> },
      ] as any} />
    </Card>,
  ][onboardingStep];

  return <Space direction="vertical" size={16} style={{ width: '100%' }}>
    {statsCards}
    <Card title="视频开通向导" size="small">
      <Steps current={onboardingStep} onChange={(step) => { setOnboardingStep(step); setTab(step === 0 ? 'accounts' : step === 3 ? 'tasks' : 'models'); }} items={[
        { title: '线路', description: '填 Key 并测连通' }, { title: '模型', description: '拉取或新建模型' },
        { title: '体检', description: '查看桌面可见原因' }, { title: '任务', description: '查看生成结果与错误' },
      ]} />
    </Card>
    {onboardingContent}
    <details open={advancedOpen} onToggle={(event) => setAdvancedOpen(event.currentTarget.open)} style={{ width: '100%' }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600, padding: '12px 0' }}>高级管理（SKU、计费、原始数据）</summary>
      <Tabs activeKey={tab} onChange={(k) => { setTab(k); setParams({ page: 1, per_page: 20 }); if (k !== 'skus') setSkuModelFilter(undefined); }} items={[
      { key: 'stats', label: '概览', children: <Card title="AI 视频概览" loading={loading}><Descriptions bordered size="small" column={2} items={[
        { key: 'pending', label: '进行中任务', children: stats.pending_tasks || 0 },
        { key: 'completed', label: '完成任务', children: stats.completed_tasks || 0 },
        { key: 'failed', label: '失败任务', children: stats.failed_tasks || 0 },
        { key: 'credits', label: `累计消耗${labels.credit}`, children: Number(stats.credits_used || 0).toFixed(2) },
      ]} /></Card> },
      { key: 'accounts', label: '服务商账号', children: <Card title="服务商账号" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => openAccount()}>新增账号</Button>}>
        <Table rowKey="id" loading={loading} dataSource={accounts.data || []} pagination={pagination(accounts)} columns={[
          { title: 'ID', dataIndex: 'id', width: 70 },
          { title: '名称', dataIndex: 'name' },
          { title: '服务商', dataIndex: 'provider_key', render: (v: string, r: any) => <Space direction="vertical" size={0}><Typography.Text strong>{v}</Typography.Text><Typography.Text type="secondary" style={{ fontSize: 12 }}>{DRIVER_OPTIONS.find(d => d.value === r.driver)?.label || r.driver}</Typography.Text></Space> },
          { title: '地址', dataIndex: 'base_url', ellipsis: true },
          { title: 'Key', dataIndex: 'has_api_key', render: (v: boolean) => v ? <Tag color="green">已配置</Tag> : <Tag>未配置</Tag> },
          { title: '状态', dataIndex: 'status', render: statusTag },
          { title: '测试', dataIndex: 'last_test_status', render: statusTag },
          { title: '操作', width: 320, render: (_: any, r: any) => <Space size={4} wrap><Button size="small" onClick={() => openAccount(r)}>编辑</Button><Button size="small" onClick={async () => { const res = await videoApi.testAccount(r.id); message[res.data.ok ? 'success' : 'error'](res.data.message); loadCurrent(); }}>测试</Button>{r.supports_model_fetch && <Button size="small" onClick={() => openFetchModels(r)}>拉取模型</Button>}<Popconfirm title="确认删除或禁用？" onConfirm={async () => { await videoApi.deleteAccount(r.id); loadCurrent(); }}><Button size="small" danger>删除</Button></Popconfirm></Space> },
        ] as any} />
      </Card> },
      { key: 'models', label: '视频模型', children: <Card title="视频模型" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => openModelCreate()}>新增模型</Button>}>{filters()}<Table rowKey="id" loading={loading} dataSource={models} pagination={false} columns={[
        { title: '模型', width: 240, render: (_: any, r: any) => <Space direction="vertical" size={2}><Typography.Text strong>{r.display_name}</Typography.Text><Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.model_id}</Typography.Text><Space size={4} wrap>{softTag(r.provider_protocol)}</Space></Space> },
        { title: '服务商', dataIndex: 'provider_key', width: 130, render: (v: string) => <Tag color="blue">{v || '-'}</Tag> },
        { title: '桌面可见', width: 150, render: (_: any, r: any) => { const diagnostic = catalogDiagnostics[Number(r.id)]; if (!diagnostic) return '-'; return diagnostic.visible ? <Tag color="green">是</Tag> : <Space direction="vertical" size={2}><Tag color="orange">否</Tag><Typography.Text type="secondary" style={{ fontSize: 12 }}>{CATALOG_REASON_LABELS[diagnostic.reason] || diagnostic.reason}</Typography.Text></Space>; } },
        { title: '能力范围', render: (_: any, r: any) => <Space direction="vertical" size={4}><Typography.Text>模式：{shortList(r.supported_modes)}</Typography.Text><Typography.Text>时长：{shortList(r.supported_durations, 's')}</Typography.Text><Typography.Text>清晰度：{shortList(r.supported_resolutions)}</Typography.Text><Typography.Text>比例：{shortList(r.supported_aspect_ratios)}</Typography.Text></Space> },
        { title: 'SKU', width: 150, render: (_: any, r: any) => { const list = r.skus || []; const active = list.filter((sku: any) => sku.status === 'active').length; return <Space direction="vertical" size={4}><Typography.Text>{active} 启用 / {list.length} 总数</Typography.Text><Button size="small" onClick={() => openModelSkus(r)}>管理 SKU</Button></Space>; } },
        { title: '参考图', dataIndex: 'max_reference_images', width: 90 },
        { title: '状态', dataIndex: 'status', render: statusTag, width: 100 },
        { title: '排序', dataIndex: 'sort_order', width: 80 },
        { title: '操作', width: 150, render: (_: any, r: any) => <Space size={4}><Button size="small" onClick={() => openModel(r)}>编辑</Button><Popconfirm title="确认删除或禁用该模型？" onConfirm={() => deleteModel(r)}><Button size="small" danger>删除</Button></Popconfirm></Space> },
      ] as any} /></Card> },
      { key: 'skus', label: 'SKU 与价格', children: <Card title="SKU 与价格" extra={<Space><Button onClick={openBatchSku}>批量生成</Button><Button type="primary" icon={<PlusOutlined />} onClick={openSkuCreate}>新增 SKU</Button></Space>}>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={`SKU 预置规格和上游人民币成本；默认${labels.credit}留空表示待定价，桌面端不会展示，用户不能生成。`}
        />
        {filters(<><Select placeholder="服务商" allowClear style={{ width: 160 }} value={skuProviderFilter} options={skuProviderOptions} onChange={(v) => setSkuProviderFilter(v)} /><Select placeholder="模型" allowClear style={{ width: 220 }} value={skuModelFilter} options={models.map(model => ({ value: model.id, label: model.display_name }))} onChange={(v) => setSkuModelFilter(v)} /><Select placeholder="定价状态" allowClear style={{ width: 140 }} options={PRICING_STATUS_OPTIONS} onChange={(v) => setParams({ ...params, pricing_status: v, page: 1 })} />{skuModelFilter && <Button onClick={() => setSkuModelFilter(undefined)}>清除模型筛选</Button>}<Button disabled={!selectedSkuIds.length} onClick={() => batchUpdateSkuStatus('active')}>批量启用</Button><Button disabled={!selectedSkuIds.length} danger onClick={() => batchUpdateSkuStatus('disabled')}>批量禁用</Button></>)}<Table rowKey="id" loading={loading} dataSource={visibleSkus} pagination={false} rowSelection={{ selectedRowKeys: selectedSkuIds, onChange: setSelectedSkuIds }} columns={[
        { title: 'SKU', width: 280, render: (_: any, r: any) => <Space direction="vertical" size={2}><Typography.Text strong>{r.title}</Typography.Text><Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.sku_key}</Typography.Text><Typography.Text type="secondary" style={{ fontSize: 12 }}>{relationModel(r)?.display_name || r.model_id}</Typography.Text></Space> },
        { title: '服务商', dataIndex: 'provider_key', width: 110, render: (v: string) => <Tag color="blue">{v || '-'}</Tag> },
        { title: '规格（蓝＝计费锁定 / 灰＝用户自选）', width: 300, render: (_: any, r: any) => {
          const locked = skuLockedDimKeys(r);
          const cell = (key: DimKey, label: string, value: ReactNode) => locked.includes(key)
            ? <Tag color="blue" key={key}>{label}：{value}</Tag>
            : <Tag key={key} style={{ color: '#999' }}>{label}：自选</Tag>;
          return <Space size={4} wrap>{cell('mode', '模式', r.mode)}{cell('duration', '时长', r.duration_seconds ? `${r.duration_seconds}s` : '')}{cell('resolution', '清晰度', r.resolution || r.quality)}{cell('aspect_ratio', '比例', r.aspect_ratio)}</Space>;
        } },
        { title: `默认${labels.credit}`, dataIndex: 'default_credit_cost', width: 210, render: (_: any, r: any) => inlineEditingSkuId === Number(r.id) ? <Space.Compact><InputNumber min={0} precision={4} value={inlineCreditCost} placeholder="留空待定价" onChange={(v) => setInlineCreditCost(v === null ? null : Number(v))} style={{ width: 110 }} /><Button size="small" type="primary" loading={inlineSavingSkuId === Number(r.id)} onClick={() => saveInlineSkuPrice(r)}>保存</Button><Button size="small" onClick={() => { setInlineEditingSkuId(null); setInlineCreditCost(null); }}>取消</Button></Space.Compact> : <Space size={4}>{priceText(r.default_credit_cost)}<Button size="small" type="text" icon={<EditOutlined />} onClick={() => startInlineEditSku(r)} /></Space> },
        { title: '定价状态', width: 100, render: (_: any, r: any) => isUnpriced(r) ? <Tag color="orange">待定价</Tag> : <Tag color="green">已定价</Tag> },
        { title: '上游成本', width: 220, render: (_: any, r: any) => <Space direction="vertical" size={2}><Typography.Text>{r.provider_cost_text || '-'}</Typography.Text>{r.provider_cost_source ? <Typography.Link href={r.provider_cost_source} target="_blank">查看来源</Typography.Link> : <Typography.Text type="secondary">未配置来源</Typography.Text>}</Space> },
        { title: '状态', dataIndex: 'status', render: statusTag, width: 100 },
        { title: '操作', width: 150, render: (_: any, r: any) => <Space size={4}><Button size="small" onClick={() => openSku(r)}>编辑</Button><Popconfirm title="确认删除或禁用该 SKU？" onConfirm={() => deleteSku(r)}><Button size="small" danger>删除</Button></Popconfirm></Space> },
      ] as any} /></Card> },
      { key: 'pricing', label: '计费规则', children: <Card title="用户/分组计费规则" extra={<Space><Button onClick={openDiscountRule}>批量设置模型折扣</Button><Button type="primary" icon={<PlusOutlined />} onClick={() => openRule()}>新增计费规则</Button></Space>}>
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>默认扣费只在 SKU 与价格中维护；这里仅维护某个用户或用户组的专属扣费。命中优先级：用户计费 &gt; 分组计费 &gt; SKU 默认扣费。</Typography.Text>
        <Table rowKey="id" loading={loading} dataSource={rules.data || []} pagination={pagination(rules)} columns={[
          { title: 'SKU', width: 320, render: (_: any, r: any) => { const sku = relationSku(r); return <Space direction="vertical" size={2}><Typography.Text strong>{sku?.title || '-'}</Typography.Text><Typography.Text type="secondary" style={{ fontSize: 12 }}>{relationModel(sku)?.display_name || sku?.model_id || '-'}</Typography.Text><Typography.Text type="secondary" style={{ fontSize: 12 }}>{sku ? skuSpecText(sku) : '-'}</Typography.Text></Space>; } },
          { title: '适用对象', render: (_: any, r: any) => ruleTarget(r), width: 180 },
          { title: `专属${labels.credit}`, dataIndex: 'credit_cost', width: 120, render: numberText },
          { title: `默认${labels.credit}`, width: 120, render: (_: any, r: any) => priceText(relationSku(r)?.default_credit_cost) },
          { title: '较默认价', width: 120, render: (_: any, r: any) => isUnpriced(relationSku(r)) ? '-' : signedNumberText(diffNumber(r.credit_cost, relationSku(r)?.default_credit_cost)) },
          { title: '状态', dataIndex: 'status', render: statusTag, width: 100 },
          { title: '备注', dataIndex: 'remark', ellipsis: true },
          { title: '操作', width: 160, render: (_: any, r: any) => <Space><Button size="small" onClick={() => openRule(r)}>编辑</Button><Popconfirm title="确认删除？" onConfirm={async () => { await videoApi.deletePricingRule(r.id); loadCurrent(); }}><Button size="small" danger>删除</Button></Popconfirm></Space> },
        ] as any} />
      </Card> },
      { key: 'tasks', label: '任务结果', children: <Card>{filters(<Input.Search placeholder="任务 ID / 提示词" allowClear style={{ width: 240 }} onSearch={(v) => setParams({ ...params, keyword: v || undefined, page: 1 })} />)}<Table rowKey="id" loading={loading} dataSource={tasks.data || []} pagination={pagination(tasks)} columns={[
        { title: '任务', dataIndex: 'id', width: 210, ellipsis: true }, { title: '协议', dataIndex: 'provider_protocol', render: statusTag }, { title: '模型', dataIndex: 'model_name' }, { title: '状态', dataIndex: 'status', render: statusTag }, { title: '失败原因', width: 240, ellipsis: true, render: (_: any, r: any) => r.status === 'failed' ? (r.error_summary?.title || r.error_message || '-') : '-' }, { title: '进度', dataIndex: 'progress', render: (v: number) => `${v || 0}%` }, { title: labels.credit, dataIndex: 'credits_used' }, { title: '创建时间', dataIndex: 'created_at', width: 170 }, { title: '操作', width: 230, render: (_: any, r: any) => <Space size={4}><Button size="small" onClick={() => setDetailTask(r)}>详情</Button><Button size="small" onClick={async () => { await videoApi.refreshTask(r.id); loadCurrent(); }}>刷新</Button><Button size="small" onClick={async () => { await videoApi.cancelTask(r.id); loadCurrent(); }}>取消</Button><Popconfirm title="确认删除？" onConfirm={async () => { await videoApi.deleteTask(r.id); loadCurrent(); }}><Button size="small" danger>删除</Button></Popconfirm></Space> },
      ] as any} /></Card> },
      { key: 'usage', label: '用量记录', children: <Card>{filters()}<Table rowKey="id" loading={loading} dataSource={usage.data || []} pagination={pagination(usage)} columns={[
        { title: 'ID', dataIndex: 'id', width: 80 }, { title: '用户', dataIndex: 'user_id', width: 90 }, { title: '任务', dataIndex: 'video_task_id', ellipsis: true }, { title: '协议', dataIndex: 'provider_protocol', render: statusTag }, { title: 'SKU', dataIndex: 'sku_key', ellipsis: true }, { title: labels.credit, dataIndex: 'credits_used' }, { title: '状态', dataIndex: 'status', render: statusTag }, { title: '时间', dataIndex: 'created_at', width: 170 },
      ] as any} /></Card> },
      ]} />
    </details>

    <Modal title={accountEditing ? '编辑视频账号' : '新增视频账号'} open={accountOpen} onOk={saveAccount} onCancel={() => setAccountOpen(false)} destroyOnClose mask={false} width={620}>
      <Form form={accountForm} layout="vertical">
        <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 12 }}>
          同一「服务商标识」同时只保留一个正常账号；保存为正常时，其他同标识账号会自动改为禁用。接入多个不同服务商时，请使用不同的服务商标识。
        </Typography.Text>
        <Form.Item name="driver" label="服务商类型" rules={[{ required: true }]} tooltip="决定使用哪套协议对接上游">
          <Select options={DRIVER_OPTIONS} onChange={onAccountDriverChange} />
        </Form.Item>
        <Form.Item name="provider_key" label="服务商标识" rules={[{ required: true, message: '请填写服务商标识' }]} tooltip="同类型多个服务商用它区分；模型与 SKU 按该标识归属">
          <Input placeholder="如 duomi、jimeng、my-openai-video" disabled={!!accountEditing} />
        </Form.Item>
        <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input placeholder="便于辨认的账号名称" /></Form.Item>
        <Form.Item name="base_url" label="Base URL" rules={accountDriver === 'openai_video' || accountDriver === 'wan' || accountDriver === 'minimax_h3' || accountDriver === 'volcengine_ark' ? [{ required: true, message: '请填写 Base URL' }] : []}>
          <Input placeholder={accountDriver === 'duomi' ? 'https://duomiapi.com' : accountDriver === 'wan' ? 'https://api.likeadmin.cn' : accountDriver === 'minimax_h3' ? 'https://api.minimaxi.com' : accountDriver === 'volcengine_ark' ? 'https://ark.cn-beijing.volces.com' : '如 http://127.0.0.1:8790'} />
        </Form.Item>
        <Form.Item name="api_key" label="API Key"><Input.Password placeholder={accountEditing ? '留空表示不修改' : '上游服务商的 API Key'} /></Form.Item>
        <Form.Item name="auth_style" label="鉴权方式" rules={[{ required: true }]}><Select options={AUTH_STYLE_OPTIONS} /></Form.Item>
        <Row gutter={16}>
          <Col span={12}><Form.Item name="verify_ssl" label="校验 SSL 证书" valuePropName="checked" tooltip="自建/内网服务证书异常时可关闭"><Switch /></Form.Item></Col>
          <Col span={12}><Form.Item name="status" label="状态"><Select options={ENABLED_STATUS_OPTIONS} /></Form.Item></Col>
        </Row>
        <details style={{ marginBottom: 16 }}><summary>高级网络参数</summary>
          <Form.Item name="proxy" label="代理（可选）" tooltip="如 http://127.0.0.1:7890"><Input placeholder="留空不使用代理" /></Form.Item>
          <Form.Item name="extra_headers" label="额外请求头（可选 JSON）" tooltip=' 如 {"X-Title": "my-app"}'><Input.TextArea rows={2} placeholder='{"X-Title": "my-app"}' /></Form.Item>
        </details>
        <Form.Item name="remark" label="备注"><Input.TextArea rows={2} /></Form.Item>
      </Form>
    </Modal>
    <Modal title={modelCreating ? '新增视频模型' : '编辑视频模型'} open={modelOpen} onOk={saveModel} onCancel={() => { setModelOpen(false); setModelEditing(null); setModelCreating(false); }} destroyOnClose mask={false} width={840}>
      <Form form={modelForm} layout="vertical">
        <Row gutter={16}>
          <Col span={12}><Form.Item name="provider_key" label="服务商标识" rules={[{ required: true, message: '请填写服务商标识' }]} tooltip="需与服务商账号的标识一致"><Input placeholder="如 jimeng" disabled={!modelCreating} /></Form.Item></Col>
          <Col span={12}><Form.Item name="provider_protocol" label="协议" rules={[{ required: true }]}><Select options={PROTOCOL_OPTIONS} /></Form.Item></Col>
        </Row>
        <VideoModelOnboardFields form={modelForm} creating={modelCreating} creditLabel={labels.credit} existingModels={models} />
        <Row gutter={16}>
          <Col span={12}><Form.Item name="display_name" label="显示名称" rules={[{ required: true }]}><Input /></Form.Item></Col>
          <Col span={12}><Form.Item name="generation_type" label="生成类型"><Select options={GENERATION_TYPE_OPTIONS} /></Form.Item></Col>
        </Row>
        <Form.Item name="supported_modes" label="支持模式"><Select mode="tags" options={MODE_OPTIONS} placeholder="可选择或输入自定义模式" /></Form.Item>
        <Row gutter={16}>
          <Col span={8}><Form.Item name="supported_durations" label="支持时长（秒）"><Select mode="tags" options={DURATION_OPTIONS} placeholder="如 5、10" tokenSeparators={[',']} /></Form.Item></Col>
          <Col span={8}><Form.Item name="supported_resolutions" label="支持清晰度"><Select mode="tags" options={RESOLUTION_OPTIONS} placeholder="如 720p、1080p" /></Form.Item></Col>
          <Col span={8}><Form.Item name="supported_aspect_ratios" label="支持画面比例"><Select mode="tags" options={ASPECT_RATIO_OPTIONS} placeholder="如 16:9、9:16" /></Form.Item></Col>
        </Row>
        <Row gutter={16}>
          <Col span={8}><Form.Item name="max_reference_images" label="最大参考图"><InputNumber min={0} max={50} style={{ width: '100%' }} /></Form.Item></Col>
          <Col span={8}><Form.Item name="status" label="状态"><Select options={ENABLED_STATUS_OPTIONS} /></Form.Item></Col>
          <Col span={8}><Form.Item name="sort_order" label="排序"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
        </Row>
        <Row gutter={16}>
          <Col span={12}><Form.Item name="submit_path" label="提交路径" tooltip="OpenAI 兼容默认 /v1/videos；Wan 默认 /api/v1/tasks"><Input placeholder="/v1/videos" /></Form.Item></Col>
          <Col span={12}><Form.Item name="query_path" label="查询路径" tooltip="用 {task_id} 占位"><Input placeholder="/v1/videos/{task_id}" /></Form.Item></Col>
        </Row>
        <details style={{ marginBottom: 16 }}><summary>高级模型参数</summary><Form.Item name="advanced_params" label="高级参数（可选 JSON）" tooltip='可配 size / size_map / extra_body 等'><Input.TextArea rows={3} placeholder='{"size_map": {"720p": {"16:9": "1280x720"}}}' /></Form.Item></details>
        <Form.Item name="description" label="描述"><Input.TextArea rows={2} /></Form.Item>
      </Form>
    </Modal>
    <Modal title={skuCreating ? '新增视频 SKU' : '编辑视频 SKU'} open={skuOpen} onOk={saveSku} onCancel={() => { setSkuOpen(false); setSkuEditing(null); setSkuCreating(false); }} destroyOnClose mask={false} width={840}>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={<>SKU 采用「计费维度」模型：<Typography.Text strong>只填影响价格的维度</Typography.Text>，其余维度<Typography.Text strong>留空</Typography.Text>＝不影响价格、由用户生成时在模型能力内自选。例如 Seedance 按秒计费 → 只填「时长」，清晰度/比例留空；VEO 按分辨率计费 → 只填「清晰度」（时长固定），模式/比例留空。<Typography.Text strong>同一模型的所有 SKU 必须锁定相同的维度</Typography.Text>。默认{labels.credit}留空＝待定价（桌面端不展示、不可生成），填 0＝免费。</>}
      />
      <Form form={skuForm} layout="vertical">
        <Form.Item name="video_model_spec_id" label="所属模型" rules={[{ required: true, message: '请选择模型' }]}>
          <Select showSearch optionFilterProp="label" disabled={!skuCreating} placeholder="选择模型" options={models.map((m) => ({ value: m.id, label: `${m.display_name}（${m.provider_key} / ${m.model_id}）` }))} />
        </Form.Item>
        {(() => {
          const m = models.find((x) => Number(x.id) === Number(skuModelSpecId));
          if (!m) return null;
          const siblings = (allSkus.length ? allSkus : skus).filter((s) => Number(s.video_model_spec_id) === Number(m.id) && s.status === 'active' && Number(s.id) !== Number(skuEditing?.id || 0));
          const sigs = Array.from(new Set(siblings.map((s) => dimSignature(skuLockedDimKeys(s)))));
          const lockedHint = siblings.length
            ? (sigs.length === 1 ? `该模型现有 SKU 锁定维度：${dimLabels(skuLockedDimKeys(siblings[0])).join('、') || '无（单一价格）'}（请保持一致）` : '注意：该模型现有 SKU 锁定维度不一致，建议本次统一')
            : '该模型暂无其它启用 SKU，本次将确立其计费维度';
          return <Alert type="success" showIcon style={{ marginBottom: 16 }} message={`模型能力 · 模式：${shortList(m.supported_modes)}；时长：${shortList(m.supported_durations, 's')}；清晰度：${shortList(m.supported_resolutions)}；比例：${shortList(m.supported_aspect_ratios)}`} description={lockedHint} />;
        })()}
        <Form.Item name="title" label="标题" rules={[{ required: true }]}><Input placeholder="如 Seedance 2.0 5秒 1080p" /></Form.Item>
        <Row gutter={16}>
          <Col span={6}><Form.Item name="mode" label="生成模式" tooltip="留空＝不影响价格、由用户自选；填写＝锁定为计费维度" extra={<span style={{ fontSize: 12, color: '#999' }}>留空＝用户自选</span>}><Select allowClear showSearch options={MODE_OPTIONS} placeholder="留空＝自选" /></Form.Item></Col>
          <Col span={6}><Form.Item name="duration_seconds" label="时长（秒）" tooltip="留空或 0＝不影响价格、由用户自选；填写＝锁定为计费维度" extra={<span style={{ fontSize: 12, color: '#999' }}>留空＝用户自选</span>}><InputNumber min={0} max={600} style={{ width: '100%' }} placeholder="留空＝自选" /></Form.Item></Col>
          <Col span={6}><Form.Item name="resolution" label="清晰度" tooltip="留空＝不影响价格、由用户自选；填写＝锁定为计费维度" extra={<span style={{ fontSize: 12, color: '#999' }}>留空＝用户自选</span>}><Select allowClear showSearch options={RESOLUTION_OPTIONS} placeholder="留空＝自选" /></Form.Item></Col>
          <Col span={6}><Form.Item name="aspect_ratio" label="画面比例" tooltip="留空＝不影响价格、由用户自选；填写＝锁定为计费维度" extra={<span style={{ fontSize: 12, color: '#999' }}>留空＝用户自选</span>}><Select allowClear showSearch options={ASPECT_RATIO_OPTIONS} placeholder="留空＝自选" /></Form.Item></Col>
        </Row>
        <Row gutter={16}>
          <Col span={9}><Form.Item name="default_credit_cost" label={`默认${labels.credit}`} tooltip="留空=待定价，0=免费，>0=实际扣费"><InputNumber min={0} precision={4} placeholder="留空为待定价" style={{ width: '100%' }} /></Form.Item></Col>
          <Col span={5}><Form.Item name="quality" label="quality（可选）"><Input placeholder="部分服务用" /></Form.Item></Col>
          <Col span={5}><Form.Item name="status" label="状态"><Select options={ENABLED_STATUS_OPTIONS} /></Form.Item></Col>
          <Col span={5}><Form.Item name="sort_order" label="排序"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
        </Row>
        <Form.Item name="provider_cost_text" label="上游成本说明（可选）"><Input placeholder="如 上游 1 元/秒" /></Form.Item>
        <Form.Item name="provider_cost_source" label="成本来源链接（可选）"><Input placeholder="https://..." /></Form.Item>
      </Form>
    </Modal>
    <Modal title="批量设置模型折扣" open={discountOpen} onOk={saveDiscountRule} onCancel={() => setDiscountOpen(false)} destroyOnClose mask={false} width={860}>
      <Form form={discountForm} layout="vertical">
        <Alert
          type={discountPreview.total > 20000 ? 'error' : 'info'}
          showIcon
          style={{ marginBottom: 16 }}
          message={`按所选模型下已启用且已定价的 SKU 生成专属计费规则，预计处理 ${discountPreview.model_count} 个模型、${discountPreview.sku_count} 个 SKU、${discountPreview.target_count} 个${discountTargetType === 'group' ? '用户组' : '用户'}，共 ${discountPreview.total} 条规则。`}
          description={<Space direction="vertical" size={2}>
            {discountPreview.skipped_unpriced > 0 && <Typography.Text type="warning">有 {discountPreview.skipped_unpriced} 个待定价 SKU 将被跳过。</Typography.Text>}
            {discountPreview.skipped_disabled > 0 && <Typography.Text type="warning">有 {discountPreview.skipped_disabled} 个禁用 SKU 将被跳过。</Typography.Text>}
            {discountPreview.total > 20000 && <Typography.Text type="danger">本次批量规则数量超过 20000 条，请减少模型或目标数量。</Typography.Text>}
            {discountPreview.examples.map((item: any) => <Typography.Text key={item.sku.id} type="secondary">{relationModel(item.sku)?.display_name || item.sku.model_id} / {item.sku.title}：默认价 {numberText(item.sku.default_credit_cost)}，调整后 {numberText(item.credit_cost)}</Typography.Text>)}
          </Space>}
        />
        <Form.Item name="video_model_spec_ids" label="选择模型（可多选）" rules={[{ required: true, message: '请选择至少一个视频模型' }]}>
          <Select mode="multiple" showSearch optionFilterProp="label" placeholder="选择视频模型" maxTagCount="responsive" allowClear options={discountModelOptions} />
        </Form.Item>
        <Form.Item name="target_type" label="适用对象类型" rules={[{ required: true }]}>
          <Select onChange={() => discountForm.setFieldValue('target_ids', [])} options={[{ value: 'user', label: '指定用户' }, { value: 'group', label: '指定用户组' }]} />
        </Form.Item>
        <Form.Item name="target_ids" label={discountTargetType === 'group' ? '选择用户组（可多选）' : '选择用户（可多选）'} rules={[{ required: true, message: '请选择至少一个用户或分组' }]}>
          <Select mode="multiple" showSearch optionFilterProp="label" placeholder={discountTargetType === 'group' ? '选择用户组' : '选择用户'} maxTagCount="responsive" allowClear options={discountTargetType === 'group' ? groupOptions : userOptions} />
        </Form.Item>
        <Row gutter={16}>
          <Col span={8}><Form.Item name="discount_percent" label="价格百分比" tooltip="100=原价，80=8折，120=溢价1.2倍，0=免费；上限 300%" rules={[{ required: true, message: '请输入价格百分比' }]}><InputNumber min={0} max={300} precision={4} addonAfter="%" style={{ width: '100%' }} /></Form.Item></Col>
          <Col span={8}><Form.Item name="conflict_strategy" label="已有规则处理"><Select options={[{ value: 'overwrite', label: '覆盖已有规则' }, { value: 'skip', label: '跳过已有规则' }]} /></Form.Item></Col>
          <Col span={8}><Form.Item name="status" label="状态"><Select options={ENABLED_STATUS_OPTIONS} /></Form.Item></Col>
        </Row>
        <Form.Item name="remark" label="备注"><Input.TextArea rows={2} /></Form.Item>
      </Form>
    </Modal>
    <Modal title={ruleEditing ? '编辑计费规则' : '新增计费规则'} open={ruleOpen} onOk={saveRule} onCancel={() => setRuleOpen(false)} destroyOnClose mask={false} width={720}>
      <Form form={ruleForm} layout="vertical">
        <Form.Item name="video_sku_price_id" label="SKU" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" disabled={!!ruleEditing} options={skuOptions} /></Form.Item>
        <Form.Item shouldUpdate noStyle>{({ getFieldValue }) => {
          const sku = ruleSkus.find((item) => Number(item.id) === Number(getFieldValue('video_sku_price_id')));
          if (!sku) return null;
          return <Descriptions bordered size="small" column={2} style={{ marginBottom: 16 }} items={[
            { key: 'model', label: '模型', children: relationModel(sku)?.display_name || sku.model_id || '-' },
            { key: 'spec', label: '规格', children: skuSpecText(sku) },
            { key: 'default', label: `默认${labels.credit}`, children: priceText(sku.default_credit_cost) },
            { key: 'status', label: 'SKU 状态', children: statusTag(sku.status) },
          ]} />;
        }}</Form.Item>
        <Form.Item name="target_type" label="适用对象类型" rules={[{ required: true }]}><Select disabled={!!ruleEditing} onChange={() => { ruleForm.setFieldValue('target_id', undefined); ruleForm.setFieldValue('target_ids', []); }} options={[{ value: 'user', label: '指定用户' }, { value: 'group', label: '指定用户组' }]} /></Form.Item>
        <Form.Item shouldUpdate noStyle>{({ getFieldValue }) => {
          const targetType = getFieldValue('target_type');
          const targetOptions = targetType === 'group' ? groupOptions : userOptions;
          if (ruleEditing) {
            return <Form.Item name="target_id" label={targetType === 'group' ? '选择用户组' : '选择用户'} rules={[{ required: true }]}>
              <Select showSearch optionFilterProp="label" disabled placeholder={targetType === 'group' ? '选择用户组' : '选择用户'} options={targetOptions} />
            </Form.Item>;
          }
          return <Form.Item name="target_ids" label={targetType === 'group' ? '选择用户组（可多选）' : '选择用户（可多选）'} rules={[{ required: true, message: '请选择至少一个用户或分组' }]}>
            <Select mode="multiple" showSearch optionFilterProp="label" placeholder={targetType === 'group' ? '选择用户组' : '选择用户'} maxTagCount="responsive" allowClear options={targetOptions} />
          </Form.Item>;
        }}</Form.Item>
        <Form.Item name="credit_cost" label={`专属${labels.credit}`} rules={[{ required: true }]}><InputNumber min={0} precision={4} style={{ width: '100%' }} /></Form.Item>
        <Form.Item shouldUpdate noStyle>{({ getFieldValue }) => {
          const sku = ruleSkus.find((item) => Number(item.id) === Number(getFieldValue('video_sku_price_id')));
          const creditCost = Number(getFieldValue('credit_cost'));
          if (!sku || Number.isNaN(creditCost)) return null;
          if (isUnpriced(sku)) return <Typography.Text type="warning" style={{ display: 'block', marginBottom: 16 }}>请先在 SKU 与价格中配置默认{labels.credit}</Typography.Text>;
          const diff = diffNumber(creditCost, sku.default_credit_cost);
          return <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>默认价 {numberText(sku.default_credit_cost)}，专属价 {numberText(creditCost)}，较默认价 {signedNumberText(diff)}</Typography.Text>;
        }}</Form.Item>
        <Form.Item name="status" label="状态"><Select options={ENABLED_STATUS_OPTIONS} /></Form.Item>
        <Form.Item name="remark" label="备注"><Input.TextArea rows={2} /></Form.Item>
      </Form>
    </Modal>
    <Modal title="视频任务详情" open={!!detailTask} onCancel={() => setDetailTask(null)} footer={<Button onClick={() => setDetailTask(null)}>关闭</Button>} width={900} mask={false}>
      {detailTask && <Row gutter={16}><Col span={12}>{detailTask.result?.video_url ? <video src={detailTask.result.video_url} controls style={{ width: '100%', borderRadius: 6, background: '#000' }} /> : <Card><Typography.Text type="secondary">暂无视频结果</Typography.Text></Card>}</Col><Col span={12}><Descriptions size="small" column={1} bordered items={[{ key: 'id', label: '任务 ID', children: detailTask.id }, { key: 'status', label: '状态', children: statusTag(detailTask.status) }, { key: 'model', label: '模型', children: detailTask.model_name }, { key: 'sku', label: 'SKU', children: detailTask.sku_title }, { key: 'cost', label: labels.credit, children: detailTask.credits_used }, { key: 'error', label: '失败原因', children: detailTask.error_summary ? <Space direction="vertical" size={2}><Typography.Text type="danger" strong>{detailTask.error_summary.title}</Typography.Text><Typography.Text>{detailTask.error_summary.hint}</Typography.Text></Space> : (detailTask.error_message || '-') }]} /><Typography.Paragraph style={{ marginTop: 12 }}><Typography.Text strong>提示词</Typography.Text><br />{detailTask.prompt}</Typography.Paragraph><details><summary>实际发出的字段</summary><pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{JSON.stringify(detailTask.submit_payload || {}, null, 2)}</pre></details><details><summary>原始错误与响应</summary><pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{detailTask.error_summary?.detail || detailTask.error_message || '-'}{`\n`}{JSON.stringify(detailTask.provider_response || {}, null, 2)}</pre></details></Col></Row>}
    </Modal>
    <Modal title={`从服务商拉取模型${fetchModelsAccount ? ` · ${fetchModelsAccount.name}` : ''}`} open={fetchModelsOpen} onOk={importFetchedModels} okText="导入所选" confirmLoading={fetchModelsLoading} onCancel={() => setFetchModelsOpen(false)} destroyOnClose mask={false} width={800}>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="拉取列表仅含上游模型 ID。导入时会按账号驱动填入默认契约，并同时创建一条已启用、已定价的 5 秒 / 720p SKU。" />
      <Space style={{ marginBottom: 12 }}><Typography.Text strong>{`默认${labels.credit}`}</Typography.Text><InputNumber min={0.0001} precision={4} value={importCreditCost} onChange={(value) => setImportCreditCost(value === null ? null : Number(value))} placeholder="必填，不能为 0" /><Typography.Text type="secondary">所选模型共用，导入后可逐条调整</Typography.Text></Space>
      <Table
        rowKey="key"
        loading={fetchModelsLoading}
        size="small"
        dataSource={fetchModelsList}
        pagination={false}
        scroll={{ y: 360 }}
        rowSelection={{ selectedRowKeys: fetchModelsSelected, onChange: setFetchModelsSelected, getCheckboxProps: (r: any) => ({ disabled: r.exists }) }}
        columns={[
          { title: '模型 ID', dataIndex: 'id' },
          { title: '名称', dataIndex: 'name' },
          { title: '官方参考', width: 240, render: (_: any, row: any) => <OfficialRefText modelId={row.id} modality="video" compact /> },
          { title: '状态', dataIndex: 'exists', width: 100, render: (v: boolean) => v ? <Tag color="green">已导入</Tag> : <Tag color="blue">可导入</Tag> },
        ] as any}
      />
    </Modal>
    <Modal title="批量生成 SKU" open={batchSkuOpen} onOk={runBatchSku} okText="生成" confirmLoading={batchSkuLoading} onCancel={() => setBatchSkuOpen(false)} destroyOnClose mask={false} width={680}>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message={<>只对<Typography.Text strong>勾选的「计费维度」</Typography.Text>做组合生成 SKU；未勾选的维度<Typography.Text strong>留空</Typography.Text>，由用户生成时在模型能力内自选、不影响价格。已存在的组合自动跳过；生成的 SKU 默认待定价，请生成后到列表统一定价。</>} />
      <Form layout="vertical">
        <Form.Item label="选择模型" required>
          <Select showSearch optionFilterProp="label" value={batchSkuModelId} placeholder="选择模型" onChange={(v) => { setBatchSkuModelId(v); const m = models.find((x) => Number(x.id) === Number(v)); setBatchLockedDims(m ? recommendedLockedDims(m.provider_protocol) : []); }} options={models.map((m) => ({ value: m.id, label: `${m.display_name}（${m.provider_key} / ${m.model_id}）` }))} />
        </Form.Item>
        {batchSkuModel && <Form.Item label="参与计费的维度（只对这些维度做组合，其余留空＝用户自选）">
          <Checkbox.Group value={batchLockedDims} onChange={(v) => setBatchLockedDims(v as string[])}>
            {DIMENSION_FIELDS.map((d) => {
              const supported = d.key === 'mode' ? toArray(batchSkuModel.supported_modes)
                : d.key === 'duration' ? toArray(batchSkuModel.supported_durations)
                : d.key === 'resolution' ? toArray(batchSkuModel.supported_resolutions)
                : toArray(batchSkuModel.supported_aspect_ratios);
              return <Checkbox key={d.key} value={d.key} disabled={!supported.length}>{d.label}{supported.length ? `（${supported.join(' / ')}）` : '（模型未配置，不可锁定）'}</Checkbox>;
            })}
          </Checkbox.Group>
        </Form.Item>}
      </Form>
      {batchSkuModel && <Alert
        type={batchLockedDims.length ? 'success' : 'warning'}
        showIcon
        message={batchLockedDims.length ? `将生成 ${batchSkuCombos.length} 个 SKU（锁定维度：${dimLabels(batchLockedDims).join(' × ')}）` : '未选择任何计费维度：将只生成 1 个「全维度留空」的 SKU（适用于单一价格的模型）'}
        description={<Typography.Text type="secondary">留空（用户自选、不影响价格）：{DIMENSION_FIELDS.filter((d) => !batchLockedDims.includes(d.key)).map((d) => d.label).join('、') || '无'}</Typography.Text>}
      />}
    </Modal>
  </Space>;
}
