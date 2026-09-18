<template>
  <div>
    <AppHeader :loading="loading" :last-synced-at="lastLoadedAt" @refresh="load(true)" />

    <div class="xc-page">
      <!--
        ① 运营者访问区（永远在最上面）
        这一页是运营者视角：bot 的状态接口只认管理令牌，普通用户手里只有自己的
        UserToken，所以「没填令牌 → 看不到」是设计如此。这里必须把「为什么」说清楚，
        而不是让他看到一片红色的「bot 不可达」—— 那会让人以为系统坏了。
      -->
      <el-card shadow="never" class="xc-operator-card">
        <template #header>
          <div class="xc-card-header">
            <span>运营者访问</span>
            <el-tag v-if="operatorConfigured" type="success" size="small" effect="plain">
              已填写运营者令牌 {{ store.operatorHint }}
            </el-tag>
            <el-tag v-else type="info" size="small" effect="plain">未填写</el-tag>
          </div>
        </template>

        <el-alert
          :type="store.notice.type"
          :closable="false"
          show-icon
          :title="store.notice.title"
          style="margin-bottom: 12px"
        >
          <div style="font-size: 12.5px; line-height: 1.8">
            {{ store.notice.detail }}
          </div>
          <div v-if="!operatorConfigured" style="margin-top: 6px; font-size: 12.5px">
            也可以在本机用命令行直接看：
            <div class="xc-mono xc-operator-cmd">
              curl -H "Authorization: Bearer $API_TOKEN" http://127.0.0.1:8082/api/status
            </div>
            <div class="xc-muted" style="margin-top: 4px">
              （bot 的接口在 <span class="xc-mono">/api/status</span> 上，
              本机部署时就是 8082 端口；这一页只是把它渲染出来。）
            </div>
          </div>
        </el-alert>

        <div class="xc-operator-form">
          <el-input
            v-model="operatorInput"
            type="password"
            show-password
            clearable
            placeholder="管理令牌：API_TOKEN / BOT_API_TOKEN"
            :disabled="store.loading"
            @keyup.enter="applyOperator"
          />
          <el-button type="primary" :disabled="store.loading" @click="applyOperator">
            用这个令牌查看
          </el-button>
          <el-button v-if="operatorConfigured" @click="clearOperator">清除</el-button>
        </div>

        <div class="xc-muted" style="font-size: 11.5px; line-height: 1.7; margin-top: 8px">
          「记住」是<strong>只存本次标签页</strong>（sessionStorage）：关掉标签页就没了，
          <strong>不会写进 localStorage，也不会进构建产物</strong>。
          它和你自己的登录令牌是两套东西 —— 这里的失败不会把你踢下线。
          这一页有所有人的盲区计数，别在公共电脑上填。
        </div>
      </el-card>

      <!-- ② 后端不可达：最要紧的运维信号，置顶报警（走的是用户自己的令牌，不需要运营者身份） -->
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

      <!--
        ③ 没有运营者令牌时，下面的卡片全是默认值：明说「这些不是真实状态」，
        而不是让一堆 0 和灰点看起来像真的。
      -->
      <el-alert
        v-if="!operatorConfigured"
        type="info"
        :closable="false"
        show-icon
        title="下面的卡片是默认值，不代表真实状态"
        description="填上运营者令牌之后才会真的去读 bot 的 /api/status。"
        style="margin-top: 12px"
      />

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
          <!-- 白名单是 fail-closed 的：两个都空 = bot 一条消息都不会处理。
               这种情况表现出来只是"连上了但什么都不干"，跟连不上 NapCat 长得一样，
               所以必须在最显眼的位置说清楚，否则会往错的方向查。 -->
          <el-alert
            v-if="whitelistReady === false"
            type="warning"
            :closable="false"
            show-icon
            title="白名单没配好，bot 会忽略所有消息"
            style="margin-bottom: 12px"
          >
            空白名单是「一个都不收」，不是「全都收」。请在 bot 的
            <span class="xc-mono">.env</span> 里设置
            <span class="xc-mono">GROUP_WHITELIST</span>（要处理的群）和
            <span class="xc-mono">SENDER_WHITELIST</span>（发布通知的人）。
            只想先跑通，可以临时把 <span class="xc-mono">SENDER_WHITELIST_MODE</span>
            设成 <span class="xc-mono">off</span>。
          </el-alert>
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

      <!-- 每日 digest：预览打 bot（digest 是**按人**组装的，见下面的说明） -->
      <div class="xc-section-title">
        <span>每日 digest</span>
        <span class="xc-count">{{ digestInfo.statusText }}</span>
      </div>
      <el-card shadow="never">
        <div style="display: flex; gap: 10px; flex-wrap: wrap; align-items: center">
          <el-tooltip
            :disabled="operatorConfigured"
            content="预览走 bot 的 /api/digest/preview，只认运营者令牌 —— 请先在上面填写"
            placement="top"
          >
            <span>
              <el-button
                :loading="store.digestLoading"
                :disabled="!operatorConfigured"
                @click="previewDigest"
              >
                <el-icon style="margin-right: 4px"><View /></el-icon>
                预览 digest
              </el-button>
            </span>
          </el-tooltip>

          <!-- 指定预览谁的：digest 是按人组装的，不指定就是「第一个收件人」 -->
          <el-select
            v-model="digestUserId"
            :disabled="!operatorConfigured"
            clearable
            filterable
            placeholder="收件人：默认第一个"
            style="width: 240px"
            @change="previewDigest"
          >
            <el-option
              v-for="row in recipients"
              :key="row.key"
              :label="row.label"
              :value="row.user_id"
            />
          </el-select>

          <span class="xc-muted" style="font-size: 12px">
            预览走 bot 的 <span class="xc-mono">/api/digest/preview</span>。
            手动「发送到 QQ」不在网页上提供 —— 那个操作会真的发消息，请用 bot 自己的入口。
          </span>
        </div>

        <!-- 预览的是谁，必须写出来：不然会以为预览的是自己那一份 -->
        <div v-if="store.digestUserId || store.digestUserQq" class="xc-digest-target">
          正在预览收件人
          <strong>{{ store.digestUserQq ? `QQ ${store.digestUserQq}` : '（bot 没给 QQ）' }}</strong>
          <span class="xc-muted"> user_id <span class="xc-mono">{{ store.digestUserId || '—' }}</span></span>
          —— <strong>这不是你自己那一份</strong>，只是运营者视角下的抽样。
        </div>
      </el-card>

      <!-- 按用户的下钻：多用户之后「盲区有几个」不再是一个数 -->
      <template v-if="perUser.length">
        <div class="xc-section-title">
          <span>按用户明细</span>
          <span class="xc-count">{{ perUser.length }} 人</span>
          <span class="xc-count">「盲区/冲突」按用户各算一份，上面的标量是累加值</span>
        </div>
        <el-table :data="perUser" size="small" border stripe style="width: 100%">
          <el-table-column label="用户" min-width="180">
            <template #default="{ row }">
              <div>{{ row.display_name || '（没填显示名）' }}</div>
              <div class="xc-muted xc-mono">{{ row.qq || row.user_id }}</div>
            </template>
          </el-table-column>
          <el-table-column label="DDL 冲突" width="100" align="center">
            <template #default="{ row }">
              <span :class="{ 'xc-warn-text': row.conflict_count > 0 }">{{ row.conflict_count }}</span>
            </template>
          </el-table-column>
          <el-table-column label="低置信度" width="100" align="center">
            <template #default="{ row }">
              <span :class="{ 'xc-warn-text': row.low_confidence_count > 0 }">
                {{ row.low_confidence_count }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="未确认缺口" width="110" align="center">
            <template #default="{ row }">
              <span :class="{ 'xc-warn-text': row.open_gap_alerts > 0 }">
                {{ row.open_gap_alerts }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="今日已发摘要" width="120" align="center">
            <template #default="{ row }">
              <el-tag :type="row.digest_sent_today ? 'success' : 'info'" size="small" effect="plain">
                {{ row.digest_sent_today ? '已发送' : '未发送' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="今日处理" width="150" align="center">
            <template #default="{ row }">
              <span v-if="row.stat_available" class="xc-muted" style="font-size: 12px">
                入库 {{ row.ingested }} · 抽出 {{ row.extracted }}
              </span>
              <span v-else class="xc-muted" style="font-size: 12px">无统计</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="90" align="center">
            <template #default="{ row }">
              <el-button type="primary" link @click="previewFor(row)">预览摘要</el-button>
            </template>
          </el-table-column>
        </el-table>
      </template>

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
import { ElMessage } from 'element-plus'
import { View } from '@element-plus/icons-vue'

import AppHeader from '../components/AppHeader.vue'
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
/**
 * 系统状态页（**运营者视图**）。
 *
 * 数据来源（契约第 9 节）：
 *   全部卡片 → bot `/api/status`（经 vite `/bot` 代理），**需要运营者令牌**
 *   后端可达性 → 本页自己探一次后端 `/api/health`（走用户自己的 UserToken，不需要运营者身份）
 * 盲区不再来自后端 `/api/notifications` 的 blindspots 字段（该字段已删除），
 * 改从 bot status.blindspots + status.gap_alerts 取。
 * 白名单不再来自后端 `/api/config/meta`（接口已下线），改从 bot status.whitelist 取。
 *
 * 为什么要有运营者令牌输入框：bot 的 `/api/*` 只认管理令牌，而普通用户手里只有
 * 自己的 UserToken（bot 根本不认识它）。这是刻意的 —— 这一页里有**所有人**的
 * 盲区计数、白名单、OneBot 连接状态。所以「没填令牌 → 看不到」是设计如此，
 * 页面必须把这句话说出来，而不是显示「bot 不可达」。
 */
const store = useHealthStore()
const router = useRouter()

/** 运营者令牌输入框的内容（只活在内存里，提交后由 store 写进 sessionStorage） */
const operatorInput = ref('')
const operatorConfigured = computed(() => store.operatorConfigured)

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

/** 当前选中的预览收件人（空串 = 交给 bot 用第一个） */
const digestUserId = ref('')

/** 按用户的下钻明细（bot status.per_user；旧版 bot 没这个字段时为空数组） */
const perUser = computed(() => (Array.isArray(store.status.per_user) ? store.status.per_user : []))

/**
 * 收件人下拉的可选项：优先用 bot 给的 `per_user`（有显示名和 QQ），
 * 拿不到就退到 digest 相关的 recipients 快照。
 */
const recipients = computed(() =>
  perUser.value
    .filter((row) => row && row.user_id)
    .map((row) => ({
      user_id: String(row.user_id),
      key: String(row.user_id),
      label: `${row.display_name || '（没填显示名）'} · ${row.qq || row.user_id}`
    }))
)

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

/**
 * 白名单是否配到了"能收到东西"。
 * `undefined` = 后端没给这个字段（旧版 bot），此时**不提示** ——
 * 宁可不显示，也不要因为字段缺失就误报一条警告。
 */
const whitelistReady = computed(() => {
  const v = whitelist.value && whitelist.value.ready
  return typeof v === 'boolean' ? v : undefined
})

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

/**
 * 填运营者令牌 → 立刻去读一次。
 * 空输入直接忽略（不然「点了一下按钮」会把已有令牌清掉，很反直觉）。
 */
async function applyOperator() {
  const value = operatorInput.value.trim()
  if (!value) {
    ElMessage.warning('请先粘贴管理令牌（API_TOKEN / BOT_API_TOKEN）')
    return
  }
  store.setOperatorToken(value)
  // 清掉输入框：令牌已经进 sessionStorage 了，没必要一直显示在屏幕上
  operatorInput.value = ''
  ElMessage.success('已记录本次标签页的运营者令牌，正在读取状态…')
  await store.load({ force: true })
  if (store.operatorRejected) ElMessage.error('运营者令牌无效，请重新填写')
  else if (store.error) ElMessage.error(store.error)
  else ElMessage.success('状态已刷新')
}

function clearOperator() {
  store.setOperatorToken('')
  operatorInput.value = ''
  ElMessage.success('已清除运营者令牌（只影响本次标签页）')
}

/** 预览指定收件人的 digest（点表格里的「预览摘要」走这条） */
async function previewFor(row) {
  const uid = row && row.user_id ? String(row.user_id) : ''
  digestUserId.value = uid
  await store.previewDigest({ userId: uid })
}

async function previewDigest() {
  await store.previewDigest({ userId: digestUserId.value })
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

function searchGroup(row) {
  // 跳到通知台并按群名搜索
  router.push({ path: '/', query: { group: row.group_name || row.group_id } })
}

onMounted(() => {
  // 先恢复本次标签页里可能已经填过的运营者令牌，再决定要不要去打 bot
  store.restoreOperator()
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

/* 运营者访问区：永远在最上面，也是没填令牌时唯一可操作的区域 */
.xc-operator-card {
  margin-top: 16px;
  /* 浅黄底：一眼就能认出「这一块和别的地方不是一回事（要额外的凭据）」 */
  border-color: #f3d9b5;
  background: #fffdf7;
}

.xc-operator-form {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

.xc-operator-form .el-input {
  flex: 1 1 260px;
  min-width: 200px;
}

/* 命令行示例：等宽 + 可横向滚动，别把长 URL 折成两行看不懂 */
.xc-operator-cmd {
  margin-top: 4px;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--xc-bg-soft);
  border: 1px solid var(--xc-border);
  font-size: 12px;
  line-height: 1.6;
  overflow-x: auto;
  white-space: nowrap;
}

/* 「正在预览的是谁」——必须看得见，否则会把别人的 digest 当成自己的 */
.xc-digest-target {
  margin-top: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid #f3d9b5;
  background: #fffdf7;
  font-size: 12.5px;
  line-height: 1.8;
  color: var(--xc-text-regular);
}

@media (max-width: 768px) {
  .xc-operator-form .el-input {
    flex: 1 1 100%;
  }
}
</style>
