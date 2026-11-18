import type {
  BatteryReading,
  Current,
  DetailResult,
  DetailView,
  DiskReading,
  EnergyReading,
  GpuReading,
  HelloResult,
  MemoryReading,
  NetworkReading,
  PollInput,
  PollResult,
  ProcessPage,
  QuitInput,
  QuitResult,
  Sample,
  Sections,
  TopView,
  ViewName,
  Volume
} from '../src/protocol.ts'
import { createCpuView } from './details/cpu.ts'
import { createDiskView } from './details/disk.ts'
import { createEnergyView } from './details/energy.ts'
import { createGpuView } from './details/gpu.ts'
import { createMemoryView } from './details/memory.ts'
import { createNetworkView } from './details/network.ts'
import { el, icon, PAUSE_ICON, PLAY_ICON, setAttr, setText } from './dom.ts'
import { clockTime, interval } from './format.ts'
import { detailAvailable, type PanelActions, type PanelModel, type View } from './state.ts'
import { createOverview } from './views/overview.ts'
import { createProcesses } from './views/processes.ts'

const REQUEST_TIMEOUT_MS = 10000
const RETRY_MAX_MS = 10000
const VIEW_KEY = 'os-vitals.view'
const TOP_VIEWS: readonly TopView[] = ['overview', 'processes']
const DETAIL_VIEWS: readonly DetailView[] = ['cpu', 'memory', 'network', 'disk', 'gpu', 'energy']
const VIEW_NAMES: readonly ViewName[] = [...TOP_VIEWS, ...DETAIL_VIEWS]

type Phase = 'loading' | 'ready' | 'error' | 'unsupported'

type PanelState = {
  phase: Phase
  hello: HelloResult | null
  run: string | null
  seq: number
  samples: Sample[]
  current: Current | null
  sections: Sections | null
  memory: MemoryReading | null
  network: NetworkReading | null
  disk: DiskReading | null
  volumes: Volume[] | null
  gpu: GpuReading | null
  battery: BatteryReading | null
  energy: EnergyReading | null
  processes: ProcessPage | null
  intervalMs: number
  historyMs: number
  view: ViewName
  viewChosen: boolean
  paused: boolean
  failures: number
  errorCode: string
}

const state: PanelState = {
  phase: 'loading',
  hello: null,
  run: null,
  seq: 0,
  samples: [],
  current: null,
  sections: null,
  memory: null,
  network: null,
  disk: null,
  volumes: null,
  gpu: null,
  battery: null,
  energy: null,
  processes: null,
  intervalMs: 2000,
  historyMs: 5 * 60 * 1000,
  view: 'overview',
  viewChosen: false,
  paused: false,
  failures: 0,
  errorCode: ''
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code
  }
  return 'action_failed'
}

function savedView(): ViewName | null {
  try {
    const value = localStorage.getItem(VIEW_KEY)
    return VIEW_NAMES.find((name) => name === value) ?? null
  } catch {
    return null
  }
}

function saveView(view: ViewName): void {
  try {
    localStorage.setItem(VIEW_KEY, view)
  } catch {}
}

function initialView(hello: HelloResult): ViewName {
  if (hello.defaultView === 'overview' || hello.defaultView === 'processes')
    return hello.defaultView
  return savedView() ?? 'overview'
}

function isDetail(view: ViewName): view is DetailView {
  return DETAIL_VIEWS.some((name) => name === view)
}

function topOf(view: ViewName): TopView {
  return view === 'processes' ? 'processes' : 'overview'
}

function tabButton(label: string, view: TopView): HTMLButtonElement {
  const button = el('button', {
    className: 'vt-tab',
    text: label,
    attrs: { type: 'button', role: 'tab', id: `vt-tab-${view}`, 'aria-controls': 'vt-content' }
  })
  button.addEventListener('click', () => {
    if (state.view === view) return
    showView(view)
  })
  return button
}

const app = document.getElementById('app') ?? document.body
const tabs: Record<TopView, HTMLButtonElement> = {
  overview: tabButton('Overview', 'overview'),
  processes: tabButton('Processes', 'processes')
}
const intervalLabel = el('span', { className: 'vt-interval' })
const pauseButton = el('button', { className: 'vt-icon-button', attrs: { type: 'button' } })
const tabList = el(
  'div',
  { className: 'vt-tabs', attrs: { role: 'tablist', 'aria-label': 'Views' } },
  [tabs.overview, tabs.processes]
)
tabList.addEventListener('keydown', (event) => {
  const index = TOP_VIEWS.indexOf(topOf(state.view))
  const moves = new Map<string, number>([
    ['ArrowRight', (index + 1) % TOP_VIEWS.length],
    ['ArrowLeft', (index + TOP_VIEWS.length - 1) % TOP_VIEWS.length],
    ['Home', 0],
    ['End', TOP_VIEWS.length - 1]
  ])
  const next = moves.get(event.key)
  if (next === undefined) return
  event.preventDefault()
  const view = TOP_VIEWS[next]
  if (state.view !== view) showView(view)
  tabs[view].focus()
})
const header = el('header', { className: 'vt-bar' }, [
  tabList,
  el('div', { className: 'vt-bar-end' }, [intervalLabel, pauseButton])
])
const pausedText = el('span')
const pausedResume = el('button', {
  className: 'vt-button',
  text: 'Resume',
  attrs: { type: 'button' }
})
const pausedBanner = el('div', { className: 'vt-banner vt-paused', attrs: { role: 'status' } }, [
  pausedText,
  pausedResume
])
const bannerText = el('span', { text: 'The worker did not answer. Retrying.' })
const bannerRetry = el('button', {
  className: 'vt-button',
  text: 'Retry',
  attrs: { type: 'button' }
})
const banner = el('div', { className: 'vt-banner', attrs: { role: 'status' } }, [
  bannerText,
  bannerRetry
])
const content = el('main', {
  className: 'vt-content',
  attrs: { id: 'vt-content', role: 'tabpanel' }
})
const openers = new Map<DetailView, HTMLElement>()
const actions: PanelActions = {
  showProcesses: () => showView('processes'),
  openView(view, opener) {
    if (opener) openers.set(view, opener)
    showView(view)
    views[view].enter?.()
  },
  back: () => goBack(),
  queryChanged: () => requestPoll(),
  requestDetail: (pid: number): Promise<DetailResult> =>
    orca.plugin.request('os-vitals.process.detail', { pid }, { timeoutMs: REQUEST_TIMEOUT_MS }),
  requestQuit: (input: QuitInput): Promise<QuitResult> =>
    orca.plugin.request('os-vitals.process.quit', input, { timeoutMs: REQUEST_TIMEOUT_MS })
}
const views: Record<ViewName, View> = {
  overview: createOverview(actions),
  processes: createProcesses(actions),
  cpu: createCpuView(actions),
  memory: createMemoryView(actions),
  network: createNetworkView(actions),
  disk: createDiskView(actions),
  gpu: createGpuView(actions),
  energy: createEnergyView(actions)
}

const stateTitle = el('h1', { className: 'vt-title' })
const stateText = el('p', { className: 'vt-muted' })
const stateRetry = el('button', {
  className: 'vt-button',
  text: 'Retry',
  attrs: { type: 'button' }
})
const stateBox = el(
  'section',
  { className: 'vt-card vt-state', attrs: { 'aria-live': 'polite' } },
  [stateTitle, stateText, stateRetry]
)

app.append(header, pausedBanner, banner, content)

let timer: number | undefined
let inFlight = false
let pollAgain = false
let pausedIcon: boolean | null = null

function showView(view: ViewName): void {
  const leaving = state.view
  state.view = view
  state.viewChosen = true
  state.processes = null
  if (view !== 'energy') state.energy = null
  saveView(view)
  if (leaving !== view) window.scrollTo(0, 0)
  render()
  requestPoll()
}

function goBack(): void {
  const from = state.view
  showView('overview')
  const opener = isDetail(from) ? openers.get(from) : undefined
  if (opener && opener.isConnected) opener.focus()
}

function requestPoll(): void {
  if (inFlight) {
    pollAgain = true
    return
  }
  cancel()
  void pollNow()
}

function model(): PanelModel | null {
  if (!state.hello) return null
  return {
    hello: state.hello,
    sections: state.sections ?? state.hello.sections,
    samples: state.samples,
    current: state.current,
    memory: state.memory,
    network: state.network,
    disk: state.disk,
    volumes: state.volumes,
    gpu: state.gpu,
    battery: state.battery,
    energy: state.energy,
    processes: state.processes,
    intervalMs: state.intervalMs,
    historyMs: state.historyMs
  }
}

function cancel(): void {
  if (timer !== undefined) window.clearTimeout(timer)
  timer = undefined
}

function canPoll(): boolean {
  return state.phase === 'ready' && !state.paused && document.visibilityState !== 'hidden'
}

function schedule(ms: number): void {
  cancel()
  if (!canPoll()) return
  timer = window.setTimeout(pollNow, ms)
}

function merge(result: PollResult): void {
  if (result.reset || result.run !== state.run) state.samples = []
  state.run = result.run
  state.seq = result.seq
  state.current = result.current
  state.sections = result.sections
  state.memory = result.memory
  state.network = result.network
  state.disk = result.disk
  state.volumes = result.volumes
  state.gpu = result.gpu
  state.battery = result.battery
  state.energy = result.energy
  state.processes = result.processes
  state.intervalMs = result.intervalMs
  state.historyMs = result.historyMs
  for (const sample of result.samples) state.samples.push(sample)
  const newest = state.samples[state.samples.length - 1]
  if (newest) {
    const oldest = newest.t - state.historyMs
    const first = state.samples.findIndex((sample) => sample.t >= oldest)
    if (first > 0) state.samples.splice(0, first)
  }
}

async function pollNow(): Promise<void> {
  timer = undefined
  if (inFlight || !canPoll()) return
  inFlight = true
  const input: PollInput = { since: state.seq, view: state.view }
  if (state.run) input.run = state.run
  const current = model()
  const query = current ? views[state.view].query(current) : null
  if (query) input.processes = query
  try {
    merge(await orca.plugin.request('os-vitals.poll', input, { timeoutMs: REQUEST_TIMEOUT_MS }))
    state.failures = 0
  } catch (error) {
    state.failures += 1
    state.errorCode = errorCode(error)
  } finally {
    inFlight = false
  }
  render()
  if (pollAgain) {
    pollAgain = false
    cancel()
    void pollNow()
    return
  }
  const delay =
    state.failures > 0
      ? Math.min(RETRY_MAX_MS, state.intervalMs * 2 ** state.failures)
      : state.intervalMs
  schedule(delay)
}

async function start(): Promise<void> {
  cancel()
  state.phase = 'loading'
  render()
  try {
    const hello = await orca.plugin.request('os-vitals.hello', undefined, {
      timeoutMs: REQUEST_TIMEOUT_MS
    })
    state.hello = hello
    state.intervalMs = hello.intervalMs
    state.historyMs = hello.historyMs
    if (!hello.sections.cpu) {
      state.phase = 'unsupported'
      render()
      return
    }
    if (!state.viewChosen) state.view = initialView(hello)
    state.phase = 'ready'
    state.failures = 0
    render()
    await pollNow()
  } catch (error) {
    state.phase = 'error'
    state.errorCode = errorCode(error)
    render()
  }
}

function retry(): void {
  if (state.phase === 'ready') {
    cancel()
    void pollNow()
  } else {
    void start()
  }
}

function showOnly(node: HTMLElement): void {
  if (content.firstElementChild !== node || content.childElementCount !== 1) {
    content.replaceChildren(node)
  }
}

function renderState(): void {
  stateRetry.hidden = state.phase !== 'error'
  if (state.phase === 'loading') {
    setText(stateTitle, 'Starting OS Vitals')
    setText(stateText, 'Waiting for the first reading.')
  } else if (state.phase === 'error') {
    setText(stateTitle, 'The worker did not answer')
    setText(stateText, `OS Vitals could not reach its background process (${state.errorCode}).`)
  } else {
    setText(stateTitle, 'CPU usage is not available')
    setText(stateText, 'This system does not report CPU times, so OS Vitals has nothing to show.')
  }
  setAttr(stateBox, 'data-phase', state.phase)
  content.removeAttribute('data-view')
  showOnly(stateBox)
}

function render(): void {
  for (const name of TOP_VIEWS) {
    const selected = name === topOf(state.view)
    setAttr(tabs[name], 'aria-selected', selected ? 'true' : 'false')
    setAttr(tabs[name], 'tabindex', selected ? '0' : '-1')
  }
  setAttr(content, 'aria-labelledby', `vt-tab-${topOf(state.view)}`)
  const newest = state.samples[state.samples.length - 1]
  pausedBanner.hidden = !(state.paused && state.phase === 'ready')
  setText(
    pausedText,
    newest ? `Paused. The last reading is from ${clockTime(newest.t)}.` : 'Paused. No reading yet.'
  )
  const measuring =
    state.view === 'energy' && state.hello && (state.sections ?? state.hello.sections).energy
  const every = measuring && state.hello ? state.hello.energyIntervalMs : state.intervalMs
  setText(intervalLabel, state.paused ? 'Paused' : interval(every))
  setAttr(pauseButton, 'aria-label', state.paused ? 'Resume sampling' : 'Pause sampling')
  if (pausedIcon !== state.paused) {
    pauseButton.replaceChildren(icon(state.paused ? PLAY_ICON : PAUSE_ICON))
    pausedIcon = state.paused
  }
  pauseButton.disabled = state.phase !== 'ready'
  banner.hidden = !(state.phase === 'ready' && state.failures > 0)
  setText(bannerText, `The worker did not answer (${state.errorCode}). Retrying.`)

  if (state.phase !== 'ready' || !state.hello) {
    renderState()
    return
  }
  const current = model()
  if (current && isDetail(state.view) && !detailAvailable(state.view, current)) {
    state.view = 'overview'
    saveView('overview')
  }
  const view = views[state.view]
  content.dataset.view = state.view
  app.classList.toggle('vt-fill', state.view === 'processes')
  showOnly(view.element)
  if (current) view.update(current)
}

function setPaused(paused: boolean): void {
  state.paused = paused
  if (paused) cancel()
  render()
  if (!paused) void pollNow()
}

pauseButton.addEventListener('click', () => setPaused(!state.paused))
pausedResume.addEventListener('click', () => {
  setPaused(false)
  pauseButton.focus()
})
bannerRetry.addEventListener('click', retry)
stateRetry.addEventListener('click', retry)

document.addEventListener('visibilitychange', () => {
  cancel()
  if (document.visibilityState === 'visible') void pollNow()
})

let frame = 0
new ResizeObserver(() => {
  if (frame) return
  frame = window.requestAnimationFrame(() => {
    frame = 0
    render()
  })
}).observe(content)

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || state.phase !== 'ready' || event.defaultPrevented) return
  if (views[state.view].escape()) {
    event.preventDefault()
    return
  }
  if (isDetail(state.view)) {
    event.preventDefault()
    goBack()
  }
})

orca.on('theme', () => render())

void start()
