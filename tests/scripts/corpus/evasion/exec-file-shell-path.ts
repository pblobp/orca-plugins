import { execFile } from 'node:child_process'

execFile('/bin/ps', ['-A'], { shell: '/bin/zsh' })
