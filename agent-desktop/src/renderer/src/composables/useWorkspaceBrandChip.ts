import { computed, onMounted, onUnmounted, ref, watch, type Ref } from 'vue'
import { useAgentWorkspaceStore } from '@/stores/agent-workspaces'
import { isBrandOverride } from '@shared/brand-override'

export interface BrandActiveSummary {
  workspaceId: string
  workspaceName: string
  rootPath: string
  isDefault: boolean
  docsPath: string
  status: 'ready' | 'stale' | 'missing'
  hasHex: boolean
  note: string
  cardText: string
  mustTokens: string
}

export function useWorkspaceBrandChip(prompt: Ref<string>) {
  const workspaceStore = useAgentWorkspaceStore()
  const summary = ref<BrandActiveSummary | null>(null)
  const ensuring = ref(false)
  let seq = 0

  const overridden = computed(() => isBrandOverride(prompt.value))

  const folderName = computed(() => {
    const fromCard = String(summary.value?.workspaceName || '').trim()
    return fromCard || workspaceStore.activeName || '未选择'
  })

  const statusText = computed(() => {
    const s = summary.value
    if (overridden.value) return '本轮不用品牌色'
    if (ensuring.value) return '正在读取规范'
    if (s?.hasHex && s.status !== 'missing') return '出图会带上品牌色'
    if (s?.status === 'stale') return s.note || '规范可能过期'
    if (s?.status === 'missing' || (s && !s.hasHex)) return s.note || '还没有品牌规范'
    return '正在识别规范'
  })

  const label = computed(() => `${folderName.value} · ${statusText.value}`)

  const canOpenDocs = computed(() => {
    const s = summary.value
    return !!s && !overridden.value && (!s.hasHex || s.status === 'missing')
  })

  async function refreshSummary() {
    try {
      summary.value = (await window.api.brand.invoke('getActiveSummary')) as BrandActiveSummary
    } catch (e) {
      console.warn('[brand] getActiveSummary failed:', e)
    }
  }

  async function ensureCard() {
    const my = ++seq
    ensuring.value = true
    try {
      const next = (await window.api.brand.invoke('ensureActive')) as BrandActiveSummary
      if (my === seq) summary.value = next
    } catch (e) {
      console.warn('[brand] ensureActive failed:', e)
    } finally {
      if (my === seq) ensuring.value = false
    }
  }

  async function openDocs() {
    const path = summary.value?.docsPath || summary.value?.rootPath
    if (path) await window.api.shell.openPath(path)
  }

  watch(
    () => workspaceStore.activeId,
    () => {
      refreshSummary()
      ensureCard()
    }
  )

  onMounted(() => {
    refreshSummary()
    ensureCard()
  })

  onUnmounted(() => {
    seq += 1
  })

  return { summary, ensuring, overridden, label, folderName, statusText, canOpenDocs, refreshSummary, ensureCard, openDocs }
}
