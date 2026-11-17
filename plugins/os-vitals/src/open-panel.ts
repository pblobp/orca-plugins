import type { CliResult } from './cli.ts'

export const PLUGIN_ID = 'os-vitals'
export const PANEL_ID = 'os-vitals'

const PLUGIN_KEY = /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/i
const INSTALL_FOLDER = /^([0-9a-f]{16,}|current)$/i

export type ListedPlugin = {
  key: string
  status: string
  isDev: boolean
  hasPanel: boolean
}

export type OpenResult = { opened: true } | { opened: false; reason: string }

export type RunCli = (args: readonly string[]) => Promise<CliResult>

export function keyFromPath(file: string | null, pluginId: string): string | null {
  if (!file) return null
  const parts = file.split(/[\\/]+/)
  for (let index = parts.length - 2; index >= 1; index--) {
    const segment = parts[index]
    if (
      parts[index - 1] === 'plugins' &&
      segment.endsWith(`.${pluginId}`) &&
      PLUGIN_KEY.test(segment) &&
      INSTALL_FOLDER.test(parts[index + 1])
    ) {
      return segment
    }
  }
  return null
}

function envelope(stdout: string): { ok: boolean; result: unknown } {
  try {
    const parsed: unknown = JSON.parse(stdout)
    if (parsed && typeof parsed === 'object') {
      const record = parsed as { ok?: unknown; result?: unknown }
      return { ok: record.ok === true, result: record.result }
    }
  } catch {}
  return { ok: false, result: null }
}

function listsPanel(panels: unknown, panelId: string): boolean {
  if (!Array.isArray(panels)) return false
  return panels.some((panel) => {
    if (typeof panel === 'string') return panel === panelId
    if (panel && typeof panel === 'object' && 'id' in panel) return panel.id === panelId
    return false
  })
}

export function parsePluginList(stdout: string, pluginId: string, panelId: string): ListedPlugin[] {
  const answer = envelope(stdout)
  if (!answer.ok || !answer.result || typeof answer.result !== 'object') return []
  const plugins = (answer.result as { plugins?: unknown }).plugins
  if (!Array.isArray(plugins)) return []
  const listed: ListedPlugin[] = []
  for (const entry of plugins) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const key = typeof record.pluginKey === 'string' ? record.pluginKey : ''
    if (!key.endsWith(`.${pluginId}`) || !PLUGIN_KEY.test(key)) continue
    listed.push({
      key,
      status: typeof record.status === 'string' ? record.status : '',
      isDev: record.isDev === true,
      hasPanel: listsPanel(record.panels, panelId)
    })
  }
  return listed
}

export function chooseKey(
  listed: readonly ListedPlugin[],
  pathKey: string | null,
  pluginId: string
): string | null {
  const usable = listed.filter(
    (plugin) => plugin.hasPanel && (plugin.status === 'running' || plugin.status === 'idle')
  )
  if (pathKey) {
    if (listed.length === 0 || usable.some((plugin) => plugin.key === pathKey)) return pathKey
    return usable.length === 1 ? usable[0].key : null
  }
  const dev = usable.filter((plugin) => plugin.isDev)
  if (dev.length === 1) return dev[0].key
  const local = dev.find((plugin) => plugin.key === `local.${pluginId}`)
  if (local) return local.key
  return usable.length === 1 ? usable[0].key : null
}

export async function openOwnPanel(
  run: RunCli | null,
  workerFile: string | null
): Promise<OpenResult> {
  if (!run) return { opened: false, reason: 'the Orca CLI was not found' }
  const list = await run(['plugin', 'list', '--json'])
  const listed = parsePluginList(list.stdout, PLUGIN_ID, PANEL_ID)
  const key = chooseKey(listed, keyFromPath(workerFile, PLUGIN_ID), PLUGIN_ID)
  if (!key)
    return { opened: false, reason: 'OS Vitals could not find itself in `orca plugin list`' }
  const opened = await run(['plugin', 'open', key, '--panel', PANEL_ID, '--json'])
  if (opened.ok && envelope(opened.stdout).ok) return { opened: true }
  return { opened: false, reason: opened.error ?? 'orca plugin open failed' }
}
