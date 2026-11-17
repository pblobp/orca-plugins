import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import {
  EMPTY_CATALOG,
  TEST_ENV,
  addPlugin,
  commit,
  git,
  orcaAvailable,
  read,
  runScript,
  setVersion,
  tempRepo,
  write
} from './helpers.mjs'

const SOURCE = {
  kind: 'git',
  url: 'https://github.com/pblobp/orca-plugins.git',
  ref: 'main',
  path: 'plugins/alpha'
}

function release(version, sha, extra = {}) {
  return {
    version,
    commit: sha,
    contentHash: 'a'.repeat(64),
    execution: 'data',
    minimumOrca: '1.4.246',
    ...extra
  }
}

function writeCatalog(dir, plugins) {
  write(dir, 'orca-catalog.json', { ...EMPTY_CATALOG, plugins })
}

function entry(releases, extra = {}) {
  return { id: 'pblobp.alpha', source: SOURCE, releases, ...extra }
}

function check(dir, args = [], env = {}) {
  return runScript(dir, 'check-catalog.mjs', args, env)
}

function fakeOrca(t, printed) {
  const dir = mkdtempSync(join(tmpdir(), 'fake-orca-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const program = join(dir, 'orca')
  const body = [
    '#!/usr/bin/env node',
    'const args = process.argv.slice(2)',
    "if (args[0] === '--version') { console.log('1.4.261'); process.exit(0) }",
    "if (args[1] === 'validate') { console.log(JSON.stringify({ ok: true, result: { valid: true, errors: [] } })); process.exit(0) }",
    `const printed = ${JSON.stringify(printed)}`,
    "console.log(JSON.stringify({ ok: true, result: { entry: printed, sourcePath: 'plugins/alpha' } }))"
  ].join('\n')
  writeFileSync(program, `${body}\n`)
  chmodSync(program, 0o755)
  return program
}

describe('check-catalog', () => {
  test('passes an empty catalog', (t) => {
    const dir = tempRepo(t)
    commit(dir)
    const result = check(dir)
    assert.equal(result.status, 0, result.output)
    assert.match(result.stdout, /0 plugin\(s\) listed/)
  })

  test('checks the catalog header', (t) => {
    const dir = tempRepo(t)
    write(dir, 'orca-catalog.json', { catalogVersion: 1, name: '', owner: 'someone', plugins: [] })
    commit(dir)
    const result = check(dir)
    assert.match(result.stderr, /catalogVersion must be 2/)
    assert.match(result.stderr, /owner must be "pblobp"/)
    assert.match(result.stderr, /name must be a non-empty string/)
  })

  test('passes a release that matches its commit', (t) => {
    const dir = tempRepo(t)
    addPlugin(dir, 'alpha')
    const sha = commit(dir)
    writeCatalog(dir, [entry([release('1.0.0', sha)])])
    commit(dir)
    const result = check(dir)
    assert.equal(result.status, 0, result.output)
  })

  test('checks the id, the source and the order of releases', (t) => {
    const dir = tempRepo(t)
    addPlugin(dir, 'alpha')
    const first = commit(dir)
    setVersion(dir, 'alpha', '1.1.0')
    const second = commit(dir)
    writeCatalog(dir, [
      entry([release('1.0.0', first), release('1.1.0', second)], {
        source: { ...SOURCE, url: 'https://github.com/someone/fork.git', path: 'plugins/other' }
      }),
      entry([release('1.0.0', first)]),
      { id: 'someone.alpha', source: SOURCE, releases: [] }
    ])
    commit(dir)
    const result = check(dir)
    for (const pattern of [
      /source\.url must be/,
      /source\.path must be "plugins\/alpha"/,
      /releases must be newest first/,
      /pblobp\.alpha: listed more than once/,
      /someone\.alpha: id must be "pblobp\.<plugin id>"/
    ]) {
      assert.match(result.stderr, pattern)
    }
  })

  test('rejects a commit that does not exist, is not on HEAD, or holds another version', (t) => {
    const dir = tempRepo(t)
    addPlugin(dir, 'alpha')
    const base = commit(dir)
    git(dir, 'switch', '-q', '-c', 'side')
    setVersion(dir, 'alpha', '2.0.0')
    const side = commit(dir)
    git(dir, 'switch', '-q', 'main')
    writeCatalog(dir, [
      entry([release('3.0.0', 'f'.repeat(40)), release('2.0.0', side), release('1.5.0', base)])
    ])
    commit(dir)
    const result = check(dir)
    assert.match(result.stderr, /3\.0\.0: commit f{40} does not exist/)
    assert.match(result.stderr, /2\.0\.0: commit [0-9a-f]{40} is not an ancestor of HEAD/)
    assert.match(
      result.stderr,
      /1\.5\.0: plugins\/alpha\/orca-plugin\.json at [0-9a-f]{40} has id "alpha" and version "1\.0\.0"/
    )
  })

  test('with --base, a listed release may not be changed or removed', (t) => {
    const dir = tempRepo(t)
    addPlugin(dir, 'alpha')
    const first = commit(dir)
    writeCatalog(dir, [entry([release('1.0.0', first)])])
    const base = commit(dir)

    setVersion(dir, 'alpha', '1.1.0')
    const second = commit(dir)
    writeCatalog(dir, [entry([release('1.1.0', second), release('1.0.0', first)])])
    commit(dir)
    assert.equal(check(dir, ['--base', base]).status, 0)

    writeCatalog(dir, [
      entry([release('1.1.0', second), release('1.0.0', first, { contentHash: 'b'.repeat(64) })])
    ])
    assert.match(
      check(dir, ['--base', base]).stderr,
      /pblobp\.alpha@1\.0\.0: a listed release was changed/
    )

    writeCatalog(dir, [entry([release('1.1.0', second)])])
    assert.match(
      check(dir, ['--base', base]).stderr,
      /pblobp\.alpha@1\.0\.0: a listed release was removed/
    )
  })

  test('with --require-current, every plugin is listed at its current files', (t) => {
    const dir = tempRepo(t)
    addPlugin(dir, 'alpha')
    const sha = commit(dir)
    assert.match(check(dir, ['--require-current']).stderr, /plugins\/alpha: not listed/)

    writeCatalog(dir, [entry([release('1.0.0', sha)])])
    commit(dir)
    assert.equal(check(dir, ['--require-current']).status, 0)

    write(dir, 'plugins/alpha/README.md', '# alpha\n\nChanged after listing.\n')
    commit(dir)
    assert.match(check(dir, ['--require-current']).stderr, /files differ from the listed commit/)

    setVersion(dir, 'alpha', '1.0.1')
    commit(dir)
    assert.match(
      check(dir, ['--require-current']).stderr,
      /version 1\.0\.1 is not the newest release/
    )
  })

  test('with --with-orca, the newest release must equal what release-entry prints', (t) => {
    const dir = tempRepo(t)
    addPlugin(dir, 'alpha')
    const sha = commit(dir)
    const listed = release('1.0.0', sha, { name: 'alpha' })
    writeCatalog(dir, [entry([listed])])
    commit(dir)

    const same = fakeOrca(t, listed)
    const passed = check(dir, ['--with-orca'], { ORCA_CLI: same })
    assert.equal(passed.status, 0, passed.output)

    const other = fakeOrca(t, { ...listed, contentHash: 'c'.repeat(64) })
    const failed = check(dir, ['--with-orca'], { ORCA_CLI: other })
    assert.equal(failed.status, 1)
    assert.match(
      failed.stderr,
      /contentHash is "a{64}" in the catalog, but release-entry prints "c{64}"/
    )
  })

  test('with --with-orca and no orca CLI, the check fails', (t) => {
    const dir = tempRepo(t)
    commit(dir)
    const result = check(dir, ['--with-orca'], { ORCA_CLI: join(tmpdir(), 'no-such-orca-cli') })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /the orca CLI is not available/)
  })

  test(
    'with the real orca CLI, a pasted release-entry passes and a changed hash fails',
    { skip: !orcaAvailable() && 'the orca CLI is not installed' },
    (t) => {
      const dir = tempRepo(t)
      addPlugin(dir, 'alpha')
      commit(dir)
      const printed = JSON.parse(
        execFileSync('orca', ['plugin', 'release-entry', 'plugins/alpha', '--json'], {
          cwd: dir,
          env: TEST_ENV,
          encoding: 'utf8'
        })
      )
      assert.equal(printed.result.sourcePath, 'plugins/alpha')
      writeCatalog(dir, [entry([printed.result.entry])])
      commit(dir)
      const passed = check(dir, ['--with-orca', '--require-current'])
      assert.equal(passed.status, 0, passed.output)

      const catalog = JSON.parse(read(dir, 'orca-catalog.json'))
      catalog.plugins[0].releases[0].contentHash = '0'.repeat(64)
      write(dir, 'orca-catalog.json', catalog)
      commit(dir)
      const failed = check(dir, ['--with-orca'])
      assert.equal(failed.status, 1)
      assert.match(failed.stderr, /contentHash is "0{64}" in the catalog/)
    }
  )
})
