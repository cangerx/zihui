import { defineStore } from 'pinia'
import { ref } from 'vue'

function plain<T>(data: T): T {
  return JSON.parse(JSON.stringify(data))
}

export interface Persona {
  id: string
  name: string
  system_prompt: string
  created_at: string
  updated_at: string
}

export const usePersonaStore = defineStore('personas', () => {
  const personas = ref<Persona[]>([])
  const loading = ref(false)

  async function fetchPersonas() {
    loading.value = true
    try {
      personas.value = (await window.api.persona.invoke('list')) as Persona[]
    } finally {
      loading.value = false
    }
  }

  async function createPersona(data: { name: string; system_prompt: string }) {
    const result = (await window.api.persona.invoke('create', plain(data))) as Persona
    personas.value.unshift(result)
    return result
  }

  async function updatePersona(id: string, data: Partial<Persona>) {
    const result = (await window.api.persona.invoke('update', id, plain(data))) as Persona
    const idx = personas.value.findIndex((p) => p.id === id)
    if (idx !== -1) personas.value[idx] = result
    return result
  }

  async function deletePersona(id: string) {
    await window.api.persona.invoke('delete', id)
    personas.value = personas.value.filter((p) => p.id !== id)
  }

  return { personas, loading, fetchPersonas, createPersona, updatePersona, deletePersona }
})
