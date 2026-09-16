<template>
  <header class="xc-header">
    <div class="xc-header__inner">
      <div class="xc-header__left">
        <router-link to="/" class="xc-header__brand">
          <el-icon class="xc-header__logo"><Bell /></el-icon>
          <span>Xcollector · 官方通知</span>
        </router-link>
        <nav class="xc-header__nav">
          <router-link to="/" class="xc-header__link">通知台</router-link>
          <router-link to="/health" class="xc-header__link">系统状态</router-link>
        </nav>
      </div>

      <!-- OneBot 连接状态：点击跳到 /health -->
      <div
        class="xc-header__center"
        role="button"
        tabindex="0"
        title="查看系统状态"
        @click="goHealth"
        @keydown.enter="goHealth"
      >
        <span class="xc-status-dot" :class="`xc-status-dot--${connectionState}`" />
        <span class="xc-header__status-text">{{ connectionText }}</span>
        <span v-if="!healthStore.error && onebotTarget" class="xc-muted xc-mono">
          {{ onebotTarget }}
        </span>
      </div>

      <div class="xc-header__right">
        <el-button size="small" :loading="loading" @click="emit('refresh')">
          <el-icon style="margin-right: 4px"><Refresh /></el-icon>
          刷新
        </el-button>
        <span class="xc-muted xc-header__sync">
          <template v-if="lastSyncedAt">最后同步 {{ syncText }}</template>
          <template v-else>尚未同步</template>
        </span>
      </div>
    </div>
  </header>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Bell, Refresh } from '@element-plus/icons-vue'

import { useHealthStore } from '../stores/health'
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
const connectionText = computed(() => healthStore.connectionText)
const onebotTarget = computed(() => {
  const ob = healthStore.health && healthStore.health.onebot
  return (ob && ob.target) || ''
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
  padding: 10px 20px;
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.xc-header__left {
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
}

.xc-header__brand {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 17px;
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
  gap: 4px;
}

.xc-header__link {
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 13px;
  color: var(--xc-text-regular);
  text-decoration: none;
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

.xc-header__center {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 auto;
  padding: 5px 12px;
  border-radius: 999px;
  background: var(--xc-bg-soft);
  font-size: 13px;
  color: var(--xc-text-regular);
  cursor: pointer;
  user-select: none;
}

.xc-header__center:hover {
  background: #e9edf3;
}

.xc-header__status-text {
  font-weight: 600;
}

.xc-header__right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.xc-header__sync {
  font-size: 12px;
  white-space: nowrap;
  min-width: 96px;
  text-align: right;
}
</style>
