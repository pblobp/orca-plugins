import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { affectedPlugins } from '../../scripts/list-plugins.mjs'
import { addPlugin, commit, runScript, tempRepo, write } from './helpers.mjs'

const ALL = ['alpha', 'beta']

describe('affectedPlugins', () => {
  test('maps a plugin folder, its tests, its tools and its policy to that plugin', () => {
    assert.deepEqual(affectedPlugins(['plugins/beta/src/a.ts'], ALL), ['beta'])
    assert.deepEqual(affectedPlugins(['tests/alpha/fixtures/ps.txt'], ALL), ['alpha'])
    assert.deepEqual(affectedPlugins(['tools/beta/smoke.ts'], ALL), ['beta'])
    assert.deepEqual(affectedPlugins(['policy/alpha.json', 'plugins/beta/README.md'], ALL), ALL)
  })

  test('documentation, the catalog and the script tests affect no plugin', () => {
    const paths = [
      'README.md',
      'docs/releasing.md',
      'orca-catalog.json',
      'policy/README.md',
      'tests/scripts/check-policy.test.mjs',
      '.github/ISSUE_TEMPLATE/bug-report.yml',
      '.github/workflows/codeql.yml'
    ]
    assert.deepEqual(affectedPlugins(paths, ALL), [])
  })

  test('scripts, CI, the Orca pin and the dev tools affect every plugin', () => {
    for (const path of [
      'scripts/check-policy.mjs',
      '.github/workflows/ci.yml',
      '.github/actions/setup-orca/action.yml',
      '.orca-version',
      'package-lock.json'
    ]) {
      assert.deepEqual(affectedPlugins([path], ALL), ALL, path)
    }
  })

  test('ignores folders of plugins that no longer exist', () => {
    assert.deepEqual(affectedPlugins(['plugins/gone/README.md', 'tests/gone/a.test.ts'], ALL), [])
  })
})

describe('list-plugins', () => {
  test('prints an empty list with no plugins', (t) => {
    const dir = tempRepo(t)
    commit(dir)
    const result = runScript(dir, 'list-plugins.mjs')
    assert.equal(result.status, 0, result.output)
    assert.equal(result.stdout, 'plugins=[]\nany=false\n')
  })

  test('prints every plugin without a base', (t) => {
    const dir = tempRepo(t)
    addPlugin(dir, 'beta')
    addPlugin(dir, 'alpha')
    commit(dir)
    assert.equal(runScript(dir, 'list-plugins.mjs').stdout, 'plugins=["alpha","beta"]\nany=true\n')
  })

  test('prints the plugins changed since the base, committed or not', (t) => {
    const dir = tempRepo(t)
    addPlugin(dir, 'alpha')
    addPlugin(dir, 'beta')
    const base = commit(dir)
    write(dir, 'plugins/beta/README.md', '# beta\n\nChanged.\n')
    commit(dir)
    assert.equal(
      runScript(dir, 'list-plugins.mjs', ['--base', base]).stdout,
      'plugins=["beta"]\nany=true\n'
    )
    write(dir, 'plugins/alpha/media/new.txt', 'untracked\n')
    assert.equal(
      runScript(dir, 'list-plugins.mjs', ['--base', base]).stdout,
      'plugins=["alpha","beta"]\nany=true\n'
    )
  })

  test('a documentation change lists nothing', (t) => {
    const dir = tempRepo(t)
    addPlugin(dir, 'alpha')
    const base = commit(dir)
    write(dir, 'docs/notes.md', '# notes\n')
    commit(dir)
    assert.equal(
      runScript(dir, 'list-plugins.mjs', ['--base', base]).stdout,
      'plugins=[]\nany=false\n'
    )
  })

  test('fails on a base that is not a commit', (t) => {
    const dir = tempRepo(t)
    commit(dir)
    const result = runScript(dir, 'list-plugins.mjs', ['--base', 'no-such-ref'])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /not a commit/)
  })
})
