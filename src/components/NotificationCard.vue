<template>
  <div
    class="xc-card"
    :class="{
      'xc-card--archived': notification.status === 'archived',
      'xc-card--done': notification.status === 'done'
    }"
    @click="emit('open', notification.id)"
  >
    <!-- 左侧固定宽度 DDL 列：3px 色条 + 上行日期 + 下行时间 -->
    <div class="xc-due" :class="`xc-due--${due.level}`">
      <div class="xc-due__date" :title="due.dateFull">{{ due.dateTop }}</div>
      <!-- due_at 为 null 时下行是 due_text 原文，可能很长，用 tooltip 兜全文 -->
      <el-tooltip
        v-if="due.timeTooltip"
        :content="due.timeTooltip"
        placement="top"
        :show-after="200"
      >
        <div class="xc-due__time">{{ due.timeBottom }}</div>
      </el-tooltip>
      <div v-else class="xc-due__time">{{ due.timeBottom }}</div>
    </div>

    <!-- 右侧三行：标题 / 摘要 / 来源·地点·发布者 + 标签 -->
    <div class="xc-card__body">
      <div class="xc-card__row xc-card__row--title">
        <span
          v-if="!notification.read"
          class="xc-card__unread-dot"
          title="未读"
          aria-label="未读"
        />
        <span class="xc-card__title" :title="notification.title">{{ notification.title }}</span>
      </div>

      <!-- summary 为空时整行不渲染，卡片自动变矮 -->
      <div v-if="hasSummary" class="xc-card__row xc-card__row--summary">
        <span class="xc-card__summary" :title="notification.summary">{{ notification.summary }}</span>
      </div>

      <div class="xc-card__row xc-card__row--meta">
        <span class="xc-card__source" :title="metaText">{{ metaText }}</span>
        <div class="xc-card__tags">
          <span v-if="notification.conflict" class="xc-tag xc-tag--danger">DDL 冲突</span>
          <span v-if="notification.manually_edited" class="xc-tag xc-tag--success">已人工确认</span>
          <span v-if="isLowConfidence" class="xc-tag xc-tag--info">待确认</span>
          <span class="xc-card__link">原文对照 ›</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

import { dueLevel, formatDate, formatTime, formatWeekday, toMillis } from '../utils/time'
import { buildCardMetaText } from '../utils/notificationText'

/**
 * 紧凑通知卡片。
 *
 * 刻意不再渲染 evidence 原文、附件图标、「距发布 X 小时」——这三块全部收进详情抽屉。
 * 代价是「一眼看到结论依据」变成「点开才看到」，所以 conflict /
 * 低置信度这两类风险必须在卡片上保持醒目（见第三行的标签）。
 * 颜色分级统一走 utils/time.js 的 dueLevel()，这里不做任何重复判断。
 */
const props = defineProps({
  notification: {
    type: Object,
    required: true
  },
  now: {
    type: Number,
    default: () => Date.now()
  }
})

const emit = defineEmits(['open', 'toggle-read', 'archive'])

const dueMs = computed(() => toMillis(props.notification.due_at))

const due = computed(() => {
  const n = props.notification || {}
  const ms = dueMs.value
  const level = dueLevel(n.due_at, props.now)
  const dueText = n.due_text || ''

  if (ms === null) {
    // due_at 为 null：上行「待确认」，下行 due_text 原文（可能较长，省略号 + tooltip）
    return {
      level,
      dateTop: '待确认',
      dateFull: '未解析出确定时间',
      timeBottom: dueText || '—',
      timeTooltip: dueText ? `原文时间：${dueText}` : ''
    }
  }

  const dateTop = `${formatDate(ms, { withYear: false })} ${formatWeekday(ms)}`
  const timeBottom = formatTime(ms)
  return {
    level,
    dateTop,
    dateFull: `${formatDate(ms)} ${formatWeekday(ms)} ${timeBottom}`,
    timeBottom,
    // 有确定时间时下行永远是 HH:mm，不会被截断，不需要 tooltip
    timeTooltip: ''
  }
})

const hasSummary = computed(() => {
  const s = props.notification.summary
  return typeof s === 'string' && s.trim() !== ''
})

/**
 * 第三行文案：群名 · 地点 · 发布者（没有 location 时退化为 群名 · 发布者）。
 * 规则本体在 utils/notificationText.js，方便断言，也避免多处漂移。
 */
const metaText = computed(() => buildCardMetaText(props.notification))

/** 低置信度只在「确实有结构化时间」时才提示；due_at 为 null 时上行已经写了「待确认」 */
const isLowConfidence = computed(() => {
  if (dueMs.value === null) return false
  const c = props.notification.due_confidence
  if (c === null || c === undefined) return false
  const num = Number(c)
  if (!Number.isFinite(num)) return false
  return num < 0.6
})
</script>
