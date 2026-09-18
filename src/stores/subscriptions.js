import { defineStore } from 'pinia'

import {
  createSubscription,
  deleteSubscription,
  fetchSources,
  fetchSubscriptions,
  patchSubscription
} from '../api/user'
import { readErrorDetail } from '../api/errors'

/**
 * 订阅 store：当前用户的「关注谁说的话」清单 + 可选的信息源目录。
 *
 * 订阅的最小单位是 **(群, 发送者)**，没有「订整个群」这个选项 ——
 * 后端三层堵死（表结构 NOT NULL、normalize_sender 拒绝通配符、群号/QQ 号形状校验），
 * 前端也不提供这个入口，免得用户以为订上了其实一直收不到。
 *
 * 目录（sources）来自共享层 `raw_message` 的聚合，**不含任何按用户的数据**，
 * 所以任何登录用户都能看。它的作用是让新用户能发现「这套部署有哪些来源可订」。
 */
export const useSubscriptionsStore = defineStore('subscriptions', {
  state: () => ({
    /** 已规范化后的订阅列表 */
    subscriptions: [],
    listLoading: false,
    /** 列表级错误文案（null = 无错误） */
    listError: null,
    /** 正在增删改（按钮 loading 用） */
    mutating: false,
    /** 信息源目录 */
    sources: [],
    sourcesLoading: false,
    sourcesError: null,
    /** 目录是否已经成功拉过一次（避免每次打开对话框都重打） */
    sourcesLoaded: false
  }),

  getters: {
    count: (state) => state.subscriptions.length,
    enabledCount: (state) => state.subscriptions.filter((s) => s.enabled).length,
    disabledCount: (state) => state.subscriptions.filter((s) => !s.enabled).length
  },

  actions: {
    /** GET /api/subscriptions（带 include_disabled=false 时只拿启用的） */
    async load(opts = {}) {
      this.listLoading = true
      try {
        const data = await fetchSubscriptions({ includeDisabled: opts.includeDisabled !== false })
        const rows = data && Array.isArray(data.subscriptions) ? data.subscriptions : []
        this.subscriptions = rows.map((row) => normalizeSubscription(row)).filter(Boolean)
        this.listError = null
        return { ok: true }
      } catch (err) {
        this.listError = readErrorDetail(err, '加载订阅失败')
        return { ok: false, message: this.listError }
      } finally {
        this.listLoading = false
      }
    },

    /**
     * GET /api/sources
     * @param {{ keyword?: string, force?: boolean }} [opts]
     */
    async loadSources(opts = {}) {
      if (this.sourcesLoaded && !opts.force && !opts.keyword) return { ok: true }
      this.sourcesLoading = true
      try {
        const data = await fetchSources({ keyword: opts.keyword, limit: 50 })
        const rows = data && Array.isArray(data.sources) ? data.sources : []
        this.sources = rows.map((row) => normalizeSource(row)).filter(Boolean)
        this.sourcesError = null
        this.sourcesLoaded = true
        return { ok: true }
      } catch (err) {
        this.sourcesError = readErrorDetail(err, '加载信息源目录失败')
        this.sources = []
        return { ok: false, message: this.sourcesError }
      } finally {
        this.sourcesLoading = false
      }
    },

    /**
     * POST /api/subscriptions
     * @param {{ group_id: string, sender_id: string, group_name?: string, sender_name?: string, note?: string }} body
     * @returns {{ ok: boolean, created?: boolean, message?: string, subscription?: object }}
     */
    async add(body) {
      this.mutating = true
      try {
        const data = await createSubscription(body)
        const sub = normalizeSubscription(data && data.subscription)
        if (sub) this.upsert(sub)
        return { ok: true, created: !!(data && data.created), subscription: sub }
      } catch (err) {
        // 400 的 detail 是后端精心写的（比如「不支持订阅整个群」），原样给用户看
        return { ok: false, message: readErrorDetail(err, '添加订阅失败') }
      } finally {
        this.mutating = false
      }
    },

    /**
     * PATCH /api/subscriptions/{id}
     * @returns {{ ok: boolean, message?: string }}
     */
    async patch(id, patch) {
      this.mutating = true
      try {
        const data = await patchSubscription(id, patch)
        const sub = normalizeSubscription(data && data.subscription)
        if (sub) this.upsert(sub)
        return { ok: true }
      } catch (err) {
        return { ok: false, message: readErrorDetail(err, '修改订阅失败') }
      } finally {
        this.mutating = false
      }
    },

    /**
     * 切换启用状态。**乐观更新**：开关点下去立刻动，失败再回滚 ——
     * 一次开关要等一个来回才动的话，用户会以为是没点到。
     * @returns {{ ok: boolean, message?: string }}
     */
    async toggleEnabled(id) {
      const target = this.subscriptions.find((s) => s.id === String(id))
      if (!target) return { ok: false, message: '本地找不到这条订阅' }
      const next = !target.enabled
      this.upsert({ ...target, enabled: next })
      const result = await this.patch(id, { enabled: next })
      if (!result.ok) {
        this.upsert(target)
        return result
      }
      return { ok: true }
    },

    /**
     * DELETE /api/subscriptions/{id}
     * @returns {{ ok: boolean, message?: string }}
     */
    async remove(id) {
      this.mutating = true
      try {
        await deleteSubscription(id)
        this.subscriptions = this.subscriptions.filter((s) => s.id !== String(id))
        return { ok: true }
      } catch (err) {
        return { ok: false, message: readErrorDetail(err, '删除订阅失败') }
      } finally {
        this.mutating = false
      }
    },

    /** 把一条订阅并进列表（新增或替换） */
    upsert(sub) {
      if (!sub || !sub.id) return
      const idx = this.subscriptions.findIndex((s) => s.id === sub.id)
      if (idx === -1) {
        this.subscriptions = this.subscriptions.concat([sub])
        return
      }
      const next = this.subscriptions.slice()
      next.splice(idx, 1, sub)
      this.subscriptions = next
    }
  }
})

/** 后端单条订阅 → 前端形状（缺字段一律收敛成安全默认值，模板里就不用到处写 ?.） */
export function normalizeSubscription(raw) {
  if (!raw || typeof raw !== 'object') return null
  const id = raw.id === undefined || raw.id === null ? '' : String(raw.id)
  if (!id) return null
  return {
    id,
    group_id: raw.group_id === undefined || raw.group_id === null ? '' : String(raw.group_id),
    sender_id: raw.sender_id === undefined || raw.sender_id === null ? '' : String(raw.sender_id),
    group_name: raw.group_name || '',
    sender_name: raw.sender_name || '',
    note: raw.note || '',
    enabled: !!raw.enabled,
    created_at: raw.created_at === undefined ? null : raw.created_at,
    updated_at: raw.updated_at === undefined ? null : raw.updated_at
  }
}

/** 目录条目 → 前端形状 */
export function normalizeSource(raw) {
  if (!raw || typeof raw !== 'object') return null
  const groupId = raw.group_id === undefined || raw.group_id === null ? '' : String(raw.group_id)
  const senderId = raw.sender_id === undefined || raw.sender_id === null ? '' : String(raw.sender_id)
  if (!groupId || !senderId) return null
  return {
    group_id: groupId,
    group_name: raw.group_name || '',
    sender_id: senderId,
    sender_name: raw.sender_name || '',
    last_ts: raw.last_ts === undefined ? null : raw.last_ts,
    msg_count: Number(raw.msg_count) || 0,
    // 表格里的唯一 key：同一个群里同一个人只会出现一次（后端已按这两列聚合）
    key: `${groupId}-${senderId}`
  }
}

export default useSubscriptionsStore
