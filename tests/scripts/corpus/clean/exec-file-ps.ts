import { execFile } from 'node:child_process'

export function listProcesses(done: (output: string) => void): void {
  execFile(
    '/bin/ps',
    ['-A', '-o', 'pid='],
    { timeout: 1500, maxBuffer: 1 << 20, env: { ...process.env, LC_ALL: 'C' }, shell: false },
    (error, stdout) => done(error ? '' : stdout)
  )
}
