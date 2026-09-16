/**
 * evidence 定位与高亮工具。
 *
 * 需求：在 `raw.content` 全文里把 `evidence` 那一段文字高亮出来，
 * 用字符串 indexOf 定位后手动拼接，**不引入 markdown 库**。
 *
 * 难点是 LLM 给的 evidence 常常和原文不是逐字相等（去掉了 @全体成员、
 * 全角/半角标点、换行、省略号等）。所以这里做三级降级匹配：
 *   1. 精确子串匹配（indexOf）
 *   2. 归一化匹配（去空白 + 标点统一 + 全角转半角），再映射回原文下标
 *   3. 最长公共子串（滑动窗口，够用且不慢）
 * 全都失败时返回 matched=false，由调用方决定是否提示「证据未能在原文中定位」。
 */

const PUNCT_MAP = {
  '，': ',',
  '。': '.',
  '、': ',',
  '；': ';',
  '：': ':',
  '？': '?',
  '！': '!',
  '（': '(',
  '）': ')',
  '【': '[',
  '】': ']',
  '《': '<',
  '》': '>',
  '“': '"',
  '”': '"',
  '‘': "'",
  '’': "'",
  '～': '~',
  '－': '-',
  '—': '-',
  '…': '.',
  '\u3000': ' '
}

const IGNORED_CHARS = new Set([
  ' ',
  '\t',
  '\n',
  '\r',
  '@',
  '\u200b',
  '\ufeff',
  '.',
  ',',
  '!',
  '?',
  ';',
  ':',
  '"',
  "'",
  '(',
  ')',
  '[',
  ']',
  '<',
  '>',
  '-',
  '~',
  '*',
  '#',
  '`'
])

/** 单字符归一化：全角→半角、小写、去零宽字符 */
function normalizeChar(ch) {
  if (!ch) return ''
  let c = PUNCT_MAP[ch] !== undefined ? PUNCT_MAP[ch] : ch
  c = c.toLowerCase()
  if (IGNORED_CHARS.has(c)) return ''
  return c
}

/**
 * 归一化字符串，同时返回「归一化下标 → 原文下标」的映射表，
 * 以便匹配成功后能精确切出原文片段。
 */
function normalizeWithMap(text) {
  const out = []
  const map = []
  const src = String(text || '')
  for (let i = 0; i < src.length; i += 1) {
    const c = normalizeChar(src[i])
    if (!c) continue
    for (let k = 0; k < c.length; k += 1) {
      out.push(c[k])
      map.push(i)
    }
  }
  return { text: out.join(''), map }
}

/** 最长公共子串：返回 { start, end } 原文下标（end 不含），失败返回 null */
function longestCommonSubstring(content, evidence, minRatio = 0.6) {
  if (!content || !evidence) return null
  const a = content
  const b = evidence
  const minLen = Math.max(6, Math.floor(b.length * minRatio))

  // 以 evidence 的一个窗口为种子，在 content 中滑动查找
  const window = b.slice(0, Math.min(b.length, 18))
  let best = null

  const tryExtend = (aStart, bStart) => {
    let i = aStart
    let j = bStart
    while (i < a.length && j < b.length && a[i] === b[j]) {
      i += 1
      j += 1
    }
    const len = i - aStart
    if (len >= minLen && (!best || len > best.len)) {
      best = { aStart, aEnd: i, len }
    }
  }

  // 先找所有种子匹配点
  let from = 0
  while (from <= a.length - window.length) {
    const idx = a.indexOf(window, from)
    if (idx === -1) break
    // 向前回溯，尽量把公共部分扩展完整
    let back = 0
    while (idx - 1 - back >= 0 && b.length - 1 - back >= 0 && a[idx - 1 - back] === b[b.length - 1 - back]) {
      back += 1
    }
    tryExtend(idx, 0)
    from = idx + 1
  }

  // 种子失败时退化为逐字符滑窗（内容通常不长，可接受）
  if (!best) {
    const step = Math.max(1, Math.floor(b.length / 24))
    for (let s = 0; s < b.length - minLen + 1; s += step) {
      const probe = b.slice(s, s + 12)
      if (probe.length < 4) break
      let idx = a.indexOf(probe)
      while (idx !== -1) {
        tryExtend(idx, s)
        idx = a.indexOf(probe, idx + 1)
      }
    }
  }

  if (!best) return null
  return { start: best.aStart, end: best.aEnd }
}

/**
 * 在 content 中定位 evidence。
 * @returns {{ matched: boolean, start: number, end: number, strategy: string, ratio: number }}
 */
export function locateEvidence(content, evidence) {
  const src = String(content || '')
  const ev = String(evidence || '').trim()

  if (!src || !ev) {
    return { matched: false, start: -1, end: -1, strategy: 'none', ratio: 0 }
  }

  // 1) 精确匹配
  const exact = src.indexOf(ev)
  if (exact !== -1) {
    return { matched: true, start: exact, end: exact + ev.length, strategy: 'exact', ratio: 1 }
  }

  // 2) 归一化匹配
  const nContent = normalizeWithMap(src)
  const nEvidence = normalizeWithMap(ev)
  if (nEvidence.text.length >= 4 && nContent.text) {
    const idx = nContent.text.indexOf(nEvidence.text)
    if (idx !== -1) {
      const start = nContent.map[idx]
      const end = nContent.map[idx + nEvidence.text.length - 1] + 1
      return {
        matched: true,
        start,
        end,
        strategy: 'normalized',
        ratio: nEvidence.text.length / Math.max(1, ev.length)
      }
    }
  }

  // 3) 最长公共子串兜底
  const lcs = longestCommonSubstring(nContent.text, nEvidence.text, 0.6)
  if (lcs) {
    const start = nContent.map[lcs.start]
    const end = nContent.map[lcs.end - 1] + 1
    return {
      matched: true,
      start,
      end,
      strategy: 'partial',
      ratio: lcs.len / Math.max(1, nEvidence.text.length)
    }
  }

  return { matched: false, start: -1, end: -1, strategy: 'none', ratio: 0 }
}

/**
 * 把 content 切成 [{ text, hit }]，供模板用 <mark> 渲染命中段。
 * 这是「手动拼接」，不依赖任何 markdown 库。
 */
export function splitByEvidence(content, evidence) {
  const src = String(content || '')
  const loc = locateEvidence(src, evidence)
  if (!loc.matched) {
    return { parts: [{ text: src, hit: false }], matched: false, strategy: 'none' }
  }
  const parts = []
  if (loc.start > 0) parts.push({ text: src.slice(0, loc.start), hit: false })
  parts.push({ text: src.slice(loc.start, loc.end), hit: true })
  if (loc.end < src.length) parts.push({ text: src.slice(loc.end), hit: false })
  return { parts, matched: true, strategy: loc.strategy }
}

export default { locateEvidence, splitByEvidence }
