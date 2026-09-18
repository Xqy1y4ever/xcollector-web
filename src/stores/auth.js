import { defineStore } from 'pinia'

import { fetchMe } from '../api/user'
import { registerUnauthorizedHandler } from '../api/client'
import { clearActiveToken, setActiveToken } from '../api/token'

/**
 * 认证 store：**只有一个令牌，一个范围**。
 *
 *   UserToken（`xc_...`）—— 用户在登录页粘贴、或在注册页拿到的那串东西。
 *     它同时是登录凭证和一切后端调用的凭证：后端从它定出 user_id，
 *     所有数据（通知、订阅）都按这个 user_id 隔离。
 *
 * 服务令牌（`API_TOKEN`）**永远不该出现在这个前端里**：它能让持有者以 bot 的身份
 * 读写所有人的数据。所以登录时一旦发现 `/api/me` 回的是 `"scope":"service"`，
 * 立刻拒绝并把话说清楚（见 login()）。
 *
 * 「我是谁」是**真的去问后端**（`GET /api/me`），不是本地解析令牌：
 *   - 令牌对不对，只有后端知道（库里存的是 sha256）；
 *   - 令牌可能已被轮换（同一个 QQ 重新走一次注册就会换新令牌），本地看不出来。
 *
 * ⚠️ 令牌是明文存在浏览器 storage 里的。任何能在这台浏览器上执行 JS 的东西都能读到它；
 * XSS 会泄露它。所以它只能挡住「没有令牌的随手访问」，真正的边界是不要让后端暴露到公网。
 */

/** 存储 key。只保留 token 与 remember：服务令牌那条路径已经删掉了 */
export const STORAGE_KEYS = {
  token: 'xc.auth.token',
  remember: 'xc.auth.remember'
}

/**
 * 安全地拿一个 Storage。浏览器禁用 storage（隐私模式 / iframe 限制）时访问会抛异常，
 * 这里吞掉异常返回 null，绝不让「存不了令牌」变成白屏。
 * @param {'local'|'session'} kind
 */
function resolveStorage(kind) {
  try {
    const store = kind === 'local' ? window.localStorage : window.sessionStorage
    return store || null
  } catch (e) {
    return null
  }
}

function safeGet(storage, key) {
  if (!storage) return ''
  try {
    const value = storage.getItem(key)
    return typeof value === 'string' ? value : ''
  } catch (e) {
    return ''
  }
}

function safeSet(storage, key, value) {
  if (!storage) return
  try {
    storage.setItem(key, value)
  } catch (e) {
    // 配额满 / 被禁用：忽略，本次会话内存里仍然可用
  }
}

function safeRemove(storage, key) {
  if (!storage) return
  try {
    storage.removeItem(key)
  } catch (e) {
    // 同上
  }
}

/** 往指定的一边写入两个 key */
function writeTo(kind, token) {
  const storage = resolveStorage(kind)
  if (!storage) return
  safeSet(storage, STORAGE_KEYS.token, token)
  safeSet(storage, STORAGE_KEYS.remember, kind === 'local' ? '1' : '0')
}

/** 清掉指定一边的两个 key */
function clearFrom(kind) {
  const storage = resolveStorage(kind)
  if (!storage) return
  safeRemove(storage, STORAGE_KEYS.token)
  safeRemove(storage, STORAGE_KEYS.remember)
}

/**
 * 清掉**两边**的残留。登出、以及令牌失效（401）时用。
 * 必须两边都清：否则「上次勾了记住我、这次没勾」的情况下，localStorage 里的旧令牌
 * 会在下次刷新时把人重新「恢复」成登录态。
 */
function clearBoth() {
  clearFrom('local')
  clearFrom('session')
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    /** 当前用户令牌（明文，见文件头注释的警告） */
    token: '',
    /** `/api/me` 返回的当前用户 `{ id, qq, display_name, token_hint, ... }` */
    user: null,
    /** 用户是否勾了「记住我」：true 存 localStorage，false 存 sessionStorage */
    remember: true,
    /** 是否已经尝试过从 storage 恢复（防止守卫里重复恢复） */
    restored: false,
    /** 本会话是否已经成功问过后端「我是谁」 */
    verified: false,
    /** 正在进行的校验（Promise 或 null）；并发调用共用同一个，见 verify() */
    verifying: null
  }),

  getters: {
    /** 有令牌即视为「已登录本地态」；令牌是否真的有效由 verified 说明 */
    isAuthenticated: (state) => !!state.token,
    /** 顶部账号区显示的名字：显示名 → QQ 号 → 令牌提示 */
    displayName: (state) => {
      const u = state.user || {}
      return u.display_name || (u.qq ? `QQ ${u.qq}` : '') || u.token_hint || '已登录'
    }
  },

  actions: {
    /**
     * 从 storage 恢复登录态。进 app 时（main.js / 路由守卫）调用**一次**即可，
     * 重复调用是幂等的。
     *
     * 优先级：**先 sessionStorage 再看 localStorage**。
     * 理由：session 里的令牌是「本次标签页会话」写下的，比可能残留的 local 值更新；
     * 且用户刚把「记住我」从勾选改成不勾选时，本次会话写的就是 session。
     * 找到值之后顺手把另一边的残留清掉，避免两边打架。
     *
     * @returns {boolean} 是否恢复了令牌
     */
    restore() {
      const sessionStore = resolveStorage('session')
      const localStore = resolveStorage('local')

      const sessionToken = safeGet(sessionStore, STORAGE_KEYS.token)
      const localToken = safeGet(localStore, STORAGE_KEYS.token)

      let source = null
      let token = ''
      if (sessionToken) {
        source = 'session'
        token = sessionToken
      } else if (localToken) {
        source = 'local'
        token = localToken
      }

      if (source) {
        const from = source === 'session' ? sessionStore : localStore
        this.token = token
        this.remember = safeGet(from, STORAGE_KEYS.remember) !== '0'
        // 另一边的残留必须清掉，否则「上次记住我 / 这次不记住」会互相打架
        clearFrom(source === 'session' ? 'local' : 'session')
      }

      setActiveToken(this.token)
      this.restored = true
      return this.isAuthenticated
    },

    /**
     * 真的去问后端「这个令牌是谁」。
     *
     * 四种结果分得很清楚：
     *   - 200 且 scope=user  → 通过，记下 user；
     *   - 200 且 scope=service → **不是你的令牌**，清掉并报错（服务令牌是 bot 的）；
     *   - 401 → 清掉存储并返回「令牌失效」（请求拦截器同时会把页面送回登录页）；
     *   - 网络错误 / 5xx → **保留令牌**，返回 ok:false + `warning`。
     *     理由：后端挂着的时候把登录态一起清掉，用户会以为是自己令牌坏了，
     *     反而拿不到「后端未连接」这个真正的诊断信息。登录页据此**放行但提醒**。
     *
     * 并发调用共用同一个 promise：main.js 与路由守卫都会在首屏触发校验，
     * 如果第二次直接返回「正在校验」，守卫会把它当成失败、把用户踢去登录页。
     *
     * @returns {Promise<{ ok: boolean, error?: string, warning?: string }>}
     */
    async verify() {
      const rawToken = typeof this.token === 'string' ? this.token.trim() : ''
      if (!rawToken) return { ok: false, error: '没有令牌' }
      if (this.verifying) return this.verifying

      const task = (async () => {
        try {
          const data = await fetchMe()
          if (data && data.scope === 'service') {
            // 服务令牌能通过 /api/me，但它不是「你的」登录凭证
            this.logout()
            return { ok: false, error: '这是服务端令牌，不是你的登录令牌' }
          }
          if (data && data.scope === 'user' && data.user) {
            this.user = data.user
            this.verified = true
            return { ok: true }
          }
          // 形状不认识：不敢当成登录成功
          return { ok: false, error: '后端返回的 /api/me 形状不认识，请确认后端版本' }
        } catch (err) {
          const status = err && err.response ? err.response.status : 0
          if (status === 401) {
            // 用 logout() 而不是只清内存：storage 里的坏令牌必须一起清掉，
            // 否则刷新页面时 restore() 会把它捞回来，形成「刷新即踢」的循环。
            this.logout()
            return { ok: false, error: '令牌无效或已过期，请重新获取' }
          }
          // 5xx / 超时 / 连不上：**保留登录态**（后端挂了不等于令牌坏了），
          // 只给一句提示；verified 置回 false，下次进页面会再试一次。
          this.verified = false
          const label = status ? `后端返回错误（HTTP ${status}）` : '后端不可达'
          return { ok: false, warning: `${label}，这次没能校验令牌`, error: `${label}，无法校验令牌` }
        } finally {
          this.verifying = null
        }
      })()

      this.verifying = task
      return task
    },

    /**
     * 页面加载时的静默校验：只处理 401 与「服务令牌」两种情况，
     * 网络错误一律不动登录态（否则后端一挂，用户就被踢回登录页，还看不出原因）。
     *
     * @param {{ force?: boolean }} [opts] force=true 时忽略「本会话已校验过」
     */
    async verifySession(opts = {}) {
      if (!this.isAuthenticated) return false
      if (this.verified && !opts.force) return true
      const result = await this.verify({ silent: true })
      return !!result.ok
    },

    /**
     * 登录：**真的去校验令牌**，通过之后才写入 storage。
     *
     * 「后端不可达 / 5xx」时**放行但带回 warning**：那时用户最需要看的就是状态页
     * （那里正显示「后端不可达」），把登录卡死反而让人没法诊断。
     * 代价是令牌没被验证过，这一点必须由登录页明确说出来。
     *
     * @param {string} token 用户令牌（`xc_...`）
     * @param {boolean} [remember] 是否记住（默认 true）
     * @returns {Promise<{ ok: boolean, error?: string, warning?: string }>}
     */
    async login(token, remember) {
      const rawToken = typeof token === 'string' ? token.trim() : ''
      const useRemember = remember !== false

      if (!rawToken) return { ok: false, error: '请输入你的登录令牌' }

      // 先落到 store，verify() 是从 state 读令牌的
      this.token = rawToken
      setActiveToken(rawToken)

      const result = await this.verify()
      // result.warning 非空 = 只是「校验不了」（后端挂了），仍然放行
      if (!result.ok && !result.warning) {
        // 令牌真的不对（401 / 服务令牌 / 形状不认识）：绝不留痕
        this.logout()
        return { ok: false, error: result.error || '令牌校验失败' }
      }

      this.remember = useRemember
      this.restored = true
      // verified 保持 verify() 写下的值：校验不了时是 false，下次进页面会再试一次
      writeTo(useRemember ? 'local' : 'session', rawToken)
      // 切换 remember 时把另一边清干净
      clearFrom(useRemember ? 'session' : 'local')
      if (result.warning) return { ok: true, warning: result.warning }
      return { ok: true }
    },

    /**
     * 注册页拿到令牌后直接进入应用：令牌已经是后端刚签发的，不需要再校验一次。
     * @param {string} token
     * @param {object} user
     * @param {boolean} [remember]
     */
    adopt(token, user, remember = true) {
      const rawToken = typeof token === 'string' ? token.trim() : ''
      if (!rawToken) return false
      this.token = rawToken
      this.user = user || null
      this.remember = remember !== false
      this.restored = true
      this.verified = true
      writeTo(this.remember ? 'local' : 'session', rawToken)
      clearFrom(this.remember ? 'session' : 'local')
      setActiveToken(rawToken)
      return true
    },

    /**
     * 登出：两边 storage 都清掉，请求层立刻停止带令牌。
     *
     * 登录/校验失败（401、服务令牌）时也走这里，而不是只清内存 ——
     * storage 里的坏令牌必须一起清掉，否则刷新页面时 restore() 会把它捞回来，
     * 形成「刷新即踢」的循环。
     */
    logout() {
      this.token = ''
      this.user = null
      this.verified = false
      this.restored = true
      clearBoth()
      clearActiveToken()
    }
  }
})

/**
 * 把「令牌失效」的收尾动作注册给请求层（`src/api/client.js`）。
 *
 * 为什么是**注册**而不是让 client.js 直接 import 本文件：本文件顶层就 import 了
 * client.js（要用它发的请求校验令牌），client.js 反过来 import 本文件就成环了。
 * 旧版本在 client.js 里写的是 `import('../stores/auth')` 动态导入 —— 环是躲开了，
 * 但 vite 会警告「本模块既被动态 import 又被多处静态 import，动态 import 分不出
 * 独立 chunk」，等于白写。注册表让依赖方向保持单向：只有 auth → client 这一条边。
 *
 * 这里用的是 store **外部**的 `useAuthStore()`：401 发生时 Pinia 一定已经装好了
 * （任何请求都晚于 app.use(createPinia())），所以不存在「no active Pinia」的问题。
 *
 * 注意**只传 logout，不传跳转**：跳转由 client.js 负责（它手里有导航持有者），
 * 而「已经在 /login 上就别再跳」这类防死循环的判断也只该有一处实现。
 */
registerUnauthorizedHandler(() => {
  useAuthStore().logout()
})

export default useAuthStore
