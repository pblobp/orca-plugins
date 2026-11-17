import type {
  Current,
  DetailResult,
  HelloResult,
  MemoryReading,
  PollInput,
  PollResult,
  ProcessPage,
  QuitInput,
  QuitResult,
  Sample,
  ViewName
} from '../src/protocol.ts'
import { el, icon, PAUSE_ICON, PLAY_ICON, setAttr, setText } from './dom.ts'
import { interval } from './format.ts'
import type { PanelActions, PanelModel, View } from './state.ts'
import { createOverview } from './views/overview.ts'
import { createProcesses } from './views/processes.ts'

const REQUEST_TIMEOUT_MS = 10000
const RETRY_MAX_MS = 10000
const VIEW_KEY = 'os-vitals.view'
const VIEW_NAMES: readonly ViewName[] = ['overview', 'processes']

type Phase = 'loading' | 'ready' | 'error' | 'unsupported'

type PanelState = {
  phase: Phase
  hello: HelloResult | null
  run: string | null
  seq: number
  samples: Sample[]
  current: Current | null
  memory: MemoryReading | null
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
  memory: null,
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

function tabButton(label: string, view: ViewName): HTMLButtonElement {
  const button = el('button', { className: 'vt-tab', text: label, attrs: { type: 'button' } })
  button.addEventListener('click', () => {
    if (state.view === view) return
    showView(view)
  })
  return button
}

const app = document.getElementById('app') ?? document.body
const tabs: Record<ViewName, HTMLButtonElement> = {
  overview: tabButton('Overview', 'overview'),
  processes: tabButton('Processes', 'processes')
}
const intervalLabel = el('span', { className: 'vt-interval' })
const pauseButton = el('button', { className: 'vt-icon-button', attrs: { type: 'button' } })
const header = el('header', { className: 'vt-bar' }, [
  el('nav', { className: 'vt-tabs', attrs: { 'aria-label': 'Views' } }, [
    tabs.overview,
    tabs.processes
  ]),
  el('div', { className: 'vt-bar-end' }, [intervalLabel, pauseButton])
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
const content = el('main', { className: 'vt-content' })
const actions: PanelActions = {
  showProcesses: () => showView('processes'),
  queryChanged: () => requestPoll(),
  requestDetail: (pid: number): Promise<DetailResult> =>
    orca.plugin.request('os-vitals.process.detail', { pid }, { timeoutMs: REQUEST_TIMEOUT_MS }),
  requestQuit: (input: QuitInput): Promise<QuitResult> =>
    orca.plugin.request('os-vitals.process.quit', input, { timeoutMs: REQUEST_TIMEOUT_MS })
}
const views: Record<ViewName, View> = {
  overview: createOverview(actions),
  processes: createProcesses(actions)
}

const stateTitle = el('h2', { className: 'vt-title' })
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

app.append(header, banner, content)

let timer: number | undefined
let inFlight = false
let pollAgain = false
let pausedIcon: boolean | null = null

function showView(view: ViewName): void {
  state.view = view
  state.viewChosen = true
  state.processes = null
  saveView(view)
  render()
  requestPoll()
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
    samples: state.samples,
    current: state.current,
    memory: state.memory,
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
  state.memory = result.memory
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
  for (const name of VIEW_NAMES) {
    if (name === state.view) tabs[name].setAttribute('aria-current', 'page')
    else tabs[name].removeAttribute('aria-current')
  }
  setText(intervalLabel, state.paused ? 'Paused' : interval(state.intervalMs))
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
  const view = views[state.view]
  content.dataset.view = state.view
  showOnly(view.element)
  const current = model()
  if (current) view.update(current)
}

pauseButton.addEventListener('click', () => {
  state.paused = !state.paused
  if (state.paused) cancel()
  render()
  if (!state.paused) void pollNow()
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
  if (event.key !== 'Escape' || state.phase !== 'ready') return
  if (views[state.view].escape()) event.preventDefault()
})

orca.on('theme', () => render())

void start()
