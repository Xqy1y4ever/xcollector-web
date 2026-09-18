import { http } from './client'
import { getActiveToken } from './token'

/**
 * 用户、注册、订阅——多用户之后新增的那几组接口。
 *
 * 单独成文件而不是塞进 client.js：client.js 是「通知台」那条主链路（列表 / 详情 /
 * 修正 / 已读 / 附件 / 健康），职责已经够满了。这里放的是**账号与个人配置**，
 * 它们全都以 UserToken 为身份，改动频率也一致。
 *
 * 契约见 xcollector-backend/docs/api.md 与 app/api/routes.py 第 3b / 9 节。
 */

/* ------------------------------------------------------------------ *
 * 我是谁
 * ------------------------------------------------------------------ */

/**
 * GET /api/me —— 登录检查 + 「我是谁」。
 *
 * 这是**唯一**能区分「用户令牌」和「服务令牌」的接口：
 *   - 用户令牌 → `{"scope":"user","user":{...}}`
 *   - 服务令牌 → `{"scope":"service","user":null}`
 * 两者都返回 200，所以调用方**必须看 scope**，不能只看有没有报错。
 *
 * 显式带 Authorization 而不是依赖请求拦截器读当前登录态：登录时用户刚粘贴的令牌
 * 可能还没写进 store，读旧值会拿错令牌。
 *
 * 401 走的是**通用**处理路径（不是特权路径）：登录页上的 401 因为「已经在 /login」
 * 而不会触发跳转，boot 时（main.js 的静默校验）的 401 则会清登录态并把页面送回
 * /login —— 这正是我们要的。判断依据是当前路径，而不是给请求打标记：
 * 打过标记的那一版会让 boot 时的 401 也被跳过，坏令牌于是永远踢不出去。
 */
export async function fetchMe() {
  const token = getActiveToken()
  const config = {}
  if (token) config.headers = { Authorization: `Bearer ${token}` }
  const { data } = await http.get('/me', config)
  return data
}

/* ------------------------------------------------------------------ *
 * 注册
 * ------------------------------------------------------------------ */

/**
 * POST /api/register —— **公开接口，不带 Authorization**。
 *
 * 注册的前提就是「还没有令牌」，所以这里刻意不带身份。
 * 把关的是三样东西：邀请码、QQ 验证码（只有能收到 bot 私聊的人才拿得到）、
 * 以及猜错次数上限 —— 全在后端。
 *
 * 返回里的 `token` 是**明文，只会出现这一次**（库里只存 sha256）。
 * 调用方必须让用户当场复制走。
 *
 * ⚠️ **这个接口的错误必须是 400，不能是 401。**
 * 它是公开接口，而前端的响应拦截器把 401 当成「登录过期」→ 清登录态 + 跳登录页。
 * 验证码填错返回 401 的话，用户错一次就会被从注册页弹出去，而且看到的是
 * 「令牌无效或已过期」——完全误导。（后端 `users.py` 里验证码不匹配返回的是
 * 400 + 中文 detail；曾经是 401，改回来了。想改回去之前先看这段。）
 *
 * @param {{ qq: string, code: string, invite_code?: string, display_name?: string }} body
 * @returns {Promise<{ user: object, token: string, created: boolean, notice: string }>}
 */
export async function registerUser(body) {
  const payload = {
    qq: String(body.qq || '').trim(),
    code: String(body.code || '').trim()
  }
  // 开放注册（SIGNUP_MODE=open）时邀请码可以留空。留空就不发这个字段，
  // 让后端自己决定要不要 —— 前端不做「该不该要」的判断。
  const invite = String(body.invite_code || '').trim()
  if (invite) payload.invite_code = invite
  const displayName = String(body.display_name || '').trim()
  if (displayName) payload.display_name = displayName

  const { data } = await http.post('/register', payload, { xcSkipAuth: true })
  return data
}

/* ------------------------------------------------------------------ *
 * 订阅
 * ------------------------------------------------------------------ */

/**
 * GET /api/subscriptions
 * @param {{ includeDisabled?: boolean }} [opts] includeDisabled=false → 只列启用的
 */
export async function fetchSubscriptions(opts = {}) {
  const params = {}
  if (opts.includeDisabled === false) params.include_disabled = 'false'
  const { data } = await http.get('/subscriptions', { params })
  return data
}

/**
 * POST /api/subscriptions —— 订「某个群里某个人说的话」。
 *
 * `group_id` 与 `sender_id` 都是**必填**：后端不接受「订整个群」（会返回 400），
 * 所以调用方也不该提供这个选项。
 *
 * @param {{ group_id: string, sender_id: string, group_name?: string, sender_name?: string, note?: string }} body
 */
export async function createSubscription(body) {
  const payload = {
    group_id: String(body.group_id || '').trim(),
    sender_id: String(body.sender_id || '').trim()
  }
  for (const key of ['group_name', 'sender_name', 'note']) {
    const value = String(body[key] || '').trim()
    if (value) payload[key] = value
  }
  const { data } = await http.post('/subscriptions', payload)
  return data
}

/**
 * PATCH /api/subscriptions/{id} —— 改 enabled / note / 名字。
 * 不存在（或不是自己的）返回 404 —— 后端刻意不区分这两种，
 * 免得别人的订阅 id 能被探测出来。
 *
 * @param {string} id
 * @param {{ enabled?: boolean, note?: string, group_name?: string, sender_name?: string }} patch
 */
export async function patchSubscription(id, patch) {
  const { data } = await http.patch(`/subscriptions/${encodeURIComponent(id)}`, patch)
  return data
}

/** DELETE /api/subscriptions/{id} → `{ deleted: true }` */
export async function deleteSubscription(id) {
  const { data } = await http.delete(`/subscriptions/${encodeURIComponent(id)}`)
  return data
}

/**
 * GET /api/sources —— **信息源目录**：这套部署见过的 (群, 发送者) 组合。
 *
 * 新用户注册完手上是空的（没有通知、也不知道群号），没有这份目录就无从订阅，
 * 所以它对本部署的任何登录用户都开放。代价说清楚：只有 bot 实际处理过的
 * 组合才会出现在这里。
 *
 * @param {{ keyword?: string, limit?: number }} [opts]
 * @returns {Promise<{ sources: Array, count: number }>}
 */
export async function fetchSources(opts = {}) {
  const params = {}
  const keyword = String(opts.keyword || '').trim()
  if (keyword) params.keyword = keyword
  if (opts.limit) params.limit = opts.limit
  const { data } = await http.get('/sources', { params })
  return data
}
