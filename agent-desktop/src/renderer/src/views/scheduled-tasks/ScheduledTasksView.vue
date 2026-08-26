<template>
  <div class="h-full flex flex-col bg-surface-0">
    <header class="flex-shrink-0 px-6 pt-5 pb-4 border-b border-surface-2">
      <div class="flex items-start gap-4">
        <div class="flex-1 min-w-0">
          <h1 class="text-lg font-semibold text-text-primary">自动化</h1>
          <p class="text-xs text-text-tertiary mt-1.5 leading-relaxed">
            按计划自动执行。后续会加入更多能力。
          </p>
        </div>
        <button
          type="button"
          class="px-4 py-2 text-sm font-medium text-white rounded-full bg-primary-600 hover:bg-primary-700 transition-colors"
          @click="openCreate"
        >+ 新建任务</button>
      </div>

      <div class="mt-4 inline-flex p-0.5 rounded-full bg-surface-1">
        <button
          type="button"
          class="px-3 py-1.5 text-xs rounded-full transition-colors"
          :class="tab === 'runs' ? 'bg-surface-0 text-text-primary font-medium shadow-sm' : 'text-text-secondary'"
          @click="tab = 'runs'"
        >执行</button>
        <button
          type="button"
          class="px-3 py-1.5 text-xs rounded-full transition-colors"
          :class="tab === 'tasks' ? 'bg-surface-0 text-text-primary font-medium shadow-sm' : 'text-text-secondary'"
          @click="tab = 'tasks'"
        >任务</button>
      </div>
    </header>

    <div class="flex-1 min-h-0 flex">
      <!-- 列表 -->
      <aside class="w-60 flex-shrink-0 border-r border-surface-2 bg-surface-0 overflow-y-auto">
        <template v-if="tab === 'runs'">
          <button
            v-for="run in runs"
            :key="run.id"
            type="button"
            class="w-full text-left px-4 py-3 border-b border-surface-3 hover:bg-surface-2 transition-colors"
            :class="selectedRunId === run.id ? 'bg-surface-2' : ''"
            @click="selectedRunId = run.id"
          >
            <div class="flex items-center gap-2">
              <span
                class="text-[10px] px-1.5 py-0.5 rounded font-medium"
                :class="runStatusClass(run.status)"
              >{{ runStatusLabel(run.status) }}</span>
              <span class="text-xs font-medium text-text-primary truncate">{{ run.task_title || '任务' }}</span>
            </div>
            <div class="text-[10px] text-text-tertiary mt-1">{{ formatTime(run.started_at) }}</div>
          </button>
          <div v-if="!runs.length" class="px-4 py-10 text-center text-xs text-text-tertiary">
            还没有执行记录
          </div>
        </template>

        <template v-else>
          <button
            v-for="task in tasks"
            :key="task.id"
            type="button"
            class="w-full text-left px-4 py-3 border-b border-surface-3 hover:bg-surface-2 transition-colors"
            :class="selectedTaskId === task.id ? 'bg-surface-2' : ''"
            @click="selectedTaskId = task.id"
          >
            <div class="flex items-center gap-2">
              <span
                class="w-1.5 h-1.5 rounded-full flex-shrink-0"
                :class="task.enabled ? 'bg-primary-600' : 'bg-surface-3'"
              />
              <span class="text-xs font-medium text-text-primary truncate">{{ task.title }}</span>
            </div>
            <div class="text-[10px] text-text-tertiary mt-1 truncate">
              {{ describe(task) }}
              <span v-if="task.next_run_at"> · 下次 {{ formatTime(task.next_run_at) }}</span>
            </div>
          </button>
          <div v-if="!tasks.length" class="px-4 py-10 text-center text-xs text-text-tertiary">
            还没有任务，点击右上角新建
          </div>
        </template>
      </aside>

      <!-- 详情 / 空态 -->
      <main class="flex-1 min-w-0 overflow-y-auto px-8 py-8">
        <template v-if="tab === 'runs'">
          <div v-if="!selectedRun" class="h-full flex flex-col items-center justify-center text-text-tertiary">
            <svg class="w-14 h-14 mb-3 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <circle cx="12" cy="12" r="10" stroke-width="1.5" />
              <path stroke-width="1.5" stroke-linecap="round" d="M12 6v6l4 2" />
            </svg>
            <p class="text-sm">还没有执行记录</p>
          </div>
          <div v-else class="max-w-2xl mx-auto space-y-4">
            <div class="flex items-start justify-between gap-3">
              <div>
                <h2 class="text-base font-semibold text-text-primary">{{ selectedRun.task_title || '执行结果' }}</h2>
                <p class="text-[11px] text-text-tertiary mt-1">
                  {{ formatTime(selectedRun.started_at) }}
                  <span v-if="selectedRun.finished_at"> · 完成于 {{ formatTime(selectedRun.finished_at) }}</span>
                </p>
              </div>
              <span class="text-[10px] px-1.5 py-0.5 rounded font-medium" :class="runStatusClass(selectedRun.status)">
                {{ runStatusLabel(selectedRun.status) }}
              </span>
            </div>
            <div
              v-if="selectedRun.status === 'error'"
              class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
            >{{ selectedRun.error || '执行失败' }}</div>
            <div
              v-else-if="selectedRun.status === 'running'"
              class="text-sm text-text-secondary"
            >执行中…</div>
            <div
              v-else
              class="rounded-2xl bg-surface-0 border border-surface-3 px-5 py-4 text-sm prose prose-sm dark:prose-invert max-w-none leading-relaxed select-text"
              v-html="renderMarkdown(selectedRun.content || '（无内容）')"
            />
          </div>
        </template>

        <template v-else>
          <div v-if="!selectedTask" class="h-full flex flex-col items-center justify-center text-text-tertiary">
            <svg class="w-14 h-14 mb-3 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <circle cx="12" cy="12" r="10" stroke-width="1.5" />
              <path stroke-width="1.5" stroke-linecap="round" d="M12 6v6l4 2" />
            </svg>
            <p class="text-sm">选择左侧任务查看详情</p>
          </div>
          <div v-else class="max-w-2xl mx-auto space-y-5">
            <div class="flex items-start justify-between gap-3">
              <div>
                <h2 class="text-base font-semibold text-text-primary">{{ selectedTask.title }}</h2>
                <p class="text-[11px] text-text-tertiary mt-1">{{ describe(selectedTask) }}</p>
              </div>
              <div class="flex items-center gap-2 flex-shrink-0">
                <button
                  type="button"
                  class="px-3 py-1.5 text-xs rounded-lg border border-surface-3 text-text-secondary hover:bg-surface-2 disabled:opacity-50"
                  :disabled="busyId === selectedTask.id"
                  @click="runNow(selectedTask.id)"
                >{{ busyId === selectedTask.id ? '执行中…' : '立即执行' }}</button>
                <button
                  type="button"
                  class="px-3 py-1.5 text-xs rounded-lg border border-surface-3 text-text-secondary hover:bg-surface-2"
                  @click="toggleEnabled(selectedTask)"
                >{{ selectedTask.enabled ? '暂停' : '启用' }}</button>
                <button
                  type="button"
                  class="px-3 py-1.5 text-xs rounded-lg text-red-600 hover:bg-red-50"
                  @click="removeTask(selectedTask.id)"
                >删除</button>
              </div>
            </div>

            <div class="rounded-xl border border-surface-3 bg-surface-0 p-4 space-y-2 text-xs">
              <div class="flex justify-between gap-3">
                <span class="text-text-tertiary">工作区</span>
                <span class="text-text-primary truncate">{{ workspaceName(selectedTask.workspace_id) }}</span>
              </div>
              <div class="flex justify-between gap-3">
                <span class="text-text-tertiary">下次执行</span>
                <span class="text-text-primary">{{ selectedTask.next_run_at ? formatTime(selectedTask.next_run_at) : '—' }}</span>
              </div>
              <div class="flex justify-between gap-3">
                <span class="text-text-tertiary">上次执行</span>
                <span class="text-text-primary">{{ selectedTask.last_run_at ? formatTime(selectedTask.last_run_at) : '—' }}</span>
              </div>
              <div class="flex justify-between gap-3">
                <span class="text-text-tertiary">Skill</span>
                <span class="text-text-primary truncate">{{ skillName(selectedTask.skill_dir) || '—' }}</span>
              </div>
              <div class="flex justify-between gap-3">
                <span class="text-text-tertiary">模型</span>
                <span class="text-text-primary truncate">{{ selectedTask.model_id || '未设置' }}</span>
              </div>
              <div v-if="selectedTask.intra_repeat" class="flex justify-between gap-3">
                <span class="text-text-tertiary">周期内重复</span>
                <span class="text-text-primary">至 {{ selectedTask.intra_end || '—' }} · 每 {{ selectedTask.intra_interval_min || 60 }} 分钟</span>
              </div>
            </div>

            <div>
              <div class="text-xs font-medium text-text-secondary mb-2">任务说明</div>
              <pre class="whitespace-pre-wrap text-sm text-text-primary bg-surface-0 border border-surface-3 rounded-xl px-4 py-3 leading-relaxed">{{ selectedTask.prompt }}</pre>
            </div>
          </div>
        </template>
      </main>
    </div>

    <!-- 新建弹层（对齐 NewMax：工作区 + 重复规则 + Skill） -->
    <div
      v-if="showCreate"
      class="fixed inset-0 z-[90] flex items-center justify-center p-6"
      role="dialog"
      aria-modal="true"
    >
      <div class="absolute inset-0 bg-black/35" @click="showCreate = false" />
      <div class="relative w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl bg-surface-0 border border-surface-3 shadow-2xl p-6 space-y-4">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h3 class="text-base font-semibold text-text-primary">新建自动化</h3>
            <p class="text-[11px] text-text-tertiary mt-1 leading-relaxed">
              配置任务名称、执行时间和重复规则。
              <span class="text-text-secondary">不想手动配置？可通过对话一步步创建（后续接入）。</span>
            </p>
          </div>
          <button type="button" class="p-1 text-text-tertiary hover:text-text-primary" @click="showCreate = false">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18 18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div>
          <label class="form-label">任务名称 <span class="text-red-500">*</span></label>
          <input v-model="form.title" class="input-field" placeholder="例如：每日代码审查" />
        </div>
        <div>
          <label class="form-label">执行提示词 <span class="text-red-500">*</span></label>
          <textarea
            v-model="form.prompt"
            rows="4"
            class="input-field resize-y"
            placeholder="输入将执行的任务描述…"
          />
        </div>
        <div>
          <label class="form-label">执行工作区 <span class="text-red-500">*</span></label>
          <select v-model="form.workspaceId" class="select-field">
            <option v-for="ws in workspaces" :key="ws.id" :value="ws.id">{{ ws.name }}</option>
          </select>
          <p v-if="activeWorkspacePath" class="text-[10px] text-text-tertiary mt-1 font-mono truncate">{{ activeWorkspacePath }}</p>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="form-label">重复类型</label>
            <div class="inline-flex w-full p-0.5 rounded-lg bg-surface-1">
              <button
                v-for="opt in repeatOptions"
                :key="opt.value"
                type="button"
                class="flex-1 px-2 py-1.5 text-xs rounded-md transition-colors"
                :class="form.scheduleType === opt.value ? 'bg-surface-0 text-text-primary font-medium shadow-sm' : 'text-text-secondary'"
                @click="form.scheduleType = opt.value"
              >{{ opt.label }}</button>
            </div>
          </div>
          <div>
            <label class="form-label">执行时间</label>
            <input
              v-if="form.scheduleType === 'once'"
              v-model="form.scheduleValue"
              type="datetime-local"
              class="input-field"
            />
            <input
              v-else
              v-model="form.timeOfDay"
              type="time"
              class="input-field"
            />
          </div>
        </div>

        <div v-if="form.scheduleType === 'weekly'">
          <label class="form-label">每周几</label>
          <select v-model.number="form.weekday" class="select-field">
            <option v-for="(label, i) in weekdayLabels" :key="i" :value="i">{{ label }}</option>
          </select>
        </div>

        <div class="rounded-xl border border-surface-2 px-3 py-2.5 space-y-2">
          <div class="flex items-center justify-between gap-3">
            <div>
              <div class="text-xs font-medium text-text-primary">周期内重复</div>
              <div class="text-[10px] text-text-tertiary mt-0.5">开启后在「执行时间—结束时间」窗口内按间隔多次触发</div>
            </div>
            <button
              type="button"
              class="relative w-10 h-5 rounded-full transition-colors"
              :class="form.intraRepeat ? 'bg-primary-600' : 'bg-surface-3'"
              @click="form.intraRepeat = !form.intraRepeat"
            >
              <span
                class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
                :class="form.intraRepeat ? 'translate-x-5' : ''"
              />
            </button>
          </div>
          <div v-if="form.intraRepeat" class="grid grid-cols-2 gap-2 pt-1">
            <div>
              <label class="form-label">结束时间</label>
              <input v-model="form.intraEnd" type="time" class="input-field" />
            </div>
            <div>
              <label class="form-label">间隔（分钟）</label>
              <input v-model.number="form.intraIntervalMin" type="number" min="1" class="input-field" />
            </div>
          </div>
        </div>

        <div>
          <label class="form-label">启用 Skill</label>
          <select v-model="form.skillDir" class="select-field">
            <option value="">不使用 Skill</option>
            <option v-for="sk in skills" :key="sk.dirName" :value="sk.dirName">{{ sk.name }}</option>
          </select>
        </div>

        <div>
          <label class="form-label">执行模型</label>
          <ChatModelSwitcher
            :provider-id="form.providerId"
            :model-id="form.modelId"
            prefix=""
            direction="down"
            block
            @change="onModelChange"
          />
        </div>

        <div class="flex items-center justify-between gap-3 pt-1">
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="relative w-10 h-5 rounded-full transition-colors"
              :class="form.enabled ? 'bg-primary-600' : 'bg-surface-3'"
              @click="form.enabled = !form.enabled"
            >
              <span
                class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
                :class="form.enabled ? 'translate-x-5' : ''"
              />
            </button>
            <span class="text-xs text-text-secondary">立即启用</span>
          </div>
          <div class="flex gap-2">
            <button type="button" class="btn-secondary" @click="showCreate = false">取消</button>
            <button type="button" class="btn-primary" :disabled="creating" @click="submitCreate">
              {{ creating ? '保存中…' : '保存' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import ChatModelSwitcher from '@/components/ChatModelSwitcher.vue'
import { useAgentWorkspaceStore } from '@/stores/agent-workspaces'
import { useModelStore } from '@/stores/models'
import { usePromptSkillStore } from '@/stores/prompt-skills'
import { useSiteConfigStore } from '@/stores/site-config'
import { renderMarkdown } from '@/utils/markdown'
import { hasCap } from '@/utils/model-caps'

type ScheduleType = 'once' | 'daily' | 'weekly' | 'interval'
type Tab = 'runs' | 'tasks'

interface TaskRow {
  id: string
  title: string
  prompt: string
  schedule_type: ScheduleType
  schedule_value: string
  enabled: number
  provider_id: string
  model_id: string
  workspace_id: string
  skill_dir: string
  intra_repeat: number
  intra_end: string
  intra_interval_min: number
  next_run_at: string
  last_run_at: string
}

interface RunRow {
  id: string
  task_id: string
  task_title: string
  status: 'running' | 'ok' | 'error'
  content: string
  error: string
  started_at: string
  finished_at: string
}

const modelStore = useModelStore()
const siteConfig = useSiteConfigStore()
const workspaceStore = useAgentWorkspaceStore()
const skillStore = usePromptSkillStore()

const tab = ref<Tab>('runs')
const tasks = ref<TaskRow[]>([])
const runs = ref<RunRow[]>([])
const selectedTaskId = ref('')
const selectedRunId = ref('')
const busyId = ref('')
const showCreate = ref(false)
const creating = ref(false)

const repeatOptions = [
  { value: 'once' as const, label: '一次性' },
  { value: 'daily' as const, label: '每天' },
  { value: 'weekly' as const, label: '每周' }
]

const weekdayLabels = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

const form = ref({
  title: '',
  prompt: '',
  workspaceId: '',
  scheduleType: 'daily' as ScheduleType,
  scheduleValue: '',
  timeOfDay: '09:00',
  weekday: 1,
  intraRepeat: false,
  intraEnd: '18:00',
  intraIntervalMin: 60,
  skillDir: '',
  providerId: '',
  modelId: '',
  enabled: true
})

let unsubChanged: (() => void) | null = null

const selectedTask = computed(() => tasks.value.find((t) => t.id === selectedTaskId.value) || null)
const selectedRun = computed(() => runs.value.find((r) => r.id === selectedRunId.value) || null)
const workspaces = computed(() => workspaceStore.items)
const skills = computed(() => skillStore.skills)
const activeWorkspacePath = computed(() => {
  const id = form.value.workspaceId
  const ws = workspaces.value.find((w) => w.id === id)
  return ws?.root_path || ''
})

function workspaceName(id: string): string {
  if (!id) return '—'
  return workspaces.value.find((w) => w.id === id)?.name || id
}

function skillName(dir: string): string {
  if (!dir) return ''
  return skills.value.find((s) => s.dirName === dir)?.name || dir
}

function formatTime(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString()
}

function describe(task: TaskRow): string {
  if (task.schedule_type === 'daily') return `每天 ${task.schedule_value || '09:00'}`
  if (task.schedule_type === 'weekly') {
    const [hm, wd] = (task.schedule_value || '').split('|')
    const day = weekdayLabels[Number(wd)] || '周?'
    return `每${day} ${hm || '09:00'}`
  }
  if (task.schedule_type === 'interval') return `每 ${task.schedule_value || '60'} 分钟`
  const d = new Date(task.schedule_value)
  return Number.isNaN(d.getTime()) ? '一次性' : `一次性 · ${d.toLocaleString()}`
}

function runStatusLabel(s: string): string {
  if (s === 'running') return '执行中'
  if (s === 'error') return '失败'
  return '成功'
}

function runStatusClass(s: string): string {
  if (s === 'running') return 'status-warning'
  if (s === 'error') return 'status-error'
  return 'status-active'
}

function resolveDefaultModel(): { provider_id: string; model_id: string } {
  const cloud = siteConfig.chatDefaultModel
  if (cloud?.provider_id && cloud?.model_id) {
    const candidate =
      cloud.provider_id === 'cloud:default'
        ? modelStore.upgradeToCompositeKey(cloud.model_id)
        : cloud.model_id
    const prov = modelStore.providers.find((p) => p.id === cloud.provider_id)
    const cloudType = modelStore.cloudTypeOf(cloud.provider_id, candidate)
    if (prov && prov.models.includes(candidate) && hasCap(candidate, 'chat', cloudType)) {
      return { provider_id: cloud.provider_id, model_id: candidate }
    }
  }
  for (const p of modelStore.providers) {
    for (const m of p.models) {
      const cloudType = modelStore.cloudTypeOf(p.id, m)
      if (hasCap(m, 'chat', cloudType)) return { provider_id: p.id, model_id: m }
    }
  }
  return { provider_id: '', model_id: '' }
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function toIsoFromLocalInput(local: string): string {
  const d = new Date(local)
  return Number.isNaN(d.getTime()) ? local : d.toISOString()
}

function buildScheduleValue(): string {
  if (form.value.scheduleType === 'once') {
    return toIsoFromLocalInput(form.value.scheduleValue)
  }
  if (form.value.scheduleType === 'weekly') {
    return `${form.value.timeOfDay}|${form.value.weekday}`
  }
  return form.value.timeOfDay || '09:00'
}

async function refresh() {
  const api = (window as any).api?.scheduledTasks
  if (!api?.invoke) {
    throw new Error('自动化服务未加载，请完全退出并重新启动应用（preload 需重启后生效）')
  }
  const [t, r] = await Promise.all([
    api.invoke('list') as Promise<TaskRow[]>,
    api.invoke('listRuns', 100) as Promise<RunRow[]>
  ])
  tasks.value = t || []
  runs.value = r || []
  if (selectedTaskId.value && !tasks.value.some((x) => x.id === selectedTaskId.value)) {
    selectedTaskId.value = tasks.value[0]?.id || ''
  }
  if (selectedRunId.value && !runs.value.some((x) => x.id === selectedRunId.value)) {
    selectedRunId.value = runs.value[0]?.id || ''
  }
  if (!selectedRunId.value && runs.value[0]) selectedRunId.value = runs.value[0].id
  if (!selectedTaskId.value && tasks.value[0]) selectedTaskId.value = tasks.value[0].id
}

function onModelChange(val: { provider_id: string; model_id: string }) {
  form.value.providerId = val.provider_id
  form.value.modelId = val.model_id
}

function openCreate() {
  const def = resolveDefaultModel()
  const d = new Date(Date.now() + 60 * 60_000)
  const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  form.value = {
    title: '',
    prompt: '',
    workspaceId: workspaceStore.activeId || workspaces.value[0]?.id || '',
    scheduleType: 'daily',
    scheduleValue: local,
    timeOfDay: '09:00',
    weekday: 1,
    intraRepeat: false,
    intraEnd: '18:00',
    intraIntervalMin: 60,
    skillDir: '',
    providerId: def.provider_id,
    modelId: def.model_id,
    enabled: true
  }
  showCreate.value = true
}

watch(
  () => form.value.scheduleType,
  (type) => {
    if (type === 'once' && !form.value.scheduleValue) {
      const d = new Date(Date.now() + 60 * 60_000)
      form.value.scheduleValue = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    }
    if ((type === 'daily' || type === 'weekly') && !form.value.timeOfDay) {
      form.value.timeOfDay = '09:00'
    }
  }
)

async function submitCreate() {
  if (!form.value.title.trim()) {
    alert('请填写任务名称')
    return
  }
  if (!form.value.prompt.trim()) {
    alert('请填写执行提示词')
    return
  }
  if (!form.value.workspaceId) {
    alert('请选择执行工作区')
    return
  }
  creating.value = true
  try {
    const row = (await window.api.scheduledTasks.invoke('create', {
      title: form.value.title,
      prompt: form.value.prompt,
      scheduleType: form.value.scheduleType,
      scheduleValue: buildScheduleValue(),
      providerId: form.value.providerId,
      modelId: form.value.modelId,
      workspaceId: form.value.workspaceId,
      skillDir: form.value.skillDir || undefined,
      intraRepeat: form.value.intraRepeat,
      intraEnd: form.value.intraEnd,
      intraIntervalMin: form.value.intraIntervalMin,
      enabled: form.value.enabled
    })) as TaskRow
    showCreate.value = false
    tab.value = 'tasks'
    await refresh()
    if (row?.id) selectedTaskId.value = row.id
  } catch (e: any) {
    alert(e?.message || String(e))
  } finally {
    creating.value = false
  }
}

async function runNow(id: string) {
  busyId.value = id
  try {
    const run = (await window.api.scheduledTasks.invoke('runNow', id)) as RunRow
    await refresh()
    tab.value = 'runs'
    if (run?.id) selectedRunId.value = run.id
  } catch (e: any) {
    alert(e?.message || String(e))
  } finally {
    busyId.value = ''
  }
}

async function toggleEnabled(task: TaskRow) {
  await window.api.scheduledTasks.invoke('update', task.id, { enabled: !task.enabled })
  await refresh()
}

async function removeTask(id: string) {
  if (!confirm('删除该任务及其执行记录？')) return
  await window.api.scheduledTasks.invoke('delete', id)
  selectedTaskId.value = ''
  await refresh()
}

onMounted(async () => {
  if (!modelStore.providers.length) {
    try {
      await modelStore.fetchProviders()
    } catch {
      /* ignore */
    }
  }
  await Promise.all([
    workspaceStore.refresh().catch(() => undefined),
    skillStore.fetchSkills().catch(() => undefined)
  ])
  try {
    await refresh()
  } catch (e: any) {
    alert(e?.message || String(e))
    return
  }
  const api = (window as any).api?.scheduledTasks
  if (api?.onChanged) {
    unsubChanged = api.onChanged(() => {
      void refresh()
    })
  }
})

onUnmounted(() => {
  unsubChanged?.()
  unsubChanged = null
})
</script>
