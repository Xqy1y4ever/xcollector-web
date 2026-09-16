import axios from 'axios'

/**
 * 统一的 axios 实例。
 *
 * 开发时 baseURL 用 `/api`，由 vite.config.js 的 dev 代理转发到
 * http://127.0.0.1:8000，因此不存在 CORS 问题。
 * 生产部署时如果前后端不同源，把 VITE_API_BASE 设为后端地址即可。
 */
const baseURL = import.meta.env.VITE_API_BASE || '/api'

export const http = axios.create({
  baseURL,
  timeout: 8000,
  headers: { 'Content-Type': 'application/json' }
})

/** 后端未连接时的统一文案 */
export const BACKEND_DOWN_MESSAGE =
  '后端未连接，请确认 FastAPI 已在 127.0.0.1:8000 运行'

/**
 * 把任意异常翻译成一句给人看的中文。
 * 关键点：绝不抛出，永远返回字符串，保证调用方不会因为异常白屏。
 */
export function humanizeError(error) {
  if (!error) return BACKEND_DOWN_MESSAGE
  if (typeof error === 'string') return error

  // 我们自己构造的标记错误
  if (error.__xcollectorMessage) return error.__xcollectorMessage

  if (error.response) {
    const { status, data } = error.response
    let detail = ''
    if (data) {
      if (typeof data === 'string') detail = data
      else if (typeof data.detail === 'string') detail = data.detail
      else if (Array.isArray(data.detail)) {
        detail = data.detail
          .map((d) => (d && d.msg ? d.msg : JSON.stringify(d)))
          .join('; ')
      } else if (data.error) {
        detail = String(data.error)
      }
    }
    const suffix = detail ? `：${detail}` : ''
    if (status === 404) return `后端返回 404，接口可能尚未实现${suffix}`
    if (status >= 500) return `后端错误（HTTP ${status}）${suffix}`
    return `请求失败（HTTP ${status}）${suffix}`
  }

  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
    return '后端响应超时，请确认服务是否卡住'
  }

  // 网络层错误（后端没起、端口不对、被代理拒绝）
  if (error.request || error.code === 'ERR_NETWORK') {
    return BACKEND_DOWN_MESSAGE
  }

  return error.message ? String(error.message) : '未知错误'
}

/** 判断某个异常是否属于「后端根本没连上」 */
export function isOfflineError(error) {
  if (!error) return true
  if (error.response) return false
  return true
}

/* ------------------------------------------------------------------ *
 * 通知
 * ------------------------------------------------------------------ */

/**
 * GET /api/notifications
 * @param {{ since?: number|null, status?: string, q?: string }} params
 */
export async function fetchNotifications(params = {}) {
  const query = {}
  if (params.since !== undefined && params.since !== null) query.since = params.since
  if (params.status && params.status !== 'all') query.status = params.status
  if (params.q) query.q = params.q

  const { data } = await http.get('/notifications', { params: query })
  return data
}

/** GET /api/notifications/{id} */
export async function fetchNotificationDetail(id) {
  const { data } = await http.get(`/notifications/${encodeURIComponent(id)}`)
  return data
}

/**
 * POST /api/notifications/{id}/corrections
 * @param {string} id
 * @param {{ field: 'title'|'summary'|'due_at'|'due_text'|'status', value: any, user_id?: string }} payload
 */
export async function submitCorrection(id, payload) {
  const body = {
    field: payload.field,
    value: payload.value === undefined ? null : payload.value,
    user_id: payload.user_id || 'web'
  }
  const { data } = await http.post(`/notifications/${encodeURIComponent(id)}/corrections`, body)
  return data
}

/** POST /api/notifications/{id}/read */
export async function setNotificationRead(id, read) {
  const { data } = await http.post(`/notifications/${encodeURIComponent(id)}/read`, {
    read: !!read
  })
  return data
}

/* ------------------------------------------------------------------ *
 * 系统状态
 * ------------------------------------------------------------------ */

/** GET /api/health */
export async function fetchHealth() {
  const { data } = await http.get('/health')
  return data
}

/* ------------------------------------------------------------------ *
 * Digest
 * ------------------------------------------------------------------ */

/** GET /api/digest/preview */
export async function fetchDigestPreview() {
  const { data } = await http.get('/digest/preview')
  return data
}

/** POST /api/digest/send */
export async function sendDigest(dryRun = true) {
  const { data } = await http.post('/digest/send', { dry_run: !!dryRun })
  return data
}

/* ------------------------------------------------------------------ *
 * 配置
 * ------------------------------------------------------------------ */

/** GET /api/config/meta */
export async function fetchConfigMeta() {
  const { data } = await http.get('/config/meta')
  return data
}

export default {
  http,
  fetchNotifications,
  fetchNotificationDetail,
  submitCorrection,
  setNotificationRead,
  fetchHealth,
  fetchDigestPreview,
  sendDigest,
  fetchConfigMeta,
  humanizeError,
  isOfflineError,
  BACKEND_DOWN_MESSAGE
}
