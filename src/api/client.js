import axios from 'axios'

import { BACKEND_DOWN_MESSAGE, humanizeError, isOfflineError } from './errors'

/**
 * 后端（纯数据层）的 axios 实例。
 *
 * 开发时 baseURL 用 `/api`，由 vite.config.js 的 dev 代理转发到
 * http://127.0.0.1:8000，因此不存在 CORS 问题。
 * 生产部署时如果前后端不同源，把 VITE_API_BASE 设为后端地址即可。
 *
 * 契约要求所有 `/api` 请求带 `Authorization: Bearer <API_TOKEN>`（token 为空则后端不校验）。
 * 这里统一在请求拦截器里加头，见下方 applyBearerToken。
 *
 * 注意：bot 的接口走另一个实例（src/api/bot.js → `/bot`），两者职责不同，
 * 见 xcollector-backend/docs/api.md 第 9 节。
 */
const baseURL = import.meta.env.VITE_API_BASE || '/api'

export const http = axios.create({
  baseURL,
  timeout: 8000,
  headers: { 'Content-Type': 'application/json' }
})

/** 后端共享密钥：必须与后端进程的 API_TOKEN 一致；不配置则不发 Authorization 头 */
const API_TOKEN = import.meta.env.VITE_API_TOKEN || ''

/**
 * 给请求配置加 `Authorization: Bearer <token>`。
 *
 * @param {object} config axios 请求配置
 * @param {string} token 为空时原样返回、**不加头**（本地开发不受影响）
 * @param {string} [marker] 打标记用的字段名，便于断言拦截器确实按 token 有无工作
 *
 * ⚠️ 这不是安全边界：Vite 会把 `import.meta.env.VITE_*` **内联进打包产物**，
 * token 会以明文出现在 dist 的 JS 文件里，任何能打开这个页面的人都能读到。
 * 它只能挡住「随手 curl 一下接口」，真正的边界是不要把后端暴露到公网。
 * 详见 README 的「认证（API_TOKEN）：先读这一段」。
 */
export function applyBearerToken(config, token, marker) {
  if (!token) return config
  if (!config.headers) config.headers = {}
  // 调用方显式带了 Authorization 时不覆盖
  if (typeof config.headers.Authorization === 'undefined') {
    config.headers.Authorization = `Bearer ${token}`
  }
  if (marker) config[marker] = true
  return config
}

http.interceptors.request.use((config) =>
  applyBearerToken(config, API_TOKEN, '__xcBackendTokenApplied')
)

// 错误文案只有一份实现（src/api/errors.js），这里原样再导出，
// 让既有 `import { humanizeError } from '../api/client'` 的调用方不用改。
export { BACKEND_DOWN_MESSAGE, humanizeError, isOfflineError }

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
 * @param {{ field: 'title'|'summary'|'location'|'due_at'|'due_text'|'status', value: any, user_id?: string }} payload
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
 * 存储健康（仅用于「后端可达性」探针）
 * ------------------------------------------------------------------ */

/**
 * GET /api/health
 *
 * 只报存储自身（契约第 7 节），不含 OneBot / LLM / 流水线——那些现在归 bot。
 * 系统状态页用它来独立探一次后端：bot 活着但后端挂了，消息就存不进去，
 * 这是最重要的运维信号，不能只信 bot 自报的 backend.reachable。
 */
export async function fetchBackendHealth() {
  const { data } = await http.get('/health')
  return data
}

/* ------------------------------------------------------------------ *
 * 附件
 * ------------------------------------------------------------------ */

/**
 * 附件二进制地址。
 * 契约第 9 节：`attachments[].url` 形如 `/api/attachments/att_xxx`，
 * 是相对路径且已被 vite 的 `/api` 代理转发到后端，**直接用即可**。
 * 这里只做一层兜底：老数据/异常数据里 url 缺失时返回空串，调用方据此显示占位。
 */
export function attachmentUrl(attachment) {
  if (!attachment || typeof attachment !== 'object') return ''
  const url = attachment.url
  return typeof url === 'string' && url.trim() !== '' ? url : ''
}

export default {
  http,
  fetchNotifications,
  fetchNotificationDetail,
  submitCorrection,
  setNotificationRead,
  fetchBackendHealth,
  attachmentUrl,
  humanizeError,
  isOfflineError,
  BACKEND_DOWN_MESSAGE
}
