<script setup lang="ts">
/**
 * 商品套图运行页（电商套图独立内页）
 * 对照 原型图/9403eb6d4b081d47c468e65c2c80d86b.jpg，实测见 docs/电商套图内页.md §1 §2
 *
 * 不复用 pages-sub/tool-run：那页是「对比图 + 选项卡片组」形态（docs/原型图分析.md §2.6），
 * 本页是「区块卡 + 设置行 picker + AI 帮写弹层」，两者版式无交集。
 * 表单仍由 GetApp schema 驱动，只是按 field.type 分派到本页的原型化控件。
 */
import { computed, onUnmounted, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { getAppDetail } from '@/api/modules/app'
import { aiWriteSample } from '@/api/mock/data'
import { inputValue } from '@/utils/event'
import type { AppDetail } from '@/api/types'

const APP_UUID = 'app-ecommerce-suite'

const detail = ref<AppDetail | null>(null)
const loading = ref(true)
const values = ref<Record<string, unknown>>({})

const showWrite = ref(false)
const writing = ref(false)
const writeText = ref('')
/** 帮写 mock 定时器句柄，卸载/重开时清理，避免多个 timer 叠跑 */
let writeTimer: ReturnType<typeof setTimeout> | null = null
/** 提交锁：navigateTo 有动画间隙，连点会压多个结果页、各发一次计费任务 */
const submitting = ref(false)

const fields = computed(() => detail.value?.appSchema.fields || [])
/** 图片字段（system 域，maxCount 来自 input_image） */
const imageField = computed(() => fields.value.find((f) => f.type === 'image') || null)
/** 生成设置：schema 里的 select 字段，按原型渲染成设置行 */
const selectFields = computed(() => fields.value.filter((f) => f.type === 'select'))
/** 商品信息：唯一的 textarea 字段 */
const textField = computed(() => fields.value.find((f) => f.type === 'textarea') || null)

const images = computed(() =>
  imageField.value && Array.isArray(values.value[imageField.value.id])
    ? (values.value[imageField.value.id] as string[])
    : [],
)
const maxImages = computed(() => imageField.value?.maxCount || 3)
const price = computed(() => detail.value?.app.price || 0)

onLoad(async (query) => {
  const preset = query?.prompt ? decodeURIComponent(String(query.prompt)) : ''
  // 首页带过来的已选图（JSON 数组）。解析失败不能让整页崩，兜底空数组
  let presetImages: string[] = []
  if (query?.images) {
    try {
      const parsed = JSON.parse(decodeURIComponent(String(query.images)))
      if (Array.isArray(parsed)) presetImages = parsed.filter((p) => typeof p === 'string')
    } catch {
      presetImages = []
    }
  }

  const data = await getAppDetail(APP_UUID)
  detail.value = data
  loading.value = false
  if (!data) return

  const initial: Record<string, unknown> = {}
  data.appSchema.fields.forEach((field) => {
    if (field.type === 'image' || field.type === 'card-multi-select') initial[field.id] = []
    else initial[field.id] = field.default ?? ''
  })
  // 首页「一句话生成」带过来的描述落到商品信息
  const text = data.appSchema.fields.find((f) => f.type === 'textarea')
  if (preset && text) initial[text.id] = preset
  // 已选图回填到图片字段（按 maxCount 截断）
  const image = data.appSchema.fields.find((f) => f.type === 'image')
  if (presetImages.length && image) {
    initial[image.id] = presetImages.slice(0, image.maxCount || 1)
  }
  values.value = initial
})

function setValue(id: string, value: unknown) {
  values.value = { ...values.value, [id]: value }
}

function pickImage() {
  const remain = maxImages.value - images.value.length
  if (!imageField.value || remain <= 0) return
  uni.chooseImage({
    count: remain,
    sizeType: ['compressed'],
    success: (res) => {
      const paths = (res.tempFilePaths as string[]) || []
      setValue(imageField.value!.id, [...images.value, ...paths].slice(0, maxImages.value))
    },
  })
}

function removeImage(index: number) {
  if (!imageField.value) return
  const next = images.value.slice()
  next.splice(index, 1)
  setValue(imageField.value.id, next)
}

function previewImage(index: number) {
  uni.previewImage({ urls: images.value, current: images.value[index] })
}

function openWrite() {
  if (!images.value.length) {
    uni.showToast({ title: '请先上传商品图', icon: 'none' })
    return
  }
  showWrite.value = true
  if (!writeText.value) startWrite()
}

/**
 * TODO(api)：帮写走 §4.5 的 optimizeImage（图转文），后端未提供电商套图的 field 约定，
 * 这里先用 mock 文案演示 loading → 结果 → 采用 的完整链路。
 */
function startWrite() {
  // 先清旧 timer：loading 中关弹层再开会走到这里，不清会叠两个 timer
  if (writeTimer) clearTimeout(writeTimer)
  writing.value = true
  writeText.value = ''
  writeTimer = setTimeout(() => {
    writeText.value = aiWriteSample
    writing.value = false
    writeTimer = null
  }, 2000)
}

function applyWrite(text: string) {
  if (textField.value) setValue(textField.value.id, text)
  showWrite.value = false
}

function onSubmit() {
  if (submitting.value) return
  if (!images.value.length) {
    uni.showToast({ title: '请先上传商品图', icon: 'none' })
    return
  }
  submitting.value = true
  // 显式带上图片字段 id：结果页据此上传，而非「凡数组就当图路径」——
  // 否则 schema 一旦有 card-multi-select（值也是 string[]），选项值会被当本地文件上传必失败
  const imageKeys = fields.value.filter((f) => f.type === 'image').map((f) => f.id)
  // 表单交给结果页发起任务，结果页即对话流（原型 fcb2…jpg）
  uni.navigateTo({
    url: `/pages-sub/suite-result/suite-result?payload=${encodeURIComponent(
      JSON.stringify({ uuid: APP_UUID, values: values.value, imageKeys }),
    )}`,
    // 无论成功失败都解锁：失败要能重试，成功后返回本页也要能再次提交
    complete: () => {
      submitting.value = false
    },
  })
}

onUnmounted(() => {
  if (writeTimer) clearTimeout(writeTimer)
})

function onHelp() {
  uni.showToast({ title: '示例即将上线', icon: 'none' })
}
</script>

<template>
  <view class="suite">
    <nav-bar title="商品套图" :bg-color="'#f7f8fc'" :transparent="false">
      <template #right>
        <view class="suite__help" @tap="onHelp">
          <ui-icon name="question" :size="38" color="#16161a" />
        </view>
      </template>
    </nav-bar>

    <scroll-view class="suite__body" scroll-y :show-scrollbar="false">
      <form-section
        v-if="imageField"
        class="suite__card"
        title="上传商品图"
        icon="image"
        tail-icon="question"
        @tail="onHelp"
      >
        <view class="suite__tiles">
          <view
            v-for="(img, i) in images"
            :key="`${img}-${i}`"
            class="suite__tile"
            @tap="previewImage(i)"
          >
            <image class="suite__tile-img" :src="img" mode="aspectFill" />
            <view class="suite__tile-del" @tap.stop="removeImage(i)">
              <ui-icon name="close" :size="20" color="#ffffff" />
            </view>
          </view>
          <view v-if="images.length < maxImages" class="suite__tile suite__tile--add" @tap="pickImage">
            <ui-icon name="plus" :size="40" color="#9a9aa5" />
          </view>
        </view>
      </form-section>

      <form-section v-if="selectFields.length" class="suite__card" title="生成设置" icon="setting">
        <setting-row
          v-for="(field, i) in selectFields"
          :key="field.id"
          :label="field.label"
          :options="field.options || []"
          :divider="i < selectFields.length - 1"
          :model-value="String(values[field.id] ?? '')"
          @update:model-value="setValue(field.id, $event)"
        />
      </form-section>

      <!--
        TODO(design)：原型此处被 AI 帮写弹层遮住，商品信息卡形态按现有设计语言补齐；
        「AI 帮写」是弹层的唯一入口，原型里没拍到触点。
      -->
      <form-section v-if="textField" class="suite__card" title="商品信息" icon="text">
        <textarea
          class="suite__text"
          :value="String(values[textField.id] ?? '')"
          :placeholder="textField.placeholder || '品名、核心卖点、目标受众、使用场景'"
          placeholder-class="suite__ph"
          :maxlength="textField.maxlength || 500"
          :show-confirm-bar="false"
          @input="setValue(textField.id, inputValue($event))"
        />
        <view v-if="textField.optimize" class="suite__write" @tap="openWrite">
          <ui-icon name="ai-image" :size="26" color="#5f5ffd" />
          <text class="suite__write-text">AI 帮写</text>
        </view>
      </form-section>

      <view class="suite__safe" />
    </scroll-view>

    <view class="suite__foot">
      <view class="suite__submit" @tap="onSubmit">
        <text class="suite__submit-text">立即生成</text>
        <view v-if="price" class="suite__submit-price">
          <ui-icon name="bean" :size="24" color="#ffffff" />
          <text class="suite__submit-price-text">{{ price }}</text>
        </view>
      </view>
    </view>

    <ai-write-sheet
      v-model="showWrite"
      :text="writeText"
      :loading="writing"
      @write="startWrite"
      @apply="applyWrite"
    />
  </view>
</template>

<style lang="scss" scoped>
.suite {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: $bg-page;

  &__help {
    display: flex;
    align-items: center;
  }

  &__body {
    flex: 1;
    min-height: 0;
  }

  /*
   * 卡 x49–1210 ⇒ 左右内缩 49px ≈ 29rpx。这里不能用 $gap-page(32rpx)：
   * 实测卡左会落在 x54，比原型偏右 5 设计px，超出 2px 容差。
   * 卡间距 29px ≈ 17rpx。
   */
  &__card {
    /*
     * display:block 必须写：小程序自定义组件的宿主节点默认 display:inline，
     * 实测宿主盒是 0×17px，margin 挂在零宽行内盒上完全不生效，
     * 内部块级 .fsec 会脱离宿主按 scroll-view 满宽排（量到 left 0 / 宽 1261 设计px）。
     * H5 是同一棵 DOM，没有宿主节点这层，所以这个问题只在小程序端暴露。
     */
    display: block;
    margin: 0 29rpx 17rpx;
  }

  /* 上传瓦片 193×193px ≈ 115rpx，间距 29px ≈ 17rpx */
  &__tiles {
    display: flex;
    flex-wrap: wrap;
    gap: 17rpx;
    /* 头部 ink 底 → 瓦片顶实测 59px；26rpx 时浏览器量到 50px，故 +5rpx 补足 */
    margin-top: 31rpx;
  }

  &__tile {
    position: relative;
    width: 115rpx;
    height: 115rpx;
    border-radius: $radius-thumb;

    &--add {
      background: $bg-fill;
      border: 1px dashed #d6d6e0;
      display: flex;
      align-items: center;
      justify-content: center;
    }
  }

  &__tile-img {
    width: 100%;
    height: 100%;
    border-radius: $radius-thumb;
  }

  &__tile-del {
    position: absolute;
    top: -8rpx;
    right: -8rpx;
    width: 30rpx;
    height: 30rpx;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  &__text {
    width: 100%;
    min-height: 180rpx;
    margin-top: 26rpx;
    font-size: $fs-body;
    line-height: 1.64;
    color: $ink;
  }

  &__ph {
    color: $ink-3;
  }

  &__write {
    align-self: flex-start;
    height: 60rpx;
    margin-top: 8rpx;
    padding: 0 22rpx;
    border-radius: $radius-btn;
    background: $brand-light;
    display: flex;
    align-items: center;
    gap: 8rpx;
  }

  &__write-text {
    font-size: $fs-aux;
    color: $brand;
    font-weight: 600;
  }

  &__safe {
    height: 40rpx;
  }

  &__foot {
    padding: 16rpx $gap-page calc(20rpx + env(safe-area-inset-bottom));
    background: $bg-page;
  }

  /* 与弹层按钮同规格：683×100rpx */
  &__submit {
    height: 100rpx;
    border-radius: $radius-btn;
    background: $brand;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12rpx;
  }

  &__submit-text {
    font-size: $fs-title;
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
</style>
