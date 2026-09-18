import { useAuthStore } from '../stores/auth'

/**
 * 认证路由守卫（纯函数，不 import vue-router 的运行时）。
 *
 * 单独成文件的原因：`router/index.js` 会静态 import 多个 `.vue`（需要 SFC 编译器才能跑），
 * 于是守卫逻辑就没法在「不启动构建」的前提下被断言覆盖。这里只依赖 pinia，
 * 既能被 `router/index.js` 注册，也能被测试直接调用。
 *
 * 规则（按顺序判断）：
 *   1. **先 restore 一次**：登录态存在 storage 里，刷新页面时 Pinia state 还是空的。
 *      不在这里恢复，用户一刷新就会被当成未登录踢去登录页。
 *   2. 已登录还去 /login 或 /register → 回首页（顺手处理「登录成功后按后退」的情况）。
 *   3. 公开页（`meta.public`）直接放行。
 *   4. 受保护页且没有令牌 → 跳 /login，把原目标塞进 `query.redirect`。
 *   5. 有令牌 → 先做一次**静默校验**（`GET /api/me`），把失效令牌拦在页面前
 *      （401 时请求层自己会清登录态并跳转）；校验不了（后端挂了）则**照常放行**，
 *      用户需要能看到「后端未连接」这个诊断信息。
 */

/**
 * 把 `?redirect=` 收敛成一个**站内**路径。
 * 只接受以单个 `/` 开头的相对路径：`//evil.com` 会被浏览器当成协议相对地址，
 * 直接返回就成了开放重定向，所以这里直接丢掉，退回 `/`。
 */
export function safeRedirectTarget(raw) {
  const value = typeof raw === 'string' ? raw : ''
  if (!value.startsWith('/') || value.startsWith('//')) return '/'
  if (value.includes('\\')) return '/'
  return value
}

/** 登录页：已登录的人不该再看到它 */
const AUTH_PAGES = ['/login']

/**
 * 注意 `/register` **刻意不在这个名单里**：令牌丢了的用户需要能再走一遍注册流程
 * 换一个新令牌，而那时他很可能还处于「storage 里有个坏令牌」的状态。
 * 注册页对已登录的人是合法的入口。
 */
function isAuthPage(path) {
  return AUTH_PAGES.indexOf(path) === 0
}

/**
 * @param {{ path: string, fullPath?: string, query?: object, meta?: object }} to
 * @returns {true | string | { path: string, query: Record<string, string> } | Promise<any>}
 */
export function authGuard(to) {
  const auth = useAuthStore()
  // 幂等：main.js 里已经恢复过；这里兜底守卫被单独调用（测试 / 未来换入口）的场景
  if (!auth.restored) auth.restore()

  const path = (to && to.path) || '/'
  const fullPath = (to && to.fullPath) || path
  const query = (to && to.query) || {}
  const meta = (to && to.meta) || {}

  if (isAuthPage(path)) {
    if (!auth.isAuthenticated) return true
    // 已登录的人回原目标；目标本身是登录页时退回首页（否则自我循环）
    const target = safeRedirectTarget(query.redirect)
    if (isAuthPage(target)) return '/'
    return target
  }

  // 公开页（/register）永远放行：它是「换一个新令牌」的入口，已登录也要能进
  if (meta.public) return true

  if (!auth.isAuthenticated) {
    return { path: '/login', query: { redirect: fullPath } }
  }

  // 已经校验过就同步放行，别再发一次请求（否则每次路由切换都打一次 /api/me）
  if (auth.verified) return true

  // 返回 Promise：vue-router 会等它。401 时请求层已把页面送去 /login，
  // 这里只需保证不把用户放进一个必然取不到数据的页面。
  return auth.verifySession().then((ok) => {
    if (ok) return true
    // 令牌被清掉了（401 / 服务令牌）→ 走正常跳转；只是网络问题则放行
    if (!auth.isAuthenticated) return { path: '/login', query: { redirect: fullPath } }
    return true
  })
}

export default authGuard
