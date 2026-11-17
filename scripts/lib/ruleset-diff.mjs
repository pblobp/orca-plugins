#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function covers(actual, expected) {
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((item, index) => covers(actual[index], item))
    )
  }
  if (expected && typeof expected === 'object') {
    return (
      Boolean(actual) &&
      typeof actual === 'object' &&
      Object.keys(expected).every((key) => covers(actual[key], expected[key]))
    )
  }
  return actual === expected
}

export function rulesetDifferences(expected, actual) {
  const problems = []
  for (const key of ['name', 'target', 'enforcement']) {
    if (actual?.[key] !== expected[key]) {
      problems.push(
        `${key} is ${JSON.stringify(actual?.[key])}, want ${JSON.stringify(expected[key])}`
      )
    }
  }
  if (!covers(actual?.conditions, expected.conditions)) {
    problems.push(`conditions are ${JSON.stringify(actual?.conditions)}`)
  }
  const actors = (list) =>
    (list ?? [])
      .map((a) => `${a.actor_type}:${a.actor_id}:${a.bypass_mode}`)
      .sort()
      .join(',')
  if (actors(actual?.bypass_actors) !== actors(expected.bypass_actors)) {
    problems.push(
      `bypass_actors are [${actors(actual?.bypass_actors)}], want [${actors(expected.bypass_actors)}]`
    )
  }
  const byType = (rules) => new Map((rules ?? []).map((rule) => [rule.type, rule]))
  const want = byType(expected.rules)
  const have = byType(actual?.rules)
  for (const [type, rule] of want) {
    const got = have.get(type)
    if (!got) problems.push(`rule ${type} is missing`)
    else if (!covers(got.parameters ?? {}, rule.parameters ?? {})) {
      problems.push(`rule ${type} has parameters ${JSON.stringify(got.parameters)}`)
    }
  }
  for (const type of have.keys()) {
    if (!want.has(type)) problems.push(`rule ${type} is set but not in the file`)
  }
  return problems
}

function main() {
  const expected = JSON.parse(readFileSync(process.argv[2], 'utf8'))
  const actual = JSON.parse(readFileSync(0, 'utf8'))
  const problems = rulesetDifferences(expected, actual)
  for (const problem of problems) console.log(problem)
  process.exitCode = problems.length > 0 ? 1 : 0
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  main()
}
