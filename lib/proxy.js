/* ============================================================================
 * 多密钥轮换代理（2026-09-11 加，用户要求「一个模型容器多把 API / 多把密钥轮换」）
 *
 * 背景：DSH 的 provider profile 只有一个 apiKeyEnv，一把密钥。想让同一路由持有多把密钥
 * 并在限流/额度尽时自动换，官方还没有这个能力（另按上游规制提 Discussion）。
 * 就地可行的办法：provider 的 baseURL 指向本插件在本机起的转发端点，由它按池轮换密钥。
 *
 *   settings: providers.<route>.baseURL = http://127.0.0.1:3080/dsh-model-priority/rotate/<token>/<route>
 *   本插件把 <route>/<rest> 转发到真实 baseURL + /<rest>，Authorization 换成池里的下一把。
 *
 * 设计要点：
 *   - **token 必需**：插件路由不走浏览器鉴权，若开放转发，本机任何进程都能拿你的密钥刷额度。
 *     所以路径里带一个 32 字节随机 token（存在 ~/.dsh/model-priority-proxy.json），不知道 token 一律 403。
 *   - **流式透传**：SSE 不缓冲（宿主 webserver 的压缩中间件本身也跳过 text/event-stream）。
 *   - **只在开始前重试**：响应状态码判定失败才换密钥重试；一旦开始向客户端写就当成功，不中途换。
 *   - **一键回滚**：enable 时把原 baseURL 记进配置文件；disable 时原样写回（都带 .bak 备份）。
 *   - **密钥不入日志**：状态口只报密钥数量与冷却时间，绝不回显密钥内容。
 * ========================================================================== */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { randomBytes } from 'node:crypto'

const PROXY_FILE = path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'model-priority-proxy.json')
const CRED_FILE = path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), '.credentials.yaml')
const PROXY_PREFIX = '/dsh-model-priority/rotate'

/** 读配置文件（没有就建一份带 token 的）。 */
function loadConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(PROXY_FILE, 'utf8'))
    if (c && typeof c.token === 'string' && c.token.length >= 16) return c
  } catch {}
  const fresh = { version: 1, token: randomBytes(24).toString('hex'), routes: {} }
  saveConfig(fresh)
  return fresh
}

function saveConfig(c) {
  fs.mkdirSync(path.dirname(PROXY_FILE), { recursive: true })
  const tmp = PROXY_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(c, null, 2) + '\n', 'utf8')
  fs.renameSync(tmp, PROXY_FILE)
}

/** 从 .credentials.yaml 里取某 route 的密钥池：<ENV>、<ENV>_2.._9、以及 <ENV 去掉 _KEY>_KEYS（逗号/换行分隔）。 */
function keyPool(apiKeyEnv) {
  if (!apiKeyEnv) return []
  let text = ''
  try { text = fs.readFileSync(CRED_FILE, 'utf8') } catch { return [] }
  const m = text.match(/^refs:\s*$/m)
  const refs = {}
  if (m) {
    const re = new RegExp('^(\\s*)([A-Za-z0-9_]+):\\s*(.+)$', 'gm')
    let mm
    const tail = text.slice(m.index + m[0].length)
    while ((mm = re.exec(tail)) !== null) {
      let v = mm[3].trim()
      if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[0] === v[v.length - 1]) v = v.slice(1, -1)
      refs[mm[2]] = v
    }
  }
  const out = []
  const push = (v) => { if (typeof v === 'string' && v && out.indexOf(v) < 0) out.push(v) }
  push(refs[apiKeyEnv])
  for (let i = 2; i <= 9; i++) push(refs[apiKeyEnv + '_' + i])
  const plural = apiKeyEnv.replace(/_KEY$/, '') + '_KEYS'
  push(refs[plural])
  if (refs[plural]) {
    for (const part of String(refs[plural]).split(/[\n,;]+/)) push(part.trim())
  }
  return out
}

/* ── 轮换状态（内存，重启即清）───────────────────────────────────────────── */
const cooldown = new Map()   // 'route\u0000index' -> until(ms)
const stats = { requests: 0, rotations: 0, perRoute: {} }

function routeStats(route) {
  const s = stats.perRoute[route] || (stats.perRoute[route] = { requests: 0, rotations: 0, keys: 0 })
  return s
}

function isCooled(route, i) {
  const until = cooldown.get(route + '\u0000' + i) || 0
  return until > Date.now()
}

function markCooldown(route, i, ms) {
  cooldown.set(route + '\u0000' + i, Date.now() + ms)
}

/** 取下一把可用密钥的下标：跳过冷却中的；全在冷却里就选最早解冻的那把。 */
function pickIndex(route, count) {
  for (let i = 0; i < count; i++) if (!isCooled(route, i)) return i
  let best = 0
  let bestUntil = Infinity
  for (let i = 0; i < count; i++) {
    const until = cooldown.get(route + '\u0000' + i) || 0
    if (until < bestUntil) { bestUntil = until; best = i }
  }
  return best
}

function failureKind(status, bodyText) {
  const low = String(bodyText || '').toLowerCase()
  if (status === 429) {
    if (low.indexOf('token-limit') >= 0 || low.indexOf('rate limit') >= 0 || low.indexOf('throttl') >= 0) return 'rate'
    if (low.indexOf('quota') >= 0 || low.indexOf('exhaust') >= 0) return 'quota'
    return 'rate'
  }
  if (status === 401) return 'auth'
  if (status === 403) {
    if (low.indexOf('quota') >= 0 || low.indexOf('exhaust') >= 0) return 'quota'
    return 'auth'
  }
  return null
}

const COOLDOWN_MS = { rate: 60_000, quota: 60 * 60_000, auth: 5 * 60_000 }

async function readBody(req, limit = 8 * 1024 * 1024) {
  const chunks = []
  let size = 0
  for await (const c of req) {
    size += c.length
    if (size > limit) throw new Error('请求体过大')
    chunks.push(c)
  }
  return Buffer.concat(chunks)
}

/** 真正的转发：池内轮换，失败才重试；成功后流式透传。 */
async function forward(route, upstreamBase, apiKeyEnv, rest, req, res) {
  const pool = keyPool(apiKeyEnv)
  const st = routeStats(route)
  st.keys = pool.length
  if (!pool.length) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: '没有可用密钥：请在 .credentials.yaml 里为 ' + apiKeyEnv + ' 配置至少一把' }))
    return
  }
  let body
  try { body = await readBody(req) } catch (err) {
    res.writeHead(413, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: String((err && err.message) || err) }))
    return
  }

  const url = upstreamBase.replace(/\/+$/, '') + '/' + rest
  const tries = pool.length
  let lastStatus = 502
  let lastText = ''

  for (let n = 0; n < tries; n++) {
    const idx = pickIndex(route, pool.length)
    const headers = { 'Content-Type': req.headers['content-type'] || 'application/json' }
    if (req.headers['accept']) headers['Accept'] = req.headers['accept']
    headers['Authorization'] = 'Bearer ' + pool[idx]
    if (body.length) headers['Content-Length'] = String(body.length)

    let up
    try {
      up = await fetch(url, { method: req.method, headers: headers,
                              body: (req.method === 'GET' || req.method === 'HEAD') ? undefined : body })
    } catch (err) {
      lastStatus = 502
      lastText = String((err && err.message) || err)
      markCooldown(route, idx, 10_000)
      continue
    }

    if (up.status >= 400) {
      const text = await up.text().catch(() => '')
      const kind = failureKind(up.status, text)
      if (kind) {
        markCooldown(route, idx, COOLDOWN_MS[kind] || 60_000)
        stats.rotations++
        st.rotations++
        lastStatus = up.status
        lastText = text.slice(0, 300)
        continue                      // 换下一把重试（此时还没向客户端写任何东西）
      }
      res.writeHead(up.status, { 'Content-Type': up.headers.get('content-type') || 'application/json' })
      res.end(text)
      return
    }

    // 成功：流式透传
    const outHeaders = {}
    for (const h of ['content-type', 'cache-control', 'x-request-id']) {
      const v = up.headers.get(h)
      if (v) outHeaders[h] = v
    }
    st.requests++
    stats.requests++
    res.writeHead(up.status, outHeaders)
    if (!up.body) { res.end(); return }
    Readable.fromWeb(up.body).pipe(res)
    return
  }

  res.writeHead(lastStatus === 502 ? 502 : 429, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: '所有密钥都不可用（已轮换 ' + tries + ' 把）',
                           lastStatus: lastStatus, last: lastText.slice(0, 200) }))
}

/** 状态：只报数量与冷却，绝不回显密钥。 */
function proxyStatus(providers) {
  const cfg = loadConfig()
  const rows = []
  for (const [route, conf] of Object.entries(providers || {})) {
    const env = conf && conf.apiKeyEnv
    const pool = keyPool(env)
    const cooled = []
    for (let i = 0; i < pool.length; i++) {
      const until = cooldown.get(route + '\u0000' + i) || 0
      if (until > Date.now()) cooled.push({ index: i, secondsLeft: Math.round((until - Date.now()) / 1000) })
    }
    rows.push({ route: route, apiKeyEnv: env, keys: pool.length, cooled: cooled,
                stats: routeStats(route), enabled: !!(cfg.routes[route] && cfg.routes[route].enabled),
                originalBaseURL: (cfg.routes[route] || {}).originalBaseURL || null })
  }
  return { ok: true, tokenPresent: !!cfg.token, proxyPrefix: PROXY_PREFIX, routes: rows }
}

/**
 * 把某 route 的 baseURL 指向本地代理（或还原）。文本级改写 settings.yaml，带 .bak 备份。
 * @returns {{ok:boolean, baseURL?:string, backup?:string, error?:string}}
 */
function setRouteBaseURL(settingsFile, route, providerSpan, value) {
  const text = fs.readFileSync(settingsFile, 'utf8')
  const lines = text.split('\n')
  const span = providerSpan(lines, route)
  if (!span) return { ok: false, error: '找不到提供方 ' + route }
  let hit = -1
  for (let i = span.start; i < span.end; i++) {
    if (/^\s+baseURL:\s*\S/.test(lines[i])) { hit = i; break }
  }
  if (hit < 0) return { ok: false, error: '该提供方没有显式 baseURL（走内置目录），无法改指向' }
  const old = lines[hit]
  const indent = old.match(/^\s*/)[0]
  lines[hit] = indent + 'baseURL: ' + value
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backup = settingsFile + '.bak-proxy-' + stamp
  fs.copyFileSync(settingsFile, backup)
  const tmp = settingsFile + '.tmp'
  fs.writeFileSync(tmp, lines.join('\n'), 'utf8')
  fs.renameSync(tmp, settingsFile)
  return { ok: true, baseURL: value, backup: backup, previous: old.trim() }
}

export { PROXY_PREFIX, PROXY_FILE, loadConfig, saveConfig, keyPool, pickIndex, isCooled, markCooldown,
         failureKind, forward, proxyStatus, setRouteBaseURL, stats, cooldown }
