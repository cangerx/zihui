<template>
  <div v-if="visible" class="fixed inset-0 z-50 flex items-center justify-center">
    <div class="bg-surface-0 rounded-xl shadow-2xl border border-surface-3 w-[460px] max-h-[80vh] flex flex-col overflow-hidden">
      <!-- Header -->
      <div class="px-5 py-3 border-b border-surface-3 flex items-center justify-between flex-shrink-0">
        <div>
          <h3 class="text-sm font-medium text-text-primary">保存到图库</h3>
          <p class="text-[11px] text-text-tertiary mt-0.5">默认存到当前文件夹图库</p>
        </div>
        <button @click="cancel" class="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-2 transition-colors">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Body -->
      <div class="flex-1 overflow-y-auto p-5 space-y-4">
        <!-- 缩略预览 -->
        <div v-if="previewDataUri" class="flex items-center justify-center bg-surface-1 rounded-lg p-3">
          <img :src="previewDataUri" class="max-h-32 max-w-full rounded shadow-sm" />
        </div>

        <!-- 文件名 -->
        <div>
          <label class="text-[11px] font-medium text-text-secondary mb-1 block">文件名</label>
          <input
            v-model="filename"
            type="text"
            placeholder="未填会按工具自动命名"
            class="w-full px-3 py-2 text-xs bg-surface-1 border border-surface-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <p class="text-[10px] text-text-tertiary mt-1">不需要写扩展名，系统会按图片实际类型补全</p>
        </div>

        <!-- 数量提示（批量场景） -->
        <div v-if="count > 1" class="text-[11px] text-text-secondary bg-primary-50 dark:bg-primary-900/20 rounded-lg p-2.5">
          共 {{ count }} 张图片，将按 <span class="font-medium">{{ filename || '原文件名' }} - 序号</span> 方式批量保存
        </div>

        <!-- 分类 -->
        <div>
          <div class="flex items-center justify-between mb-1.5">
            <label class="text-[11px] font-medium text-text-secondary">保存到分类</label>
            <button
              v-if="!creatingCategory"
              @click="creatingCategory = true"
              class="text-[10px] text-primary-600 hover:text-primary-700"
            >+ 新建分类</button>
          </div>

          <!-- 新建分类 inline -->
          <div v-if="creatingCategory" class="mb-2 flex items-center gap-1.5">
            <input
              v-model="newCategoryName"
              type="text"
              placeholder="分类名称"
              class="flex-1 px-2 py-1 text-xs bg-surface-1 border border-surface-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              @keyup.enter="confirmCreateCategory"
            />
            <button
              @click="confirmCreateCategory"
              :disabled="!newCategoryName.trim() || creating"
              class="px-2 py-1 text-[10px] bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
            >{{ creating ? '...' : '确定' }}</button>
            <button
              @click="creatingCategory = false; newCategoryName = ''"
              class="px-2 py-1 text-[10px] border border-surface-3 rounded-lg hover:bg-surface-2 text-text-tertiary"
            >取消</button>
          </div>

          <div class="max-h-48 overflow-y-auto space-y-1 border border-surface-3 rounded-lg p-1.5">
            <button
              v-for="c in gallery.categories"
              :key="c.id"
              @click="selectedCategoryId = c.id"
              :class="[
                'w-full px-2.5 py-1.5 rounded-md text-[11px] flex items-center justify-between text-left transition-colors',
                selectedCategoryId === c.id
                  ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700'
                  : 'hover:bg-surface-2 text-text-secondary'
              ]"
            >
              <span class="font-medium">{{ c.name }}</span>
              <span v-if="c.is_system" class="text-[9px] text-text-tertiary">系统</span>
            </button>
            <div v-if="!gallery.categories.length" class="text-[11px] text-text-tertiary text-center py-3">
              暂无分类，点上方「+ 新建分类」创建
            </div>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="px-5 py-3 border-t border-surface-3 flex items-center justify-end gap-1.5 flex-shrink-0">
        <button @click="cancel" class="px-3 py-1.5 text-xs text-text-secondary border border-surface-3 rounded-lg hover:bg-surface-2 transition-colors">取消</button>
        <button
          @click="confirm"
          :disabled="!selectedCategoryId || saving"
          class="px-3 py-1.5 text-xs text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >{{ saving ? '保存中...' : '保存' }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { useGalleryStore } from '@/stores/gallery'
import { useAgentWorkspaceStore } from '@/stores/agent-workspaces'

const props = withDefaults(
  defineProps<{
    visible: boolean
    /** 用于显示缩略预览（可选） */
    previewDataUri?: string
    /** 批量场景：> 1 显示批量提示 */
    count?: number
    /** 默认文件名（无扩展名） */
    defaultName?: string
  }>(),
  { previewDataUri: '', count: 1, defaultName: '' }
)

const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  /** 用户确认后回调：调用方负责实际写入 + UI 反馈 */
  (e: 'confirm', payload: { categoryId: string; filename: string }): void
}>()

const gallery = useGalleryStore()
const workspaceStore = useAgentWorkspaceStore()
const selectedCategoryId = ref('')
const filename = ref('')
const creatingCategory = ref(false)
const newCategoryName = ref('')
const creating = ref(false)
const saving = ref(false)

onMounted(async () => {
  // 首次打开时若分类未加载，主动 fetch
  if (gallery.categories.length === 0) {
    try { await gallery.fetchCategories() } catch { /* ignore */ }
  }
})

// 弹窗打开时初始化：默认文件名 + 默认分类
watch(
  () => props.visible,
  (v) => {
    if (!v) return
    filename.value = props.defaultName || ''
    const cats = gallery.categories
    const wsCat = workspaceStore.active?.gallery_category_id || ''
    if (!selectedCategoryId.value || !cats.find(c => c.id === selectedCategoryId.value)) {
      selectedCategoryId.value =
        (wsCat && cats.some((c) => c.id === wsCat) ? wsCat : '') ||
        cats.find(c => !c.is_system)?.id ||
        cats[0]?.id ||
        ''
    }
  },
  { immediate: true }
)

async function confirmCreateCategory() {
  const name = newCategoryName.value.trim()
  if (!name || creating.value) return
  creating.value = true
  try {
    const cat = await gallery.createCategory({ name })
    selectedCategoryId.value = cat.id
    creatingCategory.value = false
    newCategoryName.value = ''
  } catch (e: any) {
    alert('创建失败：' + (e?.message || ''))
  } finally {
    creating.value = false
  }
}

function cancel() {
  emit('update:visible', false)
}

function confirm() {
  if (!selectedCategoryId.value || saving.value) return
  // 父组件接管 saving 状态：先关闭、再异步写入；这里只发事件
  emit('confirm', {
    categoryId: selectedCategoryId.value,
    filename: filename.value.trim()
  })
  emit('update:visible', false)
}
</script>
