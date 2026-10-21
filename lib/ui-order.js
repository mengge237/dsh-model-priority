// UI 列表顺序：把「原生列表」的用户顺序存成一份纯数据文件。
//
// 为什么单独一份：模型顺序走 ctx.llm 钩子（读侧），界面列表（设置左导航等）没有
// 宿主扩展点可以排，只能在浏览器侧按这份顺序重排 DOM。两者都只读这份文件，
// 不再改写 settings 真源——写配置的代价（备份、跨 profile 镜像、逐字节校验）
// 换不来任何东西：顺序生效靠的是运行时的读侧。
import fs from 'node:fs'

export const MAX_LISTS = 64
export const MAX_KEYS = 500

/** 清洗 { listId: [key...] }：丢掉空 id/空 key/非数组，限制条数。 */
export function sanitizeLists(value) {
  const out = {}
  if (!value || typeof value !== 'object') return out
  let lists = 0
  for (const [id, keys] of Object.entries(value)) {
    if (lists >= MAX_LISTS) break
    const rid = String(id == null ? '' : id).trim()
    if (!rid || !Array.isArray(keys)) continue
    const clean = []
    for (const k of keys) {
      if (clean.length >= MAX_KEYS) break
      const s = String(k == null ? '' : k).trim()
      if (s) clean.push(s)
    }
    out[rid] = clean
    lists++
  }
  return out
}

/** 稳定排序：order 里点过名的排前面（按 order 的顺序），没点名的保持原相对顺序。 */
export function applyOrder(entries, order, keyOf = (x) => x) {
  const list = Array.isArray(entries) ? entries.slice() : []
  const keys = Array.isArray(order) ? order : []
  const index = new Map()
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]
    if (!index.has(k)) index.set(k, i)
  }
  const known = []
  const rest = []
  for (const e of list) {
    const k = keyOf(e)
    if (index.has(k)) known.push([index.get(k), e])
    else rest.push(e)
  }
  known.sort((a, b) => a[0] - b[0])
  return known.map((x) => x[1]).concat(rest)
}

export function readLists(file) {
  try {
    const text = fs.readFileSync(file, 'utf8')
    const parsed = JSON.parse(text)
    return sanitizeLists(parsed && parsed.lists ? parsed.lists : parsed)
  } catch {
    return {}
  }
}

export function writeLists(file, lists) {
  const clean = sanitizeLists(lists)
  const tmp = file + '.tmp-' + process.pid
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, updated: new Date().toISOString(), lists: clean }, null, 2), 'utf8')
  fs.renameSync(tmp, file)
  return clean
}
