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
export const BACKEND_DOWN_MESSAGE = '后端未连接，请确认 FastAPI 已在运行'

/** bot 未连接时的统一文案 */
export const BOT_DOWN_MESSAGE = 'bot 未运行或不可达'

/**
 * 没填运营者令牌时，系统状态页显示的那段说明。
 *
 * 它不是错误文案：**没填令牌看不到状态页是设计如此** —— bot 的状态接口是运营者
 * 视角（所有人的盲区计数、白名单、OneBot 连接状态），不该让普通用户看到。
 * 所以这里要解释「为什么看不到」，而不是报「不可达」—— 后者会让人以为系统坏了。
 */
export const BOT_NOT_OPERATOR_MESSAGE =
  '系统状态接口只认管理令牌（运营者身份），它不在前端里。这是刻意的：' +
  '这一页是给运营者看的（里面有所有人的盲区计数、白名单、OneBot 连接状态），' +
  '普通用户看不到是设计如此，不是故障。'

/** 运营者令牌被 bot 拒绝（401）时的文案 */
export const BOT_OPERATOR_REJECTED_MESSAGE =
  '运营者令牌无效（bot 返回 401），请重新填写管理令牌（API_TOKEN / BOT_API_TOKEN）。' +
  '注意：这个失败**不影响你的登录状态** —— 运营者令牌和你的登录令牌是两套东西。'

/** 每个上游的文案包：连不上 / 超时 / 未授权（401） / 权限不足（403） */
const PROFILES = {
  backend: {
    down: BACKEND_DOWN_MESSAGE,
    timeout: '后端响应超时，请确认服务是否卡住',
    unauthorized:
      '未授权（401）：这次请求没带上有效的登录令牌。请到登录页重新粘贴你的令牌（注册时发给你的那串 xc_ 开头的）',
    // 401 和 403 必须分开说：401 是"你谁啊"，403 是"我知道你是谁，但你没这个权限"。
    // 多用户之后 403 只有一个来源：那个接口要求**服务令牌**（bot 专属）。
    // 混在一起会让用户以为令牌输错了，反复重输也没用。
    forbidden:
      '权限不足（403）：这个接口只允许服务端（bot）调用。用户令牌只能读写自己的数据 —— 入库、改机器字段、删除、上传附件都归 bot，这是刻意设计的',
    label: '后端'
  },
  bot: {
    down: BOT_DOWN_MESSAGE,
    timeout: 'bot 响应超时，请确认服务是否卡住',
    // bot 只有一条鉴权线（管理令牌），401 和 403 的表达方式一样：都是"令牌不对/不够"
    unauthorized: BOT_OPERATOR_REJECTED_MESSAGE,
    forbidden: BOT_OPERATOR_REJECTED_MESSAGE,
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

/** 注册 / 订阅表单的字段名 → 中文，用于把 422 的英文校验信息翻成能读的一句话 */
const FIELD_LABELS = {
  qq: 'QQ 号',
  code: '验证码',
  invite_code: '邀请码',
  display_name: '显示名',
  group_id: '群号',
  sender_id: '发送者 QQ 号',
  group_name: '群名',
  sender_name: '发送者备注',
  note: '备注',
  enabled: '启用状态',
  body: '请求体'
}

/**
 * 从异常里取出**能直接给用户看**的一句话。
 *
 * 这是表单页（登录 / 注册 / 订阅）专用的错误解析，和 `humanizeError` 的分工是：
 *   - `humanizeError` 负责「连不上 / 超时 / 401 / 403」这类**链路**问题，兜底用；
 *   - 这里负责把后端**已经写好给人看**的 `detail` 原样取出来（后端文案写得比前端好），
 *     顺便把 FastAPI 校验错误的英文（`detail` 是数组的那一坨）拼成中文。
 *
 * 永不抛异常、永远返回字符串。
 *
 * @param {any} error axios 异常
 * @param {string} [fallback] 完全没有可用信息时的兜底文案
 */
export function readErrorDetail(error, fallback = '请求失败') {
  const response = error && error.response
  if (!response) {
    return isOfflineError(error) ? BACKEND_DOWN_MESSAGE : String((error && error.message) || fallback)
  }
  const data = response.data

  if (data && Array.isArray(data.detail)) {
    const parts = data.detail.map((item) => {
      if (!item || typeof item !== 'object') return String(item)
      const loc = Array.isArray(item.loc) ? item.loc : []
      // loc 形如 ['body','invite_code']；第一个元素是位置（body/query），扔掉
      const field = loc.length > 1 ? String(loc[loc.length - 1]) : ''
      const label = FIELD_LABELS[field] || field
      const msg = item.msg || '格式不对'
      return label ? `${label}：${msg}` : msg
    })
    const joined = parts.filter(Boolean).join('；')
    return joined ? `请求格式不对（${joined}）` : `${fallback}（HTTP ${response.status}）`
  }

  if (data && typeof data.detail === 'string' && data.detail) return data.detail
  if (data && typeof data.error === 'string' && data.error) return data.error
  if (response.status === 401) return '令牌无效或已过期，请重新获取'
  if (response.status === 403) return PROFILES.backend.forbidden
  if (response.status === 404) return '请求的资源不存在'
  if (response.status >= 500) return `后端错误（HTTP ${response.status}）`
  return `${fallback}（HTTP ${response.status}）`
}
