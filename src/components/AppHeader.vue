<template>
  <header class="xc-header">
    <div class="xc-header__inner">
      <div class="xc-header__left">
        <router-link to="/" class="xc-header__brand">
          <el-icon class="xc-header__logo"><Bell /></el-icon>
          <span class="xc-header__brand-text">Xcollector · 官方通知</span>
        </router-link>
        <nav class="xc-header__nav">
          <router-link to="/" class="xc-header__link">通知台</router-link>
          <router-link to="/health" class="xc-header__link">系统状态</router-link>
        </nav>
      </div>

      <!-- 极简状态区：状态点 + 盲区角标 + 最后同步时间；点击跳 /health -->
      <div
        class="xc-header__status"
        role="button"
        tabindex="0"
        :title="statusTitle"
        @click="goHealth"
        @keydown.enter="goHealth"
      >
        <span class="xc-header__dot-wrap">
          <span class="xc-status-dot" :class="`xc-status-dot--${connectionState}`" />
          <!-- 盲区角标：系统今天漏了东西也要在主页看得见 -->
          <span v-if="blindspotWarningCount > 0" class="xc-header__badge">
            {{ blindspotWarningCount > 9 ? '9+' : blindspotWarningCount }}
          </span>
        </span>
        <span class="xc-header__sync">
          <template v-if="lastSyncedAt">最后同步 {{ syncText }}</template>
          <template v-else>尚未同步</template>
        </span>
      </div>

      <div class="xc-header__right">
        <el-button size="small" :loading="loading" @click="emit('refresh')">
          <el-icon style="margin-right: 4px"><Refresh /></el-icon>
          刷新
        </el-button>
      </div>
    </div>
  </header>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Bell, Refresh } from '@element-plus/icons-vue'

import { useHealthStore } from '../stores/health'
import { useNotificationsStore } from '../stores/notifications'
import { timeAgoShort } from '../utils/time'

const props = defineProps({
  /** 列表/健康数据的加载状态，用于刷新按钮的 loading */
  loading: { type: Boolean, default: false },
  /** 最后一次成功同步的时间戳（毫秒） */
  lastSyncedAt: { type: Number, default: null }
})

const emit = defineEmits(['refresh'])

const router = useRouter()
const healthStore = useHealthStore()
const notificationsStore = useNotificationsStore()

/** 每秒 tick 一次，让「10 秒前」自己走字 */
const tick = ref(Date.now())
let timer = null

onMounted(() => {
  timer = setInterval(() => {
    tick.value = Date.now()
  }, 1000)
})

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
  timer = null
})

const connectionState = computed(() => healthStore.connectionState)

/**
 * 主页顶栏只用一个状态点 + 一个橙色角标回答「OneBot 活着吗 / 系统今天瞎了吗」。
 * 数字口径来自列表接口返回的 blindspots（契约不变）。
 */
const blindspotWarningCount = computed(() => {
  const b = notificationsStore.blindspots || {}
  const unparsed = Number(b.unparsed_count) || 0
  const conflicts = Number(b.conflict_count) || 0
  const gaps = Array.isArray(b.gap_alerts) ? b.gap_alerts.length : 0
  return unparsed + conflicts + gaps
})

const statusTitle = computed(() => {
  const base = healthStore.connectionText || '未知'
  if (blindspotWarningCount.value > 0) {
    return `${base} · 今日有 ${blindspotWarningCount.value} 项盲区，点击查看系统状态`
  }
  return `${base} · 点击查看系统状态`
})

const syncText = computed(() => {
  // 依赖 tick 触发重算
  void tick.value
  return timeAgoShort(props.lastSyncedAt)
})

function goHealth() {
  router.push('/health')
}
</script>

<style scoped>
.xc-header__inner {
  max-width: 1180px;
  margin: 0 auto;
  padding: 8px 20px;
  min-height: 48px;
  display: flex;
  align-items: center;
  gap: 12px;
}

.xc-header__left {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}

.xc-header__brand {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 15px;
  font-weight: 700;
  color: var(--xc-text);
  text-decoration: none;
  white-space: nowrap;
}

.xc-header__logo {
  color: var(--xc-primary);
}

.xc-header__nav {
  display: flex;
  gap: 2px;
}

.xc-header__link {
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12.5px;
  color: var(--xc-text-regular);
  text-decoration: none;
  white-space: nowrap;
}

.xc-header__link:hover {
  background: var(--xc-bg-soft);
  color: var(--xc-primary);
}

.xc-header__link.router-link-active {
  background: #ecf5ff;
  color: var(--xc-primary);
  font-weight: 600;
}

.xc-header__status {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--xc-bg-soft);
  font-size: 12px;
  color: var(--xc-text-secondary);
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}

.xc-header__status:hover {
  background: #e9edf3;
}

.xc-header__dot-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
}

/* 很小的橙色角标：贴住状态点右上角 */
.xc-header__badge {
  position: absolute;
  top: -6px;
  left: 7px;
  min-width: 13px;
  height: 13px;
  padding: 0 3px;
  border-radius: 7px;
  background: var(--xc-due-urgent);
  color: #fff;
  font-size: 9.5px;
  line-height: 13px;
  text-align: center;
  border: 1px solid #fff;
}

.xc-header__sync {
  white-space: nowrap;
}

.xc-header__right {
  display: flex;
  align-items: center;
  gap: 10px;
}

@media (max-width: 768px) {
  .xc-header__inner {
    padding: 4px 10px;
    /* 顶栏压到 48px */
    height: 48px;
    min-height: 48px;
    gap: 8px;
    flex-wrap: nowrap;
  }

  /* 移动端顶栏只留标题 + 状态点 + 刷新 */
  .xc-header__nav {
    display: none;
  }

  .xc-header__brand-text {
    font-size: 14px;
    max-width: 42vw;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .xc-header__status {
    padding: 4px 8px;
  }

  /* 移动端优先保证状态点 + 角标可见，同步时间的绝对时间省掉 */
  .xc-header__sync {
    font-size: 11px;
  }
}
</style>
