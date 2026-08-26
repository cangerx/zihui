<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center" @click.self="emit('close')">
    <div class="w-[min(1180px,calc(100vw-48px))] h-[min(760px,calc(100vh-48px))] bg-surface-0 rounded-2xl shadow-[0_0_30px_rgba(0,0,0,0.12)] border border-surface-3 overflow-hidden flex">
      <div class="flex-1 min-w-0 bg-surface-2 flex items-center justify-center p-5 relative">
        <div v-if="(item as any).ai_mark_removed" class="absolute top-3 left-3 z-10 pointer-events-none"><ProcessedBadge label="已去AI标记" /></div>
        <button
          v-if="item.result_path"
          type="button"
          class="w-full h-full flex items-center justify-center cursor-zoom-in"
          @click="emit('preview')"
        >
          <img :src="imageSrc" class="max-w-full max-h-full object-contain rounded-lg shadow-sm" />
        </button>
        <div v-else class="w-full h-full flex items-center justify-center text-text-disabled">
          <svg class="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" /></svg>
        </div>
      </div>

      <aside class="w-[420px] flex-shrink-0 border-l border-surface-3 flex flex-col bg-surface-0">
        <div class="flex-shrink-0 p-5 border-b border-surface-3">
          <div class="flex items-center justify-between gap-3 mb-4">
            <h3 class="text-sm font-semibold text-text-primary">创作详情</h3>
            <button
              type="button"
              class="w-8 h-8 rounded-lg hover:bg-surface-2 dark:hover:bg-white/5 flex items-center justify-center transition-colors"
              title="关闭"
              aria-label="关闭详情"
              @click="emit('close')"
            >
              <svg class="w-5 h-5 text-red-500 dark:text-red-400 drop-shadow-[0_1px_1px_rgba(0,0,0,0.28)] dark:drop-shadow-[0_1px_2px_rgba(255,255,255,0.45)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
            </button>
          </div>

          <div class="flex gap-2 flex-wrap">
            <button v-if="item.result_path" type="button" class="btn-secondary text-xs flex items-center gap-1.5" @click="emit('copyImage')">
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9.75a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" /></svg>
              复制图片
            </button>
            <button v-if="item.result_path" type="button" class="btn-secondary text-xs flex items-center gap-1.5" @click="emit('edit')">
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" /></svg>
              编辑
            </button>
            <button v-if="item.result_path" type="button" class="btn-secondary text-xs flex items-center gap-1.5" @click="emit('openFolder')">
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 0 0-1.883 2.542l.857 6a2.25 2.25 0 0 0 2.227 1.932H19.05a2.25 2.25 0 0 0 2.227-1.932l.857-6a2.25 2.25 0 0 0-1.883-2.542m-16.5 0V6A2.25 2.25 0 0 1 6 3.75h3.879a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 0 1.06.44H18A2.25 2.25 0 0 1 20.25 9v.776" /></svg>
              打开目录
            </button>
            <button type="button" class="btn-secondary text-xs flex items-center gap-1.5" @click="emit('reusePrompt')">
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" /></svg>
              再次使用
            </button>
            <button v-if="item.prompt" type="button" class="btn-secondary text-xs flex items-center gap-1.5" @click="emit('savePreset')">
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>
              存为预设
            </button>
            <button v-if="item.result_path" type="button" class="btn-secondary text-xs flex items-center gap-1.5" @click="emit('openInChat')">
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" /></svg>
              用这张图开对话
            </button>
            <button v-if="item.revised_prompt" type="button" class="btn-secondary text-xs flex items-center gap-1.5" @click="emit('reuseRevisedPrompt')">
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" /></svg>
              使用优化词
            </button>
            <button v-if="showRegenerate" type="button" class="btn-secondary text-xs flex items-center gap-1.5" @click="emit('regenerate')">
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15.5-6.36L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15.5 6.36L3 16" /><path d="M3 21v-5h5" /></svg>
              重新生成
            </button>
            <button
              v-if="canShareOriginal"
              type="button"
              class="btn-secondary text-xs flex items-center gap-1.5"
              @click="emit('shareOriginal')"
            >
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 8.25H7.5a2.25 2.25 0 0 0-2.25 2.25v9a2.25 2.25 0 0 0 2.25 2.25h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25H15M9 12l3-3m0 0 3 3m-3-3v12" /></svg>
              分享原提示词
            </button>
            <button
              v-if="canShareRevised"
              type="button"
              class="btn-secondary text-xs flex items-center gap-1.5"
              @click="emit('shareRevised')"
            >
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 8.25H7.5a2.25 2.25 0 0 0-2.25 2.25v9a2.25 2.25 0 0 0 2.25 2.25h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25H15M9 12l3-3m0 0 3 3m-3-3v12" /></svg>
              分享优化词
            </button>
            <button type="button" class="btn-secondary text-xs flex items-center gap-1.5 text-red-500 hover:text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-red-900/20" @click="emit('delete')">
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165" /></svg>
              删除
            </button>
          </div>
        </div>

        <div class="flex-1 min-h-0 overflow-y-auto p-5 space-y-4">
          <section>
            <div class="flex items-center justify-between mb-1.5">
              <label class="text-xs font-medium text-text-secondary">提示词</label>
              <button type="button" class="p-1 rounded text-text-tertiary hover:text-text-secondary hover:bg-surface-2 transition-colors" title="复制提示词" @click="emit('copyPrompt')">
                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9.75a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" /></svg>
              </button>
            </div>
            <div class="text-xs text-text-primary bg-surface-1 rounded-lg p-3 whitespace-pre-wrap leading-relaxed">{{ item.prompt || '未设置提示词' }}</div>
          </section>

          <section v-if="item.revised_prompt">
            <div class="flex items-center justify-between mb-1.5">
              <label class="text-xs font-medium text-text-secondary">优化后的提示词</label>
              <button type="button" class="p-1 rounded text-text-tertiary hover:text-text-secondary hover:bg-surface-2 transition-colors" title="复制优化后的提示词" @click="emit('copyRevisedPrompt')">
                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9.75a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" /></svg>
              </button>
            </div>
            <div class="text-xs text-text-primary bg-surface-1 rounded-lg p-3 whitespace-pre-wrap leading-relaxed">{{ item.revised_prompt }}</div>
          </section>

          <section v-if="item.ref_images?.length">
            <label class="text-xs font-medium text-text-secondary mb-1.5 block">参考图片</label>
            <div class="flex gap-2 flex-wrap">
              <img v-for="(img, i) in item.ref_images" :key="i" :src="img" class="w-16 h-16 object-cover rounded-lg border border-surface-3" />
            </div>
          </section>

          <section class="grid grid-cols-1 gap-2 text-xs">
            <div><span class="text-text-tertiary">模型</span><p class="text-text-primary mt-0.5 break-all">{{ modelLabel }}</p></div>
            <div><span class="text-text-tertiary">尺寸</span><p class="text-text-primary mt-0.5">{{ item.size || '-' }}</p></div>
            <div><span class="text-text-tertiary">时间</span><p class="text-text-primary mt-0.5">{{ createdAtLabel }}</p></div>
          </section>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import ProcessedBadge from './ProcessedBadge.vue'

export interface CreationDetailItem {
  id: string
  prompt: string
  revised_prompt?: string
  ref_images?: string[]
  model_provider_id: string
  model_id: string
  size: string
  result_path?: string
  created_at: string
}

const props = defineProps<{
  item: CreationDetailItem
  imageSrc: string
  modelLabel: string
  createdAtLabel: string
  showRegenerate?: boolean
  canShareOriginal?: boolean
  canShareRevised?: boolean
}>()

const emit = defineEmits<{
  close: []
  preview: []
  copyImage: []
  edit: []
  openFolder: []
  reusePrompt: []
  reuseRevisedPrompt: []
  regenerate: []
  delete: []
  shareOriginal: []
  shareRevised: []
  copyPrompt: []
  copyRevisedPrompt: []
  openInChat: []
  savePreset: []
}>()

const showRegenerate = computed(() => props.showRegenerate ?? false)
const canShareOriginal = computed(() => props.canShareOriginal ?? false)
const canShareRevised = computed(() => props.canShareRevised ?? false)
</script>
