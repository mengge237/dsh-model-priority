// 读侧失败态回归：0.2.2 之前，/provider-models 一报错标题就永远停在「读取中…」，
// 因为失败只 setErr，而错误正文只在展开后才渲染。这里用假 react 真跑一遍组件，
// 验三件事：fetch 被拒 → 标题「读取失败」；ok:false → 标题「读取失败」并带悬停原因；成功 → 「N 个模型」。
// 跑法：node --test test/client-failure-state.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const src = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const flush = () => new Promise((r) => setImmediate(r))

/** 用给定 fetch 跑一遍组件：首帧跑 effect，之后由 setState 触发重绘（不再有第二次 effect）。 */
async function mount(fetchImpl) {
  let captured = null
  const sandbox = {
    window: { __ModuleLoader__: { load(spec) { captured = spec } } },
    console, Symbol, Object, Array, Promise, Error, JSON, String, Number, Math, Map, Set,
    setTimeout, clearTimeout, encodeURIComponent, fetch: fetchImpl,
  }
  vm.createContext(sandbox)
  vm.runInContext(src, sandbox, { filename: 'lib/client.js' })

  const hooks = []
  let cursor = 0
  let effects = []
  let busy = false
  let renders = 0
  let last = null
  let Component = null

  const react = {
    createElement(type, props, ...children) {
      return { type, props: props || {}, children: children.flat(Infinity) }
    },
    useState(init) {
      const i = cursor++
      if (!(i in hooks)) hooks[i] = typeof init === 'function' ? init() : init
      const set = (v) => {
        hooks[i] = typeof v === 'function' ? v(hooks[i]) : v
        if (!busy && renders < 12) { renders++; last = paint(false) }
      }
      return [hooks[i], set]
    },
    useCallback: (f) => f,
    useEffect(fn) { effects.push(fn) },
  }

  function paint(withEffects) {
    cursor = 0
    effects = []
    busy = true
    try {
      const el = Component({
        provider: { provider: 'bailian', settingsNs: 'llm-pi-ai' },
        hostCtx: { remote: { settings: null } },
      })
      if (withEffects) for (const fn of effects) { fn() }
      return el
    } finally { busy = false }
  }

  const mod = captured.factory((name) => {
    if (name === 'react') return react
    throw new Error('不该 require: ' + name)
  })
  mod.apply({
    slots: {
      inject(nm, cb) { cb(); return () => {} },
      register(spec, C) { if (spec.key === 'llm-pi-ai') Component = C; return () => {} },
    },
  })

  renders = 1
  last = paint(true)
  await flush(); await flush(); await flush()

  const texts = []
  const walk = (n) => {
    if (typeof n === 'string' || typeof n === 'number') { texts.push(String(n)); return }
    if (!n || typeof n !== 'object') return
    if (n.props && n.props.title) texts.push('title:' + n.props.title)
    if (Array.isArray(n.children)) n.children.forEach(walk)
  }
  walk(last)
  return { text: texts.join(' | '), renders }
}

test('fetch 被拒：标题落回「读取失败」，不再停在「读取中…」', async () => {
  const { text, renders } = await mount(() => Promise.reject(new Error('network down')))
  assert.ok(renders > 1, '失败应当触发重绘，实际渲染次数 ' + renders)
  assert.match(text, /读取失败/, '失败要在标题上看得见：' + text)
  assert.doesNotMatch(text, /读取中/, '标题不该继续写「读取中…」：' + text)
})

test('路由回 ok:false：标题落回「读取失败」，悬停能看到原因', async () => {
  const { text } = await mount(() => Promise.resolve({ json: () => Promise.resolve({ ok: false, error: '真源里没有这个提供方' }) }))
  assert.match(text, /读取失败/, 'ok:false 也要上标题：' + text)
  assert.match(text, /title:真源里没有这个提供方/, '悬停要能看到原因：' + text)
})

test('读到正常数据：标题显示模型条数，不显示失败', async () => {
  const body = { ok: true, route: 'bailian', declared: true, ids: ['a', 'b'], tiers: [3, 3], quota: {} }
  const { text } = await mount(() => Promise.resolve({ json: () => Promise.resolve(body) }))
  assert.match(text, /2 个模型/, '成功后要写实际条数：' + text)
  assert.doesNotMatch(text, /读取失败/, '成功时不该显失败：' + text)
  assert.doesNotMatch(text, /读取中/, '成功后不该还停在读取中：' + text)
})
