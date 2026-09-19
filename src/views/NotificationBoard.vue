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
          class="xc-toolbar__search"
          placeholder="搜索标题 / 摘要 / 证据原文"
          clearable
          @keyup.enter="applyFilter"
          @clear="applyFilter"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>

        <el-button @click="applyFilter">搜索</el-button>

        <el-button
          :type="selectionMode ? 'primary' : 'default'"
          :title="selectionMode ? '退出多选，恢复正常点击' : '多选：勾几条一起处理'"
          @click="toggleSelectionMode"
        >
          <el-icon><Select /></el-icon>
          <span style="margin-left: 4px">{{ selectionMode ? '退出多选' : '多选' }}</span>
        </el-button>

        <div class="xc-toolbar__spacer" />

        <el-tag v-if="unreadCount > 0" type="primary" size="small" effect="plain">
          未读 {{ unreadCount }}
        </el-tag>
        <span class="xc-muted" style="font-size: 12px">共 {{ totalCount }} 条</span>
        <el-tooltip content="每 60 秒自动增量刷新一次" placement="top">
          <span class="xc-toolbar__auto">
            <el-switch v-model="autoRefresh" size="small" />
            <span class="xc-muted" style="font-size: 12px">自动刷新</span>
          </span>
        </el-tooltip>
      </div>

      <!-- 多选操作条：只在多选模式下出现。批量动作全部走这里的按钮，
           页面上不留"点了没反应"的暗示。 -->
      <div v-if="selectionMode" class="xc-selectbar">
        <span class="xc-selectbar__count">
          已选 <b>{{ selectedCount }}</b> / {{ totalCount }} 条
          <span class="xc-muted" style="font-size: 12px">
            （共 {{ totalCount }} 条 = 当前筛选条件下的全部）
          </span>
        </span>
        <el-button size="small" @click="toggleSelectAll">
          {{ allSelected ? '取消全选' : '全选' }}
        </el-button>
        <el-button size="small" :disabled="selectedCount === 0" @click="store.clearSelection()">
          清空
        </el-button>

        <div class="xc-toolbar__spacer" />

        <el-button
          size="small"
          :loading="mutating"
          :disabled="selectedCount === 0"
          @click="batchRead(true)"
        >
          标记已读
        </el-button>
        <el-button
          size="small"
          :loading="mutating"
          :disabled="selectedCount === 0"
          @click="batchRead(false)"
        >
          标记未读
        </el-button>
        <el-button
          size="small"
          :loading="mutating"
          :disabled="selectedCount === 0"
          @click="batchStatus('done')"
        >
          标记完成
        </el-button>
        <el-button
          size="small"
          type="warning"
          plain
          :loading="mutating"
          :disabled="selectedCount === 0"
          @click="batchStatus('archived')"
        >
          归档
        </el-button>
        <!-- 删除是**真删**（后端把那条通知行删掉），所以用 danger 色放最后，
             点下去先弹一个把"删除 vs 归档"讲清楚的确认框 -->
        <el-button
          size="small"
          type="danger"
          plain
          :loading="mutating"
          :disabled="selectedCount === 0"
          @click="batchDelete"
        >
          删除
        </el-button>
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
          <div class="xc-list">
            <template v-for="group in groups" :key="group.key">
              <!-- 分组标题可点击折叠/展开；「已完成」默认收起（见 collapsedGroups），但条目数照常显示 -->
              <div
                class="xc-section-title xc-section-title--toggle"
                role="button"
                tabindex="0"
                :title="`点击${isCollapsed(group.key) ? '展开' : '收起'}「${group.label}」`"
                @click="toggleGroup(group.key)"
                @keyup.enter="toggleGroup(group.key)"
              >
                <el-icon class="xc-section-title__caret">
                  <ArrowDown v-if="!isCollapsed(group.key)" />
                  <ArrowRight v-else />
                </el-icon>
                <span>{{ group.label }}</span>
                <span class="xc-count">{{ group.items.length }} 条</span>
                <span v-if="isCollapsed(group.key)" class="xc-section-title__hint">
                  · 已收起，点击展开
                </span>
              </div>
              <template v-if="!isCollapsed(group.key)">
                <NotificationCard
                  v-for="item in group.items"
                  :key="item.id"
                  :notification="item"
                  :now="now"
                  :selectable="selectionMode"
                  :selected="store.isSelected(item.id)"
                  @open="openDetail"
                  @toggle-select="onToggleSelect"
                />
              </template>
            </template>
          </div>
        </template>
      </div>

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
import { ArrowDown, ArrowRight, Search, Select } from '@element-plus/icons-vue'

import AppHeader from '../components/AppHeader.vue'
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
const totalCount = computed(() => store.notifications.length)
const lastSyncedAt = computed(() => store.lastSyncedAt)
const selectionMode = computed(() => store.selectionMode)
const selectedCount = computed(() => store.selectedCount)
const allSelected = computed(() => store.allSelected)
const mutating = computed(() => store.mutating)

const groups = computed(() => groupNotifications(store.notifications, now.value))

/**
 * 分组的折叠状态。
 * 默认只把「已完成」收起来：它往往条数最多，且不是当前要盯的东西，
 * 但条目数仍然显示在标题上，需要回看时点标题展开即可。
 * 其余分组默认展开，保持改造前的观感。
 */
const collapsedGroups = ref({ done: true })

function isCollapsed(key) {
  return !!collapsedGroups.value[key]
}

function toggleGroup(key) {
  collapsedGroups.value[key] = !collapsedGroups.value[key]
}

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
  // 通知列表走后端 /api/notifications；顶栏的状态点与盲区角标走 bot /api/status。
  // 后端探针只在系统状态页跑（probeBackend:false），通知台不需要它。
  await Promise.all([store.load(), healthStore.load({ probeBackend: false })])
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

/* ---------------- 多选与批量操作 ---------------- */

function toggleSelectionMode() {
  store.setSelectionMode(!store.selectionMode)
  if (store.selectionMode) {
    ElMessage.info('多选：点卡片勾选，再用上面的按钮一次处理——点「退出多选」恢复正常')
  }
}

/** 卡片被点：多选模式下就是勾选/取消 */
function onToggleSelect(id) {
  store.toggleSelect(id)
}

function toggleSelectAll() {
  if (store.allSelected) store.clearSelection()
  else store.selectAll()
}

/**
 * 批量标已读/未读。
 *
 * 结果**两个数都报**（成功多少、失败多少）：批量操作最怕"看着像成功、其实几条没改"。
 * 失败的条目会留在选中状态里，方便直接再点一次重试。
 */
async function batchRead(read) {
  const ids = store.selectedIds.slice()
  if (!ids.length) return
  const r = await store.batchSetRead(ids, read)
  const label = read ? '已读' : '未读'
  const extra = r.unchanged ? `（另外 ${r.unchanged} 条本来就是${label}）` : ''
  if (r.ok) {
    ElMessage.success(`已把 ${r.succeeded} 条标为${label}${extra}`)
  } else if (r.succeeded > 0) {
    ElMessage.error(`${r.succeeded} 条已标为${label}，${r.message}（失败的还留着选中，可重试）`)
  } else {
    ElMessage.error(r.message || '批量操作失败')
  }
}

/** 批量改状态：done = 标记完成，archived = 这不是通知 */
async function batchStatus(status) {
  const ids = store.selectedIds.slice()
  if (!ids.length) return
  const label = status === 'done' ? '已完成' : '已归档'
  if (status === 'archived') {
    try {
      await ElMessageBox.confirm(
        `把选中的 ${ids.length} 条标记为「这不是通知」（status=archived）？它们不会再出现在默认筛选里。`,
        '这不是通知',
        { confirmButtonText: '确认归档', cancelButtonText: '取消', type: 'warning' }
      )
    } catch (e) {
      return
    }
  }
  const r = await store.batchSetStatus(ids, status)
  const extra = r.unchanged ? `（另外 ${r.unchanged} 条本来就是）` : ''
  if (r.ok) {
    ElMessage.success(`已把 ${r.succeeded} 条标记为「${label}」${extra}`)
    // 带着状态筛选时，改完的条目已经不属于这个筛选条件了 —— 立刻重拉一次，
    // 免得它们在页面上赖着不走（看起来像"改了没用"）。
    if (statusFilter.value !== 'all') await store.load()
  } else if (r.succeeded > 0) {
    ElMessage.error(`${r.succeeded} 条已标记为「${label}」，${r.message}（失败的还留着选中，可重试）`)
    if (statusFilter.value !== 'all') await store.load()
  } else {
    ElMessage.error(r.message || '批量操作失败')
  }
}

/**
 * 批量**删除**选中的任务（真删）。
 *
 * 确认框里必须把"删除"和"归档"的差别讲清楚 —— 这是两个按钮、两种后果：
 * 归档只改状态（切到「已归档」还看得到、原文与修正史都在）；
 * 删除是后端把那条通知行删掉，页面上就没了。
 */
async function batchDelete() {
  const ids = store.selectedIds.slice()
  if (!ids.length) return
  try {
    await ElMessageBox.confirm(
      `删掉选中的 ${ids.length} 条任务？\n\n` +
        '· 这是**真删**：后端把那条通知行删掉，删完不在页面上显示了；原始聊天记录还在后端。\n' +
        '· 只是想让它从列表里消失、又想留痕 → 用旁边的「归档」。\n' +
        '· 删掉之后，如果以后给这条消息「标为未读」重抽，会重新建一条。',
      '删除任务',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' }
    )
  } catch (e) {
    return
  }
  const r = await store.batchDelete(ids)
  if (r.ok) {
    ElMessage.success(`已删除 ${r.succeeded} 条`)
  } else if (r.succeeded > 0) {
    ElMessage.error(`已删除 ${r.succeeded} 条，${r.message}（失败的还留着选中，可重试）`)
  } else {
    ElMessage.error(r.message || '删除失败')
  }
  // 带筛选时（比如"已归档"视图）删完可能和筛选条件对不上，重拉一次保持一致
  if (statusFilter.value !== 'all') await store.load()
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
    // 顶栏的状态点 / 盲区角标保持在 30 秒保鲜期之外时自动更新，
    // 不重探后端（后端可达性只在系统状态页展示）
    healthStore.refreshStatusForBadge()
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

.xc-toolbar__search {
  max-width: 280px;
}

/* 移动端：列表左右内边距由 .xc-page 给 10px，工具栏纵向排布，输入框占满宽度 */
@media (max-width: 768px) {
  .xc-toolbar {
    gap: 8px;
  }

  .xc-toolbar__search {
    flex: 1 1 100%;
    max-width: none;
    order: 3;
  }

  .xc-toolbar__spacer {
    display: none;
  }
}
</style>
