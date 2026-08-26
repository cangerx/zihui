import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

// 类型与主进程保持一致；不直接 import 主进程类型避免 renderer ↔ main 耦合
export type CreativeTemplateSource = 'manual' | 'image' | 'inspiration'
export type CreativeTemplateSubmissionStatus = '' | 'pending' | 'approved' | 'rejected' | 'withdrawn'
export type CreativeTemplateFieldType = 'text' | 'textarea' | 'select' | 'multi_select'

export interface CreativeTemplateVariable {
  key: string
  label: string
  type: CreativeTemplateFieldType
  required: boolean
  placeholder?: string
  default?: string
  options?: string[]
}

export interface CreativeTemplateCategory {
  id: string
  name: string
  description: string
  sort_order: number
  is_visible: number
  created_at: string
  updated_at: string
}

export interface CreativeTemplate {
  id: string
  category_id: string
  title: string
  description: string
  cover_image: string
  example_ref_images: string[]
  requires_ref_image: number
  default_size: string
  prompt_template: string
  variables: CreativeTemplateVariable[]
  source_type: CreativeTemplateSource
  source_image: string
  source_inspiration_id: string
  cloud_template_id: number
  submission_status: CreativeTemplateSubmissionStatus
  submission_reject_reason: string
  submission_reviewed_at: string
  submission_published_at: string
  submission_synced_at: string
  sort_order: number
  is_visible: number
  created_at: string
  updated_at: string
}

export interface CloudCreativeTemplateCategory {
  id: number
  name: string
  description: string
  sort_order: number
}

export interface CloudCreativeTemplate {
  id: number
  category_id: number
  category_name?: string
  title: string
  description: string
  cover_image: string
  example_ref_images: string[]
  requires_ref_image: number
  default_size: string
  prompt_template: string
  variables: CreativeTemplateVariable[]
  sort_order: number
  updated_at?: string
}

interface CategoryInput {
  name: string
  description?: string
  sort_order?: number
  is_visible?: boolean
}

export interface TemplateInput {
  category_id: string
  title: string
  description?: string
  cover_image?: string
  example_ref_images?: string[]
  requires_ref_image?: boolean | number
  default_size?: string
  prompt_template: string
  variables: CreativeTemplateVariable[]
  source_type?: CreativeTemplateSource
  source_image?: string
  source_inspiration_id?: string
  sort_order?: number
  is_visible?: boolean
}

export interface SubmitCreativeTemplateResult {
  ok: boolean
  error?: string
  data?: any
  compressed?: boolean
}

// Pinia 序列化所需：proxy / reactive 不能直接走 IPC（structured clone 会丢失 getter）
function plain<T>(v: T): T {
  return JSON.parse(JSON.stringify(v))
}

const invoke = <T = unknown>(channel: string, ...args: unknown[]): Promise<T> =>
  window.api.creativeTemplate.invoke(channel, ...args) as Promise<T>

export const useCreativeTemplateStore = defineStore('creativeTemplates', () => {
  // ─── 本地数据 ───
  const categories = ref<CreativeTemplateCategory[]>([])
  const templates = ref<CreativeTemplate[]>([])
  const localLoading = ref(false)
  const activeCategoryId = ref<string | null>(null)
  const search = ref('')
  const submittingIds = ref<string[]>([])

  // ─── 云端数据 ───
  const cloudCategories = ref<CloudCreativeTemplateCategory[]>([])
  const cloudTemplates = ref<CloudCreativeTemplate[]>([])
  const cloudLoading = ref(false)
  const cloudTotal = ref(0)
  const cloudPage = ref(1)
  const cloudPageSize = ref(24)
  const cloudActiveCategoryId = ref<number | null>(null)
  const cloudSearch = ref('')
  const cloudError = ref<string | null>(null)

  const filteredLocal = computed(() => {
    return templates.value
  })

  // ─── 本地分类 ───
  async function fetchCategories(): Promise<void> {
    categories.value = await invoke<CreativeTemplateCategory[]>('listCategories')
  }
  async function createCategory(data: CategoryInput): Promise<CreativeTemplateCategory> {
    const cat = await invoke<CreativeTemplateCategory>('createCategory', plain(data))
    categories.value.push(cat)
    return cat
  }
  async function updateCategory(id: string, data: Partial<CategoryInput>): Promise<CreativeTemplateCategory | null> {
    const next = await invoke<CreativeTemplateCategory | null>('updateCategory', id, plain(data))
    if (next) {
      const idx = categories.value.findIndex((c) => c.id === id)
      if (idx !== -1) categories.value[idx] = next
    }
    return next
  }
  async function deleteCategory(id: string): Promise<void> {
    await invoke('deleteCategory', id)
    categories.value = categories.value.filter((c) => c.id !== id)
    templates.value = templates.value.filter((t) => t.category_id !== id)
    if (activeCategoryId.value === id) {
      activeCategoryId.value = null
    }
  }

  // ─── 本地模板 ───
  async function fetchTemplates(): Promise<void> {
    localLoading.value = true
    try {
      const options: { categoryId?: string; search?: string } = {}
      if (activeCategoryId.value) options.categoryId = activeCategoryId.value
      if (search.value) options.search = search.value
      templates.value = await invoke<CreativeTemplate[]>('list', options)
    } finally {
      localLoading.value = false
    }
  }
  async function createTemplate(data: TemplateInput): Promise<CreativeTemplate> {
    const created = await invoke<CreativeTemplate>('create', plain(data))
    templates.value.unshift(created)
    return created
  }
  async function updateTemplate(id: string, data: Partial<TemplateInput>): Promise<CreativeTemplate | null> {
    const next = await invoke<CreativeTemplate | null>('update', id, plain(data))
    if (next) {
      const idx = templates.value.findIndex((t) => t.id === id)
      if (idx !== -1) templates.value[idx] = next
    }
    return next
  }
  async function deleteTemplate(id: string): Promise<void> {
    await invoke('delete', id)
    templates.value = templates.value.filter((t) => t.id !== id)
  }
  async function getTemplate(id: string): Promise<CreativeTemplate | null> {
    return invoke<CreativeTemplate | null>('get', id)
  }
  async function refreshLocalTemplate(id: string): Promise<void> {
    const next = await getTemplate(id)
    if (!next) return
    const idx = templates.value.findIndex((t) => t.id === id)
    if (idx !== -1) templates.value[idx] = next
  }
  async function submitTemplateToCloud(id: string, cloudCategoryId: number): Promise<SubmitCreativeTemplateResult> {
    submittingIds.value = Array.from(new Set([...submittingIds.value, id]))
    try {
      const res = await invoke<SubmitCreativeTemplateResult>('submitToCloud', { templateId: id, cloudCategoryId })
      await refreshLocalTemplate(id)
      return res
    } finally {
      submittingIds.value = submittingIds.value.filter((x) => x !== id)
    }
  }
  async function syncSubmissionStatus(ids?: string[]): Promise<void> {
    const targetIds = ids?.length ? ids : templates.value.map((t) => t.id)
    if (!targetIds.length) return
    await invoke('syncSubmissionStatus', targetIds)
    await fetchTemplates()
  }
  async function withdrawSubmission(id: string): Promise<SubmitCreativeTemplateResult> {
    submittingIds.value = Array.from(new Set([...submittingIds.value, id]))
    try {
      const res = await invoke<SubmitCreativeTemplateResult>('withdrawSubmission', id)
      await refreshLocalTemplate(id)
      return res
    } finally {
      submittingIds.value = submittingIds.value.filter((x) => x !== id)
    }
  }
  async function importCloudToLocal(source: CloudCreativeTemplate, targetCategoryId: string): Promise<CreativeTemplate> {
    const imported = await invoke<CreativeTemplate>(
      'importLocal',
      plain({
        title: source.title,
        description: source.description,
        cover_image: source.cover_image,
        example_ref_images: source.example_ref_images,
        requires_ref_image: source.requires_ref_image,
        default_size: source.default_size,
        prompt_template: source.prompt_template,
        variables: source.variables,
      }),
      targetCategoryId,
    )
    templates.value.unshift(imported)
    return imported
  }

  function setActiveCategory(id: string | null): Promise<void> {
    activeCategoryId.value = id
    return fetchTemplates()
  }
  function setSearch(s: string): Promise<void> {
    search.value = s
    return fetchTemplates()
  }

  // ─── 云端 ───
  async function fetchCloudCategories(): Promise<void> {
    try {
      cloudCategories.value = await invoke<CloudCreativeTemplateCategory[]>('cloudCategories')
    } catch (e: unknown) {
      cloudCategories.value = []
      cloudError.value = e instanceof Error ? e.message : String(e)
    }
  }
  async function fetchCloudTemplates(): Promise<void> {
    cloudLoading.value = true
    cloudError.value = null
    try {
      // 云端模板广场改为前端随机 + 无限滚动：这里一次性循环拉全量，分页仅用于抓全。
      // 安全上限 30 页（每页 100，最多 3000 条），避免异常数据导致死循环。
      const fetchSize = 100
      let page = 1
      let total = Infinity
      const acc: CloudCreativeTemplate[] = []
      while (acc.length < total && page <= 30) {
        const options: { page: number; pageSize: number; categoryId?: number; search?: string } = {
          page,
          pageSize: fetchSize,
        }
        if (cloudActiveCategoryId.value) options.categoryId = cloudActiveCategoryId.value
        if (cloudSearch.value) options.search = cloudSearch.value
        const res = await invoke<{
          items: CloudCreativeTemplate[]
          total: number
          page: number
          pageSize: number
        }>('cloudList', options)
        const items = Array.isArray(res.items) ? res.items : []
        if (page === 1) total = typeof res.total === 'number' ? res.total : items.length
        acc.push(...items)
        if (!items.length) break
        page++
      }
      cloudTemplates.value = acc
      cloudTotal.value = total === Infinity ? acc.length : total
      cloudPage.value = 1
    } catch (e: unknown) {
      cloudTemplates.value = []
      cloudTotal.value = 0
      cloudError.value = e instanceof Error ? e.message : String(e)
    } finally {
      cloudLoading.value = false
    }
  }
  function setCloudActiveCategory(id: number | null): Promise<void> {
    cloudActiveCategoryId.value = id
    cloudPage.value = 1
    return fetchCloudTemplates()
  }
  function setCloudSearch(s: string): Promise<void> {
    cloudSearch.value = s
    cloudPage.value = 1
    return fetchCloudTemplates()
  }
  function setCloudPage(p: number): Promise<void> {
    cloudPage.value = p
    return fetchCloudTemplates()
  }

  return {
    categories,
    templates,
    filteredLocal,
    localLoading,
    activeCategoryId,
    search,
    submittingIds,
    cloudCategories,
    cloudTemplates,
    cloudLoading,
    cloudTotal,
    cloudPage,
    cloudPageSize,
    cloudActiveCategoryId,
    cloudSearch,
    cloudError,
    fetchCategories,
    createCategory,
    updateCategory,
    deleteCategory,
    fetchTemplates,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    getTemplate,
    submitTemplateToCloud,
    syncSubmissionStatus,
    withdrawSubmission,
    importCloudToLocal,
    setActiveCategory,
    setSearch,
    fetchCloudCategories,
    fetchCloudTemplates,
    setCloudActiveCategory,
    setCloudSearch,
    setCloudPage,
  }
})
