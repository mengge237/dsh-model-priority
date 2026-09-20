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
ok('apply 向上游 provider-card 席位注册卡片扩展（每个适配器家族一次）', () => {
  const dispose = mod.apply({
    slots: {
      inject(nm, cb) { assert.equal(nm, 'settings.models.provider-card'); cb(); return () => {} },
      register(spec, Component) { seats.push({ spec, Component }); return () => {} },
    },
  })
  assert.equal(typeof dispose, 'function', 'apply 要返回 disposer')
  assert.deepEqual(seats.map((s) => s.spec.key), ['llm-pi-ai', 'llm-deepseek'],
    '要覆盖 pi-ai 家族与内置 DeepSeek 家族（否则 DeepSeek 卡片里不会有这块）')
  for (const s of seats) {
    assert.equal(s.spec.name, 'settings.models.provider-card')
    assert.equal(typeof s.spec.inject, 'function')
    assert.equal(typeof s.Component, 'function', '组件要能被宿主当普通函数调')
  }
})

ok('卡片组件对缺参不炸：没有 provider 时返回 null', () => {
  const el = seats[0].Component({})
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
