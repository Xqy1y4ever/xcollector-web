<template>
  <el-drawer
    :model-value="visible"
    :title="drawerTitle"
    :size="drawerSize"
    :class="drawerClass"
    :destroy-on-close="false"
    @update:model-value="onVisibleChange"
  >
    <div
      v-loading="loading"
      element-loading-text="正在读取详情与原文…"
      class="xc-detail__scroll"
      :style="isMobile ? { paddingBottom: '84px' } : null"
    >
      <!-- 后端不可用 / 详情接口失败：降级提示，但列表里的数据仍然可读 -->
      <el-alert
        v-if="error"
        type="warning"
        :closable="false"
        show-icon
        :title="error"
        description="以下内容来自列表缓存，不含 raw 原文。请确认 FastAPI 已在 127.0.0.1:8000 运行后重试。"
        style="margin-bottom: 14px"
      />

      <template v-if="notification">
        <!-- ① 冲突提示：两种断点下都排在最前 -->
        <el-alert
          v-if="notification.conflict"
          type="error"
          :closable="false"
          show-icon
          title="DDL 冲突：两个模型给出了不一致的截止时间"
          style="margin-bottom: 14px"
        >
          <div style="margin-top: 4px; font-size: 12.5px">
            请对照{{ isMobile ? '下方' : '右侧' }}原文证据判断哪个更可信，点「采用」即写入人工修正（后端会打上「已人工确认」）。
          </div>
          <div class="xc-candidate-list">
            <div v-for="(c, idx) in candidates" :key="idx" class="xc-candidate">
              <span class="xc-candidate__model">{{ c.model || `候选 ${idx + 1}` }}</span>
              <span class="xc-candidate__value">
                <template v-if="c.due_at === null || c.due_at === undefined">未解析出时间</template>
                <template v-else>{{ formatDateTime(c.due_at) }}</template>
              </span>
              <span class="xc-muted" style="font-size: 12px">
                原文{{ c.due_text ? `「${c.due_text}」` : '未给出' }}
              </span>
              <el-button
                size="small"
                type="danger"
                plain
                style="margin-left: auto"
                :loading="mutating"
                @click="adoptCandidate(c)"
              >
                采用
              </el-button>
            </div>
            <div v-if="candidates.length === 0" class="xc-muted" style="font-size: 12.5px">
              后端标记为冲突但没有返回 candidates 明细。
            </div>
          </div>
        </el-alert>

        <!-- 移动端：上下堆叠 ② 解析结果 ③ 原文证据 ④ 原始 JSON 折叠 -->
        <div v-if="isMobile" class="xc-detail__stack">
          <div class="xc-detail__panel">
            <div class="xc-detail__panel-title">
              <el-icon><EditPen /></el-icon>
              解析结果（可修正）
            </div>
            <NotificationFormPanel
              :notification="notification"
              :form="form"
              :has-changes="hasChanges"
              :mutating="mutating"
              :is-mobile="true"
              @save="save"
              @reset="resetForm"
              @toggle-read="toggleRead"
              @archive="markNotANotification"
            />
          </div>

          <div class="xc-detail__panel">
            <div class="xc-detail__panel-title">
              <el-icon><Document /></el-icon>
              原文证据
            </div>
            <NotificationEvidencePanel :notification="notification" :raw="raw" :show-json="true" />
          </div>
        </div>

        <!-- 桌面端：左右并排对照（左解析结果 / 右原文证据），保存按钮留在表单下方 -->
        <div v-else class="xc-detail__grid">
          <div class="xc-detail__panel">
            <div class="xc-detail__panel-title">
              <el-icon><EditPen /></el-icon>
              解析结果（可修正）
            </div>
            <NotificationFormPanel
              :notification="notification"
              :form="form"
              :has-changes="hasChanges"
              :mutating="mutating"
              :is-mobile="false"
              @save="save"
              @reset="resetForm"
              @toggle-read="toggleRead"
              @archive="markNotANotification"
            />
          </div>

          <div class="xc-detail__panel">
            <div class="xc-detail__panel-title">
              <el-icon><Document /></el-icon>
              原文证据
            </div>
            <NotificationEvidencePanel :notification="notification" :raw="raw" :show-json="false" />
          </div>
        </div>
      </template>

      <el-empty v-else-if="!loading" description="没有可展示的详情（该条目可能已被删除）" />
    </div>

    <!-- 移动端底部 sticky 操作条：固定在抽屉底部 -->
    <template v-if="isMobile" #footer>
      <div class="xc-detail__bar">
        <el-button type="primary" :loading="mutating" :disabled="!hasChanges" @click="save">
          保存修正
        </el-button>
        <el-button :disabled="!hasChanges || mutating" @click="resetForm">撤销改动</el-button>
        <span class="xc-muted xc-detail__bar-hint">
          {{ hasChanges ? '有未保存的改动' : '暂无改动' }}
        </span>
      </div>
    </template>
  </el-drawer>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Document, EditPen } from '@element-plus/icons-vue'

import NotificationEvidencePanel from './NotificationEvidencePanel.vue'
import NotificationFormPanel from './NotificationFormPanel.vue'
import { useNotificationsStore } from '../stores/notifications'
import { useIsMobile } from '../utils/useIsMobile'
import { formatDateTime, toMillis } from '../utils/time'

/**
 * 详情抽屉。
 *
 * 移动端（<=768px）：size=100% 全屏，内容上下堆叠，顺序为
 *   ① 冲突提示 ② 解析结果（可编辑） ③ 原文证据 ④ 原始 JSON 折叠，
 *   底部是常驻的 sticky 操作条（保存修正）。
 *
 * 桌面端：size=62%，保持左右并排对照（左解析结果 / 右原文证据），保存按钮留在表单下方。
 *
 * 打开即标为已读的行为由父组件 NotificationBoard 保留，未在此处改动。
 */
const props = defineProps({
  visible: { type: Boolean, default: false },
  notificationId: { type: String, default: '' }
})

const emit = defineEmits(['update:visible'])

const store = useNotificationsStore()
const isMobile = useIsMobile()

const mutating = ref(false)

const drawerSize = computed(() => (isMobile.value ? '100%' : '62%'))
const drawerClass = computed(() =>
  isMobile.value ? 'xc-drawer--mobile xc-drawer--fullscreen' : ''
)

const notification = computed(() => {
  const detail = store.detail
  if (detail && detail.notification) return detail.notification
  if (props.notificationId) return store.getById(props.notificationId)
  return null
})

const raw = computed(() => (store.detail && store.detail.raw) || null)
const loading = computed(() => store.detailLoading)
const error = computed(() => store.detailError)

const drawerTitle = computed(() => {
  if (!notification.value) return '通知详情'
  return `通知详情 · ${notification.value.title}`
})

const candidates = computed(() =>
  Array.isArray(notification.value && notification.value.candidates)
    ? notification.value.candidates
    : []
)

/* ---------------- 表单（父组件持有，两个断点共用同一份状态） ---------------- */

const form = reactive({
  title: '',
  summary: '',
  dueAt: null,
  dueText: '',
  status: 'active'
})

/** 把毫秒时间戳转成 el-date-picker 能识别的字符串（YYYY-MM-DD HH:mm:ss） */
function msToPickerValue(ms) {
  const t = toMillis(ms)
  if (t === null) return null
  const d = new Date(t)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes()
  )}:${p(d.getSeconds())}`
}

function syncForm() {
  const n = notification.value
  if (!n) {
    form.title = ''
    form.summary = ''
    form.dueAt = null
    form.dueText = ''
    form.status = 'active'
    return
  }
  form.title = n.title || ''
  form.summary = n.summary || ''
  form.dueAt = msToPickerValue(n.due_at)
  form.dueText = n.due_text || ''
  form.status = n.status || 'active'
}

watch(
  () => notification.value && notification.value.id,
  () => syncForm(),
  { immediate: true }
)

// 详情接口返回后刷新表单，但用户已经改了东西就不覆盖
const dirty = ref(false)
watch(
  () => store.detail,
  () => {
    if (!dirty.value) syncForm()
  }
)

watch(
  () => props.visible,
  (open) => {
    if (open) {
      dirty.value = false
      syncForm()
    }
  }
)

watch(form, () => {
  dirty.value = true
}, { deep: true })

const originalDueMs = computed(() => toMillis(notification.value && notification.value.due_at))
const formDueMs = computed(() => toMillis(form.dueAt))

const hasChanges = computed(() => {
  const n = notification.value
  if (!n) return false
  if (form.title !== (n.title || '')) return true
  if (form.summary !== (n.summary || '')) return true
  if (form.dueText !== (n.due_text || '')) return true
  if (form.status !== (n.status || 'active')) return true
  if (originalDueMs.value !== formDueMs.value) return true
  return false
})

function resetForm() {
  dirty.value = false
  syncForm()
}

/* ---------------- 提交修正 ---------------- */

async function submitField(field, value) {
  const n = notification.value
  if (!n) return { ok: false, message: '没有可修正的条目' }
  mutating.value = true
  try {
    return await store.correct(n.id, field, value)
  } finally {
    mutating.value = false
  }
}

async function save() {
  const n = notification.value
  if (!n) return
  const failures = []

  if (form.title !== (n.title || '')) {
    const r = await submitField('title', form.title)
    if (!r.ok) failures.push(`标题：${r.message}`)
  }
  if (form.summary !== (n.summary || '')) {
    const r = await submitField('summary', form.summary)
    if (!r.ok) failures.push(`摘要：${r.message}`)
  }
  // due_at 传毫秒 int 或 null，绝不传字符串
  if (originalDueMs.value !== formDueMs.value) {
    const r = await submitField('due_at', formDueMs.value)
    if (!r.ok) failures.push(`截止时间：${r.message}`)
  }
  if (form.dueText !== (n.due_text || '')) {
    const r = await submitField('due_text', form.dueText)
    if (!r.ok) failures.push(`时间原文：${r.message}`)
  }
  if (form.status !== (n.status || 'active')) {
    const r = await submitField('status', form.status)
    if (!r.ok) failures.push(`状态：${r.message}`)
  }

  dirty.value = false
  if (failures.length === 0) {
    ElMessage.success('修正已保存')
  } else {
    ElMessage.error(`部分修正保存失败：${failures.join('；')}`)
  }
}

/** 采用某个模型的候选值（冲突时用） */
async function adoptCandidate(candidate) {
  const n = notification.value
  if (!n) return
  const dueValue = candidate.due_at === undefined ? null : candidate.due_at

  try {
    await ElMessageBox.confirm(
      `确定采用「${candidate.model || '该候选'}」的结果：${
        dueValue === null ? '未解析出时间' : formatDateTime(dueValue)
      }？`,
      '采用该候选',
      { confirmButtonText: '采用', cancelButtonText: '取消', type: 'warning' }
    )
  } catch (e) {
    return
  }

  const r1 = await submitField('due_at', dueValue)
  if (!r1.ok) {
    ElMessage.error(`提交失败：${r1.message}`)
    return
  }
  if (candidate.due_text) {
    const r2 = await submitField('due_text', candidate.due_text)
    if (!r2.ok) {
      ElMessage.warning(`时间已采用，但时间原文保存失败：${r2.message}`)
    }
  }
  dirty.value = false
  syncForm()
  ElMessage.success('已采用该候选的 DDL')
}

async function toggleRead() {
  const n = notification.value
  if (!n) return
  const r = await store.toggleRead(n.id)
  if (!r.ok) ElMessage.error(r.message)
}

async function markNotANotification() {
  const n = notification.value
  if (!n) return
  try {
    await ElMessageBox.confirm(
      '将把这条记录标记为「不是通知」（status=archived）。确认？',
      '这不是通知',
      { confirmButtonText: '确认归档', cancelButtonText: '取消', type: 'warning' }
    )
  } catch (e) {
    return
  }
  const r = await store.archive(n.id)
  if (r.ok) ElMessage.success('已归档')
  else ElMessage.error(r.message)
}

function onVisibleChange(val) {
  if (!val) {
    dirty.value = false
    emit('update:visible', false)
    store.closeDetail()
  } else {
    emit('update:visible', true)
  }
}
</script>

<style scoped>
.xc-candidate-list {
  margin-top: 8px;
  padding: 8px 10px;
  background: #fff;
  border-radius: 4px;
}

/* 移动端底部操作条 */
.xc-detail__bar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.xc-detail__bar-hint {
  margin-left: auto;
  font-size: 12px;
}
</style>
