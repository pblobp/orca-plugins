import assert from 'node:assert/strict'
import { test } from 'node:test'
import { split } from '../../plugins/os-vitals/panel/charts.ts'

type Point = { t: number; value: number | null }

const runs = (points: Point[], gapMs: number) =>
  split(points, gapMs, (point) => point.value !== null).map((run) => run.map((point) => point.t))

test('a series read every second tick draws one line through its own readings', () => {
  const points: Point[] = Array.from({ length: 8 }, (_, index) => ({
    t: index * 2000,
    value: index % 2 === 0 ? index : null
  }))
  assert.deepEqual(runs(points, 15000), [[0, 4000, 8000, 12000]])
})

test('unevenly spaced readings stay one line until a gap longer than the limit', () => {
  const points: Point[] = [
    { t: 0, value: 1 },
    { t: 1000, value: 2 },
    { t: 7000, value: 3 },
    { t: 30000, value: 4 },
    { t: 34000, value: 5 }
  ]
  assert.deepEqual(runs(points, 15000), [
    [0, 1000, 7000],
    [30000, 34000]
  ])
})

test('a series with no readings draws nothing', () => {
  assert.deepEqual(runs([{ t: 0, value: null }], 15000), [])
})
