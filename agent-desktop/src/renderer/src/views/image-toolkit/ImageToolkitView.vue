<template>
  <div class="h-full flex flex-col bg-surface-1 overflow-hidden">
    <header class="page-header">
      <div class="relative w-full max-w-md">
        <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-disabled" fill="none" viewBox="0 0 24 24" stroke="currentColor"><circle cx="11" cy="11" r="8" stroke-width="2"/><path d="m21 21-4.3-4.3" stroke-width="2"/></svg>
        <input
          v-model="search"
          placeholder="搜索功能"
          class="w-full pl-9 pr-3 py-1.5 text-xs bg-surface-1 border border-surface-3 rounded-lg outline-none focus:ring-1 focus:ring-primary-500 text-text-primary"
        />
      </div>
    </header>

    <div class="flex-1 overflow-y-auto px-6 py-5">
      <!-- Hero 大卡（3 张 · 左侧文案 + 右侧抽象插画 · 统一白底） -->
      <div v-if="!searching" class="grid grid-cols-3 gap-3 mb-6">
        <button
          v-for="(card, idx) in HERO_CARDS"
          :key="card.id"
          @click="onCardClick(card)"
          class="group rounded-2xl bg-surface-0 border border-surface-3 hover:border-primary-300 hover:shadow-md transition-all overflow-hidden text-left"
        >
          <div class="flex h-[150px]">
            <!-- 左侧：标题 + 描述 + CTA -->
            <div class="flex-1 px-5 py-4 flex flex-col justify-between min-w-0">
              <div>
                <div class="text-[15px] font-semibold text-text-primary leading-tight">{{ card.label }}</div>
                <div v-if="card.desc" class="text-xs text-text-tertiary mt-1.5 line-clamp-2 leading-relaxed">{{ card.desc }}</div>
              </div>
              <div class="inline-flex items-center gap-1 text-xs font-medium text-primary-600 dark:text-primary-300 group-hover:gap-1.5 transition-all">
                <span>{{ card.cta || '进入' }}</span>
                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" /></svg>
              </div>
            </div>
            <!-- 右侧：抽象插画（主色 currentColor + 透明度叠加） -->
            <div class="w-[44%] flex-shrink-0 flex items-center justify-center text-primary-600 dark:text-primary-300 bg-gradient-to-br from-primary-50/50 to-transparent dark:from-primary-900/20 dark:to-transparent group-hover:from-primary-50 dark:group-hover:from-primary-900/30 transition-colors">
              <component :is="HERO_ILLUSTRATIONS[idx]" />
            </div>
          </div>
        </button>
      </div>

      <!-- 分类 tabs -->
      <div v-if="!searching" class="flex items-center gap-4 mb-3 border-b border-surface-3">
        <button
          v-for="tab in CATEGORY_TABS"
          :key="tab.id"
          @click="activeCat = tab.id"
          :class="[
            'pb-2 text-xs font-medium transition-colors relative',
            activeCat === tab.id
              ? 'text-text-primary'
              : 'text-text-tertiary hover:text-text-secondary'
          ]"
        >
          {{ tab.label }}
          <div
            v-if="activeCat === tab.id"
            class="absolute bottom-0 left-0 right-0 h-0.5 bg-primary-600 rounded-full"
          ></div>
        </button>
      </div>

      <!-- 工具卡片网格（按 action.type 二分着色：AI 类=主色 / 纯工具=sky） -->
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <button
          v-for="card in displayCards"
          :key="card.id"
          @click="onCardClick(card)"
          :class="[
            'relative rounded-xl bg-surface-0 border transition-all px-3 py-3 text-left group hover:shadow-sm hover:-translate-y-0.5',
            isPureTool(card)
              ? 'border-surface-3 hover:border-sky-300 dark:hover:border-sky-700'
              : 'border-surface-3 hover:border-primary-300 dark:hover:border-primary-700'
          ]"
          style="min-height: 76px"
        >
          <div class="flex items-center gap-2.5">
            <div :class="[
              'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors',
              isPureTool(card)
                ? 'bg-primary-50 text-primary-600 group-hover:bg-primary-100'
                : 'bg-primary-50 text-primary-600 dark:bg-primary-900/25 dark:text-primary-300 group-hover:bg-primary-100 dark:group-hover:bg-primary-900/40'
            ]">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" :d="card.iconPath" /></svg>
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-xs font-medium text-text-primary truncate">{{ card.label }}</div>
            </div>
          </div>
          <span
            v-if="card.badge"
            :class="[
              'absolute top-1.5 right-1.5 px-1.5 py-0.5 text-[9px] rounded-full border leading-none',
              isPureTool(card)
                ? 'bg-primary-50 text-primary-700 border-primary-200'
                : 'bg-primary-50 text-primary-700 border-primary-200 dark:bg-primary-900/30 dark:text-primary-300 dark:border-primary-800/60'
            ]"
          >{{ card.badge }}</span>
        </button>
      </div>

      <p v-if="searching && displayCards.length === 0" class="text-center text-xs text-text-tertiary py-12">
        没有找到匹配的功能
      </p>
    </div>

    <!-- 选图弹窗 -->
    <ImageSourcePickerDialog
      v-model:visible="pickerVisible"
      :title="pickerTitle"
      :hint="pickerHint"
      :multiple="pickerMultiple"
      @select="onImagesSelected"
      @cancel="onPickerCancel"
    />

    <!-- O10: 证件照样式选择弹窗（先选样式 + 背景色，再进选图） -->
    <IDPhotoStyleDialog
      v-model:visible="idPhotoDialogVisible"
      @confirm="onIDPhotoStyleConfirm"
    />

    <!-- AI 换装弹窗（先选服装来源 / 颜色 / 风格 / 保留项，再选人物照） -->
    <OutfitChangeDialog
      v-model:visible="outfitChangeDialogVisible"
      @confirm="onOutfitChangeConfirm"
    />

    <!-- AI 换姿势弹窗（先选姿势来源 / 朝向 / 保留项，再选人物照） -->
    <PoseChangeDialog
      v-model:visible="poseChangeDialogVisible"
      @confirm="onPoseChangeConfirm"
    />

    <StyleTransferDialog
      v-model:visible="styleTransferDialogVisible"
      @confirm="onStyleTransferConfirm"
    />

    <!-- 加载提示（处理大图时短暂显示） -->
    <div v-if="processing" class="fixed inset-0 z-[60] flex items-center justify-center pointer-events-none">
      <div class="bg-surface-0 rounded-xl shadow-[0_0_40px_rgba(0,0,0,0.18)] px-5 py-3 flex items-center gap-3">
        <svg class="w-4 h-4 animate-spin text-primary-500" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
        <span class="text-xs text-text-secondary">{{ processingText }}</span>
      </div>
    </div>

    <!-- Toast -->
    <div v-if="toast" class="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-surface-0 shadow-lg border border-surface-3 text-xs text-text-primary">{{ toast }}</div>
  </div>
</template>

<script setup lang="ts">
// page-header 是 main.css @layer components 全局工具类，复用即可（无需 scoped 重定义）
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import {
  HERO_CARDS,
  TOOL_CARDS,
  CATEGORY_TABS,
  findClosestPresetSize,
  type ToolCard
} from '@shared/image-toolkit-presets'
import ImageSourcePickerDialog from '@/components/ImageSourcePickerDialog.vue'
import IDPhotoStyleDialog from '@/components/IDPhotoStyleDialog.vue'
import OutfitChangeDialog from '@/components/OutfitChangeDialog.vue'
import PoseChangeDialog from '@/components/PoseChangeDialog.vue'
import StyleTransferDialog from '@/components/StyleTransferDialog.vue'
import IllustrationGen from '@/components/illustrations/IllustrationGen.vue'
import IllustrationBatch from '@/components/illustrations/IllustrationBatch.vue'
import IllustrationEdit from '@/components/illustrations/IllustrationEdit.vue'
import { loadAsDataUri } from '@/utils/image-source'
import { useHandoffStore } from '@/stores/handoff'
import { composeIDPhotoPrompt, type IDPhotoStyle } from '@shared/id-photo-styles'
import { composeOutfitChangePrompt, type OutfitSource, type OutfitPreserveOptions } from '@shared/outfit-change-presets'
import { composePoseChangePrompt, type PoseSource, type PosePreserveOptions } from '@shared/pose-change-presets'
import { composeStyleTransferPrompt, type ContentPreserveLevel, type StyleStrength } from '@shared/style-transfer-presets'

// Hero 卡片的 3 张抽象插画（顺序与 HERO_CARDS 一一对应）
const HERO_ILLUSTRATIONS = [IllustrationGen, IllustrationBatch, IllustrationEdit]

// 区分"纯前端工具卡"（拼图/水印/压缩/格式转换/GIF/切图）与"AI 能力卡"。
// 用于推荐区卡片的二分着色：纯工具走 sky 冷色，AI 能力走主色（暖橙）。
function isPureTool(card: ToolCard): boolean {
  return card.action.type === 'pick-then-tool'
}

const router = useRouter()
const handoff = useHandoffStore()

// ---- UI 状态 ----
const search = ref('')
const activeCat = ref<typeof CATEGORY_TABS[number]['id']>('ecommerce')
const toast = ref('')
const processing = ref(false)
const processingText = ref('')

const searching = computed(() => search.value.trim().length > 0)

const displayCards = computed<ToolCard[]>(() => {
  const q = search.value.trim().toLowerCase()
  if (q) {
    return [...HERO_CARDS, ...TOOL_CARDS].filter(c =>
      c.label.toLowerCase().includes(q) || (c.desc?.toLowerCase().includes(q) ?? false)
    )
  }
  // 按当前分类筛选卡片（电商作图 / AI 处理 / 高效办公）
  return TOOL_CARDS.filter(c => c.category === activeCat.value)
})

// ---- 选图弹窗状态 ----
const pickerVisible = ref(false)
const pickerTitle = ref('选择图片')
const pickerHint = ref('')
const pickerMultiple = ref(false)
let pendingCard: ToolCard | null = null

// ---- O10: 证件照样式弹窗状态 ----
const idPhotoDialogVisible = ref(false)
// 用户在弹窗里选好的证件照样式+背景，会注入后续 pick-then-gen 流程，覆盖卡片自带 preset
let pendingIDPhoto: { style: IDPhotoStyle; bgColor: string; bgLabel: string; outfit: string } | null = null

// ---- AI 换姿势弹窗状态 ----
const poseChangeDialogVisible = ref(false)
// 用户在弹窗里选好的姿势配置，会注入后续 pick-then-gen 流程。
// poseRefDataUri 如果有值，会作为 refImages 第 2 张追加。
let pendingPoseChange: {
  source: PoseSource
  poseText: string
  orientationLabel?: string
  orientationPrompt?: string
  poseRefDataUri?: string
  preserve: PosePreserveOptions
  summary: string
} | null = null

// ---- AI 换装弹窗状态 ----
const outfitChangeDialogVisible = ref(false)
// 用户在弹窗里选好的服装配置，会注入后续 pick-then-gen 流程。
// outfitRefDataUri 如果有值，会作为 refImages 第 2 张追加。
let pendingOutfitChange: {
  source: OutfitSource
  outfitText: string
  colorLabel?: string
  colorHex?: string
  styles: string[]
  outfitRefDataUri?: string
  preserve: OutfitPreserveOptions
  summary: string
} | null = null

const styleTransferDialogVisible = ref(false)
let pendingStyleTransfer: {
  styleRefDataUri: string
  imageType?: string
  styleStrength: StyleStrength
  contentPreserve: ContentPreserveLevel
  extraPrompt?: string
  summary: string
} | null = null

// ---- 卡片点击分流 ----
function onCardClick(card: ToolCard) {
  const action = card.action

  if (action.type === 'direct-route') {
    router.push(action.path)
    return
  }

  // O10：证件照特殊路径——先弹样式选择，再进入 pick-then-gen 主流程
  if (card.id === 'id-photo' && action.type === 'pick-then-gen') {
    pendingCard = card
    idPhotoDialogVisible.value = true
    return
  }

  // AI 换装特殊路径——先弹服装选择弹窗，再进入 pick-then-gen 主流程
  if (card.id === 'ai-outfit-change' && action.type === 'pick-then-gen') {
    pendingCard = card
    outfitChangeDialogVisible.value = true
    return
  }

  // AI 换姿势特殊路径——先弹姿势选择弹窗，再进入 pick-then-gen 主流程
  if (card.id === 'ai-pose-change' && action.type === 'pick-then-gen') {
    pendingCard = card
    poseChangeDialogVisible.value = true
    return
  }

  if (card.id === 'style-transfer' && action.type === 'pick-then-gen') {
    pendingCard = card
    styleTransferDialogVisible.value = true
    return
  }

  // 需要选图：决定单/多选 + 弹选图器
  let multiple = false
  let hint = ''

  if (action.type === 'pick-then-tool') {
    multiple = !!action.multiple
    if (action.minImages && action.minImages > 1) {
      hint = `请选择至少 ${action.minImages} 张图片${action.maxImages ? `（最多 ${action.maxImages} 张）` : ''}`
    } else if (action.maxImages) {
      hint = `最多支持 ${action.maxImages} 张图片`
    }
  } else if (action.type === 'pick-then-edit') {
    multiple = false
  } else if (action.type === 'pick-then-gen') {
    if (!action.needRef) {
      // 不需要参考图，直接跳生图页带预设
      handoff.set('imageGen', {
        presetPrompt: action.presetPrompt,
        presetSize: action.presetSize
      })
      router.push('/image-gen')
      return
    }
    multiple = false
  }

  pendingCard = card
  pickerTitle.value = `选择图片 - ${card.label}`
  pickerHint.value = hint
  pickerMultiple.value = multiple
  pickerVisible.value = true
}

// ---- 选图完成回调 ----
async function onImagesSelected(paths: string[]) {
  if (!pendingCard || paths.length === 0) {
    pendingCard = null
    return
  }

  const card = pendingCard
  const action = card.action
  pendingCard = null

  // pick-then-tool 校验数量
  if (action.type === 'pick-then-tool') {
    if (action.minImages && paths.length < action.minImages) {
      showToast(`至少需要 ${action.minImages} 张图片`)
      return
    }
    if (action.maxImages && paths.length > action.maxImages) {
      paths = paths.slice(0, action.maxImages)
      showToast(`已截取前 ${action.maxImages} 张`)
    }

    // 工具页通过 handoff 接收路径（避免 query 塞 base64）
    handoff.set('imageToolkit', { paths, toolId: card.id })
    router.push(action.toolRoute)
    return
  }

  if (action.type === 'pick-then-edit') {
    // 复用 ImageEditView 的 _local 模式：传 path + 工具/模板/预设 prompt
    const filePath = paths[0]
    const query: Record<string, string> = { path: filePath }
    if (action.tool) query.tool = action.tool
    if (action.template) query.template = action.template
    if (action.presetPrompt) query.presetPrompt = action.presetPrompt
    router.push({ path: '/image-edit/_local', query })
    return
  }

  if (action.type === 'pick-then-gen') {
    // 生图页需要 dataUri 作为 refImages：先读 + 压缩
    processing.value = true
    processingText.value = '正在加载图片...'
    try {
      const items = await loadAsDataUri(paths, { maxSize: 1024, quality: 0.8 })
      if (items.length === 0) {
        showToast('图片加载失败')
        return
      }
      // O10：证件照走特殊 prompt + 固定 size（由样式弹窗给定，覆盖卡片自带 preset）
      let finalPrompt = action.presetPrompt
      let finalSize = action.presetSize
      let refImageList = items.map(i => i.dataUri)
      if (pendingIDPhoto) {
        finalPrompt = composeIDPhotoPrompt(
          pendingIDPhoto.style,
          pendingIDPhoto.bgColor,
          pendingIDPhoto.bgLabel,
          pendingIDPhoto.outfit
        )
        finalSize = pendingIDPhoto.style.presetSize
        pendingIDPhoto = null
      } else if (pendingOutfitChange) {
        // AI 换装：动态合成 prompt + 追加服装参考图（如果有）
        finalPrompt = composeOutfitChangePrompt({
          source: pendingOutfitChange.source,
          outfitText: pendingOutfitChange.outfitText,
          colorLabel: pendingOutfitChange.colorLabel,
          colorHex: pendingOutfitChange.colorHex,
          styles: pendingOutfitChange.styles,
          hasOutfitRefImage: !!pendingOutfitChange.outfitRefDataUri,
          preserve: pendingOutfitChange.preserve
        })
        if (pendingOutfitChange.outfitRefDataUri) {
          // 服装参考图作为 refImages 第 2 张追加（人物图在前）
          refImageList = [...refImageList, pendingOutfitChange.outfitRefDataUri]
        }
        if (action.autoSize && items[0]) {
          finalSize = findClosestPresetSize(items[0].width, items[0].height)
        }
        pendingOutfitChange = null
      } else if (pendingPoseChange) {
        // AI 换姿势：动态合成 prompt + 追加姿势参考图（如有）
        finalPrompt = composePoseChangePrompt({
          source: pendingPoseChange.source,
          poseText: pendingPoseChange.poseText,
          orientationLabel: pendingPoseChange.orientationLabel,
          orientationPrompt: pendingPoseChange.orientationPrompt,
          hasPoseRefImage: !!pendingPoseChange.poseRefDataUri,
          preserve: pendingPoseChange.preserve
        })
        if (pendingPoseChange.poseRefDataUri) {
          // 姿势参考图作为 refImages 第 2 张追加（人物图在前）
          refImageList = [...refImageList, pendingPoseChange.poseRefDataUri]
        }
        if (action.autoSize && items[0]) {
          finalSize = findClosestPresetSize(items[0].width, items[0].height)
        }
        pendingPoseChange = null
      } else if (pendingStyleTransfer) {
        finalPrompt = composeStyleTransferPrompt({
          imageType: pendingStyleTransfer.imageType,
          styleStrength: pendingStyleTransfer.styleStrength,
          contentPreserve: pendingStyleTransfer.contentPreserve,
          extraPrompt: pendingStyleTransfer.extraPrompt
        })
        refImageList = [pendingStyleTransfer.styleRefDataUri, ...refImageList]
        if (action.autoSize && items[0]) {
          finalSize = findClosestPresetSize(items[0].width, items[0].height)
        }
        pendingStyleTransfer = null
      } else if (action.autoSize && items[0]) {
        // O9：如果卡片标记了 autoSize，按图片实际宽高比找最接近的预设尺寸
        finalSize = findClosestPresetSize(items[0].width, items[0].height)
      }
      handoff.set('imageGen', {
        presetPrompt: finalPrompt,
        presetSize: finalSize,
        refImages: refImageList
      })
      router.push('/image-gen')
    } catch (e: any) {
      showToast('图片加载失败：' + (e.message || ''))
    } finally {
      processing.value = false
    }
  }
}

// O10: 证件照样式弹窗确认回调 → 打开选图弹窗（pendingCard 已在 onCardClick 设好）
function onIDPhotoStyleConfirm(payload: { style: IDPhotoStyle; bgColor: string; bgLabel: string; outfit: string }) {
  pendingIDPhoto = payload
  if (!pendingCard) return
  pickerTitle.value = `选择照片 - ${payload.style.label}`
  pickerHint.value = '挑一张正脸照片，AI 会按所选规格与背景色重新生成'
  pickerMultiple.value = false
  pickerVisible.value = true
}

// 用户在选图弹窗点「取消」时触发：清空所有待注入下一步的 pending 状态，
// 避免“点 AI 卡片 → 选好配置 → 点选图 → 取消”后残留状态污染下次别的卡片流程。
function onPickerCancel() {
  pendingIDPhoto = null
  pendingOutfitChange = null
  pendingPoseChange = null
  pendingStyleTransfer = null
  pendingCard = null
}

// AI 换姿势弹窗确认回调 → 打开选人物照弹窗
function onPoseChangeConfirm(payload: {
  poseText: string
  orientationLabel?: string
  orientationPrompt?: string
  poseRefDataUri?: string
  preserve: PosePreserveOptions
  summary: string
  source: PoseSource
}) {
  pendingPoseChange = { ...payload }
  if (!pendingCard) return
  pickerTitle.value = '选择照片 - AI 换姿势'
  pickerHint.value = '挑一张人物正面或半身照，AI 会保留脸、服装与背景，仅改变姿势'
  pickerMultiple.value = false
  pickerVisible.value = true
}

// AI 换装弹窗确认回调 → 打开选人物照弹窗
function onOutfitChangeConfirm(payload: {
  outfitText: string
  colorLabel?: string
  colorHex?: string
  styles: string[]
  outfitRefDataUri?: string
  preserve: OutfitPreserveOptions
  summary: string
  source: OutfitSource
}) {
  pendingOutfitChange = { ...payload }
  if (!pendingCard) return
  pickerTitle.value = '选择照片 - AI 换装'
  pickerHint.value = '挑一张人物正面或半身照，AI 会保留脸、姿势与背景，仅替换服装'
  pickerMultiple.value = false
  pickerVisible.value = true
}

function onStyleTransferConfirm(payload: {
  styleRefDataUri: string
  imageType?: string
  styleStrength: StyleStrength
  contentPreserve: ContentPreserveLevel
  extraPrompt?: string
  summary: string
}) {
  pendingStyleTransfer = { ...payload }
  if (!pendingCard) return
  pickerTitle.value = '选择内容图 - 风格迁移'
  pickerHint.value = '挑一张需要保留主体、构图和结构的图片，AI 会将风格图效果迁移到这张图上'
  pickerMultiple.value = false
  pickerVisible.value = true
}

function showToast(text: string) {
  toast.value = text
  setTimeout(() => { if (toast.value === text) toast.value = '' }, 2500)
}
</script>
