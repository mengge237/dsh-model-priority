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
ok('apply 向 provider-card 注册 llm-deepseek，pi-ai 入口挂模型页 footer（list 槽）', () => {
  const injectNames = []
  const dispose = mod.apply({
    slots: {
      inject(nm, cb) { injectNames.push(nm); cb(); return () => {} },
      register(spec, Component) { seats.push({ spec, Component }); return () => {} },
    },
    betterSidebar: {
      registerTab(spec) { tabs.push(spec); return () => {} },
    },
  })
  assert.equal(typeof dispose, 'function', 'apply 要返回 disposer')
  assert.deepEqual(injectNames, ['settings.models.provider-card', 'settings.models.footer'],
    '2026-10-16 第三轮：deepseek 卡片格 + 模型页 footer（list 槽，与 web-all 能力面板的辅助区并列）')
  const card = seats.filter((s) => s.spec.name === 'settings.models.provider-card')
  assert.deepEqual(card.map((s) => s.spec.key), ['llm-deepseek'],
    '卡片格不注册 llm-pi-ai（让给 web-all 的模型能力面板），只保留 DeepSeek 家族')
  assert.equal(card.length, 1)
  assert.equal(typeof card[0].spec.inject, 'function')
  assert.equal(typeof card[0].Component, 'function', '组件要能被宿主当普通函数调')
  assert.equal(tabs.length, 0, '2026-10-16 第三轮：侧边栏入口已撤（本人明确不要这个功能）')
  const footer = seats.filter((s) => s.spec.name === 'settings.models.footer')
  assert.equal(footer.length, 1, '模型页 footer 只注册一次')
  assert.equal(footer[0].spec.id, 'dsh-model-priority:order')
  assert.equal(footer[0].spec.order, 40)
})

ok('footer 槽注入失败时：只 warn，卡片格照常注册、不抛', () => {
  const warnings = []
  const origWarn = console.warn
  console.warn = (...args) => warnings.push(args.join(' '))
  try {
    mod.apply({
      slots: {
        inject(nm, cb) { if (nm === 'settings.models.footer') throw new Error('no footer slot'); cb(); return () => {} },
        register() { return () => {} },
      },
    })
  } finally {
    console.warn = origWarn
  }
  assert.ok(warnings.some((w) => w.includes('settings.models.footer')), 'footer 注入失败要有 warn')
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
