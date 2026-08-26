<template>
  <div :class="embedded ? 'flex flex-col' : 'h-full flex flex-col'">
    <!-- 顶部说明 + 添加按钮 -->
    <div class="flex items-start justify-between gap-4 mb-4">
      <div class="flex-1 text-xs text-text-secondary leading-relaxed">
        <p class="mb-1">
          在此添加默认接口后，AI 抠图会自动直连阿里云（不再走云接口、不扣云接口积分），按阿里账单计费。
        </p>
        <p class="text-text-tertiary">
          AccessKey 加密存于本地，仅当前设备可解密；不会上传到任何服务器。
        </p>
      </div>
      <button class="btn-primary !text-sm flex-shrink-0" @click="openCreate">添加接口</button>
    </div>

    <!-- 列表 -->
    <div :class="embedded ? 'space-y-2' : 'flex-1 overflow-y-auto'">
      <div v-if="!store.providers.length" class="text-center py-16 text-text-tertiary text-sm">
        尚未配置任何抠图接口。点击右上角「添加接口」开始。
      </div>
      <div v-else class="space-y-2">
        <div
          v-for="p in store.providers"
          :key="p.id"
          class="rounded-lg border border-surface-3 bg-surface-0 p-4 hover:border-primary-300 transition-colors"
        >
          <div class="flex items-start justify-between gap-4">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-1">
                <h3 class="text-sm font-semibold">{{ p.name }}</h3>
                <span v-if="p.is_default" class="px-1.5 py-0.5 text-[10px] rounded bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">默认</span>
                <span class="text-[10px] text-text-tertiary">阿里云 viapi</span>
              </div>
              <div class="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-text-secondary">
                <div>AK ID: <code>{{ p.access_key_id_masked }}</code></div>
                <div>Region: {{ p.region_id }}</div>
                <div class="col-span-2 truncate" :title="p.endpoint">Endpoint: {{ p.endpoint }}</div>
                <div v-if="p.remark" class="col-span-2 text-text-tertiary truncate" :title="p.remark">备注: {{ p.remark }}</div>
              </div>
              <div v-if="p.last_test_at" class="mt-2 flex items-center gap-2 text-[11px]">
                <span :class="p.last_test_status === 'success' ? 'text-success' : 'text-error'">
                  {{ p.last_test_status === 'success' ? '✓ 测试通过' : '✗ 测试失败' }}
                </span>
                <span class="text-text-tertiary">{{ formatTime(p.last_test_at) }}</span>
                <span v-if="p.last_test_message" class="text-text-tertiary truncate" :title="p.last_test_message">
                  {{ p.last_test_message }}
                </span>
              </div>
            </div>
            <div class="flex flex-col gap-1.5 flex-shrink-0">
              <button class="btn-secondary !py-1 !text-xs" @click="openTest(p.id)" :disabled="testing[p.id]">
                {{ testing[p.id] ? '测试中…' : '测试' }}
              </button>
              <button class="btn-secondary !py-1 !text-xs" @click="openEdit(p)">编辑</button>
              <button class="!text-xs px-2 py-1 rounded text-error hover:bg-error/10" @click="onDelete(p)">删除</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 编辑 / 添加弹窗（项目规则：弹窗只加阴影，不要背景遮罩） -->
    <div v-if="editOpen" class="fixed inset-0 z-50 flex items-start justify-center pt-20 pointer-events-none">
      <div class="w-[520px] max-w-[92vw] bg-surface-0 rounded-xl shadow-2xl border border-surface-3 pointer-events-auto">
        <header class="flex items-center justify-between px-5 py-3 border-b border-surface-3">
          <h3 class="text-sm font-semibold">{{ editingId ? '编辑抠图接口' : '添加抠图接口' }}</h3>
          <button class="text-text-tertiary hover:text-text-primary" @click="editOpen = false">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </header>
        <form class="px-5 py-4 space-y-3" @submit.prevent="onSubmit">
          <div>
            <label class="form-label">名称 <span class="text-error">*</span></label>
            <input v-model="form.name" class="form-input w-full" placeholder="如：阿里·主账号" required />
          </div>
          <div>
            <label class="form-label">
              AccessKey ID
              <span v-if="!editingId" class="text-error">*</span>
              <span v-else class="text-text-tertiary text-[11px]">（留空表示不修改）</span>
            </label>
            <input v-model="form.access_key_id" class="form-input w-full font-mono text-xs" placeholder="LTAI5tXXXXXXXXXXX" :required="!editingId" />
          </div>
          <div>
            <label class="form-label">
              AccessKey Secret
              <span v-if="!editingId" class="text-error">*</span>
              <span v-else class="text-text-tertiary text-[11px]">（留空表示不修改）</span>
            </label>
            <input v-model="form.access_key_secret" type="password" class="form-input w-full font-mono text-xs"
              placeholder="****"
              :required="!editingId" />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="form-label">Endpoint</label>
              <select v-model="form.endpoint" class="form-select w-full text-sm">
                <option value="imageseg.cn-shanghai.aliyuncs.com">cn-shanghai（推荐）</option>
                <option value="imageseg.cn-beijing.aliyuncs.com">cn-beijing</option>
              </select>
            </div>
            <div>
              <label class="form-label">Region</label>
              <select v-model="form.region_id" class="form-select w-full text-sm">
                <option value="cn-shanghai">cn-shanghai</option>
                <option value="cn-beijing">cn-beijing</option>
              </select>
            </div>
          </div>
          <div>
            <label class="form-label">备注</label>
            <input v-model="form.remark" class="form-input w-full" placeholder="可选" />
          </div>
          <label class="flex items-center gap-2 text-sm">
            <input v-model="form.is_default" type="checkbox" />
            <span>设为默认接口</span>
          </label>

          <div v-if="formError" class="text-xs text-error">{{ formError }}</div>
          <div class="flex justify-end gap-2 pt-2">
            <button type="button" class="btn-secondary" @click="editOpen = false">取消</button>
            <button type="submit" class="btn-primary" :disabled="submitting">
              {{ submitting ? '保存中…' : '保存' }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- 测试弹窗（项目规则：弹窗只加阴影，不要背景遮罩） -->
    <div v-if="testDialog" class="fixed inset-0 z-50 flex items-start justify-center pt-20 pointer-events-none">
      <div class="w-[520px] max-w-[92vw] bg-surface-0 rounded-xl shadow-2xl border border-surface-3 pointer-events-auto">
        <header class="flex items-center justify-between px-5 py-3 border-b border-surface-3">
          <h3 class="text-sm font-semibold">测试接口</h3>
          <button class="text-text-tertiary hover:text-text-primary" @click="testDialog = false">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </header>
        <div class="px-5 py-4">
          <p class="text-xs text-text-secondary mb-3">
            选一张本地图片（≤ 40MB，PNG/JPG/JPEG/BMP）让我们调一次阿里抠图接口。完成后耗时与结果 URL 会显示在下方。
          </p>
          <input
            type="file"
            accept=".png,.jpg,.jpeg,.bmp"
            class="form-input w-full"
            @change="onPickTestFile"
          />
          <div v-if="testResult" class="mt-3 p-3 rounded bg-surface-1 text-xs space-y-1">
            <template v-if="testResult.ok">
              <div class="text-success">测试通过</div>
              <div>耗时：{{ testResult.result.elapsed_ms }} ms</div>
              <div class="truncate">Request ID：{{ testResult.result.request_id }}</div>
              <div class="truncate">
                结果：
                <a :href="testResult.result.image_url" target="_blank" class="text-primary-500 hover:underline">
                  {{ testResult.result.image_url }}
                </a>
              </div>
            </template>
            <template v-else>
              <div class="text-error">测试失败</div>
              <div>{{ testResult.error }}</div>
            </template>
          </div>
          <div class="flex justify-end gap-2 mt-4">
            <button class="btn-secondary" @click="testDialog = false">关闭</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useMattingStore, type MattingProviderSummary } from '@/stores/matting'

withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

const store = useMattingStore()

// ===== 列表加载 =====
onMounted(() => { store.loadProviders() })

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString('zh-CN', { hour12: false })
  } catch { return iso }
}

// ===== 添加 / 编辑 =====
const editOpen = ref(false)
const editingId = ref<string>('')
const submitting = ref(false)
const formError = ref('')
const form = reactive({
  name: '',
  access_key_id: '',
  access_key_secret: '',
  endpoint: 'imageseg.cn-shanghai.aliyuncs.com',
  region_id: 'cn-shanghai',
  is_default: false,
  remark: '',
})

function resetForm() {
  form.name = ''
  form.access_key_id = ''
  form.access_key_secret = ''
  form.endpoint = 'imageseg.cn-shanghai.aliyuncs.com'
  form.region_id = 'cn-shanghai'
  form.is_default = false
  form.remark = ''
  formError.value = ''
}

function openCreate() {
  resetForm()
  editingId.value = ''
  editOpen.value = true
}

function openEdit(p: MattingProviderSummary) {
  resetForm()
  editingId.value = p.id
  form.name = p.name
  form.access_key_id = '' // 留空显示未修改提示
  form.access_key_secret = ''
  form.endpoint = p.endpoint
  form.region_id = p.region_id
  form.is_default = p.is_default
  form.remark = p.remark
  editOpen.value = true
}

async function onSubmit() {
  submitting.value = true
  formError.value = ''
  try {
    if (editingId.value) {
      // 编辑：access_key_id 为空表示不改
      await store.updateProvider(editingId.value, {
        name: form.name,
        ...(form.access_key_id ? { access_key_id: form.access_key_id } : {}),
        ...(form.access_key_secret ? { access_key_secret: form.access_key_secret } : {}),
        endpoint: form.endpoint,
        region_id: form.region_id,
        is_default: form.is_default,
        remark: form.remark,
      })
    } else {
      await store.createProvider({ ...form })
    }
    editOpen.value = false
  } catch (e: any) {
    formError.value = e?.message || String(e)
  } finally {
    submitting.value = false
  }
}

async function onDelete(p: MattingProviderSummary) {
  if (!confirm(`确认删除「${p.name}」？该接口下的历史任务记录不会删除。`)) return
  try {
    await store.deleteProvider(p.id)
  } catch (e: any) {
    alert(e?.message || String(e))
  }
}

// ===== 测试 =====
const testDialog = ref(false)
const testingProviderId = ref('')
const testing = reactive<Record<string, boolean>>({})
const testResult = ref<{ ok: true; result: { image_url: string; request_id: string; elapsed_ms: number } } | { ok: false; error: string } | null>(null)

function openTest(id: string) {
  testingProviderId.value = id
  testResult.value = null
  testDialog.value = true
}

async function onPickTestFile(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  if (!f) return
  const path = (f as any).path as string
  if (!path) {
    testResult.value = { ok: false, error: '无法获取文件路径（请确认在桌面端运行）' }
    return
  }
  testing[testingProviderId.value] = true
  testResult.value = null
  try {
    const r = await store.testProvider(testingProviderId.value, path)
    testResult.value = r
  } catch (e: any) {
    testResult.value = { ok: false, error: e?.message || String(e) }
  } finally {
    testing[testingProviderId.value] = false
    input.value = ''
  }
}
</script>
