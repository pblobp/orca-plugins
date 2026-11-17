#!/usr/bin/env node
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import {
  CATALOG_FILE,
  COMMIT_SHA,
  OWNER,
  PLUGIN_ID,
  SOURCE_REF,
  SOURCE_URL,
  commitExists,
  compareSemver,
  finish,
  folderDiffers,
  isAncestor,
  jsonAt,
  parseSemver,
  pluginIds,
  readJson,
  repoRoot,
  run,
  sameJson
} from './lib/common.mjs'

const MAX_RELEASES = 32

function orcaCommand() {
  return process.env.ORCA_CLI || 'orca'
}

function orcaJson(args, cwd) {
  let result
  try {
    result = run(orcaCommand(), [...args, '--json'], { cwd })
  } catch (error) {
    return { error: error.message }
  }
  try {
    return { status: result.status, json: JSON.parse(result.stdout) }
  } catch {
    return { status: result.status, error: (result.stderr || result.stdout).trim().slice(0, 500) }
  }
}

function releaseEntryAt(root, commit, path) {
  const dir = mkdtempSync(join(tmpdir(), 'orca-release-entry-'))
  try {
    const clone = run('git', ['clone', '--quiet', '--shared', '--no-checkout', root, dir])
    if (clone.status !== 0) return { error: `git clone failed: ${clone.stderr.trim()}` }
    const checkout = run(
      'git',
      ['-c', 'advice.detachedHead=false', 'checkout', '--quiet', '--detach', commit],
      { cwd: dir }
    )
    if (checkout.status !== 0) return { error: `git checkout failed: ${checkout.stderr.trim()}` }
    const out = orcaJson(['plugin', 'release-entry', join(dir, path)], dir)
    if (out.error) return { error: out.error }
    if (out.status !== 0 || !out.json.ok) {
      return { error: out.json.error?.message ?? `exit ${out.status}` }
    }
    return { entry: out.json.result.entry, sourcePath: out.json.result.sourcePath }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function checkShape(catalog, problems) {
  if (catalog === null) {
    problems.push(`${CATALOG_FILE} is missing`)
    return false
  }
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
    problems.push(`${CATALOG_FILE} is not a JSON object`)
    return false
  }
  if (catalog.catalogVersion !== 2) problems.push('catalogVersion must be 2')
  if (catalog.owner !== OWNER) problems.push(`owner must be "${OWNER}"`)
  if (typeof catalog.name !== 'string' || catalog.name.trim() === '') {
    problems.push('name must be a non-empty string')
  }
  if (!Array.isArray(catalog.plugins)) {
    problems.push('plugins must be an array')
    return false
  }
  return true
}

function checkEntry(root, entry, seen, problems) {
  const label = entry && typeof entry.id === 'string' ? entry.id : '(entry without an id)'
  const match = typeof entry?.id === 'string' ? /^([^.]+)\.(.+)$/.exec(entry.id) : null
  if (!match || match[1] !== OWNER || !PLUGIN_ID.test(match[2])) {
    problems.push(`${label}: id must be "${OWNER}.<plugin id>"`)
    return null
  }
  const id = match[2]
  if (seen.has(entry.id)) problems.push(`${entry.id}: listed more than once`)
  seen.add(entry.id)

  const source = entry.source ?? {}
  if (source.kind !== 'git') problems.push(`${entry.id}: source.kind must be "git"`)
  if (source.url !== SOURCE_URL) problems.push(`${entry.id}: source.url must be "${SOURCE_URL}"`)
  if (source.ref !== SOURCE_REF) problems.push(`${entry.id}: source.ref must be "${SOURCE_REF}"`)
  if (source.path !== `plugins/${id}`) {
    problems.push(`${entry.id}: source.path must be "plugins/${id}"`)
  }

  if (!Array.isArray(entry.releases) || entry.releases.length === 0) {
    problems.push(`${entry.id}: releases must be a non-empty array`)
    return id
  }
  if (entry.releases.length > MAX_RELEASES) {
    problems.push(`${entry.id}: at most ${MAX_RELEASES} releases are allowed`)
  }

  let previous = null
  for (const release of entry.releases) {
    const version = release?.version
    const at = `${entry.id}@${version}`
    if (!parseSemver(version)) {
      problems.push(`${entry.id}: release version ${JSON.stringify(version)} is not semver`)
      continue
    }
    if (previous !== null && compareSemver(previous, version) <= 0) {
      problems.push(`${at}: releases must be newest first, each version listed once`)
    }
    previous = version
    if (!COMMIT_SHA.test(release.commit ?? '')) {
      problems.push(`${at}: commit must be a full 40-character SHA`)
      continue
    }
    if (!commitExists(root, release.commit)) {
      problems.push(`${at}: commit ${release.commit} does not exist in this repository`)
      continue
    }
    if (!isAncestor(root, release.commit)) {
      problems.push(`${at}: commit ${release.commit} is not an ancestor of HEAD`)
      continue
    }
    const manifest = jsonAt(root, release.commit, `plugins/${id}/orca-plugin.json`)
    if (!manifest) {
      problems.push(`${at}: plugins/${id}/orca-plugin.json does not exist at ${release.commit}`)
    } else if (manifest.id !== id || manifest.version !== version) {
      problems.push(
        `${at}: plugins/${id}/orca-plugin.json at ${release.commit} has id ${JSON.stringify(manifest.id)} and version ${JSON.stringify(manifest.version)}`
      )
    }
  }
  return id
}

function checkKept(root, base, catalog, problems) {
  const before = jsonAt(root, base, CATALOG_FILE)
  if (before === null) return
  if (!before || !Array.isArray(before.plugins)) {
    problems.push(
      `${CATALOG_FILE} at ${base} cannot be read, so listed releases cannot be compared`
    )
    return
  }
  for (const old of before.plugins) {
    const now = catalog.plugins.find((entry) => entry?.id === old?.id)
    for (const release of old?.releases ?? []) {
      const at = `${old.id}@${release?.version}`
      const kept = now?.releases?.find((item) => item?.version === release?.version)
      if (!kept) problems.push(`${at}: a listed release was removed`)
      else if (!sameJson(kept, release)) problems.push(`${at}: a listed release was changed`)
    }
  }
}

function checkCurrent(root, catalog, problems) {
  for (const id of pluginIds(root)) {
    const manifest = readJson(join(root, 'plugins', id, 'orca-plugin.json'))
    const entry = catalog.plugins.find((item) => item?.id === `${OWNER}.${id}`)
    const newest = entry?.releases?.[0]
    if (!newest) {
      problems.push(`plugins/${id}: not listed in ${CATALOG_FILE}`)
      continue
    }
    if (newest.version !== manifest?.version) {
      problems.push(
        `plugins/${id}: version ${manifest?.version} is not the newest release in ${CATALOG_FILE} (${newest.version})`
      )
      continue
    }
    if (COMMIT_SHA.test(newest.commit ?? '') && commitExists(root, newest.commit)) {
      if (folderDiffers(root, newest.commit, `plugins/${id}`)) {
        problems.push(`plugins/${id}: files differ from the listed commit ${newest.commit}`)
      }
    }
  }
}

function orcaVersion(root) {
  try {
    const result = run(orcaCommand(), ['--version'], { cwd: root })
    return result.status === 0 ? { version: result.stdout.trim() } : { error: result.stderr.trim() }
  } catch (error) {
    return { error: error.message }
  }
}

function checkWithOrca(root, catalog, problems) {
  const available = orcaVersion(root)
  if (available.error !== undefined) {
    problems.push(`the orca CLI is not available: ${available.error}`)
    return
  }
  const validated = orcaJson(['plugin', 'validate', CATALOG_FILE], root)
  if (validated.error) {
    problems.push(`orca plugin validate ${CATALOG_FILE} failed: ${validated.error}`)
  } else if (validated.status !== 0 || !validated.json.ok || !validated.json.result?.valid) {
    const errors = validated.json.result?.errors ?? [validated.json.error?.message]
    problems.push(`orca plugin validate ${CATALOG_FILE}: ${JSON.stringify(errors)}`)
  }
  for (const entry of catalog.plugins) {
    const id = /^[^.]+\.(.+)$/.exec(entry?.id ?? '')?.[1]
    const newest = entry?.releases?.[0]
    if (!id || !PLUGIN_ID.test(id) || !newest || !COMMIT_SHA.test(newest.commit ?? '')) continue
    if (!commitExists(root, newest.commit)) continue
    const at = `${entry.id}@${newest.version}`
    const printed = releaseEntryAt(root, newest.commit, `plugins/${id}`)
    if (printed.error) {
      problems.push(`${at}: orca plugin release-entry failed: ${printed.error}`)
      continue
    }
    for (const [key, value] of Object.entries(printed.entry)) {
      if (!sameJson(newest[key], value)) {
        problems.push(
          `${at}: ${key} is ${JSON.stringify(newest[key])} in the catalog, but release-entry prints ${JSON.stringify(value)}`
        )
      }
    }
    if (printed.sourcePath !== entry.source?.path) {
      problems.push(`${at}: release-entry prints sourcePath ${JSON.stringify(printed.sourcePath)}`)
    }
  }
}

export function checkCatalog(root, options = {}) {
  const problems = []
  const catalog = readJson(join(root, CATALOG_FILE))
  if (!checkShape(catalog, problems)) return problems
  const seen = new Set()
  for (const entry of catalog.plugins) checkEntry(root, entry, seen, problems)
  if (options.base) checkKept(root, options.base, catalog, problems)
  if (options.requireCurrent) checkCurrent(root, catalog, problems)
  if (options.withOrca) checkWithOrca(root, catalog, problems)
  return problems
}

function main() {
  const { values } = parseArgs({
    options: {
      base: { type: 'string' },
      'with-orca': { type: 'boolean', default: false },
      'require-current': { type: 'boolean', default: false }
    }
  })
  const root = repoRoot()
  if (values.base && !commitExists(root, values.base)) {
    throw new Error(`base ${values.base} is not a commit in this repository`)
  }
  const problems = checkCatalog(root, {
    base: values.base,
    withOrca: values['with-orca'],
    requireCurrent: values['require-current']
  })
  const catalog = readJson(join(root, CATALOG_FILE))
  const count = Array.isArray(catalog?.plugins) ? catalog.plugins.length : 0
  finish('check-catalog', problems, `${count} plugin(s) listed, every release checked`)
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  try {
    main()
  } catch (error) {
    console.error(`check-catalog: ${error.message}`)
    process.exitCode = 1
  }
}
