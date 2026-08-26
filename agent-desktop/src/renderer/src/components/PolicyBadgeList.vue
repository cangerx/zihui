<template>
  <div class="flex flex-wrap gap-1.5">
    <span
      v-for="item in visibleItems"
      :key="item.key"
      class="text-[10px] px-2 py-0.5 rounded-full bg-surface-2 text-text-secondary border border-surface-3"
    >{{ item.label }}</span>
    <span v-if="!visibleItems.length" class="text-[11px] text-text-tertiary">暂无策略</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  policies?: Record<string, any> | null
  limit?: number
}>(), {
  policies: null,
  limit: 8,
})

const labelMap: Record<string, string> = {
  allow_custom_provider: '自定义模型',
  allow_custom_embedding: '自定义向量',
  allow_custom_video_provider: '自定义视频',
  allow_image_gen: 'AI 生图',
  allow_knowledge_base: '知识库',
  allow_image_matting: '快速抠图',
  allow_custom_matting_provider: '自定义抠图',
  allow_fine_matting: '精细抠图',
  max_context_messages: '上下文',
  chat_quota_per_day: '日对话',
  chat_quota_per_month: '月对话',
  image_quota_per_day: '日生图',
  image_quota_per_month: '月生图',
  embed_chars_per_day: '日向量字符',
  embed_chars_per_month: '月向量字符',
  matting_quota_per_day: '日快速抠图',
  matting_quota_per_month: '月快速抠图',
  image_matting_quota_per_month: '月快速抠图',
  fine_matting_quota_per_day: '日精细抠图',
  fine_matting_quota_per_month: '月精细抠图',
}

const visibleItems = computed(() => {
  const entries = Object.entries(props.policies || {})
    .filter(([key, value]) => shouldShow(key, value))
    .slice(0, props.limit)
  return entries.map(([key, value]) => ({ key, label: `${labelMap[key] || key}: ${formatValue(value)}` }))
})

function shouldShow(key: string, value: any): boolean {
  if (value === false || value === null || value === undefined || value === '') return false
  if (typeof value === 'number' && value <= 0 && key.includes('quota')) return false
  return true
}

function formatValue(value: any): string {
  if (value === true) return '可用'
  if (value === false) return '不可用'
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2)
  if (typeof value === 'object') {
    if (value?.limit !== undefined) return String(value.limit)
    return '已配置'
  }
  return String(value)
}
</script>
