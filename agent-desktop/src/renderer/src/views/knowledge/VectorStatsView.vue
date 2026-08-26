<template>
  <div class="flex-1 flex flex-col overflow-hidden">
    <!-- Header -->
    <header class="page-header">
      <div class="flex items-center gap-2">
        <button
          class="btn-primary text-sm"
          :disabled="vectorizeStore.vectorizing || !canVectorize"
          :title="!canVectorize ? actionHint : ''"
          @click="handleVectorizeAll"
        >
          <span v-if="vectorizeStore.vectorizing" class="inline-flex items-center gap-1">
            <svg class="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
            处理中...
          </span>
          <span v-else>全部增量向量化</span>
        </button>
        <button
          v-if="mismatchInfo?.mismatch"
          class="btn-secondary text-sm"
          :disabled="vectorizeStore.vectorizing"
          @click="handleReembedAll"
        >全量重新向量化</button>
        <router-link to="/knowledge" class="btn-secondary text-sm">返回知识库</router-link>
      </div>
    </header>

    <!-- Status Banner -->
    <div v-if="banner" :class="['mx-6 mt-4 p-3 rounded-lg border flex items-start gap-3', bannerClass]">
      <svg class="w-5 h-5 flex-shrink-0 mt-0.5" :class="bannerIconClass" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
      </svg>
      <div class="flex-1 min-w-0">
        <div class="text-sm font-medium" :class="bannerTitleClass">{{ banner.title }}</div>
        <div v-if="banner.detail" class="text-xs mt-0.5" :class="bannerSubClass">{{ banner.detail }}</div>
      </div>
      <div class="flex items-center gap-2 flex-shrink-0">
        <router-link
          v-if="banner.action === 'purchase'"
          to="/plans-store"
          class="text-xs font-medium text-primary-600 hover:text-primary-700 whitespace-nowrap"
        >购买套餐 →</router-link>
        <button
          v-if="banner.action === 'settings'"
          type="button"
          class="text-xs font-medium text-primary-600 hover:text-primary-700 whitespace-nowrap"
          @click="openSettingsConnection"
        >去设置 →</button>
        <button
          v-if="banner.action === 'reembed'"
          class="text-xs font-medium text-primary-600 hover:text-primary-700 whitespace-nowrap"
          :disabled="vectorizeStore.vectorizing"
          @click="handleReembedAll"
        >重新向量化 →</button>
      </div>
    </div>

    <!-- Progress Banner -->
    <div v-if="vectorizeStore.progress" class="mx-6 mt-4 p-4 rounded-lg border"
      :class="{
        'bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800': vectorizeStore.progress.status === 'embedding' || vectorizeStore.progress.status === 'chunking',
        'bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800': vectorizeStore.progress.status === 'skipped',
        'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800': vectorizeStore.progress.status === 'done',
        'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800': vectorizeStore.progress.status === 'error'
      }">
      <div class="flex items-center justify-between mb-2">
        <span class="text-sm font-medium">{{ vectorizeStore.progress.message }}</span>
        <span class="text-xs text-text-secondary">
          {{ vectorizeStore.progress.status === 'done' ? '完成' : vectorizeStore.progress.status === 'skipped' ? '已跳过' : vectorizeStore.progress.status === 'error' ? '失败' : '' }}
        </span>
      </div>
      <div v-if="vectorizeStore.progress.total > 0 && vectorizeStore.progress.status !== 'done' && vectorizeStore.progress.status !== 'skipped'" class="w-full bg-surface-2 rounded-full h-2">
        <div class="bg-primary-500 h-2 rounded-full transition-all duration-300"
          :style="{ width: `${Math.round((vectorizeStore.progress.current / vectorizeStore.progress.total) * 100)}%` }">
        </div>
      </div>
      <!-- 错误状态下重定向行动提示（能量不足 / 未配置等） -->
      <div v-if="vectorizeStore.progress.status === 'error' && progressAction" class="mt-2">
        <router-link
          v-if="progressAction === 'purchase'"
          to="/plans-store"
          class="text-xs font-medium text-primary-600 hover:text-primary-700"
        >购买套餐 →</router-link>
        <button
          v-if="progressAction === 'settings'"
          type="button"
          class="text-xs font-medium text-primary-600 hover:text-primary-700"
          @click="openSettingsConnection"
        >去设置 →</button>
      </div>
    </div>

    <!-- Stats Content -->
    <div class="flex-1 overflow-y-auto p-6">
      <!-- Summary Cards -->
      <div class="grid grid-cols-5 gap-4 mb-6">
        <div class="card p-4 text-center">
          <div class="text-2xl font-bold text-primary-600">{{ totalDocs }}</div>
          <div class="text-xs text-text-secondary mt-1">总文档数</div>
        </div>
        <div class="card p-4 text-center">
          <div class="text-2xl font-bold text-green-600 dark:text-green-400">{{ readyDocs }}</div>
          <div class="text-xs text-text-secondary mt-1">已向量化</div>
        </div>
        <div class="card p-4 text-center">
          <div class="text-2xl font-bold text-amber-600 dark:text-amber-400">{{ pendingDocs }}</div>
          <div class="text-xs text-text-secondary mt-1">待处理</div>
        </div>
        <div class="card p-4 text-center">
          <div class="text-2xl font-bold text-amber-600 dark:text-amber-400">{{ unvectorizableDocs }}</div>
          <div class="text-xs text-text-secondary mt-1">无法向量化</div>
        </div>
        <div class="card p-4 text-center">
          <div class="text-2xl font-bold text-red-600 dark:text-red-400">{{ errorDocs }}</div>
          <div class="text-xs text-text-secondary mt-1">处理失败</div>
        </div>
      </div>

      <!-- Category Table -->
      <div class="card overflow-hidden">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-surface-3 bg-surface-1">
              <th class="text-left px-5 py-3 font-medium text-text-secondary">分类名称</th>
              <th class="text-center px-4 py-3 font-medium text-text-secondary">文档数</th>
              <th class="text-center px-4 py-3 font-medium text-text-secondary">已就绪</th>
              <th class="text-center px-4 py-3 font-medium text-text-secondary">待处理</th>
              <th class="text-center px-4 py-3 font-medium text-text-secondary">无法向量化</th>
              <th class="text-center px-4 py-3 font-medium text-text-secondary">失败</th>
              <th class="text-center px-4 py-3 font-medium text-text-secondary">分块数</th>
              <th class="text-center px-4 py-3 font-medium text-text-secondary">已向量化</th>
              <th class="text-center px-4 py-3 font-medium text-text-secondary">Token 总数</th>
              <th class="text-right px-5 py-3 font-medium text-text-secondary">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="cat in vectorizeStore.stats" :key="cat.category_id"
              class="border-b border-surface-3 last:border-0 hover:bg-surface-1 transition-colors">
              <td class="px-5 py-3 font-medium text-text-primary">
                <div class="flex items-center gap-2">
                  <svg class="w-5 h-5 text-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" /></svg>
                  {{ cat.category_name }}
                </div>
              </td>
              <td class="text-center px-4 py-3 text-text-secondary">{{ cat.total_docs }}</td>
              <td class="text-center px-4 py-3">
                <span class="status-badge status-active">{{ cat.ready_docs }}</span>
              </td>
              <td class="text-center px-4 py-3">
                <span v-if="cat.pending_docs > 0" class="status-badge status-warning">{{ cat.pending_docs }}</span>
                <span v-else class="text-text-tertiary">0</span>
              </td>
              <td class="text-center px-4 py-3">
                <span v-if="cat.unvectorizable_docs > 0" class="status-badge status-warning">{{ cat.unvectorizable_docs }}</span>
                <span v-else class="text-text-tertiary">0</span>
              </td>
              <td class="text-center px-4 py-3">
                <span v-if="cat.error_docs > 0" class="status-badge status-error">{{ cat.error_docs }}</span>
                <span v-else class="text-text-tertiary">0</span>
              </td>
              <td class="text-center px-4 py-3 text-text-secondary">{{ cat.total_chunks }}</td>
              <td class="text-center px-4 py-3 text-text-secondary">{{ cat.embedded_chunks }}</td>
              <td class="text-center px-4 py-3 text-text-secondary">{{ cat.total_tokens.toLocaleString() }}</td>
              <td class="text-right px-5 py-3">
                <div class="flex items-center justify-end gap-1.5">
                  <button
                    v-if="cat.pending_docs > 0 || cat.error_docs > 0"
                    class="btn-primary text-xs px-3 py-1"
                    :disabled="vectorizeStore.vectorizing"
                    @click="handleVectorizeCategory(cat.category_id)"
                  >
                    增量向量化
                  </button>
                  <span v-else class="text-xs text-text-tertiary">已完成</span>
                  <button
                    class="btn-secondary text-xs px-3 py-1"
                    :disabled="vectorizeStore.vectorizing"
                    @click="handleResetCategory(cat.category_id)"
                  >
                    重置
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="!vectorizeStore.stats.length" class="p-12 text-center text-text-tertiary">
          <div class="w-12 h-12 mx-auto mb-3 rounded-xl bg-surface-2 flex items-center justify-center">
            <svg class="w-6 h-6 text-text-disabled" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" /></svg>
          </div>
          <p>暂无知识库分类数据</p>
          <router-link to="/knowledge" class="text-primary-500 hover:underline text-sm mt-2 inline-block">前往创建知识库</router-link>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useVectorizeStore } from '@/stores/vectorize'
import { useCloudAuthStore } from '@/stores/cloud-auth'
import { useSettingsUiStore } from '@/stores/settings-ui'

const settingsUi = useSettingsUiStore()
function openSettingsConnection() {
  settingsUi.show('connection')
}

const vectorizeStore = useVectorizeStore()
const cloudAuth = useCloudAuthStore()

const totalDocs = computed(() => vectorizeStore.stats.reduce((s, c) => s + c.total_docs, 0))
const readyDocs = computed(() => vectorizeStore.stats.reduce((s, c) => s + c.ready_docs, 0))
const pendingDocs = computed(() => vectorizeStore.stats.reduce((s, c) => s + c.pending_docs, 0))
const unvectorizableDocs = computed(() => vectorizeStore.stats.reduce((s, c) => s + (c.unvectorizable_docs || 0), 0))
const errorDocs = computed(() => vectorizeStore.stats.reduce((s, c) => s + c.error_docs, 0))

// === 状态探测：模型变更 / 云端余额 / 未配置 ===
const mismatchInfo = ref<{
  mismatch: boolean
  reason: string
  current?: { model: string; source: 'cloud' | 'local' }
  legacy?: Array<{ model: string; dim: number; source: string; chunk_count: number }>
  totalChunks: number
} | null>(null)
const cloudEmbeddingState = ref<{
  models: Array<{ id: number; model_id: string; name: string }>
  active: string
  allowCustomEmbedding: boolean
} | null>(null)
const configError = ref<string | null>(null)

async function refreshState() {
  try {
    mismatchInfo.value = await window.api.vectorize.checkModelMismatch()
  } catch {
    mismatchInfo.value = null
  }
  try {
    cloudEmbeddingState.value = await window.api.cloud.getEmbeddingState()
  } catch {
    cloudEmbeddingState.value = null
  }
  // 探测当前生效配置能否走通（未配置本地且未登录 / 未含云端模型等）
  configError.value = null
  try {
    const all = (await window.api.settings.invoke('getAll')) as Record<string, string>
    const source = (all['vector_source'] || '').trim()
    const isCloud = source === 'cloud' || (cloudAuth.isLoggedIn && !cloudAuth.permissions.allow_custom_embedding)
    if (isCloud) {
      // 云端模式：检查是否有可用模型
      if (cloudEmbeddingState.value && cloudEmbeddingState.value.models.length === 0) {
        configError.value = 'NO_CLOUD_MODEL'
      }
    } else {
      // 本地模式：检查 api_base
      if (!all['vector_api_base']) {
        configError.value = 'NOT_CONFIGURED'
      }
    }
  } catch {
    /* 忽略 */
  }
}

// Banner 状态机：优先级 未配置 > 无云端模型 > 模型变更 > 仅某些分类未完成
const banner = computed<{
  title: string
  detail?: string
  level: 'red' | 'yellow' | 'gray'
  action?: 'purchase' | 'settings' | 'reembed'
} | null>(() => {
  if (configError.value === 'NO_CLOUD_MODEL') {
    return {
      title: '您的套餐未包含向量模型',
      detail: '购买含向量模型的套餐后可使用云端向量服务',
      level: 'red',
      action: 'purchase',
    }
  }
  if (configError.value === 'NOT_CONFIGURED') {
    return {
      title: '向量服务未配置',
      detail: '请在设置中填入本地向量服务的 API 地址与密钥',
      level: 'gray',
      action: 'settings',
    }
  }
  if (mismatchInfo.value?.mismatch) {
    const cur = mismatchInfo.value.current
    const legacy = mismatchInfo.value.legacy?.[0]
    const detail = legacy && cur
      ? `旧数据使用 ${legacy.source || '未知'} / ${legacy.model || '旧版本未记录'}${legacy.dim ? ` (${legacy.dim} 维)` : ''}，当前生效 ${cur.source} / ${cur.model}。向量空间不兼容，需重向量化后才能召回`
      : '检测到向量模型变更，需重向量化后才能召回'
    return {
      title: '向量模型已变更',
      detail,
      level: 'yellow',
      action: 'reembed',
    }
  }
  return null
})

const bannerClass = computed(() => {
  if (!banner.value) return ''
  switch (banner.value.level) {
    case 'red': return 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800'
    case 'yellow': return 'bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800'
    case 'gray': return 'bg-surface-1 border-surface-3'
    default: return ''
  }
})
const bannerIconClass = computed(() => {
  if (!banner.value) return ''
  switch (banner.value.level) {
    case 'red': return 'text-red-600 dark:text-red-400'
    case 'yellow': return 'text-amber-600 dark:text-amber-400'
    case 'gray': return 'text-text-tertiary'
    default: return ''
  }
})
const bannerTitleClass = computed(() => {
  if (!banner.value) return ''
  switch (banner.value.level) {
    case 'red': return 'text-red-800 dark:text-red-300'
    case 'yellow': return 'text-amber-800 dark:text-amber-300'
    case 'gray': return 'text-text-primary'
    default: return ''
  }
})
const bannerSubClass = computed(() => {
  if (!banner.value) return ''
  switch (banner.value.level) {
    case 'red': return 'text-red-700 dark:text-red-400'
    case 'yellow': return 'text-amber-700 dark:text-amber-400'
    case 'gray': return 'text-text-secondary'
    default: return ''
  }
})

const canVectorize = computed(() => !configError.value)
const actionHint = computed(() => {
  if (configError.value === 'NO_CLOUD_MODEL') return '套餐未包含向量模型，请先购买'
  if (configError.value === 'NOT_CONFIGURED') return '请先在设置中配置向量服务'
  return ''
})

// 进度错误中的结构化 errorCode → 行动跳转
const progressAction = computed<'purchase' | 'settings' | null>(() => {
  const code = vectorizeStore.progress?.errorCode
  if (!code) return null
  if (code === 'INSUFFICIENT_BALANCE' || code === 'NO_CLOUD_MODEL' || code === 'UNAUTHORIZED') return 'purchase'
  if (code === 'NOT_CONFIGURED') return 'settings'
  return null
})

async function handleVectorizeAll() {
  try {
    await vectorizeStore.vectorizeAll()
    await refreshState()
  } catch (e: any) {
    // 错误已由进度 banner 呈现，仅补充刷新
    await refreshState()
    if (!progressAction.value) {
      alert('向量化失败: ' + (e?.message || e))
    }
  }
}

async function handleVectorizeCategory(categoryId: string) {
  try {
    await vectorizeStore.vectorizeCategory(categoryId)
    await refreshState()
  } catch (e: any) {
    await refreshState()
    if (!progressAction.value) {
      alert('向量化失败: ' + (e?.message || e))
    }
  }
}

async function handleResetCategory(categoryId: string) {
  try {
    await vectorizeStore.resetCategory(categoryId)
    await refreshState()
  } catch (e: any) {
    alert('重置失败: ' + (e?.message || e))
  }
}

async function handleReembedAll() {
  if (!confirm('将清空所有已有向量并重新生成，耗时较长，继续？')) return
  try {
    await vectorizeStore.reembedAll()
    await refreshState()
  } catch (e: any) {
    await refreshState()
    if (!progressAction.value) {
      alert('重新向量化失败: ' + (e?.message || e))
    }
  }
}

// 权限变更 → 刷新状态
watch(
  () => [cloudAuth.isLoggedIn, cloudAuth.permissions.allow_custom_embedding],
  () => refreshState(),
)

onMounted(async () => {
  await vectorizeStore.fetchStats()
  await refreshState()
})
</script>
