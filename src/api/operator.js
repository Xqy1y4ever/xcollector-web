/**
 * 运营者令牌（bot 的管理令牌 `API_TOKEN` / `BOT_API_TOKEN`）的持有者。
 *
 * ## 它跟 UserToken 是两套东西，别混
 *
 *   UserToken（`xc_...`）—— 每个用户自己的凭据，后端认它，数据按它隔离。
 *   API_TOKEN        —— bot 的管理令牌，bot 的 `/api/*` 只认它。
 *
 * 系统状态页是**运营者视角**：里面是所有人的盲区计数、白名单、OneBot 连接状态，
 * 所以 bot 刻意不让普通用户看到（见 xcollector-bot/app/auth.py 的注释）。
 * 也就是说「没填令牌 → 看不到状态页」是**设计如此**，不是坏了。
 *
 * ## 为什么只放 sessionStorage
 *
 * - **绝不进 localStorage**：那会让令牌在这台机器上长期驻留，而它比 UserToken
 *   危险得多（bot 的全部管理接口都认它，包括真的往 QQ 发消息）。
 * - **绝不进 bundle**：没有 `VITE_*` 预置变量，构建产物里不可能有它。
 * - 只活在本次标签页会话里：关掉标签页就没了，符合「运营者临时来查一眼」的用法。
 *
 * 这里仍然只是**明文**存在浏览器里（见 README「认证」的警告），所以状态页也要求
 * 不要把它填在公共电脑上。
 */

/** sessionStorage 的 key。名字里带 operator，跟用户登录态（xc.auth.token）区分开 */
export const OPERATOR_TOKEN_KEY = 'xc.operator.token'

/** 当前生效的运营者令牌；空串 = 没填 */
let activeOperatorToken = ''

/** 读一个 Storage，被禁用（隐私模式）时返回 null，绝不让它变成白屏 */
function resolveSessionStorage() {
  try {
    return window.sessionStorage || null
  } catch (e) {
    return null
  }
}

/**
 * 从 sessionStorage 恢复运营者令牌。进状态页时调用一次即可，幂等。
 * @returns {boolean} 是否恢复到了非空令牌
 */
export function restoreOperatorToken() {
  const storage = resolveSessionStorage()
  if (!storage) return false
  try {
    const value = storage.getItem(OPERATOR_TOKEN_KEY)
    activeOperatorToken = typeof value === 'string' ? value.trim() : ''
  } catch (e) {
    activeOperatorToken = ''
  }
  return !!activeOperatorToken
}

/** 当前生效的运营者令牌；没有就返回空串（调用方据此决定「干脆别发请求」） */
export function getOperatorToken() {
  return activeOperatorToken
}

/** 有没有填运营者令牌。没填时状态页不调 `/bot/*`，直接显示说明 */
export function hasOperatorToken() {
  return !!activeOperatorToken
}

/**
 * 写入运营者令牌（内存 + sessionStorage）；传空串等于清掉。
 * @param {string} token
 */
export function setOperatorToken(token) {
  const value = typeof token === 'string' ? token.trim() : ''
  activeOperatorToken = value
  const storage = resolveSessionStorage()
  if (!storage) return
  try {
    if (value) storage.setItem(OPERATOR_TOKEN_KEY, value)
    else storage.removeItem(OPERATOR_TOKEN_KEY)
  } catch (e) {
    // 配额满 / 被禁用：内存里仍然可用，本次会话不受影响
  }
}

/** 清掉运营者令牌（401 之后让用户重填，以及「退出运营者视图」按钮） */
export function clearOperatorToken() {
  setOperatorToken('')
}

/**
 * 令牌的展示形态：只露头尾各 4 个字符。
 * 状态页要显示「现在用的是哪个令牌」，但完整值不该一直挂在屏幕上。
 */
export function maskOperatorToken(token) {
  const value = typeof token === 'string' ? token.trim() : ''
  if (!value) return ''
  if (value.length <= 10) return `${value.slice(0, 2)}****`
  return `${value.slice(0, 4)}……${value.slice(-4)}`
}
