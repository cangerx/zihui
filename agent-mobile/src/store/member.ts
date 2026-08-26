import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * 会员与美豆状态
 * TODO(api)：会员/美豆接口后端未提供，先本地维护，联调时替换为接口数据
 */
export const useMemberStore = defineStore('member', () => {
  /** 会员等级：none / basic / premium */
  const level = ref<'none' | 'basic' | 'premium'>('none')
  /** 美豆余额 */
  const beans = ref(0)
  /** 生成模式 */
  const runMode = ref<'normal' | 'advanced'>('advanced')
  /** 是否已展示过 1.1 元限时弹窗（每次冷启动一次） */
  const promoShown = ref(false)

  function setLevel(next: 'none' | 'basic' | 'premium') {
    level.value = next
  }

  function markPromoShown() {
    promoShown.value = true
  }

  function setRunMode(mode: 'normal' | 'advanced') {
    runMode.value = mode
  }

  return { level, beans, runMode, promoShown, setLevel, markPromoShown, setRunMode }
})
