<script setup lang="ts">
/**
 * 功能操作页：GetApp schema → 动态表单 → Run → 轮询 Query → 结果
 * 对照 原型图/功能页面.jpg（画质修复）
 * 链路见 docs/API开发文档.md §4.4
 */
import { computed, onUnmounted, ref } from 'vue'
import { onHide, onLoad, onShow } from '@dcloudio/uni-app'
import {
  extractResultImages,
  getAppDetail,
  getAppListByCategory,
  optimizeImage,
  optimizeText,
  queryWorkflow,
  runWorkflow,
} from '@/api/modules/app'
import { uploadAppAssets, uploadImages } from '@/api/modules/upload'
import { AI_IMAGE_APP_ID } from '@/api/catalog'
import { USE_MOCK } from '@/api/config'
import { apiErrorCode, apiErrorInvalidatedSession } from '@/api/v1-client'
import { navigateToLoginOnce } from '@/api/login-navigation'
import { createPoller } from '@/utils/poller'
import { useMemberStore } from '@/store/member'
import { useUserStore } from '@/store/user'
import type { AppDetail, AppSchemaField, WorkflowQueryResult } from '@/api/types'

const member = useMemberStore()
const user = useUserStore()

const detail = ref<AppDetail | null>(null)
const loading = ref(true)
const loadError = ref('')
const values = ref<Record<string, unknown>>({})
const optimizingField = ref('')

const running = ref(false)
const statusText = ref('')
const results = ref<string[]>([])
const showModeSheet = ref(false)

let poller: ReturnType<typeof createPoller<WorkflowQueryResult>> | null = null
let awaitingLogin = false
let toolLoadSequence = 0
let requestedUuid = USE_MOCK ? 'app-hd' : AI_IMAGE_APP_ID
let requestedPreset = ''

const fields = computed(() => detail.value?.appSchema.fields || [])
/** 价格随模式变：高级模式约为普通的数倍（原型美豆价目表口径） */
const price = computed(() => {
  const base = detail.value?.app.price || 0
  return member.runMode === 'advanced' ? base * 3 : base
})
/** 效果对比图（修复前/后），取应用封面兜底 */
const demoBefore = ref('')
const demoAfter = ref('')
const modeLabel = computed(() => (member.runMode === 'advanced' ? '高级模式' : '普通模式'))
const showModeControl = computed(() => USE_MOCK)

/** 第一个图片上传字段是否已有图：决定底部按钮是「导入图片」还是「立即生成」 */
const imageFieldId = computed(() => fields.value.find((f) => f.type === 'image')?.id || '')
const hasImage = computed(() => (imageFieldId.value ? arrayValue(imageFieldId.value).length > 0 : true))

onLoad((query) => {
  // 从模板卡进来时带的是 template=tpl-x，需反查其功能 uuid（此前只读 uuid，
  // 模板参数被吞、一律兜底成 app-hd，任何模板点进来都是「画质修复」）
  const template = query?.template ? String(query.template) : ''
  const templateUuid = USE_MOCK && template ? AI_IMAGE_APP_ID : ''
  requestedUuid = (query?.uuid as string) || templateUuid || requestedUuid
  requestedPreset = query?.prompt ? decodeURIComponent(String(query.prompt)) : ''
  let initialImages: string[] = []
  if (query?.images) {
    try {
      const parsed = JSON.parse(decodeURIComponent(String(query.images)))
      if (Array.isArray(parsed)) initialImages = parsed.filter((item): item is string => typeof item === 'string')
    } catch {
      initialImages = []
    }
  }

  if (!USE_MOCK && !user.isLogin) {
    loading.value = false
    loadError.value = '登录后才能使用 AI 生图'
    awaitingLogin = true
    navigateToLoginOnce()
    return
  }
  loadTool(requestedUuid, requestedPreset, initialImages)
})

async function loadTool(uuid: string, preset: string, initialImages: string[] = []) {
  const requestToken = user.token
  const sequence = ++toolLoadSequence
  loading.value = true
  loadError.value = ''
  try {
    const data = await getAppDetail(uuid)
    if (sequence !== toolLoadSequence || isStaleSession(requestToken)) return
    detail.value = data
    if (!data) loadError.value = '功能暂未开放或当前账号没有可用模型'
  } catch (error) {
    if (sequence !== toolLoadSequence || handleExpiredLogin(error, requestToken)) return
    loadError.value = '功能加载失败，请检查网络后重试'
  } finally {
    if (sequence === toolLoadSequence) loading.value = false
  }
  if (!detail.value) return

  // 效果对比图取工具列表里的封面（GetApp 不返回 poster）
  // TODO(api)：before/after 后端未提供，先用同一封面占位，联调时替换为真实对比对
  const categories = USE_MOCK ? await getAppListByCategory() : []
  const poster = categories.flatMap((category) => category.apps).find((app) => app.uuid === uuid)?.poster || ''
  demoBefore.value = poster
  demoAfter.value = poster

  const initial: Record<string, unknown> = {}
  detail.value.appSchema.fields.forEach((field) => {
    if (field.type === 'image' || field.type === 'card-multi-select') initial[field.id] = []
    else if (field.type === 'number') initial[field.id] = field.default ?? field.min ?? 1
    else initial[field.id] = field.default ?? ''
  })
  // 首页「一句话生成」带来的 prompt 填入第一个文本字段
  if (preset) {
    const textField = detail.value.appSchema.fields.find((f) => f.type === 'textarea')
    if (textField) initial[textField.id] = preset
  }
  if (initialImages.length) {
    const imageField = detail.value.appSchema.fields.find((f) => f.type === 'image')
    if (imageField) initial[imageField.id] = initialImages
  }
  values.value = initial
}

function isStaleSession(requestToken: string): boolean {
  return !USE_MOCK && (requestToken !== user.token || !user.isLogin)
}

function handleExpiredLogin(error: unknown, requestToken: string): boolean {
  const invalidatedCurrentSession = apiErrorInvalidatedSession(error)
  if (!USE_MOCK && requestToken !== user.token && !invalidatedCurrentSession) return true
  if (USE_MOCK || apiErrorCode(error) !== 401) return false
  if (!invalidatedCurrentSession) return true
  user.logout()
  awaitingLogin = true
  loadError.value = '登录状态已失效，请重新登录'
  navigateToLoginOnce()
  return true
}

onUnmounted(() => poller?.abort())

// navigateTo 到最近任务时本页只隐藏不卸载，轮询继续；用可见性标记避免
// 轮询结束的 toast 弹到别的页面上（页面隐藏期间不弹，回来仍能看到结果状态）
const pageVisible = ref(true)
onHide(() => {
  pageVisible.value = false
})
onShow(() => {
  pageVisible.value = true
  if (awaitingLogin && user.isLogin) {
    awaitingLogin = false
    loadTool(requestedUuid, requestedPreset)
  }
})
function toast(title: string) {
  if (pageVisible.value) uni.showToast({ title, icon: 'none' })
}

function setValue(id: string, value: unknown) {
  values.value = { ...values.value, [id]: value }
}

function arrayValue(id: string): string[] {
  const value = values.value[id]
  return Array.isArray(value) ? (value as string[]) : []
}

async function onOptimize(field: AppSchemaField) {
  if (!detail.value || optimizingField.value) return
  optimizingField.value = field.id

  // 有图优先走图转文，否则文转文（§4.5）
  const imageField = fields.value.find((f) => f.type === 'image')
  const localImages = imageField ? arrayValue(imageField.id) : []

  let text = ''
  if (localImages.length) {
    const urls = await uploadImages(localImages)
    text = urls ? await optimizeImage(detail.value.app.id, field.id, urls) : ''
  } else {
    const current = values.value[field.id]
    text = await optimizeText(detail.value.app.id, field.id, String(current || ''))
  }
  if (text) setValue(field.id, text)
  optimizingField.value = ''
}

function validate(): string {
  for (const field of fields.value) {
    if (!field.required) continue
    const value = values.value[field.id]
    const empty = Array.isArray(value) ? value.length === 0 : !value
    if (empty) return field.type === 'image' ? '请先上传图片' : `请填写${field.label}`
  }
  return ''
}

/** 拆分 system / form，并把本地图上传为远端 URL */
async function buildPayload() {
  const system: Record<string, unknown> = {}
  const form: Record<string, unknown> = {}
  let prompts: string[] = []

  for (const field of fields.value) {
    if (field.type === 'image') {
      if (!USE_MOCK) {
        const assets = await uploadAppAssets(arrayValue(field.id))
        if (!assets) return null
        system.asset_ids = assets.map((asset) => asset.id)
      } else {
        const urls = await uploadImages(arrayValue(field.id))
        if (!urls) return null
        system[field.id] = urls
      }
      continue
    }
    if (field.id === 'internal_prompt') {
      prompts = arrayValue(field.id)
      continue
    }
    if (field.scope === 'system') system[field.id] = values.value[field.id]
    else form[field.id] = values.value[field.id]
  }
  return { system, form, prompts }
}

async function submit() {
  if (running.value || !detail.value) return
  const requestToken = user.token
  const error = validate()
  if (error) {
    uni.showToast({ title: error, icon: 'none' })
    return
  }

  running.value = true
  results.value = []
  statusText.value = '正在上传素材'

  const payload = await buildPayload()
  if (isStaleSession(requestToken)) {
    running.value = false
    statusText.value = ''
    return
  }
  if (!payload) {
    running.value = false
    statusText.value = ''
    return
  }

  statusText.value = '任务已提交，排队中'

  // internal_prompt 多选时按 prompt 拆多次请求（§3.2.3）
  const promptList = payload.prompts.length ? payload.prompts : ['']
  const taskIds: string[] = []
  try {
    for (const prompt of promptList) {
      if (isStaleSession(requestToken)) break
      const task = await runWorkflow({
        uuid: detail.value.app.id,
        form: payload.form,
        system: prompt ? { ...payload.system, internal_prompt: prompt } : payload.system,
      })
      if (isStaleSession(requestToken)) break
      const id = task?.task_uuid || task?.task_id
      if (id) taskIds.push(id)
    }
  } catch (error) {
    if (!handleExpiredLogin(error, requestToken)) toast('任务提交失败，请检查账号权限、余额或网络')
  }

  if (isStaleSession(requestToken)) {
    running.value = false
    statusText.value = ''
    return
  }
  if (!taskIds.length) {
    running.value = false
    statusText.value = '任务提交失败'
    toast('任务提交失败，请稍后重试')
    return
  }

  const collected: string[] = []
  for (const taskId of taskIds) {
    poller = createPoller<WorkflowQueryResult>({
      fetch: () => {
        if (isStaleSession(requestToken)) throw new Error('stale_session')
        return queryWorkflow(taskId)
      },
      isDone: (data) => data.status === 'completed' || data.status === 'success',
      isFailed: (data) => data.status === 'failed' || Boolean(data.error_message),
      onTick: (data) => {
        if (isStaleSession(requestToken)) return
        statusText.value = data?.status === 'running' ? 'AI 正在生成中' : '排队中'
      },
    })
    let polled: Awaited<ReturnType<typeof poller.start>>
    try {
      polled = await poller.start()
    } catch (error) {
      if (!handleExpiredLogin(error, requestToken)) toast('任务状态查询失败，可稍后在最近任务查看')
      continue
    }
    if (isStaleSession(requestToken)) break
    const { status, data } = polled
    if (status === 'done' && data) collected.push(...extractResultImages(data.result))
    if (status === 'failed') toast(data?.error_message || '生成失败')
    if (status === 'timeout') {
      toast('生成超时，可稍后在最近任务查看')
    }
  }

  if (isStaleSession(requestToken)) {
    running.value = false
    statusText.value = ''
    poller = null
    return
  }
  statusText.value = collected.length ? '生成完成' : '未获取到结果'
  results.value = collected
  running.value = false
  poller = null
}

/** 底部主按钮：未选图先拉起选图，已选图才提交生成 */
function onPrimary() {
  if (running.value) return
  if (!hasImage.value && imageFieldId.value) {
    uni.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      success: (res) => {
        const paths = (res.tempFilePaths as string[]) || []
        if (paths.length) setValue(imageFieldId.value, paths)
      },
    })
    return
  }
  submit()
}

function previewResult(index: number) {
  uni.previewImage({ urls: results.value, current: results.value[index] })
}

function saveResult(url: string) {
  uni.saveImageToPhotosAlbum({
    filePath: url,
    success: () => uni.showToast({ title: '已保存到相册', icon: 'none' }),
    fail: () => uni.showToast({ title: '保存失败，请检查相册权限', icon: 'none' }),
  })
}

function goHistory() {
  uni.navigateTo({ url: '/pages-sub/task-history/task-history' })
}
</script>

<template>
  <view class="run">
    <nav-bar :title="detail?.app.name || ''">
      <template #right>
        <view class="run__history" @tap="goHistory">
          <text class="run__history-text">最近任务</text>
          <ui-icon name="arrow" :size="24" color="#999999" />
        </view>
      </template>
    </nav-bar>

    <scroll-view class="run__body" scroll-y :show-scrollbar="false">
      <!-- 效果对比：可拖动中缝的修复前/后（未生成、未运行时展示） -->
      <view v-if="demoBefore && !results.length && !running" class="run__demo">
        <image-compare :before="demoBefore" :after="demoAfter" />
      </view>
      <text v-if="detail?.app.description && !results.length && !running" class="run__desc">
        {{ detail.app.description }}
      </text>

      <!-- 结果：单张大图铺满内容区 -->
      <view v-if="results.length" class="run__results">
        <view v-for="(url, index) in results" :key="url" class="run__result">
          <image class="run__result-img" :src="url" mode="widthFix" @tap="previewResult(index)" />
          <view class="run__result-save" @tap.stop="saveResult(url)">
            <ui-icon name="download" :size="28" color="#ffffff" />
          </view>
        </view>
      </view>

      <run-progress v-else-if="running" :status-text="statusText" :active="running" />

      <view v-if="!loading && loadError" class="run__unavailable">
        <ui-icon name="image" :size="72" color="#b7b7c4" />
        <text class="run__unavailable-title">功能暂不可用</text>
        <text class="run__unavailable-text">{{ loadError }}</text>
      </view>

      <view v-if="!loading && detail" class="run__form">
        <schema-field
          v-for="field in fields"
          :key="field.id"
          :field="field"
          :model-value="values[field.id]"
          :optimizing="optimizingField === field.id"
          @update:model-value="setValue(field.id, $event)"
          @optimize="onOptimize(field)"
        />
      </view>

      <view class="run__safe" />
    </scroll-view>

    <view v-if="detail" class="run__foot">
      <view v-if="showModeControl" class="run__mode" @tap="showModeSheet = true">
        <text class="run__mode-text">{{ modeLabel }}</text>
        <ui-icon :name="showModeSheet ? 'arrow-down' : 'arrow-up'" :size="24" color="#666666" />
      </view>
      <view class="run__submit" :class="{ 'run__submit--busy': running }" @tap="onPrimary">
        <text class="run__submit-text">
          {{ running ? '生成中...' : hasImage ? '立即生成' : '导入图片/视频' }}
        </text>
        <view v-if="!running && hasImage && price" class="run__submit-price">
          <ui-icon name="bean" :size="24" color="#ffffff" />
          <text class="run__submit-price-text">{{ price }}</text>
        </view>
      </view>
    </view>

    <mode-sheet
      v-if="showModeControl"
      v-model="showModeSheet"
      :mode="member.runMode"
      @update:mode="member.setRunMode($event)"
    />
  </view>
</template>

<style lang="scss" scoped>
.run {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: $bg-card;

  &__body {
    flex: 1;
    min-height: 0;
  }

  &__history {
    display: flex;
    align-items: center;
    gap: 4rpx;
  }

  &__history-text {
    font-size: $fs-aux;
    color: $ink-3;
  }

  /* 说明文案在对比图之后，作为图注 */
  &__desc {
    display: block;
    padding: 16rpx $gap-page 0;
    font-size: $fs-aux;
    color: $ink-2;
    text-align: center;
  }

  /* 对比控件容器：交给 image-compare 内部处理 */
  &__demo {
    margin: 24rpx $gap-page 0;
    height: 420rpx;
  }

  /* 结果单列大图铺满内容区 */
  &__results {
    padding: 24rpx $gap-page 0;
  }

  &__result {
    position: relative;
    width: 100%;
    border-radius: 24rpx;
    overflow: hidden;
    animation: run-in $dur-base $ease-base;
  }

  &__result-img {
    width: 100%;
    display: block;
  }

  &__result-save {
    position: absolute;
    right: 12rpx;
    bottom: 12rpx;
    width: 56rpx;
    height: 56rpx;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  &__form {
    padding: 8rpx $gap-page 0;
  }

  &__unavailable {
    min-height: 520rpx;
    padding: 100rpx $gap-page 40rpx;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }

  &__unavailable-title {
    margin-top: 28rpx;
    font-size: $fs-title;
    font-weight: 600;
    color: $ink;
  }

  &__unavailable-text {
    margin-top: 12rpx;
    font-size: $fs-aux;
    line-height: 1.6;
    text-align: center;
    color: $ink-3;
  }

  &__safe {
    height: 60rpx;
  }

  &__foot {
    display: flex;
    align-items: center;
    gap: 20rpx;
    padding: 16rpx $gap-page calc(20rpx + env(safe-area-inset-bottom));
    border-top: 1px solid $line;
    background: $bg-card;
  }

  &__mode {
    height: 100rpx;
    padding: 0 24rpx;
    border-radius: 50rpx;
    background: $bg-fill;
    display: flex;
    align-items: center;
    gap: 6rpx;
    flex-shrink: 0;
  }

  &__mode-text {
    font-size: $fs-aux;
    color: $ink-2;
  }

  &__submit {
    flex: 1;
    height: 100rpx;
    border-radius: 50rpx;
    background: $brand;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12rpx;

    &--busy {
      background: $brand-disabled;
    }
  }

  &__submit-text {
    font-size: 32rpx;
    font-weight: 600;
    color: #ffffff;
  }

  &__submit-price {
    display: flex;
    align-items: center;
    gap: 4rpx;
  }

  &__submit-price-text {
    font-size: $fs-aux;
    color: rgba(255, 255, 255, 0.85);
  }
}

@keyframes run-in {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
</style>
