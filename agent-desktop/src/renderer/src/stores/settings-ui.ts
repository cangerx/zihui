import { defineStore } from 'pinia'
import { ref } from 'vue'

/** 设置居中模态分类（含钱包、模型、MCP、ClawBot） */
export type SettingsCategory =
  | 'general'
  | 'preferences'
  | 'connection'
  | 'wallet'
  | 'models'
  | 'mcp'
  | 'clawbot'
  | 'data'
  | 'about'

export const useSettingsUiStore = defineStore('settings-ui', () => {
  const open = ref(false)
  const category = ref<SettingsCategory>('general')

  function show(cat?: SettingsCategory) {
    if (cat) category.value = cat
    open.value = true
  }

  function hide() {
    open.value = false
  }

  function setCategory(cat: SettingsCategory) {
    category.value = cat
  }

  return { open, category, show, hide, setCategory }
})
