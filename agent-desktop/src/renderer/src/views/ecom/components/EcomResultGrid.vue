<template>
  <div>
    <!-- 工具条：有任务时显示统计与操作（取消 / 清空 / 按顺序导出） -->
    <div v-if="tasks.length" class="flex items-center justify-between mb-3">
      <span class="text-xs text-text-tertiary">
        已生成 {{ successCount }} / {{ tasks.length }}
      </span>
      <div class="flex items-center gap-2">
        <button
          v-if="generating"
          type="button"
          class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-surface-3 text-text-secondary hover:bg-surface-2 hover:text-error transition-colors"
          title="停止启动后续任务（已在生成的会自然完成）"
          @click="$emit('cancel')"
        >
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M5.25 7.5A2.25 2.25 0 0 1 7.5 5.25h9a2.25 2.25 0 0 1 2.25 2.25v9a2.25 2.25 0 0 1-2.25 2.25h-9a2.25 2.25 0 0 1-2.25-2.25v-9Z" />
          </svg>
          取消生成
        </button>
        <template v-else>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-surface-3 text-text-secondary hover:bg-surface-2 hover:text-text-primary transition-colors"
            title="清空当前结果"
            @click="$emit('clear')"
          >
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
            </svg>
            清空
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-surface-3 text-text-secondary hover:bg-surface-2 hover:text-text-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            :disabled="!successCount || exporting"
            :title="successCount ? '按生成顺序导出全部图片到文件夹' : '暂无可导出的图片'"
            @click="exportAll"
          >
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            {{ exporting ? '导出中…' : '按顺序导出' }}
          </button>
        </template>
      </div>
    </div>

    <div v-if="!tasks.length" class="h-full flex items-center justify-center text-sm text-text-tertiary py-16">
      生成结果会显示在这里
    </div>
    <div
      v-else
      class="grid gap-3"
      :style="{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }"
    >
      <div
        v-for="t in tasks"
        :key="t.id"
        class="relative group rounded-lg overflow-hidden border bg-surface-1 aspect-square"
        :class="selectable && pickedIndex(t.resultPath) >= 0 ? 'border-primary-500 ring-2 ring-primary-400' : 'border-surface-3'"
      >
        <!-- 成功：缩略图（选图模式点击切换选中，否则点击大图预览） -->
        <img
          v-if="t.status === 'success'"
          :src="t.url"
          class="w-full h-full object-cover"
          :class="selectable ? 'cursor-pointer' : 'cursor-zoom-in'"
          :alt="t.label"
          @click="onImageClick(t)"
        />
        <!-- 选图模式：选中序号角标 -->
        <span
          v-if="selectable && t.status === 'success' && pickedIndex(t.resultPath) >= 0"
          class="absolute top-1.5 left-1.5 z-10 text-[11px] font-medium bg-primary-600 text-white rounded-full w-5 h-5 flex items-center justify-center shadow"
        >{{ pickedIndex(t.resultPath) + 1 }}</span>

        <!-- 处理中 -->
        <div v-else-if="t.status === 'loading' || t.status === 'pending'" class="absolute inset-0 flex flex-col items-center justify-center gap-2 text-text-tertiary">
          <svg class="w-6 h-6 animate-spin text-primary-500" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.4 0 0 5.4 0 12h4z" />
          </svg>
          <span class="text-[11px]">{{ t.status === 'pending' ? '排队中' : '生成中' }}</span>
        </div>

        <!-- 失败 -->
        <div v-else-if="t.status === 'error'" class="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3 text-center">
          <span class="text-[11px] text-error line-clamp-3" :title="t.error">{{ t.error }}</span>
          <button class="text-[11px] px-2 py-1 rounded-md border border-surface-3 text-text-secondary hover:bg-surface-2" @click="$emit('retry', t.id)">重试</button>
        </div>

        <!-- 序号 + 底部标签条 -->
        <div class="absolute bottom-0 inset-x-0 px-2 py-1 bg-surface-0/85 backdrop-blur-sm text-[10px] text-text-secondary truncate" :title="t.label">
          {{ t.label }}
        </div>

        <!-- 成功 hover 操作 -->
        <div
          v-if="t.status === 'success'"
          class="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <button v-if="selectable" class="action-btn" title="预览大图" @click="preview(t)">
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" /></svg>
          </button>
          <button class="action-btn" title="打开" @click="openImage(t)">
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" /></svg>
          </button>
          <button class="action-btn" title="复制图片" @click="copyImage(t)">
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m11.25 5.5H16.5a1.125 1.125 0 0 1-1.125-1.125v-3.5" /></svg>
          </button>
          <button class="action-btn" title="在文件夹中显示" @click="revealImage(t)">
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" /></svg>
          </button>
        </div>
      </div>
    </div>

    <!-- 轻量提示（导出反馈） -->
    <div
      v-if="toast"
      class="fixed left-1/2 -translate-x-1/2 bottom-6 z-50 px-4 py-2 rounded-lg border shadow-lg text-sm"
      :class="toast.type === 'success'
        ? 'bg-green-50 border-green-200 text-green-700 dark:bg-green-900/20 dark:border-green-800 dark:text-green-300'
        : 'bg-red-50 border-red-200 text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-300'"
    >
      {{ toast.text }}
    </div>

    <!-- 大图预览 -->
    <ImageLightbox
      :src="previewSrc"
      :alt="previewTask?.label"
      :on-copy="copyPreview"
      :on-locate="locatePreview"
      @close="previewTask = null"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import ImageLightbox from '@/components/ImageLightbox.vue'
import type { EcomGenTask } from '../types'

const props = withDefaults(
  defineProps<{
    tasks: EcomGenTask[]
    generating?: boolean
    /** 选图模式：成功项可点选，点击图片切换选中（而非大图预览）。默认 false，ecom 各页行为不变。 */
    selectable?: boolean
    /** 已选中的 result_path 列表（用于高亮 + 序号角标）。 */
    pickedPaths?: string[]
  }>(),
  {
    generating: false,
    selectable: false,
    pickedPaths: () => [],
  },
)
const emit = defineEmits<{
  (e: 'retry', id: string): void
  (e: 'clear'): void
  (e: 'cancel'): void
  (e: 'toggle-pick', payload: { path: string; url: string }): void
}>()

function pickedIndex(path: string): number {
  return props.pickedPaths.indexOf(path)
}
function onImageClick(t: EcomGenTask): void {
  if (props.selectable) emit('toggle-pick', { path: t.resultPath, url: t.url })
  else preview(t)
}

const api = () => (window as any).api

const successTasks = computed(() => props.tasks.filter((t) => t.status === 'success' && t.resultPath))
const successCount = computed(() => successTasks.value.length)

// 大图预览
const previewTask = ref<EcomGenTask | null>(null)
const previewSrc = computed(() => previewTask.value?.url || '')
function preview(t: EcomGenTask): void {
  if (t.status === 'success') previewTask.value = t
}
async function copyPreview(): Promise<void> {
  if (previewTask.value) await copyImage(previewTask.value)
}
async function locatePreview(): Promise<void> {
  if (previewTask.value) await revealImage(previewTask.value)
}

const exporting = ref(false)
const toast = ref<{ text: string; type: 'success' | 'error' } | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | null = null
function showToast(text: string, type: 'success' | 'error' = 'success', duration = 3500): void {
  if (toastTimer) clearTimeout(toastTimer)
  toast.value = { text, type }
  toastTimer = setTimeout(() => {
    toast.value = null
  }, duration)
}

/** 按生成顺序把成功的图导出到用户选定目录（命名 {NN}-{标签}.{ext}）。 */
async function exportAll(): Promise<void> {
  if (!successCount.value || exporting.value) return
  const items = successTasks.value.map((t) => ({ path: t.resultPath, name: t.label }))
  exporting.value = true
  try {
    const res = await api().imageGen.invoke('exportImages', items)
    if (res?.canceled) return
    if (res?.success) {
      const skipped = (res.total ?? items.length) - (res.exported ?? 0)
      showToast(
        skipped > 0
          ? `已按顺序导出 ${res.exported} 张（${skipped} 张失败）`
          : `已按顺序导出 ${res.exported} 张到所选文件夹`,
      )
    } else {
      showToast(`导出失败：${res?.error || '未知错误'}`, 'error')
    }
  } catch (e: any) {
    showToast(`导出失败：${e?.message || e}`, 'error')
  } finally {
    exporting.value = false
  }
}

async function absPath(rel: string): Promise<string> {
  if (/^[A-Za-z]:|^\//.test(rel)) return rel
  return (await api().imageGen.invoke('getAbsolutePath', rel)) as string
}
async function openImage(t: EcomGenTask): Promise<void> {
  try {
    await api().shell.openPath(await absPath(t.resultPath))
  } catch {
    /* ignore */
  }
}
async function copyImage(t: EcomGenTask): Promise<void> {
  try {
    await api().clipboard.writeImage(await absPath(t.resultPath))
  } catch {
    /* ignore */
  }
}
async function revealImage(t: EcomGenTask): Promise<void> {
  try {
    await api().shell.showItemInFolder(await absPath(t.resultPath))
  } catch {
    /* ignore */
  }
}
</script>

<style scoped>
.action-btn {
  @apply w-6 h-6 rounded-md bg-surface-0 border border-surface-3 text-text-secondary flex items-center justify-center hover:text-primary-600 hover:bg-surface-2 transition-colors;
}
</style>
