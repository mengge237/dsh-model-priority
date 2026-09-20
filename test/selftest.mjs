// 不启动 dsh 就能验的数据层自检：顺序文件读写、清洗、稳定排序。
// 跑法：node test/selftest.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// 自检只碰数据层，不 import 服务端插件的 apply（apply 需要 ctx.webServer）。
// 所以这里直接对着 lib/index.js 的 internals 拿函数——它不依赖 cordis 运行时。
process.env.DSH_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dmp-selftest-'))

const mod = await import('../lib/index.js')
const { sortByOrder, sanitizeOrder, emptyOrder, readOrder, writeOrder, ORDER_FILE } = mod.internals

let passed = 0
function ok(label, fn) {
  fn()
  passed++
  console.log('  ok   ' + label)
}

ok('空产物形状正确', () => {
  assert.deepEqual(emptyOrder(), { version: 1, providerOrder: [], modelOrder: {} })
})

ok('sanitize 丢掉非字符串与空串', () => {
  const got = sanitizeOrder({
    providerOrder: ['a', '', 3, null, 'b'],
    modelOrder: { p1: ['m1', 7, 'm2'], p2: 'not-an-array', p3: ['m3'] },
  })
  assert.deepEqual(got.providerOrder, ['a', 'b'])
  assert.deepEqual(got.modelOrder.p1, ['m1', 'm2'])
  assert.equal(got.modelOrder.p2, undefined)
  assert.deepEqual(got.modelOrder.p3, ['m3'])
})

ok('sanitize 对垃圾输入返回空产物', () => {
  assert.deepEqual(sanitizeOrder(null), emptyOrder())
  assert.deepEqual(sanitizeOrder('x'), emptyOrder())
  assert.deepEqual(sanitizeOrder([]), emptyOrder())
})

ok('空顺序不改变原数组', () => {
  const items = [{ id: 'a' }, { id: 'b' }]
  assert.equal(sortByOrder(items, [], (x) => x.id), items)
  assert.equal(sortByOrder(items, undefined, (x) => x.id), items)
})

ok('点名过的按名单排，没点名的留在后面且保持原相对顺序', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
  const got = sortByOrder(items, ['c', 'a'], (x) => x.id).map((x) => x.id)
  assert.deepEqual(got, ['c', 'a', 'b', 'd'])
})

ok('名单里有不存在的 id 时不会丢条目、也不会插空', () => {
  const items = [{ id: 'a' }, { id: 'b' }]
  const got = sortByOrder(items, ['zzz', 'b'], (x) => x.id).map((x) => x.id)
  assert.deepEqual(got, ['b', 'a'])
})

ok('把最后一个拖到最前的意图能精确表达', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  const got = sortByOrder(items, ['c', 'a', 'b'], (x) => x.id).map((x) => x.id)
  assert.deepEqual(got, ['c', 'a', 'b'])
})

ok('原数组不被就地改动', () => {
  const items = [{ id: 'a' }, { id: 'b' }]
  const copy = items.slice()
  sortByOrder(items, ['b'], (x) => x.id)
  assert.deepEqual(items, copy)
})

ok('id 取不到时不影响其它条目排序', () => {
  const items = [{ id: 'a' }, {}, { id: 'b' }]
  const got = sortByOrder(items, ['b'], (x) => (x && x.id) || '').map((x) => x.id || '?')
  assert.deepEqual(got, ['b', 'a', '?'])
})

ok('写盘后读回来一致（原子写 + 清洗）', () => {
  writeOrder({ providerOrder: ['p2', 'p1'], modelOrder: { p1: ['m2', 'm1'] } })
  assert.ok(fs.existsSync(ORDER_FILE), '顺序文件应该落在 DSH_HOME 下')
  const back = readOrder()
  assert.deepEqual(back.providerOrder, ['p2', 'p1'])
  assert.deepEqual(back.modelOrder.p1, ['m2', 'm1'])
  writeOrder({ providerOrder: ['p1', 42], modelOrder: { p1: ['m1', null] } })
  assert.deepEqual(readOrder().providerOrder, ['p1'])
  assert.deepEqual(readOrder().modelOrder.p1, ['m1'])
})

ok('文件损坏时退回空顺序，不抛错', () => {
  fs.writeFileSync(ORDER_FILE, '{ this is not json', 'utf8')
  assert.deepEqual(readOrder(), emptyOrder())
  fs.rmSync(ORDER_FILE, { force: true })
  assert.deepEqual(readOrder(), emptyOrder())
})

ok('插件导出三个必需符号，且形态对得上', () => {
  assert.equal(mod.name, 'dsh-model-priority')
  assert.deepEqual(mod.inject, ['webServer', 'llm'])
  assert.equal(typeof mod.apply, 'function')
})

console.log('\n' + passed + ' 项全过')
