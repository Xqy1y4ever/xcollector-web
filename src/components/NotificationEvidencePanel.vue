<template>
  <div>
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
      <span v-if="highlight.matched" class="xc-muted"> · 命中方式：{{ strategyText }}</span>
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
    <div
      v-if="raw && notification.evidence && !highlight.matched"
      class="xc-muted"
      style="margin-top: 6px; font-size: 12px"
    >
      ⚠️ evidence 未能与 raw.content 精确对齐（模型可能改写了标点或省略了 @全体成员），已在下方展示全文，请人工核对。
    </div>

    <el-descriptions v-if="raw" :column="2" size="small" border style="margin-top: 12px">
      <el-descriptions-item label="群名">{{ raw.group_name || '—' }}</el-descriptions-item>
      <el-descriptions-item label="发布者">
        {{ raw.sender_name || '—' }}
        <span class="xc-muted">({{ raw.sender_id || '—' }})</span>
      </el-descriptions-item>
      <el-descriptions-item label="发送时间">{{ formatDateTime(raw.ts) }}</el-descriptions-item>
      <el-descriptions-item label="消息 ID">
        <span class="xc-mono">{{ raw.id || '—' }}</span>
      </el-descriptions-item>
    </el-descriptions>
    <el-descriptions v-else :column="2" size="small" border style="margin-top: 12px">
      <el-descriptions-item label="群名">{{ notification.group_name }}</el-descriptions-item>
      <el-descriptions-item label="发布者">{{ notification.sender_name }}</el-descriptions-item>
      <el-descriptions-item label="消息时间">
        {{ formatDateTime(notification.source_ts) }}
      </el-descriptions-item>
      <el-descriptions-item label="条目 ID">
        <span class="xc-mono">{{ notification.id }}</span>
      </el-descriptions-item>
    </el-descriptions>

    <!-- 附件：契约里 attachments[] = {id, type, name, size, url}
         url 形如 /api/attachments/att_xxx（相对路径，已由 vite 的 /api 代理转发到后端），直接用。
         旧的 local_path 字段已废弃，不再引用。 -->
    <template v-if="attachments.length">
      <div class="xc-field-label">附件（{{ attachments.length }}）</div>
      <div class="xc-attach">
        <div v-for="(att, idx) in attachments" :key="att.id || idx" class="xc-attach__item">
          <template v-if="att.type === 'image' && attUrl(att)">
            <el-image
              :src="attUrl(att)"
              :preview-src-list="imageUrls"
              :initial-index="imageIndex(att)"
              fit="cover"
              style="width: 92px; height: 68px; border-radius: 4px"
              preview-teleported
            />
          </template>
          <template v-else>
            <a
              v-if="attUrl(att)"
              :href="attUrl(att)"
              target="_blank"
              rel="noopener noreferrer"
              class="xc-mono"
            >
              <el-icon><Link /></el-icon> 下载
            </a>
            <span v-else class="xc-muted xc-mono">无下载链接</span>
          </template>
          <div class="xc-attach__caption" :title="attTitle(att)">
            {{ att.type || 'file' }}<template v-if="att.name"> · {{ att.name }}</template>
          </div>
        </div>
      </div>
    </template>

    <!-- 原始 JSON 折叠：showJson=true 时作为本面板最后一块（移动端第 ④ 项） -->
    <el-collapse v-if="showJson && raw" style="margin-top: 14px">
      <el-collapse-item name="rawjson">
        <template #title>
          <el-icon><Files /></el-icon>
          <span style="margin-left: 6px">原始 JSON（OneBot 事件）</span>
        </template>
        <pre class="xc-json">{{ prettyRawJson }}</pre>
      </el-collapse-item>
    </el-collapse>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { Files, Link } from '@element-plus/icons-vue'

import { attachmentUrl } from '../api/client'
import { splitByEvidence } from '../utils/evidence'
import { formatDateTime } from '../utils/time'

/**
 * 「原文证据」面板：evidence 高亮块 + 原文全文 + 元信息 + 附件 (+ 可选原始 JSON)。
 * 卡片上不再显示 evidence，这里是唯一能看到结论依据的地方。
 */
const props = defineProps({
  notification: { type: Object, required: true },
  /** 详情接口返回的 raw 对象，可能为 null（后端不可用时的降级） */
  raw: { type: Object, default: null },
  /** 是否在本面板末尾内联渲染原始 JSON 折叠（移动端为 true，作为第 ④ 块） */
  showJson: { type: Boolean, default: false }
})

const attachments = computed(() =>
  Array.isArray(props.notification && props.notification.attachments)
    ? props.notification.attachments
    : []
)

/** 附件地址：契约第 9 节，直接用后端的相对路径 `/api/attachments/att_xxx` */
function attUrl(att) {
  return attachmentUrl(att)
}

function attTitle(att) {
  const parts = []
  if (att && att.name) parts.push(att.name)
  if (att && att.type) parts.push(`类型 ${att.type}`)
  if (att && att.size) parts.push(`${att.size} 字节`)
  const url = attUrl(att)
  return parts.length ? `${parts.join(' · ')}${url ? ` · ${url}` : ''}` : url || '附件'
}

const imageUrls = computed(() =>
  attachments.value.filter((a) => a && a.type === 'image' && attUrl(a)).map((a) => attUrl(a))
)

function imageIndex(att) {
  const idx = imageUrls.value.indexOf(attUrl(att))
  return idx === -1 ? 0 : idx
}

/** evidence 在 raw.content 里高亮后的切片 */
const highlight = computed(() => {
  const content = props.raw && props.raw.content ? props.raw.content : ''
  const evidence = props.notification ? props.notification.evidence || '' : ''
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
  if (!props.raw) return ''
  const src = props.raw.raw_json
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
</script>

<style scoped>
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
