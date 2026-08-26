import type { AdminUser } from '@/types'

const TOKEN_KEY = 'agent-build:admin:token'
const USER_KEY = 'agent-build:admin:user'

interface AuthState {
  token: string | null
  user: AdminUser | null
}

type Listener = (state: AuthState) => void

class AuthStore {
  private listeners = new Set<Listener>()

  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY)
  }

  getUser(): AdminUser | null {
    const raw = localStorage.getItem(USER_KEY)
    if (!raw) return null
    try {
      return JSON.parse(raw) as AdminUser
    } catch {
      return null
    }
  }

  set(token: string, user: AdminUser): void {
    localStorage.setItem(TOKEN_KEY, token)
    localStorage.setItem(USER_KEY, JSON.stringify(user))
    this.emit()
  }

  setUser(user: AdminUser): void {
    localStorage.setItem(USER_KEY, JSON.stringify(user))
    this.emit()
  }

  clear(): void {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    this.emit()
  }

  isAuthenticated(): boolean {
    return Boolean(this.getToken())
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(): void {
    const state: AuthState = { token: this.getToken(), user: this.getUser() }
    this.listeners.forEach((l) => l(state))
  }
}

export const authStore = new AuthStore()
