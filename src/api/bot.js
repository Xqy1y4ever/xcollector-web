import axios from 'axios'

import { applyBearerToken } from './client'
import { BOT_DOWN_MESSAGE, humanizeError, isOfflineError } from './errors'

/**
 * bot 的 axios 实例。
 *
 * 后端退化成纯数据层之后，OneBot 连接、LLM 配置、流水线计数、盲区、缺口、
 * digest 全部由 bot 持有，前端系统状态页改成调 bot（契约第 9 节）。
 *
 * 开发时 baseURL 用 `/bot`，vite 代理把 `/bot` 前缀 rewrite 掉之后转发到
 * http://127.0.0.1:8082（见 vite.config.js 的 XCOLLECTOR_BOT）。
 * 生产部署时如果 bot 与前端不同源，把 VITE_BOT_BASE 设为 bot 地址即可。
 *
 * 认证：跟后端一样用 `Authorization: Bearer <token>`（整套系统只有一个共享密钥口径），
 * 只是前端这边 bot 单独读 `VITE_BOT_API_TOKEN`，方便两个服务配不同的值。
 */
const baseURL = import.meta.env.VITE_BOT_BASE || '/bot'

export const httpBot = axios.create({
  baseURL,
  timeout: 8000,
  headers: { 'Content-Type': 'application/json' }
})

/** bot 共享密钥：必须与 bot 进程的 API_TOKEN 一致；不配置则不发 Authorization 头 */
const BOT_API_TOKEN = import.meta.env.VITE_BOT_API_TOKEN || ''

// 加头逻辑与后端共用一份实现（client.js 的 applyBearerToken），不复制第二份。
// ⚠️ 同 client.js：token 会被打进 JS bundle，不是安全边界，只能挡「随手访问接口」。
httpBot.interceptors.request.use((config) =>
  applyBearerToken(config, BOT_API_TOKEN, '__xcBotTokenApplied')
)

/** GET /bot/api/status → 契约第 9 节的 status 对象 */
export async function getStatus() {
  const { data } = await httpBot.get('/api/status')
  return data
}

/** GET /bot/api/digest/preview → { text } */
export async function previewDigest() {
  const { data } = await httpBot.get('/api/digest/preview')
  return data
}

/**
 * POST /bot/api/digest/send
 * @param {boolean} dryRun true = 只组装不发送
 * @returns {{ ok: boolean, sent: boolean, text: string, error: string|null }}
 */
export async function sendDigest(dryRun = true) {
  const { data } = await httpBot.post('/api/digest/send', { dry_run: !!dryRun })
  return data
}

export { BOT_DOWN_MESSAGE, humanizeError, isOfflineError }

export default {
  httpBot,
  getStatus,
  previewDigest,
  sendDigest,
  humanizeError,
  isOfflineError,
  BOT_DOWN_MESSAGE
}
