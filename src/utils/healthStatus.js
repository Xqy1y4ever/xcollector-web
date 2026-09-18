/**
 * bot `/api/status` 的纯映射层。
 *
 * 契约见 xcollector-backend/docs/api.md 第 9 节。这里**不引任何 Vue / Element Plus**，
 * 只做「原始 JSON → 模板要用的形状」，好处是可以在 Node 里直接跑断言
 * （见验证脚本），不必启动构建。
 *
 * 设计原则：
 *  - 任何字段缺失/类型不对都退化成安全默认值，绝不抛异常（页面不能白屏）。
 *  - 数字一律用 toCount() 收敛，避免字符串 "3" 或者 null 混进模板。
 */

/** 与后端 status 无关的默认值：bot 不可达时页面就渲染这个 */
export const EMPTY_BOT_STATUS = {
  onebot: {
    connected: false,
    mode: '',
    target: '',
    last_event_at: null,
    reconnect_count: 0,
    last_error: null
  },
  llm: {
    extractor: '',
    primary_model: '',
    secondary_model: '',
    cross_check_enabled: false,
    vlm_enabled: false
  },
  whitelist: {
    groups: [],
    senders: [],
    sender_mode: '',
    // undefined = 旧版 bot 没给这个字段，此时前端不提示（见 HealthView）
    ready: undefined
  },
  pipeline: {
    today_ingested: 0,
    today_extracted: 0,
    today_unparsed: 0,
    today_conflicts: 0,
    today_degraded: 0,
    today_llm_tokens: 0
  },
  blindspots: {
    unparsed_count: 0,
    conflict_count: 0,
    low_confidence_count: 0,
    degraded_today: false,
    window_days: 0
  },
  groups: [],
  gap_alerts: [],
  // 分用户的清单；空数组 = 页面不显示下钻表格（旧版 bot 不给这个字段）
  per_user: [],
  backend: { reachable: false, base_url: '' },
  digest: { enabled: false, time: '', target_qq: '', sent_today: false },
  day: '',
  server_time: null
}

/** 宽松地把任意值收成「非负有限数」 */
export function toCount(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return n
}

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/**
 * bot `status.per_user` 的一行 → 表格要用的形状（缺字段一律收敛成安全默认值）。
 *
 * 注意这些数字**不是全站量**：一条消息扇给 N 个人就会替 N 个人各算一次，
 * 所以它们只能竖着看（某个人今天怎么样），不能横着加（那会重复计数）。
 * 返回 null = 这条没有 user_id，展示不出来，直接丢掉。
 */
export function normalizePerUserRow(raw) {
  if (!isPlainObject(raw)) return null
  const userId = raw.user_id === undefined || raw.user_id === null ? '' : String(raw.user_id)
  if (!userId) return null
  const stat = isPlainObject(raw.stat) ? raw.stat : {}
  return {
    user_id: userId,
    qq: raw.qq === undefined || raw.qq === null ? '' : String(raw.qq),
    display_name: str(raw.display_name),
    conflict_count: toCount(raw.conflict_count),
    low_confidence_count: toCount(raw.low_confidence_count),
    open_gap_alerts: toCount(raw.open_gap_alerts),
    digest_sent_today: !!raw.digest_sent_today,
    // stat 是后端累加的 pipeline_stat；没有就是"无统计"，而不是"0 条"
    stat_available: !!raw.stat_available,
    ingested: toCount(stat.ingested),
    extracted: toCount(stat.extracted),
    unparsed: toCount(stat.unparsed),
    conflicts: toCount(stat.conflicts)
  }
}

function str(value) {
  return value === null || value === undefined ? '' : String(value)
}

/**
 * 把 bot 的原始 status 补全成完整形状。
 * **注意 onebot 是嵌套对象**（曾经在后端 health 里是顶层字段，别搞混）。
 */
export function normalizeBotStatus(raw) {
  const data = isPlainObject(raw) ? raw : {}

  return {
    onebot: {
      connected: !!(data.onebot && data.onebot.connected),
      mode: str(data.onebot && data.onebot.mode),
      target: str(data.onebot && data.onebot.target),
      last_event_at:
        data.onebot && data.onebot.last_event_at !== undefined
          ? data.onebot.last_event_at
          : null,
      reconnect_count: toCount(data.onebot && data.onebot.reconnect_count),
      last_error: data.onebot && data.onebot.last_error ? String(data.onebot.last_error) : null
    },
    llm: {
      extractor: str(data.llm && data.llm.extractor),
      primary_model: str(data.llm && data.llm.primary_model),
      secondary_model: str(data.llm && data.llm.secondary_model),
      cross_check_enabled: !!(data.llm && data.llm.cross_check_enabled),
      vlm_enabled: !!(data.llm && data.llm.vlm_enabled)
    },
    whitelist: {
      groups: Array.isArray(data.whitelist && data.whitelist.groups)
        ? data.whitelist.groups.filter(isPlainObject)
        : [],
      senders: Array.isArray(data.whitelist && data.whitelist.senders)
        ? data.whitelist.senders.filter(isPlainObject)
        : [],
      sender_mode: str(data.whitelist && data.whitelist.sender_mode),
      // 白名单是否配到了"能收到东西"。字段缺失时保持 undefined —— 旧版 bot
      // 不会给这个字段，前端要能区分"没配好"和"不知道"，不能误报。
      ready:
        data.whitelist && typeof data.whitelist.ready === 'boolean'
          ? data.whitelist.ready
          : undefined
    },
    pipeline: {
      today_ingested: toCount(data.pipeline && data.pipeline.today_ingested),
      today_extracted: toCount(data.pipeline && data.pipeline.today_extracted),
      today_unparsed: toCount(data.pipeline && data.pipeline.today_unparsed),
      today_conflicts: toCount(data.pipeline && data.pipeline.today_conflicts),
      today_degraded: toCount(data.pipeline && data.pipeline.today_degraded),
      today_llm_tokens: toCount(data.pipeline && data.pipeline.today_llm_tokens)
    },
    blindspots: {
      unparsed_count: toCount(data.blindspots && data.blindspots.unparsed_count),
      conflict_count: toCount(data.blindspots && data.blindspots.conflict_count),
      low_confidence_count: toCount(data.blindspots && data.blindspots.low_confidence_count),
      degraded_today: !!(data.blindspots && data.blindspots.degraded_today),
      window_days: toCount(data.blindspots && data.blindspots.window_days)
    },
    groups: Array.isArray(data.groups) ? data.groups.filter(isPlainObject) : [],
    gap_alerts: Array.isArray(data.gap_alerts) ? data.gap_alerts.filter(isPlainObject) : [],
    // 多用户之后「盲区有几个」不再是一个数：per_user 是**分用户**的清单。
    // 旧版 bot 不给这个字段 → 空数组，页面据此不显示下钻表格（不误报成「0 人」）。
    per_user: Array.isArray(data.per_user)
      ? data.per_user.filter(isPlainObject).map(normalizePerUserRow).filter(Boolean)
      : [],
    backend: {
      reachable: !!(data.backend && data.backend.reachable),
      base_url: str(data.backend && data.backend.base_url)
    },
    digest: {
      enabled: !!(data.digest && data.digest.enabled),
      time: str(data.digest && data.digest.time),
      target_qq: str(data.digest && data.digest.target_qq),
      sent_today: !!(data.digest && data.digest.sent_today)
    },
    day: str(data.day),
    server_time:
      data.server_time === undefined || data.server_time === null ? null : data.server_time
  }
}

/* ------------------------------------------------------------------ *
 * OneBot 卡片
 * ------------------------------------------------------------------ */

/**
 * 顶栏状态点用：'ok' | 'down' | 'unknown'
 * bot 不可达（error 非空）时是 'down'，不是 'unknown'——「查不到」本身就是故障。
 */
export function connectionState(status, error) {
  if (error) return 'down'
  if (!status || !status.onebot) return 'unknown'
  return status.onebot.connected ? 'ok' : 'down'
}

/** 顶栏状态点的一行文案 */
export function connectionText(status, error) {
  if (error) return 'bot 未运行或不可达'
  if (!status) return '未知'
  const onebot = status.onebot
  if (!onebot) return '未知'
  if (!onebot.connected) {
    return onebot.last_error ? `OneBot 已断开（${onebot.last_error}）` : 'OneBot 已断开'
  }
  const mode = onebot.mode ? `（${onebot.mode}）` : ''
  return `OneBot 已连接${mode}`
}

/* ------------------------------------------------------------------ *
 * 后端可达性卡片（页面上最重要的运维信号）
 * ------------------------------------------------------------------ */

/**
 * 后端可达性。
 *
 * 两个来源，**任一报警就报警**：
 *  1. `probe`：前端自己打后端 `/api/health` 的真实结果
 *     （`{ checked: true, ok: true, message }` 或 `{ checked: true, ok: false, message }`）
 *     ——这是浏览器真正依赖的链路；
 *  2. `status.backend.reachable`：bot 自报的后端可达性。
 *
 * 为什么不只看 bot 自报：bot 到后端的链路可能和浏览器到后端的链路不同
 * （端口/网络命名空间/host 不同），而且真正往库里写数据的是 bot。
 * 两边都看，才能覆盖「bot 活着但后端挂了」和「bot 自己连不上但浏览器能连」两种故障。
 *
 * `probe.checked !== true`（还没探过）时返回 level='unknown'，**不误报**成不可达。
 *
 * @returns {{ reachable: boolean, level: 'ok'|'warning'|'unknown', title: string,
 *             detail: string, probe: string, baseUrl: string, botReported: boolean|null }}
 */
export function backendReachability(status, probe) {
  const botReported =
    status && status.backend && typeof status.backend.reachable === 'boolean'
      ? status.backend.reachable
      : null

  const probeOk = !!(probe && probe.checked === true && probe.ok)
  const probeMessage = (probe && probe.message) || ''

  // probe 还没跑过就不下判断，避免首屏误报「后端不可达」
  if (!probe || probe.checked !== true) {
    return {
      reachable: botReported === true,
      level: 'unknown',
      title: '尚未探测',
      detail: '正在探测后端存储健康（GET /api/health）。',
      probe: probeMessage || '尚未探测',
      baseUrl: (status && status.backend && status.backend.base_url) || '',
      botReported
    }
  }

  // 直接探针优先：它反映「浏览器 → 后端」这条链路
  const reachable = probeOk

  if (reachable && botReported === false) {
    return {
      reachable: false,
      level: 'warning',
      title: '后端可达性异常',
      detail:
        '本机可以访问后端，但 bot 自报连不上后端。消息可能写不进数据库，请核对 bot 的 BACKEND 地址配置。',
      probe: probeMessage || '探测成功',
      baseUrl: (status && status.backend && status.backend.base_url) || '',
      botReported
    }
  }

  if (reachable) {
    return {
      reachable: true,
      level: 'ok',
      title: '后端可达',
      detail: 'bot 与浏览器都能访问数据层，消息可以正常入库。',
      probe: probeMessage || '探测成功',
      baseUrl: (status && status.backend && status.backend.base_url) || '',
      botReported
    }
  }

  if (botReported === true) {
    return {
      reachable: false,
      level: 'warning',
      title: '后端不可达',
      detail:
        'bot 自报能连上后端，但本页探测失败（可能是浏览器到后端的地址/端口不通）。请确认后端进程与代理配置。',
      probe: probeMessage || '探测失败',
      baseUrl: (status && status.backend && status.backend.base_url) || '',
      botReported
    }
  }

  return {
    reachable: false,
    level: 'warning',
    title: '后端不可达',
    detail:
      'bot 活着但后端不可达：消息收得到却存不进去，通知台也不会有新数据。请先恢复后端（FastAPI / 数据层）再排查其它问题。',
    probe: probeMessage || '探测失败',
    baseUrl: (status && status.backend && status.backend.base_url) || '',
    botReported
  }
}

/* ------------------------------------------------------------------ *
 * 盲区
 * ------------------------------------------------------------------ */

/**
 * 盲区计数。gap 计数是「缺口告警条数」，它和 unparsed/conflict/low_confidence
 * 一样只是数字。
 *  - `total`：页面标题用的总数（含缺口，缺口也是「系统瞎了」的一种）
 *  - `withoutGaps`：顶栏角标用（角标只看解析类盲区 + 降级，不含缺口，
 *    避免一次连接抖动就把角标顶到 9+，反而失去信息量）
 */
export function blindspotCounts(blindspots, gapCount = 0) {
  const b = blindspots || {}
  const unparsed = toCount(b.unparsed_count)
  const conflicts = toCount(b.conflict_count)
  const lowConfidence = toCount(b.low_confidence_count)
  const gaps = toCount(gapCount)
  const degraded = !!b.degraded_today
  return {
    unparsed,
    conflicts,
    lowConfidence,
    gaps,
    degraded,
    total: unparsed + conflicts + lowConfidence + gaps + (degraded ? 1 : 0),
    /** 只有计数类 + 降级，不含缺口 */
    withoutGaps: unparsed + conflicts + lowConfidence + (degraded ? 1 : 0)
  }
}

/* ------------------------------------------------------------------ *
 * 群列表 / 白名单
 * ------------------------------------------------------------------ */

/** 静默超过该小时数视为可能掉线（沿用改造前口径，见设计文档 R9） */
export const SILENT_HOURS_THRESHOLD = 2

/** 群名兜底：名字缺失时用 id，两者都没有才给未知 */
export function groupLabel(group) {
  const g = group || {}
  return g.group_name || g.name || g.group_id || '未知群'
}

/** 键：优先 group_id，缺失时退到下标，保证 v-for :key 稳定唯一 */
export function groupKey(group, index) {
  const g = group || {}
  if (g.group_id !== undefined && g.group_id !== null && g.group_id !== '') {
    return String(g.group_id)
  }
  if (g.id !== undefined && g.id !== null && g.id !== '') return String(g.id)
  return `group-${index}`
}

function idsOf(list, key) {
  const out = []
  if (!Array.isArray(list)) return out
  for (const item of list) {
    if (!isPlainObject(item)) continue
    const v = item[key]
    if (v === undefined || v === null || v === '') continue
    out.push(String(v))
  }
  return out
}

/**
 * 群白名单的 id 集合（数字/字符串都能匹配）。
 * 白名单里的 group_id 和群列表里的 group_id 有可能一个是数字一个是字符串，
 * 所以统一按字符串比。
 */
export function whitelistGroupIds(whitelist) {
  return idsOf(whitelist && whitelist.groups, 'group_id')
}

export function whitelistSenderIds(whitelist) {
  return idsOf(whitelist && whitelist.senders, 'sender_id')
}

export function isSilentGroup(group, threshold = SILENT_HOURS_THRESHOLD) {
  const h = Number(group && group.silent_hours)
  return Number.isFinite(h) && h > threshold
}

/** 静默小时数的展示文案 */
export function formatSilentHours(group) {
  const h = Number(group && group.silent_hours)
  if (!Number.isFinite(h)) return '—'
  return `${h.toFixed(1)} 小时`
}

/* ------------------------------------------------------------------ *
 * digest
 * ------------------------------------------------------------------ */

/**
 * digest 区块的展示模型。
 * 注意：`enabled=true` 只代表配置开着，`sent_today` 才代表今天真的发过了。
 */
export function digestView(digest) {
  const d = digest || {}
  const enabled = !!d.enabled
  const sentToday = !!d.sent_today
  let statusText = '未启用'
  let tagType = 'info'
  if (enabled && sentToday) {
    statusText = '已启用 · 今天已发送'
    tagType = 'success'
  } else if (enabled) {
    statusText = `已启用 · 每天 ${d.time || '—'} 推送`
    tagType = 'success'
  }
  return {
    enabled,
    sentToday,
    time: d.time || '',
    targetQq: d.target_qq === null || d.target_qq === undefined ? '' : String(d.target_qq),
    statusText,
    tagType
  }
}

/* ------------------------------------------------------------------ *
 * 流水线
 * ------------------------------------------------------------------ */

/** 今日流水线：入库 → 抽出 的差额提示 + 是否降级 */
export function pipelineView(pipeline) {
  const p = pipeline || {}
  const ingested = toCount(p.today_ingested)
  const extracted = toCount(p.today_extracted)
  const unparsed = toCount(p.today_unparsed)
  const conflicts = toCount(p.today_conflicts)
  const degraded = toCount(p.today_degraded)
  return {
    ingested,
    extracted,
    unparsed,
    conflicts,
    degraded,
    llmTokens: toCount(p.today_llm_tokens),
    degradedToday: degraded > 0,
    dropped: Math.max(ingested - extracted, 0)
  }
}
