#!/usr/bin/env node
import { realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CATALOG_FILE,
  COMMIT_SHA,
  OWNER,
  commitExists,
  compareSemver,
  finish,
  folderDiffers,
  jsonAt,
  parseSemver,
  pluginIds,
  readJson,
  releaseTags,
  repoRoot
} from './lib/common.mjs'

export function checkVersions(root) {
  const problems = []
  const notes = []
  const tags = releaseTags(root)
  const catalog = readJson(join(root, CATALOG_FILE))
  const entries = catalog && Array.isArray(catalog.plugins) ? catalog.plugins : []
  if (tags.length === 0) notes.push('no release tag yet, so every plugin is a first release')

  for (const id of pluginIds(root)) {
    const path = `plugins/${id}`
    const manifest = readJson(join(root, path, 'orca-plugin.json'))
    if (!manifest || typeof manifest !== 'object') {
      problems.push(`${path}/orca-plugin.json: missing or not valid JSON`)
      continue
    }
    const version = manifest.version
    if (!parseSemver(version)) {
      problems.push(`${path}/orca-plugin.json: version ${JSON.stringify(version)} is not semver`)
      continue
    }

    for (const tag of tags) {
      const released = jsonAt(root, tag, `${path}/orca-plugin.json`)
      if (!released || !parseSemver(released.version)) continue
      const order = compareSemver(version, released.version)
      if (order < 0) {
        problems.push(`${id}: version ${version} is lower than ${released.version} at ${tag}`)
      } else if (order === 0 && folderDiffers(root, tag, path)) {
        const newest = tag === tags[tags.length - 1]
        problems.push(
          newest
            ? `${id}: ${path}/ changed since ${tag}, so its version must be higher than ${version}`
            : `${id}@${version} was already released at ${tag} with other files; raise the version`
        )
      }
    }

    const entry = entries.find((item) => item && item.id === `${OWNER}.${id}`)
    const releases = entry && Array.isArray(entry.releases) ? entry.releases : []
    for (const release of releases) {
      if (!release || release.version !== version) continue
      if (!COMMIT_SHA.test(release.commit ?? '') || !commitExists(root, release.commit)) continue
      if (folderDiffers(root, release.commit, path)) {
        problems.push(
          `${id}@${version} is already listed in ${CATALOG_FILE} at ${release.commit.slice(0, 12)} with other files; raise the version`
        )
      }
    }
  }
  return { problems, notes }
}

function main() {
  const root = repoRoot()
  const { problems, notes } = checkVersions(root)
  for (const note of notes) console.log(`check-versions: ${note}`)
  finish('check-versions', problems, `${pluginIds(root).length} plugin(s), versions in order`)
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  try {
    main()
  } catch (error) {
    console.error(`check-versions: ${error.message}`)
    process.exitCode = 1
  }
}
