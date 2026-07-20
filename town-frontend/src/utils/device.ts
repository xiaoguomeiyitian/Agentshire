/**
 * device.ts — 设备类型检测工具。
 *
 * 用于区分触屏设备(移动端)与桌面设备(PC 端),决定是否启用虚拟摇杆、
 * 是否保留点击空地行走等双端差异化行为。
 */

/** 是否为触屏设备(移动端)。 */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false
  return (
    navigator.maxTouchPoints > 0 ||
    'ontouchstart' in window ||
    // 部分桌面浏览器(如带触摸屏的笔记本)也支持 touch,但只要同时具备
    // 精细指针且 maxTouchPoints===0 才视为纯桌面。这里保守判定:
    // 有触摸点即视为触屏设备,启用摇杆。
    (window.matchMedia?.('(pointer: coarse)')?.matches ?? false)
  )
}

/** 是否为桌面设备(PC 端,非触屏)。 */
export function isDesktop(): boolean {
  return !isTouchDevice()
}
