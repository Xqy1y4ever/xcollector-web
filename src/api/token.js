/**
 * 当前会话令牌的**模块级持有者**（module-holder）。
 *
 * 为什么需要这个文件（循环依赖）：
 *   - `stores/auth.js` 的 `login()` 要发一个请求去校验 token，所以它必须 import `api/client.js`；
 *   - 而 `api/client.js` 的请求拦截器又要知道「现在该带哪个 token」，也就是要读 auth store。
 *   两边互相 import 就成环了。
 *
 * 这里选的是**模块级 holder**，而不是「在拦截器里延迟调用 useAuthStore()」：
 *   1. 依赖方向始终单向：`client.js → token.js ← stores/auth.js`，没有任何一边 import 对方，
 *      也就**不存在模块初始化顺序的隐患**（auth store 永远不需要先被实例化）。
 *   2. 拦截器在**请求发生的那一刻**读值，而不是在模块加载时读——登录后立刻生效，无需刷新；
 *      登出/401 清空后也一样立刻生效。
 *   3. Pinia 的 active pinia 只在组件/`app.use(pinia)` 之后才存在；拦截器有可能在
 *      Pinia 装好之前就被触发（例如 main.js 里的 restore 探针），延迟调用 store 会抛
 *      「no active Pinia」。holder 是纯变量，没有这个雷。
 *
 * ⚠️ 安全：这里存的仍然是**明文共享密钥**，只是从「构建期内联」改成「运行时放在内存/浏览器
 * storage 里」。它不是完整鉴权，真正的边界依旧是不要把端口暴露到公网（见 README「认证」）。
 */

/** store 没恢复过任何 token 时的兜底：构建期内联的预置令牌（开发 / CI 用），可为空串 */
export const ENV_TOKEN = import.meta.env.VITE_API_TOKEN || ''

/** bot 专用预置令牌；通常留空（契约：整套系统只有一个共享密钥，bot 会回退用 API_TOKEN） */
export const ENV_BOT_TOKEN = import.meta.env.VITE_BOT_API_TOKEN || ''

/** 当前生效的后端令牌（`/api` 用） */
let activeToken = ENV_TOKEN

/** 当前生效的 bot 令牌（`/bot` 用） */
let activeBotToken = ENV_BOT_TOKEN

/** 取后端令牌；store 里没有时回退到预置的 `VITE_API_TOKEN` */
export function getActiveToken() {
  return activeToken || ENV_TOKEN
}

/** 取 bot 令牌；store 里没有时先回退 store 的 token，再回退 `VITE_BOT_API_TOKEN` */
export function getActiveBotToken() {
  return activeBotToken || activeToken || ENV_BOT_TOKEN
}

/**
 * 由 auth store 调用：写入当前生效的令牌。
 * @param {string} token 后端令牌，空串表示「没有」
 * @param {string} [botToken] bot 专用令牌，留空表示与 token 相同
 */
export function setActiveTokens(token, botToken) {
  activeToken = token || ''
  activeBotToken = botToken || ''
}

/** 由 auth store 调用：清空（登出 / 401）。清空后回落到 env 预置值 */
export function clearActiveTokens() {
  activeToken = ''
  activeBotToken = ''
}
