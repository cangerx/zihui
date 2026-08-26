/**
 * 系统信息：状态栏 / 胶囊按钮避让，自定义导航栏用
 */
interface NavMetrics {
  statusBarHeight: number
  /** 导航栏内容高度（不含状态栏） */
  navBarHeight: number
  /** 状态栏 + 导航栏 */
  navTotalHeight: number
  /** 右侧需避让的宽度（小程序胶囊） */
  capsuleRight: number
  screenWidth: number
  safeAreaBottom: number
}

let cache: NavMetrics | null = null

export function getNavMetrics(): NavMetrics {
  if (cache) return cache

  const info = uni.getWindowInfo ? uni.getWindowInfo() : uni.getSystemInfoSync()
  const statusBarHeight = info.statusBarHeight || 0
  const screenWidth = info.screenWidth || 375
  const safeAreaBottom = Math.max(
    (info.screenHeight || 0) - ((info.safeArea?.bottom as number) || info.screenHeight || 0),
    0,
  )

  let navBarHeight = 44
  let capsuleRight = 0

  // #ifdef MP-WEIXIN
  const capsule = uni.getMenuButtonBoundingClientRect?.()
  if (capsule && capsule.height) {
    navBarHeight = (capsule.top - statusBarHeight) * 2 + capsule.height
    capsuleRight = screenWidth - capsule.left
  }
  // #endif

  cache = {
    statusBarHeight,
    navBarHeight,
    navTotalHeight: statusBarHeight + navBarHeight,
    capsuleRight,
    screenWidth,
    safeAreaBottom,
  }
  return cache
}

/** px → rpx（750 设计基准） */
export function pxToRpx(px: number): number {
  const { screenWidth } = getNavMetrics()
  return (px * 750) / screenWidth
}
