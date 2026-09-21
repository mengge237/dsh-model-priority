// 服务端半边的端到端自检：用假 ctx（假 webServer + 假 llm）把两条路由真跑一遍。
// 不启动 dsh，也不碰真的 3080 端口。跑法：node test/server-routes.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'

// 必须在 import 插件之前设好 DSH_HOME：顺序文件路径是模块加载时算出来的。
process.env.DSH_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dmp-routes-'))

const mod = await import('../lib/index.js')

let passed = 0
async function ok(label, fn) {
  await fn()
  passed++
  console.log('  ok   ' + label)
}

/* ── 假宿主 ── */

function makeLlm() {
  return {
    listProviders() {
      return [{ id: 'p2', displayName: '提供方二' }, { id: 'p1', displayName: '提供方一' }]
    },
    async listModels(provider) {
      if (provider === 'p1') return [{ id: 'm2', name: '模型二' }, { id: 'm1', name: '模型一' }]
      return [{ id: 'x1', name: 'X1' }]
    },
    // 「设置 -> 模型」页读的是目录声明，id 字段叫 provider 而不是 id
    listConfigurableProviders() {
      return [
        { provider: 'p2', displayName: '目录二', settingsNs: 'ns2', settingsPath: ['a'] },
        { provider: 'p1', displayName: '目录一', settingsNs: 'ns1', settingsPath: ['b'] },
      ]
    },
  }
}

function makeCtx(llm) {
  const routes = new Map()
  const disposers = []
  return {
    routes,
    disposers,
    llm,
    webServer: {
      register(route) {
        routes.set(route.path, route)
        const d = () => routes.delete(route.path)
        disposers.push(d)
        return d
      },
    },
    effect(fn) {
      const d = fn()
      disposers.push(d)
      return d
    },
  }
}

// 把一个假的 req/res 喂给路由的 handler，拿回 { status, json, headers, raw }
// 默认带「本机页面同源」的那几个头；测跨站 / DNS 重绑定就显式覆盖（headers: null = 一个头都不带）。
async function call(route, { method = 'GET', body, headers, url } = {}) {
  const req = new Readable({ read() {} })
  req.method = method
  req.url = url || route.path
  req.headers = headers === null ? {} : Object.assign(
    { host: '127.0.0.1:3080', 'sec-fetch-site': 'same-origin' }, headers || {})
  if (body !== undefined) req.push(typeof body === 'string' ? body : JSON.stringify(body))
  req.push(null)

  let status = 0
  let raw = ''
  const res = {
    headers: null,
    writeHead(code, h) { status = code; this.headers = h || null; return this },
    end(text) { if (text) raw += text; return this },
  }
  await route.handler(req, res)
  let json = null
  try { json = raw ? JSON.parse(raw) : null } catch { json = { __unparsable: raw } }
  return { status, json, headers: res.headers, raw }
}

/* ── 跑 ── */

const llm = makeLlm()
const ctx = makeCtx(llm)
mod.apply(ctx)

const STATE = '/dsh-model-priority/state.json'
const ORDER = '/dsh-model-priority/order.json'

await ok('apply 之后八条路由都注册上了（排序三条 + 代理三条 + 状态/顺序两条）', () => {
  assert.ok(ctx.routes.has(STATE), STATE + ' 应该注册')
  assert.ok(ctx.routes.has(ORDER), ORDER + ' 应该注册')
  for (const extra of ['/dsh-model-priority/provider-models',
                       '/dsh-model-priority/suggest',
                       '/dsh-model-priority/settings-order',
                       '/dsh-model-priority/rotate',
                       '/dsh-model-priority/proxy-status',
                       '/dsh-model-priority/proxy-enable']) {
    assert.ok(ctx.routes.has(extra), extra + ' 应该注册')
  }
  assert.equal(ctx.routes.size, 8)
})

await ok('路由形状：精确路由都是 exact；只有多密钥轮换代理用 prefix；都不带尾斜杠', () => {
  for (const route of ctx.routes.values()) {
    if (route.path === '/dsh-model-priority/rotate') {
      assert.equal(route.kind, 'prefix', '代理要走前缀匹配（baseURL 后面还会拼 /chat/completions）')
    } else {
      assert.equal(route.kind, 'exact', route.path + ' 应该是 exact')
    }
    assert.ok(!route.path.endsWith('/'), route.path + ' 不该有尾斜杠')
    assert.equal(typeof route.handler, 'function')
  }
})

let first
await ok('GET state.json：目录与顺序都报出来，没顺序时保持宿主原顺序', async () => {
  first = await call(ctx.routes.get(STATE))
  assert.equal(first.status, 200)
  assert.equal(first.json.ok, true)
  assert.equal(first.json.hook.ok, true)
  assert.deepEqual(first.json.providers.map((p) => p.id), ['p2', 'p1'])
  assert.deepEqual(first.json.providers.map((p) => p.label), ['提供方二', '提供方一'])
  assert.deepEqual(first.json.models.p1.map((m) => m.id), ['m2', 'm1'])
  assert.deepEqual(first.json.order.providerOrder, [])
  assert.ok(first.json.orderFile.endsWith('model-order.json'))
})

await ok('PUT order.json：保存后立刻作用到 listProviders/listModels', async () => {
  const r = await call(ctx.routes.get(ORDER), {
    method: 'PUT',
    body: { version: 1, providerOrder: ['p1'], modelOrder: { p1: ['m1', 'm2'] } },
  })
  assert.equal(r.status, 200)
  assert.equal(r.json.ok, true)
  assert.deepEqual(r.json.order.providerOrder, ['p1'])

  assert.deepEqual(llm.listProviders().map((p) => p.id), ['p1', 'p2'])
  assert.deepEqual((await llm.listModels('p1')).map((m) => m.id), ['m1', 'm2'])
  // 没点名的提供方下面的模型顺序不受影响
  assert.deepEqual((await llm.listModels('p2')).map((m) => m.id), ['x1'])
})

await ok('顺序文件真的落到磁盘了，且是清洗过的形状', () => {
  const raw = JSON.parse(fs.readFileSync(first.json.orderFile, 'utf8'))
  assert.deepEqual(raw, { version: 1, providerOrder: ['p1'], modelOrder: { p1: ['m1', 'm2'] } })
})

await ok('GET state.json 此时报的是新顺序', async () => {
  const r = await call(ctx.routes.get(STATE))
  assert.deepEqual(r.json.providers.map((p) => p.id), ['p1', 'p2'])
  assert.deepEqual(r.json.models.p1.map((m) => m.id), ['m1', 'm2'])
})

await ok('PUT { reset: true } 清空顺序，回到宿主原顺序', async () => {
  const r = await call(ctx.routes.get(ORDER), { method: 'PUT', body: { reset: true } })
  assert.equal(r.json.ok, true)
  assert.deepEqual(r.json.order.providerOrder, [])
  assert.deepEqual(llm.listProviders().map((p) => p.id), ['p2', 'p1'])
  assert.deepEqual((await llm.listModels('p1')).map((m) => m.id), ['m2', 'm1'])
})

await ok('GET order.json 单独也能读', async () => {
  const r = await call(ctx.routes.get(ORDER))
  assert.equal(r.status, 200)
  assert.equal(r.json.ok, true)
  assert.deepEqual(r.json.order.providerOrder, [])
})

await ok('坏 JSON body 回 400，而不是 500 或崩溃', async () => {
  const r = await call(ctx.routes.get(ORDER), { method: 'PUT', body: '{ not json' })
  assert.equal(r.status, 400)
  assert.equal(r.json.ok, false)
})

await ok('不支持的方法回 405', async () => {
  const a = await call(ctx.routes.get(STATE), { method: 'POST' })
  assert.equal(a.status, 405)
  const b = await call(ctx.routes.get(ORDER), { method: 'DELETE' })
  assert.equal(b.status, 405)
})

await ok('名字与顺序里的垃圾条目被清洗掉（空串、非字符串、不存在的 id）', async () => {
  const r = await call(ctx.routes.get(ORDER), {
    method: 'PUT',
    body: { providerOrder: ['p1', '', null, 7, 'zzz'], modelOrder: { p1: ['m1', 0, ''] } },
  })
  assert.deepEqual(r.json.order.providerOrder, ['p1', 'zzz'])
  assert.deepEqual(r.json.order.modelOrder.p1, ['m1'])
  // 'zzz' 不在提供方列表里，不该凭空造出一个提供方
  assert.deepEqual(llm.listProviders().map((p) => p.id), ['p1', 'p2'])
})

await ok('listProviders 抛错时不把整个 state 带崩，而是记一条 note', async () => {
  const boomLlm = makeLlm()
  boomLlm.listProviders = () => { throw new Error('适配器炸了') }
  boomLlm.listModels = async () => { throw new Error('列举炸了') }
  const ctx2 = makeCtx(boomLlm)
  mod.apply(ctx2)
  const r = await call(ctx2.routes.get(STATE))
  assert.equal(r.status, 200)
  assert.equal(r.json.ok, true)
  assert.deepEqual(r.json.providers, [])
  assert.ok(r.json.notes.some((n) => n.includes('适配器炸了')), '应该记下 listProviders 的错')
})

await ok('没有 ctx.llm 时回 ok:true + hook.ok:false，而不是 500', async () => {
  const ctx3 = makeCtx(null)
  mod.apply(ctx3)
  const r = await call(ctx3.routes.get(STATE))
  assert.equal(r.status, 200)
  assert.equal(r.json.ok, true)
  assert.equal(r.json.llmAvailable, false)
  assert.equal(r.json.hook.ok, false)
  assert.ok(r.json.hook.reason.length > 0)
})

await ok('ctx.effect 收到的 disposer 能把所有路由都摘掉', () => {
  const ctx4 = makeCtx(makeLlm())
  mod.apply(ctx4)
  assert.equal(ctx4.routes.size, 8)
  // apply 自己不返回 disposer，摘除逻辑交给 ctx.effect(() => () => {...})，
  // 所以这里跑一遍收集到的 disposer，看路由是不是真的没了。
  assert.ok(ctx4.disposers.length >= 1, 'apply 应该往 ctx.effect 里注册过清理函数')
  for (const d of ctx4.disposers) {
    if (typeof d === 'function') d()
  }
  assert.equal(ctx4.routes.size, 0, '摘除后不该还留着路由')
})

await ok('listProviders 的替换是同步的（返回数组而不是 Promise）', () => {
  // 这是最要命的一条：宿主的 buildModelCatalog 同步调 listProviders()，
  // 一旦替换写成 async，它拿到 Promise，紧接着的 providers.map(...) 会抛
  // "providers.map is not a function"，模型选择对话框直接打不开。
  const got = llm.listProviders()
  assert.ok(Array.isArray(got), 'listProviders() 必须同步返回数组，实际拿到 ' + Object.prototype.toString.call(got))
  assert.equal(typeof got.then, 'undefined', '不能返回 thenable')
})

await ok('listConfigurableProviders 也按同一份顺序排（两个界面才一致）', async () => {
  await call(ctx.routes.get(ORDER), { method: 'PUT', body: { providerOrder: ['p1', 'p2'] } })
  const got = llm.listConfigurableProviders()
  assert.ok(Array.isArray(got), 'listConfigurableProviders() 也必须同步返回数组')
  assert.deepEqual(got.map((e) => e.provider), ['p1', 'p2'])
  // 条目本身一个字段都不能动
  assert.equal(got[0].displayName, '目录一')
  assert.deepEqual(got[0].settingsPath, ['b'])
  await call(ctx.routes.get(ORDER), { method: 'PUT', body: { reset: true } })
})

await ok('重复 apply 不会套第二层挂钩（幂等）', () => {
  const llm5 = makeLlm()
  const ctx5 = makeCtx(llm5)
  mod.apply(ctx5)
  const first = llm5.listProviders
  const firstModels = llm5.listModels
  mod.apply(ctx5)
  assert.equal(llm5.listProviders, first, 'listProviders 不该被再包一层')
  assert.equal(llm5.listModels, firstModels, 'listModels 不该被再包一层')
})

// ── 模型顺序：设置页排序能力的核心逻辑（2026-09-10 加）──────────────────────
const FIXTURE = [
  'llm-pi-ai:',
  '  providers:',
  '    demo:',
  '      models:',
  '        # 这是列表级注释，重排后必须仍然在场',
  '        - id: alpha',
  '          name: Alpha 显示名',
  '          contextWindow: 128000',
  '        - id: beta',
  '          name: Beta 显示名',
  '        - id: gamma',
  '          name: Gamma 显示名',
  '          maxTokens: 4096',
  'agent-default-model:',
  '  provider: demo',
  '  model: alpha',
  '',
].join(String.fromCharCode(10))

await ok('重排：顺序变了，字段一个不少，列表级注释仍在', () => {
  fs.writeFileSync(mod.internals.SETTINGS_FILE, FIXTURE, 'utf8')
  assert.deepEqual(mod.internals.readProviderModelIds('demo'), ['alpha', 'beta', 'gamma'])
  const r = mod.internals.reorderProviderModels('demo', ['gamma', 'alpha', 'beta'])
  assert.equal(r.ok, true)
  assert.deepEqual(r.ids, ['gamma', 'alpha', 'beta'])
  const after = fs.readFileSync(mod.internals.SETTINGS_FILE, 'utf8')
  assert.deepEqual(mod.internals.readProviderModelIds('demo'), ['gamma', 'alpha', 'beta'])
  for (const needle of ['name: Alpha 显示名', 'contextWindow: 128000', 'maxTokens: 4096',
                        'name: Beta 显示名', 'name: Gamma 显示名', '# 这是列表级注释']) {
    assert.ok(after.indexOf(needle) >= 0, '重排后丢了：' + needle)
  }
  assert.ok(after.indexOf('agent-default-model') >= 0, '其它段不能被碰')
})

await ok('重排：未提到的模型保留在后面，未知 id 回报但不报错', () => {
  fs.writeFileSync(mod.internals.SETTINGS_FILE, FIXTURE, 'utf8')
  const r = mod.internals.reorderProviderModels('demo', ['beta', '不存在的模型'])
  assert.equal(r.ok, true)
  assert.deepEqual(r.ids, ['beta', 'alpha', 'gamma'])
  assert.deepEqual(r.unknown, ['不存在的模型'])
})

await ok('重排：非法入参与不存在的提供方都被拒，且不改文件', () => {
  fs.writeFileSync(mod.internals.SETTINGS_FILE, FIXTURE, 'utf8')
  assert.equal(mod.internals.reorderProviderModels('demo', 'not-an-array').ok, false)
  assert.equal(mod.internals.reorderProviderModels('nope', ['alpha']).ok, false)
  assert.equal(fs.readFileSync(mod.internals.SETTINGS_FILE, 'utf8'), FIXTURE)
})

await ok('语义化排序：三模式不增删模型；档位规则与 worker 同源', () => {
  fs.writeFileSync(mod.internals.SETTINGS_FILE, FIXTURE, 'utf8')
  for (const mode of ['capability', 'cheap', 'quota']) {
    const ids = mod.internals.suggestOrder('demo', mode)
    assert.deepEqual(ids.slice().sort(), ['alpha', 'beta', 'gamma'], mode + ' 不该增删模型')
  }
  assert.equal(mod.internals.classifyTier('glm-5.2'), 1)
  assert.equal(mod.internals.classifyTier('qwen-flash-2025-07-28'), 3)
  assert.equal(mod.internals.classifyTier('qwen-mt-flash'), 4)
})

await ok('页面新增的空 id 条目也参与排序且不丢（合成 id __unnamed_<原下标>）', () => {
  const fx = [
    'llm-pi-ai:',
    '  providers:',
    '    demo:',
    '      models:',
    '        - id: alpha',
    '          name: Alpha',
    '        - id:',
    '        - id: beta',
    '          name: Beta',
    '',
  ].join(String.fromCharCode(10))
  fs.writeFileSync(mod.internals.SETTINGS_FILE, fx, 'utf8')
  const before = mod.internals.readProviderModelIds('demo')
  assert.deepEqual(before, ['alpha', '__unnamed_1', 'beta'])
  const r = mod.internals.reorderProviderModels('demo', [before[2], before[0], before[1]])
  assert.equal(r.ok, true)
  const after = fs.readFileSync(mod.internals.SETTINGS_FILE, 'utf8')
  assert.deepEqual(mod.internals.readProviderModelIds('demo'), ['beta', 'alpha', '__unnamed_2'])
  const unnamedStillThere = after.split(String.fromCharCode(10)).some((l) => l.trim() === '- id:')
  assert.ok(unnamedStillThere, '空 id 条目必须仍在')
  assert.ok(after.indexOf('name: Beta') >= 0 && after.indexOf('name: Alpha') >= 0, '字段不能丢')
})


/* ── 浏览器信任栅栏（2026-09-21 加）────────────────────────────────────────── */

const proxyMod = await import('../lib/proxy.js')
const CROSS = { host: '127.0.0.1:3080', origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }

await ok('响应里不再有 Access-Control-Allow-Origin', async () => {
  for (const path of [STATE, ORDER]) {
    const got = await call(ctx.routes.get(path))
    assert.equal(got.status, 200, path)
    assert.ok(got.headers, path + ' 应该有响应头')
    assert.equal(got.headers['Access-Control-Allow-Origin'], undefined, path + ' 不该再带跨域头')
    assert.equal(got.headers['access-control-allow-origin'], undefined, path + ' 不该再带跨域头')
  }
})

await ok('跨站请求（sec-fetch-site: cross-site + 外部 Origin）一律 403', async () => {
  const cases = [
    [STATE, { method: 'GET' }],
    [ORDER, { method: 'PUT', body: { providerOrder: ['p1'] } }],
    ['/dsh-model-priority/provider-models', { method: 'GET' }],
    ['/dsh-model-priority/suggest', { method: 'GET' }],
    ['/dsh-model-priority/settings-order', { method: 'POST', body: { route: 'demo', ids: [] } }],
    ['/dsh-model-priority/proxy-status', { method: 'GET' }],
    ['/dsh-model-priority/proxy-enable', { method: 'POST', body: { route: 'demo' } }],
  ]
  for (const [path, opts] of cases) {
    const got = await call(ctx.routes.get(path), Object.assign({}, opts, { headers: CROSS }))
    assert.equal(got.status, 403, path + ' 跨站应该 403，实际 ' + got.status)
    assert.equal(got.json.ok, false, path)
  }
})

await ok('DNS 重绑定（Host 不是 loopback）403；宿主登记的权威放行', async () => {
  const rebound = await call(ctx.routes.get(STATE), { headers: { host: 'evil.example' } })
  assert.equal(rebound.status, 403)
  assert.equal((await call(ctx.routes.get(STATE), { headers: null })).status, 403, '连 Host 都没有也该拒')

  const ctxHost = makeCtx(makeLlm())
  ctxHost.get = (k) => (k === 'webRuntime' ? { trustedHosts: ['dsh.example:8443'] } : undefined)
  mod.apply(ctxHost)
  const listed = await call(ctxHost.routes.get(STATE), { headers: { host: 'dsh.example:8443' } })
  assert.equal(listed.status, 200, '宿主自己登记的权威应当放行')
  const listedWrongPort = await call(ctxHost.routes.get(STATE), { headers: { host: 'dsh.example:9999' } })
  assert.equal(listedWrongPort.status, 403, '端口对不上的权威不放行')
})

await ok('Origin 与 Host 同一个主机名才放行（端口不同也放行，Edge 会漏端口）', async () => {
  assert.equal((await call(ctx.routes.get(STATE), { headers: { origin: 'http://evil.example' } })).status, 403)
  assert.equal((await call(ctx.routes.get(STATE), { headers: { origin: 'http://127.0.0.1:3080' } })).status, 200)
  assert.equal((await call(ctx.routes.get(STATE), { headers: { host: 'localhost:3080', origin: 'http://localhost:3080' } })).status, 200)
  assert.equal((await call(ctx.routes.get(STATE), { headers: { origin: 'null' } })).status, 403, 'sandboxed iframe 的 null 源要拒')
})

await ok('proxy-status 不回显 token，只给占位模板与配置文件位置', async () => {
  const cfg = proxyMod.loadConfig()   // 没有配置文件时这一步会生成一份带 token 的
  assert.ok(typeof cfg.token === 'string' && cfg.token.length >= 16, '配置文件里应该有 token')
  const got = await call(ctx.routes.get('/dsh-model-priority/proxy-status'))
  assert.equal(got.status, 200)
  assert.equal(got.json.proxyBaseFor, undefined, '不该再逐 route 回显带 token 的 baseURL')
  assert.ok(String(got.json.proxyBaseTemplate).includes('<token>'), '只给字面占位')
  assert.ok(got.raw.indexOf(cfg.token) < 0, '响应体里不许出现真 token')
  assert.ok(String(got.json.proxyFile).endsWith('model-priority-proxy.json'))
})

await ok('rotate 前缀不套这道闸，仍然只认路径里的 token', async () => {
  const got = await call(ctx.routes.get('/dsh-model-priority/rotate'), {
    method: 'POST', url: '/dsh-model-priority/rotate/wrong-token/demo/chat/completions',
    body: '{}', headers: CROSS,
  })
  assert.equal(got.status, 403)
  assert.ok(String(got.json.error).includes('token'), '403 该来自 token 校验而不是栅栏：' + got.raw)
})

console.log('\n' + passed + ' 项全过')
