<template>
  <div class="space-y-3">
    <h4 class="text-xs font-medium text-text-secondary">贴图</h4>

    <!-- 素材源切换 -->
    <div class="flex gap-0.5 p-0.5 bg-surface-2 rounded-lg">
      <button
        @click="currentTab = 'shapes'"
        :class="['flex-1 px-2 py-1 text-[11px] rounded transition-colors', currentTab === 'shapes' ? 'bg-surface-0 text-text-primary shadow-sm' : 'text-text-tertiary hover:text-text-secondary']"
      >形状</button>
      <button
        @click="currentTab = 'upload'"
        :class="['flex-1 px-2 py-1 text-[11px] rounded transition-colors', currentTab === 'upload' ? 'bg-surface-0 text-text-primary shadow-sm' : 'text-text-tertiary hover:text-text-secondary']"
      >上传</button>
      <button
        @click="currentTab = 'gallery'"
        :class="['flex-1 px-2 py-1 text-[11px] rounded transition-colors', currentTab === 'gallery' ? 'bg-surface-0 text-text-primary shadow-sm' : 'text-text-tertiary hover:text-text-secondary']"
      >图库</button>
    </div>

    <!-- 形状库 -->
    <div v-if="currentTab === 'shapes'" class="grid grid-cols-4 gap-1.5">
      <button
        v-for="s in shapes"
        :key="s.id"
        @click="onPickShape(s)"
        :title="s.label"
        class="aspect-square rounded-md border border-surface-3 bg-surface-0 hover:bg-surface-2 hover:border-primary-300 transition-colors flex items-center justify-center p-1.5"
      >
        <svg viewBox="0 0 24 24" class="w-full h-full" :style="{ color: s.defaultColor }" v-html="s.inner"></svg>
      </button>
    </div>

    <!-- 上传库 -->
    <div v-else-if="currentTab === 'upload'" class="space-y-2">
      <button
        @click="onUpload"
        :disabled="uploading"
        class="w-full py-2.5 text-[11px] border border-dashed border-surface-3 rounded-md hover:bg-surface-2 hover:border-primary-400 text-text-secondary transition-colors disabled:opacity-50"
      >
        {{ uploading ? '加载中...' : '+ 选择本地图片' }}
      </button>
      <p v-if="!uploadedStickers.length" class="text-[10px] text-text-tertiary text-center">支持 PNG / JPG / SVG，建议透明 PNG</p>
      <div v-else class="grid grid-cols-4 gap-1.5">
        <div
          v-for="u in uploadedStickers"
          :key="u.id"
          class="relative group aspect-square rounded-md border border-surface-3 bg-[length:8px_8px] bg-[image:linear-gradient(45deg,#e5e7eb_25%,transparent_25%,transparent_75%,#e5e7eb_75%),linear-gradient(45deg,#e5e7eb_25%,transparent_25%,transparent_75%,#e5e7eb_75%)] bg-[position:0_0,4px_4px] dark:bg-[image:linear-gradient(45deg,#374151_25%,transparent_25%,transparent_75%,#374151_75%),linear-gradient(45deg,#374151_25%,transparent_25%,transparent_75%,#374151_75%)] overflow-hidden cursor-pointer"
          @click="$emit('pick', u.dataUri)"
          :title="u.name"
        >
          <img :src="u.dataUri" class="w-full h-full object-contain p-0.5" />
          <button
            @click.stop="removeUploaded(u.id)"
            class="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/50 hover:bg-red-500 text-white text-[9px] leading-none opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
            title="移除"
          >×</button>
        </div>
      </div>
    </div>

    <!-- 图库库 -->
    <div v-else-if="currentTab === 'gallery'" class="space-y-2">
      <button
        @click="showGalleryPicker = true"
        :disabled="galleryLoading"
        class="w-full py-2.5 text-[11px] border border-dashed border-surface-3 rounded-md hover:bg-surface-2 hover:border-primary-400 text-text-secondary transition-colors disabled:opacity-50"
      >
        {{ galleryLoading ? '加载中...' : '从图库选择' }}
      </button>
      <p class="text-[10px] text-text-tertiary text-center">从你的图库里挑任意图作为贴图，可多选</p>
    </div>

    <!-- 选中贴图属性 -->
    <div v-if="hasSelection" class="pt-3 border-t border-surface-3 space-y-2.5">
      <h5 class="text-[11px] font-medium text-text-secondary">已选贴图</h5>

      <!-- 混合模式 -->
      <div class="space-y-1">
        <span class="text-[11px] text-text-secondary">混合模式</span>
        <select
          :value="blendMode"
          @change="onChangeBlend"
          class="w-full px-2 py-1.5 text-[11px] border border-surface-3 rounded-md bg-surface-0 outline-none focus:ring-1 focus:ring-primary-500"
        >
          <optgroup label="常用">
            <option v-for="m in BLEND_MODES_COMMON" :key="m.value" :value="m.value">{{ m.label }}</option>
          </optgroup>
          <optgroup label="更多">
            <option v-for="m in BLEND_MODES_MORE" :key="m.value" :value="m.value">{{ m.label }}</option>
          </optgroup>
        </select>
      </div>

      <!-- 不透明度 -->
      <div class="space-y-1">
        <div class="flex items-center justify-between">
          <span class="text-[11px] text-text-secondary">不透明度</span>
          <span class="text-[10px] text-text-tertiary">{{ opacity }}%</span>
        </div>
        <input
          type="range"
          min="0"
          max="100"
          :value="opacity"
          @input="onChangeOpacity"
          class="w-full h-1 accent-primary-600"
        />
      </div>

      <!-- 翻转 / 复制 / 删除 -->
      <div class="grid grid-cols-2 gap-1.5">
        <button @click="$emit('flip', 'x')" class="px-2 py-1.5 text-[10px] border border-surface-3 rounded-md hover:bg-surface-2 text-text-secondary">水平翻转</button>
        <button @click="$emit('flip', 'y')" class="px-2 py-1.5 text-[10px] border border-surface-3 rounded-md hover:bg-surface-2 text-text-secondary">垂直翻转</button>
        <button @click="$emit('duplicate')" class="px-2 py-1.5 text-[10px] border border-surface-3 rounded-md hover:bg-surface-2 text-text-secondary">复制</button>
        <button @click="$emit('delete')" class="px-2 py-1.5 text-[10px] border border-red-200 dark:border-red-900/40 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600">删除</button>
      </div>

      <!-- 图层顺序 -->
      <div class="grid grid-cols-2 gap-1.5">
        <button @click="$emit('bring-forward')" class="px-2 py-1.5 text-[10px] border border-surface-3 rounded-md hover:bg-surface-2 text-text-secondary">上移一层</button>
        <button @click="$emit('send-backward')" class="px-2 py-1.5 text-[10px] border border-surface-3 rounded-md hover:bg-surface-2 text-text-secondary">下移一层</button>
      </div>
    </div>

    <p v-else class="pt-2 border-t border-surface-3 text-[11px] text-text-tertiary">
      选形状 / 上传图片 / 从图库选加入画布；选中贴图可调节属性。
    </p>

    <!-- 图库选择弹窗（Teleport 到 body） -->
    <GalleryPicker v-model:visible="showGalleryPicker" :multiple="true" @select="onGalleryPick" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useStickerLibrary, shapeToDataUrl, type ShapePreset } from '@/composables/useStickerLibrary'
import { loadAsDataUri } from '@/utils/image-source'
import GalleryPicker from '@/components/GalleryPicker.vue'

const props = defineProps<{
  hasSelection: boolean
  /** Canvas globalCompositeOperation 值，默认 'source-over' */
  blendMode: string
  /** 不透明度 0-100（百分比） */
  opacity: number
}>()

const emit = defineEmits<{
  /** 用户从素材库选了一张贴纸，参数为 data URL */
  (e: 'pick', dataUri: string): void
  (e: 'update:blendMode', mode: string): void
  (e: 'update:opacity', value: number): void
  (e: 'flip', axis: 'x' | 'y'): void
  (e: 'duplicate'): void
  (e: 'bring-forward'): void
  (e: 'send-backward'): void
  (e: 'delete'): void
}>()

// 6 种最常用的混合模式 + 10 种"更多"，参考 PS 图层混合模式分组
const BLEND_MODES_COMMON = [
  { value: 'source-over', label: '正常' },
  { value: 'multiply',    label: '正片叠底' },
  { value: 'screen',      label: '滤色' },
  { value: 'overlay',     label: '叠加' },
  { value: 'soft-light',  label: '柔光' },
  { value: 'difference',  label: '差值' }
]
const BLEND_MODES_MORE = [
  { value: 'darken',       label: '变暗' },
  { value: 'lighten',      label: '变亮' },
  { value: 'color-dodge',  label: '颜色减淡' },
  { value: 'color-burn',   label: '颜色加深' },
  { value: 'hard-light',   label: '强光' },
  { value: 'exclusion',    label: '排除' },
  { value: 'hue',          label: '色相' },
  { value: 'saturation',   label: '饱和度' },
  { value: 'color',        label: '颜色' },
  { value: 'luminosity',   label: '明度' }
]

const { currentTab, shapes, uploadedStickers, pickUploadStickers, removeUploaded } = useStickerLibrary()
const uploading = ref(false)
const showGalleryPicker = ref(false)
const galleryLoading = ref(false)

function onPickShape(s: ShapePreset) {
  emit('pick', shapeToDataUrl(s))
}

async function onUpload() {
  if (uploading.value) return
  uploading.value = true
  try {
    const newUris = await pickUploadStickers()
    // 单张时直接添加到画布；多张让用户在缩略图里点选择哪张要用
    if (newUris.length === 1) {
      emit('pick', newUris[0])
    }
  } finally {
    uploading.value = false
  }
}

/**
 * 从图库选择后的回调：GalleryPicker 会返回一组绝对文件路径。
 * loadAsDataUri 走主进程 chat:readFileBase64 读文件转 base64（与详情页、画布节点同一条路径）。
 * 多选时逐张 emit pick，调用方（ImageEditView.addSticker）会依次加入画布。
 */
async function onGalleryPick(paths: string[]) {
  if (!paths.length) return
  galleryLoading.value = true
  try {
    const items = await loadAsDataUri(paths, { maxSize: 1024, quality: 0.9 })
    for (const it of items) {
      emit('pick', it.dataUri)
    }
  } finally {
    galleryLoading.value = false
  }
}

function onChangeBlend(e: Event) {
  const v = (e.target as HTMLSelectElement).value
  emit('update:blendMode', v)
}

function onChangeOpacity(e: Event) {
  const v = Number((e.target as HTMLInputElement).value)
  if (!Number.isNaN(v)) emit('update:opacity', v)
}

// props 用于内部 reactive 触发；模板里直接绑定 props.blendMode/opacity
void props
</script>
