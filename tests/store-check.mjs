/**
 * 通知 store 的自检（进程内跑真代码，不需要浏览器、不需要后端）。
 *
 *     npm run test:store
 *
 * 为什么要这个东西：**「增量刷新之后页面上的任务消失」这个 bug 是发出去的**。
 * 根因是 `applyListPayload` 把列表整体替换，而增量请求只返回"最近变更的那几条"
 * —— 于是每 60 秒一次的自动刷新都会把列表换成那几条（手动刷新走全量请求，所以
 * 又"恢复正常"）。这类 bug 用眼睛看不出来（要等一轮自动刷新），只有把
 * 「增量响应 + 合并」这条路径真跑一遍才抓得到。
 *
 * 覆盖：
 *   1. `mergeNotifications` / `maxUpdatedAt` / `runLimited` 的边界；
 *   2. 全量加载 → 增量加载（空增量、新增、修改、同一毫秒）**一条都不能丢**；
 *   3. 带筛选条件时是整体替换、且不推进增量游标；
 *   4. 多选：勾选 / 全选 / 清空 / 退出 / 列表替换后裁剪选择集；
 *   5. 批量已读与批量改状态：成功路径 + **部分失败**（回滚、留在选中集、报数）。
 *
 * 后端用一个假的 axios adapter 顶替：真发请求、真过拦截器，只有网络那一层是假的。
 */

import { createPinia, setActivePinia } from 'pinia'

let failures = 0
let total = 0

function check(name, got, want) {
  total += 1
  if (JSON.stringify(got) === JSON.stringify(want)) {
    console.log(`ok    ${name}`)
  } else {
    failures += 1
    console.log(`FAIL  ${name}\n      期望 ${JSON.stringify(want)}\n      实际 ${JSON.stringify(got)}`)
  }
}
function ok(name, cond, detail = '') {
  check(name + (detail ? `  ${detail}` : ''), !!cond, true)
}

/** 相对本文件的模块地址（跑 npm script 时 cwd 是仓库根，相对路径靠这个才稳） */
const moduleUrl = (path) => new URL(path, import.meta.url).href

/* ---------------- 假后端（替换 axios adapter） ---------------- */

const rows = new Map()
const requests = []
/** 这些 id 的写请求会失败（用来验证批量操作的失败路径） */
const failing = new Set()

let clock = 1_700_000_000_000

function seed(id, patch = {}) {
  clock += 1000
  rows.set(id, {
    id,
    group_id: 'g1',
    group_name: '通知群',
    sender_id: 's1',
    sender_name: '辅导员',
    title: `任务 ${id}`,
    summary: '',
    location: null,
    due_at: null,
    due_text: '下周三前',
    due_confidence: 1,
    evidence: `证据 ${id}`,
    conflict: false,
    candidates: [],
    extractor: 'llm',
    model: 'x',
    prompt_ver: 'v1',
    status: 'active',
    manually_edited: false,
    read: false,
    attachments: [],
    source_ts: clock,
    created_at: clock,
    updated_at: clock,
    ...patch
  })
}

const view = (row) => ({ ...row })

function badRequest(status, detail) {
  const err = new Error(`Request failed with status code ${status}`)
  err.isAxiosError = true
  err.response = { status, data: { detail } }
  return err
}

async function adapter(config) {
  const method = (config.method || 'get').toLowerCase()
  const url = config.url || ''
  const params = { ...(config.params || {}) }
  // 到了 adapter 这一层，axios 已经跑过 transformRequest：`config.data` 是**字符串**
  // （JSON.stringify 过的）。不解析它的话，假后端会把所有写请求当成空 body ——
  // 于是"批量改状态"那几条断言会因为假后端的错而失败（第一版就踩了这个坑）。
  let body = {}
  if (typeof config.data === 'string' && config.data) {
    try {
      body = JSON.parse(config.data)
    } catch (e) {
      body = {}
    }
  } else if (config.data && typeof config.data === 'object') {
    body = config.data
  }
  requests.push({ method, url, params, body })

  if (method === 'get' && url === '/notifications') {
    let list = [...rows.values()]
    if (params.since !== undefined && params.since !== null) {
      list = list.filter((r) => r.updated_at > Number(params.since))
    }
    if (params.status && params.status !== 'all') list = list.filter((r) => r.status === params.status)
    if (params.q) {
      const needle = String(params.q)
      list = list.filter((r) =>
        [r.title, r.summary, r.evidence].some((v) => String(v || '').includes(needle))
      )
    }
    list.sort((a, b) => (a.source_ts === b.source_ts ? 0 : b.source_ts - a.source_ts))
    return {
      data: { server_time: Date.now(), notifications: list.map(view) },
      status: 200,
      statusText: 'OK',
      headers: {},
      config
    }
  }

  const readMatch = url.match(/^\/notifications\/([^/]+)\/read$/)
  if (method === 'post' && readMatch) {
    const id = decodeURIComponent(readMatch[1])
    if (failing.has(id)) throw badRequest(500, '后端炸了')
    const row = rows.get(id)
    if (!row) throw badRequest(404, '通知不存在')
    clock += 1000
    row.read = !!body.read
    row.updated_at = clock
    return { data: { read: row.read }, status: 200, statusText: 'OK', headers: {}, config }
  }

  // DELETE /notifications/{id} —— 真删（后端只删通知行；不存在/别人的 → 404）
  const delMatch = url.match(/^\/notifications\/([^/]+)$/)
  if (method === 'delete' && delMatch) {
    const id = decodeURIComponent(delMatch[1])
    if (failing.has(id)) throw badRequest(500, '后端炸了')
    if (!rows.has(id)) throw badRequest(404, '通知不存在')
    rows.delete(id)
    return { data: { deleted: true }, status: 200, statusText: 'OK', headers: {}, config }
  }

  const corrMatch = url.match(/^\/notifications\/([^/]+)\/corrections$/)
  if (method === 'post' && corrMatch) {
    const id = decodeURIComponent(corrMatch[1])
    if (failing.has(id)) throw badRequest(500, '后端炸了')
    const row = rows.get(id)
    if (!row) throw badRequest(404, '通知不存在')
    clock += 1000
    row[body.field] = body.value
    row.manually_edited = true
    row.updated_at = clock
    return {
      data: { ok: true, notification: view(row) },
      status: 200,
      statusText: 'OK',
      headers: {},
      config
    }
  }

  const detailMatch = url.match(/^\/notifications\/([^/]+)$/)
  if (method === 'get' && detailMatch) {
    const id = decodeURIComponent(detailMatch[1])
    const row = rows.get(id)
    if (!row) throw badRequest(404, '通知不存在')
    return {
      data: { notification: view(row), raw: { id: `raw-${id}`, content: `原文 ${id}` } },
      status: 200,
      statusText: 'OK',
      headers: {},
      config
    }
  }

  throw badRequest(404, `假后端没有这个路由：${method.toUpperCase()} ${url}`)
}

/* ---------------- 装载真模块 ---------------- */

// 令牌先塞一个，保证拦截器那条路径被走到（值本身无所谓，假后端不看）
process.env.VITE_API_BASE = 'http://127.0.0.1:9/api'

const { setActiveToken } = await import(moduleUrl('../src/api/token.js'))
setActiveToken('xc_test_token')

const { http } = await import(moduleUrl('../src/api/client.js'))
http.defaults.adapter = adapter

setActivePinia(createPinia())

const { useNotificationsStore, mergeNotifications, maxUpdatedAt, runLimited } = await import(
  moduleUrl('../src/stores/notifications.js')
)

/* ---------------- 0. 纯函数的边界 ---------------- */

console.log('--- 0. mergeNotifications / maxUpdatedAt / runLimited ---')
const source = [
  { id: '1', title: 'A' },
  { id: '2', title: 'B' }
]
const merged = mergeNotifications(source, [{ id: '2', title: 'B2' }, { id: '3', title: 'C' }])
check('合并：就地替换 + 追加新的', merged.map((n) => `${n.id}:${n.title}`), ['1:A', '2:B2', '3:C'])
check('合并：不改动原数组', source.map((n) => n.title), ['A', 'B'])
check('合并：空增量 = 原样', mergeNotifications(source, []).length, 2)
check('合并：不是数组也扛得住', mergeNotifications(null, source).length, 2)
check('合并：丢掉没有 id 的垃圾', mergeNotifications([], [{ title: 'x' }, null]).length, 0)
check('游标：取最大 updated_at', maxUpdatedAt([{ updated_at: 5 }, { updated_at: 99 }, {}]), 99)
check('游标：空列表给 0', maxUpdatedAt([]), 0)
check('游标：脏值不炸', maxUpdatedAt([{ updated_at: 'abc' }, { updated_at: null }]), 0)

let inFlight = 0
let peak = 0
const limited = await runLimited([1, 2, 3, 4, 5, 6, 7, 8, 9], 4, async (n) => {
  inFlight += 1
  peak = Math.max(peak, inFlight)
  await new Promise((r) => setTimeout(r, 5))
  inFlight -= 1
  return n * 2
})
check('runLimited：结果按输入顺序', limited.map((r) => r.value), [2, 4, 6, 8, 10, 12, 14, 16, 18])
ok('runLimited：并发不超过限制', peak <= 4, `peak=${peak}`)
const limitedFail = await runLimited([1, 2], 2, async (n) => {
  if (n === 2) throw new Error('boom')
  return n
})
check('runLimited：失败落到那一条上', [limitedFail[0].ok, limitedFail[1].ok], [true, false])

/* ---------------- 1. 全量加载 ---------------- */

console.log('\n--- 1. 全量加载：列表 + 增量游标 ---')
const store = useNotificationsStore()
for (const id of ['1', '2', '3', '4', '5']) seed(id)
const fullCursor = Math.max(...[...rows.values()].map((r) => r.updated_at))

ok('全量加载成功', await store.load())
check('列表有 5 条', store.notifications.length, 5)
check('增量游标 = 这 5 条里最大的 updated_at', store.sinceCursor, fullCursor)
check('全量请求不带 since', requests[0].params.since, undefined)
check('未读 5 条', store.unreadCount, 5)

/* ---------------- 2. 增量刷新：这就是"任务消失"那个 bug ---------------- */

console.log('\n--- 2. 增量刷新：**不能**把列表换成增量那几条 ---')
const beforeIds = store.notifications.map((n) => n.id)

// 2a. 一条都没变 → 列表必须原样（旧实现会变成 0 条：页面上任务"消失"）
requests.length = 0
await store.load({ incremental: true, silent: true })
check('没有变更时列表一条不少', store.notifications.map((n) => n.id), beforeIds)
check('增量请求带上了 since = 游标 - 重叠窗口', requests[0].params.since, fullCursor - 2000)
check(
  '增量请求不带 status（不写 = 后端默认 all，见 api/client.js 的 fetchNotifications）',
  requests[0].params.status,
  undefined
)

// 2b. 来了一条新的 → 追加，旧的都还在
seed('6')
requests.length = 0
await store.load({ incremental: true, silent: true })
check('新条目被追加，旧的都在', store.notifications.map((n) => n.id), [...beforeIds, '6'])
check('游标跟着推进', store.sinceCursor, rows.get('6').updated_at)

// 2c. 已有的那条被改了（人工修正/重抽）→ 就地更新
clock += 1000
const row2 = rows.get('2')
row2.title = '任务 2（改期）'
row2.updated_at = clock
await store.load({ incremental: true, silent: true })
check('被改的那条就地更新', store.getById('2').title, '任务 2（改期）')
check('条数没变（不是又加了一条）', store.notifications.length, 6)

// 2d. 与游标**同一毫秒**写进来的那条：因为往回重叠了 2 秒，它必须被拿到
const cursorNow = store.sinceCursor
seed('7', { updated_at: cursorNow })
await store.load({ incremental: true, silent: true })
ok('同一毫秒写进来的条目不会漏（这就是重叠窗口的意义）', !!store.getById('7'), `cursor=${cursorNow}`)

check('新来的两条都是未读', store.unreadCount, 7)

/* ---------------- 3. 带筛选：整体替换，且不动游标 ---------------- */

console.log('\n--- 3. 带筛选条件：整体替换（不是合并），游标不动 ---')
clock += 1000
rows.get('3').status = 'archived'
rows.get('3').updated_at = clock
const cursorBeforeFilter = store.sinceCursor
store.setFilterStatus('active')
await store.load()
ok('筛选后列表只剩 active', store.notifications.every((n) => n.status === 'active'))
check('被归档的那条不在列表里', !!store.getById('3'), false)
check('带筛选时不推进增量游标（它只是个子集）', store.sinceCursor, cursorBeforeFilter)
check('带筛选时不带 since', requests[requests.length - 1].params.since, undefined)
store.setFilterStatus('all')
await store.load()
check('切回全部 → 又都在了', store.notifications.length, 7)

/* ---------------- 4. 多选：选择集 ---------------- */

console.log('\n--- 4. 多选：勾选 / 全选 / 清空 / 退出 ---')
check('默认不是多选模式', store.selectionMode, false)
store.setSelectionMode(true)
check('进入多选', store.selectionMode, true)
store.toggleSelect('1')
store.toggleSelect('2')
check('勾了两条', store.selectedIds, ['1', '2'])
check('selectedCount 对得上', store.selectedCount, 2)
check('isSelected 认字符串 id', store.isSelected(1), true)
store.toggleSelect('1')
check('再点一次 = 取消', store.selectedIds, ['2'])
store.selectAll()
check('全选 = 当前列表全部', store.selectedCount, store.notifications.length)
check('allSelected 为真', store.allSelected, true)
store.clearSelection()
check('清空', store.selectedCount, 0)
ok('没选中时 allSelected 为假', store.allSelected === false)

// 选中之后换筛选条件（全量替换）→ 已经看不见的条目不能还占着"已选 N 条"
store.selectAll()
store.setFilterStatus('active')
await store.load()
ok('全量替换后选中集被裁剪到还看得见的那些', store.selectedCount === store.notifications.length)
store.setFilterStatus('all')
await store.load()
store.setSelectionMode(false)
check('退出多选会清空选择集', store.selectedIds, [])

/* ---------------- 5. 批量标已读（含失败路径） ---------------- */

console.log('\n--- 5. 批量标已读：成功 / 部分失败 ---')
store.setSelectionMode(true)
store.setSelected(['1', '2', '4'])
ok('三条都是未读', ['1', '2', '4'].every((id) => store.getById(id).read === false))
let r = await store.batchSetRead(['1', '2', '4'], true)
check('全部成功', [r.ok, r.succeeded, r.failed.length], [true, 3, 0])
ok('本地已标已读', ['1', '2', '4'].every((id) => store.getById(id).read === true))
check('成功之后清空选择集', store.selectedIds, [])

// 再来一次：它们本来就是已读了 → 一条请求都不该发，并且如实说"本来就是"
const requestsBeforeNoop = requests.length
store.setSelected(['1', '2', '4'])
r = await store.batchSetRead(['1', '2', '4'], true)
check('已经是对的状态：不算成功、不算失败', [r.ok, r.succeeded, r.unchanged, r.failed.length], [true, 0, 3, 0])
check('而且没白发请求', requests.length, requestsBeforeNoop)

// 让 2 号的写请求失败：它必须被回滚、留在选中集里、并且被**报出来**
failing.add('2')
store.setSelected(['1', '2'])
r = await store.batchSetRead(['1', '2'], false)
check('部分失败：报了几条没改成', r.ok, false)
check('部分失败：成功的条数', r.succeeded, 1)
check('部分失败：失败的是哪条', r.failed.map((f) => f.id), ['2'])
ok('部分失败：失败原因不是空的', r.failed[0].message.length > 0, r.failed[0].message)
check('失败的那条被回滚（还是已读）', store.getById('2').read, true)
check('成功的那条生效了（变回未读）', store.getById('1').read, false)
check('失败的还留在选中集里（方便重试）', store.selectedIds, ['2'])
failing.delete('2')

/* ---------------- 6. 批量改状态 ---------------- */

console.log('\n--- 6. 批量改状态：done / archived ---')
store.setSelected(['1', '2'])
r = await store.batchSetStatus(['1', '2'], 'done')
check('两条都标记完成', [r.ok, r.succeeded], [true, 2])
check('本地状态以服务端返回为准', [store.getById('1').status, store.getById('2').status], ['done', 'done'])

// 已经是 done 的再来一次 → 不重复记 correction
const requestsBeforeDoneNoop = requests.length
r = await store.batchSetStatus(['1', '2'], 'done')
check('已经是这个状态：跳过并不报成功', [r.ok, r.succeeded, r.unchanged], [true, 0, 2])
check('也没重复写 correction', requests.length, requestsBeforeDoneNoop)

failing.add('4')
store.setSelected(['4', '5'])
r = await store.batchSetStatus(['4', '5'], 'archived')
check('部分失败如实报告', [r.ok, r.succeeded, r.failed.map((f) => f.id)], [false, 1, ['4']])
check('成功的生效', store.getById('5').status, 'archived')
check('失败的那条状态没变', store.getById('4').status, 'active')
check('失败项留在选中集里', store.selectedIds, ['4'])
failing.delete('4')

/* ---------------- 7. 详情接口拿回来的那条会 upsert 进列表 ---------------- */

console.log('\n--- 7. 详情：列表里的那条仍然在 ---')
store.setSelected([])
store.setSelectionMode(false)
const countBeforeDetail = store.notifications.length
await store.openDetail('6')
check('详情能打开', !!store.detail, true)
check('列表条数没被详情接口搞乱', store.notifications.length, countBeforeDetail)
ok('那条还在列表里', !!store.getById('6'))

/* ---------------- 8. 批量删除（真删，和归档是两件事） ---------------- */

console.log('\n--- 8. 批量删除 ---')
const beforeDelete = store.notifications.map((n) => n.id)
check('删之前列表里有 7 条', beforeDelete.length, 7)

// 8a. 全成功：本地去掉、后端也没了、选中集清空
store.setSelectionMode(true)
store.setSelected(['6', '7'])
let del = await store.batchDelete(['6', '7'])
check('两条都删掉', [del.ok, del.succeeded, del.failed.length], [true, 2, 0])
check(
  '本地列表跟着去掉（不然页面上还在，看着像没删掉）',
  store.notifications.map((n) => n.id),
  beforeDelete.filter((id) => id !== '6' && id !== '7')
)
check('后端那边真的没了', rows.has('6'), false)
check('成功后清空选择集', store.selectedIds, [])

// 8b. 部分失败：成功的去掉，失败的原样留着并保持选中（可重试）
failing.add('5')
store.setSelected(['5'])
del = await store.batchDelete(['5'])
check('失败如实报告', [del.ok, del.succeeded, del.failed.map((f) => f.id)], [false, 0, ['5']])
check('失败的那条还在列表里', !!store.getById('5'), true)
check('而且留在选中集里', store.selectedIds, ['5'])
failing.delete('5')

// 8c. 后端已经没有这条（404）→ 本地跟着去掉，**不算失败**（别人删过/自己删过）
rows.delete('4')
del = await store.batchDelete(['5', '4'])
check('404 按"已经没了"处理', [del.ok, del.succeeded, del.failed.length], [true, 2, 0])
check('本地都清掉了', !!store.getById('4'), false)
check('列表里只剩 3 条', store.notifications.length, 3)

console.log()
if (failures) {
  console.log(`❌ ${failures}/${total} 条失败`)
  process.exit(1)
}
console.log(`✅ ${total} 条断言全部通过`)
