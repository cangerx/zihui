<template>
  <div class="h-full flex flex-col min-h-0">
    <div class="flex items-center justify-between mb-2">
      <h4 class="text-xs font-medium text-text-secondary">图层</h4>
      <span class="text-[10px] text-text-tertiary">{{ layers.length }}</span>
    </div>
    <p class="text-[10px] text-text-tertiary leading-relaxed mb-2">
      图层来自底图以及你添加的文字、贴图、画笔。也可以把底图拆成主体和背景两层（人物或物品都行）。
    </p>
    <div class="flex-1 overflow-y-auto space-y-1 min-h-0">
      <div
        v-for="(layer, index) in layers"
        :key="layer.id"
        draggable="true"
        class="rounded-lg border px-1.5 py-1.5 cursor-pointer transition-colors"
        :class="layer.id === selectedId ? 'border-primary-500 bg-primary-50' : 'border-surface-3 hover:bg-surface-2'"
        @click="emit('select', layer.id)"
        @dragstart="onDragStart(index, $event)"
        @dragover.prevent
        @drop.prevent="onDrop(index)"
      >
        <div class="flex items-center gap-1.5">
          <div
            class="w-7 h-7 rounded border border-surface-3 flex-shrink-0 flex items-center justify-center text-[9px] text-text-tertiary bg-surface-2"
            :title="typeLabel(layer.type)"
          >{{ typeShort(layer.type) }}</div>
          <button
            type="button"
            class="w-5 h-5 flex items-center justify-center text-text-tertiary hover:text-text-primary"
            :title="layer.visible ? '隐藏' : '显示'"
            @click.stop="emit('toggle-visible', layer.id)"
          >
            <svg v-if="layer.visible" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.964-7.178Z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
            </svg>
            <svg v-else class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
            </svg>
          </button>
          <button
            type="button"
            class="w-5 h-5 flex items-center justify-center text-text-tertiary hover:text-text-primary"
            :title="layer.locked ? '解锁' : '锁定'"
            @click.stop="emit('toggle-lock', layer.id)"
          >
            <svg v-if="layer.locked" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
            </svg>
            <svg v-else class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M13.5 10.5V6.75a4.5 4.5 0 1 1 9 0v3.75M3.75 21.75h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H3.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
            </svg>
          </button>
          <input
            :value="layer.name"
            class="flex-1 min-w-0 bg-transparent text-[11px] text-text-primary outline-none"
            @click.stop
            @change="emit('rename', layer.id, ($event.target as HTMLInputElement).value)"
          />
          <span class="text-[9px] text-text-tertiary flex-shrink-0">{{ typeLabel(layer.type) }}</span>
        </div>
        <div v-if="layer.id === selectedId" class="mt-1.5 pl-1">
          <div class="flex items-center justify-between mb-0.5">
            <span class="text-[10px] text-text-tertiary">透明度</span>
            <span class="text-[10px] text-text-tertiary">{{ layer.opacity }}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            :value="layer.opacity"
            class="w-full h-1 accent-primary-600"
            @click.stop
            @input="emit('opacity', layer.id, Number(($event.target as HTMLInputElement).value))"
            @change="emit('opacity-commit', layer.id, Number(($event.target as HTMLInputElement).value))"
          />
        </div>
      </div>
      <p v-if="!layers.length" class="text-[11px] text-text-tertiary py-4 text-center">暂无图层</p>
    </div>
    <button
      type="button"
      class="w-full mt-2 px-2 py-1.5 text-[11px] rounded-lg border border-surface-3 text-text-secondary hover:bg-surface-2 disabled:opacity-40"
      :disabled="splitting || hasSubject"
      :title="hasSubject ? '已经拆过主体和背景，可先点重置再拆' : '用抠图把底图拆成主体和背景两层，人物或物品都可以'"
      @click="emit('split-subject')"
    >{{ splitting ? '拆层中...' : '拆主体 / 背景' }}</button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ImageLayer, ImageLayerType } from '@shared/image-doc'

const props = defineProps<{
  layers: ImageLayer[]
  selectedId: string
  splitting?: boolean
}>()

const emit = defineEmits<{
  select: [id: string]
  'toggle-visible': [id: string]
  'toggle-lock': [id: string]
  rename: [id: string, name: string]
  opacity: [id: string, value: number]
  'opacity-commit': [id: string, value: number]
  reorder: [fromIndex: number, toIndex: number]
  'split-subject': []
}>()

const hasSubject = computed(() => props.layers.some(l => l.type === 'subject'))

let dragFrom = -1

function typeLabel(type: ImageLayerType): string {
  if (type === 'raster') return '底图'
  if (type === 'text') return '文字'
  if (type === 'draw') return '画笔'
  if (type === 'subject') return '主体'
  return '贴图'
}

function typeShort(type: ImageLayerType): string {
  if (type === 'raster') return '底'
  if (type === 'text') return '文'
  if (type === 'draw') return '笔'
  if (type === 'subject') return '主'
  return '贴'
}

function onDragStart(index: number, e: DragEvent) {
  dragFrom = index
  e.dataTransfer?.setData('text/plain', String(index))
}

function onDrop(index: number) {
  if (dragFrom < 0 || dragFrom === index) return
  emit('reorder', dragFrom, index)
  dragFrom = -1
}
</script>
