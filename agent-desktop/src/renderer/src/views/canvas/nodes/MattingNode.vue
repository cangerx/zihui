<template>
  <div class="canvas-node" :style="{ borderColor: 'var(--color-primary-500, #23574f)' }" :data-status="data.status">
    <div class="node-header" style="background: var(--color-primary-50, #f2f6f5); color: var(--color-primary-700, #1a3f3a);">
      <span class="node-type-dot" style="background: var(--color-primary-500, #23574f);"></span>
      AI 抠图
      <span class="text-[10px] font-normal opacity-60 ml-1">#{{ data.nodeIndex }}</span>
      <button @click="deleteNode" :disabled="data.locked" class="node-delete-btn">
        <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
      </button>
    </div>

    <div class="node-body">
      <!-- 上游图像状态 -->
      <div v-if="!hasUpstreamImage" class="text-[10px] text-text-tertiary mb-2 px-2 py-1.5 bg-surface-2 rounded-lg text-center">
        请连入上游图像节点
      </div>

      <!-- 运行时状态（接口来源用户不需知道，节点 UI 不暴露模式 / provider） -->
      <div v-if="data.status === 'running'" class="flex items-center gap-1.5 text-[10px] text-amber-600 mb-2">
        <svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
        </svg>
        抠图中...
      </div>
      <div v-if="data.status === 'error'" class="text-[10px] text-red-500 mb-2 break-words">{{ data.error }}</div>

      <!-- 结果缩略图（透明背景棋盘格） -->
      <div v-if="data.result_path && data.status === 'done'" class="mb-2">
        <div class="checkerboard rounded-lg overflow-hidden border border-surface-3">
          <img
            :src="resultImageUrl"
            alt="抠图结果"
            class="w-full h-auto block cursor-pointer"
            @click.stop="previewImage"
          />
        </div>
        <div class="flex gap-1 mt-1.5">
          <button @click="copyImage" class="flex-1 py-1 text-[10px] font-medium border border-surface-3 rounded-lg text-text-secondary hover:bg-surface-2 transition-colors">复制</button>
          <button @click="openInFolder" class="flex-1 py-1 text-[10px] font-medium border border-surface-3 rounded-lg text-text-secondary hover:bg-surface-2 transition-colors">定位</button>
        </div>
      </div>

      <button
        @click="runMatting"
        :disabled="!canRun"
        class="w-full py-1.5 text-[10px] font-medium bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-40 transition-colors"
      >
        开始抠图
      </button>
      <!-- 未在「模型服务 → 抠图接口」配置默认接口时默默走云接口；不需要用户手动切换 -->
    </div>

    <Handle type="target" :position="Position.Left" id="image-input" class="handle-image" />
    <Handle
      type="source"
      :position="Position.Right"
      id="output"
      class="handle-image"
      @click="(e: MouseEvent) => onHandleClick?.(e, data.nodeId, 'output', 'image')"
    />
  </div>
  <ImageLightbox
    :src="previewSrc"
    :on-copy="copyImage"
    :on-locate="openInFolder"
    @close="previewSrc = null"
  />
</template>

<script setup lang="ts">
import { computed, inject, onMounted, ref } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { useCanvasStore } from '@/stores/canvas'
import { useMattingStore } from '@/stores/matting'
import { useCloudAuthStore } from '@/stores/cloud-auth'
import { useWorkflowEngine } from '../composables/useWorkflowEngine'
import ImageLightbox from '@/components/ImageLightbox.vue'

type HandleClickHandler = (e: MouseEvent, nodeId: string, handleId: string, dataType: 'text' | 'image') => void

const props = defineProps<{ data: Record<string, any> }>()
const canvasStore = useCanvasStore()
const mattingStore = useMattingStore()
const cloudAuth = useCloudAuthStore()
const { executeSingleNode } = useWorkflowEngine()
const onHandleClick = inject<HandleClickHandler | null>('onHandleClick', null)
const api = () => (window as any).api
const previewSrc = ref<string | null>(null)

// 上游连接判断（参考 ReverseNode）
const hasUpstreamImage = computed(() => {
  if (!props.data.nodeId || !props.data.projectId) return false
  return canvasStore.edges.some(
    (e) =>
      e.project_id === props.data.projectId &&
      e.target_node_id === props.data.nodeId &&
      e.target_handle === 'image-input',
  )
})

const canRun = computed(() => {
  if (props.data.locked) return false
  if (props.data.status === 'running') return false
  if (!hasUpstreamImage.value) return false
  return true
})

// 结果图本地 URL（file://），用 result_path 是相对路径，所以拼接 dataDir
const dataDir = ref('')
onMounted(async () => {
  // 首次渲染时按需加载本地接口列表（用于自动决策走云还是走自定义，用户不需感知）
  if (!mattingStore.providers.length) {
    try { await mattingStore.loadProviders() } catch { /* 无网或刚启动 */ }
  }
  try {
    dataDir.value = (await (window as any).api.dataDir.get()) || ''
  } catch { dataDir.value = '' }
})

const resultImageUrl = computed(() => {
  if (!props.data.result_path) return ''
  const rp = String(props.data.result_path)
  if (rp.startsWith('data:')) return rp
  if (/^[A-Za-z]:|^\//.test(rp)) return 'file:///' + rp.replace(/\\/g, '/')
  if (!dataDir.value) return ''
  return 'file:///' + (dataDir.value + '/' + rp).replace(/\\/g, '/')
})

function persist(patch: Record<string, any>) {
  if (!props.data.nodeId) return
  canvasStore.updateNode(props.data.nodeId, {
    data: { ...props.data, ...patch },
  })
}

/**
 * 运行时自动决策接口来源，与 MattingView 主页保持一致：
 *   - 套餐授权 allow_custom_matting_provider + 本地有默认接口 → 直连阿里
 *   - 否则 → 走云接口
 * 在点击「开始抠图」时把决策后的 source / provider_id 写回节点 data，让 useWorkflowEngine 读取。
 */
async function runMatting() {
  if (!props.data.nodeId || !props.data.projectId) return
  const allowCustom = cloudAuth.permissions.allow_custom_matting_provider
  const useCustom = allowCustom && !!mattingStore.defaultProvider
  persist({
    matting_source: useCustom ? 'custom' : 'cloud',
    matting_provider_id: useCustom ? mattingStore.defaultProvider!.id : '',
  })
  await executeSingleNode(props.data.nodeId, props.data.projectId)
}

function previewImage() {
  if (resultImageUrl.value) previewSrc.value = resultImageUrl.value
}

function copyImage() {
  if (props.data.result_path) api().clipboard.writeImage(props.data.result_path)
}

function openInFolder() {
  if (props.data.result_path) api().shell.showItemInFolder(props.data.result_path)
}

function deleteNode() {
  if (!props.data.nodeId) return
  canvasStore.removeNode(props.data.nodeId)
}
</script>

<style scoped>
.checkerboard {
  background-image:
    linear-gradient(45deg, #eee 25%, transparent 25%, transparent 75%, #eee 75%, #eee),
    linear-gradient(45deg, #eee 25%, #fff 25%, #fff 75%, #eee 75%, #eee);
  background-size: 12px 12px;
  background-position: 0 0, 6px 6px;
}
:global(.dark) .checkerboard {
  background-image:
    linear-gradient(45deg, #333 25%, transparent 25%, transparent 75%, #333 75%, #333),
    linear-gradient(45deg, #333 25%, #1f1f1f 25%, #1f1f1f 75%, #333 75%, #333);
}
</style>
