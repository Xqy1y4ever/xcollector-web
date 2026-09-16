/**
 * 时间格式化工具 —— 项目里所有时间展示都必须走这里。
 *
 * 约定（来自 API 契约）：
 *  - 后端所有时间戳都是**毫秒 int**（server_time / due_at / source_ts / created_at / updated_at / last_event_at ...）
 *  - due_at 为 null 表示「没解析出确定时间」，此时绝不能显示当前时间，必须显示 due_text 原文 + 「待确认」
 */

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** 把任意输入安全地转成毫秒时间戳；非法值返回 null（不抛异常） */
export function toMillis(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    // 兼容秒级时间戳（< 1e12 视为秒）
    return value < 1e12 ? Math.round(value * 1000) : Math.round(value)
  }
  if (value instanceof Date) {
    const t = value.getTime()
    return Number.isFinite(t) ? t : null
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    if (/^\d+$/.test(trimmed)) return toMillis(Number(trimmed))
    const parsed = Date.parse(trimmed)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/** 转 Date 对象；非法值返回 null */
export function toDate(value) {
  const ms = toMillis(value)
  return ms === null ? null : new Date(ms)
}

const pad2 = (n) => String(n).padStart(2, '0')

/**
 * 标准时间格式：2025-09-12 23:59
 * @param {number|string|Date} value
 * @param {{ withYear?: boolean, withSeconds?: boolean, fallback?: string }} [opts]
 */
export function formatDateTime(value, opts = {}) {
  const { withYear = true, withSeconds = false, fallback = '—' } = opts
  const d = toDate(value)
  if (!d) return fallback
  const datePart = withYear
    ? `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
    : `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
  const timePart = withSeconds
    ? `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
    : `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  return `${datePart} ${timePart}`
}

/** 只要日期：2025-09-12 */
export function formatDate(value, opts = {}) {
  const { withYear = true, fallback = '—' } = opts
  const d = toDate(value)
  if (!d) return fallback
  return withYear
    ? `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
    : `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** 只要时间：23:59 */
export function formatTime(value, opts = {}) {
  const { withSeconds = false, fallback = '—' } = opts
  const d = toDate(value)
  if (!d) return fallback
  return withSeconds
    ? `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
    : `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** 星期：周五 */
export function formatWeekday(value, fallback = '') {
  const d = toDate(value)
  if (!d) return fallback
  return WEEKDAYS[d.getDay()]
}

/** DDL 主显示：09-12 周五 23:59（卡片左侧的大号时间） */
export function formatDueAt(value, fallback = '待确认') {
  const d = toDate(value)
  if (!d) return fallback
  return `${formatDate(d, { withYear: false })} ${formatWeekday(d)} ${formatTime(d)}`
}

/** 到日粒度：2025-09-12 周五 */
export function formatDayWithWeekday(value, fallback = '—') {
  const d = toDate(value)
  if (!d) return fallback
  return `${formatDate(d)} ${formatWeekday(d)}`
}

/** 本机时区下的当天 00:00（毫秒） */
export function startOfDay(value = Date.now()) {
  const d = toDate(value) || new Date()
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0)
  return copy.getTime()
}

/** 判断两个时间戳是否同一天 */
export function isSameDay(a, b) {
  const da = toDate(a)
  const db = toDate(b)
  if (!da || !db) return false
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  )
}

/** 某天 23:59:59.999（毫秒），用于「本周」的右边界 */
export function endOfDay(value = Date.now()) {
  return startOfDay(value) + 24 * 3600 * 1000 - 1
}

/**
 * 本周日 23:59:59.999（毫秒）。
 * 采用「周一为一周开始」的中文习惯。
 */
export function endOfWeek(value = Date.now()) {
  const d = toDate(value) || new Date()
  const day = d.getDay() // 0=周日
  const daysUntilSunday = day === 0 ? 0 : 7 - day
  const sunday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + daysUntilSunday, 23, 59, 59, 999)
  return sunday.getTime()
}

/** 距离某个时间点还剩多久 / 已过多久；null 输入返回空串 */
export function relativeToNow(value, now = Date.now()) {
  const ms = toMillis(value)
  const base = toMillis(now)
  if (ms === null || base === null) return ''
  return formatDuration(ms - base)
}

/**
 * 把「毫秒差」写成中文相对时间。
 * 正数 = 未来（还剩X）／负数 = 过去（已过X）。
 * @param {number} diffMs
 * @param {{ signed?: boolean }} [opts] signed=true 时带「还剩 / 已过 / 已过期」前缀
 */
export function formatDuration(diffMs, opts = {}) {
  const { signed = false } = opts
  if (!Number.isFinite(diffMs)) return ''
  const abs = Math.abs(diffMs)
  const future = diffMs > 0

  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  let text
  if (abs < 45 * 1000) {
    text = future ? '不到 1 分钟' : '刚刚'
    if (!future) return signed ? '已过 1 分钟内' : '1 分钟内'
    return signed ? '还剩不到 1 分钟' : '不到 1 分钟'
  } else if (abs < hour) {
    const m = Math.round(abs / minute)
    text = `${m} 分钟`
  } else if (abs < day) {
    const h = Math.floor(abs / hour)
    const m = Math.round((abs % hour) / minute)
    text = m > 0 && h < 6 ? `${h} 小时 ${m} 分钟` : `${h} 小时`
  } else if (abs < 30 * day) {
    const d = Math.floor(abs / day)
    const h = Math.round((abs % day) / hour)
    text = h > 0 && d < 3 ? `${d} 天 ${h} 小时` : `${d} 天`
  } else if (abs < 365 * day) {
    text = `${Math.round(abs / (30 * day))} 个月`
  } else {
    text = `${(abs / (365 * day)).toFixed(1)} 年`
  }

  if (!signed) return text
  return future ? `还剩 ${text}` : `已过 ${text}`
}

/**
 * DDL 相对描述：
 *  - 未过期 → 「还剩 2 天」
 *  - 已过期 → 「已过期 3 天」
 * 无 due_at 返回 ''
 */
export function describeDue(dueAt, now = Date.now()) {
  const ms = toMillis(dueAt)
  const base = toMillis(now)
  if (ms === null || base === null) return ''
  const diff = ms - base
  if (diff >= 0) return `还剩 ${formatDuration(diff)}`
  return `已过期 ${formatDuration(-diff)}`
}

/**
 * 头部「最后同步时间」用的短相对时间：刚刚 / 10 秒前 / 3 分钟前 / 2 小时前
 */
export function timeAgoShort(value, now = Date.now()) {
  const ms = toMillis(value)
  const base = toMillis(now)
  if (ms === null || base === null) return '—'
  const diff = base - ms
  if (diff < 0) return '刚刚'
  if (diff < 10 * 1000) return '刚刚'
  if (diff < 60 * 1000) return `${Math.floor(diff / 1000)} 秒前`
  if (diff < 3600 * 1000) return `${Math.floor(diff / (60 * 1000))} 分钟前`
  if (diff < 24 * 3600 * 1000) return `${Math.floor(diff / (3600 * 1000))} 小时前`
  if (diff < 30 * 24 * 3600 * 1000) return `${Math.floor(diff / (24 * 3600 * 1000))} 天前`
  return formatDateTime(ms)
}

/** 「距发布 X 小时」——卡片底部元信息 */
export function describeSincePublish(sourceTs, now = Date.now()) {
  const ms = toMillis(sourceTs)
  const base = toMillis(now)
  if (ms === null || base === null) return '发布时间未知'
  const diff = base - ms
  if (diff < 0) return '距发布 刚刚'
  if (diff < 60 * 1000) return '距发布 不到 1 分钟'
  if (diff < 3600 * 1000) return `距发布 ${Math.floor(diff / (60 * 1000))} 分钟`
  if (diff < 24 * 3600 * 1000) return `距发布 ${Math.floor(diff / (3600 * 1000))} 小时`
  return `距发布 ${Math.floor(diff / (24 * 3600 * 1000))} 天`
}

/**
 * 置信度规则（见设计文档 §6.2）：
 *  - >= 0.9 正常：level = 'ok'
 *  - 0.6 ~ 0.9 加 `~` 前缀：level = 'approx'
 *  - < 0.6 视为待确认：level = 'unconfirmed'
 * @param {number|null|undefined} confidence
 */
export function confidenceLevel(confidence) {
  if (confidence === null || confidence === undefined || !Number.isFinite(Number(confidence))) {
    return 'unknown'
  }
  const c = Number(confidence)
  if (c >= 0.9) return 'ok'
  if (c >= 0.6) return 'approx'
  return 'unconfirmed'
}

/**
 * DDL 剩余时间分级 —— **全项目唯一**的一处分级判断。
 *
 * 组件里不要自己写 `diff < 24h` 这类比较，统一调用这里，避免卡片 / 分组 / 详情
 * 三处颜色规则漂移。
 *
 * | level     | 条件              | CSS 变量            | 色值      |
 * |-----------|-------------------|---------------------|-----------|
 * | overdue   | dueAt < now       | --xc-due-overdue    | #d93026   |
 * | urgent    | 剩余 <= 24 小时   | --xc-due-urgent     | #e8590c   |
 * | soon      | 剩余 <= 3 天      | --xc-due-soon       | #d99100   |
 * | week      | 剩余 <= 7 天      | --xc-due-week       | #3b82c4   |
 * | later     | 剩余 > 7 天       | --xc-due-later      | #4b8b5a   |
 * | none      | dueAt 为 null     | --xc-due-none       | #8a8f99   |
 *
 * 硬约束：`due_at` 为 null 时**必须**返回 'none'（灰），
 * 绝不允许因为取不到值就落到「看起来紧急」的档位上。
 *
 * @param {number|string|Date|null|undefined} dueAt
 * @param {number} [now] 毫秒时间戳，便于测试注入固定锚点
 * @returns {'overdue'|'urgent'|'soon'|'week'|'later'|'none'}
 */
export function dueLevel(dueAt, now = Date.now()) {
  const ms = toMillis(dueAt)
  if (ms === null) return 'none'
  const base = toMillis(now)
  if (base === null) return 'none'

  const diff = ms - base
  if (diff < 0) return 'overdue'

  const hour = 3600 * 1000
  const day = 24 * hour

  if (diff <= 24 * hour) return 'urgent'
  if (diff <= 3 * day) return 'soon'
  if (diff <= 7 * day) return 'week'
  return 'later'
}

/** 置信度对应的中文标签 */
export function confidenceLabel(confidence) {
  switch (confidenceLevel(confidence)) {
    case 'ok':
      return '高置信'
    case 'approx':
      return '约'
    case 'unconfirmed':
      return '待确认'
    default:
      return '未知置信度'
  }
}

/**
 * 综合判断一条通知的 DDL 是否可信（用于决定是否展示精确时间）。
 * 规则：due_at 为 null，或 due_confidence < 0.6 → 不可信，只能展示原文。
 */
export function isDueUnconfirmed(notification) {
  if (!notification) return true
  if (toMillis(notification.due_at) === null) return true
  const level = confidenceLevel(notification.due_confidence)
  return level === 'unconfirmed' || level === 'unknown'
}

/**
 * 卡片左侧「大号 DDL」的展示模型。
 * 返回 { text, prefix, level, showOriginalOnly, original }
 *  - due_at 为 null → text='待确认'，original=due_text（照常显示）
 *  - due_confidence < 0.6 → text 仍是时间但 level=unconfirmed（整体灰色）
 *  - 0.6~0.9 → text 前面加 '~'
 */
export function buildDueDisplay(notification, now = Date.now()) {
  const n = notification || {}
  const level = confidenceLevel(n.due_confidence)
  const dueMs = toMillis(n.due_at)
  const original = n.due_text || ''

  if (dueMs === null) {
    return {
      text: '待确认',
      prefix: '',
      level: 'unconfirmed',
      showOriginalOnly: true,
      original,
      dueAt: null,
      relative: ''
    }
  }

  const base = formatDueAt(dueMs)
  if (level === 'unconfirmed') {
    return {
      text: base,
      prefix: '',
      level,
      showOriginalOnly: false,
      original,
      dueAt: dueMs,
      relative: describeDue(dueMs, now)
    }
  }

  return {
    text: base,
    prefix: level === 'approx' ? '~' : '',
    level,
    showOriginalOnly: false,
    original,
    dueAt: dueMs,
    relative: describeDue(dueMs, now)
  }
}

/**
 * 分组：今天 / 本周 / 更晚 / 无确定时间 / 已过期
 * 排序：due_at 升序，null 排最后。
 */
export const DUE_GROUP_ORDER = ['overdue', 'today', 'thisweek', 'later', 'nodate']

export const DUE_GROUP_LABELS = {
  overdue: '已过期',
  today: '今天',
  thisweek: '几天内',
  later: '更晚',
  nodate: '无确定时间'
}

/** 判断一条通知归属哪个分组 */
export function groupKeyOf(notification, now = Date.now()) {
  const n = notification || {}
  const dueMs = toMillis(n.due_at)
  const status = n.status || 'active'

  if (dueMs === null) return 'nodate'
  if (status === 'expired') return 'overdue'

  // 分组口径跟随唯一的 dueLevel()，保证分组标题和卡片颜色永远一致
  const level = dueLevel(dueMs, now)
  if (level === 'overdue') return 'overdue'
  if (isSameDay(dueMs, now)) return 'today'
  if (level === 'urgent' || level === 'soon' || level === 'week') return 'thisweek'
  return 'later'
}

/** 按 due_at 升序排序（无 due_at 的排最后） */
export function compareByDue(a, b) {
  const am = toMillis(a && a.due_at)
  const bm = toMillis(b && b.due_at)
  if (am === null && bm === null) {
    // 都没时间：按发布时间倒序（新的在前），保证顺序稳定
    const as = toMillis(a && (a.source_ts || a.created_at)) || 0
    const bs = toMillis(b && (b.source_ts || b.created_at)) || 0
    return bs - as
  }
  if (am === null) return 1
  if (bm === null) return -1
  return am - bm
}

/**
 * 把通知列表加工成分组结构，供模板直接渲染。
 * @returns {{ key: string, label: string, items: any[] }[]} 只返回非空组，顺序固定
 */
export function groupNotifications(list, now = Date.now()) {
  const buckets = {
    overdue: [],
    today: [],
    thisweek: [],
    later: [],
    nodate: []
  }
  const source = Array.isArray(list) ? list : []
  for (const item of source) {
    const key = groupKeyOf(item, now)
    if (buckets[key]) buckets[key].push(item)
    else buckets.later.push(item)
  }
  return DUE_GROUP_ORDER.filter((key) => buckets[key].length > 0).map((key) => ({
    key,
    label: DUE_GROUP_LABELS[key],
    items: buckets[key].slice().sort(compareByDue)
  }))
}

/** 后端 status 的中文文案 */
export function statusLabel(status) {
  switch (status) {
    case 'active':
      return '进行中'
    case 'expired':
      return '已过期'
    case 'archived':
      return '已归档'
    default:
      return status || '未知状态'
  }
}

/** el-date-picker 用的 Date → 毫秒；空值返回 null */
export function dateToMillis(value) {
  return toMillis(value)
}
