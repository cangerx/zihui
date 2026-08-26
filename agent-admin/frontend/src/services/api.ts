import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.hash = '#/login';
    }
    return Promise.reject(err);
  }
);

// Auth
export const authApi = {
  login: (data: { username: string; password: string }) => api.post('/auth/login', data),
  me: () => api.get('/auth/me'),
  changePassword: (data: { old_password: string; new_password: string }) => api.post('/auth/password', data),
  refresh: () => api.post('/auth/refresh'),
};

// Users
export const userApi = {
  list: (params?: Record<string, any>) => api.get('/admin/users', { params }),
  get: (id: number) => api.get(`/admin/users/${id}`),
  capabilities: (id: number) => api.get(`/admin/users/${id}/capabilities`),
  updateCapability: (id: number, key: string, value: boolean) => api.put(`/admin/users/${id}/capabilities/${key}`, { value }),
  create: (data: Record<string, any>) => api.post('/admin/users', data),
  update: (id: number, data: Record<string, any>) => api.put(`/admin/users/${id}`, data),
  delete: (id: number) => api.delete(`/admin/users/${id}`),
  batchDelete: (ids: number[]) => api.post('/admin/users/batch-delete', { ids }),
  // 批量设置「灵感大王」权限：拥有此权限的用户在桌面端可将创作上传到灵感广场
  batchSetInspirationUploader: (ids: number[], inspiration_uploader: boolean) =>
    api.post('/admin/users/batch-set-inspiration', { ids, inspiration_uploader }),
  resetPassword: (id: number, data: { password: string }) => api.post(`/admin/users/${id}/reset-password`, data),
  toggleStatus: (id: number) => api.post(`/admin/users/${id}/toggle-status`),
  oemProjects: (id: number) => api.get(`/admin/users/${id}/oem-projects`),
  syncOemProjects: (id: number, projects: Array<Record<string, any>>) =>
    api.put(`/admin/users/${id}/oem-projects`, { projects }),
};

// Groups
export const groupApi = {
  list: (params?: Record<string, any>) => api.get('/admin/user-groups', { params }),
  get: (id: number) => api.get(`/admin/user-groups/${id}`),
  create: (data: Record<string, any>) => api.post('/admin/user-groups', data),
  update: (id: number, data: Record<string, any>) => api.put(`/admin/user-groups/${id}`, data),
  delete: (id: number) => api.delete(`/admin/user-groups/${id}`),
  batchDelete: (ids: number[]) => api.post('/admin/user-groups/batch-delete', { ids }),
  addMembers: (id: number, userIds: number[]) => api.post(`/admin/user-groups/${id}/members`, { user_ids: userIds }),
  removeMembers: (id: number, userIds: number[]) => api.delete(`/admin/user-groups/${id}/members`, { data: { user_ids: userIds } }),
};

// Cloud Providers
export const providerApi = {
  list: (params?: Record<string, any>) => api.get('/admin/cloud-providers', { params }),
  get: (id: number) => api.get(`/admin/cloud-providers/${id}`),
  create: (data: Record<string, any>) => api.post('/admin/cloud-providers', data),
  update: (id: number, data: Record<string, any>) => api.put(`/admin/cloud-providers/${id}`, data),
  delete: (id: number) => api.delete(`/admin/cloud-providers/${id}`),
  batchDelete: (ids: number[]) => api.post('/admin/cloud-providers/batch-delete', { ids }),
  test: (id: number) => api.post(`/admin/cloud-providers/${id}/test`),
  // 深度测试：实际发一条 max_tokens=1 的 chat 调用，验证 /chat/completions 真正可用。
  // model_id 可选，不传则后端自动取 GET /models 的第一个 id。
  deepTest: (id: number, modelId?: string) =>
    api.post(`/admin/cloud-providers/${id}/deep-test`, modelId ? { model_id: modelId } : {}),
  fetchModels: (id: number) => api.post(`/admin/cloud-providers/${id}/fetch-models`),
  // 解除自动熔断；reactivate_credentials=true 同时把所有 invalid 凭证重置为 active
  recover: (id: number, reactivateCredentials = false) =>
    api.post(`/admin/cloud-providers/${id}/recover`, { reactivate_credentials: reactivateCredentials }),
  // 健康看板聚合：返回 24h 内 summary + 每家 provider 的 ok/fail/p99/小时桶序列
  health: () => api.get('/admin/cloud-providers/health'),
};

/**
 * 凭证池：一个 provider 下挂多把 API Key。GatewayRouter 按权重轮询调度，
 * 失败累计达阈值自动失活；池子为空时回落 cloud_providers.api_key 字段。
 */
export const credentialApi = {
  list: (providerId: number) => api.get(`/admin/cloud-providers/${providerId}/credentials`),
  create: (providerId: number, data: { name?: string; api_key: string; weight?: number; remark?: string }) =>
    api.post(`/admin/cloud-providers/${providerId}/credentials`, data),
  update: (id: number, data: Record<string, any>) => api.put(`/admin/credentials/${id}`, data),
  delete: (id: number) => api.delete(`/admin/credentials/${id}`),
  reactivate: (id: number) => api.post(`/admin/credentials/${id}/reactivate`),
};

// Cloud Models
export const modelApi = {
  list: (params?: Record<string, any>) => api.get('/admin/cloud-models', { params }),
  get: (id: number) => api.get(`/admin/cloud-models/${id}`),
  create: (data: Record<string, any>) => api.post('/admin/cloud-models', data),
  batchCreate: (data: Record<string, any>) => api.post('/admin/cloud-models/batch', data),
  update: (id: number, data: Record<string, any>) => api.put(`/admin/cloud-models/${id}`, data),
  delete: (id: number) => api.delete(`/admin/cloud-models/${id}`),
  batchDelete: (ids: number[]) => api.post('/admin/cloud-models/batch-delete', { ids }),
};

// Model Assignments
export const assignmentApi = {
  list: (params?: Record<string, any>) => api.get('/admin/model-assignments', { params }),
  create: (data: Record<string, any>) => api.post('/admin/model-assignments', data),
  batchCreate: (data: Record<string, any>) => api.post('/admin/model-assignments/batch', data),
  batchMatrix: (data: Record<string, any>) => api.post('/admin/model-assignments/batch-matrix', data),
  delete: (id: number) => api.delete(`/admin/model-assignments/${id}`),
  batchDelete: (ids: number[]) => api.post('/admin/model-assignments/batch-delete', { ids }),
};

// Permissions
export const permissionApi = {
  list: (params?: Record<string, any>) => api.get('/admin/permissions', { params }),
  create: (data: Record<string, any>) => api.post('/admin/permissions', data),
  batchCreate: (data: Record<string, any>) => api.post('/admin/permissions/batch', data),
  update: (id: number, data: Record<string, any>) => api.put(`/admin/permissions/${id}`, data),
  delete: (id: number) => api.delete(`/admin/permissions/${id}`),
  batchDelete: (ids: number[]) => api.post('/admin/permissions/batch-delete', { ids }),
};

// Billing Rules
export const billingApi = {
  list: (params?: Record<string, any>) => api.get('/admin/billing-rules', { params }),
  create: (data: Record<string, any>) => api.post('/admin/billing-rules', data),
  batchCreate: (data: Record<string, any>) => api.post('/admin/billing-rules/batch', data),
  update: (id: number, data: Record<string, any>) => api.put(`/admin/billing-rules/${id}`, data),
  delete: (id: number) => api.delete(`/admin/billing-rules/${id}`),
  batchDelete: (ids: number[]) => api.post('/admin/billing-rules/batch-delete', { ids }),
};

// Balance
export const balanceApi = {
  list: (params?: Record<string, any>) => api.get('/admin/balances', { params }),
  recharge: (data: Record<string, any>) => api.post('/admin/balances/recharge', data),
  batchRecharge: (data: Record<string, any>) => api.post('/admin/balances/batch-recharge', data),
};

// Usage Records
export const usageApi = {
  list: (params?: Record<string, any>) => api.get('/admin/usage-records', { params }),
  stats: (params?: Record<string, any>) => api.get('/admin/usage-records/stats', { params }),
};

export const rechargeApi = {
  config: () => api.get('/admin/recharge/config'),
  updateConfig: (data: Record<string, any>) => api.put('/admin/recharge/config', data),
  packages: () => api.get('/admin/recharge/packages'),
  createPackage: (data: Record<string, any>) => api.post('/admin/recharge/packages', data),
  updatePackage: (id: number, data: Record<string, any>) => api.put(`/admin/recharge/packages/${id}`, data),
  deletePackage: (id: number) => api.delete(`/admin/recharge/packages/${id}`),
};

export const desktopMenuApi = {
  config: () => api.get('/admin/desktop-menu'),
  updateConfig: (items: Array<Record<string, any>>) => api.put('/admin/desktop-menu', { items }),
  customItems: () => api.get('/admin/desktop-menu/custom-items'),
  updateCustomItems: (items: Array<Record<string, any>>) => api.put('/admin/desktop-menu/custom-items', { items }),
};

export type OfficialRefLookup = {
  found: boolean;
  id?: string | null;
  modality?: string | null;
  unit?: string | null;
  amount_cny?: number | null;
  text?: string;
  source_url?: string;
  captured_at?: string;
};

export const officialModelRefApi = {
  lookup: (modelId: string, modality?: string) =>
    api.get<OfficialRefLookup>('/admin/official-model-refs', { params: { model_id: modelId, modality } }),
};

export const videoApi = {
  stats: () => api.get('/admin/videos/stats'),
  accounts: (params?: Record<string, any>) => api.get('/admin/videos/accounts', { params }),
  createAccount: (data: Record<string, any>) => api.post('/admin/videos/accounts', data),
  updateAccount: (id: number, data: Record<string, any>) => api.put(`/admin/videos/accounts/${id}`, data),
  deleteAccount: (id: number) => api.delete(`/admin/videos/accounts/${id}`),
  testAccount: (id: number) => api.post(`/admin/videos/accounts/${id}/test`),
  models: (params?: Record<string, any>) => api.get('/admin/videos/models', { params }),
  catalogDiagnostics: (params?: Record<string, any>) => api.get('/admin/videos/catalog-diagnostics', { params }),
  createModel: (data: Record<string, any>) => api.post('/admin/videos/models', data),
  updateModel: (id: number, data: Record<string, any>) => api.put(`/admin/videos/models/${id}`, data),
  deleteModel: (id: number) => api.delete(`/admin/videos/models/${id}`),
  fetchProviderModels: (id: number) => api.post(`/admin/videos/accounts/${id}/fetch-models`),
  importProviderModels: (id: number, data: { models: Array<{ id: string; name?: string }>; default_credit_cost: number }) => api.post(`/admin/videos/accounts/${id}/import-models`, data),
  skus: (params?: Record<string, any>) => api.get('/admin/videos/skus', { params }),
  createSku: (data: Record<string, any>) => api.post('/admin/videos/skus', data),
  updateSku: (id: number, data: Record<string, any>) => api.put(`/admin/videos/skus/${id}`, data),
  deleteSku: (id: number) => api.delete(`/admin/videos/skus/${id}`),
  batchUpdateSkus: (data: Record<string, any>) => api.post('/admin/videos/skus/batch-update', data),
  pricingRules: (params?: Record<string, any>) => api.get('/admin/videos/pricing-rules', { params }),
  createPricingRule: (data: Record<string, any>) => api.post('/admin/videos/pricing-rules', data),
  batchCreatePricingRules: (data: Record<string, any>) => api.post('/admin/videos/pricing-rules/batch', data),
  batchCreatePricingRuleDiscounts: (data: Record<string, any>) => api.post('/admin/videos/pricing-rules/batch-discount', data),
  updatePricingRule: (id: number, data: Record<string, any>) => api.put(`/admin/videos/pricing-rules/${id}`, data),
  deletePricingRule: (id: number) => api.delete(`/admin/videos/pricing-rules/${id}`),
  tasks: (params?: Record<string, any>) => api.get('/admin/videos/tasks', { params }),
  getTask: (id: string) => api.get(`/admin/videos/tasks/${id}`),
  refreshTask: (id: string) => api.post(`/admin/videos/tasks/${id}/refresh`),
  cancelTask: (id: string) => api.post(`/admin/videos/tasks/${id}/cancel`),
  deleteTask: (id: string) => api.delete(`/admin/videos/tasks/${id}`),
  batchDeleteTasks: (ids: string[]) => api.post('/admin/videos/tasks/batch-delete', { ids }),
  usage: (params?: Record<string, any>) => api.get('/admin/videos/usage', { params }),
  // 临时参考素材（桌面端上传的视频参考图/视频/音频，24h 过期）
  referenceAssets: (params?: Record<string, any>) => api.get('/admin/videos/reference-assets', { params }),
  referenceAssetStats: () => api.get('/admin/videos/reference-assets/stats'),
  cleanupExpiredReferenceAssets: (data?: Record<string, any>) =>
    api.post('/admin/videos/reference-assets/cleanup-expired', data || {}),
  deleteReferenceAsset: (id: number) => api.delete(`/admin/videos/reference-assets/${id}`),
  batchDeleteReferenceAssets: (ids: number[]) =>
    api.post('/admin/videos/reference-assets/batch-delete', { ids }),
};

// System
export const systemApi = {
  clearCache: () => api.post('/admin/system/clear-cache'),
};

// Settings
export const settingApi = {
  get: () => api.get('/admin/settings'),
  update: (settings: Record<string, unknown>) => api.put('/admin/settings', { settings }),
  wxpayTest: () => api.post('/admin/settings/wxpay-test'),
  cosTest: () => api.post('/admin/settings/cos-test'),
  ossTest: () => api.post('/admin/settings/oss-test'),
  smsTest: (mobile: string) => api.post('/admin/settings/sms-test', { mobile }),
};

// 云同步存储用量管理
export const syncStorageApi = {
  stats: () => api.get('/admin/sync-storage/stats'),
  users: (params?: Record<string, any>) => api.get('/admin/sync-storage/users', { params }),
  reconcile: () => api.post('/admin/sync-storage/reconcile'),
  recompute: (userId: number) => api.post(`/admin/sync-storage/users/${userId}/recompute`),
};

// Public APIs (无需 JWT 鉴权)
export const publicApi = {
  siteConfig: () => api.get('/public/site-config'),
};

// Payment Orders
export const orderApi = {
  list: (params?: Record<string, any>) => api.get('/admin/orders', { params }),
  get: (id: number) => api.get(`/admin/orders/${id}`),
  sync: (id: number) => api.post(`/admin/orders/${id}/sync`),
  delete: (id: number) => api.delete(`/admin/orders/${id}`),
};

export const commissionOrderApi = {
  list: (params?: Record<string, any>) => api.get('/admin/commission-orders', { params }),
  get: (id: number) => api.get(`/admin/commission-orders/${id}`),
  options: () => api.get('/admin/commission-orders/options'),
};

// Redeem Codes
export const redeemApi = {
  list: (params?: Record<string, any>) => api.get('/admin/redeem-codes', { params }),
  create: (data: Record<string, any>) => api.post('/admin/redeem-codes', data),
  batchGenerate: (data: Record<string, any>) => api.post('/admin/redeem-codes/batch', data),
  update: (id: number, data: Record<string, any>) => api.put(`/admin/redeem-codes/${id}`, data),
  delete: (id: number) => api.delete(`/admin/redeem-codes/${id}`),
  batchDelete: (ids: number[]) => api.post('/admin/redeem-codes/batch-delete', { ids }),
  records: (params?: Record<string, any>) => api.get('/admin/redeem-records', { params }),
};

// Plans
export const planApi = {
  listCategories: () => api.get('/admin/plan-categories'),
  createCategory: (data: { name: string; sort_order?: number }) => api.post('/admin/plan-categories', data),
  updateCategory: (id: number, data: { name: string; sort_order?: number }) => api.put(`/admin/plan-categories/${id}`, data),
  deleteCategory: (id: number) => api.delete(`/admin/plan-categories/${id}`),
  list: (params?: Record<string, any>) => api.get('/admin/plans', { params }),
  get: (id: number) => api.get(`/admin/plans/${id}`),
  create: (data: Record<string, any>) => api.post('/admin/plans', data),
  update: (id: number, data: Record<string, any>) => api.put(`/admin/plans/${id}`, data),
  delete: (id: number) => api.delete(`/admin/plans/${id}`),
  batchDelete: (ids: number[]) => api.post('/admin/plans/batch-delete', { ids }),
  grant: (userId: number, data: Record<string, any>) =>
    api.post(`/admin/users/${userId}/plans`, data),
  batchGrant: (data: Record<string, any>) =>
    api.post('/admin/plans/batch-grant', data),
  revoke: (userPlanId: number) =>
    api.post(`/admin/user-plans/${userPlanId}/revoke`),
  batchRevoke: (userPlanIds: number[]) =>
    api.post('/admin/user-plans/batch-revoke', { user_plan_ids: userPlanIds }),
  userPlans: (params?: Record<string, any>) =>
    api.get('/admin/user-plans', { params }),
  userPlanQuotas: (params?: Record<string, any>) =>
    api.get('/admin/user-plan-quotas', { params }),
};

// Online Updates
export const updateApi = {
  current: () => api.get('/admin/updates/current'),
  check: () => api.get('/admin/updates/check'),
  apply: () => api.post('/admin/updates/apply'),
  progress: (logId?: number) =>
    api.get('/admin/updates/progress', { params: logId ? { log_id: logId } : {} }),
  history: (params?: Record<string, any>) => api.get('/admin/updates/history', { params }),
  dbCheck: () => api.get('/admin/updates/db-check'),
  dbRepair: () => api.post('/admin/updates/db-repair'),
  releases: () => api.get('/admin/updates/releases'),
};

export default api;


// Homepage (官网设置：文本/下载链接/截图 + 模板切换 + 行业话术包)

// updateSettings 接受字符串文本字段、布尔开关（homepage_enabled / use_docs_as_index）、
// 以及模板代号 homepage_template 和当前激活话术包 slug
export type HomepageSettingsUpdate = Record<string, string | boolean>;

export interface PhrasePack {
  id: number;
  template: string;
  slug: string;
  name: string;
  description: string | null;
  payload: Record<string, string>;
  is_builtin: boolean;
  sort_order: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface PhrasePackInput {
  template?: string;
  slug?: string;
  name?: string;
  description?: string | null;
  payload?: Record<string, string>;
  sort_order?: number;
}

export const homepageApi = {
  getSettings: () => api.get('/admin/homepage/settings'),
  updateSettings: (data: HomepageSettingsUpdate) =>
    api.put('/admin/homepage/settings', data),
  uploadImage: (position: string, file: File) => {
    const fd = new FormData();
    fd.append('position', position);
    fd.append('image', file);
    return api.post('/admin/homepage/images', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60000,
    });
  },
  deleteImage: (position: string) =>
    api.delete(`/admin/homepage/images/${position}`),
};

// 行业话术包（按模板维度维护的批量文案预设）
// list 返回 { items: PhrasePack[], active: { default: slug, minimal: slug } }
// apply 把 payload 写入 SystemSetting，前台官网立即换文案
export const homepagePhrasePackApi = {
  list: (template?: string) =>
    api.get('/admin/homepage/phrase-packs', { params: template ? { template } : {} }),
  show: (id: number) => api.get(`/admin/homepage/phrase-packs/${id}`),
  create: (data: PhrasePackInput) => api.post('/admin/homepage/phrase-packs', data),
  update: (id: number, data: PhrasePackInput) =>
    api.put(`/admin/homepage/phrase-packs/${id}`, data),
  remove: (id: number) => api.delete(`/admin/homepage/phrase-packs/${id}`),
  apply: (id: number) => api.post(`/admin/homepage/phrase-packs/${id}/apply`),
};

// Creative Templates（工作流模板：分类 + 模板 + AI 辅助）
// AI 接口三种来源：手动提示词分析 / 图片反推 / 灵感转草稿；返回统一的草稿结构供创建表单回填
export interface CreativeTemplateVariable {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'multi_select';
  required: boolean;
  placeholder?: string;
  default?: string;
  options?: string[];
}

export const creativeTemplateApi = {
  listCategories: () => api.get('/admin/creative-templates/categories'),
  createCategory: (data: { name: string; description?: string; sort_order?: number; is_visible?: boolean }) =>
    api.post('/admin/creative-templates/categories', data),
  updateCategory: (id: number, data: { name: string; description?: string; sort_order?: number; is_visible?: boolean }) =>
    api.put(`/admin/creative-templates/categories/${id}`, data),
  deleteCategory: (id: number) => api.delete(`/admin/creative-templates/categories/${id}`),

  list: (params?: Record<string, any>) => api.get('/admin/creative-templates', { params }),
  get: (id: number) => api.get(`/admin/creative-templates/${id}`),
  delete: (id: number) => api.delete(`/admin/creative-templates/${id}`),
  batchDelete: (ids: number[]) => api.post('/admin/creative-templates/batch-delete', { ids }),
  approve: (id: number) => api.post(`/admin/creative-templates/${id}/approve`),
  reject: (id: number, reason?: string) => api.post(`/admin/creative-templates/${id}/reject`, { reason }),
  setVisibility: (id: number, is_visible: boolean) =>
    api.put(`/admin/creative-templates/${id}/visibility`, { is_visible }),
  setSortOrder: (id: number, sort_order: number) =>
    api.put(`/admin/creative-templates/${id}/sort-order`, { sort_order }),
};

// Style Presets（风格预设：生图风格提示词片段管理，桌面端各生图入口拉取）
export const stylePresetApi = {
  list: (params?: Record<string, any>) => api.get('/admin/style-presets', { params }),
  categories: () => api.get('/admin/style-presets/categories'),
  // create/update 走 multipart（示例图文件）；update 用 POST + _method=PUT spoofing（同灵感广场）
  create: (data: FormData) => api.post('/admin/style-presets', data, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000,
  }),
  update: (id: number, data: FormData) => api.post(`/admin/style-presets/${id}`, data, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000,
  }),
  delete: (id: number) => api.delete(`/admin/style-presets/${id}`),
  toggle: (id: number) => api.put(`/admin/style-presets/${id}/toggle`),
  setSortOrder: (id: number, sort_order: number) =>
    api.put(`/admin/style-presets/${id}/sort-order`, { sort_order }),
};

// Inspirations (灵感广场数据管理)
export const inspirationApi = {
  getConfig: () => api.get('/admin/inspirations/config'),
  updateConfig: (data: { source?: string; skip_audit?: boolean }) =>
    api.put('/admin/inspirations/config', data),
  listCategories: () => api.get('/admin/inspirations/categories'),
  createCategory: (data: { name: string; sort_order?: number }) => api.post('/admin/inspirations/categories', data),
  updateCategory: (id: number, data: { name: string; sort_order?: number }) => api.put(`/admin/inspirations/categories/${id}`, data),
  deleteCategory: (id: number) => api.delete(`/admin/inspirations/categories/${id}`),
  list: (params?: Record<string, any>) => api.get('/admin/inspirations', { params }),
  create: (data: FormData) => api.post('/admin/inspirations', data, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000,
  }),
  update: (id: number, data: FormData) => api.post(`/admin/inspirations/${id}`, data, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000,
  }),
  delete: (id: number) => api.delete(`/admin/inspirations/${id}`),
  batchDelete: (ids: number[]) => api.post('/admin/inspirations/batch-delete', { ids }),
  // 1.2.16+ 审核 + 显示开关
  approve: (id: number) => api.post(`/admin/inspirations/${id}/approve`),
  reject: (id: number) => api.post(`/admin/inspirations/${id}/reject`),
  setVisibility: (id: number, is_visible: boolean) =>
    api.put(`/admin/inspirations/${id}/visibility`, { is_visible }),
};

// 数字员工市场（云端创建/审核 + 桌面端拉取保存到本地）
// create/update 走 multipart（含 2:3 形象图）；update 用 POST + _method=PUT spoofing
export const agentApi = {
  // 分类（name/description/sort_order/is_visible，与工作流模板分类同构）
  listCategories: () => api.get('/admin/agents/categories'),
  createCategory: (data: { name: string; description?: string; sort_order?: number; is_visible?: boolean }) =>
    api.post('/admin/agents/categories', data),
  updateCategory: (id: number, data: { name: string; description?: string; sort_order?: number; is_visible?: boolean }) =>
    api.put(`/admin/agents/categories/${id}`, data),
  deleteCategory: (id: number) => api.delete(`/admin/agents/categories/${id}`),

  list: (params?: Record<string, any>) => api.get('/admin/agents', { params }),
  get: (id: number) => api.get(`/admin/agents/${id}`),
  create: (data: FormData) => api.post('/admin/agents', data, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000,
  }),
  update: (id: number, data: FormData) => api.post(`/admin/agents/${id}`, data, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000,
  }),
  delete: (id: number) => api.delete(`/admin/agents/${id}`),
  batchDelete: (ids: number[]) => api.post('/admin/agents/batch-delete', { ids }),
  setVisibility: (id: number, is_visible: boolean) =>
    api.put(`/admin/agents/${id}/visibility`, { is_visible }),
  batchSetVisibility: (ids: number[], is_visible: boolean) =>
    api.post('/admin/agents/batch-visibility', { ids, is_visible }),
  setSortOrder: (id: number, sort_order: number) =>
    api.put(`/admin/agents/${id}/sort-order`, { sort_order }),
  approve: (id: number) => api.post(`/admin/agents/${id}/approve`),
  reject: (id: number, reason?: string) => api.post(`/admin/agents/${id}/reject`, { reason }),
};

// Inspiration Hub (共享灵感库 - 跨 OEM 共享池，代理到 agent-build hub)
//   - admin 系列：阈值设置 / 健康检查 / 待审池 / 投票 / 拉取到本地
//   - client 系列：浏览 / 分享 / 撤回 / 状态同步 / 举报（管理员后台亦可调，桌面端是主要使用方）
export const inspirationHubApi = {
  // ===== Admin =====
  // settings 已并入云打包配置，前端只读展示；不再有 update 接口
  adminGetSettings: () => api.get('/admin/inspiration-hub/settings'),
  adminHealthCheck: () => api.post('/admin/inspiration-hub/health-check'),
  adminPendingList: (params?: Record<string, any>) =>
    api.get('/admin/inspiration-hub/pending-list', { params }),
  adminReview: (hubId: number, data: { action: 'approve' | 'reject'; reason?: string }) =>
    api.post(`/admin/inspiration-hub/${hubId}/review`, data),
  adminPullToLocal: (hubId: number, data: { local_category_id: number }) =>
    api.post(`/admin/inspiration-hub/${hubId}/pull-to-local`, data),

  // ===== Client =====
  me: () => api.get('/client/inspiration-hub/me'),
  categories: () => api.get('/client/inspiration-hub/categories'),
  list: (params?: Record<string, any>) => api.get('/client/inspiration-hub/list', { params }),
  show: (hubId: number) => api.get(`/client/inspiration-hub/${hubId}`),
  statusBatch: (localIds: number[]) =>
    api.post('/client/inspiration-hub/status-batch', { ids: localIds }),
  shareToHub: (localId: number, data: { hub_category_id: number }) =>
    api.post(`/client/inspirations/${localId}/share`, data),
  withdrawFromHub: (localId: number) =>
    api.delete(`/client/inspirations/${localId}/share`),
  report: (hubId: number, data: { reason_code: string; reason_note?: string }) =>
    api.post(`/client/inspiration-hub/${hubId}/report`, data),
};

export const creativeTemplateHubApi = {
  adminGetSettings: () => api.get('/admin/creative-template-hub/settings'),
  adminHealthCheck: () => api.post('/admin/creative-template-hub/health-check'),
  adminPendingList: (params?: Record<string, any>) =>
    api.get('/admin/creative-template-hub/pending-list', { params }),
  adminReview: (hubId: number, data: { action: 'approve' | 'reject'; reason?: string }) =>
    api.post(`/admin/creative-template-hub/${hubId}/review`, data),
  adminPullToLocal: (hubId: number, data: { local_category_id: number }) =>
    api.post(`/admin/creative-template-hub/${hubId}/pull-to-local`, data),

  me: () => api.get('/client/creative-template-hub/me'),
  categories: () => api.get('/client/creative-template-hub/categories'),
  list: (params?: Record<string, any>) => api.get('/client/creative-template-hub/list', { params }),
  show: (hubId: number) => api.get(`/client/creative-template-hub/${hubId}`),
  statusBatch: (localIds: number[]) =>
    api.post('/client/creative-template-hub/status-batch', { ids: localIds }),
  shareToHub: (localId: number, data: { hub_category_id: number }) =>
    api.post(`/client/creative-templates/${localId}/share`, data),
  withdrawFromHub: (localId: number) =>
    api.delete(`/client/creative-templates/${localId}/share`),
  report: (hubId: number, data: { reason_code: string; reason_note?: string }) =>
    api.post(`/client/creative-template-hub/${hubId}/report`, data),
};

// Agent Hub (数字员工共享库 - 跨 OEM 共享池，代理到 agent-build hub)
//   - admin 系列：阈值设置 / 健康检查 / 待审池 / 投票 / 拉取到本地（可选指定本地分类）
//   - client 系列：浏览 / 分享 / 撤回 / 状态同步 / 举报
export const agentHubApi = {
  adminGetSettings: () => api.get('/admin/agent-hub/settings'),
  adminHealthCheck: () => api.post('/admin/agent-hub/health-check'),
  adminPendingList: (params?: Record<string, any>) =>
    api.get('/admin/agent-hub/pending-list', { params }),
  adminReview: (hubId: number, data: { action: 'approve' | 'reject'; reason?: string }) =>
    api.post(`/admin/agent-hub/${hubId}/review`, data),
  adminPullToLocal: (hubId: number, data: { local_category_id?: number }) =>
    api.post(`/admin/agent-hub/${hubId}/pull-to-local`, data),

  me: () => api.get('/client/agent-hub/me'),
  categories: () => api.get('/client/agent-hub/categories'),
  list: (params?: Record<string, any>) => api.get('/client/agent-hub/list', { params }),
  show: (hubId: number) => api.get(`/client/agent-hub/${hubId}`),
  statusBatch: (localIds: number[]) =>
    api.post('/client/agent-hub/status-batch', { ids: localIds }),
  shareToHub: (localId: number, data: { hub_category_id: number }) =>
    api.post(`/client/agents/${localId}/share`, data),
  withdrawFromHub: (localId: number) =>
    api.delete(`/client/agents/${localId}/share`),
  report: (hubId: number, data: { reason_code: string; reason_note?: string }) =>
    api.post(`/client/agent-hub/${hubId}/report`, data),
};

export const sharedHubApi = {
  status: () => api.get('/admin/shared-hub/sync'),
  syncOnce: (force = false) => api.post('/admin/shared-hub/sync', { force }),
};

// Announcements（公告管理：标题 + 富文本，桌面端顶部公告栏）
export const announcementApi = {
  list: (params?: Record<string, any>) => api.get('/admin/announcements', { params }),
  get: (id: number) => api.get(`/admin/announcements/${id}`),
  // 公告插图上传：multipart 直传，返回 { url }，写进富文本 content
  uploadImage: (file: File) => {
    const fd = new FormData();
    fd.append('image', file);
    return api.post('/admin/announcements/upload-image', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  create: (data: { title: string; content: string; enabled?: boolean; sort_order?: number }) =>
    api.post('/admin/announcements', data),
  update: (id: number, data: { title: string; content: string; enabled?: boolean; sort_order?: number }) =>
    api.put(`/admin/announcements/${id}`, data),
  delete: (id: number) => api.delete(`/admin/announcements/${id}`),
  toggle: (id: number) => api.post(`/admin/announcements/${id}/toggle`),
};

// Documents（文档站：分类 + 文档 + RAG 索引 / 检索 / 模型测试 / 审计日志）
// 与公告页类似的 admin CRUD，外加 reindex / retrieve-preview / test-model / chat-logs RAG 接口。
// reindexAll 单独配 10 分钟超时（全量重建文档量大时可能耗时几分钟）。
export const docApi = {
  // 设置（含 RAG 配置 + 可用模型下拉 + 统计 + vec_mode）
  getConfig: () => api.get('/admin/docs/config'),
  updateConfig: (data: Record<string, any>) => api.put('/admin/docs/config', data),

  // 分类 CRUD
  listCategories: () => api.get('/admin/docs/categories'),
  createCategory: (data: { name: string; slug?: string; sort_order?: number; is_visible?: boolean }) =>
    api.post('/admin/docs/categories', data),
  updateCategory: (id: number, data: { name?: string; slug?: string; sort_order?: number; is_visible?: boolean }) =>
    api.put(`/admin/docs/categories/${id}`, data),
  deleteCategory: (id: number) => api.delete(`/admin/docs/categories/${id}`),

  // 文档 CRUD
  list: (params?: Record<string, any>) => api.get('/admin/docs', { params }),
  get: (id: number) => api.get(`/admin/docs/${id}`),
  create: (data: Record<string, any>) => api.post('/admin/docs', data),
  update: (id: number, data: Record<string, any>) => api.put(`/admin/docs/${id}`, data),
  delete: (id: number) => api.delete(`/admin/docs/${id}`),
  batchDelete: (ids: number[]) => api.post('/admin/docs/batch-delete', { ids }),
  setVisibility: (id: number, is_visible: boolean) =>
    api.put(`/admin/docs/${id}/visibility`, { is_visible }),
  batchSetVisibility: (ids: number[], is_visible: boolean) =>
    api.post('/admin/docs/batch-visibility', { ids, is_visible }),

  // 导入 / 富文本嵌入图片上传
  import: (file: File, categoryId?: number) => {
    const fd = new FormData();
    fd.append('file', file);
    if (categoryId) fd.append('category_id', String(categoryId));
    return api.post('/admin/docs/import', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    });
  },
  // 批量导入：单次最多 50 个文件，总大小 ≤100MB
  batchImport: (files: File[], categoryId: number, isVisible = true) => {
    const fd = new FormData();
    files.forEach((f) => fd.append('files[]', f));
    fd.append('category_id', String(categoryId));
    fd.append('is_visible', isVisible ? '1' : '0');
    return api.post<{
      success: number;
      failed: number;
      details: { filename: string; status: 'ok' | 'failed'; doc_id?: number; title?: string; error?: string }[];
    }>('/admin/docs/batch-import', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 600000,
    });
  },
  // 单文档导出为 .md
  exportOne: (id: number) =>
    api.get(`/admin/docs/${id}/export.md`, { responseType: 'blob', timeout: 60000 }),
  // 批量导出为 zip（ids ≤ 200）
  exportBatch: (ids: number[]) =>
    api.post('/admin/docs/export-batch', { ids }, { responseType: 'blob', timeout: 300000 }),
  uploadImage: (file: File) => {
    const fd = new FormData();
    fd.append('image', file);
    return api.post('/admin/docs/upload-image', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60000,
    });
  },

  // RAG：单文档重建 / 全量重建 / 检索预览 / 模型测试 / 审计日志
  reindexOne: (id: number) => api.post(`/admin/docs/${id}/reindex`, {}, { timeout: 180000 }),
  reindexAll: () => api.post('/admin/docs/reindex-all', {}, { timeout: 600000 }),
  retrievePreview: (data: { query: string; top_k?: number }) =>
    api.post('/admin/docs/retrieve-preview', data),
  testModel: (data: { type: 'chat' | 'embedding'; cloud_model_id: number }) =>
    api.post('/admin/docs/test-model', data, { timeout: 30000 }),
  chatLogs: (params?: Record<string, any>) => api.get('/admin/docs/chat-logs', { params }),
};

// Knowledge Bases（云端知识库：库 CRUD + 文档 + 文件上传解析 + 异步向量化 + hybrid 检索）
// 与帮助文档独立；向量存 Qdrant，文档支持富文本在线编辑 + 文件上传（PDF/Word/MD/TXT/Excel）。
export const knowledgeBaseApi = {
  // 设置（embedding 模型 + 切片/检索参数 + 统计 + Qdrant 健康）
  getConfig: () => api.get('/admin/knowledge-bases/config'),
  updateConfig: (data: Record<string, any>) => api.put('/admin/knowledge-bases/config', data),

  // 知识库 CRUD
  list: (params?: Record<string, any>) => api.get('/admin/knowledge-bases', { params }),
  get: (id: number) => api.get(`/admin/knowledge-bases/${id}`),
  create: (data: Record<string, any>) => api.post('/admin/knowledge-bases', data),
  update: (id: number, data: Record<string, any>) => api.put(`/admin/knowledge-bases/${id}`, data),
  delete: (id: number) => api.delete(`/admin/knowledge-bases/${id}`),
  // 轻量列表（数字员工绑定下拉用）
  options: () => api.get('/admin/knowledge-bases/options'),

  // 文档（挂在 kbId 下）
  listDocuments: (kbId: number, params?: Record<string, any>) =>
    api.get(`/admin/knowledge-bases/${kbId}/documents`, { params }),
  getDocument: (kbId: number, docId: number) =>
    api.get(`/admin/knowledge-bases/${kbId}/documents/${docId}`),
  createDocument: (kbId: number, data: Record<string, any>) =>
    api.post(`/admin/knowledge-bases/${kbId}/documents`, data),
  updateDocument: (kbId: number, docId: number, data: Record<string, any>) =>
    api.put(`/admin/knowledge-bases/${kbId}/documents/${docId}`, data),
  deleteDocument: (kbId: number, docId: number) =>
    api.delete(`/admin/knowledge-bases/${kbId}/documents/${docId}`),
  reindexDocument: (kbId: number, docId: number) =>
    api.post(`/admin/knowledge-bases/${kbId}/documents/${docId}/reindex`, {}, { timeout: 60000 }),
  reindexKb: (kbId: number) =>
    api.post(`/admin/knowledge-bases/${kbId}/reindex`, {}, { timeout: 60000 }),
  // 批量上传文件解析：单次最多 50 个文件，单个 ≤20MB
  import: (kbId: number, files: File[]) => {
    const fd = new FormData();
    files.forEach((f) => fd.append('files[]', f));
    return api.post<{
      success: number;
      failed: number;
      details: { filename: string; status: 'ok' | 'failed'; doc_id?: number; title?: string; error?: string }[];
    }>(`/admin/knowledge-bases/${kbId}/import`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 600000,
    });
  },
  uploadImage: (file: File) => {
    const fd = new FormData();
    fd.append('image', file);
    return api.post('/admin/knowledge-bases/upload-image', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60000,
    });
  },
  retrievePreview: (data: { query: string; top_k?: number; knowledge_base_id?: number; kb_ids?: number[] }) =>
    api.post('/admin/knowledge-bases/retrieve-preview', data),
  testModel: (data: { cloud_model_id: number }) =>
    api.post('/admin/knowledge-bases/test-model', data, { timeout: 30000 }),
};

// AI 抠图（阿里 viapi SegmentHDCommonImage）后台管理
// v1.5.0+ AccessKey / endpoint / credit 等改后台 UI 配置（GET/PUT /admin/matting/settings），不再走 .env
export const mattingApi = {
  // 统计：今日 / 本月任务数、用量、Top 用户、配置状态（masked AK + enabled）
  stats: () => api.get('/admin/matting/stats'),
  // 自定义设置（含 AK/SK / endpoint / region / credit_per_call / enabled）
  getSettings: () => api.get('/admin/matting/settings'),
  updateSettings: (data: {
    matting_enabled?: boolean
    matting_access_key_id?: string
    matting_access_key_secret?: string  // 留空 = 不修改
    matting_endpoint?: string
    matting_region_id?: string
    matting_credit_per_call?: number
  }) => api.put('/admin/matting/settings', data),
  // 任务列表（分页 + user_id / status / source / keyword / from_date / to_date 过滤）
  list: (params?: Record<string, any>) => api.get('/admin/matting/tasks', { params }),
  get: (taskId: string) => api.get(`/admin/matting/tasks/${taskId}`),
  delete: (taskId: string) => api.delete(`/admin/matting/tasks/${taskId}`),
  batchDelete: (ids: string[]) => api.post('/admin/matting/tasks/batch-delete', { ids }),
  // 管理员测试调用：上传一张图直接跑通端到端（验证当前自定义设置是否可用）
  test: (file: File) => {
    const fd = new FormData();
    fd.append('image', file);
    return api.post('/admin/matting/test', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 90000,
    });
  },
};

// 精细抠图（抠抠图 koukoutu 异步 API，按尺寸三档计费）后台管理
// API Key / 三档单价 / 三档尺寸阈值 / 启用开关 走 GET/PUT /admin/fine-matting/settings
export const fineMattingApi = {
  // 统计：今日 / 本月任务、三档分布、实时全站并发、配置状态
  stats: () => api.get('/admin/fine-matting/stats'),
  // 自定义设置（API Key 密文隐藏 + 三档价 + 阈值 + enabled）
  getSettings: () => api.get('/admin/fine-matting/settings'),
  updateSettings: (data: {
    fine_matting_enabled?: boolean
    fine_matting_api_key?: string  // 留空 = 不修改
    fine_matting_tier1_credit?: number
    fine_matting_tier2_credit?: number
    fine_matting_tier3_credit?: number
    fine_matting_tier_threshold_1?: number
    fine_matting_tier_threshold_2?: number
  }) => api.put('/admin/fine-matting/settings', data),
  // 任务列表（分页 + user_id / status / tier / keyword / from_date / to_date 过滤）
  list: (params?: Record<string, any>) => api.get('/admin/fine-matting/tasks', { params }),
  get: (taskId: string) => api.get(`/admin/fine-matting/tasks/${taskId}`),
  delete: (taskId: string) => api.delete(`/admin/fine-matting/tasks/${taskId}`),
  batchDelete: (ids: string[]) => api.post('/admin/fine-matting/tasks/batch-delete', { ids }),
  // 管理员测试调用：上传一张图直接跑通端到端（返回结果 + 尺寸档位 + 售价）
  test: (file: File) => {
    const fd = new FormData();
    fd.append('image', file);
    return api.post('/admin/fine-matting/test', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 180000,
    });
  },
};

// 店铺商品图（多商城对接）后台管理：一级授权态（按商城）+ 立即刷新
// 基础设置（各商城显示名 {mall}_shop_mall_name）走通用 settingApi；per-user 权限（allow_{mall}_shop）走 permissionApi
export const eweiShopApi = {
  // 响应：{ authorized:bool(=ewei,兼容), malls:{ewei,dianda}, platform_labels:{ewei,dianda} }
  authorization: () => api.get('/admin/ewei-shop/authorization'),
  // refresh 始终整张 map 回源；可选 mall 仅用于回选 authorized 单值
  refreshAuth: (mall?: string) => api.post('/admin/ewei-shop/refresh-auth', mall ? { mall } : {}),
};

// Cloud Build (white-label desktop app packaging)
export const cloudBuildApi = {
  authCheck: () => api.get('/admin/cloud-build/auth-check'),
  getGithubSettings: () => api.get('/admin/cloud-build/github-settings'),
  saveGithubSettings: (data: { repo: string; token?: string }) =>
    api.put('/admin/cloud-build/github-settings', data),
  list: (params?: Record<string, any>) => api.get('/admin/cloud-build', { params }),
  get: (buildId: string) => api.get(`/admin/cloud-build/${buildId}`),
  request: (data: { app_name: string; platform: string; icon_url: string }) =>
    api.post('/admin/cloud-build/request', data),
  cancel: (buildId: string, force = false) =>
    api.post(`/admin/cloud-build/${buildId}/cancel`, { force }),
  refresh: (buildId: string) => api.post(`/admin/cloud-build/${buildId}/refresh`),
  retry: (buildId: string) => api.post(`/admin/cloud-build/${buildId}/retry`),
  templateInfo: () => api.get('/admin/cloud-build/template-info'),
  // 持久化应用名 + 图标到 system_settings，下次进入页面自动回填
  getProfile: () => api.get('/admin/cloud-build/profile'),
  saveProfile: (data: { app_name?: string; icon_url?: string; customer_service_title?: string; customer_service_image_url?: string }) =>
    api.put('/admin/cloud-build/profile', data),
  uploadIcon: (file: File) => {
    const fd = new FormData();
    fd.append('icon', file);
    return api.post('/admin/cloud-build/icon', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60000,
    });
  },
  uploadCustomerServiceImage: (file: File) => {
    const fd = new FormData();
    fd.append('image', file);
    return api.post('/admin/cloud-build/customer-service-image', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60000,
    });
  },
  // 登录页背景图上传（站点设置用，复用 cloud-build 图片上传基础设施）
  uploadLoginBackground: (file: File) => {
    const fd = new FormData();
    fd.append('image', file);
    return api.post('/admin/cloud-build/login-background', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60000,
    });
  },
  // 数字员工列表页背景图上传（桌面端外观设置用）
  uploadBotListBackground: (file: File) => {
    const fd = new FormData();
    fd.append('image', file);
    return api.post('/admin/cloud-build/bot-list-background', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60000,
    });
  },
  // 1.2.15+：清空 cancelled / failed 历史记录（同时尽可能清掉关联的孤儿文件）
  cleanupInvalid: () => api.delete('/admin/cloud-build/invalid'),
  // 1.2.15+：安装包目录管理
  listInstallers: () => api.get('/admin/cloud-build/installers'),
  deleteInstaller: (filename: string) =>
    api.delete('/admin/cloud-build/installers', { params: { filename } }),
  // 1.4.4+：storage/app/cloud-builds/tmp 临时下载产物管理（PHP 进程被强杀留下的孤儿 .bin 文件清理）
  listTmpArtifacts: (orphanAfterHours?: number) =>
    api.get('/admin/cloud-build/tmp-artifacts', { params: orphanAfterHours ? { orphan_after_hours: orphanAfterHours } : {} }),
  cleanupTmpArtifacts: (data?: { min_age_hours?: number; filenames?: string[] }) =>
    api.post('/admin/cloud-build/tmp-artifacts/cleanup', data || {}),
  // 1.2.17+：授权信息（域名 / 姓名 / 电话）。domain 只读，保存时只传 owner_name + owner_phone
  getMyInfo: () => api.get('/admin/cloud-build/my-info'),
  updateMyInfo: (data: { owner_name: string; owner_phone?: string | null }) =>
    api.put('/admin/cloud-build/my-info', data),
};

export const oemProjectApi = {
  list: (params?: Record<string, any>) => api.get('/admin/oem-projects', { params }),
  get: (projectKey: string) => api.get(`/admin/oem-projects/${projectKey}`),
  create: (data: Record<string, any>) => api.post('/admin/oem-projects', data),
  update: (projectKey: string, data: Record<string, any>) => api.put(`/admin/oem-projects/${projectKey}`, data),
  delete: (projectKey: string) => api.delete(`/admin/oem-projects/${projectKey}`),
  members: (projectKey: string) => api.get(`/admin/oem-projects/${projectKey}/members`),
  upsertMember: (projectKey: string, data: Record<string, any>) =>
    api.post(`/admin/oem-projects/${projectKey}/members`, data),
  syncMembers: (projectKey: string, members: Array<Record<string, any>>) =>
    api.put(`/admin/oem-projects/${projectKey}/members`, { members }),
  deleteMember: (projectKey: string, userId: number) =>
    api.delete(`/admin/oem-projects/${projectKey}/members/${userId}`),
  builds: (projectKey: string, params?: Record<string, any>) =>
    api.get(`/admin/oem-projects/${projectKey}/builds`, { params }),
  requestBuild: (projectKey: string, data: { platform: string; app_name?: string; icon_url?: string }) =>
    api.post(`/admin/oem-projects/${projectKey}/builds`, data),
  getBuild: (projectKey: string, buildId: string) =>
    api.get(`/admin/oem-projects/${projectKey}/builds/${buildId}`),
  cleanupInvalid: (projectKey: string) =>
    api.delete(`/admin/oem-projects/${projectKey}/invalid`),
  listInstallers: (projectKey: string) =>
    api.get(`/admin/oem-projects/${projectKey}/installers`),
  deleteInstaller: (projectKey: string, filename: string) =>
    api.delete(`/admin/oem-projects/${projectKey}/installers`, { params: { filename } }),
  refreshBuild: (projectKey: string, buildId: string) =>
    api.post(`/admin/oem-projects/${projectKey}/builds/${buildId}/refresh`),
  retryBuild: (projectKey: string, buildId: string) =>
    api.post(`/admin/oem-projects/${projectKey}/builds/${buildId}/retry`),
  cancelBuild: (projectKey: string, buildId: string, force = false) =>
    api.post(`/admin/oem-projects/${projectKey}/builds/${buildId}/cancel`, { force }),
};

// AI Deck 资源资产(ffmpeg / 模板包)
export const deckAssetApi = {
  list: (params?: Record<string, any>) => api.get('/admin/deck-assets', { params }),
  // 完备性自检 + 一键拉取缺失（替代手动「添加资产」/「粘贴 manifest」）
  check: () => api.get('/admin/deck-assets/check'),
  sync: (data: Record<string, any>) => api.post('/admin/deck-assets/sync', data),
  pull: (id: number) => api.post(`/admin/deck-assets/${id}/pull`),
  remove: (id: number) => api.delete(`/admin/deck-assets/${id}`),
};

// 解说 TTS 供应商
export const ttsProviderApi = {
  list: (params?: Record<string, any>) => api.get('/admin/tts-providers', { params }),
  create: (data: Record<string, any>) => api.post('/admin/tts-providers', data),
  update: (id: number, data: Record<string, any>) => api.put(`/admin/tts-providers/${id}`, data),
  remove: (id: number) => api.delete(`/admin/tts-providers/${id}`),
  test: (id: number, data?: Record<string, any>) => api.post(`/admin/tts-providers/${id}/test`, data),
};

export const skillCatalogApi = {
  list: () => api.get('/admin/skills'),
  get: (skillId: string) => api.get(`/admin/skills/${skillId}`),
  update: (skillId: string, data: Record<string, any>) => api.put(`/admin/skills/${skillId}`, data),
  setTenantPolicy: (skillId: string, tenantId: number, listed: boolean) =>
    api.put(`/admin/skills/${skillId}/tenants/${tenantId}`, { listed }),
  sync: () => api.post('/admin/skills/sync'),
};

