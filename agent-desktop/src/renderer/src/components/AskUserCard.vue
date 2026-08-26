<template>
  <div class="rounded-2xl bg-surface-1 overflow-hidden">
    <div class="flex items-center gap-2 px-4 h-11">
      <span class="w-5 h-5 rounded-full bg-surface-0 text-text-tertiary flex items-center justify-center flex-shrink-0">
        <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
      </span>
      <span class="text-[13px] text-text-secondary flex-1">询问用户</span>
      <button
        type="button"
        class="w-7 h-7 flex items-center justify-center rounded-full text-text-tertiary hover:text-text-secondary hover:bg-surface-0/70 transition-colors"
        :title="bodyOpen ? '收起' : '展开'"
        @click="bodyOpen = !bodyOpen"
      >
        <svg
          :class="['w-3.5 h-3.5 transition-transform', bodyOpen ? '' : 'rotate-180']"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        ><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m5 15 7-7 7 7" /></svg>
      </button>
    </div>

    <div v-show="bodyOpen" class="px-3 pb-3">
      <div class="rounded-xl bg-surface-0 border border-surface-3/80 overflow-hidden">
        <div class="flex items-center gap-2 px-4 h-10">
          <span class="w-5 h-5 rounded-full bg-primary-50 text-primary-600 flex items-center justify-center flex-shrink-0 text-[11px] font-semibold">?</span>
          <span class="text-[13px] font-medium text-primary-700 truncate">{{ askerName }} 需要你的输入</span>
        </div>

        <div class="px-4 pb-4">
          <template v-if="!isAnswered">
            <div class="flex flex-col gap-5">
              <div v-for="q in questions" :key="q.id">
                <div class="text-[13px] text-text-primary font-medium mb-2.5 leading-snug">{{ q.question }}</div>
                <div class="flex flex-wrap gap-2">
                  <button
                    v-for="opt in optionsOf(q)"
                    :key="opt.id"
                    type="button"
                    @click="toggleOption(q.id, opt.id, q.allow_multiple)"
                    :class="[
                      'px-3 py-[7px] rounded-full text-[13px] leading-none transition-colors',
                      isSelected(q.id, opt.id)
                        ? 'bg-primary-50 text-primary-700'
                        : 'bg-surface-1 text-text-secondary hover:bg-surface-2 hover:text-text-primary'
                    ]"
                  >{{ opt.label }}</button>
                </div>
                <input
                  v-if="showOtherInput(q)"
                  :value="localAnswers[q.id]?.free_text || ''"
                  type="text"
                  placeholder="补充说明（可选）"
                  class="mt-2.5 w-full h-9 px-3.5 text-[13px] rounded-full bg-surface-1 text-text-primary placeholder:text-text-disabled outline-none focus:ring-1 focus:ring-primary-300"
                  @input="ensure(q.id).free_text = ($event.target as HTMLInputElement).value"
                />
              </div>
            </div>
            <div class="mt-5">
              <button
                type="button"
                :disabled="!allAnswered"
                @click="finish"
                :class="[
                  'inline-flex items-center gap-1.5 h-8 px-3.5 text-[13px] rounded-lg transition-colors',
                  allAnswered
                    ? 'bg-primary-600 text-white hover:bg-primary-700'
                    : 'bg-surface-4 text-white/90 cursor-not-allowed'
                ]"
              >
                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" /></svg>
                提交回答
              </button>
            </div>
          </template>
          <template v-else>
            <div class="flex flex-col gap-4">
              <div v-for="q in questions" :key="q.id">
                <div class="text-[13px] text-text-primary font-medium mb-2 leading-snug">{{ q.question }}</div>
                <div class="flex flex-wrap gap-2">
                  <span
                    v-for="opt in selectedOptionsOf(q)"
                    :key="opt.id"
                    class="px-3 py-[7px] rounded-full bg-primary-50 text-primary-700 text-[13px] leading-none"
                  >{{ opt.label }}</span>
                  <span v-if="!selectedOptionsOf(q).length && !freeTextOf(q)" class="text-[12px] text-text-tertiary">未选</span>
                </div>
                <div v-if="freeTextOf(q)" class="mt-1.5 text-[12px] text-text-tertiary">{{ freeTextOf(q) }}</div>
              </div>
            </div>
            <div class="mt-3 text-[11px] text-text-tertiary">
              <span v-if="card.status === 'canceled'">已取消</span>
              <span v-else-if="card.status === 'expired'">已超时</span>
              <span v-else>已提交</span>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { MessageCard, MessageCardQuestion } from '@/stores/chat'

const OTHER_ID = '__other__'

const props = defineProps<{
  card: MessageCard
  askerName?: string
}>()
const emit = defineEmits<{
  (e: 'submit', payload: { answers: Record<string, { selected: string[]; free_text?: string }> }): void
}>()

const askerName = computed(() => (props.askerName || '').trim() || '助手')
const bodyOpen = ref(true)

const questions = computed<MessageCardQuestion[]>(() => {
  const c: any = props.card
  if (Array.isArray(c.questions) && c.questions.length) return c.questions
  if (c.question && Array.isArray(c.options)) {
    return [{ id: 'q0', question: c.question, options: c.options, allow_multiple: c.allow_multiple, allow_free_input: c.allow_free_input }]
  }
  return []
})

const submitted = ref(false)
const isAnswered = computed(() => props.card.status !== 'pending' || submitted.value)

function initAnswers(): Record<string, { selected: string[]; free_text: string }> {
  const c: any = props.card
  const out: Record<string, { selected: string[]; free_text: string }> = {}
  for (const q of questions.value) {
    const a = c.answers?.[q.id]
    out[q.id] = { selected: a?.selected ? [...a.selected] : [], free_text: a?.free_text || '' }
  }
  if (!c.answers && Array.isArray(c.selected) && questions.value[0]) {
    out[questions.value[0].id] = { selected: [...c.selected], free_text: c.free_text || '' }
  }
  return out
}
const localAnswers = ref<Record<string, { selected: string[]; free_text: string }>>(initAnswers())

function isOtherOption(opt: { id?: string; label?: string }): boolean {
  const id = String(opt.id || '')
  if (id === OTHER_ID || id === 'other') return true
  return /^(其他|其它)/.test(String(opt.label || '').replace(/\s/g, ''))
}
function hasOtherOption(q: MessageCardQuestion): boolean {
  return (q.options || []).some(isOtherOption)
}
function optionsOf(q: MessageCardQuestion): MessageCardQuestion['options'] {
  const opts = q.options || []
  if (q.allow_free_input && !hasOtherOption(q)) {
    return [...opts, { id: OTHER_ID, label: '其他...' }]
  }
  return opts
}

function ensure(qid: string): { selected: string[]; free_text: string } {
  if (!localAnswers.value[qid]) localAnswers.value[qid] = { selected: [], free_text: '' }
  return localAnswers.value[qid]
}
function isSelected(qid: string, oid: string): boolean {
  return (localAnswers.value[qid]?.selected || []).includes(oid)
}
function showOtherInput(q: MessageCardQuestion): boolean {
  if (!q.allow_free_input) return false
  const a = localAnswers.value[q.id]
  if (!a) return false
  if (a.free_text.trim()) return true
  const opts = optionsOf(q)
  return a.selected.some((id) => {
    const opt = opts.find((o) => o.id === id)
    return !!opt && isOtherOption(opt)
  })
}
function questionAnswered(q: MessageCardQuestion): boolean {
  const a = localAnswers.value[q.id]
  if (!a) return false
  return a.selected.length > 0 || (!!q.allow_free_input && !!a.free_text.trim())
}
const allAnswered = computed(() => questions.value.every(questionAnswered))

function toggleOption(qid: string, oid: string, multiple?: boolean): void {
  if (isAnswered.value) return
  const a = ensure(qid)
  if (multiple) {
    a.selected = a.selected.includes(oid) ? a.selected.filter((x) => x !== oid) : [...a.selected, oid]
  } else {
    a.selected = [oid]
  }
}

function finish(): void {
  if (isAnswered.value) return
  for (const q of questions.value) if (!questionAnswered(q)) return
  submitted.value = true
  const answers: Record<string, { selected: string[]; free_text?: string }> = {}
  for (const q of questions.value) {
    const a = localAnswers.value[q.id] || { selected: [], free_text: '' }
    const selected = a.selected.filter((id) => id !== OTHER_ID)
    if (a.selected.includes(OTHER_ID) && !selected.includes('other')) selected.push('other')
    answers[q.id] = { selected, free_text: a.free_text.trim() || undefined }
  }
  emit('submit', { answers })
}

function selectedOptionsOf(q: MessageCardQuestion): MessageCardQuestion['options'] {
  const ids = localAnswers.value[q.id]?.selected || []
  return optionsOf(q).filter((o) => ids.includes(o.id))
}
function freeTextOf(q: MessageCardQuestion): string {
  return localAnswers.value[q.id]?.free_text || ''
}
</script>
