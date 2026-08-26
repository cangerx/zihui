<template>
  <div class="h-full flex flex-col">
    <header class="page-header">
      <div>
        <p class="text-xs text-text-tertiary">参考结构生成新片，不是搬运原片。先拆镜头，再按镜或整段重生。</p>
      </div>
      <div class="flex items-center gap-2">
        <button class="btn-secondary text-xs" @click="openProject">打开工程</button>
        <button class="btn-secondary text-xs" :disabled="!project.shots.length" @click="saveProject">保存工程</button>
      </div>
    </header>

    <div class="page-body overflow-y-auto space-y-5">
      <div class="grid grid-cols-1 xl:grid-cols-[360px_minmax(0,1fr)] gap-5">
        <section class="card p-5 space-y-4">
          <div>
            <h3 class="text-sm font-semibold text-text-primary">入库</h3>
            <p class="text-xs text-text-tertiary mt-1">本地上传，或粘贴 TikTok / 抖音公开链接作结构参考。不是无水印搬运。</p>
          </div>

          <button class="btn-secondary w-full text-xs" :disabled="busy" @click="pickVideo">选择本地视频</button>
          <div class="flex gap-2">
            <input v-model="sourceUrl" class="input-field flex-1" placeholder="粘贴 TikTok / 抖音链接" :disabled="busy" @keydown.enter.prevent="importUrl">
            <button class="btn-secondary text-xs shrink-0" :disabled="busy || !sourceUrl.trim() || !ytDlpReady" @click="importUrl">{{ importingUrl ? '拉取中…' : '从链接入库' }}</button>
          </div>
          <p class="text-[10px] text-text-tertiary">公开页可拉则入库；链接入库需要本机 yt-dlp（macOS：brew install yt-dlp）。风控或需登录时请本地下载后上传。不读取 Cookie，也不承诺去水印。</p>
          <div v-if="!ytDlpReady" class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:border-amber-700/40 dark:text-amber-300 space-y-2">
            <p>{{ ytDlpReason || '链接入库需要 yt-dlp。' }}</p>
            <p class="font-mono text-[11px] break-all">{{ ytDlpInstallHint }}</p>
            <p class="text-[10px] opacity-80">装完后请完全退出应用（菜单栏退出或 Cmd+Q），再打开后点「重新检测」。也可改用「选择本地视频」。</p>
            <div class="flex gap-2">
              <button class="btn-secondary text-xs" type="button" @click="copyYtDlpHint">{{ ytDlpCopied ? '已复制' : '复制安装命令' }}</button>
              <button class="btn-secondary text-xs" type="button" @click="refreshYtDlp">重新检测</button>
            </div>
          </div>
          <p v-if="project.source.path" class="text-xs text-text-secondary break-all">{{ project.source.name || project.source.path }}</p>
          <p v-if="project.source.duration" class="text-[11px] text-text-tertiary">
            {{ formatTimecode(0) }} – {{ formatTimecode(project.source.duration) }}
            · {{ project.source.width }}×{{ project.source.height }}
          </p>

          <div>
            <label class="form-label">视觉模型</label>
            <select v-model="visionProviderId" class="input-field mt-1.5 mb-2" @change="visionModelId = ''">
              <option value="">选择服务商</option>
              <option v-for="p in modelStore.providers" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
            <select v-model="visionModelId" class="input-field" :disabled="!visionProviderId">
              <option value="">选择模型</option>
              <optgroup v-if="visionGroups.recommended.length" label="推荐">
                <option v-for="m in visionGroups.recommended" :key="m" :value="m">{{ modelStore.optionLabel(visionProviderId, m) }}</option>
              </optgroup>
              <optgroup v-if="visionGroups.others.length" label="其他">
                <option v-for="m in visionGroups.others" :key="m" :value="m">{{ modelStore.optionLabel(visionProviderId, m) }}</option>
              </optgroup>
            </select>
            <input
              v-if="visionProviderId && !visionModels.length"
              v-model="visionModelId"
              class="input-field mt-2"
              placeholder="输入视觉模型名称"
            />
          </div>

          <div>
            <label class="form-label">口播识别（可选）</label>
            <select v-model="asrProviderId" class="input-field mt-1.5 mb-2" @change="asrModelId = ''">
              <option value="">跳过，稍后手改</option>
              <option v-for="p in localProviders" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
            <select v-if="asrProviderId" v-model="asrModelId" class="input-field" :disabled="!asrProviderId">
              <option value="">选择 Whisper / ASR 模型</option>
              <optgroup v-if="asrGroups.recommended.length" label="推荐">
                <option v-for="m in asrGroups.recommended" :key="m" :value="m">{{ modelStore.optionLabel(asrProviderId, m) }}</option>
              </optgroup>
              <optgroup v-if="asrGroups.others.length" label="其他">
                <option v-for="m in asrGroups.others" :key="m" :value="m">{{ modelStore.optionLabel(asrProviderId, m) }}</option>
              </optgroup>
            </select>
            <input
              v-if="asrProviderId && !asrModels.length"
              v-model="asrModelId"
              class="input-field mt-2"
              placeholder="输入 whisper 模型名"
            />
            <p class="text-[10px] text-text-tertiary mt-1.5">走本地自定义服务商的 OpenAI 兼容 `/audio/transcriptions`。云端 ASR 尚未接通。</p>
          </div>

          <div v-if="!ffmpegReady" class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:border-amber-700/40 dark:text-amber-300 space-y-2">
            <p>{{ ffmpegReason || '需要 ffmpeg 才能抽帧和抽音频。' }}</p>
            <p class="text-[10px] opacity-80">不必去云控上传。请先完全退出应用（菜单栏退出或 Cmd+Q，不是只关窗口），再打开后点「安装 ffmpeg」；也可本机执行 brew install ffmpeg，再点「重新检测」。</p>
            <div class="flex gap-2">
              <button class="btn-secondary text-xs" :disabled="installingFfmpeg" @click="installFfmpeg">{{ installingFfmpeg ? '正在安装…' : '安装 ffmpeg' }}</button>
              <button class="btn-secondary text-xs" :disabled="installingFfmpeg" @click="refreshFfmpeg">重新检测</button>
            </div>
          </div>

          <button
            class="btn-primary w-full text-sm"
            :disabled="!canAnalyze"
            @click="analyze"
          >{{ busy ? stageText : '开始拆解' }}</button>
          <p class="text-[11px] text-text-tertiary">拆解只调用视觉模型和可选语音识别，不会提交 AI 视频任务。</p>

          <div v-if="error" class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-900/20 dark:border-red-800 dark:text-red-300">{{ error }}</div>
          <div v-if="notice" class="rounded-lg border border-surface-3 bg-surface-1 px-3 py-2 text-xs text-text-secondary">{{ notice }}</div>
        </section>

        <section class="space-y-5 min-w-0">
          <div class="card overflow-hidden">
            <div class="aspect-video bg-black flex items-center justify-center">
              <video
                v-if="previewSrc"
                ref="player"
                :src="previewSrc"
                controls
                class="w-full h-full object-contain"
              ></video>
              <p v-else class="text-xs text-white/70 px-6 text-center">选择本地视频后可预览，并按镜头跳转时间点。</p>
            </div>
            <div v-if="gen.outputSrc.value || videoSrc" class="flex gap-2 px-3 py-2 border-t border-surface-3">
              <button class="btn-secondary text-xs" :class="previewKind === 'source' ? '!border-primary-500 text-primary-700' : ''" @click="previewKind = 'source'">参考片</button>
              <button class="btn-secondary text-xs" :disabled="!gen.outputSrc.value" :class="previewKind === 'output' ? '!border-primary-500 text-primary-700' : ''" @click="previewKind = 'output'">成片</button>
            </div>
          </div>

          <div class="card p-5 space-y-3">
            <div class="flex items-center justify-between gap-3">
              <h3 class="text-sm font-semibold text-text-primary">分镜表</h3>
              <div class="flex gap-2">
                <button class="btn-secondary text-xs" :disabled="!selectedShot" @click="splitShot">从中间切开</button>
                <button class="btn-secondary text-xs" :disabled="!canMerge" @click="mergeShot">与下一镜合并</button>
                <button class="btn-secondary text-xs" @click="addShot">加一镜</button>
              </div>
            </div>
            <p v-if="!project.shots.length" class="text-xs text-text-tertiary py-8 text-center">还没有分镜。上传视频后点「开始拆解」。</p>
            <div v-else class="overflow-x-auto">
              <table class="w-full text-xs text-left">
                <thead>
                  <tr class="text-text-tertiary border-b border-surface-3">
                    <th class="py-2 pr-2 font-medium w-8">#</th>
                    <th class="py-2 pr-2 font-medium w-28">时间</th>
                    <th class="py-2 pr-2 font-medium">画面提示词</th>
                    <th class="py-2 pr-2 font-medium">口播</th>
                    <th class="py-2 pr-2 font-medium w-24">运镜</th>
                    <th class="py-2 pr-2 font-medium w-16">成片</th>
                    <th class="py-2 font-medium w-12"></th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(shot, index) in project.shots"
                    :key="shot.id"
                    class="border-b border-surface-3 align-top cursor-pointer"
                    :class="selectedId === shot.id ? 'bg-primary-50/60 dark:bg-primary-900/20' : 'hover:bg-surface-1'"
                    @click="selectShot(shot)"
                  >
                    <td class="py-2 pr-2 text-text-tertiary">{{ index + 1 }}</td>
                    <td class="py-2 pr-2">
                      <div class="flex gap-1 items-center">
                        <input v-model.number="shot.t0" type="number" min="0" step="0.1" class="input-field !py-1 !px-1.5 w-16" @click.stop>
                        <span class="text-text-tertiary">–</span>
                        <input v-model.number="shot.t1" type="number" min="0" step="0.1" class="input-field !py-1 !px-1.5 w-16" @click.stop>
                      </div>
                      <p class="text-[10px] text-text-tertiary mt-1">{{ formatTimecode(shot.t0) }} – {{ formatTimecode(shot.t1) }}</p>
                    </td>
                    <td class="py-2 pr-2">
                      <textarea v-model="shot.visual_prompt" rows="3" class="input-field !py-1.5 text-xs min-w-[12rem]" @click.stop></textarea>
                    </td>
                    <td class="py-2 pr-2">
                      <textarea v-model="shot.vo_text" rows="3" class="input-field !py-1.5 text-xs min-w-[10rem]" @click.stop></textarea>
                    </td>
                    <td class="py-2 pr-2">
                      <input v-model="shot.camera" class="input-field !py-1.5 text-xs" @click.stop>
                    </td>
                    <td class="py-2 pr-2">
                      <p class="text-[11px]" :class="shotStatusClass(shot.status)">{{ shotStatusLabel(shot.status) }}</p>
                      <button
                        v-if="shot.status === 'error' || shot.status === 'done'"
                        class="text-[11px] text-primary-700 mt-1"
                        :disabled="busy || gen.generating.value"
                        @click.stop="rerunShot(shot)"
                      >重跑</button>
                    </td>
                    <td class="py-2">
                      <button class="text-text-tertiary hover:text-red-600" @click.stop="removeShot(index)">删</button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div class="card p-5 space-y-4">
            <div>
              <h3 class="text-sm font-semibold text-text-primary">成片</h3>
              <p class="text-xs text-text-tertiary mt-1">走云控已上架的视频模型。可选按口播文案配音后混进成片。</p>
            </div>

            <div v-if="!gen.cloudAuth.isLoggedIn" class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">请先登录云控端。</div>

            <div class="grid grid-cols-2 gap-2">
              <button
                class="rounded-lg border px-3 py-2 text-xs text-left"
                :class="gen.strategy.value === 'shots' ? 'border-primary-500 bg-primary-50 text-primary-800' : 'border-surface-3'"
                @click="gen.strategy.value = 'shots'"
              >
                <span class="font-medium block">分镜复刻</span>
                <span class="text-text-tertiary">按镜生成再拼接，可重跑某一镜</span>
              </button>
              <button
                class="rounded-lg border px-3 py-2 text-xs text-left"
                :disabled="!gen.quickAvailable.value"
                :class="gen.strategy.value === 'quick' ? 'border-primary-500 bg-primary-50 text-primary-800' : 'border-surface-3'"
                :title="gen.quickAvailable.value ? '' : '参考片超过 15 秒，不能走快捷复刻'"
                @click="gen.quickAvailable.value && (gen.strategy.value = 'quick')"
              >
                <span class="font-medium block">快捷复刻</span>
                <span class="text-text-tertiary">整段参考视频，限 15 秒内</span>
              </button>
            </div>

            <label class="block">
              <span class="form-label">视频模型</span>
              <select v-model="gen.modelId.value" class="input-field mt-1.5">
                <option value="">选择模型</option>
                <option v-for="m in gen.catalog.catalogModels.value" :key="m.model_id" :value="m.model_id">{{ m.display_name }}</option>
              </select>
            </label>
            <div class="grid grid-cols-2 gap-2">
              <label class="block">
                <span class="form-label">模式</span>
                <select v-model="gen.mode.value" class="input-field mt-1.5">
                  <option v-for="m in gen.modeOptions.value" :key="m" :value="m">{{ modeLabel(m) }}</option>
                </select>
              </label>
              <label class="block">
                <span class="form-label">时长档</span>
                <select v-model.number="gen.duration.value" class="input-field mt-1.5">
                  <option v-for="d in gen.durationOptions.value" :key="d" :value="d">{{ d }} 秒</option>
                </select>
              </label>
              <label class="block">
                <span class="form-label">清晰度</span>
                <select v-model="gen.resolution.value" class="input-field mt-1.5">
                  <option v-for="r in gen.resolutionOptions.value" :key="r" :value="r">{{ r }}</option>
                </select>
              </label>
              <label class="block">
                <span class="form-label">比例</span>
                <select v-model="gen.aspectRatio.value" class="input-field mt-1.5">
                  <option v-for="r in gen.aspectRatioOptions.value" :key="r" :value="r">{{ r }}</option>
                </select>
              </label>
            </div>
            <p v-if="gen.selectedSku.value" class="text-[11px] text-text-tertiary">
              预计每任务 {{ Number(gen.selectedSku.value.credit_cost || 0).toFixed(2) }} 积分
              · {{ gen.strategy.value === 'shots' ? `约 ${project.shots.length} 镜` : '整段 1 次' }}
            </p>
            <p v-if="gen.strategy.value === 'quick' && !gen.supportsVideoRef.value" class="text-[11px] text-amber-700">当前模型不支持参考视频，快捷复刻需要 Seedance、Wan 3.0 或带视频参考的模型。</p>

            <label class="flex items-start gap-2 text-xs text-text-secondary">
              <input v-model="gen.enableTts.value" type="checkbox" class="mt-0.5">
              <span>
                <span class="font-medium text-text-primary">按口播配音</span>
                <span class="text-text-tertiary block">用分镜表里的口播走云控 TTS，再混进成片。没有口播则跳过。</span>
              </span>
            </label>
            <label v-if="gen.enableTts.value" class="block">
              <span class="form-label">音色（可选）</span>
              <input v-model="gen.ttsVoice.value" class="input-field mt-1.5" :placeholder="gen.ttsProviders.value[0]?.voice_default || '留空用云控默认音色'">
              <p v-if="!gen.ttsProviders.value.length" class="text-[10px] text-amber-700 mt-1">云控尚未上架 TTS 服务商时，配音会失败，画面仍会保留。</p>
            </label>

            <div>
              <div class="flex items-center justify-between mb-1.5">
                <span class="form-label">商品 / 主体图</span>
                <button class="btn-secondary text-xs" :disabled="busy || gen.generating.value" @click="gen.pickProductImages">添加</button>
              </div>
              <p v-if="!project.product.image_paths.length" class="text-[11px] text-text-tertiary">可选。分镜复刻时用来替换参考片里的主体；不选则用该镜首帧。</p>
              <ul class="space-y-1">
                <li v-for="path in project.product.image_paths" :key="path" class="flex items-center justify-between gap-2 text-[11px] text-text-secondary">
                  <span class="truncate">{{ path.split(/[/\\]/).pop() }}</span>
                  <button class="text-text-tertiary hover:text-red-600" @click="gen.removeProduct(path)">去掉</button>
                </li>
              </ul>
            </div>

            <div v-if="gen.error.value" class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{{ gen.error.value }}</div>
            <div v-if="gen.ttsWarning.value" class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">{{ gen.ttsWarning.value }}</div>
            <div class="flex gap-2">
              <button class="btn-primary flex-1 text-sm" :disabled="!canGenerate" @click="runGenerate">
                {{ gen.generating.value ? gen.stage.value || '生成中…' : '开始成片' }}
              </button>
              <button v-if="gen.generating.value" class="btn-secondary text-sm" @click="gen.cancelGenerate">取消</button>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useModelStore } from '@/stores/models'
import { useAgentWorkspaceStore } from '@/stores/agent-workspaces'
import { groupAndSort } from '@/utils/model-caps'
import { getHintsSync, recordUsage, warmHintsCache } from '@/utils/model-usage-hints'
import { extractJson } from '@shared/json-extract'
import { translateError } from '@/utils/error-message'
import {
  alignTranscriptToShots,
  createEmptyProject,
  formatTimecode,
  isCloneProject,
  newShotId,
  type CloneProject,
  type CloneShot,
  type CloneShotStatus
} from '@shared/clone-doc'
import { useViralCloneGenerate } from './composables/useViralCloneGenerate'

const modelStore = useModelStore()
const workspaceStore = useAgentWorkspaceStore()
const project = ref<CloneProject>(createEmptyProject())
const gen = useViralCloneGenerate(project)
const previewKind = ref<'source' | 'output'>('source')

const selectedId = ref('')
const player = ref<HTMLVideoElement | null>(null)
const visionProviderId = ref('')
const visionModelId = ref('')
const asrProviderId = ref('')
const asrModelId = ref('')
const busy = ref(false)
const importingUrl = ref(false)
const sourceUrl = ref('')
const installingFfmpeg = ref(false)
const ffmpegReady = ref(true)
const ffmpegReason = ref('')
const ytDlpReady = ref(true)
const ytDlpReason = ref('')
const ytDlpInstallHint = ref('brew install yt-dlp')
const ytDlpCopied = ref(false)
const stageText = ref('拆解中…')
const error = ref('')
const notice = ref('')
const hintsTick = ref(0)

const localProviders = computed(() => modelStore.providers.filter((p) => !p.isCloud))
const visionProvider = computed(() => modelStore.providers.find((p) => p.id === visionProviderId.value) || null)
const visionModels = computed(() => visionProvider.value?.models ?? [])
const visionGroups = computed(() => {
  hintsTick.value
  if (!visionProvider.value) return { recommended: [], others: [] }
  return groupAndSort(visionProvider.value.models, 'vision', {
    cloudTypeOf: (mid) => modelStore.cloudTypeOf(visionProvider.value!.id, mid),
    usageHints: getHintsSync('vision', visionProvider.value.id)
  })
})
const asrProvider = computed(() => localProviders.value.find((p) => p.id === asrProviderId.value) || null)
const asrModels = computed(() => asrProvider.value?.models ?? [])
const asrGroups = computed(() => {
  hintsTick.value
  if (!asrProvider.value) return { recommended: [], others: [] }
  return groupAndSort(asrProvider.value.models, 'asr', {
    cloudTypeOf: (mid) => modelStore.cloudTypeOf(asrProvider.value!.id, mid),
    usageHints: getHintsSync('asr', asrProvider.value.id)
  })
})

const selectedShot = computed(() => project.value.shots.find((s) => s.id === selectedId.value) || null)
const canMerge = computed(() => {
  const i = project.value.shots.findIndex((s) => s.id === selectedId.value)
  return i >= 0 && i < project.value.shots.length - 1
})
const canAnalyze = computed(() =>
  Boolean(project.value.source.path && visionProviderId.value && visionModelId.value && ffmpegReady.value && !busy.value && !gen.generating.value)
)
const canGenerate = computed(() =>
  Boolean(
    gen.cloudAuth.isLoggedIn
    && project.value.shots.length
    && gen.selectedSku.value
    && ffmpegReady.value
    && !busy.value
    && !gen.generating.value
  )
)
const videoSrc = computed(() => {
  const path = project.value.source.path
  if (!path) return ''
  if (/^(https?:|blob:|file:)/i.test(path)) return path
  const isAbsolute = /^[A-Za-z]:|^\//.test(path)
  const param = isAbsolute ? 'p' : 'rel'
  return 'local-file://video?' + param + '=' + encodeURIComponent(path)
})
const previewSrc = computed(() => previewKind.value === 'output' && gen.outputSrc.value ? gen.outputSrc.value : videoSrc.value)

function modeLabel(mode: string): string {
  return ({
    text_to_video: '文生视频',
    image_to_video: '图生视频',
    first_last_frame: '首尾帧',
    standard: '标准',
    fast: '快速'
  } as Record<string, string>)[mode] || mode || '-'
}

function shotStatusLabel(status?: CloneShotStatus): string {
  if (status === 'running') return '生成中'
  if (status === 'done') return '已出'
  if (status === 'error') return '失败'
  return '待生成'
}

function shotStatusClass(status?: CloneShotStatus): string {
  if (status === 'done') return 'text-primary-700'
  if (status === 'error') return 'text-red-600'
  if (status === 'running') return 'text-amber-700'
  return 'text-text-tertiary'
}

function cloneApi() {
  const api = window.api?.viralClone
  if (!api?.invoke) throw new Error('请完全退出后重新打开应用，以加载爆款复刻')
  return api
}

function toFriendly(e: unknown, fallback: string): string {
  const raw = e instanceof Error ? e.message : String((e as any)?.message || e || fallback)
  return translateError(raw) || fallback
}

async function refreshYtDlp() {
  try {
    const st = await cloneApi().invoke('ytDlpStatus') as { ready?: boolean; reason?: string; installHint?: string }
    ytDlpReady.value = Boolean(st?.ready)
    ytDlpReason.value = st?.reason || ''
    ytDlpInstallHint.value = st?.installHint || 'brew install yt-dlp'
  } catch (e) {
    ytDlpReady.value = false
    ytDlpReason.value = toFriendly(e, '未检测到 yt-dlp。终端执行 brew install yt-dlp，完成后完全退出再打开应用，或改用本地上传。')
    ytDlpInstallHint.value = 'brew install yt-dlp'
  }
}

async function copyYtDlpHint() {
  try {
    await navigator.clipboard.writeText(ytDlpInstallHint.value)
    ytDlpCopied.value = true
    window.setTimeout(() => { ytDlpCopied.value = false }, 1500)
  } catch {
    notice.value = `请在终端执行：${ytDlpInstallHint.value}`
  }
}

async function refreshFfmpeg() {
  try {
    let st: { ready?: boolean; reason?: string } | undefined
    try {
      st = await window.api.deck.invoke('ffmpegStatus') as { ready?: boolean; reason?: string }
    } catch {
      st = await cloneApi().invoke('ffmpegStatus') as { ready?: boolean; reason?: string }
    }
    ffmpegReady.value = Boolean(st?.ready)
    ffmpegReason.value = st?.reason || ''
  } catch (e) {
    ffmpegReady.value = false
    ffmpegReason.value = toFriendly(e, '无法检测 ffmpeg。请完全退出应用后再打开。')
  }
}

async function installFfmpeg() {
  installingFfmpeg.value = true
  error.value = ''
  try {
    const st = await window.api.deck.invoke('installFfmpeg') as { ready?: boolean; reason?: string }
    ffmpegReady.value = Boolean(st?.ready)
    ffmpegReason.value = st?.reason || ''
    if (!ffmpegReady.value) error.value = ffmpegReason.value || 'ffmpeg 安装失败'
  } catch (e) {
    error.value = toFriendly(e, 'ffmpeg 安装失败')
  } finally {
    installingFfmpeg.value = false
  }
}

async function pickVideo() {
  error.value = ''
  const result = await window.api.dialog.openFile({
    title: '选择参考视频',
    filters: [{ name: '视频', extensions: ['mp4', 'mov', 'webm', 'mkv', 'm4v'] }],
    properties: ['openFile']
  }) as { canceled?: boolean; filePaths?: string[] }
  const path = result?.filePaths?.[0]
  if (!path) return
  try {
    const probe = await cloneApi().invoke('probe', path) as { duration: number; width: number; height: number }
    project.value = {
      ...createEmptyProject(),
      source: {
        path,
        name: path.split(/[/\\]/).pop() || path,
        duration: Number(probe.duration) || 0,
        width: Number(probe.width) || 0,
        height: Number(probe.height) || 0
      }
    }
    selectedId.value = ''
    notice.value = '视频已入库。点「开始拆解」生成分镜表。'
    previewKind.value = 'source'
  } catch (e) {
    error.value = toFriendly(e, '无法读取视频')
  }
}

async function importUrl() {
  const url = sourceUrl.value.trim()
  if (!url || busy.value) return
  error.value = ''
  notice.value = ''
  importingUrl.value = true
  busy.value = true
  try {
    const imported = await cloneApi().invoke('importUrl', url) as {
      path: string
      name: string
      duration: number
      width: number
      height: number
    }
    project.value = {
      ...createEmptyProject(),
      source: {
        path: imported.path,
        name: imported.name || url,
        duration: Number(imported.duration) || 0,
        width: Number(imported.width) || 0,
        height: Number(imported.height) || 0,
        url
      }
    }
    selectedId.value = ''
    notice.value = '链接已落到本地。点「开始拆解」生成分镜表。'
    previewKind.value = 'source'
  } catch (e) {
    error.value = toFriendly(e, '链接拉片失败，请改用本地上传')
  } finally {
    importingUrl.value = false
    busy.value = false
  }
}

const SYSTEM_PROMPT = `你是短视频分镜导演。用户会按时间顺序提供若干关键帧（每张图标注了秒数）。请把相邻、画面接近的帧合并成镜头，输出 JSON 对象：
{"shots":[{"t0":0,"t1":2.5,"visual_prompt":"可直接用于图生视频的中文画面描述","camera":"推/拉/固定等","overlay":"屏上字幕或贴纸，没有则空字符串"}]}
要求：
- t0/t1 用秒，覆盖片头到片尾，镜头不重叠
- visual_prompt 写主体、动作、场景、光线，不要写口播原文
- 只输出 JSON，不要解释`

function buildShotsFromModel(raw: unknown, duration: number, frames: Array<{ time: number; dataUrl: string }>): CloneShot[] {
  let arr: any[] = []
  if (Array.isArray(raw)) arr = raw
  else if (raw && typeof raw === 'object') {
    const found = Object.values(raw as Record<string, unknown>).find((v) => Array.isArray(v))
    arr = Array.isArray(found) ? found : []
  }
  const shots: CloneShot[] = arr.map((item, index) => {
    const t0 = Number(item?.t0 ?? item?.start ?? frames[index]?.time ?? 0)
    const t1 = Number(item?.t1 ?? item?.end ?? frames[index + 1]?.time ?? duration)
    return {
      id: newShotId(),
      t0: Math.max(0, t0),
      t1: Math.max(t0 + 0.2, t1),
      visual_prompt: String(item?.visual_prompt || item?.prompt || '').trim(),
      vo_text: String(item?.vo_text || item?.vo || '').trim(),
      camera: String(item?.camera || '').trim(),
      overlay: String(item?.overlay || '').trim(),
      thumbnail: frames[index]?.dataUrl || ''
    }
  }).filter((s) => s.visual_prompt || s.t1 > s.t0)
  if (shots.length) {
    shots[0].t0 = 0
    shots[shots.length - 1].t1 = duration
    return shots
  }
  return frames.map((frame, index) => ({
    id: newShotId(),
    t0: frame.time,
    t1: frames[index + 1]?.time ?? duration,
    visual_prompt: '',
    vo_text: '',
    camera: '',
    overlay: '',
    thumbnail: frame.dataUrl
  }))
}

async function analyze() {
  if (!canAnalyze.value) return
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    stageText.value = '正在抽帧…'
    const extracted = await cloneApi().invoke('extractFrames', project.value.source.path, 16) as {
      probe: { duration: number; width: number; height: number }
      frames: Array<{ time: number; dataUrl: string }>
    }
    const frames = extracted.frames || []
    if (!frames.length) throw new Error('未能抽出关键帧')
    project.value.source.duration = extracted.probe.duration
    project.value.source.width = extracted.probe.width
    project.value.source.height = extracted.probe.height

    stageText.value = '正在拆分镜…'
    const userContent: any[] = [{ type: 'text', text: `视频总时长 ${extracted.probe.duration.toFixed(1)} 秒。关键帧如下，请合并为分镜表。` }]
    for (const frame of frames) {
      userContent.push({ type: 'text', text: `时间 ${frame.time.toFixed(2)} 秒` })
      userContent.push({ type: 'image_url', image_url: { url: frame.dataUrl } })
    }
    const result = await window.api.llm.invoke('call', visionProviderId.value, visionModelId.value, [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent }
    ], { stream: false, notifyStream: false, max_tokens: 4000, response_format: { type: 'json_object' } }).catch(async () => {
      return window.api.llm.invoke('call', visionProviderId.value, visionModelId.value, [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent }
      ], { stream: false, notifyStream: false, max_tokens: 4000 })
    })
    let resultText = ''
    if (typeof result === 'string') resultText = result.trim()
    else if (result && typeof result === 'object' && 'content' in (result as any)) resultText = String((result as any).content || '').trim()
    else resultText = String(result || '').trim()
    const parsed = extractJson(resultText, { expect: 'object' })
    project.value.shots = buildShotsFromModel(parsed, extracted.probe.duration, frames)
    selectedId.value = project.value.shots[0]?.id || ''
    await recordUsage('vision', visionProviderId.value, visionModelId.value)
    hintsTick.value++

    if (asrProviderId.value && asrModelId.value) {
      stageText.value = '正在识别口播…'
      let wavPath = ''
      try {
        const audio = await cloneApi().invoke('extractAudio', project.value.source.path) as { wavPath: string }
        wavPath = audio.wavPath
        const asr = await cloneApi().invoke('transcribe', wavPath, asrProviderId.value, asrModelId.value) as {
          text?: string
          segments?: Array<{ start: number; end: number; text: string }>
        }
        project.value.source.transcript = asr.text || ''
        if (asr.segments?.length) {
          project.value.shots = alignTranscriptToShots(project.value.shots, asr.segments)
        } else if (asr.text) {
          project.value.shots[0].vo_text = asr.text
        }
        await recordUsage('asr', asrProviderId.value, asrModelId.value)
      } catch (asrErr) {
        notice.value = `分镜已出，口播识别失败：${toFriendly(asrErr, '请手改口播')}`
      } finally {
        if (wavPath) {
          try { await cloneApi().invoke('cleanupAudio', wavPath) } catch { /* ignore */ }
        }
      }
    }

    project.value.updated_at = new Date().toISOString()
    if (!notice.value) notice.value = `已拆成 ${project.value.shots.length} 镜，可改提示词和口播后再保存工程。`
  } catch (e) {
    error.value = toFriendly(e, '拆解失败')
  } finally {
    busy.value = false
    stageText.value = '拆解中…'
  }
}

function selectShot(shot: CloneShot) {
  selectedId.value = shot.id
  const el = player.value
  if (el && Number.isFinite(shot.t0)) {
    try { el.currentTime = Math.max(0, shot.t0) } catch { /* ignore */ }
  }
}

function addShot() {
  const last = project.value.shots[project.value.shots.length - 1]
  const t0 = last ? last.t1 : 0
  const t1 = Math.max(t0 + 1, project.value.source.duration || t0 + 2)
  const shot: CloneShot = { id: newShotId(), t0, t1, visual_prompt: '', vo_text: '', camera: '', overlay: '' }
  project.value.shots.push(shot)
  selectedId.value = shot.id
}

function removeShot(index: number) {
  project.value.shots.splice(index, 1)
  if (!project.value.shots.some((s) => s.id === selectedId.value)) selectedId.value = project.value.shots[0]?.id || ''
}

function splitShot() {
  const shot = selectedShot.value
  if (!shot) return
  const mid = (Number(shot.t0) + Number(shot.t1)) / 2
  if (!(mid > shot.t0 && mid < shot.t1)) return
  const next: CloneShot = {
    ...shot,
    id: newShotId(),
    t0: mid,
    visual_prompt: shot.visual_prompt,
    vo_text: ''
  }
  shot.t1 = mid
  const i = project.value.shots.findIndex((s) => s.id === shot.id)
  project.value.shots.splice(i + 1, 0, next)
}

function mergeShot() {
  const i = project.value.shots.findIndex((s) => s.id === selectedId.value)
  if (i < 0 || i >= project.value.shots.length - 1) return
  const cur = project.value.shots[i]
  const next = project.value.shots[i + 1]
  cur.t1 = next.t1
  cur.visual_prompt = [cur.visual_prompt, next.visual_prompt].filter(Boolean).join('；')
  cur.vo_text = [cur.vo_text, next.vo_text].filter(Boolean).join(' ')
  cur.camera = cur.camera || next.camera
  cur.overlay = cur.overlay || next.overlay
  project.value.shots.splice(i + 1, 1)
}

async function runGenerate() {
  error.value = ''
  notice.value = ''
  try {
    await gen.generateAll()
    previewKind.value = 'output'
    notice.value = project.value.output.local_path ? `成片已保存 ${project.value.output.local_path}` : '成片完成'
    if (gen.ttsWarning.value) notice.value += `。${gen.ttsWarning.value}`
  } catch {
    error.value = gen.error.value || error.value
  }
}

async function rerunShot(shot: CloneShot) {
  error.value = ''
  notice.value = ''
  try {
    await gen.regenerateShot(shot)
    if (project.value.output.local_path) previewKind.value = 'output'
    notice.value = shot.status === 'done' ? '这一镜已重跑' : ''
  } catch {
    error.value = gen.error.value || error.value
  }
}

async function saveProject() {
  error.value = ''
  const doc: CloneProject = {
    ...project.value,
    shots: project.value.shots.map(({ thumbnail, ...rest }) => rest),
    updated_at: new Date().toISOString()
  }
  const defaultDir = workspaceStore.active?.root_path
    ? `${workspaceStore.active.root_path}/output`
    : undefined
  const result = await cloneApi().invoke('saveProject', {
    defaultName: `${(project.value.source.name || 'clone').replace(/\.[^.]+$/, '')}.haohuoban-clone.json`,
    json: JSON.stringify(doc, null, 2),
    defaultDir
  }) as { canceled?: boolean; filePath?: string }
  if (result?.filePath) notice.value = `已保存 ${result.filePath}`
}

async function openProject() {
  error.value = ''
  const result = await cloneApi().invoke('openProject') as { canceled?: boolean; json?: string; filePath?: string }
  if (!result?.json) return
  try {
    const parsed = JSON.parse(result.json)
    if (!isCloneProject(parsed)) throw new Error('不是好伙伴复刻工程文件')
    const empty = createEmptyProject()
    project.value = {
      ...empty,
      ...parsed,
      product: { image_paths: parsed.product?.image_paths || [] },
      generate: { ...empty.generate, ...(parsed.generate || {}) },
      output: { local_path: parsed.output?.local_path || '' }
    }
    selectedId.value = parsed.shots[0]?.id || ''
    if (parsed.generate?.strategy === 'quick' || parsed.generate?.strategy === 'shots') {
      gen.strategy.value = parsed.generate.strategy
    }
    if (parsed.generate?.model) gen.modelId.value = parsed.generate.model
    gen.enableTts.value = Boolean(parsed.generate?.tts_enabled)
    gen.ttsVoice.value = parsed.generate?.tts_voice || ''
    previewKind.value = parsed.output?.local_path ? 'output' : 'source'
    notice.value = `已打开 ${result.filePath || '工程'}`
  } catch (e) {
    error.value = toFriendly(e, '无法打开工程')
  }
}

watch(visionModelId, (v) => {
  if (v) {
    window.api.settings.invoke('set', 'viral_clone_vision_provider_id', visionProviderId.value)
    window.api.settings.invoke('set', 'viral_clone_vision_model_id', v)
  }
})
watch(asrModelId, (v) => {
  window.api.settings.invoke('set', 'viral_clone_asr_provider_id', asrProviderId.value)
  window.api.settings.invoke('set', 'viral_clone_asr_model_id', v || '')
})

onMounted(async () => {
  await Promise.all([modelStore.fetchProviders(), warmHintsCache(), refreshFfmpeg(), refreshYtDlp(), gen.ensureCatalog().catch(() => {})])
  hintsTick.value++
  const all = (await window.api.settings.invoke('getAll')) as Record<string, string>
  if (all.viral_clone_vision_provider_id) visionProviderId.value = all.viral_clone_vision_provider_id
  if (all.viral_clone_vision_model_id) visionModelId.value = all.viral_clone_vision_model_id
  if (all.viral_clone_asr_provider_id) asrProviderId.value = all.viral_clone_asr_provider_id
  if (all.viral_clone_asr_model_id) asrModelId.value = all.viral_clone_asr_model_id
  if (all.viral_clone_video_model_id) gen.modelId.value = all.viral_clone_video_model_id
})

watch(() => gen.modelId.value, (v) => {
  if (v) window.api.settings.invoke('set', 'viral_clone_video_model_id', v)
})
</script>
