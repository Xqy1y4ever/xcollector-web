<template>
  <div>
    <AppHeader :loading="loading" :last-synced-at="lastSyncedAt" @refresh="manualRefresh" />

    <div class="xc-page">
      <!-- 后端异常提示（有缓存时也提示，避免误以为数据是最新的） -->
      <el-alert
        v-if="store.error"
        type="error"
        :closable="false"
        show-icon
        :title="store.error"
        style="margin-top: 16px"
      >
        <template #default>
          <div style="margin-top: 4px; font-size: 12.5px">
            在 <span class="xc-mono">xcollector-web</span> 目录下先启动后端：
            <span class="xc-mono">uvicorn app.main:app --port 8000</span>（或你们仓库里的启动命令），
            然后点右上角「刷新」。开发服务器通过 vite 代理把 <span class="xc-mono">/api</span> 转到
            <span class="xc-mono">127.0.0.1:8000</span>。
          </div>
        </template>
      </el-alert>

      <!-- 工具栏 -->
      <div class="xc-toolbar">
        <el-radio-group v-model="statusFilter" size="default" @change="applyFilter">
          <el-radio-button value="all">全部</el-radio-button>
          <el-radio-button value="active">进行中</el-radio-button>
          <el-radio-button value="expired">已过期</el-radio-button>
          <el-radio-button value="archived">已归档</el-radio-button>
        </el-radio-group>

        <el-input
          v-model="searchText"
          placeholder="搜索标题 / 摘要 / 证据原文"
          clearable
          style="max-width: 280px"
          @keyup.enter="applyFilter"
          @clear="applyFilter"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>

        <el-button @click="applyFilter">搜索</el-button>

        <div class="xc-toolbar__spacer" />

        <el-tag v-if="unreadCount > 0" type="primary" size="small" effect="plain">
          未读 {{ unreadCount }}
        </el-tag>
        <el-tag v-if="conflictCount > 0" type="danger" size="small" effect="dark">
          DDL 冲突 {{ conflictCount }}
        </el-tag>
        <span class="xc-muted" style="font-size: 12px">共 {{ totalCount }} 条</span>
        <el-tooltip content="每 60 秒自动增量刷新一次" placement="top">
          <span class="xc-toolbar__auto">
            <el-switch v-model="autoRefresh" size="small" />
            <span class="xc-muted" style="font-size: 12px">自动刷新</span>
          </span>
        </el-tooltip>
      </div>

      <!-- 主体 -->
      <div v-loading="loading && notifications.length > 0">
        <!-- 首次加载中 -->
        <el-skeleton v-if="loading && notifications.length === 0" :rows="6" animated style="margin-top: 20px" />

        <!-- 空态：区分「后端没连上」和「真的没数据」 -->
        <el-empty
          v-else-if="notifications.length === 0"
          :description="emptyDescription"
          style="margin-top: 40px"
        >
          <el-button type="primary" @click="manualRefresh">重试</el-button>
        </el-empty>

        <template v-else>
          <template v-for="group in groups" :key="group.key">
            <div class="xc-section-title">
              <span>{{ group.label }}</span>
              <span class="xc-count">{{ group.items.length }} 条</span>
              <el-tag v-if="group.key === 'overdue'" type="warning" size="small" effect="plain">
                需要确认是否还能补交
              </el-tag>
            </div>
            <NotificationCard
              v-for="item in group.items"
              :key="item.id"
              :notification="item"
              :now="now"
              @open="openDetail"
              @toggle-read="onToggleRead"
              @archive="onArchive"
            />
          </template>
        </template>
      </div>

      <!-- 盲区面板 -->
      <BlindSpotPanel :blindspots="store.blindspots" />

      <div class="xc-muted" style="margin-top: 18px; font-size: 12px; text-align: center">
        本页所有解析结果都可点开核对原文证据 · 任何 DDL 都附「结构化时间 + 原文时间表达 + 置信度」三元组
      </div>
    </div>

    <!-- 详情抽屉 -->
    <NotificationDetail
      v-model:visible="detailVisible"
      :notification-id="store.activeId || ''"
    />
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search } from '@element-plus/icons-vue'

import AppHeader from '../components/AppHeader.vue'
import BlindSpotPanel from '../components/BlindSpotPanel.vue'
import NotificationCard from '../components/NotificationCard.vue'
import NotificationDetail from '../components/NotificationDetail.vue'
import { useHealthStore } from '../stores/health'
import { useNotificationsStore } from '../stores/notifications'
import { groupNotifications } from '../utils/time'

const store = useNotificationsStore()
const healthStore = useHealthStore()
const route = useRoute()

const statusFilter = ref(store.filter.status || 'all')
const searchText = ref(store.filter.q || '')
const autoRefresh = ref(true)
const detailVisible = ref(false)
/** 当前时间锚点，定期刷新，保证「还剩 / 已过期」一直准 */
const now = ref(Date.now())

let pollTimer = null
let tickTimer = null

const loading = computed(() => store.loading)
const notifications = computed(() => store.notifications)
const unreadCount = computed(() => store.unreadCount)
const conflictCount = computed(() => store.conflictCount)
const totalCount = computed(() => store.notifications.length)
const lastSyncedAt = computed(() => store.lastSyncedAt)

const groups = computed(() => groupNotifications(store.notifications, now.value))

const emptyDescription = computed(() => {
  if (store.offline || store.error) {
    return '后端未连接，请确认 FastAPI 已在 127.0.0.1:8000 运行'
  }
  if (statusFilter.value !== 'all' || searchText.value) {
    return '当前筛选条件下没有通知，试试切回「全部」或清空搜索词'
  }
  return '还没有任何通知。等 OneBot 接入新消息后，这里会出现带 DDL 的任务条目'
})

async function refreshAll() {
  await Promise.all([store.load(), healthStore.load()])
  now.value = Date.now()
}

async function manualRefresh() {
  await refreshAll()
  if (store.error) {
    ElMessage.error(store.error)
  } else {
    ElMessage.success(`已同步，共 ${store.notifications.length} 条通知`)
  }
}

function applyFilter() {
  store.setFilterStatus(statusFilter.value)
  store.setFilterQuery(searchText.value)
  store.load()
}

async function openDetail(id) {
  detailVisible.value = true
  await store.openDetail(id)
  // 打开即视为已读，符合「看一眼就算读」的习惯
  const target = store.getById(id)
  if (target && !target.read) {
    await store.toggleRead(id)
  }
}

async function onToggleRead(id) {
  const r = await store.toggleRead(id)
  if (!r.ok) ElMessage.error(r.message)
}

async function onArchive(id) {
  try {
    await ElMessageBox.confirm(
      '将把这条记录标记为「这不是通知」（status=archived），它不会再出现在默认筛选里。确认？',
      '这不是通知',
      { confirmButtonText: '确认归档', cancelButtonText: '取消', type: 'warning' }
    )
  } catch (e) {
    return
  }
  const r = await store.archive(id)
  if (r.ok) ElMessage.success('已归档')
  else ElMessage.error(r.message)
}

onMounted(() => {
  // 支持从系统状态页带着 ?group=xxx 跳进来直接看某个群
  const groupFromQuery = route.query && route.query.group ? String(route.query.group) : ''
  if (groupFromQuery) {
    searchText.value = groupFromQuery
    store.setFilterQuery(groupFromQuery)
  }
  refreshAll()
  tickTimer = setInterval(() => {
    now.value = Date.now()
  }, 30 * 1000)
  pollTimer = setInterval(() => {
    if (!autoRefresh.value) return
    // 增量刷新：只取 updated_at > 上次 server_time 的条目
    store.load({ incremental: true, silent: true })
    healthStore.load()
    now.value = Date.now()
  }, 60 * 1000)
})

onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer)
  if (tickTimer) clearInterval(tickTimer)
  pollTimer = null
  tickTimer = null
})
</script>

<style scoped>
.xc-toolbar__spacer {
  flex: 1 1 auto;
}

.xc-toolbar__auto {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
</style>
