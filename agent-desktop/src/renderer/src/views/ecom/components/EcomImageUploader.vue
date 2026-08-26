<template>
  <div>
    <div v-if="label" class="flex items-center gap-2 mb-1.5">
      <span class="text-sm font-medium text-text-primary">{{ label }}</span>
      <span v-if="hint" class="text-xs text-text-tertiary">{{ hint }}</span>
      <span class="text-xs text-text-tertiary ml-auto">{{ modelValue.length }}/{{ max }}</span>
    </div>

    <div
      class="rounded-lg border-2 border-dashed transition-colors p-3"
      :class="dragOver ? 'border-primary-500 bg-primary-50/30' : 'border-surface-3'"
      @dragover.prevent="dragOver = true"
      @dragleave.prevent="dragOver = false"
      @drop.prevent="onDrop"
    >
      <div class="grid gap-2" :style="{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }">
        <!-- 已上传缩略图 -->
        <div
          v-for="(img, i) in modelValue"
          :key="i"
          class="relative group aspect-square rounded-md overflow-hidden border border-surface-3 bg-surface-1"
        >
          <img :src="img.dataUrl" class="w-full h-full object-cover" :alt="img.name" />
          <button
            type="button"
            class="absolute top-1 right-1 w-5 h-5 rounded-full bg-surface-0/90 border border-surface-3 text-text-secondary opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center hover:text-error"
            title="移除"
            @click="removeAt(i)"
          >
            <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <!-- 添加块（点击：从电脑 / 从图库二选一） -->
        <button
          v-if="modelValue.length < max"
          type="button"
          :disabled="loading"
          class="aspect-square rounded-md border border-surface-3 bg-surface-1 hover:bg-surface-2 hover:border-primary-400 transition-colors flex flex-col items-center justify-center gap-1 text-text-tertiary disabled:opacity-60 disabled:cursor-not-allowed"
          @click="openPicker"
        >
          <svg v-if="loading" class="w-5 h-5 animate-spin text-primary-500" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.4 0 0 5.4 0 12h4z" />
          </svg>
          <svg v-else class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          <span class="text-[11px]">{{ loading ? '加载中' : '上传' }}</span>
        </button>
      </div>

      <p v-if="modelValue.length < max" class="mt-2 text-[10px] text-text-tertiary text-center">
        点击上传支持「从电脑选择 / 从图库选择」，也可直接拖拽图片到此
      </p>
    </div>

    <!-- 图片来源选择：本地上传 + 图库 -->
    <ImageSourcePickerDialog
      v-model:visible="pickerVisible"
      :title="label ? `选择${label}` : '选择图片'"
      :multiple="max > 1"
      @select="onSourceSelected"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import ImageSourcePickerDialog from '@/components/ImageSourcePickerDialog.vue'
import { loadAsDataUri } from '@/utils/image-source'
import { fileToUploadedImage } from '../utils'
import type { UploadedImage } from '../types'

const props = withDefaults(
  defineProps<{
    modelValue: UploadedImage[]
    max?: number
    label?: string
    hint?: string
    /** 每行缩略图列数 */
    cols?: number
  }>(),
  { max: 1, label: '', hint: '', cols: 4 },
)

const emit = defineEmits<{ (e: 'update:modelValue', v: UploadedImage[]): void }>()

const dragOver = ref(false)
const pickerVisible = ref(false)
const loading = ref(false)
const cols = computed(() => props.cols)

function openPicker(): void {
  if (loading.value || props.modelValue.length >= props.max) return
  pickerVisible.value = true
}

/** 来源选择回调：本地路径 / 图库路径统一经 loadAsDataUri 转为压缩 dataURL。 */
async function onSourceSelected(paths: string[]): Promise<void> {
  const room = props.max - props.modelValue.length
  if (room <= 0 || !paths.length) return
  loading.value = true
  try {
    const items = await loadAsDataUri(paths.slice(0, room), { maxSize: 1536, quality: 0.9 })
    const loaded: UploadedImage[] = items.map((it) => ({
      dataUrl: it.dataUri,
      name: it.name.replace(/\.[^.]+$/, '') || 'image',
    }))
    if (loaded.length) emit('update:modelValue', [...props.modelValue, ...loaded])
  } finally {
    loading.value = false
  }
}

/** 拖拽上传（本地文件直接读取压缩）。 */
async function addFiles(files: File[]): Promise<void> {
  const room = props.max - props.modelValue.length
  if (room <= 0) return
  const picked = files.filter((f) => f.type.startsWith('image/')).slice(0, room)
  if (!picked.length) return
  loading.value = true
  try {
    const loaded = await Promise.all(picked.map((f) => fileToUploadedImage(f)))
    emit('update:modelValue', [...props.modelValue, ...loaded])
  } finally {
    loading.value = false
  }
}

async function onDrop(e: DragEvent): Promise<void> {
  dragOver.value = false
  if (e.dataTransfer?.files) await addFiles(Array.from(e.dataTransfer.files))
}

function removeAt(i: number): void {
  const next = props.modelValue.slice()
  next.splice(i, 1)
  emit('update:modelValue', next)
}
</script>
