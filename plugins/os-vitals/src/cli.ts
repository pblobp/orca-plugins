import { execFile } from 'node:child_process'
import { accessSync, constants, statSync } from 'node:fs'
import { posix } from 'node:path'

export const CLI_TIMEOUT_MS = 10000
export const CLI_MAX_BUFFER = 4 * 1024 * 1024

export type CliEnvironment = {
  platform: string
  execPath: string
}

export type CliResult = {
  ok: boolean
  stdout: string
  stderr: string
  error: string | null
}

export function outermostApp(execPath: string): string | null {
  const parts = execPath.split('/')
  const index = parts.findIndex((part) => part.length > 4 && part.endsWith('.app'))
  if (index < 1) return null
  return parts.slice(0, index + 1).join('/')
}

export function cliCandidate(env: CliEnvironment): string | null {
  const execPath = env.execPath
  if (typeof execPath !== 'string' || !posix.isAbsolute(execPath)) return null
  if (env.platform === 'darwin') {
    const app = outermostApp(execPath)
    return app ? posix.join(app, 'Contents', 'Resources', 'bin', 'orca') : null
  }
  if (env.platform === 'linux') {
    return posix.join(posix.dirname(execPath), 'resources', 'bin', 'orca-ide')
  }
  return null
}

export function isRunnable(file: string): boolean {
  try {
    if (!statSync(file).isFile()) return false
    accessSync(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}

export function locateCli(
  env: CliEnvironment,
  runnable: (file: string) => boolean = isRunnable
): string | null {
  const candidate = cliCandidate(env)
  return candidate && runnable(candidate) ? candidate : null
}

export function runOrcaCli(
  program: string,
  args: readonly string[],
  signal: AbortSignal,
  done: (result: CliResult) => void
): void {
  try {
    execFile(
      program,
      [...args],
      {
        encoding: 'utf8',
        timeout: CLI_TIMEOUT_MS,
        maxBuffer: CLI_MAX_BUFFER,
        env: { ...process.env, LC_ALL: 'C' },
        windowsHide: true,
        signal
      },
      (error, stdout, stderr) => {
        done({ ok: !error, stdout, stderr, error: error ? error.message : null })
      }
    )
  } catch (error) {
    done({
      ok: false,
      stdout: '',
      stderr: '',
      error: error instanceof Error ? error.message : 'failed'
    })
  }
}
