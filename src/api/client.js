import axios from 'axios'

import { BACKEND_DOWN_MESSAGE, humanizeError, isOfflineError } from './errors'
import { clearActiveTokens, getActiveToken } from './token'
import { replaceTo } from '../router/navigation'

/**
 * 后端（纯数据层）的 axios 实例。
 *
 * 开发时 baseURL 用 `/api`，由 vite.config.js 的 dev 代理转发到
 * http://127.0.0.1:8000，因此不存在 CORS 问题。
 * 生产部署时如果前后端不同源，把 VITE_API_BASE 设为后端地址即可。
 *
 * 契约要求所有 `/api` 请求带 `Authorization: Bearer <API_TOKEN>`（token 为空则后端不校验）。
 * 这里统一在请求拦截器里加头，见下方 applyBearerToken。
 * 令牌来源是 `stores/auth.js` 写进 `src/api/token.js` 的**模块级持有者**（用户在登录页输入），
 * 不是构建期内联的常量 —— 依赖方向与破环理由见 src/api/token.js 的注释。
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

/**
 * 给请求配置加 `Authorization: Bearer <token>`。
 *
 * @param {object} config axios 请求配置
 * @param {string} token 为空时原样返回、**不加头**（本地开发不受影响）
 * @param {string} [marker] 打标记用的字段名，便于断言拦截器确实按 token 有无工作
 *
 * ⚠️ 这不是安全边界：令牌是**明文**存在浏览器 storage / 内存里的共享密钥。
 * 任何能在这台浏览器上执行 JS 的东西都能读到它；XSS 会泄露它。
 * 它只能挡住「没有密钥的随手访问」，真正的边界是不要把后端暴露到公网。
 * 详见 README 的「认证：令牌存在浏览器里，先读这一段」。
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

/* ------------------------------------------------------------------ *
 * 401/403 处理：清空登录态 + 跳登录页（带防死循环与防抖）
 * ------------------------------------------------------------------ */

/** 同一时间只允许一次 401 跳转，避免并发请求把路由刷成一串 replace */
let redirectingToLogin = false

/**
 * 401 之后的收尾：清空登录态（内存 + 两边 storage）并跳登录页。
 *
 * 用 replace 而不是 push：401 之后不应把当前页面留在历史里，
 * 否则用户点浏览器「后退」会再次撞上一个必然 401 的页面。
 *
 * @param {string} fullPath 被拦下来的原目标，登录成功后跳回去
 */
function goToLogin(fullPath) {
  // 已经在登录页：登录请求自己校验失败时会走到这里，直接不跳，否则就是死循环。
  // 注意这个判断必须在清空登录态之前做。
  const current = window.location.pathname + window.location.search
  if (current.indexOf('/login') === 0) return
  // 已经开始跳转就不再重复（并发请求会同时返回 401）
  if (redirectingToLogin) return
  redirectingToLogin = true

  // 清空登录态。用 store 自己的 logout()：它会同时清空**两侧 storage**。
  // 只清内存令牌是不够的 —— 刷新页面时 restore() 会把旧 token 从 storage 里捞回来，
  // 于是用户又被踢回登录页，形成「刷新即踢」的循环。
  //
  // 这里用动态 import 而不是顶层静态 import：auth store 顶层就 import 了本文件，
  // 静态 import 会把 client ↔ store 拉成初始化环。这个 import 发生在 401 之后，
  // 那时两个模块都已经初始化完了，是安全的。
  import('../stores/auth')
    .then((authMod) => {
      authMod.useAuthStore().logout()
    })
    .catch(() => {
      // 连 store 都加载不了：至少把内存里的令牌清掉，不能让后续请求继续带着过期令牌
      clearActiveTokens()
    })
    .finally(() => {
      // 导航走 router/navigation.js 的模块级持有者（由 router/index.js 注册），
      // 所以这里不需要 import router——错误处理路径上不做任何 .vue 相关的加载。
      replaceTo({ path: '/login', query: { redirect: fullPath } })
      // 留一个很短的空窗：路由 replace 是异步的，立刻复位会让同一批并发请求重复跳转
      setTimeout(() => {
        redirectingToLogin = false
      }, 300)
    })
}

function handleUnauthorized(error) {
  const config = (error && error.config) || {}
  // 登录校验请求自己返回 401/403：这是「令牌输错了」，不是「登录态过期」。
  // 绝不能触发登出 + 跳转 —— 那会把用户刚输入的内容清掉，还会形成跳转循环。
  if (config.__xcAuthCheck) return
  const fullPath =
    (typeof window !== 'undefined' && window.location
      ? window.location.pathname + window.location.search
      : '/') || '/'
  goToLogin(fullPath)
  // 不改写文案：errors.js 的 humanizeError 会按 `error.response.status` 给出对应中文指引
}

http.interceptors.request.use((config) => {
  // 认证探针自己带 token（config.headers.Authorization 已设），不走登录态默认值；
  // 打了 __xcAuthCheck 的请求同样跳过，见 stores/auth.js 的 login()
  if (config && (config.__xcSkipStoreToken || config.__xcAuthCheck)) return config
  return applyBearerToken(config, getActiveToken(), '__xcBackendTokenApplied')
})

http.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error && error.response ? error.response.status : 0
    // **只有 401 才登出。** 403 是"令牌有效但没这个权限"（网页令牌碰上 bot 专属接口），
    // 把它也当成登录过期，用户会被莫名其妙踢回登录页、重输一遍还是 403。
    // 403 就让它往上抛，由 errors.js 给出"你没这个权限"的中文说明。
    if (status === 401) handleUnauthorized(error)
    return Promise.reject(error)
  }
)

/** 这个异常是不是「认证探针自己的 401/403」（而不是登录态过期） */
export function isAuthCheckError(error) {
  return !!(error && error.config && error.config.__xcAuthCheck)
}

/** 这个异常是不是后端返回了 5xx（后端自己坏了，不代表令牌错） */
export function isServerError(error) {
  const status = error && error.response ? error.response.status : 0
  return status >= 500 && status <= 599
}

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
 * 存储健康（「后端可达性」探针 + 登录页的令牌校验）
 * ------------------------------------------------------------------ */

/**
 * GET /api/health
 *
 * 只报存储自身（契约第 7 节），不含 OneBot / LLM / 流水线——那些现在归 bot。
 * 两个用途：
 *   1. 系统状态页独立探一次后端：bot 活着但后端挂了，消息就存不进去，
 *      这是最重要的运维信号，不能只信 bot 自报的 backend.reachable。
 *   2. **登录页校验令牌**：该接口要求认证，所以能拿它区分「密钥对不对」。
 *
 * @param {{ authToken?: string, skipStoreToken?: boolean, authCheck?: boolean, timeout?: number }} [opts]
 *   authToken      显式使用的令牌（覆盖当前登录态）；一般只在登录校验时传
 *   skipStoreToken 不要用「当前登录态」的令牌（避免旧值盖掉用户刚输入的值）
 *   authCheck      标记这是认证探针：它的 401 不触发登出跳转（防死循环）
 *   timeout        覆盖默认超时
 */
export async function fetchBackendHealth(opts = {}) {
  const config = {}
  if (opts.skipStoreToken) config.__xcSkipStoreToken = true
  if (opts.authCheck) config.__xcAuthCheck = true
  if (opts.timeout) config.timeout = opts.timeout
  if (opts.authToken) {
    // 显式带 Authorization：拦截器看到已有该头就不会覆盖（applyBearerToken 的约定）
    config.headers = { Authorization: `Bearer ${opts.authToken}` }
  }
  const { data } = await http.get('/health', config)
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
  applyBearerToken,
  isAuthCheckError,
  isServerError,
  humanizeError,
  isOfflineError,
  BACKEND_DOWN_MESSAGE
}
