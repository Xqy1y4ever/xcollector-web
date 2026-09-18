<template>
  <div>
    <AppHeader :loading="store.listLoading || store.mutating" @refresh="refreshAll" />

    <div class="xc-page">
      <!-- 这一页的核心约束必须在最显眼的地方说清楚，否则用户第一反应就是「订这个群」 -->
      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="订阅的最小单位是「某个群里的某个人」"
        style="margin-top: 16px"
      >
        <div style="font-size: 12.5px; line-height: 1.8">
          通知是<strong>人</strong>发的，不是群发的。所以这里只能订
          <strong>「某个人在某个群里说的话」</strong>，<strong>没有「订整个群」这个选项</strong>
          —— 那会把群里所有人的闲聊都拉进来，误报和 token 消耗一起失控。
          想订新的来源，先点「从信息源目录里挑」，看看这套系统目前见过哪些人和群。
        </div>
      </el-alert>

      <el-alert
        v-if="store.listError"
        type="error"
        :closable="false"
        show-icon
        :title="store.listError"
        style="margin-top: 12px"
      />

      <div class="xc-toolbar">
        <el-button type="primary" @click="openAdd">
          <el-icon style="margin-right: 4px"><Plus /></el-icon>
          添加订阅
        </el-button>
        <el-button :loading="store.listLoading" @click="refreshAll">
          <el-icon style="margin-right: 4px"><Refresh /></el-icon>
          刷新
        </el-button>

        <div class="xc-toolbar__spacer" />

        <span class="xc-muted" style="font-size: 12px">
          共 {{ store.count }} 条 · 启用 {{ store.enabledCount }} 条
          <template v-if="store.disabledCount"> · 停用 {{ store.disabledCount }} 条</template>
        </span>
      </div>

      <!-- 列表 -->
      <div v-loading="store.listLoading && store.count > 0">
        <el-skeleton v-if="store.listLoading && store.count === 0" :rows="4" animated />

        <el-empty
          v-else-if="store.count === 0"
          description="还没有任何订阅。没有订阅就收不到通知 —— 先添加一条吧"
        >
          <el-button type="primary" @click="openAdd">添加订阅</el-button>
        </el-empty>

        <el-table v-else :data="store.subscriptions" size="small" border stripe style="width: 100%">
          <el-table-column label="群" min-width="200">
            <template #default="{ row }">
              <div class="xc-sub__name">{{ row.group_name || '（目录里没给群名）' }}</div>
              <div class="xc-muted xc-mono">{{ row.group_id }}</div>
            </template>
          </el-table-column>

          <el-table-column label="发送者" min-width="200">
            <template #default="{ row }">
              <div class="xc-sub__name">{{ row.sender_name || '（目录里没给昵称）' }}</div>
              <div class="xc-muted xc-mono">{{ row.sender_id }}</div>
            </template>
          </el-table-column>

          <el-table-column label="备注" min-width="160">
            <template #default="{ row }">
              <span v-if="row.note">{{ row.note }}</span>
              <span v-else class="xc-muted">—</span>
            </template>
          </el-table-column>

          <el-table-column label="状态" width="90" align="center">
            <template #default="{ row }">
              <el-switch
                :model-value="row.enabled"
                :loading="store.mutating"
                @change="onToggle(row)"
              />
            </template>
          </el-table-column>

          <el-table-column label="创建时间" width="150" align="center">
            <template #default="{ row }">
              <span class="xc-muted" style="font-size: 12px">
                {{ formatDateTime(row.created_at) }}
              </span>
            </template>
          </el-table-column>

          <el-table-column label="操作" width="90" align="center">
            <template #default="{ row }">
              <el-button type="danger" link @click="onRemove(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div class="xc-muted" style="margin-top: 16px; font-size: 12px; line-height: 1.8">
        停用只是不再收这个来源的通知，不会删掉已有的通知条目。
        订了一个 bot 白名单之外的群不会报错，但也收不到东西 ——
        目录里只会出现 bot 真正处理过的来源，原因就在这里。
      </div>
    </div>

    <!-- 添加订阅 -->
    <el-dialog v-model="addVisible" title="添加订阅" width="640px" :close-on-click-modal="false">
      <div class="xc-sub__dialog-hint">
        最小单位是「某个群里某个人说的话」。<strong>群号和发送者 QQ 号都必须填</strong>，
        填 <span class="xc-mono">*</span> 之类的通配符会被后端直接拒绝。
      </div>

      <!-- 从目录里挑：连群名/昵称一起带过来，省得用户手抄群号 -->
      <el-collapse v-model="pickerOpen" class="xc-sub__picker">
        <el-collapse-item name="sources">
          <template #title>
            <span class="xc-sub__picker-title">
              <el-icon style="margin-right: 4px"><Search /></el-icon>
              从信息源目录里挑（{{ store.sources.length }} 条）
            </span>
          </template>

          <div class="xc-sub__picker-search">
            <el-input
              v-model="sourceKeyword"
              placeholder="按群名 / 昵称 / 群号 / QQ 号搜"
              clearable
              @keyup.enter="searchSources"
              @clear="searchSources"
            >
              <template #append>
                <el-button :loading="store.sourcesLoading" @click="searchSources">搜索</el-button>
              </template>
            </el-input>
          </div>

          <el-alert
            v-if="store.sourcesError"
            type="warning"
            :closable="false"
            :title="store.sourcesError"
            style="margin-bottom: 8px"
          />

          <el-table
            v-loading="store.sourcesLoading"
            :data="store.sources"
            size="small"
            max-height="260"
            @row-click="applySource"
          >
            <el-table-column label="群" min-width="160">
              <template #default="{ row }">
                <div>{{ row.group_name || '—' }}</div>
                <div class="xc-muted xc-mono">{{ row.group_id }}</div>
              </template>
            </el-table-column>
            <el-table-column label="发送者" min-width="150">
              <template #default="{ row }">
                <div>{{ row.sender_name || '—' }}</div>
                <div class="xc-muted xc-mono">{{ row.sender_id }}</div>
              </template>
            </el-table-column>
            <el-table-column label="消息数" width="80" align="center">
              <template #default="{ row }">{{ row.msg_count }}</template>
            </el-table-column>
            <el-table-column label="最后一条" width="150" align="center">
              <template #default="{ row }">
                <span class="xc-muted" style="font-size: 12px">
                  {{ timeAgoShort(row.last_ts) }}
                </span>
              </template>
            </el-table-column>
            <el-table-column label="" width="70" align="center">
              <template #default="{ row }">
                <el-button type="primary" link @click.stop="applySource(row)">选用</el-button>
              </template>
            </el-table-column>
          </el-table>

          <div class="xc-muted" style="margin-top: 6px; font-size: 11.5px; line-height: 1.7">
            目录里只有 <strong>bot 实际处理过</strong> 的来源；一个全新的群不会出现在这里，
            那种情况请手动填群号与发送者 QQ 号。
          </div>
        </el-collapse-item>
      </el-collapse>

      <el-form ref="formRef" :model="form" :rules="rules" label-position="top">
        <el-form-item prop="group_id">
          <template #label><span class="xc-sub__label">群号（必填）</span></template>
          <el-input v-model="form.group_id" placeholder="例如 123456789" clearable />
        </el-form-item>

        <el-form-item prop="sender_id">
          <template #label><span class="xc-sub__label">发送者 QQ 号（必填）</span></template>
          <el-input v-model="form.sender_id" placeholder="发出通知的那个人的 QQ 号" clearable />
          <div class="xc-sub__hint">
            只能填一个 QQ 号。<strong>不支持订阅整个群</strong>，也不接受
            <span class="xc-mono">*</span> / <span class="xc-mono">全部</span> 这类写法。
          </div>
        </el-form-item>

        <el-form-item prop="group_name">
          <template #label><span class="xc-sub__label">群名（可选）</span></template>
          <el-input v-model="form.group_name" placeholder="只是给自己看的标签" clearable />
        </el-form-item>

        <el-form-item prop="sender_name">
          <template #label><span class="xc-sub__label">发送者备注（可选）</span></template>
          <el-input v-model="form.sender_name" placeholder="例如 张老师" clearable />
        </el-form-item>

        <el-form-item prop="note">
          <template #label><span class="xc-sub__label">备注（可选）</span></template>
          <el-input
            v-model="form.note"
            placeholder="为什么订这个人，最多 200 字"
            maxlength="200"
            show-word-limit
            clearable
          />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="addVisible = false">取消</el-button>
        <el-button type="primary" :loading="store.mutating" @click="submitAdd">确定添加</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Refresh, Search } from '@element-plus/icons-vue'

import AppHeader from '../components/AppHeader.vue'
import { useSubscriptionsStore } from '../stores/subscriptions'
import { formatDateTime, timeAgoShort } from '../utils/time'

/**
 * 订阅管理页。
 *
 * 只做三件事：列出我的订阅、加一条、改启用状态 / 删掉。
 *
 * 「加一条」这条路上有两个刻意的设计：
 *   1. `group_id` 与 `sender_id` 都是必填，而且**没有任何「整个群」的入口** ——
 *      后端会 400，前端也不该让用户先点一次才知道；
 *   2. 提供「从信息源目录里挑」（`GET /api/sources`）。
 *      新用户注册完手上什么都没有，不知道群号也不知道谁在发通知，
 *      没有这份目录就无从订阅 —— 这是多用户之后才存在的页面。
 */
const store = useSubscriptionsStore()

const addVisible = ref(false)
const pickerOpen = ref([])
const sourceKeyword = ref('')
const formRef = ref(null)

const form = ref({
  group_id: '',
  sender_id: '',
  group_name: '',
  sender_name: '',
  note: ''
})

const rules = {
  group_id: [
    {
      validator: (_rule, value, callback) => {
        const v = typeof value === 'string' ? value.trim() : ''
        if (!v) return callback(new Error('必须填群号'))
        const message = qqLikeError(v, '群号')
        return message ? callback(new Error(message)) : callback()
      },
      trigger: 'blur'
    }
  ],
  sender_id: [
    {
      validator: (_rule, value, callback) => {
        const v = typeof value === 'string' ? value.trim() : ''
        if (!v) return callback(new Error('必须填发送者 QQ 号（不支持订阅整个群）'))
        if (v === '*' || ['all', 'any', '全部', '所有', '全群'].includes(v.toLowerCase())) {
          return callback(new Error('不支持订阅整个群：请填发出通知的那个人的 QQ 号'))
        }
        if (v.includes(',') || v.includes('，')) {
          return callback(new Error('一次只能订一个发送者'))
        }
        const message = qqLikeError(v, '发送者 QQ 号')
        return message ? callback(new Error(message)) : callback()
      },
      trigger: 'blur'
    }
  ]
}

/**
 * 前端先按后端的口径拦一道（`app/users.py` 的 _QQ_RE：5~12 位、不以 0 开头）。
 * 目的不是"安全"，而是**别让用户以为订上了其实一直收不到** ——
 * 订阅写错不会报错，只会安静地什么都不来，那是最难发现的一类故障。
 * 后端仍然是最终裁判。
 */
function qqLikeError(value, label) {
  if (!/^[1-9]\d{4,11}$/.test(value)) {
    return `${label}看起来不对：应该是 5~12 位数字，且不以 0 开头`
  }
  return ''
}

async function refreshAll() {
  const result = await store.load()
  if (!result.ok) ElMessage.error(result.message)
}

function resetForm() {
  form.value = { group_id: '', sender_id: '', group_name: '', sender_name: '', note: '' }
  const formEl = formRef.value
  if (formEl && typeof formEl.clearValidate === 'function') formEl.clearValidate()
}

function openAdd() {
  resetForm()
  addVisible.value = true
  // 打开就顺手拉一次目录（store 里有缓存，只有第一次真的打请求）
  store.loadSources()
  pickerOpen.value = store.sourcesLoaded ? ['sources'] : ['sources']
}

function searchSources() {
  store.loadSources({ keyword: sourceKeyword.value, force: true })
}

/** 从目录里选一条：把群号/QQ 号连同名字一起填进表单 */
function applySource(row) {
  if (!row) return
  form.value.group_id = row.group_id
  form.value.sender_id = row.sender_id
  form.value.group_name = row.group_name || ''
  form.value.sender_name = row.sender_name || ''
  ElMessage.success(`已填入：${row.group_name || row.group_id} · ${row.sender_name || row.sender_id}`)
}

async function submitAdd() {
  const formEl = formRef.value
  if (formEl && typeof formEl.validate === 'function') {
    try {
      await formEl.validate()
    } catch (e) {
      // 校验提示由 el-form-item 自己显示
      return
    }
  }

  const result = await store.add({
    group_id: form.value.group_id.trim(),
    sender_id: form.value.sender_id.trim(),
    group_name: form.value.group_name.trim(),
    sender_name: form.value.sender_name.trim(),
    note: form.value.note.trim()
  })

  if (!result.ok) {
    // 后端 400 的 detail 写得比前端好（例如「不支持订阅整个群…」），原样弹出来
    ElMessage.error(result.message)
    return
  }

  addVisible.value = false
  ElMessage.success(result.created ? '已添加订阅' : '这条订阅已存在，已重新启用')
  // 让目录里可能出现的名字同步过来
  store.load()
}

async function onToggle(row) {
  const result = await store.toggleEnabled(row.id)
  if (!result.ok) {
    ElMessage.error(result.message)
    return
  }
  ElMessage.success(row.enabled ? '已停用' : '已启用')
}

async function onRemove(row) {
  const label = `${row.group_name || row.group_id} · ${row.sender_name || row.sender_id}`
  try {
    await ElMessageBox.confirm(
      `删除订阅「${label}」？删掉之后这个来源的新通知不会再进你的清单（已有的通知不会消失）。`,
      '删除订阅',
      { confirmButtonText: '确认删除', cancelButtonText: '取消', type: 'warning' }
    )
  } catch (e) {
    return
  }
  const result = await store.remove(row.id)
  if (result.ok) ElMessage.success('已删除')
  else ElMessage.error(result.message)
}

onMounted(() => {
  refreshAll()
})
</script>

<style scoped>
.xc-toolbar__spacer {
  flex: 1 1 auto;
}

.xc-sub__name {
  font-size: 13px;
  line-height: 18px;
  color: var(--xc-text);
}

.xc-sub__label {
  font-size: 13px;
  font-weight: 600;
  color: var(--xc-text-regular);
}

.xc-sub__hint {
  width: 100%;
  margin-top: 4px;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--xc-text-secondary);
}

.xc-sub__dialog-hint {
  margin-bottom: 12px;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--xc-bg-soft);
  font-size: 12px;
  line-height: 1.8;
  color: var(--xc-text-regular);
}

.xc-sub__picker {
  margin-bottom: 12px;
}

.xc-sub__picker-title {
  display: inline-flex;
  align-items: center;
  font-size: 13px;
  font-weight: 600;
  color: var(--xc-text-regular);
}

.xc-sub__picker-search {
  margin-bottom: 8px;
}

/* 目录表格整行可点：选中一个来源比手抄群号常见得多 */
:deep(.el-table__row) {
  cursor: pointer;
}

@media (max-width: 768px) {
  .xc-toolbar__spacer {
    display: none;
  }
}
</style>
