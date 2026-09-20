// dsh-model-priority —— 自定义「模型 / 提供方」顺序（服务端半边）
//
// 要解决的问题：宿主弹出的模型选择列表按适配器注册顺序排，用户没法把自己常用的
// 模型顶到前面去。这个包做两件事：
//   1) 把顺序存在 ~/.dsh/model-order.json（纯数据，可手改，出问题删掉就回到默认）；
//   2) 在 ctx.llm 上包一层，让 listProviders() / listModels() 按这份顺序返回。
//
// 承重点只有一句：**排序是稳定排序**——没被点过名的条目保持它们原来的相对位置，
// 所以「只把两个模型换个位置」不会把别的顺序搅乱。
//
// UI 不在这里：本包是双面板包，浏览器侧在 lib/client.js（package.json 的 exports["./client"]），
// 由宿主的客户端模块图发给页面，注册成 dsh-better-sidebar 的一个侧边栏页面。
// 改这个文件要重启 dsh web 才生效；改 lib/client.js 同样要重启（它是启动时进 boot 图的 combo）。
//
// 卸载：dsh plugin --profile web remove dsh-model-priority（顺序文件会留在 ~/.dsh 下，手动删）

import * as proxy from './proxy.js'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'

const name = 'dsh-model-priority'
// llm 是排序的作用对象；webServer 用来注册自己的两条路由。
// 声明 inject 而不是懒取，是为了保证 apply 跑的时候 llm 已经就位——
// 否则插件装配早于 llm 时，挂钩要等到第一次请求 state.json 才补上。
const inject = ['webServer', 'llm']

const DSH_HOME = process.env.DSH_HOME || join(os.homedir(), '.dsh')
const ORDER_FILE = join(DSH_HOME, 'model-order.json')
const ROUTE_STATE = '/' + name + '/state.json'
const ROUTE_ORDER = '/' + name + '/order.json'

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
}

function send(res, code, body) {
  let text
  try {
    text = JSON.stringify(body)
  } catch (err) {
    text = JSON.stringify({ ok: false, error: 'response not serializable: ' + String(err) })
    code = 500
  }
  res.writeHead(code, Object.assign({ 'Content-Length': Buffer.byteLength(text) }, JSON_HEADERS))
  res.end(text)
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > (limit || 512 * 1024)) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/* ── 顺序文件 ── */

function emptyOrder() {
  // providerOrder: 提供方 id 的顺序；modelOrder: 提供方 id -> 该提供方下模型 id 的顺序
  return { version: 1, providerOrder: [], modelOrder: {} }
}

function sanitizeOrder(raw) {
  const out = emptyOrder()
  if (!raw || typeof raw !== 'object') return out
  if (Array.isArray(raw.providerOrder)) {
    out.providerOrder = raw.providerOrder.filter((x) => typeof x === 'string' && x.length > 0)
  }
  const mo = raw.modelOrder
  if (mo && typeof mo === 'object' && !Array.isArray(mo)) {
    for (const key of Object.keys(mo)) {
      if (typeof key !== 'string' || !key) continue
      const list = mo[key]
      if (!Array.isArray(list)) continue
      out.modelOrder[key] = list.filter((x) => typeof x === 'string' && x.length > 0)
    }
  }
  return out
}

function readOrder() {
  try {
    const text = fs.readFileSync(ORDER_FILE, 'utf8')
    return sanitizeOrder(JSON.parse(text))
  } catch {
    return emptyOrder()
  }
}

function writeOrder(data) {
  const clean = sanitizeOrder(data)
  const tmp = ORDER_FILE + '.tmp'
  fs.mkdirSync(DSH_HOME, { recursive: true })
  fs.writeFileSync(tmp, JSON.stringify(clean, null, 2) + '\n', 'utf8')
  fs.renameSync(tmp, ORDER_FILE)
  return clean
}

/* ── 排序 ── */

// 稳定排序：只把点过名的条目按名单提前，没点名的保持原有相对顺序。
function sortByOrder(items, order, idOf) {
  if (!Array.isArray(items) || !Array.isArray(order) || order.length === 0) return items
  const rank = new Map()
  for (let i = 0; i < order.length; i++) rank.set(order[i], i)
  const fallback = order.length
  return items
    .map((item, i) => ({ item, i, r: rank.has(idOf(item)) ? rank.get(idOf(item)) : fallback }))
    .sort((a, b) => (a.r === b.r ? a.i - b.i : a.r - b.r))
    .map((entry) => entry.item)
}

/* ── 往 ctx.llm 上装排序（幂等） ── */

function resolveLlm(ctx) {
  try {
    if (ctx && ctx.llm) return ctx.llm
  } catch {}
  try {
    if (ctx && typeof ctx.get === 'function') {
      const got = ctx.get('llm')
      if (got) return got
    }
  } catch {}
  return null
}

// 包出来的替换函数都打这个标记，用来判断是不是已经包过了。
// 用函数自身的标记而不是 WeakSet / 实例属性：ctx.llm 每次取到的可能是不同的
// cordis traceable 代理对象，但 own property 上那个替换函数始终是同一个。
const WRAPPER_FLAG = '__dshModelPriorityWrapper'

function isWrapped(fn) {
  return typeof fn === 'function' && fn[WRAPPER_FLAG] === true
}

function tagged(wrapper) {
  Object.defineProperty(wrapper, WRAPPER_FLAG, { value: true, enumerable: false })
  return wrapper
}

// 在 ctx.llm 的实例属性上包一层排序。幂等：包过的会被认出来，不会套第二层。
//
// 为什么是「替换实例属性」而不是继承 / 子类：宿主的远端分发拿的是
// Reflect.get(活实例, 'listProviders')（见 dsh-api-gateway 的 prepareInvocation），
// own property 优先，所以换实例属性能同时改到直调方与远端两条路。
//
// 三条硬约束（写错了对话框会直接报错，不是静默降级）：
//   1) listProviders 与 listConfigurableProviders 必须是同步函数。宿主的
//      buildModelCatalog 是同步调 listProviders() 的，返回 Promise 会在紧接着的
//      providers.map(...) 上炸成 providers.map is not a function。
//   2) 替换函数的形参个数要跟原方法一致（远端按签名校验）：
//      listProviders() 收 0 个，listModels(provider) 收 1 个。
//   3) 返回值形状不变——只重新排序，条目本身一个字段都不动。
//
// readOrder() 是每次调用现读磁盘的，所以手改 model-order.json 不用重启就生效。
function installHooks(ctx) {
  const llm = resolveLlm(ctx)
  if (!llm) return { ok: false, reason: '拿不到 ctx.llm（宿主版本不同或 llm 服务还没起来）' }
  if (typeof llm.listProviders !== 'function') {
    return { ok: false, reason: 'ctx.llm 上没有 listProviders，没法挂钩' }
  }

  const wrapped = []

  try {
    if (!isWrapped(llm.listProviders)) {
      const orig = llm.listProviders.bind(llm)
      llm.listProviders = tagged(function () {
        const list = orig()
        if (!Array.isArray(list)) return list
        return sortByOrder(list, readOrder().providerOrder, (p) => (p && p.id) || '')
      })
      wrapped.push('listProviders')
    }

    // 「设置 -> 模型」页读的是目录声明（entry.provider 才是 id），不是 adapters。
    // 不包这一条的话，两个界面的顺序会不一致。
    if (typeof llm.listConfigurableProviders === 'function' && !isWrapped(llm.listConfigurableProviders)) {
      const orig = llm.listConfigurableProviders.bind(llm)
      llm.listConfigurableProviders = tagged(function () {
        const list = orig()
        if (!Array.isArray(list)) return list
        return sortByOrder(list, readOrder().providerOrder, (e) => (e && e.provider) || '')
      })
      wrapped.push('listConfigurableProviders')
    }

    if (typeof llm.listModels === 'function' && !isWrapped(llm.listModels)) {
      const orig = llm.listModels.bind(llm)
      llm.listModels = tagged(async function (provider) {
        const list = await orig(provider)
        if (!Array.isArray(list)) return list
        const order = readOrder().modelOrder[provider]
        return sortByOrder(list, order, (m) => (m && m.id) || '')
      })
      wrapped.push('listModels')
    }

    return wrapped.length ? { ok: true, hooked: true, wrapped } : { ok: true, already: true }
  } catch (err) {
    return { ok: false, reason: '挂钩失败: ' + (err && err.message ? err.message : String(err)) }
  }
}

/* ── 给 UI 用的目录快照 ── */

function providerLabel(p) {
  if (!p || typeof p !== 'object') return String(p)
  return p.displayName || p.label || p.name || p.id || '(未命名)'
}

async function snapshot(ctx) {
  const hook = installHooks(ctx)
  const llm = resolveLlm(ctx)
  const order = readOrder()
  const out = {
    ok: true,
    orderFile: ORDER_FILE,
    order,
    providers: [],
    models: {},
    hook,
    llmAvailable: Boolean(llm),
    notes: [],
  }
  if (!llm) {
    out.notes.push('没有 ctx.llm 服务：只能编辑顺序文件，排序不会作用到模型列表。')
    return out
  }

  let providers = []
  try {
    const raw = typeof llm.listProviders === 'function' ? llm.listProviders() : []
    providers = Array.isArray(raw) ? raw : []
  } catch (err) {
    out.notes.push('listProviders() 抛错: ' + (err && err.message ? err.message : String(err)))
  }

  out.providers = providers.map((p) => ({ id: (p && p.id) || '', label: providerLabel(p) }))

  for (const p of out.providers) {
    if (!p.id) continue
    if (typeof llm.listModels !== 'function') {
      out.models[p.id] = []
      continue
    }
    try {
      const raw = await llm.listModels(p.id)
      out.models[p.id] = (Array.isArray(raw) ? raw : []).map((m) => ({
        id: (m && m.id) || '',
        name: (m && (m.name || m.id)) || '',
      }))
    } catch (err) {
      out.models[p.id] = []
      out.notes.push('listModels(' + p.id + ') 抛错: ' + (err && err.message ? err.message : String(err)))
    }
  }
  return out
}

/* ── 路由 ── */

/* ============================================================================
 * 设置页「模型顺序」——服务端半边（2026-09-10 加）
 *
 * 设计要点（对齐上游 provider-card 席位方案）：
 *   1. **单一事实来源 = settings.yaml 里该提供方的 models 数组顺序**。
 *      不再用 model-order.json 做读时排序 —— 两套顺序来源会打架，而宿主
 *      「设置 → 模型」页的行正是按 settings 渲染的，只有写进 settings 才真的"看得见"。
 *   2. **文本块级重排**，不重建对象：只把 `- id:` 条目按新顺序搬位置，
 *      条目自身的行（id/name/contextWindow/... 原样）跟着走。
 *      这样绝不会像"整体覆盖 models 数组"那样把没解析到的字段抹掉。
 *   3. 写盘用 tmp + rename（原子），并留一份 .bak-<时间戳>。
 * ========================================================================== */

const SETTINGS_FILE = join(DSH_HOME, 'settings.yaml')

/** 缩进宽度：provider 4 空格，models 键 6，条目 8，条目续行 10。 */
const IND = { provider: 4, modelsKey: 6, entry: 8 }

function readSettingsText() {
  return fs.readFileSync(SETTINGS_FILE, 'utf8')
}

/** settings.yaml 里某个 provider 的行区间 [start, end)（start 指向 '    <route>:'）。 */
function providerSpan(lines, route) {
  const head = ' '.repeat(IND.provider) + route + ':'
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].replace(/\s+$/, '') === head) { start = i; break }
  }
  if (start < 0) return null
  let end = start + 1
  while (end < lines.length) {
    const ln = lines[end]
    if (/^\S/.test(ln) || new RegExp('^ {' + IND.provider + '}\\S').test(ln)) break
    end++
  }
  return { start, end }
}

/**
 * 把某 provider 的 models 列表切成条目块。
 * 返回 { keyLine, entries: [{ id, lines }], others } —— others 是列表内不属于任何条目的行
 * （例如我早先手写的 `# ===== Tier N =====` 分区注释），重排后统一丢弃。
 */
function splitModels(lines, span) {
  let keyLine = -1
  for (let i = span.start; i < span.end; i++) {
    if (lines[i].trim() === 'models:') { keyLine = i; break }
  }
  if (keyLine < 0) return null
  const entries = []
  const leading = []
  let cur = null
  for (let i = keyLine + 1; i < span.end; i++) {
    const ln = lines[i]
    // 页面「新增模型」产生的是空 id 条目（`- id:`），所以这里**不要求 id 非空**
    const isEntry = new RegExp('^ {' + IND.entry + '}- id:').test(ln)
    if (isEntry) {
      const m = ln.match(/^\s+- id:\s*(\S*)\s*$/)
      cur = { id: m ? m[1] : '', lines: [ln] }
      entries.push(cur)
      continue
    }
    if (cur && new RegExp('^ {' + (IND.entry + 1) + ',}\\S').test(ln)) { cur.lines.push(ln); continue }
    if (ln.trim() === '') { if (cur) cur.lines.push(ln); continue }
    // 其它缩进行/注释：既不属于上一条目，也是列表内杂项 → 停止收集当前条目
    if (cur) { cur.lines.push(ln); continue }
    leading.push(ln)
  }
  return { keyLine, entries, leading }
}

/** 读出某 provider 当前的模型 id 顺序（原样，不解析字段）。 */
/** 读 settings.yaml 里 llm-pi-ai.providers 各路由的 baseURL 与 apiKeyEnv（文本级，够用即可）。 */
function readProviders() {
  let text = ''
  try { text = readSettingsText() } catch { return {} }
  const lines = text.split('\n')
  const out = {}
  const re = new RegExp('^ {' + IND.provider + '}([A-Za-z0-9_-]+):\s*$')
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(re)
    if (!m) continue
    const route = m[1]
    const span = providerSpan(lines, route)
    if (!span) continue
    let baseURL = null
    let apiKeyEnv = null
    for (let k = span.start; k < span.end; k++) {
      const b = lines[k].match(/^\s+baseURL:\s*(\S+)\s*$/)
      if (b && !baseURL) baseURL = b[1].replace(/^['"]|['"]$/g, '')
      const e = lines[k].match(/^\s+apiKeyEnv:\s*(\S+)\s*$/)
      if (e && !apiKeyEnv) apiKeyEnv = e[1]
    }
    out[route] = { baseURL: baseURL, apiKeyEnv: apiKeyEnv }
  }
  return out
}

/** 未命名条目的合成 id 前缀。 */
const UNNAMED = '__unnamed_'

function readProviderModelIds(route) {
  const lines = readSettingsText().split('\n')
  const span = providerSpan(lines, route)
  if (!span) return null
  const parsed = splitModels(lines, span)
  if (!parsed) return null
  // 未命名条目也要能排序、且不许丢：给它一个稳定合成 id（__unnamed_<原下标>）
  return parsed.entries.map((e, i) => e.id || (UNNAMED + i))
}

/**
 * 按给定 id 顺序重排 settings.yaml 里某 provider 的 models 数组。
 * - 未在 ids 里出现的模型**保持原有相对顺序追加在后面**（不丢模型）。
 * - ids 里出现但文件里没有的 id 会被忽略并在结果里回报。
 * @returns {{ ok: boolean, ids?: string[], unknown?: string[], backup?: string, error?: string }}
 */
function reorderProviderModels(route, ids) {
  const wanted = Array.isArray(ids) ? ids.filter((x) => typeof x === 'string' && x) : null
  if (!wanted) return { ok: false, error: 'ids 必须是字符串数组' }
  const text = readSettingsText()
  const lines = text.split('\n')
  const span = providerSpan(lines, route)
  if (!span) return { ok: false, error: '找不到提供方 ' + route }
  const parsed = splitModels(lines, span)
  if (!parsed) return { ok: false, error: '提供方 ' + route + ' 没有 models 列表' }

  const byId = new Map()
  parsed.entries.forEach((e, i) => byId.set(e.id || (UNNAMED + i), e))
  const unknown = wanted.filter((id) => !byId.has(id))
  const ordered = []
  for (const id of wanted) { const e = byId.get(id); if (e) { ordered.push(e); byId.delete(id) } }
  for (const e of parsed.entries) {
    const key = e.id || null
    if (key === null) { if (ordered.indexOf(e) < 0) ordered.push(e); continue }
    if (byId.has(key)) { ordered.push(e); byId.delete(key) }
  }

  const body = []
  for (const ln of parsed.leading || []) body.push(ln)
  for (const e of ordered) body.push(...e.lines)

  const expected = span.end - parsed.keyLine - 1
  if (body.length !== expected) {
    return { ok: false, error: '内部校验失败：重排行数 ' + body.length + ' != ' + expected + '，拒绝写入' }
  }
  const next = lines.slice(0, parsed.keyLine + 1).concat(body, lines.slice(span.end))
  const out = next.join('\n')

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backup = SETTINGS_FILE + '.bak-' + stamp
  fs.copyFileSync(SETTINGS_FILE, backup)
  const tmp = SETTINGS_FILE + '.tmp'
  fs.writeFileSync(tmp, out, 'utf8')
  fs.renameSync(tmp, SETTINGS_FILE)

  return { ok: true, ids: ordered.map((e, i) => e.id || (UNNAMED + i)), unknown, backup }
}

/* ── 语义化排序：我们的差异化能力 ──────────────────────────────────────────
 * 别人做的是"能排序"；这里按能力档位/成本/额度给出**有意义的**顺序。
 * 档位规则与 ~/bailian-free-auto/bailian_worker.py 的 classify_tier() 同源（JS 侧镜像）。
 */
const TIER_PRE4 = /^qwen-math|^qwen-mt|^deepseek-r1-distill-qwen-7b|^qwen3\.8-27b/i
const TIER_RULES = [
  [1, /qwen3\.8-max|qwen3\.7-max|qwen3\.6-max|qwen3\.5-max|qwen3-max|^qwen-max|qwen-vl-max|^qvq-max|^glm-5|^glm-4\.7$|^deepseek-v3\.[12]$|^deepseek-r1$|^deepseek-r1-0528$|^deepseek-v3$|^kimi-k3|^kimi-k2|^minimax-m2\.[15]$|^moonshot-kimi-k2/i],
  [2, /plus|-long|thinking|^glm-4\.6$|^glm-4\.5$|qwen3\.[567]-|235b|230b|480b|qwen3-32b|qwen3-30b|qwen3-14b|qvq-plus/i],
  [3, /flash|turbo|air|instruct|qwen3-8b|qwen3-vl-8b|^qwen-turbo/i],
  [4, /distill|math|-mt-|lite|7b/i],
]

function vendorStripped(id) {
  return String(id || '').replace(/^(kimi|zhipu|siliconflow|minimax|moonshotai|moonshot)\//i, '')
}

function classifyTier(id) {
  const s = vendorStripped(id)
  if (TIER_PRE4.test(s)) return 4
  for (const [tier, re] of TIER_RULES) if (re.test(s)) return tier
  return 3
}

/** 读 worker 的额度缓存：哪些模型"已知可用"（ok_until 未过期）。 */
function workerQuotaMap() {
  const out = {}
  try {
    const st = JSON.parse(fs.readFileSync(join(os.homedir(), 'bailian-free-auto', 'state.json'), 'utf8'))
    const now = Date.now() / 1000
    for (const [k, v] of Object.entries(st || {})) {
      if (!v || typeof v !== 'object') continue
      if ((v.ok_until || 0) > now) out[k] = 'ok'
      else if ((v.quota_until || 0) > now) out[k] = 'exhausted'
    }
  } catch {}
  return out
}

/**
 * 给出建议顺序。
 *   capability —— 旗舰优先（能力档位升序，档位内保原名序）
 *   cheap      —— 便宜/轻量优先（档位降序）
 *   quota      —— 已知还有免费额度的排前面，其余按能力档位
 */
function suggestOrder(route, mode, ids) {
  const list = Array.isArray(ids) && ids.length ? ids.slice() : (readProviderModelIds(route) || [])
  const quota = workerQuotaMap()
  const rank = (id) => {
    const tier = classifyTier(id)
    const q = quota[id] || quota[route + '::' + id] || 'unknown'
    if (mode === 'quota') return [q === 'ok' ? 0 : q === 'unknown' ? 1 : 2, tier, id]
    if (mode === 'cheap') return [-tier, q === 'ok' ? 0 : 1, id]
    return [tier, q === 'ok' ? 0 : 1, id]
  }
  return list.slice().sort((a, b) => {
    const ra = rank(a), rb = rank(b)
    for (let i = 0; i < ra.length; i++) {
      if (ra[i] < rb[i]) return -1
      if (ra[i] > rb[i]) return 1
    }
    return 0
  })
}

function apply(ctx) {
  const disposers = []

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_STATE,
    async handler(req, res) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return send(res, 405, { ok: false, error: 'use GET' })
      }
      try {
        send(res, 200, await snapshot(ctx))
      } catch (err) {
        send(res, 500, { ok: false, error: String((err && err.message) || err) })
      }
    },
  }))

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_ORDER,
    async handler(req, res) {
      if (req.method === 'GET' || req.method === 'HEAD') {
        return send(res, 200, { ok: true, order: readOrder(), orderFile: ORDER_FILE })
      }
      if (req.method !== 'PUT' && req.method !== 'POST') {
        return send(res, 405, { ok: false, error: 'use GET or PUT' })
      }
      let payload
      try {
        const text = await readBody(req)
        payload = text ? JSON.parse(text) : {}
      } catch (err) {
        return send(res, 400, { ok: false, error: 'body 不是合法 JSON: ' + String((err && err.message) || err) })
      }
      try {
        // { reset: true } 清空顺序，等于回到宿主默认
        const next = payload && payload.reset ? emptyOrder() : payload
        const saved = writeOrder(next)
        // installHooks(ctx)  // 同上：不再用文件顺序覆盖 settings 顺序
        return send(res, 200, { ok: true, order: saved, orderFile: ORDER_FILE })
      } catch (err) {
        return send(res, 500, { ok: false, error: String((err && err.message) || err) })
      }
    },
  }))

  // 读某提供方当前的模型条目（原样返回 id 顺序；不解析字段，重排由服务端做，避免丢字段）
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/' + name + '/provider-models',
    async handler(req, res) {
      try {
        const url = new URL(req.url, 'http://127.0.0.1')
        const route = url.searchParams.get('route') || ''
        if (!route) return send(res, 400, { ok: false, error: '需要 route 参数' })
        // ① 先在 settings 里找：declared = true 才可排序
        const declared = readProviderModelIds(route)
        if (declared) {
          return send(res, 200, { ok: true, route, declared: true, ids: declared,
                                  tiers: declared.map((id) => classifyTier(id)),
                                  quota: workerQuotaMap(), settingsFile: SETTINGS_FILE })
        }
        // ② 没声明（如内置路由 deepseek-official 走 llm-deepseek）：退回宿主 llm 的实时模型，只读展示
        const llm = resolveLlm(ctx)
        if (llm && typeof llm.listModels === 'function') {
          const models = await llm.listModels(route)
          const ids = (models || []).map((m) => (m && m.id) || '').filter(Boolean)
          if (ids.length) {
            return send(res, 200, { ok: true, route, declared: false, ids,
                                    tiers: ids.map((id) => classifyTier(id)),
                                    quota: workerQuotaMap(),
                                    note: '该路由的模型来自内置目录，未在 settings 里声明；此处只读展示，排序需先在模型目录里添加模型行' })
          }
        }
        return send(res, 200, { ok: true, route, declared: false, ids: [], tiers: [], quota: {},
                                note: '这个提供方当前没有可显示的模型' })
      } catch (err) {
        return send(res, 500, { ok: false, error: String((err && err.message) || err) })
      }
    },
  }))

  // 语义化排序建议：capability（旗舰优先）/ cheap（便宜优先）/ quota（有额度优先）
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/' + name + '/suggest',
    handler(req, res) {
      try {
        const url = new URL(req.url, 'http://127.0.0.1')
        const route = url.searchParams.get('route') || ''
        const mode = url.searchParams.get('mode') || 'capability'
        if (!route) return send(res, 400, { ok: false, error: '需要 route 参数' })
        return send(res, 200, { ok: true, route, mode, ids: suggestOrder(route, mode) })
      } catch (err) {
        return send(res, 500, { ok: false, error: String((err && err.message) || err) })
      }
    },
  }))

  // 写入顺序：文本块级重排 settings.yaml 里该提供方的 models 数组（原子写 + 备份）
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/' + name + '/settings-order',
    async handler(req, res) {
      if (req.method !== 'POST' && req.method !== 'PUT') {
        return send(res, 405, { ok: false, error: 'use POST' })
      }
      let payload
      try {
        const text = await readBody(req)
        payload = text ? JSON.parse(text) : {}
      } catch (err) {
        return send(res, 400, { ok: false, error: 'body 不是合法 JSON' })
      }
      const route = payload && payload.route
      if (!readProviderModelIds(route)) {
        return send(res, 400, { ok: false,
          error: '该路由的模型来自内置目录、未在 settings 里声明，无法排序；请先在模型目录里添加模型行' })
      }
      const result = reorderProviderModels(route, payload && payload.ids)
      return send(res, result.ok ? 200 : 400, result)
    },
  }))

  // 2026-09-10：**不再安装读时排序钩子**。
  // 顺序的唯一事实来源已改为 settings.yaml 里各提供方的 models 数组（由 /settings-order 写入），
  // 再挂一层"按 model-order.json 排序"就会出现两套顺序打架：设置页按 settings 渲染、选择器按钩子排序，
  // 用户会看到"拖了没反应"或"两处不一致"。钩子代码保留在此文件里备查，需要时手动恢复。
  // try { installHooks(ctx) } catch {}

  // ── 多密钥轮换代理（2026-09-11）────────────────────────────────────────────
  // 前缀路由：/dsh-model-priority/rotate/<token>/<route>/<rest...>
  disposers.push(ctx.webServer.register({
    kind: 'prefix',
    path: proxy.PROXY_PREFIX,
    handler: async (req, res) => {
      try {
        const url = new URL(req.url, 'http://127.0.0.1')
        const parts = url.pathname.slice(proxy.PROXY_PREFIX.length).replace(/^\/+/, '').split('/')
        const token = parts.shift() || ''
        const route = parts.shift() || ''
        const rest = parts.join('/')
        const cfg = proxy.loadConfig()
        if (!token || token !== cfg.token) {
          return send(res, 403, { ok: false, error: '代理 token 不符（应在 baseURL 里带上本机生成的 token）' })
        }
        if (!route || !rest) return send(res, 400, { ok: false, error: '路径应为 <token>/<route>/<rest>' })
        const providers = readProviders()
        const conf = providers[route]
        if (!conf || !conf.baseURL) {
          return send(res, 404, { ok: false, error: '提供方 ' + route + ' 没有可用的 baseURL' })
        }
        const upstream = conf.baseURL
        if (upstream.indexOf('/dsh-model-priority/rotate') >= 0) {
          return send(res, 400, { ok: false, error: '上游 baseURL 指向了代理自己，会打环' })
        }
        await proxy.forward(route, upstream, conf.apiKeyEnv, rest, req, res)
      } catch (err) {
        if (!res.headersSent) send(res, 500, { ok: false, error: String((err && err.message) || err) })
      }
    },
  }))

  // 代理状态（只报数量与冷却，不回显密钥）
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/' + name + '/proxy-status',
    handler: (req, res) => {
      try {
        const st = proxy.proxyStatus(readProviders())
        st.proxyBaseFor = Object.fromEntries(Object.entries(readProviders()).map(([r, c]) => {
          const cfg = proxy.loadConfig()
          return [r, 'http://127.0.0.1:3080' + proxy.PROXY_PREFIX + '/' + cfg.token + '/' + r]
        }))
        return send(res, 200, st)
      } catch (err) {
        return send(res, 500, { ok: false, error: String((err && err.message) || err) })
      }
    },
  }))

  // 一键开关：把某路由的 baseURL 指向代理 / 还原（都带 .bak 备份）
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/' + name + '/proxy-enable',
    async handler(req, res) {
      if (req.method !== 'POST' && req.method !== 'PUT') return send(res, 405, { ok: false, error: 'use POST' })
      let payload
      try { payload = JSON.parse((await readBody(req)) || '{}') } catch { return send(res, 400, { ok: false, error: 'body 不是合法 JSON' }) }
      const route = payload && payload.route
      const enable = payload && payload.enable !== false
      const providers = readProviders()
      if (!route || !providers[route]) return send(res, 400, { ok: false, error: 'route 不存在: ' + route })
      const cfg = proxy.loadConfig()
      try {
        if (enable) {
          const pool = proxy.keyPool(providers[route].apiKeyEnv)
          if (pool.length < 2) {
            return send(res, 400, { ok: false,
              error: '密钥池里只有 ' + pool.length + ' 把；先在 .credentials.yaml 里加 ' + providers[route].apiKeyEnv + '_2 等，再开代理' })
          }
          const value = 'http://127.0.0.1:3080' + proxy.PROXY_PREFIX + '/' + cfg.token + '/' + route
          cfg.routes[route] = Object.assign({ enabled: true }, cfg.routes[route] || {},
                                            { originalBaseURL: (cfg.routes[route] || {}).originalBaseURL || providers[route].baseURL })
          proxy.saveConfig(cfg)
          const r = proxy.setRouteBaseURL(SETTINGS_FILE, route, providerSpan, value)
          return send(res, r.ok ? 200 : 400, Object.assign({ ok: r.ok }, r))
        }
        const rec = cfg.routes[route] || {}
        if (!rec.originalBaseURL) return send(res, 400, { ok: false, error: '没有记录原始 baseURL，无法还原' })
        const r = proxy.setRouteBaseURL(SETTINGS_FILE, route, providerSpan, rec.originalBaseURL)
        cfg.routes[route] = Object.assign({}, rec, { enabled: false })
        proxy.saveConfig(cfg)
        return send(res, r.ok ? 200 : 400, Object.assign({ ok: r.ok }, r))
      } catch (err) {
        return send(res, 500, { ok: false, error: String((err && err.message) || err) })
      }
    },
  }))

  ctx.effect(() => () => {
    for (const d of disposers) {
      try { d() } catch {}
    }
  })
}

export { name, inject, apply }
// 便于不启动 dsh 直接验数据层（自检脚本用）
export const internals = { readOrder, writeOrder, sanitizeOrder, sortByOrder, emptyOrder, ORDER_FILE, DSH_HOME,
  SETTINGS_FILE, providerSpan, splitModels, readProviderModelIds, reorderProviderModels,
  classifyTier, suggestOrder, workerQuotaMap }
