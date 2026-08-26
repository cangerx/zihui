<script setup lang="ts">
/**
 * 商品套图结果页：对话流形态
 * 对照 原型图/fcb203c6c3171f753c3f72b9232625a1.jpg，实测见 docs/电商套图内页.md §3
 *
 * 与 tool-run 的「进度条 + 结果大图」不同：本页把一次生成表达成一轮对话 ——
 * 用户消息卡（商品图 + 诉求）→ AI 思考中 → AI 结果图，且可继续追加需求。
 */
import { computed, onUnmounted, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { extractResultImages, queryWorkflow, runWorkflow } from '@/api/modules/app'
import { uploadImages } from '@/api/modules/upload'
import { createPoller } from '@/utils/poller'
import { useMemberStore } from '@/store/member'
import { inputValue } from '@/utils/event'
import type { WorkflowQueryResult } from '@/api/types'

interface Turn {
  /** user：右侧紫卡；ai：左侧头像 + 内容 */
  role: 'user' | 'ai'
  /** 卡内图片（user 为商品图，ai 为结果图） */
  images: string[]
  /** 图下文案 / 纯文本消息 */
  text: string
  /** AI 思考中 */
  thinking?: boolean
}

const member = useMemberStore()

const turns = ref<Turn[]>([])
const draft = ref('')
const running = ref(false)
/** 首轮请求的表单值，追加需求时复用。imageKeys 标明哪些字段是图片，需上传 */
const basePayload = ref<{
  uuid: string
  values: Record<string, unknown>
  imageKeys: string[]
} | null>(null)
const scrollInto = ref('')
/** scroll-into-view 同值不重触发，每轮自增确保结果图出现时能滚到底 */
const scrollTick = ref(0)

let poller: ReturnType<typeof createPoller<WorkflowQueryResult>> | null = null

const canSend = computed(() => draft.value.trim().length > 0 && !running.value)

onLoad((query) => {
  const raw = query?.payload ? decodeURIComponent(String(query.payload)) : ''
  if (!raw) return
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // payload 结构异常时不静默留白，给一条可见提示
    uni.showToast({ title: '参数解析失败', icon: 'none' })
    return
  }
  // 校验形状：合法 JSON 但非预期对象（如 "abc"/123）时，Object.entries(values) 会抛，
  // 且此时若已 push turns、置 running，页面会永停「思考中」不可重试。先挡在门外。
  const p = parsed as Record<string, unknown>
  if (!p || typeof p !== 'object' || typeof p.uuid !== 'string' || typeof p.values !== 'object') {
    uni.showToast({ title: '参数格式不正确', icon: 'none' })
    return
  }
  basePayload.value = {
    uuid: p.uuid,
    values: (p.values as Record<string, unknown>) || {},
    imageKeys: Array.isArray(p.imageKeys) ? (p.imageKeys as string[]) : [],
  }
  submit('生成详情页')
})

onUnmounted(() => poller?.abort())

function scrollToLast() {
  // finishThinking 原地替换最后一条、长度不变，若用 turn 索引生成 id，
  // 两次 scrollInto 字符串相同 → scroll-into-view 不重触发、结果图不滚动。
  // 改为指向末尾专用锚点，其 id 随 tick 自增，每次都变、强制重新滚到底。
  scrollTick.value += 1
  scrollInto.value = `sres-anchor-${scrollTick.value}`
}

/**
 * 发起一轮生成。requirement 为本轮诉求文案，落在用户消息卡的图注位置。
 */
async function submit(requirement: string) {
  if (!basePayload.value || running.value) return
  const { uuid, values, imageKeys } = basePayload.value

  // 消息卡里展示的商品图：只取图片字段的值，不再「找第一个字符串数组」
  const localImages = imageKeys
    .flatMap((k) => (Array.isArray(values[k]) ? (values[k] as string[]) : []))
    .filter((i) => typeof i === 'string')

  turns.value.push({ role: 'user', images: localImages, text: requirement })
  turns.value.push({ role: 'ai', images: [], text: '思考中..', thinking: true })
  scrollToLast()
  running.value = true

  const system: Record<string, unknown> = {}
  const form: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(values)) {
    // 只有图片字段才走上传；其余数组（如多选项的 value 数组）原样进 form，
    // 不再「凡数组就当文件路径上传」
    if (imageKeys.includes(key)) {
      const urls = await uploadImages((value as string[]) || [])
      if (!urls) {
        finishThinking('素材上传失败，请重试')
        return
      }
      system[key] = urls
      continue
    }
    form[key] = value
  }
  form.requirement = requirement

  const task = await runWorkflow({ uuid, form, system })
  const taskId = task?.task_uuid || task?.task_id
  if (!taskId) {
    finishThinking('任务提交失败，请重试')
    return
  }

  poller = createPoller<WorkflowQueryResult>({
    fetch: () => queryWorkflow(taskId),
    isDone: (data) => data.status === 'completed' || data.status === 'success',
    isFailed: (data) => data.status === 'failed' || Boolean(data.error_message),
  })
  const { status, data } = await poller.start()
  poller = null

  if (status === 'done' && data) {
    const urls = extractResultImages(data.result)
    finishThinking(urls.length ? '已按你的要求生成' : '未获取到结果', urls)
    return
  }
  // request 层已对失败 message 弹过 toast，这里只更新气泡，不二次弹窗
  finishThinking(status === 'timeout' ? '生成超时，可稍后在最近任务查看' : '生成失败，请重试')
}

/** 把最后一条 thinking 气泡换成最终内容 */
function finishThinking(text: string, images: string[] = []) {
  const last = turns.value[turns.value.length - 1]
  if (last && last.role === 'ai' && last.thinking) {
    turns.value[turns.value.length - 1] = { role: 'ai', images, text }
  }
  running.value = false
  scrollToLast()
}

function onSend() {
  if (!canSend.value) return
  const text = draft.value.trim()
  draft.value = ''
  submit(text)
}

function preview(turn: Turn, index: number) {
  uni.previewImage({ urls: turn.images, current: turn.images[index] })
}

function goVip() {
  uni.navigateTo({ url: '/pages-sub/vip/vip' })
}

function onMore() {
  uni.showToast({ title: '更多操作开发中', icon: 'none' })
}
</script>

<template>
  <view class="sres">
    <nav-bar :bg-color="'#ffffff'" :transparent="false">
      <template #right>
        <view class="sres__nav-right">
          <view class="sres__beans" @tap="goVip">
            <ui-icon name="bean" :size="26" color="#16161a" />
            <text class="sres__beans-text">{{ member.beans }}</text>
          </view>
          <view class="sres__round" @tap="onMore">
            <ui-icon name="grid" :size="30" color="#16161a" />
          </view>
        </view>
      </template>
    </nav-bar>

    <!-- 实测标题位是 ink 高 29px 的免责小字，不是页面标题，所以放在导航下方独立一行 -->
    <view class="sres__disclaim">
      <text class="sres__disclaim-text">内容由AI生成</text>
    </view>

    <scroll-view
      class="sres__body"
      scroll-y
      :show-scrollbar="false"
      :scroll-into-view="scrollInto"
      :scroll-with-animation="true"
    >
      <view v-for="(turn, ti) in turns" :id="`turn-${ti}`" :key="ti" class="sres__turn">
        <!-- 用户：右对齐紫卡，图 + 图注 -->
        <view v-if="turn.role === 'user'" class="sres__user">
          <view class="sres__bubble">
            <image
              v-if="turn.images.length"
              class="sres__bubble-img"
              :src="turn.images[0]"
              mode="aspectFill"
              @tap="preview(turn, 0)"
            />
            <text class="sres__bubble-text">{{ turn.text }}</text>
          </view>
        </view>

        <!-- AI：左侧头像 + 文案（思考中带呼吸动效） -->
        <view v-else class="sres__ai">
          <view class="sres__avatar">
            <ui-icon name="ai-image" :size="28" color="#ffffff" />
          </view>
          <view class="sres__ai-body">
            <text class="sres__ai-text" :class="{ 'sres__ai-text--thinking': turn.thinking }">
              {{ turn.text }}
            </text>
            <view v-if="turn.images.length" class="sres__results">
              <image
                v-for="(url, i) in turn.images"
                :key="url"
                class="sres__result"
                :src="url"
                mode="widthFix"
                @tap="preview(turn, i)"
              />
            </view>
          </view>
        </view>
      </view>

      <!-- 底部滚动锚点：id 随 tick 变，供 scroll-into-view 每轮重触发 -->
      <view :id="`sres-anchor-${scrollTick}`" class="sres__safe" />
    </scroll-view>

    <!-- 底部输入卡：贴底通栏，顶部圆角 50rpx，底色 = 页面底色 -->
    <view class="sres__input">
      <textarea
        class="sres__field"
        :value="draft"
        placeholder="描述你的设计需求，我来帮你继续改"
        placeholder-class="sres__ph"
        :auto-height="true"
        :maxlength="500"
        :show-confirm-bar="false"
        :cursor-spacing="24"
        @input="draft = inputValue($event)"
      />
      <view class="sres__actions">
        <view class="sres__act" @tap="onMore">
          <ui-icon name="plus" :size="38" color="#16161a" />
        </view>
        <view class="sres__act" @tap="onMore">
          <ui-icon name="image" :size="38" color="#16161a" />
        </view>
        <view class="sres__act" @tap="onMore">
          <ui-icon name="grid" :size="38" color="#16161a" />
        </view>
        <view class="sres__spacer" />
        <!-- 麦克风与发送钮的间距（68px）小于左侧图标步进，单独成组 -->
        <view class="sres__right">
          <view class="sres__act" @tap="onMore">
            <ui-icon name="mic" :size="35" color="#16161a" />
          </view>
          <view class="sres__send" :class="{ 'sres__send--on': canSend }" @tap="onSend">
            <ui-icon name="arrow-up" :size="34" :color="canSend ? '#ffffff' : '#bbbbbb'" />
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.sres {
  display: flex;
  flex-direction: column;
  height: 100vh;
  /* 实测页底纯白，非 $bg-page */
  background: $bg-card;

  &__nav-right {
    display: flex;
    align-items: center;
    gap: 19rpx;
  }

  /* 实测余额胶囊 195×125px ≈ 116×74rpx（含行高余量，落地 60rpx 高） */
  &__beans {
    height: 60rpx;
    padding: 0 20rpx;
    border-radius: $radius-btn;
    background: $bg-fill;
    display: flex;
    align-items: center;
    gap: 8rpx;
  }

  &__beans-text {
    font-size: $fs-aux;
    color: $ink;
    font-weight: 600;
  }

  /* 实测圆钮 122×123px ≈ 73rpx，含点击热区，视觉圆 44rpx */
  &__round {
    width: 44rpx;
    height: 44rpx;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  &__disclaim {
    padding: 0 $gap-page 4rpx;
  }

  &__disclaim-text {
    font-size: $fs-tiny;
    color: $ink-3;
  }

  &__body {
    flex: 1;
    min-height: 0;
  }

  &__turn {
    padding: 0 26rpx;
  }

  &__user {
    display: flex;
    justify-content: flex-end;
    /* 卡顶 364 → 免责小字底 232，间距 132px ≈ 79rpx；轮次间取 28rpx */
    margin-top: 28rpx;
  }

  /* 实测 636×1165px ≈ 378×693rpx，底 #cecfff，圆角 R72px ≈ 43rpx，内边距 25rpx */
  /*
   * 实测 636×1165px ≈ 378×693rpx，底 #cecfff，圆角 R72px ≈ 43rpx，内边距 25rpx。
   * 下内边距不等于其它三边：文案 ink 底 → 卡底实测 65px，比 25rpx(=42px) 多 17px，
   * 故写 35rpx。
   */
  &__bubble {
    width: 378rpx;
    padding: 25rpx 25rpx 35rpx;
    border-radius: $radius-bubble;
    background: $bubble-user;
    animation: sres-in $dur-base $ease-base;
  }

  /* 内图 553×982px ≈ 329×584rpx */
  &__bubble-img {
    width: 329rpx;
    height: 584rpx;
    border-radius: $radius-thumb;
    display: block;
  }

  /* 图底 1387 → 文案 ink 顶 1415 = 28px；17rpx 时量到 32px，回调 2rpx */
  &__bubble-text {
    display: block;
    margin-top: 15rpx;
    font-size: $fs-body;
    color: $ink;
    text-align: center;
  }

  &__ai {
    display: flex;
    /* 头像右 127 → 文案左 156，间距 29px ≈ 17rpx */
    gap: 17rpx;
    /* 卡底 1528 → 头像顶 1587，间距 59px ≈ 35rpx */
    margin-top: 35rpx;
  }

  /* 实测头像 86×86px ≈ 51rpx 圆 */
  &__avatar {
    width: 51rpx;
    height: 51rpx;
    border-radius: 50%;
    background: linear-gradient(135deg, $grad-ai-from, $grad-ai-to);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  &__ai-body {
    flex: 1;
    min-width: 0;
  }

  &__ai-text {
    display: block;
    /* 文案 ink 顶 1610 比头像顶 1587 低 23px；4rpx 时只差 10px，补到 12rpx */
    margin-top: 12rpx;
    font-size: $fs-aux;
    color: $ink-2;

    &--thinking {
      animation: sres-breathe 1.4s $ease-base infinite;
    }
  }

  &__results {
    margin-top: 17rpx;
  }

  &__result {
    width: 100%;
    border-radius: $radius-card-sm;
    display: block;

    & + & {
      margin-top: 17rpx;
    }
  }

  &__safe {
    height: 40rpx;
  }

  /* 实测：贴底通栏、顶部圆角 R84px ≈ 50rpx、底色 #f7f8fc */
  &__input {
    border-radius: 50rpx 50rpx 0 0;
    background: $bg-page;
    padding: 38rpx 27rpx calc(16rpx + env(safe-area-inset-bottom));
  }

  &__field {
    width: 100%;
    min-height: 44rpx;
    max-height: 240rpx;
    font-size: $fs-body;
    line-height: 1.5;
    color: $ink;
  }

  &__ph {
    color: $ink-3;
  }

  /*
   * placeholder ink 底 2406 → 图标顶 2576 = 170px ≈ 101rpx。
   * 图标排比正文多缩进：placeholder 左 x45、图标左 x73 ⇒ 另加 28px ≈ 17rpx。
   */
  &__actions {
    margin-top: 60rpx;
    padding-left: 17rpx;
    display: flex;
    align-items: center;
    /* 图标左边界 73 / 222 / 369 ⇒ 步进 148px，图标 38rpx ⇒ 间距 50rpx */
    gap: 50rpx;
  }

  &__act {
    display: flex;
    align-items: center;
  }

  &__spacer {
    flex: 1;
  }

  /* 麦克风右 1024 → 发送左 1092，间距 68px ≈ 40rpx（小于左侧 50rpx 步进） */
  &__right {
    display: flex;
    align-items: center;
    gap: 40rpx;
  }

  /* 实测发送圆钮 126px ≈ 75rpx */
  &__send {
    width: 75rpx;
    height: 75rpx;
    border-radius: 50%;
    background: $bg-skeleton;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background $dur-fast $ease-base;

    &--on {
      background: $ink;
    }
  }
}

@keyframes sres-in {
  from {
    opacity: 0;
    transform: translateY(20rpx);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes sres-breathe {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.45;
  }
}
</style>
