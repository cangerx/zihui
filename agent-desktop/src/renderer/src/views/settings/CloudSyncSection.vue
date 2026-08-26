<template>
  <section>
    <div class="flex items-center gap-2.5 mb-4">
      <div class="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center">
        <svg class="w-4 h-4 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
            d="M2.25 15a4.5 4.5 0 0 0 4.5 4.5H18a3.75 3.75 0 0 0 1.332-7.257 3 3 0 0 0-3.758-3.848 5.25 5.25 0 0 0-10.233 2.33A4.502 4.502 0 0 0 2.25 15Z" />
        </svg>
      </div>
      <h2 class="text-sm font-semibold text-text-primary">云同步</h2>
    </div>

    <div class="form-card">
      <!-- 容量 -->
      <div>
        <QuotaProgressBar
          label="云存储空间"
          :used="quota.used"
          :total="quota.total"
          :remaining="Math.max(0, quota.total - quota.used)"
        />
        <p class="text-[11px] text-text-tertiary mt-1.5">
          已用 {{ formatBytes(quota.used) }} / {{ quota.total > 0 ? formatBytes(quota.total) : '未开通' }}
          <span v-if="quota.total > 0 && quota.used >= quota.total" class="text-red-500 ml-1">
            空间已满，新数据将暂停上传，可在用户中心购买存储扩容
          </span>
        </p>
      </div>

      <!-- 频率 + 冲突策略 -->
      <div class="flex items-center gap-4">
        <div class="flex-1">
          <label class="form-label">自动同步</label>
          <select v-model="form.mode" @change="onModeChange" class="select-field">
            <option value="off">关闭（仅手动）</option>
            <option value="realtime">实时（变更后自动）</option>
            <option value="hourly">每小时</option>
            <option value="daily">每天</option>
          </select>
        </div>
        <div class="flex-1">
          <label class="form-label">冲突处理</label>
          <select v-model="form.conflict" @change="saveConfig" class="select-field">
            <option value="merge">智能融合</option>
            <option value="local">以本机为准</option>
            <option value="cloud">以云端为准</option>
          </select>
        </div>
      </div>

      <!-- 同步范围 -->
      <div>
        <label class="form-label">同步范围</label>
        <div class="flex items-center gap-4 text-xs text-text-secondary">
          <label class="flex items-center gap-1.5 opacity-70">
            <input type="checkbox" checked disabled />
            <span>纯数据（专家/对话/人设/工具/模型）</span>
          </label>
          <label class="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" v-model="form.scope.image" @change="saveConfig" />
            <span>图片</span>
          </label>
          <label class="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" v-model="form.scope.video" @change="saveConfig" />
            <span>视频</span>
          </label>
        </div>
        <p class="text-[11px] text-text-tertiary mt-1.5">
          纯数据始终同步。图片 / 视频按需上传，不勾选则仅在其它设备需要时占位、暂不传输。
        </p>
      </div>

      <!-- 操作 -->
      <div class="flex items-center gap-2 pt-2 flex-wrap">
        <button class="btn-primary" :disabled="running" @click="syncNow">
          {{ running ? '同步中…' : '立即同步' }}
        </button>
        <button v-if="conflictCount > 0" class="btn-secondary" @click="openConflicts">
          查看冲突（{{ conflictCount }}）
        </button>
        <span v-if="message" :class="['text-xs font-medium', messageOk ? 'text-emerald-600' : 'text-red-500']">
          {{ message }}
        </span>
      </div>

      <!-- 进度 -->
      <div v-if="running && progress" class="pt-3 border-t border-surface-3">
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-xs text-text-secondary font-medium">{{ phaseLabel(progress.phase) }}</span>
          <span class="text-[11px] text-text-tertiary">{{ progress.current }} / {{ progress.total }}</span>
        </div>
        <div class="h-1.5 bg-surface-2 rounded-full overflow-hidden">
          <div
            class="h-full bg-primary-500 transition-all duration-200"
            :style="{ width: progressPercent + '%' }"
          ></div>
        </div>
        <p class="text-[11px] text-text-tertiary mt-1 truncate">{{ progress.message }}</p>
      </div>

      <!-- 状态 -->
      <div class="text-[11px] text-text-tertiary pt-2 border-t border-surface-3 flex items-center gap-4 flex-wrap">
        <span>上次同步：{{ lastSyncText }}</span>
        <span>待同步：{{ pendingChanges }} 项</span>
        <span v-if="localStats.count > 0">本机媒体缓存：{{ localStats.count }} 个 / {{ formatBytes(localStats.bytes) }}</span>
      </div>
    </div>

    <!-- 首次开启隐私授权（仅阴影，无遮罩） -->
    <div v-if="showConsent" class="fixed inset-0 z-[9700] flex items-center justify-center p-6 pointer-events-none">
      <div class="pointer-events-auto w-full max-w-md bg-surface-0 border border-surface-3 rounded-2xl shadow-2xl p-6">
        <h3 class="text-sm font-semibold text-text-primary mb-2">开启云同步</h3>
        <p class="text-xs text-text-secondary leading-relaxed">
          开启后，本账号的专家、对话记录、人设规则、自定义模型、小工具，以及你勾选的图片 / 视频，
          将加密上传到云端，用于多设备同步与备份。占用云存储空间，超出套餐容量需购买扩容。
          你可随时关闭并改为仅手动同步。
        </p>
        <div class="flex justify-end gap-2 mt-5">
          <button class="btn-secondary" @click="cancelConsent">取消</button>
          <button class="btn-primary" @click="acceptConsent">同意并开启</button>
        </div>
      </div>
    </div>

    <!-- 冲突列表（仅阴影，无遮罩） -->
    <div v-if="showConflicts" class="fixed inset-0 z-[9700] flex items-center justify-center p-6 pointer-events-none">
      <div class="pointer-events-auto w-full max-w-lg bg-surface-0 border border-surface-3 rounded-2xl shadow-2xl flex flex-col max-h-[70vh]">
        <div class="p-5 border-b border-surface-3 flex items-center justify-between">
          <h3 class="text-sm font-semibold text-text-primary">同步冲突</h3>
          <button class="text-text-tertiary hover:text-text-primary text-xs" @click="showConflicts = false">关闭</button>
        </div>
        <div class="p-5 overflow-y-auto space-y-3">
          <p v-if="conflicts.length === 0" class="text-xs text-text-tertiary">暂无冲突记录。</p>
          <div v-for="c in conflicts" :key="c.id" class="rounded-lg bg-surface-1 border border-surface-3 p-3">
            <div class="text-xs text-text-secondary font-medium">
              {{ entityLabel(c.entity) }} · 字段 {{ c.field }}
            </div>
            <div class="text-[11px] text-text-tertiary mt-1">
              处理：{{ c.resolution === 'remote' ? '采用云端' : c.resolution === 'local' ? '保留本机' : '已记录' }}
            </div>
            <div class="text-[11px] text-text-tertiary mt-1 truncate">本机：{{ c.local_value }}</div>
            <div class="text-[11px] text-text-tertiary truncate">云端：{{ c.remote_value }}</div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import QuotaProgressBar from '@/components/QuotaProgressBar.vue'

interface Quota {
  used: number
  base_quota: number
  extra_quota: number
  total: number
  percent: number
}

const CONSENT_KEY = 'cloud_sync_consent'

const form = reactive({
  mode: 'off' as 'off' | 'realtime' | 'hourly' | 'daily',
  conflict: 'merge' as 'merge' | 'local' | 'cloud',
  scope: { image: true, video: true },
})

const quota = reactive<Quota>({ used: 0, base_quota: 0, extra_quota: 0, total: 0, percent: 0 })
const running = ref(false)
const progress = ref<{ phase: string; current: number; total: number; message: string } | null>(null)
const message = ref('')
const messageOk = ref(true)
const lastSyncAt = ref(0)
const pendingChanges = ref(0)
const conflictCount = ref(0)
const localStats = reactive({ count: 0, bytes: 0, uploaded: 0 })

const showConsent = ref(false)
const showConflicts = ref(false)
const conflicts = ref<any[]>([])
let pendingMode: typeof form.mode = 'off'

let offProgress: (() => void) | null = null
let offStatus: (() => void) | null = null

const progressPercent = computed(() => {
  if (!progress.value || progress.value.total <= 0) return running.value ? 5 : 0
  return Math.min(100, Math.round((progress.value.current / progress.value.total) * 100))
})

const lastSyncText = computed(() => {
  if (!lastSyncAt.value) return '从未'
  const d = new Date(lastSyncAt.value)
  return d.toLocaleString()
})

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function phaseLabel(phase: string): string {
  const map: Record<string, string> = {
    pull: '拉取云端变更',
    merge: '合并数据',
    upload: '上传媒体',
    push: '提交本机变更',
    reconcile: '校对',
    done: '完成',
    error: '出错',
    idle: '空闲',
  }
  return map[phase] || phase
}

function entityLabel(entity: string): string {
  const map: Record<string, string> = {
    bots: '专家',
    personas: '人设规则',
    conversations: '会话',
    messages: '消息',
    skills: '小工具',
    mcp_servers: 'MCP 服务',
    model_providers: '自定义模型',
    canvas_projects: '画布',
    creative_templates: '创意模板',
    prompt_presets: '提示词',
  }
  return map[entity] || entity
}

async function loadConfig() {
  const cfg = await window.api?.sync?.getConfig?.()
  if (cfg) {
    form.mode = cfg.mode
    form.conflict = cfg.conflict
    form.scope.image = cfg.scope?.image !== false
    form.scope.video = cfg.scope?.video !== false
  }
}

async function loadStatus() {
  const s = await window.api?.sync?.status?.()
  if (s) {
    running.value = s.running
    lastSyncAt.value = s.lastSyncAt || 0
    pendingChanges.value = s.pendingChanges || 0
    conflictCount.value = s.conflicts || 0
  }
  const stats = await window.api?.sync?.getLocalStats?.()
  if (stats) Object.assign(localStats, stats)
}

async function loadQuota() {
  const q = await window.api?.sync?.getQuota?.()
  if (q && !q.error) Object.assign(quota, q)
}

async function saveConfig() {
  await window.api?.sync?.setConfig?.({
    mode: form.mode,
    conflict: form.conflict,
    scope: { image: form.scope.image, video: form.scope.video },
  })
}

function onModeChange() {
  if (form.mode !== 'off') {
    const consented = localStorage.getItem(CONSENT_KEY) === '1'
    if (!consented) {
      pendingMode = form.mode
      form.mode = 'off'
      showConsent.value = true
      return
    }
  }
  saveConfig()
  if (form.mode !== 'off') void syncNow()
}

function acceptConsent() {
  localStorage.setItem(CONSENT_KEY, '1')
  form.mode = pendingMode
  showConsent.value = false
  saveConfig()
  void syncNow()
}

function cancelConsent() {
  showConsent.value = false
  form.mode = 'off'
}

async function syncNow() {
  if (running.value) return
  running.value = true
  message.value = ''
  progress.value = { phase: 'pull', current: 0, total: 0, message: '开始同步' }
  try {
    const r = await window.api?.sync?.now?.()
    if (r?.ok) {
      messageOk.value = true
      message.value = '同步完成'
    } else if (r?.error === 'quota_exceeded') {
      messageOk.value = false
      message.value = '云存储空间不足，请购买扩容'
    } else if (r?.error === 'not_logged_in') {
      messageOk.value = false
      message.value = '请先登录'
    } else {
      messageOk.value = false
      message.value = '同步失败：' + (r?.error || '未知错误')
    }
  } catch (e: any) {
    messageOk.value = false
    message.value = '同步失败：' + (e?.message || e)
  } finally {
    running.value = false
    progress.value = null
    await loadStatus()
    await loadQuota()
    setTimeout(() => (message.value = ''), 5000)
  }
}

async function openConflicts() {
  conflicts.value = (await window.api?.sync?.getConflicts?.()) || []
  showConflicts.value = true
  conflictCount.value = 0
}

onMounted(async () => {
  await loadConfig()
  await loadStatus()
  await loadQuota()
  offProgress = window.api?.sync?.onProgress?.((d: any) => {
    progress.value = d
    if (d?.phase === 'done' || d?.phase === 'error') running.value = false
    else running.value = true
  }) || null
  offStatus = window.api?.sync?.onStatus?.((s: any) => {
    if (!s) return
    running.value = s.running
    lastSyncAt.value = s.lastSyncAt || 0
    pendingChanges.value = s.pendingChanges || 0
    conflictCount.value = s.conflicts || 0
  }) || null
})

onUnmounted(() => {
  offProgress?.()
  offStatus?.()
})
</script>
