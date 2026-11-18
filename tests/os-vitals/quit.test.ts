import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { Identity } from '../../plugins/os-vitals/src/parse/ps.ts'
import { PROTECTED_RULES, type ProtectedRule } from '../../plugins/os-vitals/src/protected.ts'
import type { ProcessRow, QuitInput } from '../../plugins/os-vitals/src/protocol.ts'
import {
  createOfferer,
  family,
  insideBundle,
  quitProcess,
  readQuitInput,
  type QuitContext,
  type QuitDeps,
  type QuitSignal
} from '../../plugins/os-vitals/src/quit.ts'

const UID = 501
const START = 'Tue Nov 17 10:00:00 2026'
const CONTEXT: QuitContext = {
  uid: UID,
  selfPid: 900,
  parentPid: 700,
  bundle: '/Applications/Orca.app'
}

function row(pid: number, path: string, overrides: Partial<ProcessRow> = {}): ProcessRow {
  const name = path.startsWith('/') ? path.slice(path.lastIndexOf('/') + 1) : path
  return {
    pid,
    ppid: 1,
    uid: UID,
    user: 'user',
    name,
    path,
    cpu: 0,
    memory: 1024,
    cpuTime: 1,
    startedAt: 0,
    start: START,
    ...overrides
  }
}

const identityOf = (entry: ProcessRow): Identity => ({
  start: entry.start,
  uid: entry.uid,
  path: entry.path,
  name: entry.name
})

const ROWS: ProcessRow[] = [
  row(1, '/sbin/launchd', { ppid: 0, uid: 0 }),
  row(700, '/Applications/Orca.app/Contents/MacOS/Orca'),
  row(
    900,
    '/Applications/Orca.app/Contents/Frameworks/Orca Helper.app/Contents/MacOS/Orca Helper',
    {
      ppid: 700
    }
  ),
  row(600, '/Users/user/Library/Application Support/orca/daemon-host/a1/orca-terminal-host'),
  row(610, '/Users/user/.nvm/versions/node/v24.22.1/bin/node', { ppid: 600 }),
  row(800, '/bin/sleep'),
  row(810, '/usr/local/bin/backup-agent', { uid: 0, user: 'root' })
]

function deps(rows: ProcessRow[] = ROWS, overrides: Partial<QuitDeps> = {}) {
  const kills: [number, QuitSignal][] = []
  const identified: number[] = []
  const value: QuitDeps = {
    ...CONTEXT,
    listed: () => rows,
    identify: async (pid) => {
      identified.push(pid)
      const entry = rows.find((candidate) => candidate.pid === pid)
      return entry ? identityOf(entry) : null
    },
    kill: (pid, signal) => {
      kills.push([pid, signal])
    },
    ...overrides
  }
  return { value, kills, identified }
}

const ask = (pid: number, force = false, startedAt = START): QuitInput => ({
  pid,
  startedAt,
  force
})

describe('reading the quit input', () => {
  test('a whole pid, a start token and a force flag are accepted', () => {
    assert.deepEqual(readQuitInput({ pid: 800, startedAt: START, force: false }), ask(800))
    assert.deepEqual(readQuitInput({ pid: 800, startedAt: START, force: true }), ask(800, true))
  })

  test('anything else is refused', () => {
    for (const input of [
      undefined,
      null,
      [],
      'pid 800',
      { pid: 800, startedAt: START },
      { pid: 800, force: false },
      { startedAt: START, force: false },
      { pid: 0, startedAt: START, force: false },
      { pid: -5, startedAt: START, force: false },
      { pid: 2 ** 31, startedAt: START, force: false },
      { pid: 8.5, startedAt: START, force: false },
      { pid: '800', startedAt: START, force: false },
      { pid: 800, startedAt: 1700000000000, force: false },
      { pid: 800, startedAt: 'Tue Nov 17 10:00:00 2026 ', force: false },
      { pid: 800, startedAt: 'yesterday', force: false },
      { pid: 800, startedAt: START, force: 1 },
      { pid: 800, startedAt: START, force: false, extra: true }
    ]) {
      assert.equal(readQuitInput(input), null, JSON.stringify(input))
    }
  })
})

describe('refusals send nothing', () => {
  test('pid 1 is protected, before anything is read', async () => {
    const { value, kills, identified } = deps()
    assert.deepEqual(await quitProcess(ask(1), value), { ok: false, reason: 'protected' })
    assert.deepEqual(identified, [])
    assert.deepEqual(kills, [])
  })

  test('a process of another user is not_owner, before it is read again', async () => {
    const { value, kills, identified } = deps()
    assert.deepEqual(await quitProcess(ask(810), value), { ok: false, reason: 'not_owner' })
    assert.deepEqual(identified, [])
    assert.deepEqual(kills, [])
  })

  test('a process that exited is gone', async () => {
    const { value, kills } = deps(ROWS, { identify: async () => null })
    assert.deepEqual(await quitProcess(ask(800), value), { ok: false, reason: 'gone' })
    assert.deepEqual(kills, [])
  })

  test('a reused pid is changed: another start time', async () => {
    const { value, kills } = deps(ROWS, {
      identify: async () => ({
        ...identityOf(row(800, '/bin/sleep')),
        start: 'Tue Nov 17 10:05:00 2026'
      })
    })
    assert.deepEqual(await quitProcess(ask(800), value), { ok: false, reason: 'changed' })
    assert.deepEqual(kills, [])
  })

  test('a reused pid is changed: another name with the same start time', async () => {
    const { value, kills } = deps(ROWS, {
      identify: async () => ({ start: START, uid: UID, path: '/bin/zsh', name: 'zsh' })
    })
    assert.deepEqual(await quitProcess(ask(800), value), { ok: false, reason: 'changed' })
    assert.deepEqual(kills, [])
  })

  test('a reused pid is changed: another owner', async () => {
    const { value, kills } = deps(ROWS, {
      identify: async () => ({ ...identityOf(row(800, '/bin/sleep')), uid: 0 })
    })
    assert.deepEqual(await quitProcess(ask(800), value), { ok: false, reason: 'changed' })
    assert.deepEqual(kills, [])
  })

  test('a start time the list never gave is changed', async () => {
    const { value, kills } = deps()
    assert.deepEqual(await quitProcess(ask(800, false, 'Tue Nov 17 09:59:59 2026'), value), {
      ok: false,
      reason: 'changed'
    })
    assert.deepEqual(kills, [])
  })

  test('a running process the list does not show is changed', async () => {
    const { value, kills } = deps([], {
      identify: async () => identityOf(row(800, '/bin/sleep'))
    })
    assert.deepEqual(await quitProcess(ask(800), value), { ok: false, reason: 'changed' })
    assert.deepEqual(kills, [])
  })

  test('the worker itself is protected', async () => {
    const { value, kills } = deps()
    assert.deepEqual(await quitProcess(ask(900), value), { ok: false, reason: 'protected' })
    assert.deepEqual(kills, [])
  })

  test('the worker parent is protected', async () => {
    const { value, kills } = deps()
    assert.deepEqual(await quitProcess(ask(700), value), { ok: false, reason: 'protected' })
    assert.deepEqual(kills, [])
  })

  test('every ancestor in the list is protected, wherever it lives', async () => {
    const rows = [
      row(900, '/opt/tools/worker', { ppid: 450 }),
      row(450, '/opt/tools/supervisor', { ppid: 300 }),
      row(300, '/opt/tools/session', { ppid: 1 })
    ]
    const context = { ...CONTEXT, parentPid: 450, bundle: null }
    for (const pid of [900, 450, 300]) {
      const { value, kills } = deps(rows, context)
      assert.deepEqual(
        await quitProcess(ask(pid), value),
        { ok: false, reason: 'protected' },
        `pid ${pid}`
      )
      assert.deepEqual(kills, [])
    }
  })

  test('a path inside the Orca app bundle is protected', async () => {
    const helper = row(720, '/Applications/Orca.app/Contents/Resources/ripgrep/rg')
    const { value, kills } = deps([...ROWS, helper])
    assert.deepEqual(await quitProcess(ask(720), value), { ok: false, reason: 'protected' })
    assert.deepEqual(kills, [])
  })

  test('on Linux the folder beside the executable is the bundle', async () => {
    const helper = row(720, '/opt/Orca/chrome_crashpad_handler')
    const { value, kills } = deps([helper], { bundle: '/opt/Orca' })
    assert.deepEqual(await quitProcess(ask(720), value), { ok: false, reason: 'protected' })
    assert.deepEqual(kills, [])
  })
})

function sampleFor(rule: ProtectedRule): ProcessRow {
  switch (rule.match) {
    case 'path-prefix':
      return row(5000, `${rule.value}example-daemon`)
    case 'path-contains':
      return row(5000, `/Users/user/Library/Application Support${rule.value}a1/orca-terminal-host`)
    case 'name':
      return row(5000, `/opt/tools/${rule.value}`)
    case 'name-prefix':
      return row(5000, `/opt/tools/${rule.value}example`)
  }
}

describe('the protected set', () => {
  for (const rule of PROTECTED_RULES) {
    test(`protected: ${rule.match} "${rule.value}" (${rule.why})`, async () => {
      const target = sampleFor(rule)
      const { value, kills } = deps([target])
      assert.deepEqual(await quitProcess(ask(target.pid), value), {
        ok: false,
        reason: 'protected'
      })
      assert.deepEqual(kills, [])
      assert.equal(createOfferer(CONTEXT, [target])(target), rule.group)
    })
  }

  test('the set is exactly the one the plan lists', () => {
    assert.deepEqual(
      PROTECTED_RULES.map((rule) => `${rule.match}:${rule.value}`),
      [
        'path-prefix:/System/',
        'path-prefix:/usr/libexec/',
        'path-prefix:/usr/sbin/',
        'path-prefix:/sbin/',
        'name:loginwindow',
        'name:WindowServer',
        'name:Dock',
        'name:Finder',
        'name:WindowManager',
        'name:launchd',
        'path-contains:/orca/daemon-host/',
        'name:Orca',
        'name-prefix:Orca ',
        'name:systemd',
        'name:gnome-shell',
        'name:Xorg',
        'name:Xwayland',
        'name-prefix:kwin_',
        'name:plasmashell',
        'name-prefix:gdm',
        'name:sddm',
        'name:dbus-daemon',
        'name:dbus-broker',
        'name:pipewire',
        'name:wireplumber',
        'name:sshd',
        'name:login'
      ]
    )
  })

  test('near misses are not protected', async () => {
    for (const path of [
      '/opt/tools/Dockerd',
      '/opt/tools/finder',
      '/opt/tools/systemd-logind',
      '/opt/tools/logins',
      '/opt/tools/orca-cli',
      '/Applications/Orca.app2/Contents/MacOS/other',
      '/Users/user/System/tool'
    ]) {
      const target = row(5000, path)
      const { value, kills } = deps([target])
      assert.deepEqual(await quitProcess(ask(5000), value), { ok: true }, path)
      assert.deepEqual(kills, [[5000, 'SIGTERM']])
    }
  })

  for (const name of [
    'Orca Helper',
    'Orca Helper (Renderer)',
    'Orca Terminal Host',
    'Orca Agents'
  ]) {
    test(`Orca's own "${name}" is protected wherever it lives`, async () => {
      const target = row(5100, `/opt/elsewhere/${name}`)
      const { value, kills } = deps([target])
      assert.deepEqual(await quitProcess(ask(5100), value), { ok: false, reason: 'protected' })
      assert.deepEqual(kills, [])
      assert.equal(createOfferer(CONTEXT, [target])(target), 'orca')
    })
  }

  test('an unrelated app whose name starts with Orca, such as OrcaSlicer, is not protected', async () => {
    for (const path of [
      '/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer',
      '/opt/tools/Orcanet'
    ]) {
      const target = row(5200, path)
      const { value, kills } = deps([target])
      assert.deepEqual(await quitProcess(ask(5200), value), { ok: true }, path)
      assert.deepEqual(kills, [[5200, 'SIGTERM']])
      assert.equal(createOfferer(CONTEXT, [target])(target), 'allowed')
    }
  })

  test('processes started from Orca terminals are not protected', async () => {
    const { value, kills } = deps()
    assert.deepEqual(await quitProcess(ask(610), value), { ok: true })
    assert.deepEqual(kills, [[610, 'SIGTERM']])
  })
})

describe('signals', () => {
  test('a quit sends SIGTERM, a forced quit SIGKILL', async () => {
    const { value, kills } = deps()
    assert.deepEqual(await quitProcess(ask(800), value), { ok: true })
    assert.deepEqual(await quitProcess(ask(800, true), value), { ok: true })
    assert.deepEqual(kills, [
      [800, 'SIGTERM'],
      [800, 'SIGKILL']
    ])
  })

  test('ESRCH reads as gone and EPERM as not_permitted', async () => {
    const failing = (code: string) =>
      deps(ROWS, {
        kill: () => {
          throw Object.assign(new Error(code), { code })
        }
      }).value
    assert.deepEqual(await quitProcess(ask(800), failing('ESRCH')), { ok: false, reason: 'gone' })
    assert.deepEqual(await quitProcess(ask(800), failing('EPERM')), {
      ok: false,
      reason: 'not_permitted'
    })
    await assert.rejects(quitProcess(ask(800), failing('EINVAL')), /EINVAL/)
  })
})

describe('what the list offers', () => {
  test('each row gets the reason quitting is or is not offered', () => {
    const offer = createOfferer(CONTEXT, ROWS)
    assert.deepEqual(
      ROWS.map((entry) => [entry.pid, offer(entry)]),
      [
        [1, 'system'],
        [700, 'orca'],
        [900, 'orca'],
        [600, 'orca'],
        [610, 'allowed'],
        [800, 'allowed'],
        [810, 'not_owner']
      ]
    )
  })

  test('the worker family follows parents through the list', () => {
    const rows = [
      row(900, 'w', { ppid: 450 }),
      row(450, 's', { ppid: 300 }),
      row(300, 'x', { ppid: 1 })
    ]
    assert.deepEqual(
      [...family({ ...CONTEXT, parentPid: 450 }, rows)].sort((a, b) => a - b),
      [300, 450, 900]
    )
    assert.deepEqual(
      [...family(CONTEXT, [])].sort((a, b) => a - b),
      [700, 900]
    )
  })

  test('the bundle check needs the folder boundary', () => {
    assert.equal(
      insideBundle('/Applications/Orca.app/Contents/MacOS/Orca', '/Applications/Orca.app'),
      true
    )
    assert.equal(insideBundle('/Applications/Orca.app2/x', '/Applications/Orca.app'), false)
    assert.equal(insideBundle('/Applications/Orca.app', '/Applications/Orca.app'), false)
    assert.equal(insideBundle('/anything', null), false)
  })
})
