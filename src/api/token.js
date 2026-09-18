/**
 * 当前会话令牌的**模块级持有者**（module-holder）。
 *
 * 现在只有**一种**令牌：UserToken（`xc_...`）。它同时是登录凭证和一切后端调用的凭证
 * —— 后端不认别的（见 xcollector-backend/app/auth.py 的 Scope）。
 *
 * 为什么需要这个文件（循环依赖）：
 *   - `stores/auth.js` 的登录要发请求去校验令牌，所以它必须 import `api/client.js`；
 *   - 而 `api/client.js` 的请求拦截器又要知道「现在该带哪个令牌」，也就是要读 auth store。
 *   两边互相 import 就成环了。
 *
 * 这里选的是**模块级 holder**，而不是「在拦截器里延迟调用 useAuthStore()」：
 *   1. 依赖方向始终单向：`client.js → token.js ← stores/auth.js`，没有任何一边 import 对方，
 *      也就**不存在模块初始化顺序的隐患**（auth store 永远不需要先被实例化）。
 *   2. 拦截器在**请求发生的那一刻**读值，而不是在模块加载时读——登录后立刻生效，无需刷新；
 *      登出/401 清空后也一样立刻生效。
 *   3. Pinia 的 active pinia 只在组件/`app.use(pinia)` 之后才存在；拦截器有可能在
 *      Pinia 装好之前就被触发。holder 是纯变量，没有这个雷。
 *
 * ⚠️ 刻意**没有** `VITE_API_TOKEN` 这类构建期内联的兜底令牌。
 * 旧版本靠它跳过登录页，但多用户之后能填的只有服务令牌（`API_TOKEN`）——
 * 那等于把「以 bot 身份读写所有人的数据」烧进 JS bundle。宁可让开发时多贴一次令牌，
 * 也不留这条路径。
 *
 * ⚠️ 即使是用户令牌，它也是**明文**存在浏览器 storage 里的。它不是完整鉴权，
 * 真正的边界依旧是不要让后端直接暴露到公网（见 README「认证」）。
 */

/** 当前生效的用户令牌；空串 = 未登录 */
let activeToken = ''

/** 取当前用户令牌；没有就返回空串（请求层据此不加 Authorization 头） */
export function getActiveToken() {
  return activeToken
}

/**
 * 由 auth store 调用：写入当前生效的令牌。
 * @param {string} token 用户令牌（`xc_...`），空串表示「没有」
 */
export function setActiveToken(token) {
  activeToken = typeof token === 'string' ? token : ''
}

/** 由 auth store 调用：清空（登出 / 令牌失效） */
export function clearActiveToken() {
  activeToken = ''
}
