<template>
  <div
    v-if="open"
    class="fixed inset-0 z-[60] flex items-center justify-center"
    @click.self="handleClose"
  >
    <div
      class="bg-surface-0 rounded-2xl shadow-[0_0_30px_rgba(0,0,0,0.12)] w-[520px] max-h-[85vh] flex flex-col overflow-hidden"
      @click.stop
    >
      <!-- Header -->
      <div class="flex items-center justify-between px-5 pt-5 pb-3">
        <h3 class="text-sm font-semibold text-text-primary">分享到灵感广场</h3>
        <button @click="handleClose" class="text-text-tertiary hover:text-text-primary">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>

      <!-- Body -->
      <div class="px-5 pb-4 overflow-y-auto flex-1 space-y-4">
        <!-- 标题 -->
        <div>
          <label class="text-xs font-medium text-text-secondary mb-1.5 block">
            标题 <span class="text-red-500 dark:text-red-400">*</span>
          </label>
          <input
            v-model="localTitle"
            :disabled="submitting"
            maxlength="100"
            placeholder="给这张创作起个标题"
            class="w-full px-3 py-2 text-xs border border-surface-3 rounded-lg bg-surface-0 outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
          />
          <div class="text-[10px] text-text-tertiary mt-1 text-right">{{ localTitle.length }} / 100</div>
        </div>

        <!-- 分类 -->
        <div>
          <label class="text-xs font-medium text-text-secondary mb-1.5 block">
            分类 <span class="text-red-500 dark:text-red-400">*</span>
          </label>
          <div v-if="categoriesLoading" class="text-xs text-text-tertiary px-3 py-2 border border-surface-3 rounded-lg bg-surface-1">
            加载分类中...
          </div>
          <div v-else-if="!categories.length" class="text-xs text-text-tertiary px-3 py-2 border border-dashed border-surface-3 rounded-lg bg-surface-1">
            云控端尚未创建任何分类，请联系管理员创建后再上传
          </div>
          <select
            v-else
            v-model="localCategoryId"
            :disabled="submitting"
            class="w-full px-3 py-2 text-xs border border-surface-3 rounded-lg bg-surface-0 outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
          >
            <option :value="null" disabled>请选择分类</option>
            <option v-for="cat in categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
          </select>
        </div>

        <!-- 提示词语言 -->
        <div>
          <label class="text-xs font-medium text-text-secondary mb-1.5 block">
            提示词语言 <span class="text-red-500 dark:text-red-400">*</span>
          </label>
          <div class="flex gap-2">
            <button
              type="button"
              @click="localLang = 'cn'"
              :disabled="submitting"
              :class="['flex-1 px-3 py-2 text-xs rounded-lg border transition-colors', localLang === 'cn' ? 'border-primary-500 bg-primary-50 text-primary-700 font-medium' : 'border-surface-3 bg-surface-0 text-text-secondary hover:bg-surface-1']"
            >
              填入中文提示词字段
            </button>
            <button
              type="button"
              @click="localLang = 'en'"
              :disabled="submitting"
              :class="['flex-1 px-3 py-2 text-xs rounded-lg border transition-colors', localLang === 'en' ? 'border-primary-500 bg-primary-50 text-primary-700 font-medium' : 'border-surface-3 bg-surface-0 text-text-secondary hover:bg-surface-1']"
            >
              填入英文提示词字段
            </button>
          </div>
        </div>

        <!-- 提示词预览（只读） -->
        <div>
          <label class="text-xs font-medium text-text-secondary mb-1.5 block">提示词内容（将上传）</label>
          <div class="text-xs text-text-primary bg-surface-1 rounded-lg p-3 whitespace-pre-wrap leading-relaxed max-h-32 overflow-y-auto">{{ promptText }}</div>
        </div>

        <div v-if="generationSize" class="text-[11px] text-text-secondary bg-surface-1 border border-surface-3 rounded-lg px-3 py-2">
          生成尺寸：<span class="font-medium text-text-primary">{{ generationSize }}</span>
        </div>

        <!-- 参考图 -->
        <div v-if="refImages.length > 0" class="space-y-2">
          <label class="flex items-center justify-between text-xs font-medium text-text-secondary">
            <span>参考图（{{ refImages.length }} 张）</span>
            <span class="flex items-center gap-1.5 text-[11px] font-normal text-text-secondary">
              <input v-model="includeRefImages" type="checkbox" :disabled="submitting" class="w-3 h-3 accent-primary-600" />
              上传参考图
            </span>
          </label>
          <div class="flex flex-wrap gap-2">
            <img
              v-for="(url, index) in refImages"
              :key="`${url}-${index}`"
              :src="toPreviewUrl(url)"
              class="w-14 h-14 rounded-lg object-cover border border-surface-3"
            />
          </div>
          <div class="text-[11px] text-text-tertiary leading-relaxed">
            勾选后会随灵感一起上传，其他用户复用该灵感时可自动带入参考图。
          </div>
        </div>

        <!-- 错误提示 -->
        <div v-if="errorMsg" class="px-3 py-2 bg-red-50 border border-red-200 dark:bg-red-900/20 dark:border-red-800 rounded-lg text-[11px] text-red-600 dark:text-red-300">
          {{ errorMsg }}
        </div>
      </div>

      <!-- Footer -->
      <div class="flex items-center justify-end gap-2 px-5 py-3 border-t border-surface-2">
        <button
          @click="handleClose"
          :disabled="submitting"
          class="px-4 py-1.5 text-xs text-text-secondary hover:text-text-primary border border-surface-3 rounded-lg bg-surface-0 hover:bg-surface-1 transition-colors disabled:opacity-50"
        >
          取消
        </button>
        <button
          @click="handleSubmit"
          :disabled="!canSubmit"
          class="px-4 py-1.5 text-xs text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
        >
          <svg v-if="submitting" class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
          {{ submitting ? '上传中...' : '上传到灵感广场' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { cloudPublic } from '@/utils/cloud-api'

interface Category {
  id: number
  name: string
  sort_order?: number
}

const props = defineProps<{
  open: boolean
  resultPath: string
  promptText: string
  refImagesCount: number
  refImages?: string[]
  generationSize?: string
  defaultTitle?: string
  defaultLang?: 'cn' | 'en'
}>()

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'uploaded'): void
  (e: 'error', msg: string): void
  (e: 'success', msg: string): void
}>()

const localTitle = ref('')
const localCategoryId = ref<number | null>(null)
const localLang = ref<'cn' | 'en'>('cn')
const categories = ref<Category[]>([])
const categoriesLoading = ref(false)
const submitting = ref(false)
const errorMsg = ref('')
const includeRefImages = ref(true)

const refImages = computed(() => Array.isArray(props.refImages) ? props.refImages.slice(0, 8) : [])
const generationSize = computed(() => (props.generationSize || '').trim())

function toPreviewUrl(value: string): string {
  if (!value) return ''
  if (/^(data:|https?:|file:|local-file:)/i.test(value)) return value
  const isAbsolute = /^[A-Za-z]:|^\//.test(value)
  const param = isAbsolute ? 'p' : 'rel'
  return 'local-file://img?' + param + '=' + encodeURIComponent(value) + '&thumb=1'
}

// 简单启发式：如果提示词中 ASCII 字母占比高于 50%，默认选英文
function guessLang(text: string): 'cn' | 'en' {
  if (!text) return 'cn'
  const letters = (text.match(/[a-zA-Z]/g) || []).length
  return letters / text.length > 0.5 ? 'en' : 'cn'
}

async function loadCategories() {
  categoriesLoading.value = true
  errorMsg.value = ''
  try {
    const res: any = await cloudPublic.listInspirationCategories()
    // 后端返回 { data: [...] }（Laravel paginate / 直接数组）
    const list = Array.isArray(res) ? res : (res?.data || [])
    categories.value = list.map((c: any) => ({ id: c.id, name: c.name, sort_order: c.sort_order }))
  } catch (e: any) {
    errorMsg.value = '加载分类失败：' + (e?.message || '未知错误')
  } finally {
    categoriesLoading.value = false
  }
}

// 弹窗打开时初始化状态
watch(() => props.open, (v) => {
  if (v) {
    localTitle.value = props.defaultTitle || ''
    localCategoryId.value = null
    localLang.value = props.defaultLang || guessLang(props.promptText)
    errorMsg.value = ''
    submitting.value = false
    includeRefImages.value = true
    loadCategories()
  }
}, { immediate: true })

const canSubmit = computed(() => {
  return !submitting.value
    && !!localTitle.value.trim()
    && !!localCategoryId.value
    && !!props.promptText?.trim()
    && !categoriesLoading.value
    && categories.value.length > 0
})

function handleClose() {
  if (submitting.value) return
  emit('update:open', false)
}

async function handleSubmit() {
  if (!canSubmit.value) return
  errorMsg.value = ''
  submitting.value = true
  try {
    const res = await (window as any).api.cloud.uploadInspiration({
      resultPath: props.resultPath,
      title: localTitle.value.trim(),
      categoryId: localCategoryId.value!,
      promptLang: localLang.value,
      promptText: props.promptText,
      refImages: includeRefImages.value ? refImages.value : [],
      generationSize: generationSize.value
    })
    if (res?.ok) {
      emit('uploaded')
      // 主进程检测到原图超过 5MB 时会自动 JPEG 阶梯压缩，告知用户避免疑惑
      const successMsg = res.compressed
        ? '图片过大，已自动压缩后上传到灵感广场'
        : '已上传到灵感广场'
      emit('success', successMsg)
      emit('update:open', false)
    } else {
      errorMsg.value = res?.error || '上传失败'
      emit('error', errorMsg.value)
    }
  } catch (e: any) {
    errorMsg.value = e?.message || '上传失败'
    emit('error', errorMsg.value)
  } finally {
    submitting.value = false
  }
}
</script>
