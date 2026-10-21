// 浏览器侧半边的冒烟自检：不启浏览器，用假 window.__ModuleLoader__ 与假 react
// 把 bundle 跑一遍，验模块 id、inject、registerTab 的描述符形状。
// 跑法：node test/client-smoke.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const src = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

let passed = 0
function ok(label, fn) {
  fn()
  passed++
  console.log('  ok   ' + label)
}

let captured = null
const sandbox = {
  window: { __ModuleLoader__: { load(spec) { captured = spec } } },
  console,
  Symbol,
  Object,
  Array,
  Promise,
  Error,
  JSON,
  String,
  Number,
  Math,
}
vm.createContext(sandbox)
vm.runInContext(src, sandbox, { filename: 'lib/client.js' })

ok('bundle 顶部就调用了宿主的 window.__ModuleLoader__.load', () => {
  assert.ok(captured, 'client.js 应该调用 window.__ModuleLoader__.load')
  assert.equal(captured.id, 'dsh-model-priority')
  assert.equal(typeof captured.factory, 'function')
})

// 假 react：只要 createElement 与几个 hook 的形状对得上就够跑注册路径了
const react = {
  createElement(type, props) {
    const children = Array.prototype.slice.call(arguments, 2)
    return { type, props, children }
  },
  useRef: (v) => ({ current: v }),
  useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
  useCallback: (f) => f,
  useEffect: () => {},
}

let mod
ok('factory 只向宿主 require react，别的包一概不碰', () => {
  const asked = []
  mod = captured.factory((name) => {
    asked.push(name)
    if (name === 'react') return react
    throw new Error('不该 require 这个包: ' + name)
  })
  // require 是懒的，模块体里只会在 factory 执行时发生
  for (const name of asked) assert.equal(name, 'react', '只允许 require react，实际要了 ' + name)
})

ok('导出 apply 与 inject 两个符号', () => {
  assert.equal(typeof mod.apply, 'function')
  // vm 里造出来的数组属于另一个 realm，deepStrictEqual 会连原型一起比，
  // 所以先摊平回本 realm 再断言。
  assert.deepEqual([...mod.inject], ['slots'])
})

const seats = []
const tabs = []

function makeSlots(injectNames, options) {
  const opts = options || {}
  return {
    entriesOfSlot() { return opts.occupied ? [{ options: { key: 'llm-pi-ai' } }] : [] },
    inject(nm, cb) {
      injectNames.push(nm)
      if (opts.throwOn === nm) throw new Error('no slot: ' + nm)
      cb()
      return () => {}
    },
    register(spec, Component) { seats.push({ spec, Component }); return () => {} },
  }
}

ok('pi-ai 卡片格已被占用：DeepSeek 卡片 + 原生设置分区（兼容入口）', () => {
  const injectNames = []
  const dispose = mod.apply({ slots: makeSlots(injectNames, { occupied: true }) })
  assert.equal(typeof dispose, 'function', 'apply 要返回 disposer')
  assert.deepEqual(injectNames, ['settings.models.provider-card', 'settings.section'],
    'DeepSeek 卡片格 + 兼容用设置分区')
  const cards = seats.filter((s) => s.spec.name === 'settings.models.provider-card')
  assert.deepEqual(cards.map((s) => s.spec.key), ['llm-deepseek'],
    '不抢已被占用的 llm-pi-ai 卡片格')
  const section = seats.filter((s) => s.spec.name === 'settings.section')
  assert.equal(section.length, 1, '设置分区只注册一次')
  assert.equal(section[0].spec.id, 'model-priority')
  assert.equal(section[0].spec.order, 55)
  assert.equal(tabs.length, 0, '侧边栏入口已撤')
})

ok('pi-ai 卡片格空闲：直接挂卡片格，不新增设置分区', () => {
  seats.length = 0
  const injectNames = []
  mod.apply({ slots: makeSlots(injectNames, { occupied: false }) })
  assert.deepEqual(injectNames, ['settings.models.provider-card', 'settings.models.provider-card'])
  const cards = seats.filter((s) => s.spec.name === 'settings.models.provider-card')
  assert.deepEqual(cards.map((s) => s.spec.key), ['llm-deepseek', 'llm-pi-ai'])
  assert.equal(seats.filter((s) => s.spec.name === 'settings.section').length, 0, '空闲时不加设置分区')
})

ok('兼容分区注入失败时：只 warn，不抛', () => {
  seats.length = 0
  const warnings = []
  const origWarn = console.warn
  console.warn = (...args) => warnings.push(args.join(' '))
  try {
    const injectNames = []
    mod.apply({ slots: makeSlots(injectNames, { occupied: true, throwOn: 'settings.section' }) })
  } finally {
    console.warn = origWarn
  }
  assert.ok(warnings.some((w) => w.includes('settings.section')), '分区注入失败要有 warn')
})

ok('卡片组件对缺参不炸：没有 provider 时返回 null', () => {
  const el = seats.filter((s) => s.spec.name === 'settings.models.provider-card')[0].Component({})
  assert.equal(el, null, '拿不到 provider 行时应该渲染 null 而不是抛错')
})

ok('拿不到 slots 服务时不抛错，只 warn 并返回 no-op disposer', () => {
  const warnings = []
  const origWarn = console.warn
  console.warn = (...args) => warnings.push(args.join(' '))
  let dispose
  try {
    dispose = mod.apply({})
  } finally {
    console.warn = origWarn
  }
  assert.equal(typeof dispose, 'function')
  assert.equal(dispose(), undefined, 'no-op disposer 调用不该抛')
  assert.ok(warnings.some((w) => w.includes('slots')), '应该 warn 一句')
})

console.log('\n' + passed + ' 项全过')
