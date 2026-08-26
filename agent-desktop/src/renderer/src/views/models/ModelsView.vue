<template>
  <div :class="embedded ? 'h-full min-h-0 flex flex-col' : 'h-full flex flex-col'">
    <div v-if="embedded" class="flex-shrink-0 px-6 pt-5 pb-3 pr-12">
      <h2 class="text-base font-semibold text-text-primary">模型</h2>
    </div>

    <div
      v-if="!hasAnyModelPermission"
      class="px-6 py-8 text-center text-xs text-text-tertiary"
    >
      当前账号未开通自定义模型权限，请联系管理员。
    </div>

    <template v-else>
      <div class="flex-shrink-0 px-6">
        <div class="inline-flex items-center gap-0.5 p-0.5 rounded-full bg-surface-2">
          <button
            v-for="t in visibleTabs"
            :key="t.key"
            type="button"
            class="px-3 py-1.5 text-xs font-medium rounded-full transition-colors"
            :class="
              activeTab === t.key
                ? 'bg-surface-0 text-text-primary shadow-sm'
                : 'text-text-secondary hover:text-text-primary'
            "
            @click="onTabChange(t.key)"
          >
            {{ t.label }}
          </button>
        </div>
      </div>

      <div class="flex-1 min-h-0 mt-3 overflow-hidden">
        <component
          :is="currentComponent"
          :key="activeTab"
          :embedded="embedded"
          v-bind="activeTab === 'usage' ? {} : { mode: currentMode }"
        />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * 模型服务 tab 容器（D-24）。
 * - 全页：?tab=text|image|usage
 * - 嵌入设置：本地 tab 状态
 */
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useCloudAuthStore } from '@/stores/cloud-auth'

const props = withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

const route = useRoute()
const router = useRouter()
const cloudAuth = useCloudAuthStore()

const TextTab = defineAsyncComponent(() => import('./ModelView.vue'))
const VideoTab = defineAsyncComponent(() => import('./VideoProvidersTab.vue'))
const SpeechTab = defineAsyncComponent(() => import('./SpeechProvidersTab.vue'))
const UsageTab = defineAsyncComponent(() => import('./ModelUsagePane.vue'))

type TabKey = 'text' | 'image' | 'video' | 'speech' | 'usage'

interface TabDef {
  key: TabKey
  label: string
  visible: boolean
  component: any
}

const localTab = ref<TabKey>('text')

const hasAnyModelPermission = computed(
  () =>
    Boolean(cloudAuth.permissions.allow_custom_provider) ||
    Boolean(cloudAuth.permissions.allow_custom_video_provider) ||
    Boolean(cloudAuth.permissions.allow_custom_matting_provider) ||
    cloudAuth.isLoggedIn,
)

const visibleTabs = computed<TabDef[]>(() => {
  const all: TabDef[] = [
    { key: 'text', label: '文本生成', visible: true, component: TextTab },
    { key: 'image', label: '图像生成', visible: true, component: TextTab },
    { key: 'video', label: '视频生成', visible: true, component: VideoTab },
    { key: 'speech', label: '语音生成', visible: true, component: SpeechTab },
    { key: 'usage', label: '使用统计', visible: true, component: UsageTab },
  ]
  return all.filter((t) => t.visible)
})

const activeTab = computed<TabKey>(() => {
  if (props.embedded) {
    if (visibleTabs.value.some((t) => t.key === localTab.value)) return localTab.value
    return (visibleTabs.value[0]?.key as TabKey) || 'text'
  }
  const q = String(route.query.modelsTab || route.query.tab || '')
  if ((q === 'text' || q === 'image' || q === 'video' || q === 'speech' || q === 'usage' || q === 'general') && visibleTabs.value.some((t) => t.key === normalizeLegacy(q))) {
    return normalizeLegacy(q)
  }
  return (visibleTabs.value[0]?.key as TabKey) || 'text'
})

function normalizeLegacy(q: string): TabKey {
  if (q === 'general' || q === 'matting') return 'text'
  if (q === 'image' || q === 'video' || q === 'speech' || q === 'usage') return q
  return 'text'
}

const currentMode = computed<'chat' | 'image'>(() => (activeTab.value === 'image' ? 'image' : 'chat'))

const currentComponent = computed(() => {
  const hit = visibleTabs.value.find((t) => t.key === activeTab.value)
  return hit?.component || TextTab
})

function onTabChange(key: TabKey) {
  if (props.embedded) {
    localTab.value = key
    return
  }
  router.replace({ path: route.path, query: { ...route.query, tab: key } })
}

onMounted(() => {
  if (props.embedded) {
    localTab.value = (visibleTabs.value[0]?.key as TabKey) || 'text'
    return
  }
  if (!route.query.tab && visibleTabs.value.length) {
    router.replace({ path: '/models', query: { ...route.query, tab: activeTab.value } })
  }
})

watch(visibleTabs, (list) => {
  if (!list.length) return
  if (props.embedded) {
    if (!list.some((t) => t.key === localTab.value)) {
      localTab.value = list[0].key
    }
    return
  }
  const cur = normalizeLegacy(String(route.query.tab || ''))
  if (!list.some((t) => t.key === cur)) {
    router.replace({ path: '/models', query: { ...route.query, tab: list[0].key } })
  }
})
</script>
