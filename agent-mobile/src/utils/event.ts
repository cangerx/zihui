/**
 * uni-app 表单事件取值
 * 小程序事件是 { detail: { value } }，而 TS 里模板事件签名是 DOM Event，
 * 直接标注参数类型会冲突，统一走这里取值。
 */
export function inputValue(e: Event): string {
  const detail = (e as unknown as { detail?: { value?: unknown } }).detail
  return detail?.value === undefined ? '' : String(detail.value)
}

/** picker / swiper 的 current 取值 */
export function currentIndex(e: Event): number {
  const detail = (e as unknown as { detail?: { current?: unknown; value?: unknown } }).detail
  const raw = detail?.current ?? detail?.value
  return Number(raw) || 0
}
