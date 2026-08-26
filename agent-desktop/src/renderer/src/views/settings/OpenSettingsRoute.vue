<script setup lang="ts">
/**
 * 兼容旧路由 /settings 与 /settings?tab=connection：
 * 打开居中设置模态后回到对话页，避免再渲染全页设置。
 */
import { onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSettingsUiStore, type SettingsCategory } from '@/stores/settings-ui'

const VALID: SettingsCategory[] = ['general', 'preferences', 'connection', 'wallet', 'models', 'mcp', 'clawbot', 'data', 'about']

const route = useRoute()
const router = useRouter()
const settingsUi = useSettingsUiStore()

onMounted(() => {
  const raw = typeof route.query.tab === 'string' ? route.query.tab : ''
  if (raw === 'personas') {
    router.replace('/personas')
    return
  }
  const tab = (VALID as string[]).includes(raw) ? (raw as SettingsCategory) : undefined
  settingsUi.show(tab)
  router.replace('/chat')
})
</script>

<template>
  <div class="h-full" />
</template>
