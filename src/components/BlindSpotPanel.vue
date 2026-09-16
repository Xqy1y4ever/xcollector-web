<template>
  <div class="xc-blindspot" :class="{ 'xc-blindspot--alert': hasAny }">
    <el-collapse v-model="activeNames">
      <el-collapse-item name="blindspot">
        <template #title>
          <div class="xc-blindspot__title">
            <el-icon><WarningFilled v-if="hasAny" /><CircleCheckFilled v-else /></el-icon>
            <span>系统盲区</span>
            <el-tag v-if="hasAny" type="warning" size="small" effect="dark">
              {{ totalIssues }} 项需要关注
            </el-tag>
            <el-tag v-else type="success" size="small" effect="plain">暂无盲区</el-tag>
            <span class="xc-muted" style="font-size: 12px; font-weight: 400">
              —— 用来回答「今天系统漏了什么」，避免把「今天没任务」和「系统瞎了」搞混
            </span>
          </div>
        </template>

        <div class="xc-blindspot__grid">
          <div
            class="xc-blindspot__cell"
            :class="{ 'xc-blindspot__cell--warn': blindspots.unparsed_count > 0 }"
          >
            <div
              class="xc-blindspot__num"
              :class="
                blindspots.unparsed_count > 0
                  ? 'xc-blindspot__num--warn'
                  : 'xc-blindspot__num--zero'
              "
            >
              {{ blindspots.unparsed_count }}
            </div>
            <div class="xc-blindspot__desc">
              <b>未解析 {{ blindspots.unparsed_count }} 条</b> ——
              这些消息已入库但没能抽出内容，可能是图片、格式异常，或模型判定为闲聊。
            </div>
          </div>

          <div
            class="xc-blindspot__cell"
            :class="{ 'xc-blindspot__cell--warn': blindspots.conflict_count > 0 }"
          >
            <div
              class="xc-blindspot__num"
              :class="
                blindspots.conflict_count > 0
                  ? 'xc-blindspot__num--warn'
                  : 'xc-blindspot__num--zero'
              "
            >
              {{ blindspots.conflict_count }}
            </div>
            <div class="xc-blindspot__desc">
              <b>DDL 冲突 {{ blindspots.conflict_count }} 条</b> ——
              两个模型给出的截止时间不一致，需要人工在详情页对照原文选一个。
            </div>
          </div>

          <div
            class="xc-blindspot__cell"
            :class="{ 'xc-blindspot__cell--warn': blindspots.low_confidence_count > 0 }"
          >
            <div
              class="xc-blindspot__num"
              :class="
                blindspots.low_confidence_count > 0
                  ? 'xc-blindspot__num--warn'
                  : 'xc-blindspot__num--zero'
              "
            >
              {{ blindspots.low_confidence_count }}
            </div>
            <div class="xc-blindspot__desc">
              <b>低置信度 {{ blindspots.low_confidence_count }} 条</b> ——
              时间是从模糊表述里推出来的（如「尽快」），卡片上标了「待确认」，别直接当准确时间用。
            </div>
          </div>

          <div
            class="xc-blindspot__cell"
            :class="{ 'xc-blindspot__cell--warn': gapCount > 0 }"
          >
            <div
              class="xc-blindspot__num"
              :class="gapCount > 0 ? 'xc-blindspot__num--warn' : 'xc-blindspot__num--zero'"
            >
              {{ gapCount }}
            </div>
            <div class="xc-blindspot__desc">
              <b>消息缺口 {{ gapCount }} 段</b> ——
              某段时间完全没有消息，通常意味着连接器掉线，而不是群里真的没人说话。
            </div>
          </div>

          <div
            class="xc-blindspot__cell"
            :class="{ 'xc-blindspot__cell--warn': blindspots.degraded_today }"
          >
            <div
              class="xc-blindspot__num"
              :class="
                blindspots.degraded_today
                  ? 'xc-blindspot__num--warn'
                  : 'xc-blindspot__num--zero'
              "
            >
              {{ blindspots.degraded_today ? '是' : '否' }}
            </div>
            <div class="xc-blindspot__desc">
              <b>今日是否降级</b> ——
              {{
                blindspots.degraded_today
                  ? '已触发降级：只跑了规则命中的消息，今天的召回可能不完整。'
                  : '未降级，今天全量消息都走了正常流水线。'
              }}
            </div>
          </div>
        </div>

        <template v-if="gapAlerts.length">
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
            <span class="xc-muted">（{{ formatDuration(toMillis(gap.to_ts) - toMillis(gap.from_ts)) }} 无消息）</span>
          </div>
        </template>
      </el-collapse-item>
    </el-collapse>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { CircleCheckFilled, WarningFilled } from '@element-plus/icons-vue'

import { formatDateTime, formatDuration, toMillis } from '../utils/time'

const props = defineProps({
  blindspots: {
    type: Object,
    default: () => ({
      unparsed_count: 0,
      conflict_count: 0,
      low_confidence_count: 0,
      gap_alerts: [],
      degraded_today: false
    })
  },
  /** 默认是否展开；有盲区时默认展开更合适 */
  defaultOpen: { type: Boolean, default: false }
})

const gapAlerts = computed(() =>
  Array.isArray(props.blindspots.gap_alerts) ? props.blindspots.gap_alerts : []
)

const gapCount = computed(() => gapAlerts.value.length)

const totalIssues = computed(() => {
  const b = props.blindspots || {}
  return (
    (b.unparsed_count || 0) +
    (b.conflict_count || 0) +
    (b.low_confidence_count || 0) +
    gapCount.value +
    (b.degraded_today ? 1 : 0)
  )
})

const hasAny = computed(() => totalIssues.value > 0)

const activeNames = ref(props.defaultOpen || hasAny.value ? ['blindspot'] : [])
</script>

<style scoped>
.xc-blindspot__title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 14px;
  flex-wrap: wrap;
}

.xc-blindspot--alert {
  border-left: 3px solid var(--xc-warning);
  padding-left: 10px;
}
</style>
