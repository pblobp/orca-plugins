import { execFile } from 'node:child_process'

export function runOrcaCli(program: string, args: string[], done: (failed: boolean) => void): void {
  execFile(program, args, { timeout: 5000, shell: true }, (error) => done(Boolean(error)))
}
