import { spawnSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.HARNESS ?? 'http://127.0.0.1:4178/tools/os-vitals/media'
const OUT = fileURLToPath(new URL('../../plugins/os-vitals/media/', import.meta.url))

const IMAGES: readonly [
  page: string,
  file: string,
  width: number,
  height: number,
  scale: number
][] = [
  ['icon.html', 'icon.png', 256, 256, 2],
  ['cover.html', 'cover.png', 1000, 625, 1.6],
  ['shot-overview.html', 'overview.png', 800, 500, 2],
  ['shot-processes.html', 'processes.png', 1000, 625, 1.6],
  ['shot-details.html', 'details.png', 800, 500, 2],
  ['shot-network.html', 'network.png', 800, 500, 2]
]

const only = process.argv.slice(2)
for (const [page, file, width, height, scale] of IMAGES) {
  if (only.length > 0 && !only.includes(file)) continue
  const result = spawnSync(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--hide-scrollbars',
      '--default-background-color=00000000',
      `--force-device-scale-factor=${scale}`,
      `--user-data-dir=/tmp/os-vitals-media-${file}`,
      `--window-size=${width},${height}`,
      '--virtual-time-budget=9000',
      `--screenshot=${OUT}${file}`,
      `${BASE}/${page}`
    ],
    { stdio: 'ignore' }
  )
  if (result.status !== 0) throw new Error(`Chrome could not render ${page}`)
  const size = Math.round(statSync(`${OUT}${file}`).size / 1024)
  console.log(`${file}: ${Math.round(width * scale)}×${Math.round(height * scale)}, ${size} KB`)
}
