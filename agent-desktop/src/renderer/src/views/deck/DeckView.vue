<template>
  <div class="h-full flex flex-col bg-surface-0">
    <div class="px-6 py-4 border-b border-surface-3 flex items-center justify-between">
      <div>
        <h1 class="text-base font-semibold text-text-primary">AI PPT</h1>
        <p class="text-xs text-text-tertiary mt-0.5">快速模式：一句话生成受控模板 PPT；或用「PPT 设计师」多轮对话精修创作</p>
      </div>
      <button
        class="px-4 py-2 text-sm rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors"
        title="进入与 PPT 设计师的多轮对话：规划大纲、逐页打磨、配图表、评审、导出，可绑知识库取真实素材"
        @click="openAgentChat"
      >
        对话式创作
      </button>
    </div>

    <div class="flex-1 min-h-0 flex">
      <!-- 左：控制区 -->
      <div class="w-[360px] flex-none border-r border-surface-3 overflow-y-auto p-5 space-y-4">
        <div>
          <label class="block text-xs text-text-secondary mb-1">主题 / 需求</label>
          <textarea
            v-model="brief"
            rows="5"
            placeholder="例如：介绍我们的受控模板 PPT 引擎，讲清楚好看的根因与导出能力"
            class="w-full px-3 py-2 text-sm bg-surface-1 border border-surface-3 rounded-lg outline-none focus:ring-2 focus:ring-primary-500 resize-y"
          />
        </div>

        <div>
          <label class="block text-xs text-text-secondary mb-1">文本模型</label>
          <ChatModelSwitcher
            type="chat"
            block
            direction="down"
            prefix=""
            :provider-id="selProviderId"
            :model-id="selModelId"
            @change="onModelChange"
          />
        </div>

        <div>
          <div class="flex items-center justify-between mb-1">
            <label class="text-xs text-text-secondary">风格</label>
            <button class="text-[11px] text-primary-600 hover:text-primary-700 disabled:opacity-50" :disabled="refreshingTpl" @click="onRefreshTemplates">
              {{ refreshingTpl ? '刷新中…' : '刷新云端模板' }}
            </button>
          </div>
          <select
            v-model="styleFamily"
            class="w-full px-3 py-2 text-sm bg-surface-1 border border-surface-3 rounded-lg outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="">自动（默认风格）</option>
            <option v-for="f in deck.families" :key="f.id" :value="f.id">
              {{ f.label }}（{{ f.count }} 套）
            </option>
          </select>
          <p class="text-[11px] text-text-tertiary mt-1">同一份 PPT 只在所选风格内选版式，避免风格混搭</p>
        </div>

        <!-- 语义图标检索 -->
        <div class="pt-2 border-t border-surface-3">
          <button class="text-xs text-text-secondary hover:text-text-primary flex items-center gap-1" @click="iconPanelOpen = !iconPanelOpen">
            <span>{{ iconPanelOpen ? '收起' : '展开' }}图标检索</span>
          </button>
          <div v-if="iconPanelOpen" class="mt-2 space-y-2">
            <div class="flex gap-2">
              <input
                v-model="iconQuery"
                type="text"
                placeholder="如：数据增长 / 团队协作 / 安全"
                class="flex-1 px-3 py-2 text-sm bg-surface-1 border border-surface-3 rounded-lg outline-none focus:ring-2 focus:ring-primary-500"
                @keyup.enter="onSearchIcons"
              />
              <button class="px-3 py-2 text-xs rounded-lg border border-surface-3 hover:bg-surface-2 disabled:opacity-50" :disabled="iconSearching || !iconQuery.trim()" @click="onSearchIcons">搜索</button>
            </div>
            <p v-if="iconHint" class="text-[11px] text-text-tertiary">{{ iconHint }}</p>
            <div v-if="iconResults.length" class="grid grid-cols-4 gap-2">
              <div v-for="ic in iconResults" :key="ic.id" class="flex flex-col items-center gap-1 p-2 rounded-md border border-surface-3 bg-surface-0" :title="ic.name">
                <img :src="ic.png" class="w-8 h-8" :alt="ic.name" />
                <span class="text-[10px] text-text-tertiary truncate w-full text-center">{{ ic.name }}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="flex gap-3">
          <div class="flex-1">
            <label class="block text-xs text-text-secondary mb-1">配色主题</label>
            <select
              v-model="themeId"
              class="w-full px-3 py-2 text-sm bg-surface-1 border border-surface-3 rounded-lg outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">跟随风格</option>
              <option v-for="t in themeOptions" :key="t.id" :value="t.id">{{ t.name }}</option>
            </select>
          </div>
          <div class="w-24">
            <label class="block text-xs text-text-secondary mb-1">页数上限</label>
            <input
              v-model.number="maxSlides"
              type="number"
              min="1"
              max="20"
              class="w-full px-3 py-2 text-sm bg-surface-1 border border-surface-3 rounded-lg outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
        </div>

        <label class="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
          <input v-model="useIcons" type="checkbox" class="accent-primary-600" />
          空图片位自动配语义图标
        </label>

        <label class="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
          <input v-model="useCharts" type="checkbox" class="accent-primary-600" />
          数据页自动生成信息图表
        </label>

        <div class="flex gap-2">
          <button
            v-if="!deck.generating"
            class="flex-1 px-4 py-2 text-sm rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors disabled:opacity-50"
            :disabled="!brief.trim() || !hasModel"
            @click="onGenerate"
          >
            生成 PPT
          </button>
          <button
            v-else
            class="flex-1 px-4 py-2 text-sm rounded-lg bg-surface-2 text-text-primary border border-surface-3 hover:bg-surface-3 transition-colors"
            @click="deck.cancel()"
          >
            取消生成
          </button>
        </div>

        <div v-if="deck.generating && deck.progress" class="text-xs text-text-tertiary">
          {{ progressLabel }}
          <div class="mt-1 h-1.5 bg-surface-2 rounded-full overflow-hidden">
            <div class="h-full bg-primary-500 transition-all" :style="{ width: progressPercent + '%' }"></div>
          </div>
        </div>

        <div v-if="statusMsg" class="text-xs" :class="statusError ? 'text-red-500' : 'text-text-tertiary'">
          {{ statusMsg }}
        </div>

        <!-- 导出 -->
        <div v-if="deck.slides.length > 0" class="pt-2 border-t border-surface-3 space-y-2">
          <label class="block text-xs text-text-secondary">导出</label>
          <div class="grid grid-cols-2 gap-2">
            <button class="px-3 py-2 text-xs rounded-lg border border-surface-3 hover:bg-surface-2 disabled:opacity-50" :disabled="exporting" @click="onExport('pptx')">可编辑 PPTX</button>
            <button class="px-3 py-2 text-xs rounded-lg border border-surface-3 hover:bg-surface-2 disabled:opacity-50" :disabled="exporting" @click="onExport('pdf')">PDF</button>
            <button class="px-3 py-2 text-xs rounded-lg border border-surface-3 hover:bg-surface-2 disabled:opacity-50" :disabled="exporting" @click="onExport('gif')">GIF</button>
            <button class="px-3 py-2 text-xs rounded-lg border border-surface-3 hover:bg-surface-2 disabled:opacity-50" :disabled="exporting" @click="onExport('mp4')">MP4 视频</button>
          </div>
          <button class="w-full px-3 py-2 text-xs rounded-lg border border-surface-3 hover:bg-surface-2 disabled:opacity-50" :disabled="exporting" @click="onExport('prototype')">可点击原型（HTML）</button>
          <button class="w-full px-3 py-2 text-xs rounded-lg border border-surface-3 hover:bg-surface-2 disabled:opacity-50" :disabled="exporting" @click="onNarrate">解说视频（TTS 配音）</button>
          <button class="w-full px-3 py-2 text-xs rounded-lg border border-surface-3 hover:bg-surface-2 disabled:opacity-50" :disabled="exporting || deck.reviewing" @click="onCritique">设计评审（AI 打分）</button>
        </div>

        <!-- 历史项目 -->
        <div class="pt-2 border-t border-surface-3">
          <label class="block text-xs text-text-secondary mb-2">历史 deck</label>
          <div v-if="deck.projects.length === 0" class="text-xs text-text-disabled">暂无</div>
          <ul class="space-y-1">
            <li
              v-for="p in deck.projects"
              :key="p.id"
              class="flex items-center justify-between px-2 py-1.5 rounded-md text-xs cursor-pointer hover:bg-surface-2"
              :class="{ 'bg-surface-2': p.id === deck.currentProjectId }"
              @click="deck.openProject(p.id)"
            >
              <span class="truncate text-text-primary">{{ p.title || '未命名' }}</span>
              <button class="ml-2 text-text-disabled hover:text-red-500" @click.stop="deck.remove(p.id)">删除</button>
            </li>
          </ul>
        </div>
      </div>

      <!-- 右：预览 -->
      <div class="flex-1 min-w-0 overflow-y-auto p-6 bg-surface-1">
        <div v-if="deck.slides.length === 0" class="h-full flex items-center justify-center text-text-disabled text-sm">
          输入主题并点击“生成 PPT”，预览将在此显示
        </div>
        <template v-else>
        <!-- 评审结果汇总 -->
        <div v-if="deck.review" class="mb-5 p-4 rounded-lg border border-surface-3 bg-surface-0">
          <div class="flex items-center justify-between mb-2">
            <span class="text-sm font-semibold text-text-primary">设计评审</span>
            <span class="text-sm" :class="scoreColor(deck.review.average)">平均 {{ deck.review.average }} 分</span>
          </div>
          <ul class="space-y-1.5">
            <li v-for="it in deck.review.slides" :key="it.index" class="text-xs">
              <div class="flex items-center justify-between">
                <span class="text-text-secondary truncate">第 {{ it.index + 1 }} 页 {{ it.title }}</span>
                <span :class="scoreColor(it.review.total)">{{ it.review.total }}</span>
              </div>
              <div v-if="it.review.suggestions.length" class="text-text-tertiary mt-0.5 pl-2">
                <span v-for="(sg, k) in it.review.suggestions" :key="k" class="block">· {{ sg }}</span>
              </div>
            </li>
          </ul>
        </div>
        <div class="grid grid-cols-2 gap-5">
          <div v-for="(s, i) in deck.slides" :key="i" class="rounded-lg overflow-hidden border border-surface-3 bg-white shadow-sm">
            <div class="relative w-full" :style="{ height: PREVIEW_H + 'px' }">
              <iframe
                :srcdoc="s.html"
                sandbox="allow-same-origin"
                class="absolute top-0 left-0 border-0"
                :style="frameStyle"
              />
            </div>
            <div class="px-3 py-1.5 text-[11px] text-text-tertiary border-t border-surface-3 flex items-center justify-between">
              <span>第 {{ i + 1 }} 页 · {{ s.templateId }}</span>
              <span v-if="s.warnings && s.warnings.length" class="text-amber-500">已用兜底</span>
            </div>
          </div>
        </div>
        </template>
      </div>
    </div>

    <FfmpegRequiredModal
      :open="ffmpegModalOpen"
      :reason="ffmpegReason"
      :installing="ffmpegInstalling"
      @close="ffmpegModalOpen = false"
      @recheck="onRecheckFfmpeg"
      @install="onInstallFfmpeg"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useDeckStore } from '@/stores/deck'
import { useModelStore } from '@/stores/models'
import { useBotStore } from '@/stores/bots'
import { hasCap } from '@/utils/model-caps'
import ChatModelSwitcher from '@/components/ChatModelSwitcher.vue'
import FfmpegRequiredModal from '@/components/deck/FfmpegRequiredModal.vue'

const deck = useDeckStore()
const modelStore = useModelStore()
const botStore = useBotStore()
const router = useRouter()

// 跳到与「PPT 设计师」智能体的多轮对话(复用成熟 ChatView; 内置 bot 由 seedPresetBots 保证存在)
async function openAgentChat(): Promise<void> {
  try {
    if (botStore.bots.length === 0) await botStore.fetchBots()
  } catch {
    /* ignore */
  }
  const designer = botStore.bots.find((b) => b.name === 'PPT 设计师' || b.enable_deck === 1)
  router.push(designer ? { name: 'chat', query: { botId: designer.id } } : { name: 'chat' })
}

const FALLBACK_THEMES = [
  { id: 'editorial-serif', name: '出版物衬线' },
  { id: 'clean-sans', name: '极简无衬线' },
  { id: 'dark-pro', name: '深色专业' }
]
const themeOptions = computed(() => (deck.themes.length ? deck.themes : FALLBACK_THEMES))

const brief = ref('')
const styleFamily = ref('') // '' = 自动(默认风格)
const themeId = ref('') // '' = 跟随风格配色
const maxSlides = ref(8)
const useIcons = ref(true) // 空图片槽自动配语义图标
const useCharts = ref(true) // 数据页自动生成信息图表
const selProviderId = ref('')
const selModelId = ref('')
const refreshingTpl = ref(false)
const iconPanelOpen = ref(false)
const iconQuery = ref('')
const iconSearching = ref(false)
const iconHint = ref('')
const iconResults = ref<{ id: string; name: string; score: number; png: string }[]>([])
const statusMsg = ref('')
const statusError = ref(false)
const exporting = ref(false)
const ffmpegModalOpen = ref(false)
const ffmpegReason = ref('')
const ffmpegInstalling = ref(false)

// 预览缩放: 1280x720 等比缩到卡片宽度
const PREVIEW_W = 480
const PREVIEW_H = Math.round((PREVIEW_W * 720) / 1280)
const frameStyle = computed(() => ({
  width: '1280px',
  height: '720px',
  transform: `scale(${PREVIEW_W / 1280})`,
  transformOrigin: 'top left'
}))

// 仅对话(chat)能力模型(与 ChatModelSwitcher 过滤一致, 排除图像/embedding)
const chatModels = computed(() => {
  const out: { providerId: string; modelId: string }[] = []
  for (const p of modelStore.providers) {
    for (const m of p.models) {
      if (hasCap(m, 'chat', modelStore.cloudTypeOf(p.id, m))) out.push({ providerId: p.id, modelId: m })
    }
  }
  return out
})

const hasModel = computed(() => !!selProviderId.value && !!selModelId.value)

function onModelChange(val: { provider_id: string; model_id: string }): void {
  selProviderId.value = val.provider_id
  selModelId.value = val.model_id
}

const PHASE_LABEL: Record<string, string> = {
  outline: '生成大纲',
  slide: '生成幻灯片',
  critique: '评审幻灯片'
}
const progressLabel = computed(() => {
  const pr = deck.progress
  if (!pr) return ''
  return `${PHASE_LABEL[pr.phase] ?? pr.phase} ${pr.done}/${pr.total}`
})
const progressPercent = computed(() => {
  const pr = deck.progress
  if (!pr || pr.total === 0) return 5
  return Math.round((pr.done / pr.total) * 100)
})

function setStatus(msg: string, isError = false): void {
  statusMsg.value = msg
  statusError.value = isError
}

function scoreColor(n: number): string {
  if (n >= 80) return 'text-green-600'
  if (n >= 60) return 'text-amber-500'
  return 'text-red-500'
}

async function onGenerate(): Promise<void> {
  if (!hasModel.value) return setStatus('请先选择文本模型', true)
  if (!brief.value.trim()) return setStatus('请输入主题/需求', true)
  setStatus('')
  try {
    await deck.generate({
      brief: brief.value.trim(),
      providerId: selProviderId.value,
      modelId: selModelId.value,
      styleFamily: styleFamily.value || undefined,
      themeId: themeId.value || undefined,
      maxSlides: maxSlides.value,
      useIcons: useIcons.value,
      useCharts: useCharts.value
    })
    setStatus('生成完成')
  } catch {
    setStatus('生成失败: ' + (deck.lastError || '未知错误'), true)
  }
}

async function onExport(kind: 'pptx' | 'pdf' | 'gif' | 'mp4' | 'prototype'): Promise<void> {
  exporting.value = true
  setStatus(kind === 'mp4' ? '导出视频中（逐帧渲染，较慢）…' : '导出中…')
  try {
    const r = await deck.exportDeck(kind)
    if ('needFfmpeg' in r) {
      ffmpegReason.value = r.reason
      ffmpegModalOpen.value = true
      setStatus('视频导出需要 ffmpeg')
      return
    }
    const labelMap: Record<string, string> = { prototype: '可点击原型' }
    setStatus(`已导出 ${labelMap[kind] ?? kind.toUpperCase()}：${r.path}`)
    deck.reveal(r.path)
  } catch (e) {
    setStatus('导出失败: ' + (e instanceof Error ? e.message : String(e)), true)
  } finally {
    exporting.value = false
  }
}

async function onNarrate(): Promise<void> {
  exporting.value = true
  setStatus('生成解说视频中（合成配音 + 逐帧渲染，较慢）…')
  try {
    const r = await deck.narrate()
    if ('needFfmpeg' in r) {
      ffmpegReason.value = r.reason
      ffmpegModalOpen.value = true
      setStatus('解说视频需要 ffmpeg')
      return
    }
    setStatus(`已生成解说视频：${r.path}`)
    deck.reveal(r.path)
  } catch (e) {
    setStatus('解说视频失败: ' + (e instanceof Error ? e.message : String(e)), true)
  } finally {
    exporting.value = false
  }
}

async function onRefreshTemplates(): Promise<void> {
  refreshingTpl.value = true
  try {
    await deck.refreshTemplates()
    setStatus('云端模板已刷新')
  } catch (e) {
    setStatus('刷新失败: ' + (e instanceof Error ? e.message : String(e)), true)
  } finally {
    refreshingTpl.value = false
  }
}

async function onSearchIcons(): Promise<void> {
  if (!iconQuery.value.trim()) return
  iconSearching.value = true
  iconHint.value = ''
  iconResults.value = []
  try {
    const res = await deck.searchIcons(iconQuery.value.trim(), 12)
    if ('needEmbedder' in res) {
      iconHint.value = '图标检索不可用（需 MiniLM 权重或登录云端嵌入）：' + res.reason
      return
    }
    iconResults.value = res.icons
    if (res.icons.length === 0) iconHint.value = '无匹配图标'
  } catch (e) {
    iconHint.value = '搜索失败: ' + (e instanceof Error ? e.message : String(e))
  } finally {
    iconSearching.value = false
  }
}

async function onCritique(): Promise<void> {
  if (!hasModel.value) return setStatus('请先选择文本/多模态模型', true)
  setStatus('设计评审中（逐页截图 + AI 打分，较慢）…')
  try {
    const res = await deck.critique({ providerId: selProviderId.value, modelId: selModelId.value })
    if (res?.ok) setStatus(`评审完成，平均分 ${res.review.average}`)
    else setStatus('评审失败', true)
  } catch (e) {
    setStatus('评审失败: ' + (e instanceof Error ? e.message : String(e)), true)
  }
}

async function onRecheckFfmpeg(): Promise<void> {
  const st = await deck.checkFfmpeg()
  if (st.ready) {
    ffmpegModalOpen.value = false
    await onExport('mp4')
  } else {
    ffmpegReason.value = st.reason || '仍未检测到 ffmpeg'
  }
}

async function onInstallFfmpeg(): Promise<void> {
  ffmpegInstalling.value = true
  try {
    const st = await deck.installFfmpeg()
    if (st.ready) {
      ffmpegModalOpen.value = false
      await onExport('mp4')
    } else {
      ffmpegReason.value = st.reason || '安装失败，请稍后重试'
    }
  } finally {
    ffmpegInstalling.value = false
  }
}

onMounted(async () => {
  try {
    await modelStore.fetchProviders()
  } catch {
    /* ignore */
  }
  // 默认选中第一个对话模型(与 ChatModelSwitcher 过滤一致)
  const first = chatModels.value[0]
  if (first) {
    selProviderId.value = first.providerId
    selModelId.value = first.modelId
  }
  await deck.loadTemplates().catch(() => undefined)
  await deck.loadFamilies().catch(() => undefined)
  await deck.loadThemes().catch(() => undefined)
  await deck.loadProjects().catch(() => undefined)
})

onUnmounted(() => deck.stopListenProgress())
</script>
