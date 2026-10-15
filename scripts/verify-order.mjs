// 三方校验（物理改序的验收闸）—— 2026-10-15 随「排序要经得起三种以上校验」的要求加。
// 用法：
//   node scripts/verify-order.mjs snapshot              # 记一次基准（写 ~/.dsh/model-priority-verify.json）
//   node scripts/verify-order.mjs check [--port 3080]  # 三方对账：①各 profile 层读回逐位一致 ②活动宿主实时路由一致 ③与快照比对=重启后仍在
//   第四方（人眼）：GUI 模型选择器/设置页顺序 —— 脚本末尾会打印提示。
// 退出码：0 全对 / 1 有红 / 2 读不出来（缺真源、宿主没起等）
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'

const mode = process.argv[2]
const portIdx = process.argv.indexOf('--port')
const PORT = portIdx > 0 ? process.argv[portIdx + 1] : '3080'
const DSH_HOME = process.env.DSH_HOME || join(os.homedir(), '.dsh')
const SNAP = join(DSH_HOME, 'model-priority-verify.json')
const I = (await import(pathToFileURL(join(process.cwd(), 'lib', 'index.js')).href)).internals

function layerOrders() {
  const out = {}
  for (const layer of I.listProfileLayers()) {
    const norm = I.normalizeProfileProviders(layer.text)
    if (!norm) continue
    const lines = norm.split('\n')
    const provs = {}
    for (const route of Object.keys(I.readProviders())) {
      const span = I.providerSpan(lines, route)
      if (!span) continue
      const parsed = I.splitModels(lines, span)
      if (parsed) provs[route] = parsed.entries.map((e, i) => e.id || ('__unnamed_' + i))
    }
    out[layer.name] = provs
  }
  return out
}

async function liveOrders() {
  const res = await fetch(`http://127.0.0.1:${PORT}/dsh-model-priority/state.json`, {
    headers: { Origin: `http://127.0.0.1:${PORT}` },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error('state.json HTTP ' + res.status)
  return await res.json()
}

if (mode === 'snapshot') {
  const layers = layerOrders()
  if (!Object.keys(layers).length) { console.log('RED：找不到任何带 llm-pi-ai 的 profile 层'); process.exit(2) }
  let live = null
  try { live = await liveOrders() } catch (e) { live = { error: String(e && e.message || e) } }
  writeFileSync(SNAP, JSON.stringify({ at: new Date().toISOString(), layers, live }, null, 2), 'utf8')
  console.log('基准已写：' + SNAP)
  console.log('下次重启宿主后跑：node scripts/verify-order.mjs check')
  process.exit(0)
}

if (mode !== 'check') { console.log('用法：snapshot | check [--port 3080]'); process.exit(2) }

const layers = layerOrders()
const names = Object.keys(layers)
if (!names.length) { console.log('RED：找不到真源层'); process.exit(2) }
let fails = 0
console.log('① 各 profile 层互相对账（逐位比较）')
const routes = [...new Set(names.flatMap((n) => Object.keys(layers[n])))]
for (const route of routes) {
  const seqs = names.map((n) => (layers[n][route] || []).join('|'))
  const same = seqs.every((s) => s === seqs[0])
  console.log((same ? '  ok  ' : '  RED ') + route + (same ? '' : ' -> ' + JSON.stringify(names.map((n, i) => [n, seqs[i].slice(0, 60)]))))
  if (!same) fails++
}
console.log('② 活动宿主实时对账（GET /dsh-model-priority/state.json @' + PORT + '）')
let live
try { live = await liveOrders() } catch (e) { console.log('  读不出来：' + (e && e.message) + '（宿主没起？这条先算黄）'); fails++ }
if (live) {
  const webOrder = (layers[I.RT.profile || 'web'] || layers[names[0]])
  for (const [route, ids] of Object.entries(webOrder || {})) {
    const liveIds = live.models && live.models[route] ? live.models[route].map((m) => m.id) : null
    if (!liveIds) continue
    const eq = liveIds.length === ids.length && liveIds.every((x, i) => x === ids[i])
    console.log((eq ? '  ok  ' : '  RED ') + route)
    if (!eq) { console.log('    层: ' + ids.join(',')); console.log('    活: ' + liveIds.join(',')); fails++ }
  }
  const dm = live.defaultModel
  console.log('  默认模型读数: ' + (dm ? dm.provider + '/' + dm.model : '（宿主没带 defaultModel 字段——服务端半边还没重启过？）'))
  if (live.hook && live.hook.ok === false) { console.log('  RED 排序钩子没挂上：' + live.hook.reason); fails++ }
}
console.log('③ 与快照对账（重启后仍在）')
if (existsSync(SNAP)) {
  const snap = JSON.parse(readFileSync(SNAP, 'utf8'))
  for (const [n, provs] of Object.entries(snap.layers || {})) {
    for (const [route, ids] of Object.entries(provs)) {
      const cur = (layers[n] && layers[n][route]) || null
      const eq = cur && cur.join('|') === ids.join('|')
      console.log((eq ? '  ok  ' : '  RED ') + n + '/' + route)
      if (!eq) fails++
    }
  }
  console.log('  （快照时刻：' + snap.at + '）')
} else { console.log('  无快照 —— 先跑 snapshot 再验 ③') }
console.log('④ 人眼：设置→模型 的模型选择器/卡片顺序应与此一致（刷新页面看一眼）')
console.log(fails ? `RESULT: ${fails} 项红` : 'RESULT: 全对')
process.exit(fails ? 1 : 0)
