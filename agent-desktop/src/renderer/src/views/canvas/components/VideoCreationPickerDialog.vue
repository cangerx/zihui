<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div
        v-if="visible"
        class="fixed inset-0 z-[9600] flex items-center justify-center p-6 pointer-events-none"
        @click="close"
      >
        <div
          class="w-full max-w-2xl max-h-[80vh] bg-surface-0 rounded-2xl shadow-2xl flex flex-col pointer-events-auto"
          @click.stop
        >
          <div class="flex items-center justify-between px-5 py-3 border-b border-surface-2">
            <h3 class="text-sm font-semibold text-text-primary">从视频创作选择</h3>
            <button class="text-text-tertiary hover:text-text-primary" @click="close">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>

          <div class="flex-1 overflow-y-auto p-4">
            <div v-if="loading" class="text-center text-xs text-text-tertiary py-12">加载中...</div>
            <div v-else-if="!videos.length" class="text-center text-xs text-text-tertiary py-12">
              暂无已保存到本地的视频。<br />请先在「视频创作」中保存视频后再选择。
            </div>
            <div v-else class="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <button
                v-for="v in videos"
                :key="v.id"
                type="button"
                class="text-left rounded-lg border border-surface-3 overflow-hidden hover:border-primary-400 transition-colors"
                @click="choose(v)"
              >
                <div class="aspect-video bg-black">
                  <video :src="localVideoUrl(v)" muted preload="metadata" class="w-full h-full object-contain"></video>
                </div>
                <div class="px-2 py-1.5">
                  <div class="text-[11px] text-text-primary truncate">{{ v.model_name || v.prompt || 'AI 视频' }}</div>
                  <div class="text-[10px] text-text-tertiary truncate">{{ v.duration_seconds || '-' }} 秒 · {{ v.aspect_ratio || '-' }}</div>
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

interface VideoItem {
  id: string
  model_name: string
  prompt: string
  duration_seconds: number
  aspect_ratio: string
  local_path: string
  local_exists: boolean
}

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'select', item: VideoItem): void
}>()

const api = () => (window as any).api
const loading = ref(false)
const videos = ref<VideoItem[]>([])

function localVideoUrl(item: VideoItem): string {
  if (!item.local_path || !item.local_exists) return ''
  const isAbsolute = /^[A-Za-z]:|^\//.test(item.local_path)
  const param = isAbsolute ? 'p' : 'rel'
  return 'local-file://video?' + param + '=' + encodeURIComponent(item.local_path)
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const res = (await api().videoGen.invoke('list', {
      page: 1,
      pageSize: 50,
      status: 'completed',
      downloadStatus: 'downloaded',
    })) as { items: VideoItem[] }
    // download_status 可能为 downloaded 但文件已被删，故再按 local_exists 兜底过滤
    videos.value = (res.items || []).filter((v) => v.local_exists && v.local_path)
  } catch {
    videos.value = []
  } finally {
    loading.value = false
  }
}

function close(): void {
  emit('update:visible', false)
}

function choose(item: VideoItem): void {
  emit('select', item)
  emit('update:visible', false)
}

watch(
  () => props.visible,
  (v) => {
    if (v) load()
  },
)
</script>

<style scoped>
.dialog-enter-active,
.dialog-leave-active {
  transition: opacity 150ms ease, transform 150ms ease;
}
.dialog-enter-from,
.dialog-leave-to {
  opacity: 0;
  transform: scale(0.98);
}
</style>
