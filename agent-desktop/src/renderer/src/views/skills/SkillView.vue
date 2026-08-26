<template>
  <div class="h-full flex flex-col">
    <header class="page-header">
      <div class="flex items-center gap-2">
        <button class="btn-primary" @click="openCreate">+ 添加工具</button>
        <button class="btn-secondary" @click="handleExportAll">导出全部</button>
        <label class="btn-secondary cursor-pointer">
          导入
          <input type="file" accept=".json" class="hidden" @change="handleImport" />
        </label>
      </div>
    </header>
    <div class="page-body">

      <!-- Form -->
      <div v-if="showForm" class="max-w-2xl mb-6 form-card">
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="form-label">名称</label>
            <input v-model="form.name" class="input-field" placeholder="例如: 网页搜索" />
          </div>
          <div>
            <label class="form-label">描述</label>
            <input v-model="form.description" class="input-field" placeholder="简要描述小工具的功能" />
          </div>
        </div>
        <div>
          <label class="form-label">函数定义 (JSON)</label>
          <textarea v-model="functionDefStr" rows="6" class="textarea-field font-mono text-xs" placeholder='{"name":"my_skill","description":"...","parameters":{"type":"object","properties":{}}}'></textarea>
        </div>
        <div>
          <label class="form-label">实现代码 (JavaScript)</label>
          <textarea v-model="form.implementation" rows="8" class="textarea-field font-mono text-xs" placeholder="// 可使用 args 参数, fetch, AbortSignal, crypto&#10;// 支持 async/await&#10;return { result: args.input }"></textarea>
        </div>

        <!-- 脱离沙箱白名单开关（内置预设强制留在沙箱内，不显示） -->
        <div v-if="!isEditingBuiltin" class="border border-surface-3 rounded-xl p-4">
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0">
              <label class="form-label mb-1">脱离沙箱运行</label>
              <p class="text-[11px] text-text-tertiary leading-relaxed">
                默认沙箱模式下，工具只能在对话工作区内读写、且禁止危险命令。开启后该工具可读写<span class="text-amber-600 dark:text-amber-400">任意路径的文件、执行任意系统命令</span>。请仅对你完全信任、自己编写的工具开启。开启后每次调用都会强制弹出确认。
              </p>
            </div>
            <button
              type="button"
              role="switch"
              :aria-checked="form.unsandboxed"
              @click="toggleUnsandboxed"
              :class="[
                'relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors',
                form.unsandboxed ? 'bg-amber-500' : 'bg-surface-3'
              ]"
            >
              <span :class="['inline-block h-4 w-4 transform rounded-full bg-white transition-transform', form.unsandboxed ? 'translate-x-4' : 'translate-x-0.5']"></span>
            </button>
          </div>
        </div>

        <!-- Test Panel -->
        <div class="border border-surface-3 rounded-xl overflow-hidden">
          <div class="px-4 py-2.5 bg-surface-2 flex items-center justify-between">
            <span class="text-xs font-medium text-text-secondary">测试面板</span>
            <button @click="runTest" :disabled="testing" class="btn-primary text-xs px-3 py-1">
              {{ testing ? '执行中...' : '运行测试' }}
            </button>
          </div>
          <div class="p-4 space-y-3">
            <div>
              <label class="text-xs text-text-tertiary mb-1 block">测试参数 (JSON)</label>
              <textarea v-model="testArgsStr" rows="3" class="textarea-field font-mono text-xs" placeholder='{"expression": "2 + 3"}'></textarea>
            </div>
            <div v-if="testResult !== null">
              <label class="text-xs text-text-tertiary mb-1 block">
                执行结果
                <span :class="testResult.success ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'" class="ml-2">
                  {{ testResult.success ? 'OK' : 'FAIL' }}
                </span>
                <span class="text-text-disabled ml-2">{{ testResult.duration }}ms</span>
              </label>
              <pre class="text-xs font-mono p-3 rounded-lg bg-surface-2 text-text-primary overflow-auto max-h-40 whitespace-pre-wrap">{{ formatTestOutput(testResult) }}</pre>
            </div>
          </div>
        </div>

        <div class="flex gap-3 pt-2">
          <button @click="saveSkill" class="btn-primary">{{ editingId ? '更新' : '创建' }}</button>
          <button @click="showForm = false" class="btn-secondary">取消</button>
        </div>
      </div>

      <div v-if="visibleSkills.length === 0 && !showForm" class="empty-state">
        <div class="w-16 h-16 rounded-2xl bg-surface-2 flex items-center justify-center mb-4">
          <svg class="w-8 h-8 text-text-disabled" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.049.58.025 1.193-.14 1.743" /></svg>
        </div>
        <p class="text-sm font-medium text-text-secondary mb-1">暂无小工具</p>
        <p class="text-xs text-text-tertiary">点击「+ 添加工具」创建自定义工具扩展专家能力</p>
      </div>

      <div v-else-if="!showForm" class="grid grid-cols-3 gap-3">
        <div v-for="skill in visibleSkills" :key="skill.id" class="card p-4">
          <div class="flex items-start gap-3 mb-3">
            <div class="w-9 h-9 rounded-lg bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center flex-shrink-0">
              <svg class="w-4.5 h-4.5 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" /></svg>
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="font-semibold text-sm text-text-primary truncate">{{ skill.name }}</span>
                <span v-if="skill.is_builtin" class="text-[10px] font-medium px-1.5 py-0.5 rounded bg-primary-50 text-primary-700">内置</span>
                <span v-if="skill.unsandboxed && !skill.is_builtin" class="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-300">脱离沙箱</span>
                <span :class="['status-badge', skill.enabled ? 'status-active' : 'status-inactive']">{{ skill.enabled ? '已启用' : '已禁用' }}</span>
                <span class="text-xs text-text-disabled">v{{ skill.version }}</span>
              </div>
              <div class="text-xs text-text-tertiary mt-0.5 line-clamp-2">{{ skill.description }}</div>
            </div>
          </div>
          <div class="flex gap-1 justify-end border-t border-surface-3 pt-2.5 -mx-1">
            <button @click="toggleSkill(skill)" class="btn-ghost text-xs">{{ skill.enabled ? '禁用' : '启用' }}</button>
            <button @click="editSkill(skill)" class="btn-ghost text-xs">编辑</button>
            <button @click="handleExportOne(skill)" class="btn-ghost text-xs">导出</button>
            <button v-if="!skill.is_builtin" @click="handleDelete(skill)" class="btn-danger text-xs">删除</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useSkillStore, type Skill } from '@/stores/skills'

const CORE_TOOL_NAMES = ['file_ops', 'run_command', 'image_gen', 'browser']

const store = useSkillStore()
const visibleSkills = computed(() =>
  store.skills.filter((s) => !CORE_TOOL_NAMES.includes(s.function_def?.name))
)
const showForm = ref(false)
const editingId = ref<string | null>(null)
// 编辑中的是否为内置预设：内置工具不允许脱离沙箱，对应开关隐藏
const isEditingBuiltin = computed(() => {
  if (!editingId.value) return false
  return !!store.skills.find((s) => s.id === editingId.value)?.is_builtin
})
const form = ref({ name: '', description: '', implementation: '', unsandboxed: false })
const functionDefStr = ref('{}')

const testing = ref(false)
const testArgsStr = ref('{}')
const testResult = ref<{ success: boolean; result?: any; error?: string; duration: number } | null>(null)

function resetForm() {
  form.value = { name: '', description: '', implementation: '', unsandboxed: false }
  functionDefStr.value = '{}'
  testResult.value = null
  testArgsStr.value = '{}'
}

function openCreate() {
  showForm.value = true
  editingId.value = null
  resetForm()
}

function editSkill(skill: Skill) {
  editingId.value = skill.id
  form.value = {
    name: skill.name,
    description: skill.description,
    implementation: skill.implementation,
    unsandboxed: !!skill.unsandboxed
  }
  functionDefStr.value = JSON.stringify(skill.function_def, null, 2)
  testResult.value = null
  testArgsStr.value = '{}'
  showForm.value = true
}

// 打开「脱离沙箱」需二次确认，关闭直接生效
function toggleUnsandboxed() {
  if (!form.value.unsandboxed) {
    const ok = confirm(
      '确定让该工具「脱离沙箱」运行吗？\n\n' +
      '开启后，此工具可读写你电脑上任意路径的文件、执行任意系统命令，不再受工作区限制。\n' +
      '请仅对你完全信任、自己编写的工具开启。每次调用仍会弹出确认。'
    )
    if (!ok) return
  }
  form.value.unsandboxed = !form.value.unsandboxed
}

async function saveSkill() {
  try {
    let funcDef = {}
    try { funcDef = JSON.parse(functionDefStr.value) } catch {}
    const data = { ...form.value, function_def: funcDef }
    if (editingId.value) {
      await store.updateSkill(editingId.value, data)
    } else {
      await store.createSkill(data)
    }
    showForm.value = false
    resetForm()
  } catch (e: any) {
    console.error('saveSkill error:', e)
    alert('保存失败: ' + (e?.message || e))
  }
}

async function toggleSkill(skill: Skill) {
  await store.updateSkill(skill.id, { enabled: !skill.enabled })
}

async function runTest() {
  testing.value = true
  testResult.value = null
  try {
    testResult.value = await store.testSkill(form.value.implementation, testArgsStr.value)
  } catch (e: any) {
    testResult.value = { success: false, error: e?.message || String(e), duration: 0 }
  } finally {
    testing.value = false
  }
}

function formatTestOutput(r: { success: boolean; result?: any; error?: string }) {
  if (!r.success) return r.error || 'Unknown error'
  try { return JSON.stringify(r.result, null, 2) } catch { return String(r.result) }
}

async function handleDelete(skill: Skill) {
  if (skill.is_builtin) return
  if (!confirm(`确定删除小工具「${skill.name}」吗？删除后使用它的专家将失去该能力。`)) return
  try {
    await store.deleteSkill(skill.id)
  } catch (e: any) {
    alert('删除失败：' + (e?.message || e))
  }
}

async function handleExportAll() {
  if (store.skills.length === 0) return
  const ids = store.skills.map((s) => s.id)
  const data = await store.exportSkills(ids)
  downloadJson(data, 'skills-export.json')
}

async function handleExportOne(skill: Skill) {
  const data = await store.exportSkills([skill.id])
  downloadJson(data, `skill-${skill.name}.json`)
}

function downloadJson(data: any, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

async function handleImport(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    const text = await file.text()
    const data = JSON.parse(text)
    const arr = Array.isArray(data) ? data : [data]
    const result = await store.importSkills(arr)
    // 部分失败不回滚成功项，重名 / 校验失败的条目集中提醒
    if (result.errors.length > 0) {
      const lines = result.errors.map(err => `【${err.name}】${err.reason}`).join('\n')
      alert(`导入完成：成功 ${result.created.length} 个，跳过 ${result.errors.length} 个。\n\n跳过原因：\n${lines}`)
    }
  } catch (err: any) {
    alert('导入失败: ' + (err?.message || err))
  }
  input.value = ''
}

onMounted(() => {
  store.fetchSkills()
})
</script>
