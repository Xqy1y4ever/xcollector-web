<template>
  <el-drawer
    :model-value="visible"
    :title="drawerTitle"
    size="62%"
    :destroy-on-close="false"
    @update:model-value="onVisibleChange"
  >
    <div v-loading="loading" element-loading-text="正在读取详情与原文…">
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
        <!-- 冲突告警 + 候选选择 -->
        <el-alert
          v-if="notification.conflict"
          type="error"
          :closable="false"
          show-icon
          title="DDL 冲突：两个模型给出了不一致的截止时间"
          style="margin-bottom: 14px"
        >
          <div style="margin-top: 4px; font-size: 12.5px">
            请对照右侧原文证据判断哪个更可信，点「采用」即写入人工修正（后端会打上「已人工确认」）。
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

        <!-- 核心：左右并排对照 -->
        <div class="xc-detail__grid">
          <!-- 左：解析结果（可编辑） -->
          <div class="xc-detail__panel">
            <div class="xc-detail__panel-title">
              <el-icon><EditPen /></el-icon>
              解析结果（可修正）
            </div>

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

            <div style="display: flex; gap: 8px; flex-wrap: wrap">
              <el-button type="primary" :loading="mutating" :disabled="!hasChanges" @click="save">
                保存修正
              </el-button>
              <el-button :disabled="!hasChanges || mutating" @click="resetForm">撤销改动</el-button>
            </div>
            <div v-if="!hasChanges" class="xc-muted" style="margin-top: 8px; font-size: 12px">
              没有待保存的改动。改动会分别以 field=title / summary / due_at / due_text / status
              提交。
            </div>

            <el-divider />
            <div class="xc-field-label">快捷操作</div>
            <div style="display: flex; gap: 8px; flex-wrap: wrap">
              <el-button size="small" @click="toggleRead">
                {{ notification.read ? '标为未读' : '标为已读' }}
              </el-button>
              <el-button
                size="small"
                type="info"
                plain
                :disabled="notification.status === 'archived'"
                @click="markNotANotification"
              >
                这不是通知（归档）
              </el-button>
            </div>
          </div>

          <!-- 右：原文证据 -->
          <div class="xc-detail__panel">
            <div class="xc-detail__panel-title">
              <el-icon><Document /></el-icon>
              原文证据
            </div>

            <el-alert
              v-if="notification.evidence"
              type="success"
              :closable="false"
              show-icon
              title="模型抽取所依据的原文片段（evidence）"
            >
              <div class="xc-evidence xc-evidence--block" style="margin-top: 8px">
                {{ notification.evidence }}
              </div>
            </el-alert>
            <el-alert
              v-else
              type="error"
              :closable="false"
              show-icon
              title="这条抽取没有 evidence"
              description="按设计原则，无证据的抽取应当作废。请核对原文后决定是否归档。"
            />

            <div class="xc-field-label">
              原始消息全文（evidence 已高亮）
              <span v-if="highlight.matched" class="xc-muted">
                · 命中方式：{{ strategyText }}
              </span>
            </div>
            <div v-if="raw" class="xc-raw-block">
              <template v-if="raw.content">
                <span
                  v-for="(part, idx) in highlight.parts"
                  :key="idx"
                  :class="{ 'xc-hit': part.hit }"
                  >{{ part.text }}</span
                >
              </template>
              <span v-else class="xc-muted">后端未返回 raw.content</span>
            </div>
            <el-alert
              v-else
              type="info"
              :closable="false"
              show-icon
              title="没有原文数据"
              description="详情接口未返回 raw 字段（可能是后端未连接，或该条记录没有关联原始消息）。"
            />
            <div v-if="raw && notification.evidence && !highlight.matched" class="xc-muted" style="margin-top: 6px; font-size: 12px">
              ⚠️ evidence 未能与 raw.content 精确对齐（模型可能改写了标点或省略了 @全体成员），已在下方展示全文，请人工核对。
            </div>

            <el-descriptions
              v-if="raw"
              :column="2"
              size="small"
              border
              style="margin-top: 12px"
            >
              <el-descriptions-item label="群名">{{ raw.group_name || '—' }}</el-descriptions-item>
              <el-descriptions-item label="发布者">
                {{ raw.sender_name || '—' }}
                <span class="xc-muted">({{ raw.sender_id || '—' }})</span>
              </el-descriptions-item>
              <el-descriptions-item label="发送时间">
                {{ formatDateTime(raw.ts) }}
              </el-descriptions-item>
              <el-descriptions-item label="消息 ID">
                <span class="xc-mono">{{ raw.id || '—' }}</span>
              </el-descriptions-item>
            </el-descriptions>
            <el-descriptions v-else :column="2" size="small" border style="margin-top: 12px">
              <el-descriptions-item label="群名">
                {{ notification.group_name }}
              </el-descriptions-item>
              <el-descriptions-item label="发布者">
                {{ notification.sender_name }}
              </el-descriptions-item>
              <el-descriptions-item label="消息时间">
                {{ formatDateTime(notification.source_ts) }}
              </el-descriptions-item>
              <el-descriptions-item label="条目 ID">
                <span class="xc-mono">{{ notification.id }}</span>
              </el-descriptions-item>
            </el-descriptions>

            <!-- 附件 -->
            <template v-if="attachments.length">
              <div class="xc-field-label">附件（{{ attachments.length }}）</div>
              <div class="xc-attach">
                <div v-for="(att, idx) in attachments" :key="idx" class="xc-attach__item">
                  <template v-if="att.type === 'image' && att.url">
                    <el-image
                      :src="att.url"
                      :preview-src-list="imageUrls"
                      :initial-index="imageIndex(att)"
                      fit="cover"
                      style="width: 92px; height: 68px; border-radius: 4px"
                      preview-teleported
                    />
                  </template>
                  <template v-else>
                    <a
                      v-if="att.url"
                      :href="att.url"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="xc-mono"
                    >
                      <el-icon><Link /></el-icon> 下载
                    </a>
                    <span v-else class="xc-muted xc-mono">无下载链接</span>
                  </template>
                  <div class="xc-attach__caption" :title="att.local_path || att.url">
                    {{ att.type || 'file' }}<template v-if="att.local_path"> · 本地已存</template>
                  </div>
                  <div v-if="att.extracted_text" class="xc-muted" style="font-size: 11px">
                    OCR：{{ att.extracted_text }}
                  </div>
                </div>
              </div>
            </template>

            <!-- 原始 JSON -->
            <el-collapse v-if="raw" style="margin-top: 14px">
              <el-collapse-item name="rawjson">
                <template #title>
                  <el-icon><Files /></el-icon>
                  <span style="margin-left: 6px">原始 JSON（OneBot 事件）</span>
                </template>
                <pre class="xc-json">{{ prettyRawJson }}</pre>
              </el-collapse-item>
            </el-collapse>
          </div>
        </div>
      </template>

      <el-empty v-else-if="!loading" description="没有可展示的详情（该条目可能已被删除）" />
    </div>
  </el-drawer>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Document, EditPen, Files, Link } from '@element-plus/icons-vue'

import { useNotificationsStore } from '../stores/notifications'
import { splitByEvidence } from '../utils/evidence'
import {
  confidenceLabel,
  confidenceLevel,
  formatDateTime,
  statusLabel,
  toMillis
} from '../utils/time'

const props = defineProps({
  visible: { type: Boolean, default: false },
  notificationId: { type: String, default: '' }
})

const emit = defineEmits(['update:visible'])

const store = useNotificationsStore()

const mutating = ref(false)

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

const attachments = computed(() =>
  Array.isArray(notification.value && notification.value.attachments)
    ? notification.value.attachments
    : []
)

const imageUrls = computed(() =>
  attachments.value.filter((a) => a.type === 'image' && a.url).map((a) => a.url)
)

function imageIndex(att) {
  const idx = imageUrls.value.indexOf(att.url)
  return idx === -1 ? 0 : idx
}

/** evidence 在 raw.content 里高亮后的切片 */
const highlight = computed(() => {
  const content = raw.value && raw.value.content ? raw.value.content : ''
  const evidence = notification.value ? notification.value.evidence || '' : ''
  if (!content) return { parts: [{ text: '', hit: false }], matched: false, strategy: 'none' }
  return splitByEvidence(content, evidence)
})

const strategyText = computed(() => {
  switch (highlight.value.strategy) {
    case 'exact':
      return '逐字命中'
    case 'normalized':
      return '忽略标点/空白后命中'
    case 'partial':
      return '部分匹配（模型改写过原文）'
    default:
      return '未命中'
  }
})

const prettyRawJson = computed(() => {
  if (!raw.value) return ''
  const src = raw.value.raw_json
  if (!src) return '（后端未返回 raw_json）'
  if (typeof src === 'object') {
    try {
      return JSON.stringify(src, null, 2)
    } catch (e) {
      return String(src)
    }
  }
  try {
    return JSON.stringify(JSON.parse(src), null, 2)
  } catch (e) {
    // 不是合法 JSON 就原样展示，不报错
    return String(src)
  }
})

/* ---------------- 表单 ---------------- */

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

function markDirty() {
  dirty.value = true
}

watch(form, () => markDirty(), { deep: true })

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

/* ---------------- 展示辅助 ---------------- */

const confidenceTagType = computed(() => {
  switch (confidenceLevel(notification.value && notification.value.due_confidence)) {
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

.xc-json {
  margin: 0;
  padding: 10px;
  background: var(--xc-bg-soft);
  border-radius: 4px;
  font-family: var(--xc-mono);
  font-size: 11.5px;
  line-height: 1.6;
  max-height: 320px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
