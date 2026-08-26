<template>
  <div :class="embedded ? 'flex flex-col' : 'h-full flex flex-col bg-surface-1'">
    <!-- 顶部条：全页保留；嵌入设置时用紧凑状态行 -->
    <div
      v-if="!embedded"
      class="flex items-center gap-3 px-5 py-3 border-b border-surface-3 bg-surface-0"
    >
      <div class="flex-1 min-w-0">
        <h2 class="text-sm font-semibold text-text-primary">微信 ClawBot</h2>
        <p class="text-[11px] text-text-tertiary mt-0.5">把微信对话桥接到本地专家：扫码绑定后，微信联系人消息自动进入对话并回复；切页面、关窗口均不中断</p>
      </div>
      <!-- 状态灯 -->
      <div class="flex items-center gap-2 text-xs text-text-secondary">
        <span class="inline-block w-2 h-2 rounded-full" :class="statusDotClass"></span>
        <span>{{ statusText }}</span>
      </div>
      <label v-if="conn?.has_token" class="flex items-center gap-2 text-xs text-text-secondary" :class="canUse ? 'cursor-pointer' : 'opacity-50'">
        <input type="checkbox" class="rounded" :checked="conn?.enabled" :disabled="!canUse" @change="onToggleEnabled" />
        启用
      </label>
    </div>
    <div v-else class="flex items-start justify-between gap-3 mb-4">
      <div class="min-w-0">
        <h2 class="text-sm font-semibold text-text-primary">微信 ClawBot</h2>
        <p class="text-[11px] text-text-tertiary mt-1 leading-relaxed">
          扫码绑定后，微信联系人消息自动进入本地专家并回复；切页面、关窗口均不中断。
        </p>
      </div>
      <div class="flex items-center gap-3 flex-shrink-0 pt-0.5">
        <div class="flex items-center gap-2 text-xs text-text-secondary">
          <span class="inline-block w-2 h-2 rounded-full" :class="statusDotClass"></span>
          <span>{{ statusText }}</span>
        </div>
        <label v-if="conn?.has_token" class="flex items-center gap-2 text-xs text-text-secondary" :class="canUse ? 'cursor-pointer' : 'opacity-50'">
          <input type="checkbox" class="rounded" :checked="conn?.enabled" :disabled="!canUse" @change="onToggleEnabled" />
          启用
        </label>
      </div>
    </div>

    <div :class="embedded ? 'space-y-5' : 'flex-1 overflow-y-auto p-5'">
      <div :class="embedded ? 'space-y-5' : 'max-w-3xl mx-auto space-y-5'">
        <!-- 使用权限提示（显示/使用分离：页面可见但不可用） -->
        <div v-if="!canUse" class="rounded-lg border border-surface-3 bg-surface-0 px-4 py-3 text-[12px] leading-5 text-text-secondary">
          当前账号未开通「微信 ClawBot」使用权限，本页仅可查看。请联系管理员在「用户中心 → 权限管理」中开通后使用。
        </div>

        <!-- 合规提示 -->
        <div class="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] leading-5 text-amber-800">
          微信 ClawBot 处于灰度开放阶段（微信 8.0.70+，我 → 设置 → 插件 → 微信 ClawBot，无入口即未覆盖）。
          请仅用于个人助理场景，勿用于营销/群发；登录态约 24 小时可能失效，失效后需重新扫码。
          电脑关机或退出云控登录时，微信侧将暂停服务。
        </div>

        <!-- 连接状态卡 -->
        <section class="form-card">
          <div class="flex items-center justify-between">
            <h3 class="text-sm font-semibold text-text-primary">连接</h3>
            <div v-if="conn?.has_token" class="flex gap-2">
              <button class="btn-ghost" :disabled="!canUse" @click="startScan">重新扫码</button>
              <button class="btn-danger" :disabled="store.busy || !canUse" @click="onLogout">解除绑定</button>
            </div>
          </div>

          <div v-if="!conn?.has_token" class="text-xs text-text-tertiary">
            尚未绑定微信。点击下方「扫码绑定」，用微信扫描生成的二维码完成绑定。
          </div>
          <div v-else class="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
            <div class="text-text-tertiary">微信 Bot：<span class="text-text-primary">{{ conn.ilink_bot_id || '—' }}</span></div>
            <div class="text-text-tertiary">扫码账号：<span class="text-text-primary">{{ shortId(conn.ilink_user_id) }}</span></div>
            <div class="text-text-tertiary">今日已发：<span class="text-text-primary">{{ state?.todaySent ?? 0 }} / {{ state?.dailyLimit ?? 0 }}</span></div>
            <div class="text-text-tertiary">联系人：<span class="text-text-primary">{{ state?.peerCount ?? 0 }} 个会话映射</span></div>
            <div v-if="conn.status === 'paused' && conn.paused_until" class="col-span-2 text-amber-600">
              登录态失效，已暂停，将于 {{ formatTime(conn.paused_until) }} 自动重试
            </div>
            <div v-if="conn.last_error" class="col-span-2 text-error">最近错误：{{ conn.last_error }}</div>
          </div>
        </section>

        <!-- 扫码登录卡 -->
        <section v-if="loginCardVisible" class="form-card items-start">
          <h3 class="text-sm font-semibold text-text-primary">扫码绑定</h3>
          <div class="flex items-start gap-5 w-full">
            <div class="w-[180px] h-[180px] shrink-0 rounded-lg border border-surface-3 bg-surface-0 flex items-center justify-center overflow-hidden">
              <canvas v-show="qrReady" ref="qrCanvas" class="w-[168px] h-[168px]"></canvas>
              <span v-if="!qrReady" class="text-[11px] text-text-tertiary px-3 text-center">{{ qrPlaceholder }}</span>
            </div>
            <div class="flex-1 min-w-0 space-y-3">
              <p class="text-xs text-text-secondary leading-5">{{ loginMessage }}</p>
              <div v-if="login?.phase === 'need_verifycode'" class="space-y-2">
                <label class="form-label">微信端显示的数字配对码</label>
                <div class="flex gap-2">
                  <input v-model="verifyCode" class="input-field !w-36" maxlength="8" placeholder="如 123456" :disabled="!canUse" @keyup.enter="submitCode" />
                  <button class="btn-primary !py-2 !px-3 text-xs" :disabled="!verifyCode.trim() || !canUse" @click="submitCode">提交</button>
                </div>
              </div>
              <div v-if="login?.phase === 'error'" class="text-xs text-error">{{ login.message }}</div>
              <div class="flex gap-2">
                <button v-if="loginRunning" class="btn-secondary !py-1.5 !px-3 text-xs" @click="cancelScan">取消</button>
                <button v-else class="btn-primary !py-1.5 !px-3 text-xs" :disabled="!canUse" @click="startScan">{{ conn?.has_token ? '重新扫码' : '扫码绑定' }}</button>
              </div>
              <p class="text-[11px] text-text-tertiary leading-4">
                二维码 5 分钟内有效，过期会自动刷新；每次扫码都会换绑新的 Bot 身份，原有联系人会话上下文保留。
              </p>
            </div>
          </div>
        </section>

        <!-- 智能体绑定卡 -->
        <section class="form-card">
          <div class="flex items-center justify-between">
            <h3 class="text-sm font-semibold text-text-primary">绑定专家</h3>
            <!-- 单绑定：已绑定后不显示新建按钮，换绑请用下方下拉 -->
            <button v-if="!conn?.bot_id" class="btn-ghost" :disabled="!canUse" @click="onCreateDefaultBot">新建「微信助手」并绑定</button>
          </div>
          <p class="text-[11px] text-text-tertiary -mt-2">微信联系人的消息将交给该专家处理（含其知识库/技能配置），所有联系人共享同一专家</p>
          <!-- 自定义下拉：原生 select 弹层无可视滚动条，专家多时选不到后面的 -->
          <div class="relative" ref="botPickerRef">
            <button
              type="button"
              class="select-field flex items-center justify-between gap-2 text-left"
              :class="{ 'opacity-50': !canUse }"
              :disabled="!canUse"
              @click="toggleBotPicker"
            >
              <span class="truncate" :class="boundBotName ? 'text-text-primary' : 'text-text-tertiary'">{{ boundBotName || '选择专家…' }}</span>
              <svg class="w-3.5 h-3.5 shrink-0 text-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m19.5 8.25-7.5 7.5-7.5-7.5" /></svg>
            </button>
            <div v-if="showBotPicker" class="absolute top-full left-0 right-0 mt-1 bg-surface-0 border border-surface-3 rounded-xl shadow-modal z-50 py-1 max-h-60 overflow-y-auto">
              <div v-if="botStore.bots.length > 8" class="sticky top-0 bg-surface-0 px-2 pb-1">
                <input ref="botSearchRef" v-model="botSearch" class="input-field !py-1.5 text-xs" placeholder="搜索专家…" @keydown.escape="showBotPicker = false" />
              </div>
              <div v-if="!filteredBots.length" class="px-3 py-2 text-xs text-text-tertiary">{{ botSearch ? '无匹配的专家' : '暂无专家' }}</div>
              <button
                v-for="b in filteredBots"
                :key="b.id"
                type="button"
                :class="['w-full text-left px-3 py-2 text-xs transition-colors', b.id === conn?.bot_id ? 'bg-primary-50 text-primary-700 font-medium' : 'text-text-secondary hover:bg-surface-2']"
                @click="onPickBot(b.id)"
              >{{ b.name }}</button>
            </div>
          </div>
          <p class="text-[11px] text-text-tertiary leading-4">
            建议：若需收发图片，请确认该专家的对话模型支持视觉；AI PPT（deck）类工具对微信场景不适用，建议关闭。
          </p>
        </section>

        <section class="form-card">
          <h3 class="text-sm font-semibold text-text-primary">默认生图参数</h3>
          <p class="text-[11px] text-text-tertiary -mt-2">微信消息未指定完整参数时使用；直接说“横版、来四张”会覆盖这里的默认值。</p>
          <div class="grid grid-cols-2 gap-3">
            <label><span class="form-label">默认尺寸</span><select v-model="imageDefaults.size" class="input-field" :disabled="!canUse"><option value="1:1">1:1 方图</option><option value="16:9">16:9 横版</option><option value="9:16">9:16 竖版</option><option value="4:3">4:3 横图</option><option value="3:4">3:4 竖图</option></select></label>
            <label><span class="form-label">默认张数</span><select v-model.number="imageDefaults.batchCount" class="input-field" :disabled="!canUse"><option v-for="n in 4" :key="n" :value="n">{{ n }} 张</option></select></label>
          </div>
          <button class="btn-primary self-start text-xs" :disabled="!canUse || savingImageDefaults" @click="saveImageDefaults">{{ savingImageDefaults ? '保存中…' : '保存默认参数' }}</button>
        </section>

        <!-- 审批白名单卡 -->
        <section v-if="policy" class="form-card">
          <h3 class="text-sm font-semibold text-text-primary">工具自动审批</h3>
          <p class="text-[11px] text-text-tertiary -mt-2">
            微信触发的对话没有人工审批环节，以下类别的工具调用将被自动批准；其余（含命令执行之外的高危工具未列出的）一律自动拒绝
          </p>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label v-for="item in policyItems" :key="item.key" class="flex items-start gap-2 text-xs text-text-secondary rounded-lg border border-surface-3 px-3 py-2.5" :class="canUse ? 'cursor-pointer hover:bg-surface-2' : 'opacity-50'">
              <input type="checkbox" class="mt-0.5 rounded" :checked="policy[item.key]" :disabled="!canUse" @change="onPolicyChange(item.key, !policy[item.key])" />
              <span>
                <span class="block font-medium text-text-primary">{{ item.label }}</span>
                <span class="block text-[11px] text-text-tertiary mt-0.5">{{ item.desc }}</span>
              </span>
            </label>
          </div>
        </section>

        <!-- 联系人映射 -->
        <section class="form-card">
          <h3 class="text-sm font-semibold text-text-primary">联系人会话</h3>
          <p class="text-[11px] text-text-tertiary -mt-2">每个微信联系人映射一条本地会话，上下文连续；「清空上下文」后下条消息将新建会话</p>
          <div v-if="!peers.length" class="text-xs text-text-tertiary py-2">还没有联系人来过消息</div>
          <div v-else class="divide-y divide-surface-2 -mx-1">
            <div v-for="p in peers" :key="p.id" class="flex items-center gap-3 px-1 py-2.5">
              <div class="flex-1 min-w-0">
                <div class="text-xs font-medium text-text-primary truncate">{{ p.conversation_title || shortId(p.peer_id) }}</div>
                <div class="text-[11px] text-text-tertiary truncate">{{ p.peer_id }}<template v-if="p.last_message_at"> · {{ formatTime(p.last_message_at) }}</template></div>
              </div>
              <button class="btn-ghost" :disabled="!canUse" @click="onResetPeer(p)">清空上下文</button>
            </div>
          </div>
        </section>

        <!-- 消息日志 -->
        <section class="form-card">
          <div class="flex items-center justify-between">
            <h3 class="text-sm font-semibold text-text-primary">消息日志</h3>
            <button class="btn-ghost" @click="store.refreshLogs()">刷新</button>
          </div>
          <div v-if="!logs.length" class="text-xs text-text-tertiary py-2">暂无记录</div>
          <div v-else class="-mx-1">
            <div v-for="log in logs" :key="log.id" class="flex items-start gap-2.5 px-1 py-2 border-b border-surface-2 last:border-0">
              <span
                class="mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-medium shrink-0"
                :class="log.direction === 'in' ? 'bg-primary-50 text-primary-700' : 'bg-green-50 text-green-700'"
              >{{ log.direction === 'in' ? '收' : '发' }}</span>
              <div class="flex-1 min-w-0">
                <div class="text-xs text-text-primary break-all">{{ log.summary || '—' }}</div>
                <div class="text-[11px] text-text-tertiary mt-0.5">
                  {{ log.msg_type }} · {{ shortId(log.peer_id) }} · {{ formatTime(log.created_at) }}
                  <span v-if="log.status === 'error'" class="text-error"> · 失败{{ log.error ? '：' + log.error : '' }}</span>
                  <span v-else-if="log.status === 'dropped'" class="text-amber-600"> · 已丢弃</span>
                </div>
              </div>
            </div>
            <div class="pt-2 text-center">
              <button v-if="!store.logsExhausted" class="btn-ghost" @click="store.loadMoreLogs()">加载更多</button>
              <span v-else class="text-[11px] text-text-tertiary">仅保留最近 7 天记录</span>
            </div>
          </div>
        </section>
      </div>
    </div>

    <!-- 轻提示（设置模态 z-[100]，需更高） -->
    <div v-if="toast" class="fixed bottom-6 left-1/2 -translate-x-1/2 z-[110] rounded-lg bg-gray-900/90 text-white text-xs px-4 py-2 shadow-lg">{{ toast }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import QRCode from 'qrcode'
import { useClawbotStore } from '@/stores/clawbot'
import { useBotStore } from '@/stores/bots'
import { useCloudAuthStore } from '@/stores/cloud-auth'
import { storeToRefs } from 'pinia'
import type { ClawbotApprovalPolicy, ClawbotPeerSummary } from '@/stores/clawbot'

withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

const store = useClawbotStore()
const botStore = useBotStore()
const cloudAuth = useCloudAuthStore()
const { state, peers, logs, policy } = storeToRefs(store)
const imageDefaults = ref({ size: '1:1', batchCount: 1 })
const savingImageDefaults = ref(false)

async function loadImageDefaults(): Promise<void> {
  imageDefaults.value = await window.api.clawbot.invoke('getImageDefaults') as typeof imageDefaults.value
}

async function saveImageDefaults(): Promise<void> {
  savingImageDefaults.value = true
  try {
    imageDefaults.value = await window.api.clawbot.invoke('setImageDefaults', { ...imageDefaults.value }) as typeof imageDefaults.value
    showToast('默认生图参数已保存')
  } finally { savingImageDefaults.value = false }
}

// 使用权限（allow_clawbot，默认拒绝）：仅控制「能否使用」，菜单显示由云控端菜单配置管理
const canUse = computed(() => cloudAuth.permissions.allow_clawbot === true)

const conn = computed(() => state.value?.connection ?? null)
const login = computed(() => state.value?.login ?? null)

// ===== 顶部状态 =====

const statusText = computed(() => {
  if (!conn.value?.has_token) return '未绑定'
  if (!conn.value.enabled) return '已停用'
  switch (conn.value.status) {
    case 'online': return state.value?.running ? '在线' : '在线（待启动）'
    case 'connecting': return '连接中'
    case 'paused': return '已暂停'
    case 'expired': return '已掉线'
    default: return state.value?.running ? '在线' : '未连接'
  }
})

const statusDotClass = computed(() => {
  if (!conn.value?.has_token || !conn.value.enabled) return 'bg-gray-300'
  switch (conn.value.status) {
    case 'online': return 'bg-green-500'
    case 'connecting': return 'bg-amber-400 animate-pulse'
    case 'paused': return 'bg-amber-500'
    case 'expired': return 'bg-red-500'
    default: return 'bg-gray-300'
  }
})

// ===== 扫码登录 =====

const qrCanvas = ref<HTMLCanvasElement | null>(null)
const verifyCode = ref('')
const loginRunning = computed(() => ['qr_ready', 'scaned', 'need_verifycode'].includes(login.value?.phase || ''))
const qrReady = computed(() => loginRunning.value && !!login.value?.qrcodeUrl)
const qrPlaceholder = computed(() => (loginRunning.value ? '二维码生成中…' : '点击「扫码绑定」生成二维码'))

// 无凭据、登录进行中或登录出错时展示登录卡；confirmed 短暂展示后收起
const loginCardVisible = ref(false)
// 「本次会话见过活跃登录流程」标记：仅此时才在 confirmed 时弹 toast，
// 避免 confirmed 终态驻留主进程导致每次进页面重播「绑定成功」
const sawActiveLogin = ref(false)
watch(
  () => [conn.value?.has_token, login.value?.phase],
  () => {
    if (loginRunning.value) sawActiveLogin.value = true
    if (!conn.value?.has_token) loginCardVisible.value = true
    if (loginRunning.value || login.value?.phase === 'error') loginCardVisible.value = true
    if (login.value?.phase === 'idle' && conn.value?.has_token) loginCardVisible.value = false
    if (login.value?.phase === 'confirmed' && sawActiveLogin.value) {
      sawActiveLogin.value = false
      showToast('绑定成功')
      setTimeout(() => { loginCardVisible.value = false }, 1500)
      void store.refreshAll()
    }
  },
  { immediate: true }
)

const loginMessage = computed(() => {
  switch (login.value?.phase) {
    case 'qr_ready': return login.value.message || '请用微信扫码'
    case 'scaned': return '已扫码，请在微信中确认登录'
    case 'need_verifycode': return '该账号开启了登录保护，请输入微信中显示的数字配对码'
    case 'confirmed': return '绑定成功，正在启动消息服务…'
    case 'error': return '登录失败，请重试'
    default: return conn.value?.has_token ? '如需更换绑定的微信，请重新扫码' : '尚未绑定微信'
  }
})

async function renderQr(url?: string): Promise<void> {
  const target = url || login.value?.qrcodeUrl
  if (!target) return
  await nextTick()
  if (!qrCanvas.value) return
  try {
    await QRCode.toCanvas(qrCanvas.value, target, { width: 168, margin: 1, errorCorrectionLevel: 'M' })
  } catch (e) {
    console.error('[clawbot] render qrcode failed:', e)
  }
}

watch(
  () => login.value?.qrcodeUrl,
  (url) => {
    if (url) void renderQr(url)
  }
)

async function startScan(): Promise<void> {
  if (!canUse.value) return
  loginCardVisible.value = true
  sawActiveLogin.value = true
  await store.startLogin()
}

async function cancelScan(): Promise<void> {
  await store.cancelLogin()
}

async function submitCode(): Promise<void> {
  if (!canUse.value) return
  const code = verifyCode.value.trim()
  if (!code) return
  await store.submitVerifyCode(code)
  verifyCode.value = ''
}

async function onLogout(): Promise<void> {
  if (!canUse.value) return
  await store.logout()
  showToast('已解除绑定')
}

// ===== 绑定智能体 =====

// 自定义下拉状态（原生 select 弹层在 Windows 上无滚动条，列表长时后面的智能体选不到）
const showBotPicker = ref(false)
const botSearch = ref('')
const botPickerRef = ref<HTMLElement | null>(null)
const botSearchRef = ref<HTMLInputElement | null>(null)

const boundBotName = computed(() => botStore.bots.find((b) => b.id === conn.value?.bot_id)?.name || '')

const filteredBots = computed(() => {
  const kw = botSearch.value.trim().toLowerCase()
  if (!kw) return botStore.bots
  return botStore.bots.filter((b) => b.name.toLowerCase().includes(kw))
})

function toggleBotPicker(): void {
  showBotPicker.value = !showBotPicker.value
  if (showBotPicker.value) {
    botSearch.value = ''
    void nextTick(() => botSearchRef.value?.focus())
  }
}

function onBotPickerClickOutside(e: MouseEvent): void {
  if (botPickerRef.value && !botPickerRef.value.contains(e.target as Node)) {
    showBotPicker.value = false
  }
}

async function onPickBot(botId: string): Promise<void> {
  if (!canUse.value) return
  showBotPicker.value = false
  if (!botId || botId === conn.value?.bot_id) return
  try {
    await store.bindBot(botId)
    showToast('已绑定')
  } catch (err: any) {
    showToast('绑定失败：' + (err?.message || err))
  }
}

async function onCreateDefaultBot(): Promise<void> {
  if (!canUse.value) return
  try {
    const result = await store.createDefaultBot()
    await botStore.fetchBots()
    showToast(result.created ? '已创建并绑定「微信助手」' : '已绑定已有「微信助手」')
  } catch (err: any) {
    showToast('创建失败：' + (err?.message || err))
  }
}

// ===== 开关 =====

async function onToggleEnabled(e: Event): Promise<void> {
  if (!canUse.value) return
  await store.setEnabled((e.target as HTMLInputElement).checked)
}

// ===== 审批白名单 =====

const policyItems: Array<{ key: keyof ClawbotApprovalPolicy; label: string; desc: string }> = [
  { key: 'allowWorkspaceRead', label: '读工作区文件', desc: '读取本会话工作区内的文件' },
  { key: 'allowWorkspaceWrite', label: '写工作区文件', desc: '在工作区内新建/修改/删除文件（生成类任务需要）' },
  { key: 'allowBuiltinUtils', label: '内置小工具', desc: '时间、计算器、网页抓取、JSON/文本处理' },
  { key: 'allowOutsideRead', label: '读工作区外文件', desc: '读取电脑上其他位置的文件（谨慎开启）' },
  { key: 'allowMcp', label: 'MCP 工具', desc: '非只读的 MCP 工具调用（谨慎开启）' },
  { key: 'allowRunCommand', label: '执行命令', desc: 'run_command（高风险，默认拒绝）' }
]

async function onPolicyChange(key: keyof ClawbotApprovalPolicy, value: boolean): Promise<void> {
  if (!canUse.value) return
  await store.setApprovalPolicy({ [key]: value })
}

// ===== 联系人映射 =====

async function onResetPeer(p: ClawbotPeerSummary): Promise<void> {
  if (!canUse.value) return
  await store.resetPeerConversation(p.id)
  showToast('已清空，下条消息将新建会话')
}

// ===== 工具 =====

function shortId(id: string): string {
  if (!id) return '—'
  return id.replace(/@im\.(wechat|bot)$/, '')
}

function formatTime(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  if (sameDay) return `${hh}:${mm}`
  return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')} ${hh}:${mm}`
}

const toast = ref('')
let toastTimer: ReturnType<typeof setTimeout> | undefined
function showToast(text: string): void {
  toast.value = text
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    if (toast.value === text) toast.value = ''
  }, 2400)
}

onMounted(async () => {
  store.initClawbotListeners()
  document.addEventListener('click', onBotPickerClickOutside)
  // 登录进行中离开再回来：canvas 是新元素，需用当前 qrcodeUrl 重绘一次
  if (loginRunning.value && login.value?.qrcodeUrl) void renderQr()
  await Promise.all([store.refreshAll(), botStore.bots.length ? Promise.resolve() : botStore.fetchBots(), loadImageDefaults()])
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onBotPickerClickOutside)
})
</script>
