<template>
  <div>
    <AppHeader :loading="loading" :last-synced-at="lastLoadedAt" @refresh="load(true)" />

    <div class="xc-page">
      <!-- ① bot 不可达：整个页面的数据都来自 bot，先把这件事说清楚，不要白屏 -->
      <el-alert
        v-if="store.error"
        type="error"
        :closable="false"
        show-icon
        :title="store.error"
        description="本页的 OneBot / LLM / 流水线 / 盲区 / 缺口 / digest 全部来自 bot 的 /api/status。请确认 bot 进程已在 127.0.0.1:8082 运行（vite 代理 /bot → 该地址）。下面的卡片是默认值，不代表真实状态。"
        style="margin-top: 16px"
      />

      <!-- ② 后端不可达：bot 活着但存不进去，这是最要紧的运维信号，置顶报警 -->
      <el-alert
        v-if="backendCard.level === 'warning'"
        type="warning"
        :closable="false"
        show-icon
        :title="`后端可达性：${backendCard.title}（${backendCard.detail}）`"
        style="margin-top: 16px"
      >
        <div style="margin-top: 4px; font-size: 12.5px">
          具体探针结果：<span class="xc-mono">{{ backendCard.probe }}</span>
          <template v-if="backendCard.baseUrl">
            · bot 配置的后端地址 <span class="xc-mono">{{ backendCard.baseUrl }}</span>
          </template>
        </div>
      </el-alert>

      <!-- 主卡片 -->
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
            <el-descriptions-item v-if="onebot.last_error" label="最近错误">
              <span class="xc-warn-text">{{ onebot.last_error }}</span>
            </el-descriptions-item>
          </el-descriptions>
        </el-card>

        <el-card shadow="never">
          <template #header>
            <div class="xc-card-header">
              <span>LLM 配置</span>
              <el-tag
                :type="llm.extractor === 'llm' ? 'success' : 'info'"
                size="small"
                effect="plain"
              >
                {{ llm.extractor === 'llm' ? 'LLM 抽取' : llm.extractor || '未配置' }}
              </el-tag>
            </div>
          </template>
          <el-descriptions :column="1" size="small" border>
            <el-descriptions-item label="抽取器">
              <span class="xc-mono">{{ llm.extractor || '—' }}</span>
            </el-descriptions-item>
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
            <el-descriptions-item label="图片理解（VLM）">
              <el-tag :type="llm.vlm_enabled ? 'success' : 'info'" size="small" effect="plain">
                {{ llm.vlm_enabled ? '已启用' : '未启用' }}
              </el-tag>
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
              <el-tag v-if="pipeline.degradedToday" type="warning" size="small" effect="dark">
                已降级
              </el-tag>
            </div>
          </template>
          <el-descriptions :column="2" size="small" border>
            <el-descriptions-item label="入库消息">
              {{ pipeline.ingested }}
            </el-descriptions-item>
            <el-descriptions-item label="抽出条目">
              {{ pipeline.extracted }}
            </el-descriptions-item>
            <el-descriptions-item label="未解析">
              <span :class="{ 'xc-warn-text': pipeline.unparsed > 0 }">
                {{ pipeline.unparsed }}
              </span>
            </el-descriptions-item>
            <el-descriptions-item label="DDL 冲突">
              <span :class="{ 'xc-warn-text': pipeline.conflicts > 0 }">
                {{ pipeline.conflicts }}
              </span>
            </el-descriptions-item>
            <el-descriptions-item label="降级次数">
              {{ pipeline.degraded }}
            </el-descriptions-item>
            <el-descriptions-item label="LLM tokens">
              {{ formatNumber(pipeline.llmTokens) }}
            </el-descriptions-item>
          </el-descriptions>
          <div class="xc-muted" style="margin-top: 8px; font-size: 12px">
            入库 {{ pipeline.ingested }} 条 → 抽出 {{ pipeline.extracted }} 条，中间差额要么是
            闲聊，要么是未解析（见下方盲区）。
          </div>
        </el-card>

        <!-- 后端可达性：bot 活着但后端挂了 ⇒ 消息存不进去，必须醒目 -->
        <el-card
          shadow="never"
          :class="{ 'xc-blindspot__cell--warn': backendCard.level === 'warning' }"
        >
          <template #header>
            <div class="xc-card-header">
              <span>后端可达性</span>
              <el-tag
                :type="backendTag.type"
                size="small"
                :effect="backendTag.effect"
              >
                {{ backendCard.reachable ? '可达' : backendCard.level === 'unknown' ? '未知' : '不可达' }}
              </el-tag>
            </div>
          </template>
          <el-descriptions :column="1" size="small" border>
            <el-descriptions-item label="状态">
              <span :class="backendCard.level === 'warning' ? 'xc-danger-text' : ''">
                {{ backendCard.title }}
              </span>
            </el-descriptions-item>
            <el-descriptions-item label="本页探针">
              <span class="xc-mono xc-muted">{{ backendCard.probe }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="bot 自报">
              <el-tag
                v-if="backendCard.botReported !== null"
                :type="backendCard.botReported ? 'success' : 'danger'"
                size="small"
                effect="plain"
              >
                {{ backendCard.botReported ? '可达' : '不可达' }}
              </el-tag>
              <span v-else class="xc-muted">未上报</span>
            </el-descriptions-item>
            <el-descriptions-item label="后端地址">
              <span class="xc-mono">{{ backendCard.baseUrl || '—' }}</span>
            </el-descriptions-item>
            <el-descriptions-item v-if="backendCounts" label="存储计数">
              <span class="xc-mono">
                消息 {{ backendCounts.messages ?? '—' }} · 通知
                {{ backendCounts.notifications ?? '—' }} · 附件
                {{ backendCounts.attachments ?? '—' }}
              </span>
            </el-descriptions-item>
          </el-descriptions>
          <div
            v-if="backendCard.level === 'warning'"
            class="xc-danger-text"
            style="margin-top: 8px; font-size: 12px"
          >
            {{ backendCard.detail }}
          </div>
          <div v-else class="xc-muted" style="margin-top: 8px; font-size: 12px">
            {{ backendCard.detail }}
          </div>
        </el-card>

        <!-- digest 配置（原来是 /api/config/meta，现在归 bot） -->
        <el-card shadow="never">
          <template #header>
            <div class="xc-card-header">
              <span>每日 digest</span>
              <el-tag :type="digestInfo.tagType" size="small" effect="plain">
                {{ digestInfo.enabled ? '已启用' : '未启用' }}
              </el-tag>
            </div>
          </template>
          <el-descriptions :column="1" size="small" border>
            <el-descriptions-item label="推送时间">
              {{ digestInfo.time || '—' }}
            </el-descriptions-item>
            <el-descriptions-item label="目标 QQ">
              <span class="xc-mono">{{ digestInfo.targetQq || '—' }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="今天是否已发">
              <el-tag :type="digestInfo.sentToday ? 'success' : 'info'" size="small" effect="plain">
                {{ digestInfo.sentToday ? '已发送' : '尚未发送' }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="统计日期">
              {{ store.day || '—' }}
            </el-descriptions-item>
          </el-descriptions>
        </el-card>

        <!-- 配置快照：白名单现在读 bot status.whitelist，后端的 /api/config/meta 已下线 -->
        <el-card shadow="never">
          <template #header>
            <div class="xc-card-header">
              <span>配置快照</span>
              <el-tag v-if="whitelist.sender_mode" size="small" effect="plain">
                发送者白名单：{{ whitelist.sender_mode }}
              </el-tag>
            </div>
          </template>
          <el-descriptions :column="1" size="small" border>
            <el-descriptions-item label="群白名单">
              <template v-if="whitelist.groups.length">
                <el-tag
                  v-for="(g, idx) in whitelist.groups"
                  :key="groupKey(g, idx)"
                  size="small"
                  effect="plain"
                  style="margin: 2px 4px 2px 0"
                >
                  {{ groupLabel(g) }}
                  <span v-if="g.group_id" class="xc-mono xc-muted">({{ g.group_id }})</span>
                </el-tag>
              </template>
              <span v-else class="xc-muted">未配置</span>
            </el-descriptions-item>
            <el-descriptions-item label="发送者白名单">
              <template v-if="whitelist.senders.length">
                <el-tag
                  v-for="(s, idx) in whitelist.senders"
                  :key="senderKey(s, idx)"
                  size="small"
                  effect="plain"
                  style="margin: 2px 4px 2px 0"
                >
                  {{ s.name || s.sender_id || '未知' }}
                </el-tag>
              </template>
              <span v-else class="xc-muted">未配置</span>
            </el-descriptions-item>
            <el-descriptions-item label="服务器时间">
              {{ formatDateTime(store.status.server_time) }}
            </el-descriptions-item>
          </el-descriptions>
          <div v-if="store.error" class="xc-muted" style="margin-top: 8px; font-size: 12px">
            bot 未运行或不可达，白名单快照取不到。
          </div>
        </el-card>
      </div>

      <!-- 系统盲区：回答「今天系统漏了什么」 -->
      <div class="xc-section-title">
        <span>系统盲区</span>
        <el-tag v-if="blindspotTotal > 0" type="warning" size="small" effect="dark">
          {{ blindspotTotal }} 项需要关注
        </el-tag>
        <el-tag v-else type="success" size="small" effect="plain">暂无盲区</el-tag>
        <span v-if="blindspotWindowDays" class="xc-count">
          统计窗口：最近 {{ blindspotWindowDays }} 天
        </span>
        <span class="xc-count">避免把「今天没任务」和「系统瞎了」搞混</span>
      </div>

      <div class="xc-health-grid">
        <el-card shadow="never" :class="{ 'xc-blindspot__cell--warn': counts.unparsed > 0 }">
          <template #header>
            <div class="xc-card-header">
              <span>未解析</span>
              <span
                class="xc-blindspot__num"
                :class="counts.unparsed > 0 ? 'xc-warn-text' : 'xc-blindspot__num--zero'"
              >
                {{ counts.unparsed }}
              </span>
            </div>
          </template>
          <div class="xc-blindspot__desc">
            这些消息已入库但没能抽出内容，可能是图片、格式异常，或模型判定为闲聊。
          </div>
        </el-card>

        <el-card shadow="never" :class="{ 'xc-blindspot__cell--warn': counts.conflicts > 0 }">
          <template #header>
            <div class="xc-card-header">
              <span>DDL 冲突</span>
              <span
                class="xc-blindspot__num"
                :class="counts.conflicts > 0 ? 'xc-warn-text' : 'xc-blindspot__num--zero'"
              >
                {{ counts.conflicts }}
              </span>
            </div>
          </template>
          <div class="xc-blindspot__desc">
            两个模型给出的截止时间不一致，需要人工在详情页对照原文选一个。
          </div>
        </el-card>

        <el-card shadow="never" :class="{ 'xc-blindspot__cell--warn': counts.lowConfidence > 0 }">
          <template #header>
            <div class="xc-card-header">
              <span>低置信度</span>
              <span
                class="xc-blindspot__num"
                :class="counts.lowConfidence > 0 ? 'xc-warn-text' : 'xc-blindspot__num--zero'"
              >
                {{ counts.lowConfidence }}
              </span>
            </div>
          </template>
          <div class="xc-blindspot__desc">
            时间是从模糊表述里推出来的（如「尽快」），卡片上标了「待确认」，别直接当准确时间用。
          </div>
        </el-card>

        <el-card shadow="never" :class="{ 'xc-blindspot__cell--warn': counts.gaps > 0 }">
          <template #header>
            <div class="xc-card-header">
              <span>消息缺口</span>
              <span
                class="xc-blindspot__num"
                :class="counts.gaps > 0 ? 'xc-warn-text' : 'xc-blindspot__num--zero'"
              >
                {{ counts.gaps }}
              </span>
            </div>
          </template>
          <div class="xc-blindspot__desc">
            某段时间完全没有消息，通常意味着连接器掉线，而不是群里真的没人说话。
          </div>
        </el-card>

        <el-card shadow="never" :class="{ 'xc-blindspot__cell--warn': counts.degraded }">
          <template #header>
            <div class="xc-card-header">
              <span>今日是否降级</span>
              <span
                class="xc-blindspot__num"
                :class="counts.degraded ? 'xc-warn-text' : 'xc-blindspot__num--zero'"
              >
                {{ counts.degraded ? '是' : '否' }}
              </span>
            </div>
          </template>
          <div class="xc-blindspot__desc">
            {{
              counts.degraded
                ? '已触发降级：只跑了规则命中的消息，今天的召回可能不完整。'
                : '未降级，今天全量消息都走了正常流水线。'
            }}
          </div>
        </el-card>
      </div>

      <div v-if="gapAlerts.length" class="xc-blindspot__gaps">
        <div class="xc-field-label">缺口明细</div>
        <div v-for="gap in gapAlerts" :key="gapKey(gap)" class="xc-gap-row">
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

      <!-- 每日 digest：预览与发送都打 bot（后端已不再提供这两个接口） -->
      <div class="xc-section-title">
        <span>每日 digest</span>
        <span class="xc-count">{{ digestInfo.statusText }}</span>
      </div>
      <el-card shadow="never">
        <div style="display: flex; gap: 10px; flex-wrap: wrap; align-items: center">
          <el-button :loading="store.digestLoading" @click="previewDigest">
            <el-icon style="margin-right: 4px"><View /></el-icon>
            预览 digest
          </el-button>
          <!-- 只有显式填了管理令牌才出现：网页令牌发消息会被 bot 403 -->
          <el-button
            v-if="canSendDigest"
            type="primary"
            :loading="store.digestSending"
            @click="sendToQQ"
          >
            <el-icon style="margin-right: 4px"><Promotion /></el-icon>
            发送到 QQ
          </el-button>
          <span class="xc-muted" style="font-size: 12px">
            预览走 bot 的 <span class="xc-mono">/api/digest/preview</span>（网页令牌即可）；
            发送走 <span class="xc-mono">/api/digest/send</span>，**只认管理令牌** ——
            因为它会真的往 QQ 发消息。想手动发就在登录页「高级」里填管理令牌，
            否则等 bot 按 <span class="xc-mono">DIGEST_TIME</span> 自动发。
          </span>
        </div>
      </el-card>

      <!-- 群列表：完全来自 bot status.groups -->
      <div class="xc-section-title">
        <span>订阅的群</span>
        <span class="xc-count">{{ groups.length }} 个</span>
        <span v-if="whitelist.sender_mode" class="xc-count">
          · 发送者白名单模式：{{ whitelist.sender_mode }}
        </span>
      </div>
      <el-table :data="groups" size="small" border stripe style="width: 100%">
        <el-table-column label="群名" min-width="180">
          <template #default="{ row }">
            <span>{{ row.group_name || '—' }}</span>
            <span class="xc-muted xc-mono" style="margin-left: 6px">{{ row.group_id }}</span>
          </template>
        </el-table-column>
        <el-table-column label="在白名单" width="110" align="center">
          <template #default="{ row }">
            <el-tag :type="inWhitelist(row) ? 'success' : 'info'" size="small" effect="plain">
              {{ inWhitelist(row) ? '是' : '否' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="最后消息时间" min-width="180">
          <template #default="{ row }">
            <template v-if="lastMsgTs(row)">
              {{ formatDateTime(lastMsgTs(row)) }}
              <div class="xc-muted" style="font-size: 11px">
                {{ timeAgoShort(lastMsgTs(row), now) }}
              </div>
            </template>
            <span v-else class="xc-muted">从未收到消息</span>
          </template>
        </el-table-column>
        <el-table-column label="静默小时数" width="140" align="center">
          <template #default="{ row }">
            <span :class="{ 'xc-warn-text': isSilentGroup(row) }">
              {{ formatSilentHours(row) }}
              <template v-if="isSilentGroup(row)">
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
          <span class="xc-muted">
            {{ store.error ? 'bot 未运行或不可达，取不到群列表' : 'bot 还没有收到任何群消息' }}
          </span>
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
          :key="gapKey(gap)"
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
            <span class="xc-muted"> · 记录于 {{ formatDateTime(gap.created_at) }}</span>
          </div>
          <div class="xc-muted" style="font-size: 12px; margin-top: 2px">
            这段空档通常是连接器掉线而不是群里没人说话，请检查 OneBot 是否还在运行。
          </div>
        </el-alert>
      </template>
      <el-empty v-else description="没有缺口告警，所有群的消息都是连续的" :image-size="70" />
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
import { useAuthStore } from '../stores/auth'
import { useHealthStore } from '../stores/health'
import { formatDateTime, formatDuration, timeAgoShort, toMillis } from '../utils/time'
import {
  backendReachability,
  digestView,
  formatSilentHours,
  groupKey,
  groupLabel,
  isSilentGroup,
  pipelineView,
  whitelistGroupIds
} from '../utils/healthStatus'

/**
 * 系统状态页。
 *
 * 数据来源（契约第 9 节）：
 *   全部卡片 → bot `/api/status`（经 vite `/bot` 代理）
 *   后端可达性 → 本页自己探一次后端 `/api/health`
 * 盲区不再来自后端 `/api/notifications` 的 blindspots 字段（该字段已删除），
 * 改从 bot status.blindspots + status.gap_alerts 取。
 * 白名单不再来自后端 `/api/config/meta`（接口已下线），改从 bot status.whitelist 取。
 */
const store = useHealthStore()
const authStore = useAuthStore()
const router = useRouter()

/**
 * 能不能「发送到 QQ」。
 *
 * 网页令牌**不允许**发消息（bot 那边会 403）：那个令牌必须交给登录页，而
 * 「任何人拿到它就能以你的身份发 QQ 消息」比"能改数据库"更直接。
 * 只有用户在登录页「高级」里显式填了管理令牌（BOT_API_TOKEN / API_TOKEN）
 * 才显示这个按钮 —— 那时他自己就是管理员，这是有意的。
 * 没填的人连按钮都看不到，不会点了才吃 403。
 */
const canSendDigest = computed(() => !!authStore.botToken)

const now = ref(Date.now())
let tickTimer = null

const loading = computed(() => store.loading)
const lastLoadedAt = computed(() => store.lastLoadedAt)

/* ---------------- bot status 各区块 ---------------- */
const onebot = computed(() => store.status.onebot || {})
const llm = computed(() => store.status.llm || {})
const groups = computed(() => store.status.groups || [])
const gapAlerts = computed(() => store.status.gap_alerts || [])
const whitelist = computed(() => store.status.whitelist || { groups: [], senders: [] })
const digestInfo = computed(() => digestView(store.status.digest))
const pipeline = computed(() => pipelineView(store.status.pipeline))
const counts = computed(() => store.blindspotCounts)
const blindspotTotal = computed(() => counts.value.total)
const blindspotWindowDays = computed(() => Number(store.status.blindspots.window_days) || 0)

/* ---------------- 后端可达性 ---------------- */
const backendCard = computed(() => backendReachability(store.status, store.backendProbe))
const backendCounts = computed(() => store.backendProbe.counts || null)
/** 可达=绿、不可达=红（醒目）、还没探=灰 */
const backendTag = computed(() => {
  if (backendCard.value.level === 'warning') return { type: 'danger', effect: 'dark' }
  if (backendCard.value.level === 'ok') return { type: 'success', effect: 'plain' }
  return { type: 'info', effect: 'plain' }
})

/* ---------------- 群列表辅助 ---------------- */
const whitelistIds = computed(() => new Set(whitelistGroupIds(whitelist.value)))

function inWhitelist(row) {
  // bot 已经算好 in_whitelist；字段缺失时用 status.whitelist 自己兜一次
  if (row && typeof row.in_whitelist === 'boolean') return row.in_whitelist
  if (row && row.group_id !== undefined && row.group_id !== null) {
    return whitelistIds.value.has(String(row.group_id))
  }
  return false
}

/** 契约里 last_msg_ts 与 last_msg_at 是同一个值的两个名字，任取其一 */
function lastMsgTs(row) {
  if (!row) return null
  return row.last_msg_ts || row.last_msg_at || null
}

function gapKey(gap) {
  if (!gap) return 'gap'
  if (gap.id) return String(gap.id)
  return `${gap.group_id || 'unknown'}-${gap.from_ts || 0}`
}

function senderKey(sender, idx) {
  const s = sender || {}
  if (s.sender_id !== undefined && s.sender_id !== null && s.sender_id !== '') {
    return String(s.sender_id)
  }
  return `sender-${idx}`
}

function formatNumber(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return '—'
  return v.toLocaleString('zh-CN')
}

/* ---------------- 动作 ---------------- */

/**
 * @param {boolean} force true = 忽略 30s 保鲜期强制刷新（手动刷新/重试走这条）
 */
async function load(force = false) {
  now.value = Date.now()
  // force=false 时 store 会复用 30 秒内的 status，避免每次进页面都重打 bot
  await store.load({ force })
  // 手动刷新时把错误直接弹出来，避免用户以为刷新成功了
  if (force && store.error) ElMessage.error(store.error)
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
    ElMessage.warning(`bot 未发送：${(r.data && r.data.error) || '未知原因'}`)
  } else {
    ElMessage.error(r.message || '发送失败')
  }
}

function searchGroup(row) {
  // 跳到通知台并按群名搜索
  router.push({ path: '/', query: { group: row.group_name || row.group_id } })
}

onMounted(() => {
  load(false)
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

/* 后端不可达这类「必须立刻看见」的信号 */
.xc-danger-text {
  color: var(--xc-due-overdue);
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
