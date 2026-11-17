import assert from 'node:assert/strict'
import { readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import {
  accessLines,
  checkHtml,
  checkSource,
  emptyPolicy,
  scanFixture,
  validatePolicy
} from '../../scripts/check-policy.mjs'
import {
  CORPUS,
  addPlugin,
  commit,
  git,
  manifest,
  read,
  remove,
  runScript,
  tempRepo,
  write
} from './helpers.mjs'

const CORPUS_POLICY = { modules: ['node:child_process', 'node:os'], programs: ['/bin/ps'] }

function corpus(kind) {
  return readdirSync(join(CORPUS, kind))
    .sort()
    .map((name) => ({ name, text: readFileSync(join(CORPUS, kind, name), 'utf8') }))
}

function policyOf(raw) {
  const problems = []
  const policy = validatePolicy(raw, 'policy/test.json', problems)
  assert.deepEqual(problems, [])
  return policy
}

describe('evasion corpus', () => {
  const policy = policyOf(CORPUS_POLICY)
  for (const { name, text } of corpus('evasion')) {
    test(`rejects ${name}`, () => {
      const { problems } = checkSource(text, { file: `src/${name}`, policy })
      assert.ok(problems.length > 0, `${name} passed the policy check`)
    })
  }
})

describe('clean corpus', () => {
  const policy = policyOf(CORPUS_POLICY)
  for (const { name, text } of corpus('clean')) {
    test(`accepts ${name}`, () => {
      const { problems } = checkSource(text, { file: `src/${name}`, policy })
      assert.deepEqual(problems, [])
    })
  }
})

describe('code rules', () => {
  const policy = policyOf(CORPUS_POLICY)
  const check = (text, file = 'src/a.ts', use = policy) =>
    checkSource(text, { file, policy: use }).problems.map((p) => p.message)

  test('ignores types', () => {
    assert.deepEqual(check('let f: Function\ntype E = typeof eval\ninterface I { fetch: 1 }'), [])
  })

  test('reports the line of each problem', () => {
    const { problems } = checkSource('const a = 1\n\neval(a)\n', { file: 'src/a.ts', policy })
    assert.equal(problems[0].line, 3)
  })

  test('rejects a file that does not parse', () => {
    assert.match(check('const = ;')[0], /does not parse/)
  })

  test('network globals are allowed only when the policy lists hosts', () => {
    const withHosts = policyOf({ ...CORPUS_POLICY, hosts: ['api.example.com'] })
    assert.deepEqual(check("fetch('https://api.example.com')", 'src/a.ts', withHosts), [])
    assert.ok(check("fetch('https://api.example.com')").length > 0)
  })

  test('a module on the allowlist covers its subpaths', () => {
    const fs = policyOf({ modules: ['node:fs'] })
    assert.deepEqual(check("import { readFile } from 'node:fs/promises'", 'src/a.ts', fs), [])
    assert.deepEqual(check("import { readFile } from 'fs/promises'", 'src/a.ts', fs), [])
  })

  test('relative imports inside the plugin and orca imports are allowed', () => {
    assert.deepEqual(
      check("import { a } from './a.ts'\nimport { b } from '../b.ts'", 'src/x/y.ts'),
      []
    )
    assert.deepEqual(check("import { test } from 'orca/testing'"), [])
  })

  test('URL schemes in strings are read the way a browser reads them', () => {
    assert.ok(check("export const u = 'java\\tscript:go()'").length > 0)
    assert.ok(check("export const u = '\\u0001javascript:go()'").length > 0)
    assert.ok(check("export const u = 'data:text/html,hi'").length > 0)
    assert.deepEqual(check("export const label = 'Data: 5 GB'"), [])
  })

  test('a program on the allowlist must be a literal at the call site', () => {
    assert.ok(
      check("import { spawn } from 'node:child_process'\nconst PS = '/bin/ps'\nspawn(PS, [])")
        .length > 0
    )
  })
})

describe('dynamic program exceptions', () => {
  const entry = {
    file: 'src/orca-cli.ts',
    function: 'runOrcaCli',
    reason: "Orca's own CLI, located from the app bundle"
  }
  const text = (name) => readFileSync(join(CORPUS, 'dynamic', name), 'utf8')

  test('accepts the declared function', () => {
    const policy = policyOf({ ...CORPUS_POLICY, dynamicPrograms: [entry] })
    const result = checkSource(text('orca-cli.ts'), { file: 'src/orca-cli.ts', policy })
    assert.deepEqual(result.problems, [])
    assert.deepEqual([...result.used], ['src/orca-cli.ts#runOrcaCli'])
  })

  test('rejects a second non-literal call outside the declared function', () => {
    const policy = policyOf({ ...CORPUS_POLICY, dynamicPrograms: [entry] })
    const result = checkSource(text('orca-cli-second-call.ts'), { file: 'src/orca-cli.ts', policy })
    assert.equal(result.problems.length, 1)
    assert.equal(result.problems[0].line, 8)
  })

  test('rejects the same code with no policy entry', () => {
    const policy = policyOf(CORPUS_POLICY)
    const result = checkSource(text('orca-cli.ts'), { file: 'src/orca-cli.ts', policy })
    assert.match(result.problems[0].message, /string-literal program/)
  })

  test('keeps the shell ban inside the declared function', () => {
    const policy = policyOf({ ...CORPUS_POLICY, dynamicPrograms: [entry] })
    const result = checkSource(text('orca-cli-shell.ts'), { file: 'src/orca-cli.ts', policy })
    assert.ok(result.problems.some((p) => /shell option/.test(p.message)))
  })

  test('an exception names one file only', () => {
    const policy = policyOf({ ...CORPUS_POLICY, dynamicPrograms: [entry] })
    const result = checkSource(text('orca-cli.ts'), { file: 'src/other.ts', policy })
    assert.equal(result.problems.length, 1)
  })

  test('rejects an entry with an empty reason', () => {
    const problems = []
    validatePolicy({ dynamicPrograms: [{ ...entry, reason: '  ' }] }, 'policy/x.json', problems)
    assert.ok(problems.some((p) => /reason is required/.test(p)))
  })

  test('rejects an entry with no reason or more than one function', () => {
    const problems = []
    const { reason, ...noReason } = entry
    assert.ok(reason)
    validatePolicy(
      { dynamicPrograms: [noReason, { ...entry, function: ['a', 'b'] }] },
      'policy/x.json',
      problems
    )
    assert.equal(problems.length, 2)
  })
})

describe('policy files', () => {
  const check = (raw) => {
    const problems = []
    validatePolicy(raw, 'policy/x.json', problems)
    return problems
  }

  test('accepts an empty policy', () => {
    assert.deepEqual(check({}), [])
  })

  test('rejects unknown keys, bad modules and forbidden modules', () => {
    assert.equal(check({ network: true }).length, 1)
    assert.equal(check({ modules: ['os'] }).length, 1)
    assert.equal(check({ modules: ['node:vm'] }).length, 1)
    assert.equal(check({ modules: ['node:left-pad'] }).length, 1)
  })

  test('rejects relative, shell and network programs', () => {
    assert.equal(check({ programs: ['ps'] }).length, 1)
    assert.equal(check({ programs: ['/bin/../bin/ps'] }).length, 1)
    for (const program of [
      '/bin/sh',
      '/bin/bash',
      '/usr/bin/env',
      '/usr/bin/curl',
      '/usr/bin/nc'
    ]) {
      assert.equal(check({ programs: [program] }).length, 1, program)
    }
    assert.equal(check({ programs: ['/usr/bin/osascript', '/usr/bin/python3.12'] }).length, 2)
  })

  test('network modules need hosts', () => {
    assert.equal(check({ modules: ['node:https'] }).length, 1)
    assert.deepEqual(check({ modules: ['node:https'], hosts: ['api.example.com'] }), [])
  })
})

describe('html panels', () => {
  const policy = emptyPolicy()
  const check = (text) => checkHtml(text, { file: 'panel/index.html', policy }).problems

  test('accepts a document that loads its own files', () => {
    const html =
      '<!doctype html>\n<link rel="stylesheet" href="style.css">\n<script type="module" src="./main.ts"></script>\n'
    assert.deepEqual(check(html), [])
  })

  test('checks inline scripts with the same rules, on the right line', () => {
    const problems = check('<html>\n<body>\n<script>\nfetch("x")\n</script>\n')
    assert.equal(problems.length, 1)
    assert.equal(problems[0].line, 4)
  })

  test('rejects event handler attributes, srcdoc, javascript: URLs and remote scripts', () => {
    assert.equal(check('<button onclick="go()">Go</button>').length, 1)
    assert.equal(check('<iframe srcdoc="<p>x</p>"></iframe>').length, 1)
    assert.equal(check('<a href="javascript:go()">Go</a>').length, 1)
    assert.equal(check('<script src="https://example.com/x.js"></script>').length, 1)
    assert.equal(check('<script src="../../outside.js"></script>').length, 1)
  })
})

describe('html script elements, found the way a browser finds them', () => {
  const policy = emptyPolicy()
  const messages = (text) =>
    checkHtml(text, { file: 'panel/index.html', policy }).problems.map(
      (p) => `${p.line}: ${p.message}`
    )
  const FETCH = 'fetch uses the network, and the policy lists no hosts'
  const ONCLICK = 'the onclick attribute runs or embeds code'
  const UNCLOSED = 'a <script> element is not closed'

  test('an end tag with a space before > closes the element', () => {
    const html = '<script>\nfetch("x")\n</script >\n<button onclick="go()">Go</button>\n'
    assert.deepEqual(messages(html), [`2: ${FETCH}`, `4: ${ONCLICK}`])
  })

  test('tag names are matched in any case', () => {
    const html = '<SCRIPT>\nfetch("x")\n</SCRIPT>\n<button onclick="go()">Go</button>\n'
    assert.deepEqual(messages(html), [`2: ${FETCH}`, `4: ${ONCLICK}`])
  })

  test('an end tag with attributes closes the element', () => {
    const html = '<script>\nfetch("x")\n</script foo="bar">\n<button onclick="go()">Go</button>\n'
    assert.deepEqual(messages(html), [`2: ${FETCH}`, `4: ${ONCLICK}`])
  })

  test('an end tag broken across lines closes the element', () => {
    assert.deepEqual(messages('<script>\nfetch("x")\n</script\n>\n<p>after</p>\n'), [`2: ${FETCH}`])
    assert.deepEqual(messages('<script>\nfetch("x")\n</script\t\n bar>\n<p>after</p>\n'), [
      `2: ${FETCH}`
    ])
  })

  test('an unclosed script element runs to the end of the file, and is a problem itself', () => {
    assert.deepEqual(messages('<p>a</p>\n<script>\nfetch("x")\n'), [
      `2: ${UNCLOSED}`,
      `3: ${FETCH}`
    ])
  })

  test('elements whose names only start with script are not scripts', () => {
    assert.deepEqual(
      messages('<scripty>fetch("x")</scripty>\n<script-like>eval("1")</script-like>\n'),
      []
    )
  })

  test('an unquoted src is read like a quoted one', () => {
    const html =
      '<script src=https://example.com/x.js></script>\n<script type=module src=./main.ts></script>\n'
    assert.deepEqual(messages(html), [
      '1: script https://example.com/x.js is not a file inside the plugin'
    ])
  })

  test('a > inside a quoted attribute value does not end the tag', () => {
    const html =
      '<script data-x=">" src="https://example.com/x.js"></script>\n<a title=">" onclick="go()">x</a>\n'
    assert.deepEqual(messages(html), [
      '1: script https://example.com/x.js is not a file inside the plugin',
      `2: ${ONCLICK}`
    ])
  })

  test('a comment opener inside a script element is rejected', () => {
    const html = '<script><!-- <script></script> fetch("x") --></script>\n'
    assert.ok(messages(html).includes('1: "<!--" inside a script element changes where it ends'))
  })

  test('script sources and URL attributes are read after decoding, like a browser', () => {
    const html = [
      '<a href="&#106;avascript:go()">a</a>',
      '<a href="java&#9;script:go()">b</a>',
      '<a href=" JAVASCRIPT:go()">c</a>',
      '<script src="\\\\example.com/x.js"></script>',
      '<svg><script href="https://example.com/x.js"></script></svg>',
      '<iframe src="data:text/html,hi"></iframe>',
      '<img src="logo.png">'
    ].join('\n')
    assert.deepEqual(messages(html), [
      '1: javascript: URLs can carry code',
      '2: javascript: URLs can carry code',
      '3: javascript: URLs can carry code',
      '4: script \\\\example.com/x.js is not a file inside the plugin',
      '5: script https://example.com/x.js is not a file inside the plugin',
      '6: data: URLs can carry code'
    ])
  })
})

describe('fixture scan', () => {
  const at = ['someone', 'mail.test'].join('@')

  test('finds home paths, MAC, IP and IPv6 addresses, host names and email addresses', () => {
    const text = [
      'PID USER COMMAND',
      '1 user /Users/alice/bin/tool',
      '2 user /home/bob/.cache/x',
      'en0 a4:83:e7:12:34:56',
      'inet 192.168.1.20',
      'inet6 fe80::1c2b:3d4e:5f60:7182',
      'host alices-macbook.local',
      `mail ${at}`
    ].join('\n')
    const lines = scanFixture(text).map((p) => p.line)
    assert.deepEqual(lines, [2, 3, 4, 5, 6, 7, 8])
  })

  test('accepts placeholders and documentation ranges', () => {
    const text = [
      '/Users/user/bin/tool /home/user/x /Users/Shared/y',
      'ether 00:00:5e:00:53:01 00:00:00:00:00:00',
      'inet 127.0.0.1 192.0.2.10 198.51.100.7 203.0.113.9 0.0.0.0 255.255.255.0',
      'inet6 ::1 fe80::1 2001:db8::5',
      `Mon Nov 17 10:12:33 2026 host.local ${['user', 'example.com'].join('@')}`,
      'version 1.2.3'
    ].join('\n')
    assert.deepEqual(scanFixture(text), [])
  })

  test('finds the words it is given, such as the local user and host', () => {
    const problems = scanFixture('501 jdoe-test 0.0 ps\nmachine Build-Box', [
      'jdoe-test',
      'Build-Box'
    ])
    assert.deepEqual(
      problems.map((p) => p.line),
      [1, 2]
    )
  })
})

describe('access lines', () => {
  test('collects lines under Access headings only', () => {
    const text = '## [1.1.0]\n\n### Access\n\n- Adds notifications:show.\n\n### Fixed\n\n- A bug.\n'
    assert.deepEqual(accessLines(text), ['- Adds notifications:show.'])
  })
})

describe('check-policy on a repository', () => {
  test('passes with no plugins', (t) => {
    const dir = tempRepo(t)
    const result = runScript(dir, 'check-policy.mjs')
    assert.equal(result.status, 0, result.output)
    assert.match(result.stdout, /0 plugin\(s\) checked/)
  })

  test('passes a plugin made from the clean corpus', (t) => {
    const dir = tempRepo(t)
    const files = Object.fromEntries(corpus('clean').map(({ name, text }) => [`src/${name}`, text]))
    addPlugin(dir, 'clean', { policy: CORPUS_POLICY, files })
    const result = runScript(dir, 'check-policy.mjs')
    assert.equal(result.status, 0, result.output)
  })

  test('reports every file of the evasion corpus', (t) => {
    const dir = tempRepo(t)
    const evasions = corpus('evasion')
    const files = Object.fromEntries(evasions.map(({ name, text }) => [`src/${name}`, text]))
    addPlugin(dir, 'evasive', { policy: CORPUS_POLICY, files })
    const result = runScript(dir, 'check-policy.mjs')
    assert.equal(result.status, 1)
    for (const { name } of evasions) {
      assert.ok(result.stderr.includes(`plugins/evasive/src/${name}:`), `${name} was not reported`)
    }
  })

  test('a declared dynamic program passes; a missing, misnamed or unused one fails', (t) => {
    const dir = tempRepo(t)
    const entry = { file: 'src/orca-cli.ts', function: 'runOrcaCli', reason: 'Orca CLI' }
    const code = readFileSync(join(CORPUS, 'dynamic', 'orca-cli.ts'), 'utf8')
    addPlugin(dir, 'cli', {
      policy: { ...CORPUS_POLICY, dynamicPrograms: [entry] },
      files: { 'src/orca-cli.ts': code }
    })
    assert.equal(runScript(dir, 'check-policy.mjs').status, 0)

    write(dir, 'policy/cli.json', { ...CORPUS_POLICY })
    assert.match(runScript(dir, 'check-policy.mjs').stderr, /string-literal program/)

    write(dir, 'policy/cli.json', { ...CORPUS_POLICY, dynamicPrograms: [{ ...entry, reason: '' }] })
    assert.match(runScript(dir, 'check-policy.mjs').stderr, /reason is required/)

    write(dir, 'policy/cli.json', {
      ...CORPUS_POLICY,
      dynamicPrograms: [entry, { ...entry, function: 'missing' }]
    })
    assert.match(
      runScript(dir, 'check-policy.mjs').stderr,
      /names missing, which .* does not export/
    )

    write(dir, 'policy/cli.json', {
      ...CORPUS_POLICY,
      dynamicPrograms: [entry, { ...entry, file: 'src/gone.ts' }]
    })
    assert.match(runScript(dir, 'check-policy.mjs').stderr, /src\/gone\.ts, which does not exist/)

    write(dir, 'plugins/cli/src/orca-cli.ts', 'export function runOrcaCli() {}\n')
    write(dir, 'policy/cli.json', { ...CORPUS_POLICY, dynamicPrograms: [entry] })
    assert.match(runScript(dir, 'check-policy.mjs').stderr, /is unused/)
  })

  test('requires the plugin files, the MIT license and the repository URL', (t) => {
    const dir = tempRepo(t)
    addPlugin(dir, 'bare', { manifest: { license: 'Apache-2.0', repository: 'https://x.test/y' } })
    write(dir, 'plugins/bare/LICENSE', 'Some other license\n')
    const result = runScript(dir, 'check-policy.mjs')
    assert.equal(result.status, 1)
    assert.match(result.stderr, /license must be "MIT"/)
    assert.match(result.stderr, /repository must be/)
    assert.match(result.stderr, /LICENSE: must be a copy/)
  })

  test('requires a policy file and README, CHANGELOG and LICENSE', (t) => {
    const dir = tempRepo(t)
    addPlugin(dir, 'thin', { policy: null })
    for (const name of ['README.md', 'CHANGELOG.md', 'LICENSE']) remove(dir, `plugins/thin/${name}`)
    const result = runScript(dir, 'check-policy.mjs')
    assert.match(result.stderr, /policy\/thin\.json: missing/)
    for (const name of ['README.md', 'CHANGELOG.md', 'LICENSE']) {
      assert.match(result.stderr, new RegExp(`plugins/thin/${name.replace('.', '\\.')}: required`))
    }
  })

  test('rejects binaries, archives, fonts, symlinks and npm files', (t) => {
    const dir = tempRepo(t)
    addPlugin(dir, 'heavy')
    writeFileSync(join(dir, 'plugins/heavy/tool'), Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 1, 2]))
    writeFileSync(join(dir, 'plugins/heavy/font.ttf'), Buffer.from([0, 1, 0, 0]))
    writeFileSync(join(dir, 'plugins/heavy/media.zip'), Buffer.from('PK\x03\x04'))
    writeFileSync(join(dir, 'plugins/heavy/fake.png'), Buffer.from('PK\x03\x04 not a png'))
    writeFileSync(
      join(dir, 'plugins/heavy/real.png'),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])
    )
    symlinkSync('README.md', join(dir, 'plugins/heavy/link.md'))
    write(dir, 'plugins/heavy/package.json', { name: 'x' })
    write(dir, 'plugins/heavy/vendor/node_modules/x/index.js', 'export default 1\n')
    git(dir, 'add', '-f', 'plugins/heavy/vendor/node_modules/x/index.js')
    const result = runScript(dir, 'check-policy.mjs')
    assert.equal(result.status, 1)
    for (const pattern of [
      /heavy\/tool: binary/,
      /heavy\/font\.ttf: \.ttf files are not allowed/,
      /heavy\/media\.zip: \.zip files are not allowed/,
      /heavy\/fake\.png: content does not match/,
      /heavy\/link\.md: symlinks are not allowed/,
      /heavy\/package\.json: plugins have no npm dependencies/,
      /node_modules does not belong in a plugin/
    ]) {
      assert.match(result.stderr, pattern)
    }
    assert.doesNotMatch(result.stderr, /real\.png/)
  })

  test('rejects long lines, minified files and oversized transpiled files', (t) => {
    const dir = tempRepo(t)
    addPlugin(dir, 'dense', {
      files: {
        'src/long.ts': `export const s = '${'x'.repeat(220)}'\n`,
        'src/lib.min.js': 'export const a = 1\n',
        'src/big.ts': 'export const a = 1\n'.repeat(60000)
      }
    })
    const result = runScript(dir, 'check-policy.mjs')
    assert.match(result.stderr, /long\.ts:1: line longer than 200/)
    assert.match(result.stderr, /lib\.min\.js: minified files are not allowed/)
    assert.match(result.stderr, /big\.ts: over 1048576 bytes/)
  })

  test("enforces Orca's limit of 2,000 files and folders", (t) => {
    const dir = tempRepo(t)
    const files = {}
    for (let i = 0; i < 2000; i++) files[`data/${i}.json`] = '{}\n'
    addPlugin(dir, 'many', { files })
    const result = runScript(dir, 'check-policy.mjs')
    assert.match(result.stderr, /files and folders, over Orca's limit of 2000/)
  })

  test('checks the layout of plugins/ and policy/', (t) => {
    const dir = tempRepo(t)
    addPlugin(dir, 'ok')
    write(dir, 'plugins/notes.txt', 'x\n')
    write(dir, 'plugins/Bad_Name/orca-plugin.json', manifest('Bad_Name'))
    write(dir, 'plugins/empty/README.md', 'x\n')
    write(dir, 'policy/ghost.json', {})
    write(dir, 'policy/notes.txt', 'x\n')
    const result = runScript(dir, 'check-policy.mjs')
    for (const pattern of [
      /plugins\/notes\.txt: only plugin folders/,
      /plugins\/Bad_Name: a plugin folder name/,
      /plugins\/empty: has no orca-plugin\.json/,
      /policy\/ghost\.json: no plugin has this id/,
      /policy\/notes\.txt: only README\.md/
    ]) {
      assert.match(result.stderr, pattern)
    }
  })

  test('a host in the policy must be named in the README', (t) => {
    const dir = tempRepo(t)
    addPlugin(dir, 'net', { policy: { hosts: ['api.example.com'] } })
    assert.match(runScript(dir, 'check-policy.mjs').stderr, /host api\.example\.com is not named/)
    write(dir, 'plugins/net/README.md', '# net\n\nConnects to api.example.com.\n')
    assert.equal(runScript(dir, 'check-policy.mjs').status, 0)
  })

  test('scans test fixtures for personal data', (t) => {
    const dir = tempRepo(t)
    write(dir, 'tests/demo/fixtures/ps.txt', 'PID COMMAND\n1 /Users/alice/bin/tool\n')
    write(dir, 'tests/demo/cases.test.ts', "const home = '/Users/alice'\n")
    const result = runScript(dir, 'check-policy.mjs')
    assert.equal(result.status, 1)
    assert.match(result.stderr, /tests\/demo\/fixtures\/ps\.txt:2: home path/)
    assert.doesNotMatch(result.stderr, /cases\.test\.ts/)
    write(dir, 'tests/demo/fixtures/ps.txt', 'PID COMMAND\n1 /Users/user/bin/tool\n')
    assert.equal(runScript(dir, 'check-policy.mjs').status, 0)
  })

  test('an access change needs a new line under Access in the changelog', (t) => {
    const dir = tempRepo(t)
    addPlugin(dir, 'acc')
    const base = commit(dir, 'base')
    assert.equal(runScript(dir, 'check-policy.mjs', ['--base', base]).status, 0)

    const data = JSON.parse(read(dir, 'plugins/acc/orca-plugin.json'))
    data.capabilities = [{ kind: 'notifications:show' }]
    write(dir, 'plugins/acc/orca-plugin.json', data)
    const failed = runScript(dir, 'check-policy.mjs', ['--base', base])
    assert.equal(failed.status, 1)
    assert.match(failed.stderr, /access changed \(capabilities\)/)

    write(
      dir,
      'plugins/acc/CHANGELOG.md',
      `${read(dir, 'plugins/acc/CHANGELOG.md')}\n## [1.1.0]\n\n### Fixed\n\n- Asks for notifications.\n`
    )
    assert.equal(runScript(dir, 'check-policy.mjs', ['--base', base]).status, 1)

    write(
      dir,
      'plugins/acc/CHANGELOG.md',
      `${read(dir, 'plugins/acc/CHANGELOG.md')}\n### Access\n\n- Adds notifications:show.\n`
    )
    const passed = runScript(dir, 'check-policy.mjs', ['--base', base])
    assert.equal(passed.status, 0, passed.output)
  })

  test('a new plugin needs an Access entry', (t) => {
    const dir = tempRepo(t)
    const base = commit(dir, 'base')
    addPlugin(dir, 'fresh', { changelog: '# Changelog\n\n## [1.0.0]\n\n- First release.\n' })
    assert.match(
      runScript(dir, 'check-policy.mjs', ['--base', base]).stderr,
      /access changed \(new plugin\)/
    )
    addPlugin(dir, 'fresh')
    assert.equal(runScript(dir, 'check-policy.mjs', ['--base', base]).status, 0)
  })

  test('rejects a base that is not a commit', (t) => {
    const dir = tempRepo(t)
    commit(dir)
    const result = runScript(dir, 'check-policy.mjs', ['--base', 'no-such-ref'])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /not a commit/)
  })
})
