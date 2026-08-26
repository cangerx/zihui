export interface AdminUser {
  id: number
  username: string
  name: string
  role: string
  last_login_at?: string | null
}

export interface LoginResponse {
  token: string
  user: AdminUser
}

export type ClientStatus = 'active' | 'suspended' | 'expired'

/**
 * 商城标识（死契约，跨端唯一约定）：严格为 'ewei' / 'dianda'。
 * 新增第 N 个商城在此追加一行，并在 MALL_OPTIONS 注册一项。
 */
export type MallKey = 'ewei' | 'dianda' | 'qdyun'

/** 按商城聚合的一级授权 map：{ ewei: bool, dianda: bool } */
export type MallAuthorizations = Partial<Record<MallKey, boolean>>

export interface BuildClient {
  client_id: string
  domain: string
  notify_url: string
  owner_name: string
  owner_phone: string | null
  daily_limit: number
  monthly_limit: number
  /** 今日已用打包次数（来自 build_quotas 当日记录） */
  daily_used: number
  /** 本月已用打包次数（build_quotas 当月 SUM） */
  monthly_used: number
  status: ClientStatus
  expires_at: string | null
  /** 共享灵感库审核员标识，由后台手动任命；缺省 false */
  is_hub_reviewer?: boolean
  /** 维护期可打包豁免：为 true 时即使平台全局打包维护开启也可正常打包；缺省 false */
  maintenance_exempt?: boolean
  /**
   * 「店铺商品图」功能授权（旧单一 ewei 字段，向后兼容保留）：
   * 为 true 时该云控端可对旗下用户开放店铺商品图功能；缺省 false。
   * 等价于 mall_authorizations.ewei。
   */
  can_use_ewei_shop?: boolean
  /**
   * 按商城聚合的一级授权 map（{ ewei: bool, dianda: bool }）。
   * 由 index() join client_mall_authorizations 聚合（ewei 回退旧列 can_use_ewei_shop）。
   * 前端据此按商城渲染开关；缺省视为各商城未授权。
   */
  mall_authorizations?: MallAuthorizations
  can_use_github_packaging?: boolean
  can_use_mac_packaging?: boolean
  created_at: string
  updated_at: string
}

export type PackagingFeature = 'win' | 'mac'

export interface ClientListResponse {
  total: number
  page: number
  page_size: number
  items: BuildClient[]
}

export interface ClientCreateResponse {
  client_id: string
  domain: string
}

export type BuildStatus =
  | 'pending'
  | 'queued'
  | 'building'
  | 'success'
  | 'delivered'
  | 'purged'
  | 'failed'
  | 'cancelled'
  | 'expired'

export type MirrorStatus =
  | 'pending'
  | 'mirroring'
  | 'mirrored'
  | 'failed'
  | 'purging'
  | 'purged'

export interface BuildRequest {
  build_id: string
  client_id: string
  app_name: string
  platform: 'win' | 'mac'
  app_version: string
  build_mode?: 'normal' | 'oem'
  oem_project_key?: string | null
  app_id?: string | null
  update_path?: string | null
  status: BuildStatus
  executor_id: string | null
  executor_run_id: number | null
  /** 家庭电脑中转状态；老数据或尚未进入中转阶段时为 null */
  mirror_status?: MirrorStatus | null
  mirror_assigned_at?: string | null
  mirror_acked_at?: string | null
  queued_at: string | null
  started_at: string | null
  finished_at: string | null
  delivered_at: string | null
  purged_at: string | null
  error_message: string | null
  created_at: string
  // 从 authorized_clients 表 LEFT JOIN 取出：若授权记录被删则为 null
  domain: string | null
  owner_name: string | null
}

export interface BuildRequestDetail extends BuildRequest {
  icon_path: string | null
  artifact_path: string | null
  artifact_size: number | null
  artifact_sha256: string | null
  artifact_files: string | null
  build_options?: string | null
  updated_at: string
}

export interface BuildRequestListResponse {
  total: number
  page: number
  page_size: number
  items: BuildRequest[]
}

export interface AuthRequestRecord {
  id: number
  result: 'allowed' | 'denied'
  reason: string
  origin: string | null
  host: string | null
  referer: string | null
  client_id: string | null
  client_status: string | null
  ip: string | null
  user_agent: string | null
  admin_version: string | null
  method: string | null
  path: string | null
  created_at: string
}

export interface AuthRequestListResponse {
  total: number
  page: number
  page_size: number
  items: AuthRequestRecord[]
}

export interface TemplateVersion {
  id: number
  version: string
  changelog: string | null
  released_at: string
  released_by: string
  is_current: 0 | 1
  created_at: string
  updated_at: string
}

export interface QueueStatus {
  paused: boolean
  queued: number
  building: number
  last_hour: {
    success: number
    failed_or_cancelled: number
  }
  totals: Record<string, number>
}

export interface DashboardStats {
  range: 'day' | 'week' | 'month'
  days: number
  since: string
  totals: {
    all_in_range: number
    success: number
    failed: number
    cancelled: number
    in_progress: number
  }
  by_status: Record<string, number>
  by_platform: Record<string, number>
  top_clients: Array<{ client_id: string; cnt: number }>
  daily_series: Array<{ day: string; status: string; cnt: number }>
  clients: { active: number; total: number }
  templates: { total: number; current: string | null }
}

export interface ApiErrorBody {
  error: string
  details?: Record<string, string[]>
  [key: string]: unknown
}

export interface CosSettings {
  region: string
  bucket: string
  app_id: string
  secret_id: string
  secret_key_masked: string
  has_secret_key: boolean
  custom_domain: string
  configured: boolean
}

export interface CosSettingsUpdatePayload {
  region: string
  bucket: string
  app_id?: string
  secret_id: string
  /** 留空表示不修改已有 SecretKey */
  secret_key?: string
  custom_domain?: string
}

export interface CosTestResult {
  ok: boolean
  msg: string
  endpoint?: string
}

// =====================================================================
// 共享灵感库 v1
// =====================================================================

export type SharedInspirationStatus = 'pending' | 'approved' | 'rejected'

export type ReportReasonCode =
  | 'invalid_image'
  | 'inappropriate'
  | 'duplicate'
  | 'copyright'
  | 'other'

export interface SharedInspirationCategory {
  id: number
  name: string
  slug: string
  sort_order: number
  created_at: string
  updated_at: string
  /** 仅 admin/api/shared-inspiration-categories 列表带：本分类下灵感数量 */
  inspiration_count?: number
}

/** 列表行（含来源 client 的 LEFT JOIN 字段） */
export interface SharedInspiration {
  id: number
  category_id: number
  category_name?: string | null
  category_slug?: string | null
  title: string
  cover_image: string
  ref_images?: string[]
  generation_size?: string | null
  prompt_cn: string | null
  prompt_en: string | null
  source_client_id: string
  source_local_id: number
  source_site_name: string
  /** 来自 authorized_clients LEFT JOIN：客户端可能已被删 */
  source_domain?: string | null
  source_owner_name?: string | null
  status: SharedInspirationStatus
  is_visible: boolean | 0 | 1
  approve_count: number
  reject_count: number
  report_count: number
  download_count: number
  reviewed_at: string | null
  auto_hidden_at: string | null
  created_at: string
  updated_at: string
}

export interface SharedInspirationListResponse {
  total: number
  page: number
  page_size: number
  items: SharedInspiration[]
}

export interface SharedInspirationReviewLog {
  id: number
  reviewer_client_id: string
  reviewer_domain: string | null
  reviewer_owner_name: string | null
  action: 'approve' | 'reject'
  reason: string | null
  created_at: string
}

export interface SharedInspirationReportRow {
  id: number
  shared_id: number
  reporter_client_id: string
  reporter_domain: string | null
  reporter_owner_name: string | null
  reason_code: ReportReasonCode
  reason_note: string | null
  created_at: string
  /** 列表视图 LEFT JOIN 自带 */
  shared_title?: string
  shared_cover?: string
  shared_status?: SharedInspirationStatus
  shared_is_visible?: boolean | 0 | 1
  source_site_name?: string
  report_count?: number
}

/** grouped=1 视图：按 shared_id 聚合 */
export interface SharedInspirationReportGroupRow {
  shared_id: number
  title: string
  cover_image: string
  source_site_name: string
  status: SharedInspirationStatus
  is_visible: boolean | 0 | 1
  auto_hidden_at: string | null
  report_count: number
  created_at: string
}

export interface SharedInspirationReportListResponse {
  total: number
  page: number
  page_size: number
  items: SharedInspirationReportRow[] | SharedInspirationReportGroupRow[]
}

export interface SharedInspirationDetailResponse {
  inspiration: SharedInspiration
  reviews: SharedInspirationReviewLog[]
  reports: SharedInspirationReportRow[]
}

export interface InspirationHubSettings {
  approve_threshold: number
  reject_threshold: number
  report_threshold: number
  submit_daily_limit: number
}

export interface InspirationHubSettingsWarning {
  code: string
  message: string
  active_reviewers?: number
  threshold?: number
}

export interface InspirationHubSettingsResponse {
  settings: InspirationHubSettings
  defaults: InspirationHubSettings
  active_reviewers: number
  warnings: InspirationHubSettingsWarning[]
}

export interface SharedInspirationStatsResponse {
  stats: {
    total: number
    pending: number
    approved: number
    rejected: number
    hidden: number
    reports_open: number
    reviewers: number
  }
  top_sources: Array<{
    source_client_id: string
    domain: string | null
    owner_name: string | null
    cnt: number
  }>
  top_downloaded: Array<{
    id: number
    title: string
    cover_image: string
    source_site_name: string
    download_count: number
  }>
  trend_7d: Array<{ date: string; count: number }>
}
