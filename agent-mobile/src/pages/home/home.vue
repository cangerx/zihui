<script setup lang="ts">
/**
 * 首页：三态（默认 / 分类选中 / 键盘输入）
 * 对照 原型图/首页.jpg、0d2c…、0fda…、972f…、f621…、433404…
 * 动效清单：#1 3D轮播 #2 态切换 #3 输入卡展开收起 #4 键盘吸附 #5 chips选中 #8 入口翻页
 */
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { getNavMetrics } from '@/utils/system'
import { useMemberStore } from '@/store/member'
import { USE_MOCK } from '@/api/config'
import { AI_IMAGE_APP_ID } from '@/api/catalog'
import {
  getHomeDiscovery,
  getTemplatePage,
  type DiscoveryHomeCategory,
  type DiscoveryHomeEntry,
  type DiscoveryHomeShowcase,
  type DiscoveryTemplateItem,
} from '@/api/modules/discovery'

const metrics = getNavMetrics()
const member = useMemberStore()

/** 当前分类；空串 = 默认态（状态 A） */
const activeCategory = ref('')
/** 输入卡是否处于键盘输入态（状态 C） */
const typing = ref(false)

const prompt = ref('')
const images = ref<string[]>([])

const recommendTab = ref(0)
const showAssets = ref(false)
const showPromo = ref(false)
const categories = ref<DiscoveryHomeCategory[]>([])
const entries = ref<DiscoveryHomeEntry[]>([])
const recommendTabs = ref<string[]>([])
const showcasesByCategory = ref<Record<string, DiscoveryHomeShowcase[]>>({})
const templates = ref<DiscoveryTemplateItem[]>([])
const page = ref(1)
const loading = ref(false)
const hasMore = ref(true)

/** 分类态（状态 B）：有选中分类且该类有案例图 → 展示 3D coverflow 轮播 */
const showcases = computed<DiscoveryHomeShowcase[]>(
  () => showcasesByCategory.value[activeCategory.value] || [],
)
const isCategoryMode = computed(
  () => Boolean(activeCategory.value) && showcases.value.length > 0,
)
const imageEnabled = computed(() =>
  entries.value.some((entry) => entry.appUuid === AI_IMAGE_APP_ID),
)

/** 头部内容整体下移：让出状态栏 */
const headStyle = computed(() => `padding-top:${metrics.statusBarHeight + 8}px`)

onLoad(async () => {
  const discovery = await getHomeDiscovery()
  categories.value = discovery.categories
  entries.value = discovery.entries
  recommendTabs.value = discovery.recommendTabs
  showcasesByCategory.value = discovery.showcases
  await loadTemplates(true)
})

// 1.1 元限时福利：非会员每次冷启动弹一次
onShow(() => {
  if (USE_MOCK && member.level === 'none' && !member.promoShown) {
    setTimeout(() => {
      showPromo.value = true
      member.markPromoShown()
    }, 1200)
  }
})

async function loadTemplates(reset = false) {
  if (loading.value) return
  if (!reset && !hasMore.value) return
  loading.value = true
  if (reset) {
    page.value = 1
    hasMore.value = true
  }
  try {
    const result = await getTemplatePage({ page: page.value, size: 10 })
    templates.value = reset ? result.items : templates.value.concat(result.items)
    hasMore.value = result.hasMore
    page.value += 1
  } catch {
    templates.value = reset ? [] : templates.value
    hasMore.value = false
  } finally {
    loading.value = false
  }
}

/** 选分类 → 状态 B：页面上出现 3D 案例卡轮播（对照 原型图/972f…jpg） */
function onCategoryChange(key: string) {
  activeCategory.value = key
}

function collapse() {
  activeCategory.value = ''
}

function onSend() {
  if (!prompt.value.trim() && !images.value.length) return
  if (!USE_MOCK) {
    if (!imageEnabled.value) {
      uni.showToast({ title: 'AI 生图功能暂未开放', icon: 'none' })
      return
    }
    if (images.value.length) {
      uni.showToast({ title: '参考图功能尚未开放，请先使用文字描述', icon: 'none' })
      return
    }
    uni.navigateTo({
      url: `/pages-sub/tool-run/tool-run?uuid=${AI_IMAGE_APP_ID}&prompt=${encodeURIComponent(prompt.value)}`,
    })
    return
  }
  // 一句话生成：prompt 落到「商品信息」，已选图（含案例卡回填的参考图）一并带过去，
  // 否则 suite-run 会因无图被「请先上传商品图」拦住，回填就白做了
  const query = [`prompt=${encodeURIComponent(prompt.value)}`]
  if (images.value.length) {
    query.push(`images=${encodeURIComponent(JSON.stringify(images.value))}`)
  }
  uni.navigateTo({ url: `/pages-sub/suite-run/suite-run?${query.join('&')}` })
}

function onEntryTap(item: DiscoveryHomeEntry) {
  if (!USE_MOCK && item.appUuid !== AI_IMAGE_APP_ID) {
    uni.showToast({ title: '该功能尚未开放', icon: 'none' })
    return
  }
  if (item.target === 'canvas') {
    uni.navigateTo({ url: '/pages-sub/canvas-create/canvas-create' })
    return
  }
  if (item.target === 'ai-image') {
    uni.navigateTo({ url: `/pages-sub/tool-run/tool-run?uuid=${AI_IMAGE_APP_ID}` })
    return
  }
  if (item.target === 'suite') {
    uni.navigateTo({ url: '/pages-sub/suite-run/suite-run' })
    return
  }
  if (item.target === 'intro') {
    uni.navigateTo({ url: `/pages-sub/tool-intro/tool-intro?uuid=${item.appUuid || ''}` })
    return
  }
  uni.navigateTo({ url: `/pages-sub/tool-run/tool-run?uuid=${item.appUuid || ''}` })
}

/**
 * 点案例卡 → 把该卡的配方回填进 AI 输入卡（对照 原型图/0d2c…jpg）：
 * 3 张参考图缩略图 + 一段完整生成描述，轮播随之收起。
 */
function onShowcaseTap(item: DiscoveryHomeShowcase) {
  images.value = (item.refs || [item.cover]).slice(0, 3)
  prompt.value = item.prompt || item.title
  // 回填后收起轮播，把注意力交给输入卡
  activeCategory.value = ''
}

function onTemplateTap(item: DiscoveryTemplateItem) {
  if (!USE_MOCK) return
  uni.navigateTo({ url: `/pages-sub/tool-run/tool-run?template=${item.id}` })
}

function goTemplate() {
  uni.switchTab({ url: '/pages/template/template' })
}

function goTutorial() {
  uni.showToast({ title: '教程即将上线', icon: 'none' })
}

/** 资产库选图后回填到输入卡 */
function onAssetPick(url: string) {
  images.value = [...images.value, url]
}

function openAssets() {
  if (!USE_MOCK) {
    uni.showToast({ title: '素材库功能尚未开放', icon: 'none' })
    return
  }
  showAssets.value = true
}
</script>

<template>
  <view class="home">
    <view class="home__bg" />

    <scroll-view
      class="home__scroll"
      scroll-y
      :show-scrollbar="false"
      @scrolltolower="loadTemplates(false)"
    >
      <view class="home__top" :style="headStyle">
        <view class="home__round" @tap="goTemplate">
          <ui-icon name="search" :size="36" color="#333333" />
        </view>
        <!-- 原型是与左侧等大的圆钮 + 方框对角箭头图标，不是「教程」文字胶囊 -->
        <view class="home__round" @tap="goTutorial">
          <ui-icon name="expand" :size="34" color="#333333" />
        </view>
      </view>

      <!--
        大标题常驻。状态 C（键盘弹起）时不能用 v-if 卸载：
        原型是页面整体被键盘顶上去、标题滚出视口，卸载 DOM 会造成布局跳变。
        状态 B 则按 docs §2.1「标题区被替换为案例卡轮播」淡出并压平高度，
        实测 972f 在标题行位置（y 370–435）无任何墨色像素，确认是隐藏而非保留。
      -->
      <view
        class="home__hero"
        :class="{ 'home__hero--up': typing, 'home__hero--hide': isCategoryMode }"
      >
        <text class="home__hero-line">AI团队- 让商业设计 好看又见效</text>
      </view>

      <!--
        状态 B：案例卡轮播占据原标题区，位置在 chips **上方**
        （实测 972f：卡片 y 488–1291、chips y 1436–1545）
      -->
      <view v-if="isCategoryMode" class="home__showcase">
        <cover-swiper :items="showcases" @pick="onShowcaseTap" />
      </view>

      <view class="home__chips">
        <category-chips
          v-if="categories.length"
          :items="categories"
          :model-value="activeCategory"
          show-grid
          @update:model-value="onCategoryChange"
          @grid="goTemplate"
        />
      </view>

      <view v-if="USE_MOCK || imageEnabled" class="home__input">
        <!--
          collapsible 关闭：docs §2.1 称状态 B「下方出现收起∧按钮」，
          但 972f 与 0d2c 两态的输入卡头部右侧均未测到该按钮（字形数为 0）。
        -->
        <ai-input-card
          v-model="prompt"
          v-model:images="images"
          @send="onSend"
          @collapse="collapse"
          @material="openAssets"
          @template="goTemplate"
          @focus="typing = true"
          @blur="typing = false"
        />
      </view>

      <view v-if="entries.length" class="home__entries">
        <entry-grid :items="entries" @pick="onEntryTap" />
      </view>

      <view v-if="USE_MOCK && entries.length" class="home__banner" @tap="onEntryTap(entries[0])">
        <view class="home__banner-text">
          <text class="home__banner-title">{{ entries[0]?.name || 'AI 生图' }}</text>
          <text class="home__banner-sub">一句话生成全套主图 · 多平台规范适配</text>
        </view>
        <view class="home__banner-btn">
          <text class="home__banner-btn-text">立即体验</text>
        </view>
      </view>

      <view class="home__recommend">
        <view class="home__rec-head">
          <tab-underline v-if="recommendTabs.length" v-model="recommendTab" :items="recommendTabs" class="home__rec-tabs" />
          <view class="home__rec-more" @tap="goTemplate">
            <ui-icon name="arrow" :size="28" color="#999999" />
          </view>
        </view>
        <template-waterfall
          :items="templates"
          :loading="loading"
          :has-more="hasMore"
          @pick="onTemplateTap"
        />
        <view v-if="!loading && !templates.length" class="home__recommend-empty">
          <text class="home__recommend-empty-text">
            {{ USE_MOCK ? '暂无推荐内容' : '推荐内容尚未开放' }}
          </text>
        </view>
      </view>

      <view class="home__safe" />
    </scroll-view>

    <asset-sheet v-if="USE_MOCK" v-model="showAssets" @pick="onAssetPick" />
    <vip-promo v-if="USE_MOCK" v-model="showPromo" />
  </view>
</template>

<style lang="scss" scoped>
.home {
  position: relative;
  height: 100vh;
  overflow: hidden;

  /*
   * 实测 y≈625 收白 → 372rpx（此前 440rpx 偏低）。
   * 原型渐变还带水平分量：顶部左 (215,215,253) 淡紫 → 右 (214,240,255) 天蓝，
   * 所以纵向透明渐变叠在横向色相渐变之上。
   */
  &__bg {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 372rpx;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0) 0%, $grad-home-bottom 100%),
      linear-gradient(90deg, $grad-home-top 0%, #d6f0ff 100%);
  }

  &__scroll {
    position: relative;
    height: 100%;
  }

  &__top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 $gap-page 8rpx;
  }

  /* 实测圆钮 108×108px ≈ 64rpx（此前 72rpx 偏大） */
  &__round {
    width: 64rpx;
    height: 64rpx;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;

    &--text {
      width: auto;
      padding: 0 26rpx;
      border-radius: $radius-btn;
    }
  }

  &__round-text {
    font-size: $fs-aux;
    color: #333333;
  }

  /*
   * 原型标题为单行、居中。实测墨色 x 142–1115（宽 974px，页面正中）、y 370–435，
   * 按「AI团队- 让商业设计 好看又见效」的中西文混排折算字号 ≈ 42rpx（$fs-hero），
   * 此前写死 48rpx 偏大一号。高度写定 110rpx 以便状态 B 压平时可过渡。
   */
  &__hero {
    height: 110rpx;
    box-sizing: border-box;
    padding: 46rpx $gap-page 8rpx;
    overflow: hidden;
    transition: transform $dur-base $ease-base, opacity $dur-base $ease-base,
      height $dur-base $ease-base, padding $dur-base $ease-base;

    &--up {
      transform: translateY(-40rpx);
      opacity: 0;
    }

    &--hide {
      height: 0;
      padding-top: 0;
      padding-bottom: 0;
      opacity: 0;
    }
  }

  &__hero-line {
    display: block;
    font-size: $fs-hero;
    line-height: 1.34;
    font-weight: 700;
    color: $ink;
    text-align: center;
  }

  /* 实测标题块底 ≈y462 → chips 顶 y555，间距 93px ≈ 56rpx */
  &__chips {
    margin-top: 56rpx;
  }

  /*
   * 状态 B：卡片顶 y488 → chips 顶 y1436，以中间卡顶为锚点实测应相距 948px ≈ 564rpx。
   * 轮播内中间卡下移 14rpx、容器高 510rpx ⇒ 卡顶到轮播底 496rpx，故需 68rpx 间隙。
   * 注意：这里与 &__chips 的 margin-top(56rpx) 会**外边距合并**，取两者较大值，
   *      所以必须写 68rpx 才生效——写 24rpx 会被 56rpx 吃掉、量出来仍是 552rpx。
   */
  &__showcase {
    margin-top: 112rpx;
    margin-bottom: 68rpx;
    animation: home-slide-up $dur-base $ease-base;
  }

  /* 实测 chips 底 y662 → 输入卡顶 y700，间距 38px ≈ 22rpx */
  &__input {
    padding: 22rpx $gap-page 0;
  }

  &__entries {
    margin-top: 32rpx;
  }

  /*
   * 实测高 234px ≈ 139rpx；底色为青 (235,255,254) → 浅蓝 (182,229,255) 纵向渐变。
   * TODO(design)：原型该区疑似「左文右图」内容卡（右侧采到实拍照片像素），
   * 现暂保留文字 + 按钮结构，形态待设计确认。
   */
  &__banner {
    margin: 8rpx $gap-page 0;
    height: 139rpx;
    border-radius: $radius-card;
    padding: 0 $gap-card;
    background: linear-gradient(180deg, #ebfffe, #b6e5ff);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__banner-text {
    flex: 1;
    min-width: 0;
  }

  &__banner-title {
    display: block;
    font-size: $fs-title;
    font-weight: 700;
    color: $ink;
  }

  &__banner-sub {
    display: block;
    margin-top: 8rpx;
    font-size: $fs-aux;
    color: $ink-2;
  }

  &__banner-btn {
    height: 60rpx;
    padding: 0 26rpx;
    border-radius: $radius-btn;
    background: $ink;
    display: flex;
    align-items: center;
  }

  &__banner-btn-text {
    font-size: $fs-aux;
    color: #ffffff;
  }

  &__recommend {
    margin-top: 32rpx;
  }

  &__recommend-empty {
    min-height: 180rpx;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  &__recommend-empty-text {
    font-size: $fs-aux;
    color: $ink-3;
  }

  &__rec-head {
    display: flex;
    align-items: center;
    padding: 0 $gap-page;
  }

  &__rec-tabs {
    flex: 1;
    min-width: 0;
  }

  &__rec-more {
    width: 48rpx;
    display: flex;
    justify-content: flex-end;
  }

  &__safe {
    height: 40rpx;
  }
}

@keyframes home-slide-up {
  from {
    opacity: 0;
    transform: translateY(40rpx);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

</style>
