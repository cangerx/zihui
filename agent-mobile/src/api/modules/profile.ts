import type { AppBalance, AppUser } from '@zihui/contracts'
import type { LoginAccount } from '../types'
import { appV1Client } from '../v1-client'

export interface ProfileSnapshot {
  account: LoginAccount
  balances: AppBalance[]
}

function toLoginAccount(user: AppUser): LoginAccount {
  return {
    id: user.id,
    username: user.username,
    email: user.email || undefined,
    phone: user.phone || undefined,
    nickname: user.nickname,
    avatar: user.avatar || undefined,
  }
}

export async function getProfileSnapshot(): Promise<ProfileSnapshot> {
  const currentUser = await appV1Client.me()
  const balances = await appV1Client.balance()
  return { account: toLoginAccount(currentUser), balances }
}

export async function signOut(): Promise<void> {
  await appV1Client.logout()
}
