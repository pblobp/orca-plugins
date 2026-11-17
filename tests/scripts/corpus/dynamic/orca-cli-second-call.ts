import { execFile, spawn } from 'node:child_process'

export function runOrcaCli(program: string, args: string[], done: (failed: boolean) => void): void {
  execFile(program, args, { timeout: 5000 }, (error) => done(Boolean(error)))
}

export function runAnything(program: string) {
  return spawn(program, [])
}
