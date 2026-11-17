import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { stripTypeScriptTypes } from 'node:module'
import { extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const SERVED = ['plugins/os-vitals/', 'tools/os-vitals/']
const HARNESS = '/tools/os-vitals/harness.html'
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ts': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
}

const { values } = parseArgs({ options: { port: { type: 'string', default: '4178' } } })
const port = Number(values.port)
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error(`--port must be a number from 1024 to 65535, not ${values.port}`)
}

function resolveRequest(url: string): string | null {
  let pathname: string
  try {
    pathname = decodeURIComponent(new URL(url, 'http://localhost').pathname)
  } catch {
    return null
  }
  const file = resolve(ROOT, `.${pathname}`)
  const inside = relative(ROOT, file).split(sep).join('/')
  if (inside.startsWith('..') || !SERVED.some((prefix) => inside.startsWith(prefix))) return null
  return file
}

const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405).end()
    return
  }
  if (request.url === '/' || request.url === '') {
    response.writeHead(302, { location: HARNESS }).end()
    return
  }
  const file = resolveRequest(request.url ?? '/')
  const type = file ? TYPES[extname(file)] : undefined
  if (!file || !type) {
    response.writeHead(404, { 'content-type': 'text/plain' }).end('not found')
    return
  }
  try {
    const bytes = await readFile(file)
    const body =
      extname(file) === '.ts'
        ? Buffer.from(stripTypeScriptTypes(bytes.toString('utf8'), { mode: 'strip' }))
        : bytes
    response.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' })
    response.end(request.method === 'HEAD' ? undefined : body)
  } catch (error) {
    const code = (error as { code?: string }).code
    response.writeHead(code === 'ENOENT' ? 404 : 500, { 'content-type': 'text/plain' })
    response.end(code === 'ENOENT' ? 'not found' : String(error))
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`OS Vitals harness: http://127.0.0.1:${port}${HARNESS}`)
  console.log(
    `Scenarios: ?scenario=normal|loading|error|unsupported|windows|flaky|empty, ?theme=dark|light`
  )
  console.log(
    `Files under ${join(ROOT, 'plugins', 'os-vitals')} and ${join(ROOT, 'tools', 'os-vitals')}`
  )
})
