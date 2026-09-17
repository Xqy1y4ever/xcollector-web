import { defineStore } from 'pinia'

import { fetchBackendHealth, isServerError } from '../api/client'
import { clearActiveTokens, setActiveTokens } from '../api/token'

/**
 * 认证 store：**两个令牌，两个范围**（契约见 xcollector-backend/docs/api.md「通用约定」）。
 *
 *   网页令牌 WEB_API_TOKEN —— 用户在登录页输入的。后端与 bot 都认它，但它只能
 *     **读取、提交人工修正、标记已读**；写接口一律 403。
 *   管理令牌 API_TOKEN / BOT_API_TOKEN —— 只在服务器上，登录页「高级」里可选填。
 *     填了这个浏览器就解锁「发送到 QQ」这类会真的动手的操作。
 *
 * 后端所有 `/api` 都要求 `Authorization: Bearer <令牌>`。以前是 Docker 里的 nginx
 * 无条件注入 token（任何能访问到 8080 端口的人都能进来），现在改成认证在前端做：
 * nginx 原样转发浏览器带的 `Authorization`，所以必须由用户在登录页输入 token。
 *
 * 为什么读也用网页令牌、而不是让管理令牌顶替一切：管理令牌是**全权**的，
 * 不该为了看个列表就把它留在浏览器里。所以即使「高级」里填了管理令牌，
 * 读接口仍然走网页令牌（见 effectiveBotToken 与 token.js）。
 *
 * ⚠️ 这仍然不是按用户的账号体系：所有拿同一个网页令牌登录的人权限完全一样。
 * 分级只解决"泄露网页令牌会不会导致数据被改"，不解决"谁看了什么"。
 * 真正的边界仍然是不要把端口暴露到公网，并且上 HTTPS（见 README「认证」）。
 */

/** 两种存储共用同一组 key，便于 `restore()` 两边都看一眼 */
export const STORAGE_KEYS = {
  token: 'xc.auth.token',
  botToken: 'xc.auth.botToken',
  remember: 'xc.auth.remember'
}

/**
 * 安全地拿一个 Storage。浏览器禁用 storage（隐私模式 / iframe 限制）时访问会抛异常，
 * 这里吞掉异常返回 null，绝不让「存不了 token」变成白屏。
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

/** 往指定的一边写入三个 key */
function writeTo(kind, token, botToken) {
  const storage = resolveStorage(kind)
  if (!storage) return
  safeSet(storage, STORAGE_KEYS.token, token)
  // botToken 为空时也写空串：`restore()` 用「键存在」判断是否恢复，写空串保证语义明确
  safeSet(storage, STORAGE_KEYS.botToken, botToken || '')
  safeSet(storage, STORAGE_KEYS.remember, kind === 'local' ? '1' : '0')
}

/** 清掉指定一边的三个 key */
function clearFrom(kind) {
  const storage = resolveStorage(kind)
  if (!storage) return
  safeRemove(storage, STORAGE_KEYS.token)
  safeRemove(storage, STORAGE_KEYS.botToken)
  safeRemove(storage, STORAGE_KEYS.remember)
}

/**
 * 清掉**两边**的残留。登出、以及登录失败（401）时用。
 * 必须两边都清：否则「上次勾了记住我、这次没勾」的情况下，localStorage 里的旧 token
 * 会在下次刷新时把人重新「恢复」成登录态。
 */
function clearBoth() {
  clearFrom('local')
  clearFrom('session')
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    /** 后端共享密钥（明文，见文件头注释的警告） */
    token: '',
    /** bot 专用令牌；空串 = 与 token 相同 */
    botToken: '',
    /** 用户是否勾了「记住我」：true 存 localStorage，false 存 sessionStorage */
    remember: true,
    /** 是否已经尝试过从 storage 恢复（防止守卫里重复恢复） */
    restored: false
  }),

  getters: {
    /** 有 token 即视为已登录（本地态，不做在线校验） */
    isAuthenticated: (state) => !!state.token,
    /** 实际发给 /bot 的令牌：没填管理令牌时退回网页令牌（读接口两种都能用） */
    effectiveBotToken: (state) => state.botToken || state.token
  },

  actions: {
    /**
     * 从 storage 恢复登录态。进 app 时（main.js / 路由守卫）调用**一次**即可，
     * 重复调用是幂等的。
     *
     * 优先级：**先 sessionStorage 再看 localStorage**。
     * 理由：session 里的 token 是「本次标签页会话」写下的，比可能残留的 local 值更新；
     * 且用户刚把「记住我」从勾选改成不勾选时，本次会话写的就是 session。
     * 找到值之后顺手把另一边的残留清掉，避免两边打架。
     *
     * 两边都没有时**不动任何 storage**：保留 env 预置令牌这条降级路径
     * （`VITE_API_TOKEN`，见 src/api/token.js），方便不用登录页的开发 / CI 场景。
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
        this.botToken = safeGet(from, STORAGE_KEYS.botToken)
        this.remember = safeGet(from, STORAGE_KEYS.remember) === '1'
        // 另一边的残留必须清掉，否则「上次记住我 / 这次不记住」会互相打架
        clearFrom(source === 'session' ? 'local' : 'session')
      }

      // 无论有没有从 storage 拿到值，都把当前生效令牌同步给请求层。
      // 没有 storage 值时 setActiveTokens('') 会让 client.js 回落到 env 预置令牌。
      setActiveTokens(this.token, this.botToken)
      this.restored = true
      return this.isAuthenticated
    },

    /**
     * 登录：**真的去校验 token**，不是只存下来。
     *
     * 校验方式是 `GET /api/health`（该接口要求认证，契约第 7 节）：
     *   - 2xx  → 通过
     *   - 401/403 → `{ ok:false, error:'token 不正确' }`，**不写入任何 storage**
     *   - 网络错误 / 5xx → **允许进入**，但带 warning。
     *     理由：后端挂着的时候，用户最需要看的就是状态页——那里正显示「后端不可达」。
     *     把登录卡死反而让人没法诊断。
     *
     * 成功后才写 storage：remember=true → localStorage，false → sessionStorage，
     * 并清掉另一边，保证「撤销记住我」真的能生效。
     *
     * @param {string} token 后端 API_TOKEN
     * @param {string} [botToken] 可选的 bot 专用令牌，留空则与 token 相同
     * @param {boolean} [remember] 是否记住（默认 true）
     * @returns {Promise<{ ok: boolean, error?: string, warning?: string }>}
     */
    async login(token, botToken, remember) {
      const rawToken = typeof token === 'string' ? token.trim() : ''
      const rawBotToken = typeof botToken === 'string' ? botToken.trim() : ''
      const useRemember = remember !== false

      if (!rawToken && !rawBotToken) {
        return { ok: false, error: '请输入访问令牌' }
      }

      // 没有填后端令牌（后端 API_TOKEN 留空的部署，只有 bot 令牌）时没有可校验的东西，
      // 直接进入：这时候去打 /api/health 反而可能被 env 预置令牌搅成 401。
      const needVerify = !!rawToken
      /** 校验不了但允许进入时的黄色提示（null = 校验通过或无需校验） */
      let warning = null
      try {
        if (needVerify) {
          // skipStoreToken=true：认证探针自己带 token，不走「当前登录态」那套默认值，
          // 否则上一次失败登录残留的令牌会把这次输入覆盖掉。
          // authCheck=true：给响应拦截器打标记，它自己的 401 不能触发登出跳转（防死循环）。
          await fetchBackendHealth({ authToken: rawToken, skipStoreToken: true, authCheck: true })
        }
        // 2xx（或跳过校验）：通过
      } catch (err) {
        // 判定顺序很重要：
        //   ① 有 response 且 401/403 → 密钥不对
        //   ② 有 response 且 5xx     → 后端自己坏了，放行
        //   ③ 没有 response          → 网络错误 / 超时，放行
        // 注意不能先问 isAuthCheckError(err)：那个标记只说明「这是登录探针发的请求」，
        // 它不区分后端到底回了 401 还是压根没连上（探针请求永远带这个标记）。
        const status = err && err.response ? err.response.status : 0
        if (status === 401 || status === 403) {
          // 密钥不对，绝不留痕迹
          return { ok: false, error: 'token 不正确' }
        }
        warning = isServerError(err)
          ? '后端返回服务端错误，无法验证 token；你仍然可以进入，但状态页可能也取不到数据'
          : '后端不可达，无法验证 token；你仍然可以进入，但状态页可能也取不到数据'
      }

      // 走到这里 = 校验通过，或「校验不了但仍然放行」，两种情况都要把令牌存下来
      this.token = rawToken
      this.botToken = rawBotToken
      this.remember = useRemember
      this.restored = true

      const kind = useRemember ? 'local' : 'session'
      writeTo(kind, rawToken, rawBotToken)
      // 切换 remember 时把另一边清干净
      clearFrom(useRemember ? 'session' : 'local')
      setActiveTokens(rawToken, rawBotToken)
      return warning ? { ok: true, warning } : { ok: true }
    },

    /** 登出：两边 storage 都清掉，请求层立刻停止带 token */
    logout() {
      this.token = ''
      this.botToken = ''
      this.restored = true
      clearBoth()
      clearActiveTokens()
    }
  }
})

export default useAuthStore
