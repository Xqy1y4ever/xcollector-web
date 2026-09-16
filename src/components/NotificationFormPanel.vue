<template>
  <div>
    <div class="xc-field-label">标题</div>
    <el-input v-model="form.title" placeholder="任务标题" clearable />

    <div class="xc-field-label">摘要</div>
    <el-input
      v-model="form.summary"
      type="textarea"
      :autosize="{ minRows: 2, maxRows: 5 }"
      placeholder="一句话摘要"
    />

    <div class="xc-field-label">
      地点（location）
      <span class="xc-muted">· 如「教三201」，没有地点就留空（留空 = 清除）</span>
    </div>
    <el-input v-model="form.location" placeholder="通知里的地点，如 教三201 / 学工办" clearable />

    <div class="xc-field-label">
      截止时间（due_at）
      <span class="xc-muted">· 结构化时间，用于排序与日历</span>
    </div>
    <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap">
      <el-date-picker
        v-model="form.dueAt"
        type="datetime"
        placeholder="未解析出确定时间"
        format="YYYY-MM-DD HH:mm"
        value-format="YYYY-MM-DD HH:mm:ss"
        clearable
        style="flex: 1 1 220px"
      />
      <el-tag v-if="notification.due_at === null" size="small" type="info" effect="plain">
        原本未解析出时间
      </el-tag>
    </div>

    <div class="xc-field-label">
      时间原文（due_text）
      <span class="xc-muted">· 消息里的原话，无法解析时也必须保留</span>
    </div>
    <el-input v-model="form.dueText" placeholder="如：下周三前" clearable />

    <div class="xc-field-label">
      状态（status）
      <span class="xc-muted">· 当前 {{ statusLabel(notification.status) }}</span>
    </div>
    <el-select v-model="form.status" style="width: 100%">
      <el-option label="进行中 active" value="active" />
      <el-option label="已过期 expired" value="expired" />
      <el-option label="已归档 archived" value="archived" />
      <el-option label="已完成 done" value="done" />
    </el-select>

    <div class="xc-field-label">置信度与标记</div>
    <div style="display: flex; gap: 6px; flex-wrap: wrap; align-items: center">
      <el-tag :type="confidenceTagType" size="small">
        due_confidence {{ formatConfidence(notification.due_confidence) }}
        （{{ confidenceLabel(notification.due_confidence) }}）
      </el-tag>
      <el-tag v-if="notification.manually_edited" type="success" size="small" effect="plain">
        已人工确认
      </el-tag>
      <el-tag v-if="notification.read" type="info" size="small" effect="plain">已读</el-tag>
      <el-tag v-else type="primary" size="small" effect="plain">未读</el-tag>
    </div>

    <el-divider />

    <!-- 保存按钮：移动端移到底部 sticky 操作条，桌面端留在表单下方 -->
    <div v-if="!isMobile" style="display: flex; gap: 8px; flex-wrap: wrap">
      <el-button type="primary" :loading="mutating" :disabled="!hasChanges" @click="emit('save')">
        保存修正
      </el-button>
      <el-button :disabled="!hasChanges || mutating" @click="emit('reset')">撤销改动</el-button>
    </div>
    <div
      v-if="!isMobile && !hasChanges"
      class="xc-muted"
      style="margin-top: 8px; font-size: 12px"
    >
      没有待保存的改动。改动会分别以 field=title / summary / location / due_at / due_text / status
      提交。
    </div>

    <el-divider />
    <div class="xc-field-label">快捷操作</div>
    <div style="display: flex; gap: 8px; flex-wrap: wrap">
      <el-button
        size="small"
        type="success"
        plain
        :disabled="notification.status === 'done'"
        @click="emit('mark-done')"
      >
        标记完成
      </el-button>
      <el-button size="small" @click="emit('toggle-read')">
        {{ notification.read ? '标为未读' : '标为已读' }}
      </el-button>
      <el-button
        size="small"
        type="info"
        plain
        :disabled="notification.status === 'archived'"
        @click="emit('archive')"
      >
        这不是通知（归档）
      </el-button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

import { confidenceLabel, confidenceLevel, statusLabel } from '../utils/time'

/**
 * 「解析结果（可修正）」面板。
 * 移动端与桌面端共用**同一个**表单实例（form 由父组件持有并透传），
 * 保证两种断点下编辑状态不丢失。
 */
const props = defineProps({
  notification: { type: Object, required: true },
  /** 父组件持有的 reactive 表单对象，直接双向绑定 */
  form: { type: Object, required: true },
  hasChanges: { type: Boolean, default: false },
  mutating: { type: Boolean, default: false },
  isMobile: { type: Boolean, default: false }
})

const emit = defineEmits(['save', 'reset', 'toggle-read', 'archive', 'mark-done'])

const confidenceTagType = computed(() => {
  switch (confidenceLevel(props.notification && props.notification.due_confidence)) {
    case 'ok':
      return 'success'
    case 'approx':
      return 'warning'
    default:
      return 'info'
  }
})

function formatConfidence(c) {
  if (c === null || c === undefined || !Number.isFinite(Number(c))) return '未提供'
  return Number(c).toFixed(2)
}
</script>
