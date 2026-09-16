<template>
  <div>
    <AppHeader :loading="loading" :last-synced-at="lastLoadedAt" @refresh="load" />

    <div class="xc-page">
      <el-alert
        v-if="store.error"
        type="error"
        :closable="false"
        show-icon
        :title="store.error"
        description="请确认 FastAPI 已在 127.0.0.1:8000 运行。下面的卡片可能是不完整的默认值。"
        style="margin-top: 16px"
      />

      <!-- 三张主卡片 -->
      <div class="xc-health-grid" style="margin-top: 18px">
        <el-card shadow="never">
          <template #header>
            <div class="xc-card-header">
              <span>OneBot 连接</span>
              <span class="xc-status-dot" :class="`xc-status-dot--${store.connectionState}`" />
            </div>
          </template>
          <el-descriptions :column="1" size="small" border>
            <el-descriptions-item label="模式">
              {{ onebot.mode || '—' }}
            </el-descriptions-item>
            <el-descriptions-item label="目标地址">
              <span class="xc-mono">{{ onebot.target || '—' }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="连接状态">
              <el-tag :type="onebot.connected ? 'success' : 'danger'" size="small" effect="plain">
                {{ onebot.connected ? '已连接' : '已断开' }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="最后事件">
              <template v-if="onebot.last_event_at">
                {{ formatDateTime(onebot.last_event_at) }}
                <span class="xc-muted">（{{ timeAgoShort(onebot.last_event_at, now) }}）</span>
              </template>
              <template v-else>从未收到事件</template>
            </el-descriptions-item>
            <el-descriptions-item label="重连次数">
              <span :class="{ 'xc-warn-text': onebot.reconnect_count > 0 }">
                {{ onebot.reconnect_count ?? 0 }}
              </span>
            </el-descriptions-item>
          </el-descriptions>
        </el-card>

        <el-card shadow="never">
          <template #header>
            <div class="xc-card-header">
              <span>LLM 配置</span>
              <el-tag :type="llm.enabled ? 'success' : 'info'" size="small" effect="plain">
                {{ llm.enabled ? '已启用' : '未启用' }}
              </el-tag>
            </div>
          </template>
          <el-descriptions :column="1" size="small" border>
            <el-descriptions-item label="主模型">
              <span class="xc-mono">{{ llm.primary_model || '—' }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="副模型">
              <span class="xc-mono">{{ llm.secondary_model || '—' }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="交叉校验">
              <el-tag
                :type="llm.cross_check_enabled ? 'success' : 'warning'"
                size="small"
                effect="plain"
              >
                {{ llm.cross_check_enabled ? '开启（双模型比对 DDL）' : '关闭（无冲突检测）' }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="抽取器">
              <span class="xc-mono">{{ config && config.extractor ? config.extractor : '—' }}</span>
            </el-descriptions-item>
          </el-descriptions>
          <div
            v-if="!llm.cross_check_enabled"
            class="xc-muted"
            style="margin-top: 8px; font-size: 12px"
          >
            交叉校验关闭时不会有 conflict 标记，DDL 错误只能靠人工抽查发现。
          </div>
        </el-card>

        <el-card shadow="never">
          <template #header>
            <div class="xc-card-header">
              <span>今日流水线</span>
              <el-tag v-if="pipeline.today_degraded > 0" type="warning" size="small" effect="dark">
                已降级
              </el-tag>
            </div>
          </template>
          <el-descriptions :column="2" size="small" border>
            <el-descriptions-item label="入库消息">
              {{ pipeline.today_ingested }}
            </el-descriptions-item>
            <el-descriptions-item label="抽出条目">
              {{ pipeline.today_extracted }}
            </el-descriptions-item>
            <el-descriptions-item label="未解析">
              <span :class="{ 'xc-warn-text': pipeline.today_unparsed > 0 }">
                {{ pipeline.today_unparsed }}
              </span>
            </el-descriptions-item>
            <el-descriptions-item label="DDL 冲突">
              <span :class="{ 'xc-warn-text': pipeline.today_conflicts > 0 }">
                {{ pipeline.today_conflicts }}
              </span>
            </el-descriptions-item>
            <el-descriptions-item label="降级次数">
              {{ pipeline.today_degraded }}
            </el-descriptions-item>
            <el-descriptions-item label="LLM tokens">
              {{ formatNumber(pipeline.today_llm_tokens) }}
            </el-descriptions-item>
          </el-descriptions>
          <div class="xc-muted" style="margin-top: 8px; font-size: 12px">
            入库 {{ pipeline.today_ingested }} 条 → 抽出 {{ pipeline.today_extracted }} 条，中间差额要么是
            闲聊，要么是未解析（见下方盲区）。
          </div>
        </el-card>
      </div>

      <!-- 系统盲区：从主页搬过来，回答「今天系统漏了什么」 -->
      <div class="xc-section-title">
        <span>系统盲区</span>
        <el-tag v-if="blindspotTotal > 0" type="warning" size="small" effect="dark">
          {{ blindspotTotal }} 项需要关注
        </el-tag>
        <el-tag v-else type="success" size="small" effect="plain">暂无盲区</el-tag>
        <span class="xc-count">避免把「今天没任务」和「系统瞎了」搞混</span>
      </div>

      <div class="xc-health-grid">
        <el-card shadow="never" :class="{ 'xc-blindspot__cell--warn': unparsedCount > 0 }">
          <template #header>
            <div class="xc-card-header">
              <span>未解析</span>
              <span
                class="xc-blindspot__num"
                :class="unparsedCount > 0 ? 'xc-warn-text' : 'xc-blindspot__num--zero'"
              >
                {{ unparsedCount }}
              </span>
            </div>
          </template>
          <div class="xc-blindspot__desc">
            这些消息已入库但没能抽出内容，可能是图片、格式异常，或模型判定为闲聊。
          </div>
        </el-card>

        <el-card shadow="never" :class="{ 'xc-blindspot__cell--warn': conflictCount > 0 }">
          <template #header>
            <div class="xc-card-header">
              <span>DDL 冲突</span>
              <span
                class="xc-blindspot__num"
                :class="conflictCount > 0 ? 'xc-warn-text' : 'xc-blindspot__num--zero'"
              >
                {{ conflictCount }}
              </span>
            </div>
          </template>
          <div class="xc-blindspot__desc">
            两个模型给出的截止时间不一致，需要人工在详情页对照原文选一个。
          </div>
        </el-card>

        <el-card shadow="never" :class="{ 'xc-blindspot__cell--warn': lowConfidenceCount > 0 }">
          <template #header>
            <div class="xc-card-header">
              <span>低置信度</span>
              <span
                class="xc-blindspot__num"
                :class="lowConfidenceCount > 0 ? 'xc-warn-text' : 'xc-blindspot__num--zero'"
              >
                {{ lowConfidenceCount }}
              </span>
            </div>
          </template>
          <div class="xc-blindspot__desc">
            时间是从模糊表述里推出来的（如「尽快」），卡片上标了「待确认」，别直接当准确时间用。
          </div>
        </el-card>

        <el-card shadow="never" :class="{ 'xc-blindspot__cell--warn': gapAlerts.length > 0 }">
          <template #header>
            <div class="xc-card-header">
              <span>消息缺口</span>
              <span
                class="xc-blindspot__num"
                :class="gapAlerts.length > 0 ? 'xc-warn-text' : 'xc-blindspot__num--zero'"
              >
                {{ gapAlerts.length }}
              </span>
            </div>
          </template>
          <div class="xc-blindspot__desc">
            某段时间完全没有消息，通常意味着连接器掉线，而不是群里真的没人说话。
          </div>
        </el-card>

        <el-card shadow="never" :class="{ 'xc-blindspot__cell--warn': degradedToday }">
          <template #header>
            <div class="xc-card-header">
              <span>今日是否降级</span>
              <span
                class="xc-blindspot__num"
                :class="degradedToday ? 'xc-warn-text' : 'xc-blindspot__num--zero'"
              >
                {{ degradedToday ? '是' : '否' }}
              </span>
            </div>
          </template>
          <div class="xc-blindspot__desc">
            {{
              degradedToday
                ? '已触发降级：只跑了规则命中的消息，今天的召回可能不完整。'
                : '未降级，今天全量消息都走了正常流水线。'
            }}
          </div>
        </el-card>
      </div>

      <div v-if="gapAlerts.length" class="xc-blindspot__gaps">
        <div class="xc-field-label">缺口明细</div>
        <div
          v-for="gap in gapAlerts"
          :key="gap.id || `${gap.group_id}-${gap.from_ts}`"
          class="xc-gap-row"
        >
          <el-tag type="warning" size="small" effect="plain">缺口</el-tag>
          <span>{{ gap.group_name || gap.group_id }}</span>
          <span class="xc-muted">
            {{ formatDateTime(gap.from_ts) }} → {{ formatDateTime(gap.to_ts) }}
          </span>
          <span class="xc-muted">
            （{{ formatDuration(toMillis(gap.to_ts) - toMillis(gap.from_ts)) }} 无消息）
          </span>
        </div>
      </div>

      <!-- 每日 digest -->
      <div class="xc-section-title">
        <span>每日 digest</span>
        <span class="xc-count">
          {{
            config && config.digest_enabled
              ? `已启用 · 每天 ${config.digest_time || '—'} 推送`
              : '未启用'
          }}
        </span>
      </div>
      <el-card shadow="never">
        <div style="display: flex; gap: 10px; flex-wrap: wrap; align-items: center">
          <el-button :loading="store.digestLoading" @click="previewDigest">
            <el-icon style="margin-right: 4px"><View /></el-icon>
            预览 digest
          </el-button>
          <el-button type="primary" :loading="store.digestSending" @click="sendToQQ">
            <el-icon style="margin-right: 4px"><Promotion /></el-icon>
            发送到 QQ
          </el-button>
          <span class="xc-muted" style="font-size: 12px">
            发送前会二次确认，并且按接口契约以 <span class="xc-mono">dry_run: false</span> 提交。
          </span>
        </div>
      </el-card>

      <!-- 群列表 -->
      <div class="xc-section-title">
        <span>订阅的群</span>
        <span class="xc-count">{{ groups.length }} 个</span>
        <span v-if="config && config.sender_whitelist_mode" class="xc-count">
          · 发送者白名单模式：{{ config.sender_whitelist_mode }}
        </span>
      </div>
      <el-table :data="groups" size="small" border stripe style="width: 100%">
        <el-table-column prop="group_name" label="群名" min-width="180">
          <template #default="{ row }">
            <span>{{ row.group_name || '—' }}</span>
            <span class="xc-muted xc-mono" style="margin-left: 6px">{{ row.group_id }}</span>
          </template>
        </el-table-column>
        <el-table-column label="在白名单" width="110" align="center">
          <template #default="{ row }">
            <el-tag :type="row.in_whitelist ? 'success' : 'info'" size="small" effect="plain">
              {{ row.in_whitelist ? '是' : '否' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="最后消息时间" min-width="180">
          <template #default="{ row }">
            <template v-if="row.last_msg_ts">
              {{ formatDateTime(row.last_msg_ts) }}
              <div class="xc-muted" style="font-size: 11px">
                {{ timeAgoShort(row.last_msg_ts, now) }}
              </div>
            </template>
            <span v-else class="xc-muted">从未收到消息</span>
          </template>
        </el-table-column>
        <el-table-column label="静默小时数" width="140" align="center">
          <template #default="{ row }">
            <span :class="{ 'xc-warn-text': isSilent(row) }">
              {{ formatHours(row.silent_hours) }}
              <template v-if="isSilent(row)">
                <el-tag type="warning" size="small" effect="plain" style="margin-left: 4px">
                  可能掉线
                </el-tag>
              </template>
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="msg_count_today" label="今日消息" width="100" align="center" />
        <el-table-column label="操作" width="120" align="center">
          <template #default="{ row }">
            <el-button size="small" text type="primary" @click="searchGroup(row)">
              查看通知
            </el-button>
          </template>
        </el-table-column>
        <template #empty>
          <span class="xc-muted">没有群数据（后端可能未连接）</span>
        </template>
      </el-table>

      <!-- 缺口告警 -->
      <div class="xc-section-title">
        <span>消息缺口告警</span>
        <span class="xc-count">{{ gapAlerts.length }} 条</span>
      </div>
      <template v-if="gapAlerts.length">
        <el-alert
          v-for="gap in gapAlerts"
          :key="gap.id || `${gap.group_id}-${gap.from_ts}`"
          type="warning"
          :closable="false"
          show-icon
          style="margin-bottom: 8px"
          :title="`${gap.group_name || gap.group_id} 有 ${formatDuration(
            toMillis(gap.to_ts) - toMillis(gap.from_ts)
          )} 完全没有消息`"
        >
          <div style="font-size: 12.5px">
            空档：{{ formatDateTime(gap.from_ts) }} → {{ formatDateTime(gap.to_ts) }}
            <span class="xc-muted">
              · 记录于 {{ formatDateTime(gap.created_at) }}
            </span>
          </div>
          <div class="xc-muted" style="font-size: 12px; margin-top: 2px">
            这段空档通常是连接器掉线而不是群里没人说话，请检查 OneBot 是否还在运行。
          </div>
        </el-alert>
      </template>
      <el-empty v-else description="没有缺口告警，所有群的消息都是连续的" :image-size="70" />

      <!-- 白名单等元配置 -->
      <div class="xc-section-title"><span>配置快照</span></div>
      <el-card shadow="never">
        <el-descriptions :column="1" size="small" border>
          <el-descriptions-item label="群白名单">
            <template v-if="groupWhitelist.length">
              <el-tag
                v-for="g in groupWhitelist"
                :key="g.group_id"
                size="small"
                effect="plain"
                style="margin: 2px 4px 2px 0"
              >
                {{ g.name || g.group_id }}
                <span class="xc-mono xc-muted">({{ g.group_id }})</span>
              </el-tag>
            </template>
            <span v-else class="xc-muted">未配置</span>
          </el-descriptions-item>
          <el-descriptions-item label="发送者白名单">
            <template v-if="senderWhitelist.length">
              <el-tag
                v-for="s in senderWhitelist"
                :key="s.sender_id"
                size="small"
                effect="plain"
                style="margin: 2px 4px 2px 0"
              >
                {{ s.name || s.sender_id }}
              </el-tag>
            </template>
            <span v-else class="xc-muted">未配置</span>
          </el-descriptions-item>
          <el-descriptions-item label="digest 时间">
            {{ (config && config.digest_time) || '—' }}
          </el-descriptions-item>
          <el-descriptions-item label="服务器时间">
            {{ formatDateTime(store.health.server_time) }}
          </el-descriptions-item>
        </el-descriptions>
        <div v-if="!config" class="xc-muted" style="margin-top: 8px; font-size: 12px">
          /api/config/meta 未取到（后端可能未连接）。
        </div>
      </el-card>
    </div>

    <!-- digest 预览弹窗 -->
    <el-dialog v-model="store.digestDialogVisible" title="digest 预览" width="640px">
      <div v-loading="store.digestLoading">
        <pre class="xc-digest">{{ store.digestText || '正在生成…' }}</pre>
      </div>
      <template #footer>
        <el-button @click="store.digestDialogVisible = false">关闭</el-button>
        <el-button type="primary" @click="copyDigest">复制文本</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Promotion, View } from '@element-plus/icons-vue'

import AppHeader from '../components/AppHeader.vue'
import { useHealthStore } from '../stores/health'
import { useNotificationsStore } from '../stores/notifications'
import { formatDateTime, formatDuration, timeAgoShort, toMillis } from '../utils/time'

const store = useHealthStore()
/** 盲区数据挂在列表接口的 blindspots 字段上（接口契约不变），所以也要用通知 store */
const notificationsStore = useNotificationsStore()
const router = useRouter()

const now = ref(Date.now())
let tickTimer = null

const loading = computed(() => store.loading)
const lastLoadedAt = computed(() => store.lastLoadedAt)
const onebot = computed(() => store.health.onebot || {})
const pipeline = computed(() => store.health.pipeline || {})
const llm = computed(() => store.health.llm || {})
const groups = computed(() => store.health.groups || [])
const gapAlerts = computed(() => store.health.gap_alerts || [])
const config = computed(() => store.config)

/* ---------------- 盲区（原主页 BlindSpotPanel 的内容） ---------------- */
const blindspots = computed(() => notificationsStore.blindspots || {})
const unparsedCount = computed(() => Number(blindspots.value.unparsed_count) || 0)
const conflictCount = computed(() => Number(blindspots.value.conflict_count) || 0)
const lowConfidenceCount = computed(() => Number(blindspots.value.low_confidence_count) || 0)
const degradedToday = computed(() => !!blindspots.value.degraded_today)
const blindspotTotal = computed(
  () =>
    unparsedCount.value +
    conflictCount.value +
    lowConfidenceCount.value +
    gapAlerts.value.length +
    (degradedToday.value ? 1 : 0)
)

const groupWhitelist = computed(() =>
  config.value && Array.isArray(config.value.group_whitelist) ? config.value.group_whitelist : []
)
const senderWhitelist = computed(() =>
  config.value && Array.isArray(config.value.sender_whitelist)
    ? config.value.sender_whitelist
    : []
)

/** 静默超过 2 小时视为可能掉线（对齐设计文档 R9） */
function isSilent(row) {
  const h = Number(row && row.silent_hours)
  return Number.isFinite(h) && h > 2
}

function formatHours(h) {
  const n = Number(h)
  if (!Number.isFinite(n)) return '—'
  return `${n.toFixed(1)} 小时`
}

function formatNumber(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return '—'
  return v.toLocaleString('zh-CN')
}

async function load() {
  now.value = Date.now()
  // 通知列表一起拉：盲区数据由它的 blindspots 字段提供（接口契约不变）
  await Promise.all([store.load(), store.loadConfig(), notificationsStore.load()])
}

async function previewDigest() {
  await store.previewDigest()
}

async function copyDigest() {
  const text = store.digestText || ''
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text)
      ElMessage.success('已复制到剪贴板')
    } else {
      ElMessage.warning('当前浏览器不支持自动复制，请手动选中文本')
    }
  } catch (e) {
    ElMessage.warning('复制失败，请手动选中文本')
  }
}

async function sendToQQ() {
  try {
    await ElMessageBox.confirm(
      '将把 digest 真实推送到 QQ（dry_run=false）。确认发送？',
      '发送到 QQ',
      { confirmButtonText: '确认发送', cancelButtonText: '取消', type: 'warning' }
    )
  } catch (e) {
    return
  }
  const r = await store.sendDigest(false)
  if (r.ok && r.data && r.data.sent) {
    ElMessage.success('已发送')
  } else if (r.ok && r.data && r.data.sent === false) {
    ElMessage.warning(`后端未发送：${(r.data && r.data.error) || '未知原因'}`)
  } else {
    ElMessage.error(r.message || '发送失败')
  }
}

function searchGroup(row) {
  // 跳到通知台并按群名搜索
  router.push({ path: '/', query: { group: row.group_name || row.group_id } })
}

onMounted(() => {
  load()
  tickTimer = setInterval(() => {
    now.value = Date.now()
  }, 30 * 1000)
})

onBeforeUnmount(() => {
  if (tickTimer) clearInterval(tickTimer)
  tickTimer = null
})
</script>

<style scoped>
.xc-health-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 16px;
}

.xc-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
}

.xc-warn-text {
  color: var(--xc-warning);
  font-weight: 600;
}

/* 盲区卡片：有值时整卡变橙色（el-card 自己的边框要覆盖掉） */
.xc-blindspot__cell--warn {
  border-color: #f3d19e;
  background: #fdf6ec;
}

.xc-blindspot__gaps {
  margin-top: 14px;
  padding: 10px 12px;
  background: #fff;
  border: 1px solid var(--xc-border);
  border-radius: 8px;
}

.xc-digest {
  margin: 0;
  padding: 12px;
  background: var(--xc-bg-soft);
  border-radius: 6px;
  font-family: var(--xc-mono);
  font-size: 12.5px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 50vh;
  overflow: auto;
}
</style>
