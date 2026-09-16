import { defineStore } from 'pinia'

import {
  getStatus,
  previewDigest as apiPreviewDigest,
  sendDigest as apiSendDigest
} from '../api/bot'
import { fetchBackendHealth } from '../api/client'
import { BOT_DOWN_MESSAGE, humanizeError, isOfflineError } from '../api/errors'
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
 * 系统状态 store。
 *
 * 数据来源在契约第 9 节之后分成了两半：
 *  - bot `/api/status` → OneBot / LLM / 白名单 / 流水线 / 盲区 / 群 / 缺口 / digest
 *  - 后端 `/api/health` → **只用来探「后端可达性」**（存储自身），
 *    因为 bot 活着但后端挂了是最重要的运维故障，不能只信 bot 自报。
 *  - 后端 `/api/config/meta` 已经不存在了，白名单改从 status.whitelist 读。
 */
export const useHealthStore = defineStore('health', {
  state: () => ({
    /** 规范化后的 bot status（形状见 utils/healthStatus.js） */
    status: emptyStatus(),
    /** 后端可达性探针结果：{ checked, ok, message, checkedAt, counts } */
    backendProbe: { checked: false, ok: false, message: '', checkedAt: null, counts: null },
    loading: false,
    error: null,
    /** true = bot 根本没连上（区别于 bot 返回了错误码） */
    offline: false,
    lastLoadedAt: null,
    lastStatusAt: null,
    /** digest 预览 */
    digestText: '',
    digestLoading: false,
    digestDialogVisible: false,
    digestSending: false
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
    }
  },

  actions: {
    /**
     * 拉 bot 系统状态。
     * @param {{ force?: boolean, probeBackend?: boolean }} [opts]
     *   force=false 且 status 还新鲜（30s 内）时直接返回 true，不重复请求；
     *   probeBackend=false 时跳过后端探针（顶栏角标刷新走这条路，省一次请求）。
     */
    async load(opts = {}) {
      const { force = false, probeBackend = true } = opts
      if (!force && this.isStatusFresh) return true
      if (!force) this.loading = true

      try {
        const statusPromise = (async () => {
          try {
            const data = await getStatus()
            this.status = normalizeBotStatus(data)
            this.error = null
            this.offline = false
            this.lastStatusAt = Date.now()
            this.lastLoadedAt = Date.now()
            return true
          } catch (err) {
            this.error = isOfflineError(err) ? BOT_DOWN_MESSAGE : humanizeError(err, 'bot')
            this.offline = isOfflineError(err)
            // 保留上一次的 status，但状态点与错误提示已经明确说「bot 不可达」，
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
     */
    async refreshStatusForBadge() {
      if (this.isStatusFresh) return false
      try {
        const data = await getStatus()
        this.status = normalizeBotStatus(data)
        this.lastStatusAt = Date.now()
        this.error = null
        this.offline = false
        return true
      } catch (err) {
        // 角标场景下静默失败；真正的错误提示由 /health 页负责
        return false
      }
    },

    async previewDigest() {
      this.digestLoading = true
      this.digestDialogVisible = true
      this.digestText = ''
      try {
        const data = await apiPreviewDigest()
        this.digestText = (data && data.text) || '（bot 返回的 digest 为空）'
        return true
      } catch (err) {
        this.digestText = `预览失败：${humanizeError(err, 'bot')}`
        return false
      } finally {
        this.digestLoading = false
      }
    },

    /**
     * @param {boolean} dryRun false = 真实发送到 QQ
     * @returns {{ ok: boolean, data: object, message?: string }}
     */
    async sendDigest(dryRun = false) {
      this.digestSending = true
      try {
        const data = await apiSendDigest(dryRun)
        return { ok: !!(data && data.ok), data: data || {}, message: data && data.error }
      } catch (err) {
        return { ok: false, data: {}, message: humanizeError(err, 'bot') }
      } finally {
        this.digestSending = false
      }
    }
  }
})
