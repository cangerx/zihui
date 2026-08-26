import { computed, onUnmounted, ref, watch, type Ref } from 'vue'

const COMPLETE_SYS =
  '你是输入补全助手。根据用户已输入的中文草稿，只续写后半句，补全意图。不要重复已有文字，不要解释，不要加引号，不要换行，不超过 40 个字。'

const OPTIMIZE_SYS =
  '你是提示词编辑。把用户草稿改成更清楚、可执行的对话请求：保留原意，补上缺失的对象/约束/输出格式。只输出改写后的全文，不要解释。'

function asString(result: unknown): string {
  if (typeof result === 'string') return result.trim()
  if (result && typeof result === 'object' && 'content' in (result as object)) {
    return String((result as { content?: string }).content || '').trim()
  }
  return String(result || '').trim()
}

export function useComposerAssist(opts: {
  text: Ref<string>
  providerId: () => string
  modelId: () => string
}) {
  const suggestion = ref('')
  const busy = ref<'complete' | 'optimize' | ''>('')
  const errorText = ref('')
  let timer: ReturnType<typeof setTimeout> | null = null
  let seq = 0

  const canAssist = computed(() => Boolean(opts.providerId() && opts.modelId() && opts.text.value.trim()))

  async function callLlm(system: string, user: string): Promise<string> {
    const providerId = opts.providerId()
    const modelId = opts.modelId()
    if (!providerId || !modelId) return ''
    const llm = (window as any).api?.llm
    if (!llm?.invoke) return ''
    const result = await llm.invoke('call', providerId, modelId, [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ])
    return asString(result)
  }

  function scheduleComplete() {
    if (timer) clearTimeout(timer)
    suggestion.value = ''
    errorText.value = ''
    if (!canAssist.value || busy.value) return
    timer = setTimeout(() => {
      void complete()
    }, 500)
  }

  async function complete() {
    const draft = opts.text.value.trim()
    if (!draft || !opts.providerId() || !opts.modelId()) return
    const my = ++seq
    busy.value = 'complete'
    try {
      const out = await callLlm(COMPLETE_SYS, draft)
      if (my !== seq) return
      suggestion.value = out
    } catch (e: any) {
      if (my !== seq) return
      suggestion.value = ''
      errorText.value = e?.message || '补全失败'
      setTimeout(() => { if (errorText.value) errorText.value = '' }, 3000)
    } finally {
      if (my === seq) busy.value = ''
    }
  }

  async function optimize() {
    const draft = opts.text.value.trim()
    if (!draft || !opts.providerId() || !opts.modelId() || busy.value) return
    const my = ++seq
    suggestion.value = ''
    busy.value = 'optimize'
    try {
      const out = await callLlm(OPTIMIZE_SYS, draft)
      if (my !== seq) return
      if (out) opts.text.value = out
    } catch (e: any) {
      if (my !== seq) return
      errorText.value = e?.message || '优化失败'
      setTimeout(() => { if (errorText.value) errorText.value = '' }, 3000)
    } finally {
      if (my === seq) busy.value = ''
    }
  }

  function acceptSuggestion() {
    const extra = suggestion.value
    if (!extra) return
    const cur = opts.text.value
    const joiner = !cur || /\s$/.test(cur) ? '' : ( /[，。！？、]$/.test(cur) ? '' : '')
    opts.text.value = cur + joiner + extra
    suggestion.value = ''
  }

  function onTab(event: KeyboardEvent) {
    event.preventDefault()
    if (event.isComposing || event.keyCode === 229) return
    if (suggestion.value) {
      acceptSuggestion()
      return
    }
    if (opts.text.value.trim() && canAssist.value && !busy.value) {
      void optimize()
    }
  }

  function cancel() {
    seq += 1
    busy.value = ''
    suggestion.value = ''
  }

  watch(() => opts.text.value, () => {
    if (busy.value === 'optimize') return
    scheduleComplete()
  })

  onUnmounted(() => {
    if (timer) clearTimeout(timer)
    seq += 1
  })

  return { suggestion, busy, errorText, canAssist, optimize, acceptSuggestion, onTab, cancel }
}
