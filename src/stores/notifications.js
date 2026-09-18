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

/**
 * 增量拉取时往回**重叠**的毫秒数。
 *
 * 为什么不是"从上次的边界开始，一点不多要"：后端的过滤条件是 `updated_at > since`
 * （严格大于），而边界来自"上一批里最大的 updated_at"。如果两条通知落在**同一毫秒**，
 * 第二条在我们那次请求之后才写进来，它就会被永远跳过 —— 少一条任务，而且不报错。
 * 往回重叠 2 秒，代价只是"可能重复拉回几条"；而合并（`mergeNotifications`）是按 id
 * 幂等的，重复拉回来没有副作用。宁可多要，不可漏。
 */
export const INCREMENTAL_OVERLAP_MS = 2000

/**
 * 把增量结果并进现有列表：**按 id 就地替换，新的追加在后面**。
 *
 * 这个函数是"增量刷新之后页面上的任务消失"那个 bug 的修复点。以前
 * `applyListPayload` 是**整体替换**，而增量请求只返回"最近变更的那几条" ——
 * 于是每 60 秒一次的自动刷新都会把列表换成那几条，看起来就像任务全没了；
 * 手动刷新走的是一次全量请求，所以又"恢复正常"。
 *
 * 排序不在这里做：列表渲染时按 DDL 分组排序（utils/time.js 的 groupNotifications），
 * 所以这里只要保证"不丢、不重、不跳位置"。
 *
 * @param {Array} existing 现有列表（已规范化）
 * @param {Array} incoming 增量结果（已规范化）
 */
export function mergeNotifications(existing, incoming) {
  const list = Array.isArray(existing) ? existing.slice() : []
  const at = new Map()
  list.forEach((item, index) => at.set(item.id, index))
  for (const item of Array.isArray(incoming) ? incoming : []) {
    if (!item || !item.id) continue
    const index = at.get(item.id)
    if (index === undefined) {
      at.set(item.id, list.length)
      list.push(item)
    } else {
      list[index] = item
    }
  }
  return list
}

/**
 * 这一批数据里最大的 `updated_at`（毫秒）；一条都没有时给 0。
 *
 * 增量游标取它，而**不是**响应里的 `server_time`：`server_time` 是后端查完之后才取的
 * "现在"，晚于查询本身，用它当边界会漏掉"查询之后、取时间之前"写进来的行。
 * 取实际数据的最大 updated_at 是能自证的下界。
 */
export function maxUpdatedAt(list) {
  let max = 0
  for (const item of Array.isArray(list) ? list : []) {
    const value = Number(item && item.updated_at) || 0
    if (value > max) max = value
  }
  return max
}

/**
 * 并发受限地跑一批异步任务（批量操作要靠它）。
 *
 * 为什么不是 `Promise.all(ids.map(...))`：全选之后一次可能几百条，几百个并发请求
 * 会把后端和浏览器一起压住（而且失败时错误信息会糊成一团）。限 4 路，结果按**输入
 * 顺序**返回，成败都能一条条对上号。
 *
 * @template T
 * @param {Array<T>} items
 * @param {number} limit
 * @param {(item: T, index: number) => Promise<any>} worker
 * @returns {Promise<Array<{ok: boolean, value?: any, error?: any}>>}
 */
export async function runLimited(items, limit, worker) {
  const list = Array.isArray(items) ? items : []
  const results = new Array(list.length)
  let cursor = 0
  const size = Math.max(1, Math.min(Number(limit) || 1, list.length || 1))
  async function next() {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= list.length) return
      try {
        results[index] = { ok: true, value: await worker(list[index], index) }
      } catch (error) {
        results[index] = { ok: false, error }
      }
    }
  }
  await Promise.all(Array.from({ length: size }, next))
  return results
}

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
    /**
     * 增量游标：**已经拿到过的最大的 updated_at**（不是 server_time，理由见 maxUpdatedAt）。
     * 增量请求用它（往回重叠 INCREMENTAL_OVERLAP_MS）问后端要"我还没见过的变更"。
     */
    sinceCursor: 0,
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
    /** 多选模式：关着的时候卡片就是原来的样子（点一下开详情） */
    selectionMode: false,
    /** 已选中的通知 id（字符串，和 normalizeNotification 的口径一致） */
    selectedIds: [],
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
    getById: (state) => (id) => state.notifications.find((n) => n.id === String(id)) || null,
    /** 已选条数 */
    selectedCount: (state) => state.selectedIds.length,
    /** 这条选中了吗（模板里按卡片问） */
    isSelected: (state) => (id) => state.selectedIds.includes(String(id)),
    /** 列表是不是**全都**选中了（决定"全选"按钮显示成"全选"还是"取消全选"） */
    allSelected: (state) =>
      state.notifications.length > 0 && state.selectedIds.length === state.notifications.length
  },

  actions: {
    /**
     * 用后端返回体覆盖/合并列表状态。
     *
     * @param {object} payload 后端响应体 `{ server_time, notifications }`
     * @param {{ merge?: boolean, trackCursor?: boolean }} [opts]
     *   merge=true：这是**增量**结果，按 id 并进现有列表（不能整体替换！见
     *   `mergeNotifications` 的说明）；merge=false：这是全量结果，整体替换。
     *   trackCursor=false：带筛选条件的全量结果（只是"当前筛选下的那些"），
     *   不能拿它当增量游标。
     */
    applyListPayload(payload, opts = {}) {
      const { merge = false, trackCursor = true } = opts
      const data = payload || {}
      const incoming = Array.isArray(data.notifications)
        ? data.notifications.map(normalizeNotification).filter(Boolean)
        : []
      this.notifications = merge ? mergeNotifications(this.notifications, incoming) : incoming
      if (trackCursor) {
        const boundary = maxUpdatedAt(incoming)
        this.sinceCursor = merge ? Math.max(this.sinceCursor, boundary) : boundary
      }
      // 全量替换之后把已经不在列表里的选中项剔掉：选择条上不能写着"已选 3 条"，
      // 而其中两条已经因为换了筛选条件看不见了。
      if (!merge) this.pruneSelection()
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

    /* ---------------- 多选 ---------------- */

    /**
     * 开关多选模式。**关掉时清空选择** —— 留着选择但界面上看不见勾选框，
     * 下一次误点批量操作就会作用在一批"看不见的"条目上。
     */
    setSelectionMode(on) {
      this.selectionMode = !!on
      if (!this.selectionMode) this.selectedIds = []
    },

    /** 点一张卡片：切换它的选中状态 */
    toggleSelect(id) {
      const key = String(id)
      if (this.selectedIds.includes(key)) {
        this.selectedIds = this.selectedIds.filter((x) => x !== key)
      } else {
        this.selectedIds = this.selectedIds.concat([key])
      }
    },

    /** 全选 / 取消全选（作用范围 = 当前列表，也就是当前筛选条件下的所有条目） */
    setSelected(ids) {
      const alive = new Set(this.notifications.map((n) => n.id))
      const next = []
      for (const id of Array.isArray(ids) ? ids : []) {
        const key = String(id)
        if (alive.has(key) && !next.includes(key)) next.push(key)
      }
      this.selectedIds = next
    },

    selectAll() {
      this.setSelected(this.notifications.map((n) => n.id))
    },

    clearSelection() {
      this.selectedIds = []
    },

    /** 列表被整体替换之后，把已经不在列表里的选中项剔掉 */
    pruneSelection() {
      if (!this.selectedIds.length) return
      const alive = new Set(this.notifications.map((n) => n.id))
      const kept = this.selectedIds.filter((id) => alive.has(id))
      if (kept.length !== this.selectedIds.length) this.selectedIds = kept
    },

    /**
     * 批量标记已读 / 未读。**乐观更新**（先改本地再发请求），失败的那些逐条回滚。
     *
     * 逐条调 `/notifications/{id}/read`（后端没有批量接口），所以限制并发到 4 路。
     * 返回值把成败都报出来 —— 批量操作最怕的就是"N 条成功、M 条静默失败"。
     *
     * @returns {Promise<{ok: boolean, succeeded: number, failed: Array<{id: string, message: string}>}>}
     */
    async batchSetRead(ids, read) {
      const list = (Array.isArray(ids) ? ids : []).map((id) => this.getById(id)).filter(Boolean)
      if (!list.length) {
        return { ok: false, succeeded: 0, unchanged: 0, failed: [], message: '本地找不到这些通知（可能刚被刷新掉了）' }
      }
      // 已经是目标状态的不用发请求（"全部标为已读"里大部分本来就是已读）
      const targets = list.filter((n) => !!n.read !== !!read)
      const unchanged = list.length - targets.length
      // 乐观更新：勾完之后立刻看到未读点消失/出现
      for (const n of targets) this.upsertNotification({ ...n, read: !!read })

      this.mutating = true
      let results = []
      try {
        results = await runLimited(targets, 4, (n) => setNotificationRead(n.id, read))
      } finally {
        this.mutating = false
      }
      const failed = []
      results.forEach((r, index) => {
        if (r.ok) return
        const target = targets[index]
        failed.push({ id: target.id, message: humanizeError(r.error) })
        // 回滚这一条（成功的不动）
        this.upsertNotification({ ...target, read: target.read })
      })
      if (failed.length) {
        // 失败的那些留在选中状态里，方便直接重试；成功的取消选中
        const failedIds = new Set(failed.map((f) => f.id))
        this.selectedIds = this.selectedIds.filter((id) => failedIds.has(id))
      } else {
        this.clearSelection()
      }
      return {
        ok: failed.length === 0,
        succeeded: targets.length - failed.length,
        unchanged,
        failed,
        message: failed.length
          ? `${failed.length} 条没改成（${failed[0].message}）`
          : ''
      }
    },

    /**
     * 批量改状态（`done` 标记完成 / `archived` 这不是通知）。
     *
     * 走的是和单条一样的 corrections 通道（只追加），后端会把改完之后的通知读投影
     * 回给我们，所以这里不做乐观更新 —— 以服务端算出来的 `status` 为准。
     *
     * @returns {Promise<{ok: boolean, succeeded: number, failed: Array<{id: string, message: string}>}>}
     */
    async batchSetStatus(ids, status) {
      const list = (Array.isArray(ids) ? ids : []).map((id) => this.getById(id)).filter(Boolean)
      if (!list.length) {
        return { ok: false, succeeded: 0, unchanged: 0, failed: [], message: '本地找不到这些通知（可能刚被刷新掉了）' }
      }
      // 已经是这个状态的不用再发一次（corrections 是只追加的，重复记一笔没意义）
      const targets = list.filter((n) => (n.status || 'active') !== status)
      const unchanged = list.length - targets.length
      this.mutating = true
      let results = []
      try {
        results = await runLimited(targets, 4, (n) =>
          submitCorrection(n.id, { field: 'status', value: status })
        )
      } finally {
        this.mutating = false
      }
      const failed = []
      results.forEach((r, index) => {
        const target = targets[index]
        if (!r.ok) {
          failed.push({ id: target.id, message: humanizeError(r.error) })
          return
        }
        const updated = r.value && r.value.notification
        if (updated) this.upsertNotification(updated)
        else this.upsertNotification({ ...target, status })
      })
      if (failed.length) {
        const failedIds = new Set(failed.map((f) => f.id))
        this.selectedIds = this.selectedIds.filter((id) => failedIds.has(id))
      } else {
        this.clearSelection()
      }
      return {
        ok: failed.length === 0,
        succeeded: targets.length - failed.length,
        unchanged,
        failed,
        message: failed.length
          ? `${failed.length} 条没改成（${failed[0].message}）`
          : ''
      }
    },

    /**
     * 拉取通知列表。
     * @param {{ incremental?: boolean, silent?: boolean }} [opts]
     *   incremental=true 时带上 since=增量游标，只取"我还没见过的变更"，并**合并**进
     *   现有列表（不是替换）。
     */
    async load(opts = {}) {
      const { incremental = false, silent = false } = opts
      if (!silent) this.loading = true
      try {
        const params = {
          status: this.filter.status === 'all' ? 'all' : this.filter.status,
          q: this.filter.q || undefined
        }
        // 只有「无筛选 + 有游标」时才走真增量：带上筛选条件时，增量与服务端筛选叠加
        // 会让"哪些条该出现在列表里"变得说不清（比如筛"进行中"时返回了一条今天刚改成
        // 已归档的），那种情况干脆整份按筛选条件重拉。
        const delta =
          incremental && !params.q && params.status === 'all' && this.sinceCursor > 0
        if (delta) {
          params.since = Math.max(0, this.sinceCursor - INCREMENTAL_OVERLAP_MS)
        }
        const data = await fetchNotifications(params)
        this.applyListPayload(data, {
          merge: delta,
          // 带筛选条件的全量结果不能用来推进增量游标（它只是当前筛选下的一个子集）
          trackCursor: !params.q && params.status === 'all'
        })
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
