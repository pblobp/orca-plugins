import os from 'node:os'

export const cores = os.cpus().length
export const platform = process.platform
