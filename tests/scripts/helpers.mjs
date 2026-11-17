import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { devNull, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const SCRIPTS = join(REPO_ROOT, 'scripts')
export const CORPUS = join(REPO_ROOT, 'tests', 'scripts', 'corpus')
export const LICENSE_TEXT = readFileSync(join(REPO_ROOT, 'LICENSE'), 'utf8')

export const TEST_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test',
  GIT_TERMINAL_PROMPT: '0',
  CI: '1'
}

export const EMPTY_CATALOG = {
  $schema:
    'https://raw.githubusercontent.com/stablyai/orca/main/docs/schemas/plugins/orca-catalog.v2.schema.json',
  catalogVersion: 2,
  name: 'pblobp Orca plugins',
  owner: 'pblobp',
  plugins: []
}

export function git(dir, ...args) {
  return execFileSync('git', args, { cwd: dir, env: TEST_ENV, encoding: 'utf8' })
}

export function write(dir, path, content) {
  const target = join(dir, path)
  mkdirSync(dirname(target), { recursive: true })
  const text = typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`
  writeFileSync(target, text)
}

export function read(dir, path) {
  return readFileSync(join(dir, path), 'utf8')
}

export function remove(dir, path) {
  rmSync(join(dir, path), { recursive: true, force: true })
}

export function tempRepo(t) {
  const dir = mkdtempSync(join(tmpdir(), 'orca-plugins-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  git(dir, 'init', '-q', '-b', 'main')
  write(dir, 'LICENSE', LICENSE_TEXT)
  write(dir, 'orca-catalog.json', EMPTY_CATALOG)
  return dir
}

export function commit(dir, message = 'change') {
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '--allow-empty', '-m', message)
  return git(dir, 'rev-parse', 'HEAD').trim()
}

export function tag(dir, name, ref = 'HEAD') {
  git(dir, 'tag', '-a', name, '-m', name, ref)
}

export function manifest(id, version = '1.0.0', extra = {}) {
  return {
    manifestVersion: 2,
    id,
    name: id,
    version,
    description: 'A test plugin.',
    license: 'MIT',
    repository: 'https://github.com/pblobp/orca-plugins',
    engines: { orca: '>=1.4.246' },
    execution: 'data',
    contributes: {
      terminalThemes: [{ id, title: id, path: 'terminal/dark.json' }]
    },
    ...extra
  }
}

export function addPlugin(dir, id, options = {}) {
  const base = `plugins/${id}`
  write(dir, `${base}/orca-plugin.json`, manifest(id, options.version, options.manifest))
  write(dir, `${base}/README.md`, options.readme ?? `# ${id}\n\nA test plugin.\n`)
  write(
    dir,
    `${base}/CHANGELOG.md`,
    options.changelog ?? `# Changelog\n\n## [1.0.0]\n\n### Access\n\n- None.\n`
  )
  write(dir, `${base}/LICENSE`, LICENSE_TEXT)
  write(dir, `${base}/terminal/dark.json`, {
    schemaVersion: 1,
    mode: 'dark',
    terminal: { background: '#1b1430', foreground: '#e8e0ff', black: '#2a2142', red: '#ff6b8b' }
  })
  if (options.policy !== null) write(dir, `policy/${id}.json`, options.policy ?? {})
  for (const [path, content] of Object.entries(options.files ?? {})) {
    write(dir, `${base}/${path}`, content)
  }
}

export function setVersion(dir, id, version) {
  const path = `plugins/${id}/orca-plugin.json`
  const data = JSON.parse(read(dir, path))
  data.version = version
  write(dir, path, data)
}

export function runScript(dir, script, args = [], env = {}) {
  const result = spawnSync(process.execPath, [join(SCRIPTS, script), ...args], {
    cwd: dir,
    env: { ...TEST_ENV, ...env },
    encoding: 'utf8'
  })
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    output: `${result.stdout}${result.stderr}`
  }
}

export function orcaAvailable() {
  const result = spawnSync('orca', ['--version'], { encoding: 'utf8' })
  return !result.error && result.status === 0
}
