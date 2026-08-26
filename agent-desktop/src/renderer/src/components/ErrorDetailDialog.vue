<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div
        v-if="visible"
        class="fixed inset-0 z-[9600] flex items-center justify-center p-6 pointer-events-none"
      >
        <div
          class="w-full max-w-lg bg-surface-0 rounded-2xl shadow-2xl flex flex-col max-h-[70vh] pointer-events-auto"
          @click.stop
        >
          <!-- Header -->
          <div class="flex items-center justify-between px-5 py-3 border-b border-surface-2">
            <div class="flex items-center gap-2 min-w-0">
              <svg
                class="w-4 h-4 text-red-500 dark:text-red-400 flex-shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" x2="12" y1="8" y2="12" />
                <line x1="12" x2="12.01" y1="16" y2="16" />
              </svg>
              <h3 class="text-sm font-semibold text-text-primary truncate">{{ title || '错误详情' }}</h3>
            </div>
            <button
              type="button"
              @click="emit('close')"
              class="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-2 transition-colors"
              aria-label="关闭"
            >
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <!-- Body -->
          <div class="flex-1 overflow-y-auto px-5 py-4 space-y-3">
            <div>
              <div class="text-[11px] text-text-tertiary mb-1">提示信息</div>
              <pre
                class="text-xs leading-relaxed text-text-primary whitespace-pre-wrap break-all font-mono bg-surface-1 border border-surface-2 rounded-lg px-3 py-2.5"
              >{{ friendly || '(无错误信息)' }}</pre>
            </div>
            <div v-if="hasRaw">
              <div class="text-[11px] text-text-tertiary mb-1">原始信息</div>
              <pre
                class="text-xs leading-relaxed text-text-secondary whitespace-pre-wrap break-all font-mono bg-surface-1 border border-surface-2 rounded-lg px-3 py-2.5"
              >{{ rawError }}</pre>
            </div>
            <!-- 原始请求快照：快照包含脱敏后的 url/method/headers/body，默认折叠，独立复制按钮仅复制 JSON 原文 -->
            <div v-if="rawRequest" class="border border-surface-2 rounded-lg overflow-hidden">
              <div class="flex items-center justify-between px-3 py-2 bg-surface-1">
                <button
                  type="button"
                  @click="showRawRequest = !showRawRequest"
                  class="flex items-center gap-1.5 text-[11px] text-text-secondary hover:text-text-primary transition-colors"
                >
                  <svg
                    class="w-3 h-3 transition-transform"
                    :class="{ 'rotate-90': showRawRequest }"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                  <span>原始请求（已脱敏）</span>
                </button>
                <button
                  type="button"
                  @click="copyRawRequest"
                  class="flex items-center gap-1 text-[11px] text-text-tertiary hover:text-primary-600 transition-colors"
                >
                  <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                  </svg>
                  <span>{{ rawRequestCopied ? '已复制' : '复制' }}</span>
                </button>
              </div>
              <Transition name="raw-request">
                <pre
                  v-if="showRawRequest"
                  class="text-[11px] leading-relaxed text-text-secondary whitespace-pre-wrap break-all font-mono bg-surface-0 px-3 py-2.5 max-h-80 overflow-auto border-t border-surface-2"
                >{{ rawRequest }}</pre>
              </Transition>
            </div>
          </div>

          <!-- Footer -->
          <div class="flex items-center justify-end gap-2 px-5 py-3 border-t border-surface-2">
            <span v-if="copied" class="text-[11px] text-green-600 dark:text-green-400 mr-auto">已复制到剪贴板</span>
            <button
              type="button"
              @click="emit('close')"
              class="px-3 py-1.5 text-xs text-text-secondary rounded-lg border border-surface-3 hover:bg-surface-2 transition-colors"
            >关闭</button>
            <button
              type="button"
              :disabled="!friendly && !rawError"
              @click="copy"
              class="px-3 py-1.5 text-xs font-medium text-white rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-1.5"
            >
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
              </svg>
              复制
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { translateError } from '@/utils/error-message'

const props = defineProps<{
  visible: boolean
  /** 后端错误原文（未翻译）。组件内部调 translateError 派生友好翻译 */
  rawError: string
  /**
   * 发送给上游 API 的原始请求快照（脱敏后的 JSON 字符串）。
   * 仅失败记录且主进程已写入时会传递，有值时在 body 区预默认折叠的「原始请求」区块，提供独立复制按钮。
   */
  rawRequest?: string
  title?: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const friendly = computed(() => translateError(props.rawError || ''))

// 只有在原文存在且与翻译后文本不一致时才展示“原始信息”区域
const hasRaw = computed(() => {
  const raw = (props.rawError || '').trim()
  if (!raw) return false
  return raw !== (friendly.value || '').trim()
})

const copied = ref(false)
let copyTimer: number | null = null

// 原始请求面板状态：默认折叠，按需展开
const showRawRequest = ref(false)
const rawRequestCopied = ref(false)
let rawRequestCopyTimer: number | null = null

async function copy() {
  const parts: string[] = []
  if (friendly.value) parts.push(friendly.value)
  if (hasRaw.value) parts.push(`原始信息：${props.rawError}`)
  const text = parts.join('\n\n')
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    copied.value = true
    if (copyTimer) window.clearTimeout(copyTimer)
    copyTimer = window.setTimeout(() => {
      copied.value = false
    }, 1500)
  } catch {
    // 极小概率失败，降级：不阻断用户；保持 copied=false
  }
}

async function copyRawRequest() {
  const text = props.rawRequest || ''
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    rawRequestCopied.value = true
    if (rawRequestCopyTimer) window.clearTimeout(rawRequestCopyTimer)
    rawRequestCopyTimer = window.setTimeout(() => {
      rawRequestCopied.value = false
    }, 1500)
  } catch {
    // 降级：保持 rawRequestCopied=false
  }
}

// 关闭时重置提示状态，避免下次打开残留“已复制”与展开状态
watch(
  () => props.visible,
  (v) => {
    if (!v) {
      copied.value = false
      rawRequestCopied.value = false
      showRawRequest.value = false
      if (copyTimer) {
        window.clearTimeout(copyTimer)
        copyTimer = null
      }
      if (rawRequestCopyTimer) {
        window.clearTimeout(rawRequestCopyTimer)
        rawRequestCopyTimer = null
      }
    }
  }
)
</script>

<style scoped>
.dialog-enter-active,
.dialog-leave-active {
  transition: opacity 150ms ease, transform 150ms ease;
}
.dialog-enter-from,
.dialog-leave-to {
  opacity: 0;
  transform: scale(0.98);
}
.raw-request-enter-active,
.raw-request-leave-active {
  transition: opacity 120ms ease;
}
.raw-request-enter-from,
.raw-request-leave-to {
  opacity: 0;
}
</style>
