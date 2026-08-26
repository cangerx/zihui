<template>
  <div class="h-full flex flex-col items-center justify-center px-6 py-12 text-center">
    <div class="w-20 h-20 rounded-2xl bg-surface-2 flex items-center justify-center mb-6">
      <svg class="w-10 h-10 text-text-disabled" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 8v4l3 2" />
        <circle cx="12" cy="12" r="9" />
      </svg>
    </div>
    <h2 class="text-base font-semibold text-text-primary mb-2">{{ pageTitle }}</h2>
    <p class="text-sm text-text-secondary mb-1">该功能正在开发中</p>
    <p class="text-xs text-text-tertiary max-w-md">敬请期待，更多能力即将上线。</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const pageTitle = computed(() => (route.meta?.title as string) || '功能开发中')
</script>
