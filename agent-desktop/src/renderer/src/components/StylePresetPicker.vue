<template>
  <!-- 云端无可用风格时整个入口不显示（含首次拉取失败且无缓存的降级） -->
  <div v-if="store.hasStyles" class="inline-flex items-center">
    <button
      type="button"
      @click="open"
      :class="[
        'inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] transition-colors',
        selectedStyle
          ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
          : 'border-surface-3 text-text-secondary hover:bg-surface-2'
      ]"
    >
      <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21a4 4 0 0 1-4-4V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v12a4 4 0 0 1-4 4Zm0 0h12a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 0 1 2.828 0l2.829 2.829a2 2 0 0 1 0 2.828l-8.486 8.485M7 17h.01" />
      </svg>
      <span>{{ selectedStyle ? selectedStyle.name : '风格' }}</span>
      <span
        v-if="selectedStyle"
        @click.stop="clear"
        title="清除风格"
        class="ml-0.5 rounded-full hover:bg-primary-100 dark:hover:bg-primary-800/40 px-0.5 leading-none"
      >×</span>
    </button>

    <!-- 选择弹窗（只阴影不遮罩；Teleport 到 body：避免被画布节点的 transform 容器影响） -->
    <Teleport to="body">
      <div v-if="visible" class="fixed inset-0 z-50 flex items-center justify-center">
      <div class="bg-surface-0 rounded-xl shadow-2xl border border-surface-3 w-[720px] max-h-[85vh] flex flex-col overflow-hidden">
        <!-- Header -->
        <div class="px-5 py-3 border-b border-surface-3 flex items-center justify-between flex-shrink-0">
          <div>
            <h3 class="text-sm font-medium text-text-primary">选择风格</h3>
            <p class="text-[11px] text-text-tertiary mt-0.5">选中风格的描述会拼接到提示词尾部，不选则按原提示词生成</p>
          </div>
          <button @click="cancel" class="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-2 transition-colors">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <!-- 分类 tab -->
        <div v-if="store.categories.length > 0" class="px-5 pt-3 flex items-center gap-1.5 flex-wrap flex-shrink-0">
          <button
            @click="activeCategory = ''"
            :class="[
              'px-2.5 py-1 rounded-lg border text-[11px] transition-colors',
              activeCategory === ''
                ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                : 'border-surface-3 text-text-secondary hover:bg-surface-2'
            ]"
          >全部</button>
          <button
            v-for="c in store.categories"
            :key="c"
            @click="activeCategory = c"
            :class="[
              'px-2.5 py-1 rounded-lg border text-[11px] transition-colors',
              activeCategory === c
                ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                : 'border-surface-3 text-text-secondary hover:bg-surface-2'
            ]"
          >{{ c }}</button>
        </div>

        <!-- 风格卡片 -->
        <div class="flex-1 overflow-y-auto p-5">
          <div v-if="filteredStyles.length === 0" class="py-12 text-center text-xs text-text-tertiary">
            该分类下暂无风格
          </div>
          <div v-else class="grid grid-cols-3 gap-3">
            <button
              v-for="s in filteredStyles"
              :key="s.id"
              @click="pendingId = s.id"
              :class="[
                'rounded-lg border text-left overflow-hidden transition-colors',
                pendingId === s.id
                  ? 'border-primary-500 ring-1 ring-primary-500 bg-primary-50 dark:bg-primary-900/20'
                  : 'border-surface-3 bg-surface-1 hover:bg-surface-2'
              ]"
            >
              <img
                v-if="s.sample_image && !brokenImages.has(s.id)"
                :src="s.sample_image"
                :alt="s.name"
                class="w-full aspect-video object-cover bg-surface-2"
                loading="lazy"
                @error="onImgError(s.id)"
              />
              <div v-else class="w-full aspect-video bg-surface-2 flex items-center justify-center text-text-disabled">
                <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M7 21a4 4 0 0 1-4-4V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v12a4 4 0 0 1-4 4Zm0 0h12a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 0 1 2.828 0l2.829 2.829a2 2 0 0 1 0 2.828l-8.486 8.485M7 17h.01" />
                </svg>
              </div>
              <div class="p-2">
                <div class="text-[11px] font-medium text-text-primary truncate">{{ s.name }}</div>
                <div class="text-[10px] text-text-tertiary leading-snug line-clamp-2 mt-0.5">{{ s.prompt_fragment }}</div>
              </div>
            </button>
          </div>
        </div>

        <!-- Footer -->
        <div class="px-5 py-3 border-t border-surface-3 flex items-center justify-between flex-shrink-0">
          <div class="text-[11px] text-text-tertiary truncate max-w-[60%]">
            已选：<span class="text-text-secondary font-medium">{{ pendingStyle?.name || '不使用风格' }}</span>
            <span v-if="store.fromCache" class="ml-2">（离线缓存数据）</span>
          </div>
          <div class="flex items-center gap-1.5">
            <button
              @click="pendingId = null"
              class="px-3 py-1.5 text-xs text-text-secondary border border-surface-3 rounded-lg hover:bg-surface-2 transition-colors"
            >不使用风格</button>
            <button
              @click="cancel"
              class="px-3 py-1.5 text-xs text-text-secondary border border-surface-3 rounded-lg hover:bg-surface-2 transition-colors"
            >取消</button>
            <button
              @click="confirm"
              class="px-3 py-1.5 text-xs text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors"
            >确定</button>
          </div>
        </div>
      </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useStylePresetStore } from '../stores/style-presets'

/**
 * 风格预设选择器（共享组件）。
 * 使用处：AI 生图 / 批量生图 / 画布文生图节点 / 图生图节点 / 快捷编排节点。
 * v-model 绑定风格 id（number | null），null = 不使用风格（默认）。
 * 选中的风格 id 在云端被删除/停用时自动按「无风格」降级（按钮回退为未选态）。
 */
const props = defineProps<{ modelValue: number | null }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: number | null): void }>()

const store = useStylePresetStore()
const visible = ref(false)
const pendingId = ref<number | null>(null)
const activeCategory = ref('')
// 示例图加载失败的 id 集合：降级为纯文字卡，不破图
const brokenImages = ref<Set<number>>(new Set())

function onImgError(id: number) {
  const next = new Set(brokenImages.value)
  next.add(id)
  brokenImages.value = next
}

const selectedStyle = computed(() => store.byId(props.modelValue))
const pendingStyle = computed(() => store.byId(pendingId.value))
const filteredStyles = computed(() => {
  if (!activeCategory.value) return store.styles
  return store.styles.filter((s) => s.category === activeCategory.value)
})

onMounted(() => {
  store.fetchStyles()
})

function open() {
  pendingId.value = selectedStyle.value ? selectedStyle.value.id : null
  activeCategory.value = ''
  visible.value = true
  // 仅当当前数据来自离线缓存时，打开弹窗顺便重试网络（正常情况每会话只拉一次）
  if (store.fromCache) store.fetchStyles(true)
}

function clear() {
  emit('update:modelValue', null)
}

function cancel() {
  visible.value = false
}

function confirm() {
  emit('update:modelValue', pendingId.value)
  visible.value = false
}
</script>
