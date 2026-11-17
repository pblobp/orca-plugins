import { spawn } from 'node:child_process'

spawn('/bin/ps', [], { shell: true })
