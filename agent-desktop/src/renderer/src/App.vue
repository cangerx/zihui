<template>
  <!-- First Launch Setup -->
  <div v-if="showSetup" class="fixed inset-0 z-[9999] flex items-center justify-center bg-surface-1">
    <div class="w-full max-w-lg bg-surface-0 rounded-2xl shadow-2xl p-8">
      <div class="flex items-center gap-3 mb-6">
        <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center">
          <span class="text-white text-lg font-bold">{{ appAbbr.charAt(0) }}</span>
        </div>
        <div>
          <h1 class="text-lg font-bold text-text-primary">{{ appName }}</h1>
          <p class="text-xs text-text-tertiary">首次启动配置</p>
        </div>
      </div>

      <div class="mb-6">
        <label class="block text-sm font-medium text-text-primary mb-2">数据存储目录</label>
        <p class="text-xs text-text-tertiary mb-3">
          数据库、技能、工作区等数据将存放在此目录中。会自动在你选择的位置下创建 <span class="font-mono text-text-secondary">local-agent</span> 子目录。
        </p>
        <div class="flex items-center gap-2">
          <input :value="setupDir" readonly class="flex-1 px-3 py-2.5 text-sm bg-surface-2 border border-surface-3 rounded-lg text-text-primary cursor-default" />
          <button @click="pickSetupDir" class="px-4 py-2.5 text-sm font-medium bg-surface-2 hover:bg-surface-3 border border-surface-3 rounded-lg text-text-secondary transition-colors whitespace-nowrap">
            更改
          </button>
        </div>
        <p class="text-[11px] text-text-tertiary mt-2">
          请勿选择应用安装目录（如 <span class="font-mono">Program Files</span>）或系统目录，否则升级/卸载时数据会被清空。
        </p>
        <div v-if="setupError" class="flex items-start gap-2 mt-3 p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-600 font-medium dark:bg-red-900/20 dark:border-red-800 dark:text-red-300">
          <svg class="w-3.5 h-3.5 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" /></svg>
          <span class="break-all">{{ setupError }}</span>
        </div>
      </div>

      <button @click="confirmSetup" :disabled="setupConfirming" class="w-full py-3 text-sm font-semibold bg-primary-600 hover:bg-primary-700 text-white rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
        {{ setupConfirming ? '正在应用...' : '确认并开始使用' }}
      </button>
    </div>
  </div>

  <!-- Migration Dialog -->
  <div v-if="showMigration" class="fixed inset-0 z-[9998] flex items-center justify-center">
    <div class="w-full max-w-lg bg-surface-0 rounded-2xl shadow-2xl p-8">
      <h2 class="text-base font-bold text-text-primary mb-1">数据迁移</h2>

      <!-- Ask to migrate -->
      <template v-if="migrationStep === 'ask'">
        <p class="text-sm text-text-secondary mb-4">检测到旧数据目录中有 {{ migrationInfo.fileCount }} 个文件，是否迁移到新目录?</p>
        <div class="text-xs text-text-tertiary space-y-1 mb-3 p-3 bg-surface-2 rounded-lg">
          <div class="flex gap-2"><span class="text-text-secondary font-medium w-10 shrink-0">旧:</span><span class="break-all">{{ migrationInfo.oldDir }}</span></div>
          <div class="flex gap-2"><span class="text-text-secondary font-medium w-10 shrink-0">新:</span><span class="break-all">{{ migrationInfo.newDir }}</span></div>
        </div>

        <!-- Too many files warning -->
        <div v-if="migrationInfo.tooMany" class="mb-3 p-3 rounded-lg bg-amber-50 border border-amber-200 dark:bg-amber-900/20 dark:border-amber-800">
          <p class="text-xs text-amber-700 dark:text-amber-300">
            文件数量较多（{{ migrationInfo.fileCount }}），迁移可能较慢。请确认旧目录路径正确无误。
          </p>
        </div>

        <!-- Conflicts warning -->
        <div v-if="migrationInfo.conflictCount > 0" class="mb-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-700 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-300">
          <p class="font-medium mb-1">新目录中已有 {{ migrationInfo.conflictCount }} 个同名文件，请选择处理方式：</p>
          <label class="flex items-start gap-2 mt-2 cursor-pointer">
            <input type="radio" v-model="conflictStrategy" value="keep-existing" class="mt-0.5" />
            <span>保留新目录已有的文件（推荐）</span>
          </label>
          <label class="flex items-start gap-2 mt-1 cursor-pointer">
            <input type="radio" v-model="conflictStrategy" value="overwrite" class="mt-0.5" />
            <span>用旧目录的文件覆盖（谨慎）</span>
          </label>
        </div>

        <div class="flex gap-3 mt-4">
          <button @click="startMigration" class="flex-1 py-2.5 text-sm font-semibold bg-primary-600 hover:bg-primary-700 text-white rounded-xl transition-colors">迁移数据</button>
          <button @click="skipMigrationOnce" class="px-4 py-2.5 text-sm font-medium border border-surface-3 rounded-xl text-text-secondary hover:bg-surface-2 transition-colors" title="本次不迁移，下次启动仍会提示">下次再说</button>
        </div>
        <button @click="confirmAbandon" class="w-full mt-2 py-2 text-xs text-text-tertiary hover:text-red-600 transition-colors">永久放弃旧数据</button>
      </template>

      <!-- Confirm abandon -->
      <template v-if="migrationStep === 'confirmAbandon'">
        <p class="text-sm text-red-600 font-medium mb-3">确认永久放弃旧数据？</p>
        <p class="text-xs text-text-secondary mb-4">
          此操作仅删除旧数据目录的位置记录，磁盘上的文件不会被删除（你可以稍后手动处理）。<br>
          下次启动时将不再提示迁移。
        </p>
        <div class="text-xs text-text-tertiary mb-5 p-3 bg-surface-2 rounded-lg break-all">{{ migrationInfo.oldDir }}</div>
        <div class="flex gap-3">
          <button @click="abandonOldData" class="flex-1 py-2.5 text-sm font-semibold bg-red-600 hover:bg-red-700 text-white rounded-xl transition-colors">确认放弃</button>
          <button @click="migrationStep = 'ask'" class="px-6 py-2.5 text-sm font-medium border border-surface-3 rounded-xl text-text-secondary hover:bg-surface-2 transition-colors">返回</button>
        </div>
      </template>

      <!-- Migrating -->
      <template v-if="migrationStep === 'migrating'">
        <p class="text-sm text-text-secondary mb-4">正在迁移数据，请勿关闭软件...</p>
        <div class="mb-3">
          <div class="w-full h-2 bg-surface-2 rounded-full overflow-hidden">
            <div class="h-full bg-primary-600 rounded-full transition-all duration-150" :style="{ width: progressPercent + '%' }"></div>
          </div>
        </div>
        <div class="flex justify-between text-xs text-text-tertiary">
          <span>{{ migrationProgress.current }} / {{ migrationProgress.total }}</span>
          <span class="truncate ml-4 max-w-[60%] text-right">{{ migrationProgress.fileName }}</span>
        </div>
      </template>

      <!-- Done -->
      <template v-if="migrationStep === 'done'">
        <p class="text-sm text-emerald-600 font-medium mb-2">数据迁移完成</p>
        <p class="text-xs text-text-secondary mb-3">
          复制 {{ migrationResult.copied }} 个文件<span v-if="migrationResult.skipped > 0">，跳过 {{ migrationResult.skipped }} 个已存在</span>。
          应用必须重启以使新数据目录生效。
        </p>
        <label class="flex items-center gap-2 mb-4 cursor-pointer">
          <input type="checkbox" v-model="deleteOldAfterRestart" class="w-3.5 h-3.5" />
          <span class="text-xs text-text-secondary">同时删除旧目录中的数据</span>
        </label>
        <div class="text-xs text-text-tertiary mb-5 p-3 bg-surface-2 rounded-lg break-all">{{ migrationInfo.oldDir }}</div>
        <button @click="finishMigration" :disabled="finishing" class="w-full py-2.5 text-sm font-semibold bg-primary-600 hover:bg-primary-700 text-white rounded-xl transition-colors disabled:opacity-50">
          {{ finishing ? '处理中...' : '立即重启' }}
        </button>
      </template>

      <!-- Error -->
      <template v-if="migrationStep === 'error'">
        <p class="text-sm text-red-500 mb-2">迁移失败: {{ migrationError }}</p>
        <p class="text-xs text-text-secondary mb-4">数据库已被关闭以避免冲突，应用需要重启恢复正常。</p>
        <button @click="restartAfterError" class="w-full py-2.5 text-sm font-semibold bg-primary-600 hover:bg-primary-700 text-white rounded-xl transition-colors">立即重启</button>
      </template>
    </div>
  </div>

  <!-- Setup Relaunch Confirmation -->
  <div v-if="showSetupRelaunch" class="fixed inset-0 z-[9999] flex items-center justify-center">
    <div class="w-full max-w-md bg-surface-0 rounded-2xl shadow-2xl p-6">
      <h2 class="text-base font-bold text-text-primary mb-2">需要重启应用</h2>
      <p class="text-sm text-text-secondary mb-5">数据目录配置已保存，应用需要重启以加载新位置的数据。</p>
      <button @click="relaunchApp" class="w-full py-2.5 text-sm font-semibold bg-primary-600 hover:bg-primary-700 text-white rounded-xl transition-colors">
        立即重启
      </button>
    </div>
  </div>

  <!-- Update Notification -->
  <div v-if="updateState !== 'idle'" class="fixed bottom-5 right-5 z-[9000] w-80 bg-surface-0 border border-surface-3 rounded-xl shadow-lg overflow-hidden">
    <!-- Header -->
    <div class="flex items-center justify-between px-4 py-3 border-b border-surface-2">
      <span class="text-xs font-semibold text-text-primary">软件更新</span>
      <button v-if="updateState !== 'downloading'" @click="dismissUpdate" class="text-text-tertiary hover:text-text-primary">
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
      </button>
    </div>
    <div class="px-4 py-3">
      <!-- Available -->
      <template v-if="updateState === 'available'">
        <p class="text-xs text-text-secondary mb-2">发现新版本 <span class="font-semibold text-primary-600">v{{ updateVersion }}</span></p>
        <ul v-if="updateNotes.length" class="mb-3 max-h-32 overflow-y-auto space-y-1 pr-1">
          <li v-for="(note, idx) in updateNotes" :key="idx" class="text-[11px] text-text-tertiary leading-relaxed flex gap-1.5">
            <span class="text-text-disabled select-none flex-shrink-0">·</span>
            <span>{{ note }}</span>
          </li>
        </ul>
        <div class="flex gap-2">
          <button @click="startDownload" class="flex-1 py-2 text-xs font-medium bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors">立即更新</button>
          <button @click="dismissUpdate" class="px-3 py-2 text-xs text-text-tertiary hover:text-text-secondary border border-surface-3 rounded-lg transition-colors">稍后</button>
        </div>
      </template>
      <!-- Downloading -->
      <template v-if="updateState === 'downloading'">
        <p class="text-xs text-text-secondary mb-2">正在下载更新...</p>
        <div class="w-full h-1.5 bg-surface-2 rounded-full overflow-hidden mb-1">
          <div class="h-full bg-primary-600 rounded-full transition-all duration-300" :style="{ width: downloadPercent + '%' }"></div>
        </div>
        <p class="text-[10px] text-text-tertiary text-right">{{ downloadPercent }}%</p>
      </template>
      <!-- Downloaded -->
      <template v-if="updateState === 'downloaded'">
        <p v-if="manualInstallMode" class="text-xs text-text-secondary mb-3">
          更新已下载，请在 Finder 中把新版本 App 拖到「应用程序」文件夹覆盖旧版后重新打开。
        </p>
        <p v-else class="text-xs text-text-secondary mb-3">更新已下载完成，重启后生效</p>
        <div class="flex gap-2">
          <button @click="installUpdate" class="flex-1 py-2 text-xs font-medium bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors">
            {{ manualInstallMode ? '打开下载目录' : '立即重启' }}
          </button>
          <button @click="dismissUpdate" class="px-3 py-2 text-xs text-text-tertiary hover:text-text-secondary border border-surface-3 rounded-lg transition-colors">稍后</button>
        </div>
      </template>
      <!-- Error -->
      <template v-if="updateState === 'error'">
        <p class="text-xs text-red-500 mb-2">更新失败: {{ updateError }}</p>
        <button @click="dismissUpdate" class="w-full py-2 text-xs text-text-tertiary border border-surface-3 rounded-lg hover:bg-surface-2 transition-colors">关闭</button>
      </template>
    </div>
  </div>

  <router-view v-if="!showSetup" />
  <!-- top-12 让出 Windows titleBarOverlay（36px 高的最小/最大/关闭按钮）所在区域，避免浮窗与窗口控制按钮重叠 -->
  <ChatImageGenProgress v-if="!showSetup" class="fixed top-12 right-4 z-[8500]" />

  <!-- Register bonus toast (non-blocking) -->
  <RegisterBonusToast />
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import RegisterBonusToast from '@/components/RegisterBonusToast.vue'
import ChatImageGenProgress from '@/components/ChatImageGenProgress.vue'
import { appName, appAbbr } from '@/utils/branding'
import { getReleaseNotes, parseUpstreamReleaseNotes } from '@shared/changelog'

const api = () => (window as any).api

const showSetup = ref(false)
const setupDir = ref('')
const setupConfirming = ref(false)
const setupError = ref('')
const showSetupRelaunch = ref(false)

const showMigration = ref(false)
const migrationStep = ref<'ask' | 'confirmAbandon' | 'migrating' | 'done' | 'error'>('ask')
const migrationInfo = ref<{
  oldDir: string
  newDir: string
  fileCount: number
  tooMany: boolean
  conflicts: string[]
  conflictCount: number
}>({ oldDir: '', newDir: '', fileCount: 0, tooMany: false, conflicts: [], conflictCount: 0 })
const migrationProgress = ref({ current: 0, total: 0, fileName: '' })
const migrationResult = ref({ copied: 0, skipped: 0 })
const migrationError = ref('')
const conflictStrategy = ref<'keep-existing' | 'overwrite'>('keep-existing')
const deleteOldAfterRestart = ref(false)
const finishing = ref(false)

const progressPercent = computed(() => {
  if (!migrationProgress.value.total) return 0
  return Math.round((migrationProgress.value.current / migrationProgress.value.total) * 100)
})

// === Auto Update ===
const updateState = ref<'idle' | 'available' | 'downloading' | 'downloaded' | 'error'>('idle')
const updateVersion = ref('')
const updateNotes = ref<string[]>([])
const downloadPercent = ref(0)
const updateError = ref('')
// mac 未签名场景下主进程把 install 行为切成「打开下载目录」，UI 据此切换按钮文案
const manualInstallMode = ref(false)

function setupUpdaterListeners(): void {
  const u = window.api?.updater
  if (!u) return
  u.onAvailable((data) => {
    updateVersion.value = data.version
    // 优先使用上游 release notes，缺失时回退本地 changelog
    const upstream = parseUpstreamReleaseNotes((data as any).releaseNotes)
    updateNotes.value = upstream.length > 0 ? upstream : (getReleaseNotes(data.version) || [])
    updateState.value = 'available'
  })
  u.onProgress((data) => {
    downloadPercent.value = data.percent
    updateState.value = 'downloading'
  })
  u.onDownloaded((data) => {
    // mac 未签名兜底：主进程把 install 改成 shell.showItemInFolder，UI 上要把
    // 「立即重启」换成「打开下载目录」并给提示，让用户手动覆盖 .app。
    manualInstallMode.value = !!data?.manualInstall
    updateState.value = 'downloaded'
  })
  u.onError((msg) => {
    updateError.value = msg
    updateState.value = 'error'
  })
}

function startDownload(): void {
  updateState.value = 'downloading'
  downloadPercent.value = 0
  window.api?.updater?.download()
}

function installUpdate(): void {
  window.api?.updater?.install()
}

function dismissUpdate(): void {
  updateState.value = 'idle'
}

onMounted(async () => {
  setupUpdaterListeners()
  const first = await api().dataDir.isFirstLaunch()
  if (first) {
    setupDir.value = await api().dataDir.get()
    showSetup.value = true
    return
  }

  const check = await api().migration.check()
  if (check.needed) {
    migrationInfo.value = check
    showMigration.value = true
  }
})

// 用 path.join 风格统一分隔符。Windows / Unix 都接受正斜杠输入；
// 但展示给用户时仍按平台习惯（这里只在主进程做最终规范化，renderer 拼接
// 用平台原生分隔符，避免出现 D:\foo/local-agent 这种混合形态）。
function joinPath(base: string, child: string): string {
  const sep = base.includes('\\') ? '\\' : '/'
  const trimmed = base.replace(/[\\/]+$/, '')
  return trimmed + sep + child
}

function endsWithSegment(path: string, segment: string): boolean {
  return path.endsWith('\\' + segment) || path.endsWith('/' + segment)
}

async function pickSetupDir() {
  const picked = await api().dataDir.pick()
  if (!picked) return
  setupDir.value = endsWithSegment(picked, 'local-agent') ? picked : joinPath(picked, 'local-agent')
  // 重新选择路径时清空旧错误，避免误导
  setupError.value = ''
}

async function confirmSetup() {
  if (setupConfirming.value) return
  setupConfirming.value = true
  setupError.value = ''
  try {
    // 主进程会先校验路径合法性（拒绝安装目录/系统目录/磁盘根），
    // 失败时返回 { ok: false, reason } 给 UI 展示，并保持 setup 界面不关闭。
    const result = await api().dataDir.init(setupDir.value) as
      | { ok: false; reason: string }
      | { ok: true; needsRelaunch: boolean }
    if (!result?.ok) {
      setupError.value = result?.reason || '设置数据目录失败'
      return
    }
    showSetup.value = false
    // 用户选了与默认不同的目录 → 当前进程的 db 仍连旧目录，必须重启避免数据切割
    if (result.needsRelaunch) {
      showSetupRelaunch.value = true
    }
  } finally {
    setupConfirming.value = false
  }
}

async function startMigration() {
  migrationStep.value = 'migrating'
  api().migration.onProgress((data: { current: number; total: number; fileName: string }) => {
    migrationProgress.value = data
  })
  try {
    const result = await api().migration.start({ conflictStrategy: conflictStrategy.value }) as {
      success: boolean
      error?: string
      copied: number
      skipped: number
    }
    if (result.success) {
      migrationResult.value = { copied: result.copied || 0, skipped: result.skipped || 0 }
      migrationStep.value = 'done'
    } else {
      migrationError.value = result.error || 'Unknown error'
      migrationStep.value = 'error'
    }
  } catch (e: any) {
    migrationError.value = e?.message || String(e)
    migrationStep.value = 'error'
  } finally {
    api().migration.offProgress()
  }
}

async function skipMigrationOnce() {
  // 仅本次跳过，保留 oldDataDir 记录，下次启动仍提示
  await api().migration.skip()
  showMigration.value = false
}

function confirmAbandon() {
  migrationStep.value = 'confirmAbandon'
}

async function abandonOldData() {
  await api().migration.abandon()
  showMigration.value = false
}

async function finishMigration() {
  if (finishing.value) return
  finishing.value = true
  try {
    if (deleteOldAfterRestart.value) {
      await api().migration.deleteOld()
    }
    await api().app.relaunch()
  } finally {
    finishing.value = false
  }
}

async function restartAfterError() {
  await api().app.relaunch()
}

async function relaunchApp() {
  await api().app.relaunch()
}

onUnmounted(() => {
  api().migration.offProgress()
  window.api?.updater?.offAll()
})
</script>
