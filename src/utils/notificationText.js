/**
 * 卡片文案的纯函数工具。
 *
 * 抽出来单独放一个文件（而不是写在 NotificationCard.vue 的 computed 里）的理由：
 * 卡片第三行的文案规则是**有分支的判断**，需要在构建之外被断言；
 * 纯函数可以直接 import 进检查脚本，不依赖组件渲染。
 */

/**
 * 归一化 location：
 *   null / undefined / 非字符串 / 纯空白 → ''（表示「这条通知没有地点」）
 * 其余情况去掉首尾空白，内部连续空白压成一个空格。
 * @param {unknown} location
 * @returns {string}
 */
export function normalizeLocation(location) {
  if (location === null || location === undefined) return ''
  const text = String(location).replace(/\s+/g, ' ').trim()
  return text
}

/**
 * 卡片第三行文案（整行单行省略，由 CSS 负责截断）：
 *   - 有 location：群名 · 地点 · 发布者
 *   - 没有 location：群名 · 发布者（保持原样，**不**显示「地点未知」之类的占位）
 *
 * @param {object} notification
 * @returns {string}
 */
export function buildCardMetaText(notification) {
  const n = notification || {}
  const group = n.group_name || n.group_id || '未知群'
  const sender = n.sender_name || n.sender_id || '未知发布者'
  const location = normalizeLocation(n.location)
  return location ? `${group} · ${location} · ${sender}` : `${group} · ${sender}`
}
