<template>
  <!-- 去AI标记「已处理」角标：纯文字单色，无图标、无渐变 -->
  <span class="inline-flex items-center px-1.5 py-0.5 rounded bg-primary-600 text-white text-[10px] leading-none select-none">{{ label }}</span>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ label?: string }>(), { label: '已处理' })
</script>
