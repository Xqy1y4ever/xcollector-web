import { useAuthStore } from '../stores/auth'

/**
 * 认证路由守卫（纯函数，不 import vue-router 的运行时）。
 *
 * 单独成文件的原因：`router/index.js` 会静态 import 三个 `.vue`（需要 SFC 编译器才能跑），
 * 于是守卫逻辑就没法在「不启动构建」的前提下被断言覆盖。这里只依赖 pinia，
 * 既能被 `router/index.js` 注册，也能被测试直接调用。
 *
 * 三件事：
 *   1. **先 restore 一次**：登录态存在 storage 里，刷新页面时 Pinia state 还是空的。
 *      不在这里恢复，用户一刷新就会被当成未登录踢去登录页。
 *   2. 已登录还去 /login → 回首页（顺手处理「登录成功后按后退」的情况）。
 *   3. 未登录访问受保护路由 → 跳 /login，并把原目标塞进 `query.redirect`，登录成功后跳回去。
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

/**
 * @param {{ path: string, fullPath?: string, query?: object, meta?: object }} to
 * @returns {true | string | { path: string, query: Record<string, string> }}
 */
export function authGuard(to) {
  const auth = useAuthStore()
  // 幂等：main.js 里已经恢复过；这里兜底守卫被单独调用（测试 / 未来换入口）的场景
  if (!auth.restored) auth.restore()

  const path = (to && to.path) || '/'
  const fullPath = (to && to.fullPath) || path
  const query = (to && to.query) || {}
  const isPublic = !!((to && to.meta) || {}).public

  if (isPublic) {
    // 已登录的人不该再看到登录页；有 redirect 就回原目标，没有就回首页
    if (auth.isAuthenticated && path === '/login') {
      const target = safeRedirectTarget(query.redirect)
      if (target === '/login' || target.startsWith('/login?')) return '/'
      return target
    }
    return true
  }

  if (!auth.isAuthenticated) {
    return { path: '/login', query: { redirect: fullPath } }
  }

  return true
}

export default authGuard
