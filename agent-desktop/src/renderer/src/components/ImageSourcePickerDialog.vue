<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="fixed inset-0 z-50 flex items-center justify-center"
      @click.self="cancel"
    >
      <div class="bg-surface-0 rounded-xl shadow-[0_0_40px_rgba(0,0,0,0.18)] w-full max-w-md p-6">
        <div class="flex items-center justify-between mb-5">
          <h3 class="text-sm font-semibold text-text-primary">{{ title }}</h3>
          <button
            class="p-1 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-2 transition-colors"
            @click="cancel"
            title="取消"
          >
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <p v-if="hint" class="text-xs text-text-tertiary mb-4">{{ hint }}</p>

        <div class="grid grid-cols-2 gap-3">
          <button
            class="aspect-[4/3] flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-surface-3 hover:border-primary-400 hover:bg-primary-50/40 dark:hover:bg-primary-900/10 text-text-secondary hover:text-primary-700 transition-colors group"
            @click="chooseLocal"
          >
            <svg class="w-7 h-7 transition-transform group-hover:scale-110" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 0 0-1.883 2.542l.857 6a2.25 2.25 0 0 0 2.227 1.932H19.05a2.25 2.25 0 0 0 2.227-1.932l.857-6a2.25 2.25 0 0 0-1.883-2.542m-16.5 0V6A2.25 2.25 0 0 1 6 3.75h3.879a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 0 1.06.44H18A2.25 2.25 0 0 1 20.25 9v.776" />
            </svg>
            <span class="text-sm font-medium">从电脑选择</span>
            <span class="text-[10px] text-text-tertiary">浏览本地文件</span>
          </button>

          <button
            class="aspect-[4/3] flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-surface-3 hover:border-primary-400 hover:bg-primary-50/40 dark:hover:bg-primary-900/10 text-text-secondary hover:text-primary-700 transition-colors group"
            @click="chooseGallery"
          >
            <svg class="w-7 h-7 transition-transform group-hover:scale-110" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
            </svg>
            <span class="text-sm font-medium">从图库选择</span>
            <span class="text-[10px] text-text-tertiary">本地图库 / 我的创作</span>
          </button>
        </div>

        <div class="mt-5 flex justify-end">
          <button
            class="px-3 py-1.5 text-xs text-text-tertiary hover:text-text-secondary hover:bg-surface-2 rounded-lg transition-colors"
            @click="cancel"
          >取消</button>
        </div>
      </div>
    </div>

    <GalleryPicker
      v-model:visible="showGallery"
      :multiple="multiple"
      @select="onGallerySelected"
    />
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import GalleryPicker from './GalleryPicker.vue'
import { pickFromLocal } from '@/utils/image-source'

const props = withDefaults(defineProps<{
  visible: boolean
  title?: string
  hint?: string
  multiple?: boolean
}>(), {
  title: '选择图片',
  hint: '',
  multiple: false
})

const emit = defineEmits<{
  (e: 'update:visible', val: boolean): void
  (e: 'select', paths: string[]): void
  (e: 'cancel'): void
}>()

const showGallery = ref(false)

watch(() => props.visible, (val) => {
  if (!val) showGallery.value = false
})

async function chooseLocal() {
  const paths = await pickFromLocal({ multiple: props.multiple })
  if (paths.length) {
    emit('select', paths)
    emit('update:visible', false)
  }
  // 用户在系统对话框点取消，保持当前选择器开着，不强制关闭
}

function chooseGallery() {
  showGallery.value = true
}

function onGallerySelected(paths: string[]) {
  showGallery.value = false
  if (paths.length) {
    emit('select', paths)
    emit('update:visible', false)
  }
}

function cancel() {
  emit('update:visible', false)
  emit('cancel')
}
</script>
