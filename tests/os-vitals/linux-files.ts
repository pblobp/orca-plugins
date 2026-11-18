import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { LinuxFiles } from '../../plugins/os-vitals/src/platform/linux.ts'
import type { VolumeSpace } from '../../plugins/os-vitals/src/platform/space.ts'

const NUL_MARK = /\\0/g

export function fixturePath(tree: string, path = ''): string {
  return fileURLToPath(
    new URL(`./fixtures/linux/${tree}/${path.replace(/^\//, '')}`, import.meta.url)
  )
}

export type FixtureFiles = LinuxFiles & { reads: string[] }

export function fixtureFiles(
  tree: string,
  overrides: Partial<LinuxFiles> = {},
  spaces: Record<string, VolumeSpace | null> = {}
): FixtureFiles {
  const reads: string[] = []
  const files: FixtureFiles = {
    reads,
    async read(path) {
      reads.push(path)
      const text = await readFile(fixturePath(tree, path), 'utf8')
      return path.endsWith('/cmdline') ? text.replace(NUL_MARK, '\0') : text
    },
    list: (path) => readdir(fixturePath(tree, path)),
    exists: async (path) => existsSync(fixturePath(tree, path)),
    space: async (path) => (path in spaces ? spaces[path] : { total: 512e9, available: 200e9 }),
    ...overrides
  }
  return files
}
