import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { rulesetDifferences } from '../../scripts/lib/ruleset-diff.mjs'
import { SCRIPTS } from './helpers.mjs'

const main = JSON.parse(readFileSync(join(SCRIPTS, 'rulesets', 'main.json'), 'utf8'))

test('a ruleset read back with extra defaults matches its file', () => {
  const actual = structuredClone(main)
  actual.id = 42
  actual.source_type = 'Repository'
  actual.rules.find((rule) => rule.type === 'pull_request').parameters.required_reviewers = []
  assert.deepEqual(rulesetDifferences(main, actual), [])
})

test('reports a missing rule, an extra rule, a changed parameter and a bypass', () => {
  const actual = structuredClone(main)
  actual.rules = actual.rules.filter((rule) => rule.type !== 'code_scanning')
  actual.rules.push({ type: 'creation' })
  actual.rules.find((rule) => rule.type === 'pull_request').parameters.allowed_merge_methods = [
    'merge',
    'squash'
  ]
  actual.bypass_actors = [{ actor_type: 'RepositoryRole', actor_id: 5, bypass_mode: 'always' }]
  const problems = rulesetDifferences(main, actual)
  assert.equal(problems.length, 4)
})

test('every ruleset file is valid JSON with the fields the API needs', () => {
  for (const name of ['main', 'tags-create', 'tags-immutable', 'tags-immutable-with-check']) {
    const ruleset = JSON.parse(readFileSync(join(SCRIPTS, 'rulesets', `${name}.json`), 'utf8'))
    for (const key of ['name', 'target', 'enforcement', 'conditions', 'bypass_actors', 'rules']) {
      assert.ok(key in ruleset, `${name}.json has no ${key}`)
    }
  }
})
