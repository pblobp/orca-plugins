import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRing } from '../../plugins/os-vitals/src/ring.ts'

test('a ring keeps the newest items in order once it is full', () => {
  const ring = createRing<number>(3)
  assert.deepEqual(ring.toArray(), [])
  assert.equal(ring.last(), undefined)
  for (const n of [1, 2, 3, 4, 5]) ring.push(n)
  assert.deepEqual(ring.toArray(), [3, 4, 5])
  assert.equal(ring.last(), 5)
  assert.equal(ring.size(), 3)
})

test('growing a ring keeps everything; shrinking keeps the newest', () => {
  const ring = createRing<number>(3)
  for (const n of [1, 2, 3, 4]) ring.push(n)
  ring.resize(5)
  assert.deepEqual(ring.toArray(), [2, 3, 4])
  ring.push(5)
  ring.push(6)
  ring.push(7)
  assert.deepEqual(ring.toArray(), [3, 4, 5, 6, 7])
  ring.resize(2)
  assert.deepEqual(ring.toArray(), [6, 7])
  assert.equal(ring.capacity(), 2)
  ring.push(8)
  assert.deepEqual(ring.toArray(), [7, 8])
})

test('a ring never has a capacity below one, and clear empties it', () => {
  const ring = createRing<string>(0)
  assert.equal(ring.capacity(), 1)
  ring.push('a')
  ring.push('b')
  assert.deepEqual(ring.toArray(), ['b'])
  ring.clear()
  assert.deepEqual(ring.toArray(), [])
  assert.equal(ring.last(), undefined)
})
