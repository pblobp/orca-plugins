import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const OWNER = 'pblobp'
export const REPOSITORY_URL = 'https://github.com/pblobp/orca-plugins'
export const SOURCE_URL = 'https://github.com/pblobp/orca-plugins.git'
export const SOURCE_REF = 'main'
export const CATALOG_FILE = 'orca-catalog.json'
export const PLUGIN_ID = /^[a-z0-9][a-z0-9-]{0,63}$/
export const RELEASE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
export const COMMIT_SHA = /^[0-9a-f]{40}$/

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    ...options
  })
  if (result.error) throw result.error
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

export function git(root, args) {
  const result = run('git', args, { cwd: root })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`)
  }
  return result.stdout
}

export function gitOk(root, args) {
  return run('git', args, { cwd: root }).status === 0
}

export function repoRoot(cwd = process.cwd()) {
  return git(cwd, ['rev-parse', '--show-toplevel']).trim()
}

export function fileAt(root, ref, path) {
  const result = run('git', ['show', `${ref}:${path}`], { cwd: root })
  return result.status === 0 ? result.stdout : null
}

export function jsonAt(root, ref, path) {
  const text = fileAt(root, ref, path)
  if (text === null) return null
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

export function readJson(path) {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

export function commitExists(root, sha) {
  return gitOk(root, ['cat-file', '-e', `${sha}^{commit}`])
}

export function isAncestor(root, ancestor, descendant = 'HEAD') {
  return gitOk(root, ['merge-base', '--is-ancestor', ancestor, descendant])
}

export function pluginDirectories(root) {
  const dir = join(root, 'plugins')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => statSync(join(dir, name)).isDirectory())
    .sort()
}

export function pluginIds(root) {
  return pluginDirectories(root).filter(
    (name) => PLUGIN_ID.test(name) && existsSync(join(root, 'plugins', name, 'orca-plugin.json'))
  )
}

export function workingFiles(root, path) {
  const out = git(root, [
    'ls-files',
    '-z',
    '--cached',
    '--others',
    '--exclude-standard',
    '--',
    path
  ])
  return [...new Set(out.split('\0').filter(Boolean))].sort()
}

export function folderDiffers(root, ref, path) {
  const diff = run('git', ['diff', '--quiet', ref, '--', path], { cwd: root })
  if (diff.status === 1) return true
  if (diff.status !== 0) throw new Error(`git diff ${ref} -- ${path} failed: ${diff.stderr.trim()}`)
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '--', path])
  return untracked.trim() !== ''
}

export function parseSemver(version) {
  if (typeof version !== 'string') return null
  const match = SEMVER.exec(version)
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] ? match[4].split('.') : []
  }
}

export function compareSemver(a, b) {
  const x = parseSemver(a)
  const y = parseSemver(b)
  if (!x || !y) throw new Error(`not a semantic version: ${!x ? a : b}`)
  for (const key of ['major', 'minor', 'patch']) {
    if (x[key] !== y[key]) return x[key] < y[key] ? -1 : 1
  }
  if (x.pre.length === 0 || y.pre.length === 0) {
    return x.pre.length === y.pre.length ? 0 : x.pre.length === 0 ? 1 : -1
  }
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    if (i >= x.pre.length) return -1
    if (i >= y.pre.length) return 1
    const p = x.pre[i]
    const q = y.pre[i]
    if (p === q) continue
    const pn = /^\d+$/.test(p)
    const qn = /^\d+$/.test(q)
    if (pn && qn) return Number(p) < Number(q) ? -1 : 1
    if (pn !== qn) return pn ? -1 : 1
    return p < q ? -1 : 1
  }
  return 0
}

export function releaseTags(root, merged = 'HEAD') {
  if (!gitOk(root, ['rev-parse', '--verify', '--quiet', `${merged}^{commit}`])) return []
  const out = git(root, ['tag', '--list', 'v*', '--merged', merged])
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter((tag) => RELEASE_TAG.test(tag))
    .sort((a, b) => compareSemver(a.slice(1), b.slice(1)))
}

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort()
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value === undefined ? null : value)
}

export function sameJson(a, b) {
  return canonical(a) === canonical(b)
}

export function finish(name, problems, success) {
  if (problems.length > 0) {
    for (const problem of problems) console.error(`${name}: ${problem}`)
    console.error(`${name}: ${problems.length} problem(s)`)
    process.exitCode = 1
  } else {
    console.log(`${name}: ${success}`)
  }
}
