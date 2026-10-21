import assert from 'node:assert/strict'
import { insertBefore, OrderMoveInvalidError } from '../lib/order.js'

let passed = 0
function ok(label, fn) { fn(); passed += 1; console.log('  ok   ' + label) }

ok('anchor: lands before it', () => {
  assert.deepEqual(insertBefore(['a', 'b', 'c'], 'c', 'a'), ['c', 'a', 'b'])
})

ok('no anchor: appends', () => {
  assert.deepEqual(insertBefore(['a', 'b', 'c'], 'a'), ['b', 'c', 'a'])
})

ok('same position keeps order', () => {
  assert.deepEqual(insertBefore(['a', 'b', 'c'], 'b', 'c'), ['a', 'b', 'c'])
})

ok('unknown source throws', () => {
  assert.throws(() => insertBefore(['a'], 'zzz'), OrderMoveInvalidError)
})

ok('unknown anchor throws', () => {
  assert.throws(() => insertBefore(['a', 'b'], 'a', 'zzz'), OrderMoveInvalidError)
})

console.log('\n' + passed + ' passed')
