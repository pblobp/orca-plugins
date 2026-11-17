import { execFileSync } from 'node:child_process'

execFileSync('/bin/sh', ['-c', 'echo hi'])
