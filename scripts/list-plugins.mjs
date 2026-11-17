#!/usr/bin/env node
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { git, gitOk, pluginIds, repoRoot, run } from './lib/common.mjs'

const NO_PLUGIN_EFFECT = [
  /^[^/]+\.md$/,
  /^LICENSE$/,
  /^docs\//,
  /^orca-catalog\.json$/,
  /^\.editorconfig$/,
  /^\.gitignore$/,
  /^\.prettierignore$/,
  /^policy\/README\.md$/,
  /^tests\/scripts\//,
  /^\.github\/ISSUE_TEMPLATE\//,
  /^\.github\/pull_request_template\.md$/,
  /^\.github\/CODEOWNERS$/,
  /^\.github\/dependabot\.yml$/,
  /^\.github\/workflows\/codeql\.yml$/,
  /^\.github\/workflows\/scorecard\.yml$/
]

export function affectedPlugins(paths, all) {
  const known = new Set(all)
  const hit = new Set()
  for (const path of paths) {
    const owned =
      /^plugins\/([^/]+)\//.exec(path) ||
      /^tests\/(?!scripts\/)([^/]+)\//.exec(path) ||
      /^tools\/([^/]+)\//.exec(path) ||
      /^policy\/([^/]+)\.json$/.exec(path)
    if (owned) {
      if (known.has(owned[1])) hit.add(owned[1])
      continue
    }
    if (NO_PLUGIN_EFFECT.some((pattern) => pattern.test(path))) continue
    return [...all]
  }
  return all.filter((id) => hit.has(id))
}

export function changedPaths(root, base) {
  if (!gitOk(root, ['cat-file', '-e', `${base}^{commit}`])) {
    throw new Error(`base ${base} is not a commit in this repository`)
  }
  const mergeBase = run('git', ['merge-base', base, 'HEAD'], { cwd: root })
  const from = mergeBase.status === 0 ? mergeBase.stdout.trim() : base
  const tracked = git(root, ['diff', '--name-only', '-z', from, '--'])
  const untracked = git(root, ['ls-files', '-z', '--others', '--exclude-standard'])
  return [...new Set([...tracked.split('\0'), ...untracked.split('\0')].filter(Boolean))].sort()
}

export function listPlugins(root, base) {
  const all = pluginIds(root)
  return base ? affectedPlugins(changedPaths(root, base), all) : all
}

function main() {
  const { values } = parseArgs({ options: { base: { type: 'string' } } })
  const plugins = listPlugins(repoRoot(), values.base)
  process.stdout.write(`plugins=${JSON.stringify(plugins)}\nany=${plugins.length > 0}\n`)
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  try {
    main()
  } catch (error) {
    console.error(`list-plugins: ${error.message}`)
    process.exitCode = 1
  }
}
