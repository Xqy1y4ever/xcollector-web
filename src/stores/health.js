import { defineStore } from 'pinia'

import {
  fetchHealth,
  fetchConfigMeta,
  fetchDigestPreview,
  sendDigest,
  humanizeError,
  isOfflineError,
  BACKEND_DOWN_MESSAGE
} from '../api/client'

const EMPTY_HEALTH = {
  server_time: null,
  onebot: {
    mode: '',
    connected: false,
    target: '',
    last_event_at: null,
    reconnect_count: 0
  },
  groups: [],
  pipeline: {
    today_ingested: 0,
    today_extracted: 0,
    today_unparsed: 0,
    today_conflicts: 0,
    today_degraded: 0,
    today_llm_tokens: 0
  },
  llm: {
    enabled: false,
    primary_model: '',
    secondary_model: '',
    cross_check_enabled: false
  },
  gap_alerts: []
}

export const useHealthStore = defineStore('health', {
  state: () => ({
    health: JSON.parse(JSON.stringify(EMPTY_HEALTH)),
    config: null,
    loading: false,
    error: null,
    offline: false,
    lastLoadedAt: null,
    /** digest 预览 */
    digestText: '',
    digestLoading: false,
    digestDialogVisible: false,
    digestSending: false
  }),

  getters: {
    onebotConnected: (state) => !!(state.health && state.health.onebot && state.health.onebot.connected),
    /** 头部状态点用：'ok' | 'down' | 'unknown' */
    connectionState: (state) => {
      if (state.error) return 'down'
      const ob = state.health && state.health.onebot
      if (!ob) return 'unknown'
      return ob.connected ? 'ok' : 'down'
    },
    connectionText: (state) => {
      if (state.error) return '后端未连接'
      const ob = state.health && state.health.onebot
      if (!ob) return '未知'
      if (!ob.connected) return 'OneBot 已断开'
      const mode = ob.mode ? `（${ob.mode}）` : ''
      return `OneBot 已连接${mode}`
    },
    hasBlindSpot: (state) => {
      const p = state.health.pipeline
      return !!(p.today_unparsed || p.today_conflicts || p.today_degraded)
    }
  },

  actions: {
    async load() {
      this.loading = true
      try {
        const data = await fetchHealth()
        this.health = { ...JSON.parse(JSON.stringify(EMPTY_HEALTH)), ...(data || {}) }
        if (!Array.isArray(this.health.groups)) this.health.groups = []
        if (!Array.isArray(this.health.gap_alerts)) this.health.gap_alerts = []
        this.health.pipeline = { ...EMPTY_HEALTH.pipeline, ...(data && data.pipeline) }
        this.health.onebot = { ...EMPTY_HEALTH.onebot, ...(data && data.onebot) }
        this.health.llm = { ...EMPTY_HEALTH.llm, ...(data && data.llm) }
        this.error = null
        this.offline = false
        this.lastLoadedAt = Date.now()
        return true
      } catch (err) {
        this.error = isOfflineError(err) ? BACKEND_DOWN_MESSAGE : humanizeError(err)
        this.offline = isOfflineError(err)
        return false
      } finally {
        this.loading = false
      }
    },

    async loadConfig() {
      try {
        this.config = await fetchConfigMeta()
        return true
      } catch (err) {
        // 配置接口失败不影响主界面：静默记录即可
        if (!this.error) this.error = humanizeError(err)
        return false
      }
    },

    async previewDigest() {
      this.digestLoading = true
      this.digestDialogVisible = true
      try {
        const data = await fetchDigestPreview()
        this.digestText = (data && data.text) || '（后端返回的 digest 为空）'
        return true
      } catch (err) {
        this.digestText = `预览失败：${humanizeError(err)}`
        return false
      } finally {
        this.digestLoading = false
      }
    },

    async sendDigest(dryRun = false) {
      this.digestSending = true
      try {
        const data = await sendDigest(dryRun)
        return { ok: !!(data && data.ok), data: data || {}, message: data && data.error }
      } catch (err) {
        return { ok: false, data: {}, message: humanizeError(err) }
      } finally {
        this.digestSending = false
      }
    }
  }
})
