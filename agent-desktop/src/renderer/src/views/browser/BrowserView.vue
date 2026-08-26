<template>
  <div class="h-full flex flex-col bg-surface-0">
    <header class="flex-shrink-0 px-6 pt-5 pb-4 border-b border-surface-2">
      <div class="flex items-start gap-4">
        <div class="flex-1 min-w-0">
          <h1 class="text-lg font-semibold text-text-primary">浏览器</h1>
          <p class="text-xs text-text-tertiary mt-1.5 leading-relaxed">
            独立窗口打开网页，Cookie 按 Profile 隔离。对话里让 AI 用 browser 工具操作（open / click / type / screenshot）；登录和验证码请在窗口里亲手完成。
          </p>
        </div>
        <button
          type="button"
          class="px-4 py-2 text-sm font-medium text-white rounded-full bg-primary-600 hover:bg-primary-700 transition-colors"
          @click="startCreate"
        >+ 新建 Profile</button>
      </div>
    </header>

    <div class="flex-1 min-h-0 flex">
      <aside class="w-60 flex-shrink-0 border-r border-surface-2 overflow-y-auto">
        <button
          v-for="p in profiles"
          :key="p.id"
          type="button"
          class="w-full text-left px-4 py-3 border-b border-surface-3 hover:bg-surface-2 transition-colors"
          :class="selectedId === p.id ? 'bg-surface-2' : ''"
          @click="selectedId = p.id"
        >
          <div class="flex items-center gap-2">
            <span
              class="w-1.5 h-1.5 rounded-full flex-shrink-0"
              :class="statusOf(p.id)?.open ? 'bg-primary-600' : 'bg-surface-3'"
            />
            <span class="text-xs font-medium text-text-primary truncate">{{ p.name }}</span>
            <span v-if="p.builtin" class="ml-auto text-[10px] text-text-tertiary">默认</span>
          </div>
          <div class="text-[10px] text-text-tertiary mt-1 truncate">
            {{ statusOf(p.id)?.open ? (statusOf(p.id)?.title || statusOf(p.id)?.url || '已打开') : '未打开' }}
          </div>
        </button>
        <div v-if="!profiles.length" class="px-4 py-10 text-center text-xs text-text-tertiary">
          暂无 Profile
        </div>
      </aside>

      <div class="flex-1 min-w-0 overflow-y-auto px-6 py-5">
        <div v-if="creating" class="max-w-xl form-card mb-6">
          <label class="form-label">名称</label>
          <input v-model="newName" class="input-field" placeholder="例如：工作账号" @keydown.enter.prevent="confirmCreate" />
          <div class="flex gap-2 pt-3">
            <button type="button" class="btn-primary" :disabled="busy" @click="confirmCreate">创建</button>
            <button type="button" class="btn-secondary" @click="creating = false">取消</button>
          </div>
        </div>

        <template v-if="selected">
          <div class="max-w-xl space-y-5">
            <section>
              <div class="flex items-center gap-2 mb-2">
                <h2 class="text-sm font-semibold text-text-primary">{{ selected.name }}</h2>
                <span
                  class="text-[10px] px-1.5 py-0.5 rounded font-medium"
                  :class="currentStatus?.open ? 'bg-primary-50 text-primary-700' : 'bg-surface-2 text-text-tertiary'"
                >{{ currentStatus?.open ? '窗口已打开' : '窗口未打开' }}</span>
              </div>
              <p class="text-xs text-text-tertiary leading-relaxed">
                此 Profile 有独立 Cookie 与登录态。换 Profile 即换账号，互不影响。
              </p>
            </section>

            <section class="space-y-2">
              <label class="form-label">打开网址</label>
              <div class="flex items-center gap-2">
                <input
                  v-model="url"
                  type="text"
                  class="input-field flex-1 text-sm"
                  placeholder="https://example.com"
                  @keydown="onUrlKeydown"
                />
                <button type="button" class="btn-primary text-sm flex-shrink-0" :disabled="busy" @click="openWindow">
                  {{ busy ? '打开中…' : '打开窗口' }}
                </button>
                <button
                  v-if="currentStatus?.open"
                  type="button"
                  class="btn-secondary text-sm flex-shrink-0"
                  :disabled="busy"
                  @click="closeWindow"
                >关闭</button>
              </div>
              <p v-if="currentStatus?.url" class="text-[11px] text-text-tertiary truncate">当前：{{ currentStatus.title || currentStatus.url }}</p>
              <p v-if="error" class="text-xs text-red-600">{{ error }}</p>
            </section>

            <section class="rounded-xl border border-surface-3 bg-surface-1 px-4 py-3 text-xs text-text-secondary leading-relaxed space-y-1.5">
              <p class="font-medium text-text-primary">在对话里让 AI 操作</p>
              <p>例如：「打开百度搜好伙伴」「在当前页面点登录」。AI 会弹出这个窗口并调用 browser 工具。</p>
              <p>open / snapshot / click / type / screenshot。截图会存到工作区，不会把大图塞进模型上下文。</p>
            </section>

            <section v-if="!selected.builtin" class="flex items-center gap-2 pt-2">
              <input v-model="rename" class="input-field text-sm flex-1" placeholder="重命名" />
              <button type="button" class="btn-secondary text-sm" :disabled="busy" @click="saveRename">保存名称</button>
              <button type="button" class="btn-danger text-sm" :disabled="busy" @click="removeProfile">删除</button>
            </section>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

interface BrowserProfile {
  id: string
  name: string
  builtin?: boolean
  created_at: string
}

interface WindowStatus {
  profileId: string
  open: boolean
  url: string
  title: string
}

const profiles = ref<BrowserProfile[]>([])
const statuses = ref<WindowStatus[]>([])
const selectedId = ref('default')
const url = ref('')
const rename = ref('')
const newName = ref('')
const creating = ref(false)
const busy = ref(false)
const error = ref('')
let pollTimer: number | null = null

const selected = computed(() => profiles.value.find((p) => p.id === selectedId.value) || null)
const currentStatus = computed(() => statuses.value.find((s) => s.profileId === selectedId.value) || null)

function statusOf(id: string): WindowStatus | undefined {
  return statuses.value.find((s) => s.profileId === id)
}

async function refresh() {
  if (!window.api?.browser?.invoke) {
    error.value = '浏览器模块未加载，请完全退出应用后重新打开'
    return
  }
  try {
    profiles.value = (await window.api.browser.invoke('listProfiles')) as BrowserProfile[]
    statuses.value = (await window.api.browser.invoke('status')) as WindowStatus[]
    if (!profiles.value.some((p) => p.id === selectedId.value)) {
      selectedId.value = profiles.value[0]?.id || 'default'
    }
  } catch (e: any) {
    error.value = e?.message || String(e)
  }
}

function startCreate() {
  creating.value = true
  newName.value = ''
}

async function confirmCreate() {
  const name = newName.value.trim()
  if (!name) {
    error.value = '请填写 Profile 名称'
    return
  }
  busy.value = true
  error.value = ''
  try {
    const created = (await window.api.browser.invoke('createProfile', name)) as BrowserProfile
    creating.value = false
    selectedId.value = created.id
    await refresh()
  } catch (e: any) {
    error.value = e?.message || String(e)
  } finally {
    busy.value = false
  }
}

function onUrlKeydown(e: KeyboardEvent) {
  if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return
  e.preventDefault()
  void openWindow()
}

async function openWindow() {
  error.value = ''
  busy.value = true
  try {
    const res: any = await window.api.browser.invoke('openWindow', selectedId.value, url.value.trim() || undefined)
    if (res && res.ok === false) error.value = res.error || '无法打开窗口'
    await refresh()
  } catch (e: any) {
    error.value = e?.message || String(e)
  } finally {
    busy.value = false
  }
}

async function closeWindow() {
  busy.value = true
  error.value = ''
  try {
    await window.api.browser.invoke('closeWindow', selectedId.value)
    await refresh()
  } catch (e: any) {
    error.value = e?.message || String(e)
  } finally {
    busy.value = false
  }
}

async function saveRename() {
  const name = rename.value.trim()
  if (!name || !selected.value) return
  busy.value = true
  try {
    await window.api.browser.invoke('renameProfile', selected.value.id, name)
    await refresh()
  } catch (e: any) {
    error.value = e?.message || String(e)
  } finally {
    busy.value = false
  }
}

async function removeProfile() {
  if (!selected.value || selected.value.builtin) return
  if (!window.api.nativeDialog.confirm(`删除 Profile「${selected.value.name}」？登录态也会一并清除。`)) return
  busy.value = true
  try {
    const res: any = await window.api.browser.invoke('deleteProfile', selected.value.id)
    if (res && res.ok === false) error.value = res.error || '删除失败'
    else selectedId.value = 'default'
    await refresh()
  } catch (e: any) {
    error.value = e?.message || String(e)
  } finally {
    busy.value = false
  }
}

watch(selected, (p) => {
  rename.value = p && !p.builtin ? p.name : ''
})

onMounted(() => {
  void refresh()
  pollTimer = window.setInterval(() => {
    void refresh()
  }, 2500)
})

onUnmounted(() => {
  if (pollTimer !== null) clearInterval(pollTimer)
})
</script>
