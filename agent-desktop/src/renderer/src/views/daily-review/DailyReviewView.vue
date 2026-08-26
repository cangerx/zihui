<template>
  <div class="h-full flex flex-col bg-surface-0">
    <header class="flex-shrink-0 h-12 px-5 flex items-center gap-3 border-b border-surface-2">
      <h1 class="text-sm font-semibold text-text-primary">每日回顾</h1>
      <div class="flex-1" />
      <ChatModelSwitcher
        :provider-id="draftModel.provider_id"
        :model-id="draftModel.model_id"
        prefix="生成："
        direction="down"
        @change="onModelChange"
      />
      <button
        type="button"
        class="px-3 py-1.5 text-xs font-medium rounded-full border border-surface-3 text-text-secondary hover:bg-surface-1 disabled:opacity-50"
        :disabled="generating"
        @click="generate('daily')"
      >{{ generatingKind === 'daily' ? '生成中…' : '生成每日回顾' }}</button>
      <button
        type="button"
        class="px-3 py-1.5 text-xs font-medium rounded-full text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50"
        :disabled="generating"
        @click="generate('deep')"
      >{{ generatingKind === 'deep' ? '生成中…' : '生成深度分析' }}</button>
    </header>

    <div class="flex-1 min-h-0 flex">
      <!-- 历史列表 -->
      <aside class="w-64 flex-shrink-0 border-r border-surface-2 bg-surface-0 flex flex-col">
        <div class="px-4 py-3 border-b border-surface-2">
          <div class="text-sm font-medium text-text-primary">历史</div>
          <p class="text-[11px] text-text-tertiary mt-1 leading-relaxed">
            自动总结对话与遗漏事项。当前为手动生成。
          </p>
        </div>
        <div class="flex-1 overflow-y-auto py-1">
          <button
            v-for="item in reviews"
            :key="item.id"
            type="button"
            class="w-full text-left px-4 py-2.5 text-xs transition-colors border-l-2"
            :class="selectedId === item.id
              ? 'bg-surface-2 border-primary-600 text-text-primary'
              : 'border-transparent text-text-secondary hover:bg-surface-2'"
            @click="selectedId = item.id"
          >
            <div class="font-medium truncate">{{ item.title }}</div>
            <div class="text-[10px] text-text-tertiary mt-0.5">{{ formatTime(item.created_at) }}</div>
          </button>
          <div v-if="!reviews.length" class="px-4 py-8 text-center text-xs text-text-tertiary">
            还没有回顾记录
          </div>
        </div>
      </aside>

      <!-- 详情 -->
      <main class="flex-1 min-w-0 overflow-y-auto px-8 py-6">
        <div v-if="!selected" class="h-full flex items-center justify-center">
          <div class="text-center max-w-sm">
            <p class="text-sm text-text-secondary">选择左侧记录，或点击上方按钮生成回顾。</p>
            <p class="text-[11px] text-text-tertiary mt-2 leading-relaxed">
              每日回顾覆盖今天；深度分析覆盖近 7 天。数据来自本机对话记录，模型走你当前选择的对话模型。
            </p>
          </div>
        </div>

        <div v-else class="max-w-2xl mx-auto space-y-4">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h2 class="text-base font-semibold text-text-primary">{{ selected.title }}</h2>
              <p class="text-[11px] text-text-tertiary mt-1">
                {{ formatTime(selected.created_at) }}
                · {{ selected.conversation_count }} 个会话
                · {{ selected.message_count }} 条消息
                <span v-if="selected.model_id"> · {{ selected.model_id }}</span>
              </p>
            </div>
            <div class="flex items-center gap-2 flex-shrink-0">
              <button
                v-if="selected.status === 'ok' && selected.content"
                type="button"
                class="text-[11px] text-text-tertiary hover:text-text-primary"
                @click="copyContent"
              >复制</button>
              <button
                type="button"
                class="text-[11px] text-text-tertiary hover:text-red-500"
                @click="removeSelected"
              >删除</button>
            </div>
          </div>

          <div
            v-if="selected.status === 'error'"
            class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
          >
            {{ selected.error || '生成失败' }}
          </div>
          <div
            v-else
            class="rounded-2xl bg-surface-0 border border-surface-3 px-5 py-4 text-sm text-text-primary prose prose-sm dark:prose-invert max-w-none leading-relaxed select-text"
            v-html="renderMarkdown(selected.content || '（无内容）')"
          />
        </div>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import ChatModelSwitcher from '@/components/ChatModelSwitcher.vue'
import { useModelStore } from '@/stores/models'
import { useSiteConfigStore } from '@/stores/site-config'
import { renderMarkdown } from '@/utils/markdown'
import { hasCap } from '@/utils/model-caps'

interface DailyReviewRow {
  id: string
  kind: 'daily' | 'deep'
  title: string
  content: string
  status: 'ok' | 'error'
  error: string
  provider_id: string
  model_id: string
  conversation_count: number
  message_count: number
  created_at: string
}

const modelStore = useModelStore()
const siteConfig = useSiteConfigStore()

const reviews = ref<DailyReviewRow[]>([])
const selectedId = ref('')
const generating = ref(false)
const generatingKind = ref<'daily' | 'deep' | null>(null)
const draftModel = ref<{ provider_id: string; model_id: string }>({ provider_id: '', model_id: '' })

const selected = computed(() => reviews.value.find((r) => r.id === selectedId.value) || null)

function onModelChange(val: { provider_id: string; model_id: string }) {
  draftModel.value = { provider_id: val.provider_id, model_id: val.model_id }
}

function resolveDefaultModel(): { provider_id: string; model_id: string } {
  const cloud = siteConfig.chatDefaultModel
  if (cloud?.provider_id && cloud?.model_id) {
    const candidate =
      cloud.provider_id === 'cloud:default'
        ? modelStore.upgradeToCompositeKey(cloud.model_id)
        : cloud.model_id
    const prov = modelStore.providers.find((p) => p.id === cloud.provider_id)
    const cloudType = modelStore.cloudTypeOf(cloud.provider_id, candidate)
    if (prov && prov.models.includes(candidate) && hasCap(candidate, 'chat', cloudType)) {
      return { provider_id: cloud.provider_id, model_id: candidate }
    }
  }
  for (const p of modelStore.providers) {
    for (const m of p.models) {
      const cloudType = modelStore.cloudTypeOf(p.id, m)
      if (hasCap(m, 'chat', cloudType)) return { provider_id: p.id, model_id: m }
    }
  }
  return { provider_id: '', model_id: '' }
}

function formatTime(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString()
}

function dailyReviewApi() {
  const api = (window as any).api?.dailyReview
  if (!api?.invoke) {
    throw new Error('每日回顾服务未加载，请完全退出并重新启动应用（preload 需重启后生效）')
  }
  return api as { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> }
}

async function loadList() {
  try {
    const list = (await dailyReviewApi().invoke('list')) as DailyReviewRow[]
    reviews.value = list || []
    if (!selectedId.value && reviews.value[0]) selectedId.value = reviews.value[0].id
    if (selectedId.value && !reviews.value.some((r) => r.id === selectedId.value)) {
      selectedId.value = reviews.value[0]?.id || ''
    }
  } catch (e: any) {
    console.error('[daily-review] loadList failed:', e)
    alert(e?.message || String(e))
  }
}

async function generate(kind: 'daily' | 'deep') {
  if (generating.value) return
  if (!draftModel.value.provider_id || !draftModel.value.model_id) {
    draftModel.value = resolveDefaultModel()
  }
  generating.value = true
  generatingKind.value = kind
  try {
    const row = (await dailyReviewApi().invoke('generate', {
      kind,
      providerId: draftModel.value.provider_id,
      modelId: draftModel.value.model_id
    })) as DailyReviewRow
    await loadList()
    if (row?.id) selectedId.value = row.id
  } catch (e: any) {
    alert(e?.message || String(e))
  } finally {
    generating.value = false
    generatingKind.value = null
  }
}

async function copyContent() {
  if (!selected.value?.content) return
  try {
    await navigator.clipboard.writeText(selected.value.content)
  } catch {
    /* ignore */
  }
}

async function removeSelected() {
  if (!selected.value) return
  if (!confirm('删除这条回顾记录？')) return
  await dailyReviewApi().invoke('delete', selected.value.id)
  selectedId.value = ''
  await loadList()
}

onMounted(async () => {
  if (!modelStore.providers.length) {
    try {
      await modelStore.fetchProviders()
    } catch {
      /* ignore */
    }
  }
  draftModel.value = resolveDefaultModel()
  await loadList()
})
</script>
