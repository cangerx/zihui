<template>
  <!-- 仅阴影、无背景遮罩(CLAUDE.md): 背景不拦截点击, 卡片用阴影 -->
  <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
    <div class="pointer-events-auto w-[420px] bg-surface-0 rounded-xl shadow-2xl border border-surface-3 p-5">
      <h3 class="text-sm font-semibold text-text-primary">导出视频需要 ffmpeg</h3>
      <p class="text-xs text-text-tertiary mt-2 leading-relaxed">
        MP4 视频导出依赖 ffmpeg / ffprobe，当前未检测到可用版本（已在系统 PATH 与应用目录查找）。
      </p>
      <p v-if="reason" class="text-xs text-text-disabled mt-1">原因：{{ reason }}</p>
      <p class="text-xs text-text-tertiary mt-2 leading-relaxed">
        安装方式：将 ffmpeg / ffprobe 加入系统 PATH，或等待云控端按需下发。安装后点“重新检测”。
        其余格式（PPTX / PDF / GIF）无需 ffmpeg，可直接导出。
      </p>
      <div class="flex justify-end gap-2 mt-4">
        <button
          class="px-3 py-1.5 text-xs rounded-lg border border-surface-3 hover:bg-surface-2 disabled:opacity-50"
          :disabled="installing"
          @click="$emit('close')"
        >
          知道了
        </button>
        <button
          class="px-3 py-1.5 text-xs rounded-lg border border-surface-3 hover:bg-surface-2 disabled:opacity-50"
          :disabled="installing"
          @click="$emit('recheck')"
        >
          重新检测
        </button>
        <button
          class="px-3 py-1.5 text-xs rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
          :disabled="installing"
          @click="$emit('install')"
        >
          {{ installing ? '下载中…' : '从云端下载安装' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ open: boolean; reason: string; installing: boolean }>()
defineEmits<{ (e: 'close'): void; (e: 'recheck'): void; (e: 'install'): void }>()
</script>
