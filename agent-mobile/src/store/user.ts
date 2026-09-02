import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { clearAuth, getAccount, getToken, setAccount, setAuth } from '@/api/auth-storage'
import type { LoginAccount, LoginResult } from '@/api/types'

export const useUserStore = defineStore('user', () => {
  const token = ref(getToken())
  const account = ref<LoginAccount | null>(getAccount())

  const isLogin = computed(() => Boolean(token.value))
  const nickname = computed(
    () => account.value?.nickname || account.value?.username || account.value?.real_name || '',
  )
  const avatar = computed(() => account.value?.avatar || '')

  function applyLogin(result: LoginResult) {
    token.value = result.token
    account.value = result.account
    setAuth(result.token, result.account)
  }

  function applyAccount(next: LoginAccount) {
    account.value = next
    setAccount(next)
  }

  function logout() {
    token.value = ''
    account.value = null
    clearAuth()
  }

  return { token, account, isLogin, nickname, avatar, applyLogin, applyAccount, logout }
})
