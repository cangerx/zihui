import { ref, computed, onBeforeUnmount, type Ref, type ComputedRef } from 'vue'

/** 函数 ref 形态：绑定到模板元素的 :ref，挂载时传入元素、卸载时传入 null */
export type SentinelRef = (el: Element | null) => void

/**
 * 「随机排序 + 无限滚动」复用逻辑（灵感广场 / 创意模板云端广场共用）。
 *
 * - setItems：传入全量数据，内部用 Fisher-Yates 重新随机洗牌，并把展示数量重置为 initial。
 *   每次重新加载页面 / 切换分类 / 搜索时调用，即可实现「每次刷新重新随机」。
 * - items：当前应展示的切片（前 limit 个），瀑布流按此渲染。
 * - sentinel：绑定到列表底部的哨兵元素，进入视口时自动加载下一批（step 个）。
 */
export interface RandomInfiniteFeed<T> {
  /** 当前展示的切片（已随机排序，前 limit 个） */
  items: ComputedRef<T[]>
  /** 随机后的全量条数 */
  total: ComputedRef<number>
  /** 是否还有未展示的数据 */
  hasMore: ComputedRef<boolean>
  /** 重新设置全量数据：洗牌并把展示数量重置为 initial */
  setItems: (list: T[]) => void
  /** 保持源顺序设置（不洗牌）：搜索/分类等检索场景用，保证结果可复现 */
  setItemsOrdered: (list: T[]) => void
  /** 手动「换一批」：重新洗牌（用户主动要新鲜感时才随机） */
  reshuffle: () => void
  /** 手动加载下一批 */
  loadMore: () => void
  /** 绑定到底部哨兵元素的函数 ref（模板里 :ref="setSentinel"） */
  setSentinel: SentinelRef
}

/** Fisher-Yates 洗牌，返回新数组，不改动入参 */
function shuffle<T>(list: T[]): T[] {
  const arr = list.slice()
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

export function useRandomInfiniteFeed<T>(options?: {
  /** 首屏加载数量，默认 25 */
  initial?: number
  /** 每次下拉追加数量，默认 20 */
  step?: number
}): RandomInfiniteFeed<T> {
  const initial = options?.initial ?? 25
  const step = options?.step ?? 20

  // 随机后的全量；展示切片由 limit 控制
  const pool = ref<T[]>([]) as Ref<T[]>
  const limit = ref(initial)

  const items = computed(() => pool.value.slice(0, limit.value))
  const total = computed(() => pool.value.length)
  const hasMore = computed(() => limit.value < pool.value.length)

  function setItems(list: T[]): void {
    pool.value = shuffle(list)
    limit.value = initial
  }

  function setItemsOrdered(list: T[]): void {
    pool.value = list.slice()
    limit.value = initial
  }

  function reshuffle(): void {
    pool.value = shuffle(pool.value)
    limit.value = initial
  }

  function loadMore(): void {
    if (limit.value < pool.value.length) {
      limit.value = Math.min(limit.value + step, pool.value.length)
    }
  }

  // 底部哨兵进入视口即加载下一批；rootMargin 预留 300px 提前触发，滚动更顺滑。
  // 用函数 ref：哨兵随 v-if 出现/消失时自动重建 / 断开 observer。
  let observer: IntersectionObserver | null = null

  const setSentinel: SentinelRef = (el) => {
    observer?.disconnect()
    observer = null
    if (!el) return
    observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore()
      },
      { rootMargin: '300px' }
    )
    observer.observe(el)
  }

  onBeforeUnmount(() => {
    observer?.disconnect()
    observer = null
  })

  return { items, total, hasMore, setItems, setItemsOrdered, reshuffle, loadMore, setSentinel }
}
