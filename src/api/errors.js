/**
 * 异常 → 中文文案的唯一实现。
 *
 * 前端现在要跟**两个**上游说话（见 xcollector-backend/docs/api.md 第 9 节）：
 *   - 后端（纯数据层）：通知台 `/api/*`
 *   - bot（消息处理）：系统状态 `/bot/api/*`
 * 两边的 axios 实例各自独立，但错误要翻成同一种中文，所以翻译逻辑抽到这里，
 * `client.js` 与 `bot.js` 都复用这一份，不做第二份拷贝。
 */

/** 后端未连接时的统一文案 */
export const BACKEND_DOWN_MESSAGE = '后端未连接，请确认 FastAPI 已在 127.0.0.1:8000 运行'

/** bot 未连接时的统一文案 */
export const BOT_DOWN_MESSAGE = 'bot 未运行或不可达'

/** 每个上游的文案包：连不上 / 超时 / 未授权（401） / 权限不足（403） */
const PROFILES = {
  backend: {
    down: BACKEND_DOWN_MESSAGE,
    timeout: '后端响应超时，请确认服务是否卡住',
    unauthorized:
      '未授权（401）：这次请求没带上正确的令牌。请到登录页重新输入网页令牌（WEB_API_TOKEN）。后端没配令牌时不校验，那是仅限本机开发的做法',
    // 401 和 403 必须分开说：401 是"你谁啊"，403 是"我知道你是谁，但你没这个权限"。
    // 混在一起会让用户以为令牌输了，反复重输也没用。
    forbidden:
      '权限不足（403）：这个操作只允许 bot 做。网页令牌只能读取、提交人工修正、标记已读 —— 入库、改机器字段、删除、上传附件都归 bot。这是刻意设计的：网页令牌必须交给登录页，所以不该能改库',
    label: '后端'
  },
  bot: {
    down: BOT_DOWN_MESSAGE,
    timeout: 'bot 响应超时，请确认服务是否卡住',
    unauthorized:
      '未授权（401）：这次请求没带上正确的令牌。bot 认两个令牌：网页令牌（看状态/预览摘要）和管理令牌（还能发消息）。请到登录页重新输入',
    forbidden:
      '权限不足（403）：网页令牌只能看状态和预览摘要，**不能发消息**。想现在就发，请在登录页「高级」里填管理令牌（BOT_API_TOKEN 或 API_TOKEN）；否则等 bot 按 DIGEST_TIME 自动发',
    label: 'bot'
  }
}

function profileOf(service) {
  return PROFILES[service] || PROFILES.backend
}

/**
 * 把任意异常翻译成一句给人看的中文。
 * 关键点：绝不抛出，永远返回字符串，保证调用方不会因为异常白屏。
 *
 * @param {any} error
 * @param {'backend'|'bot'} [service] 文案用哪一套（决定「谁没连上」的说法）
 */
export function humanizeError(error, service = 'backend') {
  const p = profileOf(service)
  if (!error) return p.down
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
    // 401 = 令牌不对（去重新登录）；403 = 令牌对但没这个权限（换操作方式，不是重输）
    if (status === 401) return `${p.unauthorized}${suffix}`
    if (status === 403) return `${p.forbidden}${suffix}`
    if (status === 404) return `${p.label}返回 404，接口可能尚未实现${suffix}`
    if (status >= 500) return `${p.label}错误（HTTP ${status}）${suffix}`
    return `请求失败（HTTP ${status}）${suffix}`
  }

  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
    return p.timeout
  }

  // 网络层错误（服务没起、端口不对、被代理拒绝）
  if (error.request || error.code === 'ERR_NETWORK') {
    return p.down
  }

  return error.message ? String(error.message) : '未知错误'
}

/** 判断某个异常是否属于「这个上游根本没连上」（而非它返回了错误状态码） */
export function isOfflineError(error) {
  if (!error) return true
  if (error.response) return false
  return true
}
