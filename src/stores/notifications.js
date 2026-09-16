import { defineStore } from 'pinia'

import {
  fetchNotifications,
  fetchNotificationDetail,
  submitCorrection,
  setNotificationRead,
  humanizeError,
  isOfflineError,
  BACKEND_DOWN_MESSAGE
} from '../api/client'

/** 把后端单条通知补全成前端期望的完整形状，避免模板里到处写 `?.` */
function normalizeNotification(raw) {
  if (!raw || typeof raw !== 'object') return null
  return {
    id: raw.id != null ? String(raw.id) : '',
    group_id: raw.group_id != null ? String(raw.group_id) : '',
    group_name: raw.group_name || '未知群',
    sender_id: raw.sender_id != null ? String(raw.sender_id) : '',
    sender_name: raw.sender_name || '未知发布者',
    title: raw.title || '（无标题）',
    summary: raw.summary || '',
    // 地点：后端可能给 null（大多数闲聊/无地点的通知），统一保留 null 语义，
    // 展示与表单各自决定「空」怎么呈现（卡片第三行退化，表单填空串）
    location: raw.location === undefined || raw.location === null ? null : String(raw.location),
    due_at: raw.due_at === undefined ? null : raw.due_at,
    due_text: raw.due_text || '',
    due_confidence:
      raw.due_confidence === undefined || raw.due_confidence === null
        ? null
        : Number(raw.due_confidence),
    conflict: !!raw.conflict,
    candidates: Array.isArray(raw.candidates) ? raw.candidates : [],
    evidence: raw.evidence || '',
    status: raw.status || 'active',
    manually_edited: !!raw.manually_edited,
    read: !!raw.read,
    attachments: Array.isArray(raw.attachments) ? raw.attachments : [],
    source_ts: raw.source_ts === undefined ? null : raw.source_ts,
    created_at: raw.created_at === undefined ? null : raw.created_at,
    updated_at: raw.updated_at === undefined ? null : raw.updated_at
  }
}

export const useNotificationsStore = defineStore('notifications', {
  state: () => ({
    /** @type {Array} 通知列表（已规范化） */
    notifications: [],
    /** 后端给的 server_time，用作相对时间的锚点更稳 */
    serverTime: Date.now(),
    /** 本地「最后成功同步」的时间戳，头部显示用 */
    lastSyncedAt: null,
    /** 列表加载中 */
    loading: false,
    /** 增删改等操作中 */
    mutating: false,
    /** 列表错误文案（null = 无错误） */
    error: null,
    /** 是否属于「后端连不上」 */
    offline: false,
    /** 当前详情抽屉对应的 id */
    activeId: null,
    /** 详情数据 { notification, raw } */
    detail: null,
    detailLoading: false,
    detailError: null,
    /** 筛选条件 */
    filter: {
      status: 'all',
      q: ''
    }
  }),

  getters: {
    /** 未读条数 */
    unreadCount: (state) => state.notifications.filter((n) => !n.read).length,
    /** 冲突条数（列表内） */
    conflictCount: (state) => state.notifications.filter((n) => n.conflict).length,
    /** 是否存在任何后端不可用信号 */
    hasError: (state) => !!state.error,
    /** 数据是否为空（用来决定显示 el-empty） */
    isEmpty: (state) => !state.loading && state.notifications.length === 0,
    getById: (state) => (id) => state.notifications.find((n) => n.id === String(id)) || null
  },

  actions: {
    /** 用后端返回体整体覆盖列表状态 */
    applyListPayload(payload) {
      const data = payload || {}
      this.notifications = Array.isArray(data.notifications)
        ? data.notifications.map(normalizeNotification).filter(Boolean)
        : []
      this.serverTime = data.server_time || Date.now()
      // 说明：后端 /api/notifications 响应里的 blindspots 字段已被删除（契约第 8 节），
      // 盲区数据现在归 bot 的 /api/status，由 stores/health.js 持有。这里不再解析它。
      this.lastSyncedAt = Date.now()
    },

    /** 把一条（新增或修正后的）通知合并进列表 */
    upsertNotification(rawNotification) {
      const item = normalizeNotification(rawNotification)
      if (!item || !item.id) return
      const idx = this.notifications.findIndex((n) => n.id === item.id)
      if (idx === -1) {
        this.notifications = this.notifications.concat([item])
      } else {
        const next = this.notifications.slice()
        next.splice(idx, 1, item)
        this.notifications = next
      }
      if (this.detail && this.detail.notification && this.detail.notification.id === item.id) {
        this.detail = { ...this.detail, notification: item }
      }
    },

    setFilterStatus(status) {
      this.filter.status = status || 'all'
    },

    setFilterQuery(q) {
      this.filter.q = q || ''
    },

    /**
     * 拉取通知列表。
     * @param {{ incremental?: boolean, silent?: boolean }} [opts]
     *   incremental=true 时带上 since=上次的 server_time，只取增量
     */
    async load(opts = {}) {
      const { incremental = false, silent = false } = opts
      if (!silent) this.loading = true
      try {
        const params = {
          status: this.filter.status === 'all' ? 'all' : this.filter.status,
          q: this.filter.q || undefined
        }
        // 只有「无筛选 + 增量」时才用 since，避免增量与服务端筛选叠加后漏条目
        if (incremental && !params.q && params.status === 'all' && this.serverTime) {
          params.since = this.serverTime
        }
        const data = await fetchNotifications(params)
        this.applyListPayload(data)
        this.error = null
        this.offline = false
        return true
      } catch (err) {
        this.error = humanizeError(err)
        this.offline = isOfflineError(err)
        if (this.offline) this.error = BACKEND_DOWN_MESSAGE
        return false
      } finally {
        if (!silent) this.loading = false
      }
    },

    /** 打开详情：先拉详情接口，失败时降级用列表里的数据 */
    async openDetail(id) {
      this.activeId = String(id)
      this.detailError = null
      this.detailLoading = true
      const fallback = this.getById(id)
      this.detail = fallback ? { notification: fallback, raw: null } : null
      try {
        const data = await fetchNotificationDetail(id)
        const normalized = normalizeNotification(data && data.notification)
        this.detail = {
          notification: normalized || fallback,
          raw: (data && data.raw) || null
        }
        if (normalized) this.upsertNotification(normalized)
      } catch (err) {
        this.detailError = humanizeError(err)
        // 降级：列表里的数据仍然可看，只是没有 raw
      } finally {
        this.detailLoading = false
      }
    },

    closeDetail() {
      this.activeId = null
      this.detail = null
      this.detailError = null
    },

    /**
     * 提交人工修正。成功后用返回的 notification 覆盖本地。
     * @returns {{ ok: boolean, message?: string }}
     */
    async correct(id, field, value) {
      this.mutating = true
      try {
        const data = await submitCorrection(id, { field, value })
        if (data && data.notification) {
          this.upsertNotification(data.notification)
        } else {
          // 后端没回完整对象时，本地做最小更新，保证 UI 立刻有反馈
          const target = this.getById(id)
          if (target) {
            const patch = {}
            patch[field] = value
            this.upsertNotification({ ...target, ...patch, manually_edited: true })
          }
        }
        this.error = null
        return { ok: true }
      } catch (err) {
        const message = humanizeError(err)
        this.error = message
        return { ok: false, message }
      } finally {
        this.mutating = false
      }
    },

    /** 切换已读状态（乐观更新，失败回滚） */
    async toggleRead(id) {
      const target = this.getById(id)
      if (!target) return { ok: false, message: '本地找不到该通知' }
      const next = !target.read
      this.upsertNotification({ ...target, read: next })
      try {
        await setNotificationRead(id, next)
        return { ok: true }
      } catch (err) {
        this.upsertNotification({ ...target, read: target.read })
        const message = humanizeError(err)
        this.error = message
        return { ok: false, message }
      }
    },

    /** 「这不是通知」→ status 置为 archived */
    async archive(id) {
      const result = await this.correct(id, 'status', 'archived')
      return result
    }
  }
})
