import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface PromptSkill {
  id: string
  name: string
  description: string
  dirName: string
  enabled: boolean
  category?: string
  origin?: 'official' | 'local' | 'cloud'
  reviewed?: boolean
  skillId?: string
  versionId?: string
  version?: string
}

export const usePromptSkillStore = defineStore('promptSkills', () => {
  const skills = ref<PromptSkill[]>([])
  const loading = ref(false)
  const catalog = ref<any>({ items: [], offline: false, cursor: '' })

  async function fetchCatalog() {
    catalog.value = await window.api.promptSkill.invoke('catalog')
  }

  async function installCloud(versionId: string) {
    const result = (await window.api.promptSkill.invoke('installCloud', versionId)) as any
    if (result?.success) {
      await fetchSkills()
      await fetchCatalog()
    }
    return result
  }

  async function fetchSkills() {
    loading.value = true
    try {
      skills.value = (await window.api.promptSkill.invoke('list')) as PromptSkill[]
    } finally {
      loading.value = false
    }
  }

  async function getContent(dirName: string): Promise<string> {
    return (await window.api.promptSkill.invoke('getContent', dirName)) as string
  }

  async function toggleSkill(dirName: string, enabled: boolean) {
    await window.api.promptSkill.invoke('toggle', dirName, enabled)
    const s = skills.value.find((sk) => sk.dirName === dirName)
    if (s) s.enabled = enabled
  }

  async function deleteSkill(dirName: string) {
    await window.api.promptSkill.invoke('delete', dirName)
    skills.value = skills.value.filter((s) => s.dirName !== dirName)
  }

  async function createSkill(name: string, description: string, content: string, overwrite = false) {
    const result = (await window.api.promptSkill.invoke('create', name, description, content, overwrite)) as PromptSkill
    const idx = skills.value.findIndex((s) => s.dirName === result.dirName || s.name === result.name)
    if (idx >= 0) skills.value[idx] = result
    else skills.value.push(result)
    return result
  }

  async function getSkillsDir(): Promise<string> {
    return (await window.api.promptSkill.invoke('getDir')) as string
  }

  async function installFromPath(sourcePath: string): Promise<{ success: boolean; name?: string; error?: string }> {
    const result = (await window.api.promptSkill.invoke('installFromPath', sourcePath)) as any
    if (result.success) await fetchSkills()
    return result
  }

  return {
    skills,
    loading,
    catalog,
    fetchCatalog,
    installCloud,
    fetchSkills,
    getContent,
    toggleSkill,
    deleteSkill,
    createSkill,
    getSkillsDir,
    installFromPath
  }
})
