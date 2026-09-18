import { defineStore } from 'pinia'

import { getStatus, previewDigest as apiPreviewDigest } from '../api/bot'
import { fetchBackendHealth } from '../api/client'
import {
  BOT_DOWN_MESSAGE,
  BOT_NOT_OPERATOR_MESSAGE,
  BOT_OPERATOR_REJECTED_MESSAGE,
  humanizeError,
  isOfflineError
} from '../api/errors'
import {
  clearOperatorToken,
  getOperatorToken,
  hasOperatorToken,
  maskOperatorToken,
  restoreOperatorToken,
  setOperatorToken as setOperatorTokenValue
} from '../api/operator'
import {
  EMPTY_BOT_STATUS,
  blindspotCounts,
  connectionState as mapConnectionState,
  connectionText as mapConnectionText,
  normalizeBotStatus
} from '../utils/healthStatus'

/** 深拷贝一份默认 status，避免多个实例共享同一个对象 */
function emptyStatus() {
  return JSON.parse(JSON.stringify(EMPTY_BOT_STATUS))
}

/** status 多久算「还新鲜」，在此之内不重复打 bot（顶栏角标会用到） */
const STATUS_FRESH_MS = 30 * 1000

/**
 * 系统状态 store（**运营者视图**）。
 *
 * 数据来源（契约第 9 节）：
 *  - bot `/api/status` → OneBot / LLM / 白名单 / 流水线 / 盲区 / 群 / 缺口 / digest
 *  - 后端 `/api/health` → **只用来探「后端可达性」**（存储自身），
 *    因为 bot 活着但后端挂了是最重要的运维故障，不能只信 bot 自报。
 *
 * ## 这一页为什么需要运营者令牌
 *
 * bot 的 `/api/*` 只认它自己的管理令牌（`API_TOKEN` / `BOT_API_TOKEN`），
 * 而普通用户手里只有自己的 UserToken。这是**刻意**的：状态页里有所有人的
 * 盲区计数、白名单、OneBot 连接状态，不该让任何一个普通用户看到。
 *
 * 于是这里的状态机有三段，页面必须分开呈现，绝不能都写成「bot 不可达」：
 *   1. `operatorConfigured === false` → **没填令牌，压根没发请求**。
 *      页面显示「为什么看不到」+ 输入框，不是错误。
 *   2. `operatorRejected === true` → 填了但 bot 说 401。提示重填，
 *      **绝不碰用户的登录态**（那是另一套令牌）。
 *   3. 有令牌且请求成功/网络失败 → 正常展示，网络失败才说「bot 不可达」。
 */
export const useHealthStore = defineStore('health', {
  state: () => ({
    /** 规范化后的 bot status（形状见 utils/healthStatus.js） */
    status: emptyStatus(),
    /** 后端可达性探针结果：{ checked, ok, message, checkedAt, counts } */
    backendProbe: { checked: false, ok: false, message: '', checkedAt: null, counts: null },
    loading: false,
    error: null,
    /** 出错的 HTTP 状态码（0 = 网络层没连上）。用来区分 401 与「bot 没起来」 */
    errorStatus: 0,
    /** true = bot 根本没连上（区别于 bot 返回了错误码） */
    offline: false,
    lastLoadedAt: null,
    lastStatusAt: null,
    /** 本会话有没有填写运营者令牌（决定「要不要调 bot」） */
    operatorConfigured: false,
    /** 运营者令牌的掩码形态，页面上显示「现在用的是哪一串」 */
    operatorHint: '',
    /** digest 预览 */
    digestText: '',
    digestLoading: false,
    digestDialogVisible: false,
    /** 预览的是谁的 digest（bot 会给回来，必须显示，免得以为是自己的） */
    digestUserId: '',
    digestUserQq: ''
  }),

  getters: {
    /** OneBot 是否连接（嵌套在 status.onebot 里，不再是顶层字段） */
    onebotConnected: (state) =>
      !!(state.status && state.status.onebot && state.status.onebot.connected),

    /** 顶栏状态点：'ok' | 'down' | 'unknown' */
    connectionState: (state) => mapConnectionState(state.status, state.error),

    /** 顶栏状态点的一行文案 */
    connectionText: (state) => mapConnectionText(state.status, state.error),

    /** bot 是否可达（status 拿到了就算可达） */
    botReachable: (state) => !state.error && !!state.lastStatusAt,

    /** 后端可达性（探针成功才算，见 utils/healthStatus.js 的 backendReachability） */
    backendReachable: (state) => !!(state.backendProbe && state.backendProbe.checked && state.backendProbe.ok),

    /** 盲区计数（含缺口条数），页面与顶栏共用同一处口径 */
    blindspotCounts: (state) =>
      blindspotCounts(state.status.blindspots, (state.status.gap_alerts || []).length),

    /** 是否存在盲区（任一项 > 0 或今日降级） */
    hasBlindSpot() {
      return this.blindspotCounts.total > 0
    },

    /** 顶栏角标用：只数解析类盲区 + 降级，不含缺口 */
    blindspotBadgeCount() {
      return this.blindspotCounts.withoutGaps
    },

    day: (state) => state.status.day || '',

    /** status 是否还在保鲜期内（避免顶栏在每个页面都重打一次 bot） */
    isStatusFresh: (state) => {
      if (!state.lastStatusAt) return false
      return Date.now() - state.lastStatusAt < STATUS_FRESH_MS
    },

    /** bot 拒绝了运营者令牌（401/403）—— 与「bot 挂了」是两回事 */
    operatorRejected: (state) => state.errorStatus === 401 || state.errorStatus === 403,

    /**
     * 页面顶部那条提示要说什么。
     * @returns {{ type: 'info'|'warning'|'error', title: string, detail: string }}
     */
    notice(state) {
      if (!state.operatorConfigured) {
        return {
          type: 'info',
          title: '这一页需要运营者令牌（还没有填写）',
          detail: BOT_NOT_OPERATOR_MESSAGE
        }
      }
      if (state.operatorRejected) {
        return {
          type: 'warning',
          title: '运营者令牌无效',
          detail: BOT_OPERATOR_REJECTED_MESSAGE
        }
      }
      if (state.error) {
        return {
          type: 'error',
          title: state.error,
          detail:
            '已经填了运营者令牌，但 bot 没有响应。请确认 bot 进程在跑、' +
            '/bot 代理指向它（本机调试时是 vite 的 dev 代理），然后再刷新。'
        }
      }
      return { type: 'info', title: '', detail: '' }
    }
  },

  actions: {
    /**
     * 从 sessionStorage 恢复运营者令牌（同时把掩码写进 state）。
     * 进系统状态页时调用一次。**只碰 sessionStorage，不碰登录态。**
     * @returns {boolean} 是否已有令牌
     */
    restoreOperator() {
      const configured = restoreOperatorToken()
      this.operatorConfigured = configured
      this.operatorHint = configured ? maskOperatorToken(getOperatorToken()) : ''
      return configured
    },

    /**
     * 用户填了（或清空了）运营者令牌。清空时把之前的状态一起复位，
     * 免得页面上留着上一串令牌换来的数字。
     */
    setOperatorToken(value) {
      if (typeof value === 'string' && value.trim()) {
        setOperatorTokenValue(value)
        this.operatorConfigured = true
        this.operatorHint = maskOperatorToken(value)
        return
      }
      clearOperatorToken()
      this.operatorConfigured = false
      this.operatorHint = ''
      this.status = emptyStatus()
      this.error = null
      this.errorStatus = 0
      this.offline = false
      this.lastStatusAt = null
      this.lastLoadedAt = null
      this.digestText = ''
      this.digestUserId = ''
      this.digestUserQq = ''
    },

    /**
     * 拉 bot 系统状态。
     *
     * **没填运营者令牌时直接返回**，一个请求都不发：那一页要显示的是
     * 「为什么看不到」，而不是一个必然 401 的红色错误。
     *
     * @param {{ force?: boolean, probeBackend?: boolean }} [opts]
     *   force=false 且 status 还新鲜（30s 内）时直接返回 true，不重复请求；
     *   probeBackend=false 时跳过后端探针（顶栏角标刷新走这条路，省一次请求）。
     */
    async load(opts = {}) {
      const { force = false, probeBackend = true } = opts
      if (!hasOperatorToken()) {
        this.operatorConfigured = false
        return false
      }
      this.operatorConfigured = true
      if (!force && this.isStatusFresh) return true
      if (!force) this.loading = true

      try {
        const statusPromise = (async () => {
          try {
            const data = await getStatus()
            this.status = normalizeBotStatus(data)
            this.error = null
            this.errorStatus = 0
            this.offline = false
            this.lastStatusAt = Date.now()
            this.lastLoadedAt = Date.now()
            return true
          } catch (err) {
            this.errorStatus = err && err.response ? err.response.status : 0
            this.offline = isOfflineError(err)
            this.error = this.offline ? BOT_DOWN_MESSAGE : humanizeError(err, 'bot')
            // 保留上一次的 status，但提示已经明确说「bot 不可达 / 令牌无效」，
            // 不会把「bot 挂了」伪装成「一切正常」
            return false
          }
        })()

        const [statusOk] = await Promise.all([
          statusPromise,
          probeBackend ? this.probeBackend() : Promise.resolve(false)
        ])
        return statusOk
      } finally {
        if (!force) this.loading = false
      }
    },

    /**
     * 独立探一次后端存储健康。
     * 失败不抛异常，只把结果写进 backendProbe；页面据此走警告分支。
     *
     * 这一步用的是**用户自己的 UserToken**（走 /api/health），所以即使没填
     * 运营者令牌也能跑 —— 它是这一页里唯一不依赖运营者身份的数据。
     */
    async probeBackend() {
      try {
        const data = await fetchBackendHealth()
        this.backendProbe = {
          checked: true,
          ok: true,
          message: '探测成功',
          checkedAt: Date.now(),
          counts: (data && data.counts) || null
        }
        return true
      } catch (err) {
        const message = isOfflineError(err)
          ? '探测失败：后端未响应（连接不上）'
          : `探测失败：${humanizeError(err)}`
        this.backendProbe = {
          checked: true,
          ok: false,
          message,
          checkedAt: Date.now(),
          counts: null
        }
        return false
      }
    },

    /**
     * 只为了顶栏盲区角标拉一次 bot：不重探后端。
     * 拿不到就保持原值，不写 error（顶栏不该因为角标而报错）。
     * 没填运营者令牌时同样**不发请求** —— 顶栏角标只是锦上添花。
     */
    async refreshStatusForBadge() {
      if (!hasOperatorToken()) return false
      if (this.isStatusFresh) return false
      try {
        const data = await getStatus()
        this.status = normalizeBotStatus(data)
        this.lastStatusAt = Date.now()
        this.error = null
        this.errorStatus = 0
        this.offline = false
        return true
      } catch (err) {
        // 角标场景下静默失败；真正的错误提示由 /health 页负责
        return false
      }
    },

    /**
     * 预览 digest。
     *
     * digest 是**按人**组装的：不传 `userId` 时 bot 用第一个收件人，
     * 并把用的是谁写在响应里 —— 那两个字段必须显示出来，
     * 否则运营者会以为预览的是自己那一份。
     *
     * @param {{ userId?: string }} [opts]
     */
    async previewDigest(opts = {}) {
      if (!hasOperatorToken()) {
        this.digestDialogVisible = true
        this.digestText = BOT_OPERATOR_REJECTED_MESSAGE
        return false
      }
      this.digestLoading = true
      this.digestDialogVisible = true
      this.digestText = ''
      this.digestUserId = ''
      this.digestUserQq = ''
      try {
        const data = await apiPreviewDigest({ userId: opts.userId })
        this.digestUserId = (data && data.user_id) || ''
        this.digestUserQq = data && data.qq !== null && data.qq !== undefined ? String(data.qq) : ''
        if (data && data.error) {
          this.digestText = `预览失败：${data.error}`
          return false
        }
        this.digestText = (data && data.text) || '（bot 返回的 digest 为空）'
        return true
      } catch (err) {
        const status = err && err.response ? err.response.status : 0
        if (status === 401 || status === 403) {
          this.digestText = BOT_OPERATOR_REJECTED_MESSAGE
        } else {
          this.digestText = `预览失败：${humanizeError(err, 'bot')}`
        }
        return false
      } finally {
        this.digestLoading = false
      }
    }

    // 刻意**没有** sendDigest：那需要运营者令牌，而且会真的往 QQ 发消息。
    // 手动补发请在服务器上用 bot 的接口，详情见 src/api/bot.js 的同名注释。
  }
})
