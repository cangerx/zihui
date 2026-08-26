import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * 跨页面内容流转中转站。
 * 一次性消费：来源页 set(target, payload)，目标页 onMounted 调用 consume(target)，
 * 命中即填入对应字段，避免路由 query 携带长文本。
 *
 * 已用 target：
 *  - imageGen          { prompt?: string; presetPrompt?: string; presetSize?: string; size?: string; refImages?: string[] }
 *  - batchGen          { prompt?: string }
 *  - canvasOrchestrate { description: string }  // List 页打开新建对话框；创建后由 List 页再次 set 透传给 Editor
 *  - chatBrandAttachments { paths: string[] }   // 品牌工作区 / 生图页带参考图开聊
 */
export const useHandoffStore = defineStore('handoff', () => {
  const pending = ref<Record<string, any>>({})

  function set(target: string, payload: any): void {
    pending.value[target] = payload
  }

  function consume<T = any>(target: string): T | null {
    const v = pending.value[target]
    if (v === undefined) return null
    delete pending.value[target]
    return v as T
  }

  function peek<T = any>(target: string): T | null {
    return (pending.value[target] as T) ?? null
  }

  return { set, consume, peek }
})
