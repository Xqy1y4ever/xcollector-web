<template>
  <div
    class="xc-card"
    :class="{
      'xc-card--conflict': notification.conflict,
      'xc-card--archived': notification.status === 'archived',
      'xc-card--unconfirmed': due.level === 'unconfirmed'
    }"
    @click="emit('open', notification.id)"
  >
    <!-- 左侧一列：大号 DDL + 原文时间表达 -->
    <div class="xc-card__due">
      <div class="xc-card__due-main" :class="dueMainClass">
        <span v-if="due.prefix" class="xc-tilde">{{ due.prefix }}</span>{{ due.text }}
      </div>
      <div v-if="due.relative" class="xc-card__due-rel">{{ due.relative }}</div>
      <div class="xc-card__due-text" :title="due.original || '后端未给出原文时间表达'">
        <template v-if="due.original">原文「{{ due.original }}」</template>
        <template v-else>原文时间未给出</template>
      </div>
      <el-tag
        v-if="due.level === 'unconfirmed'"
        size="small"
        type="info"
        effect="plain"
        style="margin-top: 6px"
      >
        待确认
      </el-tag>
    </div>

    <!-- 右侧正文 -->
    <div class="xc-card__body">
      <div class="xc-card__title-row">
        <span v-if="!notification.read" class="xc-card__unread-dot" title="未读" />
        <span class="xc-card__title">{{ notification.title }}</span>
        <div class="xc-card__tags">
          <el-tag v-if="notification.conflict" type="danger" size="small" effect="dark">
            DDL 冲突
          </el-tag>
          <el-tag
            v-if="notification.manually_edited"
            type="success"
            size="small"
            effect="plain"
          >
            已人工确认
          </el-tag>
          <el-tag v-if="notification.status === 'expired'" type="warning" size="small" effect="plain">
            已过期
          </el-tag>
          <el-tag v-if="notification.status === 'archived'" type="info" size="small" effect="plain">
            已归档
          </el-tag>
          <el-tag v-if="attachmentCount > 0" type="info" size="small" effect="plain">
            <el-icon><Paperclip /></el-icon>
            {{ attachmentCount }}
          </el-tag>
        </div>
      </div>

      <div v-if="notification.summary" class="xc-card__summary">{{ notification.summary }}</div>

      <!-- 核心：evidence 原文，直接摊在卡片上 -->
      <el-tooltip
        v-if="notification.evidence"
        :content="notification.evidence"
        placement="top"
        :show-after="150"
        popper-class="xc-evidence-tooltip"
      >
        <div class="xc-evidence" @click.stop>
          <span class="xc-evidence__label">证据</span>{{ notification.evidence }}
        </div>
      </el-tooltip>
      <div v-else class="xc-evidence xc-evidence--missing" @click.stop>
        <span class="xc-evidence__label">证据</span>后端未返回 evidence —— 该条抽取缺少原文依据
      </div>

      <div class="xc-card__meta">
        <span>{{ notification.group_name }}</span>
        <span class="xc-dot">·</span>
        <span>{{ notification.sender_name }}</span>
        <span class="xc-dot">·</span>
        <span>{{ sincePublish }}</span>
        <template v-if="candidateCount > 1">
          <span class="xc-dot">·</span>
          <span>{{ candidateCount }} 个模型候选</span>
        </template>
      </div>

      <div class="xc-card__actions" @click.stop>
        <el-button size="small" text type="primary" @click="emit('toggle-read', notification.id)">
          {{ notification.read ? '标为未读' : '标为已读' }}
        </el-button>
        <el-button
          size="small"
          text
          type="info"
          :disabled="notification.status === 'archived'"
          @click="emit('archive', notification.id)"
        >
          这不是通知
        </el-button>
        <el-button size="small" text @click="emit('open', notification.id)">查看原文对照</el-button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { Paperclip } from '@element-plus/icons-vue'

import { buildDueDisplay, describeSincePublish, toMillis } from '../utils/time'

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

const due = computed(() => buildDueDisplay(props.notification, props.now))

const dueMainClass = computed(() => {
  if (due.value.level === 'unconfirmed') return 'xc-card__due-main--unconfirmed'
  const ms = toMillis(props.notification.due_at)
  if (ms === null) return 'xc-card__due-main--unconfirmed'
  const diff = ms - props.now
  if (diff < 0) return 'xc-card__due-main--unconfirmed'
  if (diff < 24 * 3600 * 1000) return 'xc-card__due-main--soon'
  if (diff > 7 * 24 * 3600 * 1000) return 'xc-card__due-main--later'
  return ''
})

const sincePublish = computed(() =>
  describeSincePublish(props.notification.source_ts || props.notification.created_at, props.now)
)

const attachmentCount = computed(() =>
  Array.isArray(props.notification.attachments) ? props.notification.attachments.length : 0
)

const candidateCount = computed(() =>
  Array.isArray(props.notification.candidates) ? props.notification.candidates.length : 0
)
</script>

<style scoped>
.xc-tilde {
  margin-right: 1px;
}

.xc-evidence--missing {
  border-left-color: var(--xc-warning);
  color: var(--xc-warning);
}
</style>
