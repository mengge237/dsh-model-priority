import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { sanitizeLists, applyOrder, readLists, writeLists } from '../lib/ui-order.js'

let passed = 0
function ok(label, fn) {
  fn()
  passed++
  console.log('  ok   ' + label)
}

ok('applyOrder：点过名的排前面、按名单顺序', () => {
  const items = ['c', 'a', 'b', 'd']
  assert.deepEqual(applyOrder(items, ['b', 'a']), ['b', 'a', 'c', 'd'])
})

ok('applyOrder：没点名的保持原相对顺序（稳定）', () => {
  const items = ['x', 'y', 'z']
  assert.deepEqual(applyOrder(items, ['y']), ['y', 'x', 'z'])
})

ok('applyOrder：空名单原样返回', () => {
  const items = ['a', 'b']
  assert.deepEqual(applyOrder(items, []), ['a', 'b'])
  assert.deepEqual(applyOrder(items, null), ['a', 'b'])
})

ok('applyOrder：名单里有不存在的 key 不影响其它条目', () => {
  const items = ['a', 'b', 'c']
  assert.deepEqual(applyOrder(items, ['nope', 'c']), ['c', 'a', 'b'])
})

ok('applyOrder：对象条目按 keyOf 取值', () => {
  const items = [{ id: 'g' }, { id: 'h' }]
  assert.deepEqual(applyOrder(items, ['h', 'g'], (x) => x.id).map((x) => x.id), ['h', 'g'])
})

ok('sanitizeLists：丢空 id/非数组/空 key，限制形状', () => {
  const clean = sanitizeLists({
    'settings.nav': ['通用', '', '模型'],
    bad: 'nope',
    '': ['x'],
    ok2: ['a'],
  })
  assert.deepEqual(clean, { 'settings.nav': ['通用', '模型'], ok2: ['a'] })
})

ok('sanitizeLists：非对象输入回空对象', () => {
  assert.deepEqual(sanitizeLists(null), {})
  assert.deepEqual(sanitizeLists('x'), {})
})

ok('readLists/writeLists：落盘往返一致', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmp-ui-order-'))
  const file = path.join(dir, 'ui-order.json')
  const saved = writeLists(file, { 'settings.nav': ['模型', '通用'] })
  assert.deepEqual(saved, { 'settings.nav': ['模型', '通用'] })
  assert.deepEqual(readLists(file), saved)
  fs.rmSync(dir, { recursive: true, force: true })
})

ok('readLists：文件不存在或坏 JSON 都回空对象', () => {
  assert.deepEqual(readLists(path.join(os.tmpdir(), 'dmp-does-not-exist-' + Date.now())), {})
})

console.log('\n' + passed + ' passed')
