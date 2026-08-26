<template>
  <div class="h-full flex flex-col">
    <header class="page-header justify-between">
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="btn-secondary text-xs"
          @click="balanceLogsOpen = true"
        >查看明细</button>
        <button
          v-if="hasOemChannel"
          type="button"
          class="btn-secondary text-xs"
          @click="goOemChannel"
        >渠道中心</button>
        <button
          v-if="siteConfig.hasAnyRecharge"
          type="button"
          class="btn-secondary text-xs"
          @click="goRecharge"
        >充值</button>
        <button
          v-if="siteConfig.plansStore.enabled"
          type="button"
          class="btn-primary text-xs"
          @click="goPlansStore"
        >去套餐商城</button>
      </div>
      <button
        type="button"
        class="btn-secondary text-xs text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 focus:ring-red-500"
        @click="handleLogout"
      >退出登录</button>
    </header>
    <div class="page-body max-w-6xl">
      <div class="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-5 items-start">
        <div class="space-y-5 min-w-0">
          <!-- Balance -->
          <div>
            <AssetSummaryCard
              :hero="!!siteConfig.soloRechargeType"
              :focus-type="siteConfig.soloRechargeType"
              @open-logs="balanceLogsOpen = true"
            />
            <!-- 最近到期预警：仅当最早到期的生效套餐 < 7 天时显示，避免年卡用户被频繁提醒。
                 3-7 天琥珀，<3 天红色；点击滚动到「我的套餐」看详情。 -->
            <div
              v-if="nextExpiring"
              :class="['mt-3 flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-colors',
                nextExpiring.severity === 'danger'
                  ? 'bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/30'
                  : 'bg-amber-50 hover:bg-amber-100 dark:bg-amber-900/20 dark:hover:bg-amber-900/30']"
              @click="scrollToPlans"
            >
              <span :class="['text-xs', nextExpiring.severity === 'danger' ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300']">
                最近到期
                <strong class="mx-1">{{ nextExpiring.plan_name }}</strong>
                <span class="font-mono">{{ nextExpiring.text }}</span>
              </span>
              <span :class="['text-xs', nextExpiring.severity === 'danger' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400']">查看 →</span>
            </div>
          </div>

          <!-- My plans -->
          <div ref="myPlansRef">
            <MyPlansBox />
          </div>

          <!-- Cloud storage -->
          <CloudStorageCard />

          <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <!-- Billing Rules -->
            <div class="card p-5">
              <div class="flex items-center justify-between mb-4">
                <h3 class="text-sm font-semibold text-text-primary">计费标准</h3>
                <span v-if="store.billingRules.length" class="text-[10px] text-text-tertiary">{{ store.billingRules.length }} 条规则</span>
              </div>
              <div v-if="store.billingRules.length" class="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                <div v-for="r in store.billingRules" :key="r.cloud_model_id"
                  class="flex items-center justify-between gap-3 px-3 py-2 bg-surface-1 rounded-lg text-xs">
                  <span class="text-text-primary font-medium truncate">{{ r.model_name }}</span>
                  <span v-if="r.billing_type === 'token'" class="text-text-secondary whitespace-nowrap">
                    {{ r.input_price }} / {{ r.output_price }} {{ siteConfig.labels.token }} / M tokens
                  </span>
                  <span v-else-if="r.model_type === 'chat'" class="text-text-secondary whitespace-nowrap">
                    {{ r.input_price }} / {{ r.output_price }} {{ siteConfig.labels.credit }} / M tokens
                  </span>
                  <span v-else class="text-text-secondary whitespace-nowrap">
                    {{ r.credit_per_call }} {{ siteConfig.labels.credit }}/次
                  </span>
                </div>
              </div>
              <div v-else class="text-xs text-text-tertiary">暂无计费标准</div>
            </div>

            <!-- Cloud Models -->
            <div class="card p-5">
              <div class="flex items-center justify-between mb-4">
                <h3 class="text-sm font-semibold text-text-primary">云端模型</h3>
                <span class="text-[10px] text-text-tertiary">{{ store.models.length }} 个模型</span>
              </div>
              <div v-if="store.models.length" class="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                <div v-for="m in store.models" :key="m.id"
                  class="flex items-center justify-between gap-3 px-3 py-2 bg-surface-1 rounded-lg">
                  <div class="min-w-0">
                    <span class="text-xs font-medium text-text-primary truncate block">{{ m.name || '未命名模型' }}</span>
                  </div>
                  <span class="text-[10px] px-2 py-0.5 bg-surface-2 rounded text-text-secondary whitespace-nowrap">{{ m.type }}</span>
                </div>
              </div>
              <div v-else class="text-xs text-text-tertiary">暂无分配模型</div>
            </div>
          </div>
        </div>

        <aside class="space-y-5 xl:sticky xl:top-4">
          <div v-if="siteConfig.customerService" class="card p-5">
            <h3 class="text-sm font-semibold text-text-primary mb-4">{{ siteConfig.customerService.title }}</h3>
            <img
              :src="siteConfig.customerService.image_url"
              alt="客服信息"
              class="w-full rounded-xl border border-surface-3 bg-surface-1 object-contain"
            />
          </div>

          <!-- User Info -->
          <div class="card p-5">
            <h3 class="text-sm font-semibold text-text-primary mb-4">用户信息</h3>
            <div class="space-y-3 text-xs">
              <div class="flex items-center justify-between gap-3">
                <span class="text-text-tertiary">ID</span>
                <span class="text-text-primary font-medium font-mono truncate">{{ store.user?.id }}</span>
              </div>
              <div class="flex items-center justify-between gap-3">
                <span class="text-text-tertiary">用户名</span>
                <span class="text-text-primary font-medium truncate">{{ store.user?.username }}</span>
              </div>
              <div class="flex items-center justify-between gap-3">
                <span class="text-text-tertiary">昵称</span>
                <span class="text-text-primary font-medium truncate">{{ store.user?.nickname || '-' }}</span>
              </div>
              <div class="flex items-center justify-between gap-3">
                <span class="text-text-tertiary">邮箱</span>
                <span class="text-text-primary font-medium truncate">{{ store.user?.email || '-' }}</span>
              </div>
            </div>
          </div>

          <!-- Plans store entry -->
          <div v-if="siteConfig.plansStore.enabled" class="card p-5">
            <div class="min-w-0">
              <h3 class="text-sm font-semibold text-text-primary">套餐商城</h3>
              <p class="text-xs text-text-tertiary mt-1 leading-relaxed">购买、升级或续费套餐，支付后自动开通。</p>
            </div>
            <button
              type="button"
              class="btn-primary text-xs w-full mt-4"
              @click="goPlansStore"
            >去套餐商城</button>
          </div>

          <div v-if="hasOemChannel" class="card p-5">
            <div class="min-w-0">
              <h3 class="text-sm font-semibold text-text-primary">渠道中心</h3>
              <p class="text-xs text-text-tertiary mt-1 leading-relaxed">查看 OEM 项目、渠道订单和佣金记录。</p>
            </div>
            <button
              type="button"
              class="btn-secondary text-xs w-full mt-4"
              @click="goOemChannel"
            >查看渠道中心</button>
          </div>

          <!-- Redeem code -->
          <RedeemBox />

          <!-- Change Password -->
          <div class="card p-5">
            <h3 class="text-sm font-semibold text-text-primary mb-4">修改密码</h3>
            <form @submit.prevent="handleChangePassword" class="space-y-3">
              <input v-model="pwdForm.oldPassword" type="password" placeholder="当前密码"
                class="w-full px-3 py-2 text-xs bg-surface-2 border border-surface-3 rounded-lg text-text-primary outline-none focus:border-primary-500" />
              <input v-model="pwdForm.newPassword" type="password" placeholder="新密码"
                class="w-full px-3 py-2 text-xs bg-surface-2 border border-surface-3 rounded-lg text-text-primary outline-none focus:border-primary-500" />
              <input v-model="pwdForm.confirmPassword" type="password" placeholder="确认新密码"
                class="w-full px-3 py-2 text-xs bg-surface-2 border border-surface-3 rounded-lg text-text-primary outline-none focus:border-primary-500" />
              <div v-if="pwdError" class="text-xs text-red-500 dark:text-red-400">{{ pwdError }}</div>
              <div v-if="pwdSuccess" class="text-xs text-emerald-600 dark:text-emerald-400">{{ pwdSuccess }}</div>
              <button type="submit" :disabled="pwdLoading"
                class="btn-primary text-xs w-full">
                {{ pwdLoading ? '...' : '修改密码' }}
              </button>
            </form>
          </div>

        </aside>
      </div>
    </div>

    <!-- Balance logs dialog -->
    <BalanceLogsDialog v-model:visible="balanceLogsOpen" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useCloudAuthStore } from '@/stores/cloud-auth'
import { useSiteConfigStore } from '@/stores/site-config'
import AssetSummaryCard from '@/components/AssetSummaryCard.vue'
import RedeemBox from '@/components/RedeemBox.vue'
import MyPlansBox from '@/components/MyPlansBox.vue'
import CloudStorageCard from '@/components/CloudStorageCard.vue'
import BalanceLogsDialog from '@/components/BalanceLogsDialog.vue'
import { cloudClient } from '@/utils/cloud-api'

const router = useRouter()
const store = useCloudAuthStore()
const siteConfig = useSiteConfigStore()

const pwdForm = ref({ oldPassword: '', newPassword: '', confirmPassword: '' })
const pwdError = ref('')
const pwdSuccess = ref('')
const pwdLoading = ref(false)
const balanceLogsOpen = ref(false)
const myPlansRef = ref<HTMLElement | null>(null)
const hasOemChannel = ref(false)

/**
 * 计算「最近要过期」的生效套餐，仅当剩余 < 7 天时才返回预警信息：
 * - 过滤：status='active' 且 expires_at 非空（永久套餐不参与）
 * - 按 expires_at 升序取首个（最近过期的）
 * - 剩余 >= 7 天返回 null，避免年卡用户被不必要的提醒打扰
 * - 3-7 天：severity='warn'（3-7 天陈色 / 琥珀色）
 * - <3 天：severity='danger'（红色高优先）
 * 与 MyPlansBox 里 remainingClass 阈值保持一致。
 */
const nextExpiring = computed(() => {
  const candidates = (store.plans || [])
    .filter(p => p.status === 'active' && p.expires_at)
    .sort((a, b) => new Date(a.expires_at!).getTime() - new Date(b.expires_at!).getTime())
  if (!candidates.length) return null
  const p = candidates[0]
  const diff = new Date(p.expires_at!).getTime() - Date.now()
  if (diff <= 0) return null  // 已过期但后端还未跨上 status 为 expired，此处不预警避免误导
  const days = diff / 86400000
  if (days >= 7) return null

  let text: string
  const wholeDays = Math.floor(days)
  if (wholeDays >= 1) {
    text = `还剩 ${wholeDays} 天`
  } else {
    const hours = Math.floor(diff / 3600000)
    if (hours >= 1) text = `还剩 ${hours} 小时`
    else text = `还剩 ${Math.max(1, Math.floor(diff / 60000))} 分钟`
  }
  return {
    plan_name: p.plan_name,
    text,
    severity: days < 3 ? 'danger' as const : 'warn' as const,
  }
})

function scrollToPlans() {
  myPlansRef.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

async function handleChangePassword() {
  pwdError.value = ''
  pwdSuccess.value = ''
  if (pwdForm.value.newPassword !== pwdForm.value.confirmPassword) {
    pwdError.value = '两次密码不一致'
    return
  }
  if (pwdForm.value.newPassword.length < 6) {
    pwdError.value = '密码至少 6 位'
    return
  }
  pwdLoading.value = true
  try {
    await store.changePassword(pwdForm.value.oldPassword, pwdForm.value.newPassword)
    pwdSuccess.value = '密码修改成功'
    pwdForm.value = { oldPassword: '', newPassword: '', confirmPassword: '' }
  } catch (e: any) {
    pwdError.value = e.message || '操作失败'
  } finally {
    pwdLoading.value = false
  }
}

function handleLogout() {
  store.logout()
  router.replace('/login')
}

function goPlansStore() {
  router.push('/plans-store')
}

function goRecharge() {
  router.push('/recharge')
}

function goOemChannel() {
  router.push('/oem-channel')
}

async function loadOemChannelVisibility() {
  try {
    const profile = await cloudClient.oemChannelProfile()
    hasOemChannel.value = Array.isArray(profile?.projects) && profile.projects.length > 0
  } catch {
    hasOemChannel.value = false
  }
}

onMounted(() => {
  store.fetchCloudData()
  loadOemChannelVisibility()
  // 刷新公开配置，确保套餐商城 / 充值入口开关取云控端最新值（无需重启应用）
  siteConfig.fetch()
})
</script>
