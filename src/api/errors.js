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

/** 每个上游的文案包：一条「连不上」、一条「超时」、一条「未授权」 */
const PROFILES = {
  backend: {
    down: BACKEND_DOWN_MESSAGE,
    timeout: '后端响应超时，请确认服务是否卡住',
    unauthorized:
      '未授权（401）：后端配置了 API_TOKEN，但这次请求没有带上正确的令牌。请到登录页重新输入后端的 API_TOKEN（令牌不匹配时后端会直接拒绝；若后端 API_TOKEN 留空则不校验，仅本机开发可这样）',
    label: '后端'
  },
  bot: {
    down: BOT_DOWN_MESSAGE,
    timeout: 'bot 响应超时，请确认服务是否卡住',
    unauthorized:
      '未授权（401）：bot 配置了 API_TOKEN，但这次请求没有带上正确的令牌。契约约定整套系统只有一个共享密钥（bot 在 BOT_API_TOKEN 为空时回退用 API_TOKEN 校验），所以到登录页重新输入令牌即可；如果你在登录页「高级」里单独填了 bot 令牌，请确认它与 bot 侧一致',
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
    // 401 必须给「怎么修」而不是「请求失败」：这是配置问题，用户自己能解决
    if (status === 401 || status === 403) return `${p.unauthorized}${suffix}`
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
