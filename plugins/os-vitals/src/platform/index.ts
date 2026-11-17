import os from 'node:os'
import { darwinProvider, realDarwinCommands } from './darwin.ts'
import { nodeOsProvider } from './fallback.ts'
import type { Provider } from './types.ts'

export type { Provider } from './types.ts'

export function createProvider(platform: string): Provider {
  if (platform === 'darwin') return darwinProvider(os, realDarwinCommands())
  return nodeOsProvider(os, platform)
}
