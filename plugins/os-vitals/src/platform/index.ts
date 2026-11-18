import os from 'node:os'
import { darwinProvider, realDarwinCommands } from './darwin.ts'
import { nodeOsProvider } from './fallback.ts'
import { linuxProvider, realLinuxCommands, realLinuxFiles } from './linux.ts'
import type { Provider } from './types.ts'

export type { Provider } from './types.ts'

export function createProvider(platform: string): Provider {
  if (platform === 'darwin') return darwinProvider(os, realDarwinCommands())
  if (platform === 'linux') {
    return linuxProvider(os, realLinuxFiles(), realLinuxCommands(), {
      now: () => Date.now(),
      age: () => process.uptime()
    })
  }
  return nodeOsProvider(os, platform)
}
