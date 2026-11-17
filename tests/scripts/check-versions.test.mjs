import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { compareSemver, parseSemver } from '../../scripts/lib/common.mjs'
import {
  EMPTY_CATALOG,
  addPlugin,
  commit,
  git,
  read,
  remove,
  runScript,
  setVersion,
  tag,
  tempRepo,
  write
} from './helpers.mjs'

function check(dir) {
  return runScript(dir, 'check-versions.mjs')
}

describe('semver', () => {
  test('orders versions, pre-releases first', () => {
    const ordered = [
      '0.9.9',
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-beta',
      '1.0.0',
      '1.0.1',
      '1.10.0'
    ]
    for (let i = 1; i < ordered.length; i++) {
      assert.equal(
        compareSemver(ordered[i - 1], ordered[i]),
        -1,
        `${ordered[i - 1]} < ${ordered[i]}`
      )
      assert.equal(compareSemver(ordered[i], ordered[i - 1]), 1)
    }
    assert.equal(compareSemver('1.2.3', '1.2.3'), 0)
  })

  test('rejects what is not semver', () => {
    for (const value of ['1.0', 'v1.0.0', '01.0.0', '1.0.0.0', '', null]) {
      assert.equal(parseSemver(value), null, String(value))
    }
  })
})

describe('check-versions', () => {
  test('passes with no plugins and no tags', (t) => {
    const dir = tempRepo(t)
    commit(dir)
    const result = check(dir)
    assert.equal(result.status, 0, result.output)
    assert.match(result.stdout, /no release tag yet/)
  })

  test('with no tag, every plugin is a first release', (t) => {
    const dir = tempRepo(t)
    addPlugin(dir, 'alpha')
    commit(dir)
    assert.equal(check(dir).status, 0)
  })

  test('a plugin unchanged since the newest tag passes', (t) => {
    const dir = tempRepo(t)
    addPlugin(dir, 'alpha')
    commit(dir)
    tag(dir, 'v1.0.0')
    write(dir, 'README.md', '# repo\n')
    commit(dir)
    assert.equal(check(dir).status, 0)
  })

  test('a changed plugin needs a higher version than at the newest tag', (t) => {
    const dir = tempRepo(t)
    addPlugin(dir, 'alpha')
    commit(dir)
    tag(dir, 'v1.0.0')
    write(dir, 'plugins/alpha/README.md', '# alpha\n\nNew words.\n')
    commit(dir)
    const failed = check(dir)
    assert.equal(failed.status, 1)
    assert.match(failed.stderr, /alpha: plugins\/alpha\/ changed since v1\.0\.0/)
    setVersion(dir, 'alpha', '1.0.1')
    commit(dir)
    assert.equal(check(dir).status, 0)
  })

  test('sees uncommitted and untracked changes', (t) => {
    const dir = tempRepo(t)
    addPlugin(dir, 'alpha')
    commit(dir)
    tag(dir, 'v1.0.0')
    write(dir, 'plugins/alpha/media/note.txt', 'new file\n')
    assert.equal(check(dir).status, 1)
  })

  test('a version lower than a released one fails', (t) => {
    const dir = tempRepo(t)
    addPlugin(dir, 'alpha', { version: '2.0.0' })
    commit(dir)
    tag(dir, 'v1.0.0')
    setVersion(dir, 'alpha', '1.9.0')
    commit(dir)
    assert.match(check(dir).stderr, /version 1\.9\.0 is lower than 2\.0\.0 at v1\.0\.0/)
  })

  test('compares with the newest tag by version, not by name or date', (t) => {
    const dir = tempRepo(t)
    addPlugin(dir, 'alpha')
    commit(dir)
    tag(dir, 'v1.2.0')
    setVersion(dir, 'alpha', '1.1.0')
    commit(dir)
    tag(dir, 'v1.10.0')
    write(dir, 'plugins/alpha/README.md', '# changed\n')
    commit(dir)
    assert.match(check(dir).stderr, /changed since v1\.10\.0/)
  })

  test('ignores tags that are not merged into HEAD', (t) => {
    const dir = tempRepo(t)
    addPlugin(dir, 'alpha')
    commit(dir)
    git(dir, 'switch', '-q', '-c', 'side')
    write(dir, 'plugins/alpha/README.md', '# side\n')
    commit(dir)
    tag(dir, 'v9.0.0')
    git(dir, 'switch', '-q', 'main')
    assert.equal(check(dir).status, 0)
  })

  test('a plugin removed and added again cannot reuse a released version', (t) => {
    const dir = tempRepo(t)
    addPlugin(dir, 'alpha')
    commit(dir)
    tag(dir, 'v1.0.0')
    remove(dir, 'plugins/alpha')
    remove(dir, 'policy/alpha.json')
    commit(dir)
    tag(dir, 'v1.1.0')
    addPlugin(dir, 'alpha', { readme: '# alpha again\n' })
    commit(dir)
    assert.match(
      check(dir).stderr,
      /alpha@1\.0\.0 was already released at v1\.0\.0 with other files/
    )
  })

  test('a version already in the catalog with other files fails', (t) => {
    const dir = tempRepo(t)
    addPlugin(dir, 'alpha')
    const listed = commit(dir)
    const catalog = structuredClone(EMPTY_CATALOG)
    catalog.plugins.push({
      id: 'pblobp.alpha',
      source: {
        kind: 'git',
        url: 'https://github.com/pblobp/orca-plugins.git',
        ref: 'main',
        path: 'plugins/alpha'
      },
      releases: [{ version: '1.0.0', commit: listed }]
    })
    write(dir, 'orca-catalog.json', catalog)
    commit(dir)
    assert.equal(check(dir).status, 0)
    write(dir, 'plugins/alpha/README.md', `${read(dir, 'plugins/alpha/README.md')}More.\n`)
    commit(dir)
    assert.match(check(dir).stderr, /alpha@1\.0\.0 is already listed in orca-catalog\.json/)
  })

  test('a version that is not semver fails', (t) => {
    const dir = tempRepo(t)
    addPlugin(dir, 'alpha', { version: '1.0' })
    commit(dir)
    assert.match(check(dir).stderr, /is not semver/)
  })
})
