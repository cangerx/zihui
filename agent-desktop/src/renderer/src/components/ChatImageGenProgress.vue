<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watchEffect, watch } from 'vue'
import { useChatStore } from '@/stores/chat'

/**
 * 聊天对话内的生图进度浮窗。
 *
 * 作用：当 chat 中 LLM 调用 image_gen 工具生图时，本组件实时显示生图进度卡片。
 * 数据源：监听主进程 `imageGen:progress` 事件，按 conversationId + source==='chat' 过滤，
 * 避免和 ImageGenView 等其他视图的进度串台。
 *
 * 状态机：generating → completed | error
 *  - generating: 旋转圈 + 提示词截断
 *  - completed: 缩略图 + "图片已生成" + 5 秒后自动淡出
 *  - error: 红色边框 + 错误信息 + 用户手动关闭
 *
 * 布局：调用方负责绝对定位（建议 absolute bottom-24 left-4 z-30）。
 */

interface ProgressTask {
  genId: string
  /** 所属聊天轮次：用于在用户中断/被新消息覆盖时把仍在 generating 的卡片清掉 */
  requestId?: string
  /** 所属会话：用于切换会话时只保留当前会话的卡片（多会话生图不串台） */
  conversationId?: string
  status: 'generating' | 'completed' | 'error'
  prompt: string
  resultPath?: string
  error?: string
  createdAt: number
}

const tasks = ref<ProgressTask[]>([])
const autoCloseTimers = new Map<string, number>()
const chatStore = useChatStore()

let unsubscribe: (() => void) | null = null

function localFileUrl(path: string): string {
  if (!path) return ''
  const isAbsolute = /^[A-Za-z]:|^\//.test(path)
  const param = isAbsolute ? 'p' : 'rel'
  return 'local-file://img?' + param + '=' + encodeURIComponent(path)
}

function clearAutoClose(genId: string): void {
  const t = autoCloseTimers.get(genId)
  if (t) {
    clearTimeout(t)
    autoCloseTimers.delete(genId)
  }
}

function scheduleAutoClose(genId: string, delayMs: number): void {
  clearAutoClose(genId)
  const t = window.setTimeout(() => {
    tasks.value = tasks.value.filter((x) => x.genId !== genId)
    autoCloseTimers.delete(genId)
  }, delayMs)
  autoCloseTimers.set(genId, t)
}

function dismiss(genId: string): void {
  clearAutoClose(genId)
  tasks.value = tasks.value.filter((x) => x.genId !== genId)
}

function handleProgress(data: any): void {
  if (!data || data.source !== 'chat') return
  // 仅显示当前会话的生图：切走的会话的生图事件不进本浮窗（多会话同时生图不串台）。
  // conversationId 由主进程 emitProgress 透传（chat 工具调用必带）。
  if (data.conversationId && data.conversationId !== chatStore.currentConversationId) return
  if (data.requestId && chatStore.isRequestCanceled(data.requestId)) {
    if (data.genId) {
      clearAutoClose(data.genId)
      tasks.value = tasks.value.filter((x) => x.genId !== data.genId)
    }
    return
  }

  const genId = data.genId as string | undefined

  if (data.type === 'generating' && genId) {
    const exists = tasks.value.find((x) => x.genId === genId)
    if (!exists) {
      tasks.value = [
        ...tasks.value,
        {
          genId,
          requestId: data.requestId,
          conversationId: data.conversationId,
          status: 'generating',
          prompt: String(data.prompt || ''),
          createdAt: Date.now()
        }
      ]
    }
    return
  }

  if (data.type === 'completed' && genId) {
    const idx = tasks.value.findIndex((x) => x.genId === genId)
    const resultPath = data.generation?.result_path || ''
    const prompt = data.generation?.prompt || ''
    if (idx >= 0) {
      tasks.value[idx] = {
        ...tasks.value[idx],
        status: 'completed',
        resultPath,
        prompt: tasks.value[idx].prompt || prompt
      }
    } else {
      // 极端情况：错过了 generating 事件直接收到 completed，补建一条
      tasks.value = [
        ...tasks.value,
        {
          genId,
          conversationId: data.conversationId,
          status: 'completed',
          prompt,
          resultPath,
          createdAt: Date.now()
        }
      ]
    }
    scheduleAutoClose(genId, 5000)
    return
  }

  if (data.type === 'error' && genId) {
    const idx = tasks.value.findIndex((x) => x.genId === genId)
    const errorMsg = String(data.error || '生成失败')
    if (idx >= 0) {
      tasks.value[idx] = { ...tasks.value[idx], status: 'error', error: errorMsg }
    } else {
      tasks.value = [
        ...tasks.value,
        {
          genId,
          conversationId: data.conversationId,
          status: 'error',
          prompt: '',
          error: errorMsg,
          createdAt: Date.now()
        }
      ]
    }
  }
}

onMounted(() => {
  const api = (window as any).api
  if (api?.imageGen?.onProgress) {
    unsubscribe = api.imageGen.onProgress(handleProgress)
  }
})

// cancel 后没有后续 imageGen:progress 事件能触发清理时兜底：
// 监听 chat store 的取消集合变化，把仍在 generating 的同轮次卡片移除。
watchEffect(() => {
  const stale = tasks.value.filter(
    (t) => t.status === 'generating' && t.requestId && chatStore.isRequestCanceled(t.requestId)
  )
  if (!stale.length) return
  const staleIds = new Set(stale.map((t) => t.genId))
  for (const id of staleIds) clearAutoClose(id)
  tasks.value = tasks.value.filter((t) => !staleIds.has(t.genId))
})

// 切换会话：本浮窗只反映 currentConversationId 的生图，切走即清空，
// 避免上一个会话残留的卡片在新会话里继续显示。
watch(
  () => chatStore.currentConversationId,
  () => {
    for (const t of autoCloseTimers.values()) clearTimeout(t)
    autoCloseTimers.clear()
    tasks.value = []
  }
)

onBeforeUnmount(() => {
  if (unsubscribe) {
    unsubscribe()
    unsubscribe = null
  }
  for (const t of autoCloseTimers.values()) clearTimeout(t)
  autoCloseTimers.clear()
})

function statusText(task: ProgressTask): string {
  if (task.status === 'generating') return '正在生成图片…'
  if (task.status === 'completed') return '图片已生成'
  return '生成失败'
}
</script>

<template>
  <div v-if="tasks.length" class="space-y-1.5 pointer-events-none">
    <transition-group name="img-progress" tag="div" class="space-y-1.5">
      <div
        v-for="task in tasks"
        :key="task.genId"
        class="pointer-events-auto rounded-lg bg-surface-0 shadow-card border w-72 px-2 py-1.5 flex items-center gap-2"
        :class="task.status === 'error' ? 'border-red-200' : 'border-surface-3'"
        :title="task.error || task.prompt || ''"
      >
        <!-- 图标占位：完成→缩略图；进行中→旋转；失败→警告 -->
        <div class="w-5 h-5 rounded bg-surface-2 flex items-center justify-center flex-shrink-0 overflow-hidden">
          <img
            v-if="task.status === 'completed' && task.resultPath"
            :src="localFileUrl(task.resultPath)"
            class="w-full h-full object-cover"
            alt=""
          />
          <svg
            v-else-if="task.status === 'generating'"
            class="w-3 h-3 animate-spin text-primary-600"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path
              class="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          <svg v-else class="w-3 h-3 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>

        <!-- 单行：状态 + 提示词/错误，flex-1 + min-w-0 + truncate 让长内容省略 -->
        <div class="flex-1 min-w-0 text-[11px] leading-tight truncate">
          <span
            class="font-medium"
            :class="task.status === 'error' ? 'text-red-600' : 'text-text-primary'"
          >
            {{ statusText(task) }}
          </span>
          <span
            v-if="task.error"
            class="text-red-500 ml-1"
          >{{ task.error }}</span>
          <span
            v-else-if="task.prompt"
            class="text-text-tertiary ml-1"
          >{{ task.prompt }}</span>
        </div>

        <!-- 关闭按钮 -->
        <button
          @click="dismiss(task.genId)"
          class="text-text-tertiary hover:text-text-primary flex-shrink-0 p-0.5 rounded hover:bg-surface-2 transition-colors"
          title="关闭"
        >
          <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </transition-group>
  </div>
</template>

<style scoped>
.img-progress-enter-active,
.img-progress-leave-active {
  transition: opacity 200ms ease, transform 200ms ease;
}
.img-progress-enter-from {
  opacity: 0;
  transform: translateY(6px);
}
.img-progress-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
