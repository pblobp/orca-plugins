import os from 'node:os'
import { nodeOsProvider } from './fallback.ts'
import type { Provider } from './types.ts'

export type { Provider } from './types.ts'

export function createProvider(platform: string): Provider {
  return nodeOsProvider(os, platform)
}
