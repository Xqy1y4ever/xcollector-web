import axios from 'axios'

import { applyBearerToken } from './client'
import { BOT_DOWN_MESSAGE, BOT_NOT_OPERATOR_MESSAGE, humanizeError, isOfflineError } from './errors'
import { getOperatorToken } from './operator'

/**
 * bot 的 axios 实例（**运营者视图**专用）。
 *
 * 后端退化成纯数据层之后，OneBot 连接、LLM 配置、流水线计数、盲区、缺口、
 * digest 全部由 bot 持有，前端系统状态页改成调 bot（契约第 9 节）。
 *
 * 开发时 baseURL 用 `/bot`，vite 代理把 `/bot` 前缀 rewrite 掉之后转发到
 * http://127.0.0.1:8082（见 vite.config.js 的 XCOLLECTOR_BOT）。
 *
 * ## 认证：只认运营者令牌，而且**不填就不发请求**
 *
 * bot 的 `/api/*` 只认它自己的管理令牌（`API_TOKEN` / `BOT_API_TOKEN`），
 * 它**不认识**用户的 UserToken。多用户之后这是刻意的：状态页里有所有人的
 * 盲区计数、白名单、OneBot 连接状态，不该让任何一个普通用户看到。
 * 所以「没填令牌 → 看不到状态页」是**设计如此**，不是坏了。
 *
 * 这个实例的规则：
 *   1. 只带 `src/api/operator.js` 里那个运营者令牌（sessionStorage，本次会话有效）；
 *   2. **绝不带** UserToken —— 带了也只会吃 401/403，还会把用户凭据送到另一个服务；
 *   3. 没填令牌时调用方（stores/health.js）**根本不该发请求**，直接显示说明；
 *   4. 这个实例**没有**响应拦截器：bot 的 401 绝不能触发 `/api` 那边的
 *      「清登录态 + 跳登录页」—— 运营者令牌失效和用户的登录态是两件不相干的事，
 *      混在一起会把用户莫名踢下线。401 由调用方按 `error.response.status` 翻成
 *      「运营者令牌无效，请重新填写」。
 */
const ENV = import.meta.env || (typeof process !== 'undefined' ? process.env : {})
const baseURL = ENV.VITE_BOT_BASE || '/bot'

export const httpBot = axios.create({
  baseURL,
  timeout: 8000,
  headers: { 'Content-Type': 'application/json' }
})

// 加头逻辑与后端共用一份实现（client.js 的 applyBearerToken），不复制第二份。
// 传空串时它原样返回、不加头 —— 那种请求我们本来也不该发。
httpBot.interceptors.request.use((config) =>
  applyBearerToken(config, getOperatorToken(), 'xcOperatorTokenApplied')
)

/** GET /bot/api/status → 契约第 9 节的 status 对象 */
export async function getStatus() {
  const { data } = await httpBot.get('/api/status')
  return data
}

/**
 * GET /bot/api/digest/preview
 *
 * digest 是**按人**组装的，所以可以指定预览谁的：
 *   - 传 `userId` → 预览那个人的；
 *   - 不传 → bot 用**第一个收件人**，并在响应里告诉你用的是谁。
 *
 * 响应：`{ text, user_id, qq, recipients: [{qq, user_id}], error }`
 * —— `user_id` / `qq` 必须显示给运营者，否则会误以为预览的是自己那一份。
 *
 * @param {{ userId?: string }} [opts]
 */
export async function previewDigest(opts = {}) {
  const params = {}
  const uid = typeof opts.userId === 'string' ? opts.userId.trim() : ''
  if (uid) params.user_id = uid
  const { data } = await httpBot.get('/api/digest/preview', { params })
  return data
}

// 刻意**没有** sendDigest（POST /api/digest/send）：
// 那个操作会真的往 QQ 发消息。手动补发请在服务器上用 bot 的接口 ——
// 它比「看一眼状态」危险得多，不该在浏览器里解锁。

export { BOT_DOWN_MESSAGE, BOT_NOT_OPERATOR_MESSAGE, humanizeError, isOfflineError }

export default {
  httpBot,
  getStatus,
  previewDigest,
  humanizeError,
  isOfflineError,
  BOT_DOWN_MESSAGE,
  BOT_NOT_OPERATOR_MESSAGE
}
