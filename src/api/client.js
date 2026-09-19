import axios from 'axios'

import { BACKEND_DOWN_MESSAGE, humanizeError, isOfflineError, readErrorDetail } from './errors'
import { clearActiveToken, getActiveToken } from './token'
import { replaceTo } from '../router/navigation'

// import.meta.env 在 vite 里是构建期内联的；`|| process.env` 让这些模块也能被 node 直接
// 加载（联调脚本用真实后端跑一遍请求层，见 E:\Xcollector\.tmp\web-http-check.mjs）。
// 浏览器里 `process` 是 undefined，`typeof` 守卫保证不会 ReferenceError。
const ENV = import.meta.env || (typeof process !== 'undefined' ? process.env : {})

/**
 * 后端（纯数据层）的 axios 实例。
 *
 * 开发时 baseURL 用 `/api`，由 vite.config.js 的 dev 代理转发到
 * http://127.0.0.1:8000，因此不存在 CORS 问题。
 * 生产部署时如果前后端不同源，把 VITE_API_BASE 设为后端地址即可；
 * 但**推荐同源反代**（见 README），否则还要自己处理 CORS 与预检。
 *
 * 契约要求所有 `/api` 请求带 `Authorization: Bearer <UserToken>`。
 * 多用户之后只有**一种**令牌：用户在登录页粘贴、或在注册页拿到的那串 `xc_...`。
 * 它同时是登录凭证和调用凭证 —— 后端从它定出 user_id，数据按 user_id 隔离。
 * 服务令牌（API_TOKEN）只属于 bot，**永远不进这个前端**。
 *
 * 令牌来源是 `stores/auth.js` 写进 `src/api/token.js` 的**模块级持有者**（用户登录时写入），
 * 不是构建期内联的常量 —— 依赖方向与破环理由见 src/api/token.js 的注释。
 *
 * 注意：bot 的接口走另一个实例（src/api/bot.js → `/bot`），两者职责不同，
 * 见 xcollector-backend/docs/api.md 第 9 节。
 */
const baseURL = ENV.VITE_API_BASE || '/api'

export const http = axios.create({
  baseURL,
  timeout: 8000,
  headers: { 'Content-Type': 'application/json' }
})

/**
 * 给请求配置加 `Authorization: Bearer <token>`。
 *
 * @param {object} config axios 请求配置
 * @param {string} token 为空时原样返回、**不加头**
 * @param {string} [marker] 打标记用的字段名，便于断言拦截器确实按 token 有无工作
 *
 * ⚠️ 这不是安全边界：令牌是**明文**存在浏览器 storage / 内存里的。任何能在这台浏览器上
 * 执行 JS 的东西都能读到它；XSS 会泄露它。它只能挡住「没有令牌的随手访问」，
 * 真正的边界是不要把后端暴露到公网。详见 README 的「认证」一节。
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
 * 401 处理：清空登录态 + 跳登录页（带防死循环与防抖）
 * ------------------------------------------------------------------ */

/** 同一时间只允许一次 401 跳转，避免并发请求把路由刷成一串 replace */
let redirectingToLogin = false

/**
 * 「令牌失效」处理器的注册表 —— 与 src/router/navigation.js 同一手法。
 *
 * ## 为什么需要它（以及为什么不能用动态 import）
 *
 * 401 之后要清的是 auth store 的登录态，但 client.js **不能** import stores/auth.js：
 * auth store 顶层就 import 了本文件，静态 import 会把两边拉成初始化环。
 * 所以反过来：由 `stores/auth.js` 在模块加载时把自己注册进来（见该文件末尾），
 * client.js 只在 401 发生时调用这个句柄。依赖方向始终单向：
 * `stores/auth.js → client.js`，没有第二条边。
 *
 * 旧版本这里写的是 `import('../stores/auth')`：虽然躲开了环，但 vite 会警告
 * 「既被动态 import 又被多处静态 import，动态 import 分不出独立 chunk」——
 * 也就是这段代码实际上什么好处都没换来。注册表把这个问题彻底消掉。
 */
let unauthorizedHandler = null

/**
 * 由 `stores/auth.js` 调用：注册「令牌失效」时的收尾动作（清登录态）。
 * @param {(() => void) | null} fn
 */
export function registerUnauthorizedHandler(fn) {
  unauthorizedHandler = typeof fn === 'function' ? fn : null
}

/**
 * 401 之后的收尾：清空登录态（内存 + 两侧 storage）并跳登录页。
 *
 * 用 replace 而不是 push：401 之后不应把当前页面留在历史里，
 * 否则用户点浏览器「后退」会再次撞上一个必然 401 的页面。
 *
 * @param {string} fullPath 被拦下来的原目标，登录成功后跳回去
 */
function goToLogin(fullPath) {
  // 已经在登录/注册页：那两页自己发的请求失败时会走到这里，直接不跳，否则就是死循环。
  // 注意这个判断必须在清空登录态之前做。
  const current = window.location.pathname + window.location.search
  if (current.indexOf('/login') === 0 || current.indexOf('/register') === 0) return
  // 已经开始跳转就不再重复（并发请求会同时返回 401）
  if (redirectingToLogin) return
  redirectingToLogin = true

  // 清空登录态。走 auth store 的 logout()：它会同时清空**两侧 storage**。
  // 只清内存令牌是不够的 —— 刷新页面时 restore() 会把旧 token 从 storage 里捞回来，
  // 于是用户又被踢回登录页，形成「刷新即踢」的循环。
  //
  // 处理器没注册（极早期，比如 store 模块还没加载）时兜底清内存令牌：
  // 至少不能让后续请求继续带着这个坏令牌。
  if (unauthorizedHandler) unauthorizedHandler()
  else clearActiveToken()

  // 导航走 router/navigation.js 的模块级持有者（由 router/index.js 注册），
  // 所以这里不需要 import router —— 错误处理路径上不做任何 .vue 相关的加载。
  replaceTo({ path: '/login', query: { redirect: fullPath } })
  // 留一个很短的空窗：路由 replace 是异步的，立刻复位会让同一批并发请求重复跳转
  setTimeout(() => {
    redirectingToLogin = false
  }, 300)
}

function handleUnauthorized(error) {
  // 已经没有登录态了（同一个页面上并发的第二个 401 会走到这里）：
  // 没什么可清的，也不必再跳一次。
  if (!getActiveToken()) return
  const fullPath =
    (typeof window !== 'undefined' && window.location
      ? window.location.pathname + window.location.search
      : '/') || '/'
  goToLogin(fullPath)
  // 不改写文案：errors.js 的 humanizeError 会按 `error.response.status` 给出对应中文指引
}

http.interceptors.request.use((config) => {
  // 公开接口（注册）自己管 Authorization：它必须**不带**令牌，见 src/api/user.js
  if (config && config.xcSkipAuth) return config
  return applyBearerToken(config, getActiveToken(), 'xcBackendTokenApplied')
})

http.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error && error.response ? error.response.status : 0
    // **只有 401 才登出。** 403 是"令牌有效但没这个权限"（用户令牌碰上 bot 专属接口），
    // 把它也当成登录过期，用户会被莫名其妙踢回登录页、重输一遍还是 403。
    // 403 就让它往上抛，由 errors.js 给出"你没这个权限"的中文说明。
    if (status === 401) handleUnauthorized(error)
    return Promise.reject(error)
  }
)

/** 这个异常是不是后端返回了 5xx（后端自己坏了，不代表令牌错） */
export function isServerError(error) {
  const status = error && error.response ? error.response.status : 0
  return status >= 500 && status <= 599
}

// 错误文案只有一份实现（src/api/errors.js），这里原样再导出，
// 让既有 `import { humanizeError } from '../api/client'` 的调用方不用改。
export { BACKEND_DOWN_MESSAGE, humanizeError, isOfflineError, readErrorDetail }

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
 *
 * 后端从令牌定 user_id（谁的数据），`actor` 只是**留痕**用的展示字段
 * （「谁改的」），和归属无关 —— 见 xcollector-backend/app/auth.py 的 resolve_owner。
 *
 * @param {string} id
 * @param {{ field: 'title'|'summary'|'location'|'due_at'|'due_text'|'status', value: any, actor?: string }} payload
 */
export async function submitCorrection(id, payload) {
  const body = {
    field: payload.field,
    value: payload.value === undefined ? null : payload.value,
    actor: payload.actor || 'web'
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

/**
 * DELETE /api/notifications/{id} —— **真删**那条通知。
 *
 * 和「归档」（corrections 把 status 改成 archived）是两件事，别混：
 *   · 归档：只改状态、不丢数据，前端切「已归档」还看得到；
 *   · 删除：后端把通知行删掉（只追加层 —— correction / read_state —— 不动）。
 *
 * 权限：用户令牌**可以**删自己那条（SQL 里带着 user_id），别人的或不存在的都回 404，
 * 而且不区分这两者（否则能拿它探测"某个 id 存在吗"）。见后端 docs/api.md 的权限表。
 */
export async function deleteNotification(id) {
  const { data } = await http.delete(`/notifications/${encodeURIComponent(id)}`)
  return data
}

/* ------------------------------------------------------------------ *
 * 存储健康（「后端可达性」探针）
 * ------------------------------------------------------------------ */

/**
 * GET /api/health
 *
 * 只报存储自身（契约第 7 节），不含 OneBot / LLM / 流水线——那些归 bot。
 * 多用户之后 counts 是**按当前用户**算的（后端从令牌取 user_id），
 * 所以这个数字回答的是「你收了多少」，不是全站。
 *
 * 用途：系统状态页独立探一次后端 —— bot 活着但后端挂了，消息就存不进去，
 * 这是最重要的运维信号，不能只信 bot 自报的 backend.reachable。
 *
 * 登录页的令牌校验**不再走这里**，改用 `GET /api/me`（见 src/api/user.js）：
 * `/api/me` 能明确回答「你是谁」，而 /health 一个服务令牌也能过。
 *
 * @param {{ timeout?: number }} [opts]
 *   timeout 覆盖默认超时
 */
export async function fetchBackendHealth(opts = {}) {
  const config = {}
  if (opts.timeout) config.timeout = opts.timeout
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
  deleteNotification,
  fetchBackendHealth,
  attachmentUrl,
  applyBearerToken,
  registerUnauthorizedHandler,
  isServerError,
  humanizeError,
  isOfflineError,
  BACKEND_DOWN_MESSAGE
}
