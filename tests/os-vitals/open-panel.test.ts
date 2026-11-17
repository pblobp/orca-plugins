import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CliResult } from '../../plugins/os-vitals/src/cli.ts'
import {
  chooseKey,
  keyFromPath,
  openOwnPanel,
  parsePluginList,
  type ListedPlugin
} from '../../plugins/os-vitals/src/open-panel.ts'

const HASH = 'a'.repeat(64)

test('an installed copy names its key in its install path', () => {
  const data = '/Users/user/Library/Application Support/orca/plugins'
  assert.equal(
    keyFromPath(`${data}/pblobp.os-vitals/${HASH}/src/worker.ts`, 'os-vitals'),
    'pblobp.os-vitals'
  )
  assert.equal(
    keyFromPath(`${data}/pblobp.os-vitals/current/src/worker.ts`, 'os-vitals'),
    'pblobp.os-vitals'
  )
  assert.equal(
    keyFromPath(
      `C:\\Users\\user\\AppData\\Roaming\\orca\\plugins\\pblobp.os-vitals\\${HASH}\\src\\worker.ts`,
      'os-vitals'
    ),
    'pblobp.os-vitals'
  )
})

test('a development folder has no key in its path', () => {
  assert.equal(
    keyFromPath('/Users/user/Workspace/orca-plugins/plugins/os-vitals/src/worker.ts', 'os-vitals'),
    null
  )
  assert.equal(
    keyFromPath('/x/plugins/pblobp.os-vitals/not-a-hash/src/worker.ts', 'os-vitals'),
    null
  )
  assert.equal(keyFromPath('/x/plugins/pblobp.other/current/src/worker.ts', 'os-vitals'), null)
  assert.equal(keyFromPath(null, 'os-vitals'), null)
})

test('the plugin list is read for copies of this plugin only', () => {
  const stdout = JSON.stringify({
    ok: true,
    result: {
      plugins: [
        {
          pluginKey: 'local.os-vitals',
          status: 'running',
          isDev: true,
          panels: [{ id: 'os-vitals' }]
        },
        { pluginKey: 'pblobp.os-vitals', status: 'disabled', isDev: false, panels: ['os-vitals'] },
        {
          pluginKey: 'someone.fleet-monitor',
          status: 'running',
          isDev: false,
          panels: [{ id: 'fleet' }]
        },
        { pluginKey: 'bad key.os-vitals', status: 'running', isDev: false, panels: [] },
        null
      ]
    }
  })
  assert.deepEqual(parsePluginList(stdout, 'os-vitals', 'os-vitals'), [
    { key: 'local.os-vitals', status: 'running', isDev: true, hasPanel: true },
    { key: 'pblobp.os-vitals', status: 'disabled', isDev: false, hasPanel: true }
  ])
  assert.deepEqual(parsePluginList('not json', 'os-vitals', 'os-vitals'), [])
  assert.deepEqual(
    parsePluginList(JSON.stringify({ ok: false, error: {} }), 'os-vitals', 'os-vitals'),
    []
  )
})

const plugin = (key: string, overrides: Partial<ListedPlugin> = {}): ListedPlugin => ({
  key,
  status: 'running',
  isDev: false,
  hasPanel: true,
  ...overrides
})

test('an installed copy opens its own panel when the list confirms it', () => {
  const listed = [plugin('local.os-vitals', { isDev: true }), plugin('pblobp.os-vitals')]
  assert.equal(chooseKey(listed, 'pblobp.os-vitals', 'os-vitals'), 'pblobp.os-vitals')
  assert.equal(chooseKey([], 'pblobp.os-vitals', 'os-vitals'), 'pblobp.os-vitals')
})

test('a development copy picks the development entry', () => {
  const listed = [plugin('pblobp.os-vitals'), plugin('local.os-vitals', { isDev: true })]
  assert.equal(chooseKey(listed, null, 'os-vitals'), 'local.os-vitals')
  assert.equal(
    chooseKey([plugin('pblobp.os-vitals', { status: 'idle' })], null, 'os-vitals'),
    'pblobp.os-vitals'
  )
})

test('no key is chosen when the list cannot tell which copy this is', () => {
  assert.equal(chooseKey([], null, 'os-vitals'), null)
  assert.equal(chooseKey([plugin('a.os-vitals'), plugin('b.os-vitals')], null, 'os-vitals'), null)
  assert.equal(chooseKey([plugin('a.os-vitals', { status: 'disabled' })], null, 'os-vitals'), null)
  assert.equal(chooseKey([plugin('a.os-vitals', { hasPanel: false })], null, 'os-vitals'), null)
  assert.equal(
    chooseKey([plugin('a.os-vitals'), plugin('b.os-vitals')], 'pblobp.os-vitals', 'os-vitals'),
    null
  )
})

function fakeRun(answers: Record<string, CliResult>) {
  const calls: string[][] = []
  return {
    calls,
    run: async (args: readonly string[]): Promise<CliResult> => {
      calls.push([...args])
      return answers[args[1]] ?? { ok: false, stdout: '', stderr: '', error: 'unexpected' }
    }
  }
}

const ok = (result: unknown): CliResult => ({
  ok: true,
  stdout: JSON.stringify({ ok: true, result }),
  stderr: '',
  error: null
})

test('openOwnPanel lists, chooses and opens', async () => {
  const cli = fakeRun({
    list: ok({
      plugins: [
        {
          pluginKey: 'local.os-vitals',
          status: 'running',
          isDev: true,
          panels: [{ id: 'os-vitals' }]
        }
      ]
    }),
    open: ok({})
  })
  assert.deepEqual(await openOwnPanel(cli.run, '/dev/plugins/os-vitals/src/worker.ts'), {
    opened: true
  })
  assert.deepEqual(cli.calls, [
    ['plugin', 'list', '--json'],
    ['plugin', 'open', 'local.os-vitals', '--panel', 'os-vitals', '--json']
  ])
})

test('openOwnPanel reports why it could not open', async () => {
  assert.deepEqual(await openOwnPanel(null, null), {
    opened: false,
    reason: 'the Orca CLI was not found'
  })

  const lost = fakeRun({ list: ok({ plugins: [] }) })
  const notListed = await openOwnPanel(lost.run, '/dev/plugins/os-vitals/src/worker.ts')
  assert.equal(notListed.opened, false)
  assert.deepEqual(lost.calls, [['plugin', 'list', '--json']])

  const refused = fakeRun({
    list: ok({ plugins: [] }),
    open: { ok: false, stdout: '{"ok":false}', stderr: '', error: 'Command failed' }
  })
  const installed = `/data/plugins/pblobp.os-vitals/${HASH}/src/worker.ts`
  assert.deepEqual(await openOwnPanel(refused.run, installed), {
    opened: false,
    reason: 'Command failed'
  })
  assert.deepEqual(refused.calls[1], [
    'plugin',
    'open',
    'pblobp.os-vitals',
    '--panel',
    'os-vitals',
    '--json'
  ])
})
