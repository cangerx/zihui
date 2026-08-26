<template>
  <div class="h-full flex flex-col bg-surface-1">
    <!-- 顶部条 -->
    <div class="flex items-center gap-3 px-5 py-3 border-b border-surface-3 bg-surface-0">
      <div class="flex-1">
        <h2 class="text-sm font-semibold text-text-primary">店铺商品图</h2>
        <p class="text-[11px] text-text-tertiary mt-0.5">绑定{{ mallName }}业务管理端，登录后选门店，用本地图库 / AI 生图替换商品主图、详情图</p>
      </div>
      <button class="btn-primary !py-1.5 !px-3 text-xs" @click="openCreate">新建连接器</button>
    </div>

    <!-- 未开通 -->
    <div v-if="!allowed" class="flex-1 flex items-center justify-center">
      <div class="text-center text-text-tertiary">
        <p class="text-sm">当前账号未开通「店铺商品图」功能</p>
        <p class="text-xs mt-1">请联系管理员开通后使用</p>
      </div>
    </div>

    <!-- 连接器列表 -->
    <div v-else class="flex-1 overflow-y-auto p-5">
      <div v-if="store.loading" class="text-center text-text-tertiary text-sm py-10">加载中…</div>
      <div v-else-if="!store.connectors.length" class="text-center text-text-tertiary text-sm py-10">
        还没有连接器，点击右上角「新建连接器」开始
      </div>
      <div v-else class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <div
          v-for="c in store.connectors"
          :key="c.id"
          class="bg-surface-0 border border-surface-3 rounded-xl p-4 flex flex-col gap-3 shadow-sm"
        >
          <div class="flex items-start gap-2">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <span class="text-sm font-semibold text-text-primary truncate">{{ c.name }}</span>
                <span v-if="c.is_default" class="text-[10px] px-1.5 py-0.5 rounded bg-primary-50 text-primary-700">默认</span>
              </div>
              <p class="text-[11px] text-text-tertiary truncate mt-0.5">{{ c.base_url }}</p>
              <p class="text-[11px] text-text-tertiary truncate">账号 {{ c.account_masked }}</p>
            </div>
          </div>

          <!-- 登录状态 -->
          <div class="text-[11px] rounded-md px-2 py-1.5" :class="loginBadgeClass(c)">
            {{ loginText(c) }}
          </div>

          <!-- 当前门店 -->
          <div v-if="c.current_shop_id" class="text-[11px] text-text-secondary">
            当前门店：<span class="text-text-primary font-medium">{{ c.current_shop_name || c.current_shop_id }}</span>
          </div>

          <div class="flex flex-wrap gap-1.5 mt-auto pt-2 border-t border-surface-2">
            <button v-if="!loginInfo(c.id)" class="ewei-chip-primary" :disabled="busy[c.id]" @click="doLogin(c)">
              {{ busy[c.id] === 'login' ? '登录中…' : '登录' }}
            </button>
            <template v-else>
              <button v-if="connNeedsShop(c)" class="ewei-chip" :disabled="!!busy[c.id]" @click="openShops(c)">选门店</button>
              <button class="ewei-chip-primary" :disabled="connNeedsShop(c) && !c.current_shop_id" @click="enterGoods(c)">进入商品</button>
              <button class="ewei-chip" @click="doLogout(c)">登出</button>
            </template>
            <button class="ewei-chip" @click="openEdit(c)">编辑</button>
            <button class="ewei-chip-danger" @click="onDelete(c)">删除</button>
          </div>

          <p v-if="warn[c.id]" class="text-[11px] text-amber-600">{{ warn[c.id] }}</p>
        </div>
      </div>
    </div>

    <!-- 新建 / 编辑 弹窗（仅阴影，无遮罩） -->
    <div v-if="formOpen" class="fixed inset-0 z-50 flex items-center justify-center" @click.self="formOpen = false">
      <div class="w-[440px] bg-surface-0 border border-surface-3 rounded-2xl shadow-2xl p-5">
        <h3 class="text-sm font-semibold text-text-primary mb-3">{{ form.id ? '编辑连接器' : '新建连接器' }}</h3>
        <div class="space-y-3">
          <label class="block">
            <span class="text-xs font-medium text-text-secondary">对接商城</span>
            <select v-model="form.platform" class="ewei-input" :disabled="!!form.id">
              <option v-for="p in platformOptions" :key="p.key" :value="p.key">{{ platformLabel(p.key) }}</option>
            </select>
            <span v-if="form.id" class="text-[11px] text-text-tertiary mt-1 block">商城类型创建后不可更改</span>
          </label>
          <label class="block">
            <span class="text-xs font-medium text-text-secondary">名称</span>
            <input v-model="form.name" class="ewei-input" :placeholder="'如：我的' + mallNameOf(form.platform) + '-生产'" />
          </label>
          <label class="block">
            <span class="text-xs font-medium text-text-secondary">业务管理端域名</span>
            <input v-model="form.base_url" class="ewei-input" placeholder="如：shop.example.com" />
          </label>
          <label class="block">
            <span class="text-xs font-medium text-text-secondary">登录账号</span>
            <input v-model="form.account" class="ewei-input" placeholder="用户名 / 手机号 / 邮箱" />
          </label>
          <label class="block">
            <span class="text-xs font-medium text-text-secondary">登录密码</span>
            <input v-model="form.password" type="password" class="ewei-input" :placeholder="form.id ? '留空表示不修改' : mallNameOf(form.platform) + '登录密码'" />
            <span class="text-[11px] text-text-tertiary mt-1 block">密码经 AES-256-GCM 本地加密存储，仅用于登录你的{{ mallNameOf(form.platform) }}；不会上传，换机后需重输。</span>
          </label>
          <label class="flex items-center gap-2 text-xs text-text-secondary">
            <input v-model="form.is_default" type="checkbox" class="rounded" />
            设为默认连接器
          </label>
        </div>
        <p v-if="formError" class="text-[11px] text-error mt-2">{{ formError }}</p>
        <div class="flex justify-end gap-2 mt-4">
          <button class="ewei-chip" @click="formOpen = false">取消</button>
          <button class="btn-primary !py-1.5 !px-4 text-xs" :disabled="saving" @click="saveForm">{{ saving ? '保存中…' : '保存' }}</button>
        </div>
      </div>
    </div>

    <!-- 选门店 弹窗 -->
    <div v-if="shopsOpen" class="fixed inset-0 z-50 flex items-center justify-center" @click.self="shopsOpen = false">
      <div class="w-[560px] max-h-[80vh] flex flex-col bg-surface-0 border border-surface-3 rounded-2xl shadow-2xl p-5">
        <div class="flex items-center gap-2 mb-3">
          <h3 class="text-sm font-semibold text-text-primary flex-1">选择门店</h3>
          <input v-model="shopKeyword" class="ewei-input !mt-0 !w-44" placeholder="搜索门店名" />
        </div>
        <div class="flex-1 overflow-y-auto -mx-1 px-1">
          <div v-if="shopsLoading" class="text-center text-text-tertiary text-sm py-8">加载中…</div>
          <div v-else-if="!filteredShops.length" class="text-center text-text-tertiary text-sm py-8">无匹配门店</div>
          <button
            v-for="s in filteredShops"
            :key="s.id"
            class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-surface-2 text-left transition-colors"
            :class="{ 'bg-primary-50': activeConnector && getConnector(activeConnector)?.current_shop_id === s.id }"
            :disabled="!!switchingShopId"
            @click="chooseShop(s)"
          >
            <div class="flex-1 min-w-0">
              <div class="text-sm text-text-primary truncate">{{ s.name }}</div>
              <div class="text-[11px] text-text-tertiary">{{ s.status_text || '—' }}<template v-if="s.goods_count > 0"> · {{ s.goods_count }} 件商品</template></div>
            </div>
            <span v-if="switchingShopId === s.id" class="text-[11px] text-primary-600">进入中…</span>
          </button>
        </div>
        <div class="flex items-center justify-between mt-3 pt-3 border-t border-surface-2 text-xs text-text-tertiary">
          <span>共 {{ shopsCount }} 个门店</span>
          <div class="flex gap-2">
            <button class="ewei-chip" :disabled="shopPage <= 1" @click="loadShops(shopPage - 1)">上一页</button>
            <button class="ewei-chip" :disabled="shopPage * shopPageSize >= shopsCount" @click="loadShops(shopPage + 1)">下一页</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 验证码登录弹窗（点大等需验证码的平台；仅阴影，无遮罩）-->
    <div v-if="captchaOpen" class="fixed inset-0 z-50 flex items-center justify-center" @click.self="captchaOpen = false">
      <div class="w-[360px] bg-surface-0 border border-surface-3 rounded-2xl shadow-2xl p-5">
        <h3 class="text-sm font-semibold text-text-primary mb-3">输入验证码登录</h3>
        <div class="flex items-center gap-2 mb-2">
          <img
            v-if="captchaImage"
            :src="captchaImage"
            class="h-11 rounded-md border border-surface-3 bg-white cursor-pointer flex-shrink-0"
            alt="验证码"
            title="点击换一张"
            @click="refreshCaptchaImg"
          />
          <input
            v-model="captchaInput"
            class="ewei-input !mt-0 flex-1"
            placeholder="输入图中字符"
            @keyup.enter="submitCaptcha"
          />
        </div>
        <button class="text-[11px] text-primary-600 mb-2" @click="refreshCaptchaImg">看不清，换一张</button>
        <p v-if="captchaError" class="text-[11px] text-error mb-2">{{ captchaError }}</p>
        <div class="flex justify-end gap-2 mt-2">
          <button class="ewei-chip" @click="captchaOpen = false">取消</button>
          <button
            class="btn-primary !py-1.5 !px-4 text-xs"
            :disabled="captchaSubmitting || !captchaInput.trim()"
            @click="submitCaptcha"
          >
            {{ captchaSubmitting ? '登录中…' : '登录' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useCloudAuthStore } from '@/stores/cloud-auth'
import { useEweiStore, type EweiConnectorSummary, type EweiShop } from '@/stores/ewei'
import { MALL_KEYS } from '@shared/mall-keys'

const router = useRouter()
const cloudAuth = useCloudAuthStore()
const store = useEweiStore()

// 页面门控与侧栏一致：任一商城被授权即可进入（含 qdyun；按商城聚合 shops 优先、回退平铺 allow_{mall}_shop）
const allowed = computed(
  () => mallAllowed('ewei') || mallAllowed('dianda') || mallAllowed('qdyun'),
)
// 某商城是否被授权 —— 统一走 cloud-auth store 的单一来源（菜单/路由/View 一致）
function mallAllowed(key: string): boolean {
  return cloudAuth.mallAllowed(key)
}
// 商城显示名（按商城）—— 同走 store 单一来源
function mallNameOf(key: string): string {
  return cloudAuth.mallName(key)
}
// 顶部说明用任一已授权商城名（缺省「商城」）
const mallName = computed(() => mallNameOf('ewei') || mallNameOf('dianda') || '商城')

const busy = reactive<Record<string, '' | 'login'>>({})
const warn = reactive<Record<string, string>>({})

function loginInfo(id: string) {
  return store.loginInfo[id]
}
function getConnector(id: string) {
  return store.getConnector(id)
}

function loginText(c: EweiConnectorSummary): string {
  const info = loginInfo(c.id)
  if (info) return `已登录：${info.contact || info.account}`
  if (c.last_login_status === 'failed') return `上次登录失败：${c.last_login_message || ''}`
  if (c.last_login_status === 'success') return '未登录（本次会话）'
  return '未登录'
}
function loginBadgeClass(c: EweiConnectorSummary): string {
  if (loginInfo(c.id)) return 'bg-emerald-50 text-emerald-700'
  if (c.last_login_status === 'failed') return 'bg-red-50 text-error'
  return 'bg-surface-2 text-text-tertiary'
}

// ---- 登录 / 登出 ----
async function doLogin(c: EweiConnectorSummary): Promise<void> {
  busy[c.id] = 'login'
  warn[c.id] = ''
  try {
    const r = await store.login(c.id)
    if (r.needCaptcha) {
      openCaptcha(c, r.captchaImage)
      return
    }
    if (r.result.isMerch || r.result.isSupply) {
      warn[c.id] = '检测到子商户 / 供货商账号，部分商品（多商户来源）的图片可能无法直接替换，建议用店主账号'
    }
    await store.loadConnectors()
  } catch (e: any) {
    warn[c.id] = e?.message || '登录失败'
  } finally {
    busy[c.id] = ''
  }
}

// ---- 验证码登录（点大等需验证码的平台）----
const captchaOpen = ref(false)
const captchaConnector = ref<EweiConnectorSummary | null>(null)
const captchaImage = ref('')
const captchaInput = ref('')
const captchaSubmitting = ref(false)
const captchaError = ref('')

function openCaptcha(c: EweiConnectorSummary, img: string): void {
  captchaConnector.value = c
  captchaImage.value = img
  captchaInput.value = ''
  captchaError.value = ''
  captchaOpen.value = true
}
async function refreshCaptchaImg(): Promise<void> {
  if (!captchaConnector.value) return
  try {
    const r = await store.refreshCaptcha(captchaConnector.value.id)
    captchaImage.value = r.captchaImage
    captchaInput.value = ''
  } catch (e: any) {
    captchaError.value = e?.message || '刷新失败'
  }
}
async function submitCaptcha(): Promise<void> {
  const c = captchaConnector.value
  if (!c || !captchaInput.value.trim()) return
  captchaSubmitting.value = true
  captchaError.value = ''
  try {
    const r = await store.submitLogin(c.id, captchaInput.value.trim())
    if (r.needCaptcha) {
      captchaImage.value = r.captchaImage
      captchaInput.value = ''
      captchaError.value = '验证码错误，请重试'
      return
    }
    captchaOpen.value = false
    await store.loadConnectors()
  } catch (e: any) {
    captchaError.value = e?.message || '登录失败'
  } finally {
    captchaSubmitting.value = false
  }
}

// 平台是否需要选门店（与主进程 capabilities 一致：点大无门店）
function connNeedsShop(c: EweiConnectorSummary): boolean {
  return (c.platform || 'ewei') !== 'dianda'
}
// 可选平台（key 为协议标识，对用户隐藏品牌，标签用云控端自定义商城名）。
// 仅展示「该用户被授权」的商城，避免越过二级门控创建未授权平台的连接器。
const platformOptions = computed(() => MALL_KEYS.filter((k) => mallAllowed(k)).map((k) => ({ key: k })))
function platformLabel(key: string): string {
  return mallNameOf(key)
}
async function doLogout(c: EweiConnectorSummary): Promise<void> {
  await store.logout(c.id)
  warn[c.id] = ''
}

function enterGoods(c: EweiConnectorSummary): void {
  router.push(`/ewei/${c.id}/goods`)
}

// ---- 新建 / 编辑 ----
const formOpen = ref(false)
const saving = ref(false)
const formError = ref('')
const form = reactive({ id: '', name: '', base_url: '', account: '', password: '', platform: 'ewei', is_default: false })

function openCreate(): void {
  const firstPlatform = platformOptions.value[0]?.key || 'ewei'
  Object.assign(form, { id: '', name: '', base_url: '', account: '', password: '', platform: firstPlatform, is_default: !store.connectors.length })
  formError.value = ''
  formOpen.value = true
}
function openEdit(c: EweiConnectorSummary): void {
  Object.assign(form, {
    id: c.id,
    name: c.name,
    base_url: c.base_url,
    account: '', // 账号 masked 不回填，留空则不改
    password: '',
    platform: c.platform || 'ewei', // 平台不可改（编辑时只读）
    is_default: c.is_default,
  })
  formError.value = ''
  formOpen.value = true
}
async function saveForm(): Promise<void> {
  formError.value = ''
  // 新建时校验所选平台仍被授权（防越过二级门控建未授权商城连接器）
  if (!form.id && !mallAllowed(form.platform)) {
    formError.value = '该商城未授权，无法创建连接器'
    return
  }
  saving.value = true
  try {
    if (form.id) {
      const patch: any = { name: form.name, base_url: form.base_url, is_default: form.is_default }
      if (form.account.trim()) patch.account = form.account.trim()
      if (form.password) patch.password = form.password
      await store.updateConnector(form.id, patch)
    } else {
      await store.createConnector({
        name: form.name,
        base_url: form.base_url,
        account: form.account,
        password: form.password,
        platform: form.platform,
        is_default: form.is_default,
      })
    }
    formOpen.value = false
  } catch (e: any) {
    formError.value = e?.message || '保存失败'
  } finally {
    saving.value = false
  }
}
async function onDelete(c: EweiConnectorSummary): Promise<void> {
  if (!window.confirm(`删除连接器「${c.name}」？仅删除本地绑定，不影响你的${mallNameOf(c.platform)}。`)) return
  await store.deleteConnector(c.id)
}

// ---- 选门店 ----
const shopsOpen = ref(false)
const shopsLoading = ref(false)
const shops = ref<EweiShop[]>([])
const shopsCount = ref(0)
const shopPage = ref(1)
const shopPageSize = 50
const shopKeyword = ref('')
const activeConnector = ref('')
const switchingShopId = ref<number | null>(null)

const filteredShops = computed(() => {
  const kw = shopKeyword.value.trim()
  if (!kw) return shops.value
  return shops.value.filter((s) => s.name.includes(kw))
})

async function openShops(c: EweiConnectorSummary): Promise<void> {
  activeConnector.value = c.id
  shopKeyword.value = ''
  shopsOpen.value = true
  await loadShops(1)
}
async function loadShops(page: number): Promise<void> {
  if (!activeConnector.value) return
  shopsLoading.value = true
  try {
    const r = await store.listShops(activeConnector.value, page, shopPageSize)
    shops.value = r.list
    shopsCount.value = r.count
    shopPage.value = page
  } catch (e: any) {
    warn[activeConnector.value] = e?.message || '获取门店失败'
    shopsOpen.value = false
  } finally {
    shopsLoading.value = false
  }
}
async function chooseShop(s: EweiShop): Promise<void> {
  if (!activeConnector.value) return
  switchingShopId.value = s.id
  try {
    await store.switchShop(activeConnector.value, s.id, s.name)
    shopsOpen.value = false
  } catch (e: any) {
    warn[activeConnector.value] = e?.message || '进入门店失败'
  } finally {
    switchingShopId.value = null
  }
}

onMounted(() => {
  if (allowed.value) store.loadConnectors()
})
</script>

<style scoped>
.ewei-input {
  @apply mt-1.5 w-full px-3 py-1.5 text-xs bg-surface-1 border border-surface-3 rounded-md outline-none focus:ring-2 focus:ring-primary-500;
}
.ewei-chip {
  @apply px-2.5 py-1 rounded-md text-[11px] border border-surface-3 text-text-secondary hover:bg-surface-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed;
}
.ewei-chip-primary {
  @apply px-2.5 py-1 rounded-md text-[11px] border border-primary-500 bg-primary-50 text-primary-700 hover:bg-primary-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed;
}
.ewei-chip-danger {
  @apply px-2.5 py-1 rounded-md text-[11px] border border-surface-3 text-red-600 hover:bg-red-50 transition-colors;
}
</style>
