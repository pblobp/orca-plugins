import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cliCandidate, locateCli, outermostApp } from '../../plugins/os-vitals/src/cli.ts'

const MAIN = '/Applications/Orca.app/Contents/MacOS/Orca'
const HELPER =
  '/Applications/Orca.app/Contents/Frameworks/Orca Helper.app/Contents/MacOS/Orca Helper'

test('the outermost app bundle is found even from a helper inside it', () => {
  assert.equal(outermostApp(MAIN), '/Applications/Orca.app')
  assert.equal(outermostApp(HELPER), '/Applications/Orca.app')
  assert.equal(
    outermostApp('/Users/user/Apps/Orca Beta.app/Contents/MacOS/Orca'),
    '/Users/user/Apps/Orca Beta.app'
  )
  assert.equal(outermostApp('/usr/local/bin/node'), null)
  assert.equal(outermostApp('/opt/.app/orca'), null)
})

test('on macOS the CLI is bin/orca in the bundle resources', () => {
  const expected = '/Applications/Orca.app/Contents/Resources/bin/orca'
  assert.equal(cliCandidate({ platform: 'darwin', execPath: MAIN }), expected)
  assert.equal(cliCandidate({ platform: 'darwin', execPath: HELPER }), expected)
  assert.equal(cliCandidate({ platform: 'darwin', execPath: '/usr/local/bin/node' }), null)
})

test('on Linux the CLI is resources/bin/orca-ide beside the executable', () => {
  assert.equal(
    cliCandidate({ platform: 'linux', execPath: '/opt/Orca/orca' }),
    '/opt/Orca/resources/bin/orca-ide'
  )
  assert.equal(
    cliCandidate({ platform: 'linux', execPath: '/tmp/.mount_OrcaAbc/orca' }),
    '/tmp/.mount_OrcaAbc/resources/bin/orca-ide'
  )
})

test('other systems and relative paths have no candidate', () => {
  assert.equal(
    cliCandidate({ platform: 'win32', execPath: 'C:\\Program Files\\Orca\\Orca.exe' }),
    null
  )
  assert.equal(cliCandidate({ platform: 'freebsd', execPath: '/usr/local/orca/orca' }), null)
  assert.equal(cliCandidate({ platform: 'linux', execPath: 'orca' }), null)
  assert.equal(cliCandidate({ platform: 'darwin', execPath: '' }), null)
})

test('the candidate is used only when it can run', () => {
  const tried: string[] = []
  const env = { platform: 'darwin', execPath: MAIN }
  assert.equal(
    locateCli(env, (file) => {
      tried.push(file)
      return true
    }),
    '/Applications/Orca.app/Contents/Resources/bin/orca'
  )
  assert.equal(
    locateCli(env, () => false),
    null
  )
  assert.equal(
    locateCli({ platform: 'win32', execPath: 'C:\\Orca.exe' }, () => true),
    null
  )
  assert.deepEqual(tried, ['/Applications/Orca.app/Contents/Resources/bin/orca'])
})
