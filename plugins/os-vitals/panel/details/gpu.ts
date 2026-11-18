import { factRows, meter } from '../cards/common.ts'
import { gpuChartSpec } from '../cards/gpu.ts'
import { createTimeChart } from '../charts.ts'
import { el, setText } from '../dom.ts'
import { minutes, percent, portion, shortSpan } from '../format.ts'
import { timeWindow, type PanelActions, type PanelModel } from '../state.ts'
import { card, detailFrame, detailView, heading, sectionTitle, timeCaption } from './frame.ts'

export function peakText(model: PanelModel): string {
  const start = timeWindow(model).start
  let peak: number | null = null
  for (const sample of model.samples) {
    if (sample.t >= start && sample.gpu !== null && (peak === null || sample.gpu > peak))
      peak = sample.gpu
  }
  return percent(peak)
}

export function createGpuView(actions: PanelActions) {
  const subtitle = el('span', { className: 'vt-sub' })
  const headline = el('div', { className: 'vt-huge', text: '–' })
  const chart = createTimeChart(gpuChartSpec('detail', 'column'))
  const caption = timeCaption()
  const waiting = el('p', { className: 'vt-muted', text: 'Waiting for the first GPU reading.' })
  const usage = card('vt-gpu-h1', [
    el('div', { className: 'vt-card-head' }, [
      el('div', { className: 'vt-head-text' }, [heading('GPU', 'vt-gpu-h1'), subtitle]),
      headline
    ]),
    chart.element,
    caption.element,
    waiting
  ])
  const amount = el('span', { className: 'vt-value' })
  const bar = meter('s1')
  const shared = el('p', {
    className: 'vt-note',
    text: 'Shared with system memory on Apple silicon.'
  })
  const memory = card('vt-gpu-mem', [
    el('div', { className: 'vt-card-head vt-baseline' }, [
      sectionTitle('GPU memory', 'vt-gpu-mem'),
      amount
    ]),
    bar.element,
    shared
  ])
  const facts = factRows(['Renderer', 'Peak'])
  const more = el('section', { className: 'vt-card', attrs: { 'aria-label': 'GPU details' } }, [
    facts.element
  ])
  const frame = detailFrame(actions, [usage, memory, more])

  function update(model: PanelModel): void {
    const gpu = model.gpu
    waiting.hidden = gpu !== null
    setText(subtitle, gpu?.model ?? 'GPU')
    setText(headline, percent(gpu?.utilization))
    chart.update(model.samples, timeWindow(model), minutes(model.historyMs))
    caption.update(model.historyMs)
    const inUse = gpu?.inUse ?? null
    const allocated = gpu?.allocated ?? null
    memory.hidden = inUse === null || allocated === null || allocated <= 0
    if (inUse !== null && allocated !== null && allocated > 0) {
      const dedicated = gpu?.dedicated === true
      setText(
        amount,
        dedicated ? portion(inUse, allocated) : `${portion(inUse, allocated)} allocated`
      )
      bar.set(
        inUse / allocated,
        `${portion(inUse, allocated)} of ${dedicated ? 'GPU memory' : 'allocated GPU memory'} in use`
      )
    }
    shared.hidden = gpu?.dedicated !== false || !(gpu?.model ?? '').startsWith('Apple')
    const [renderer, peak] = facts.values
    facts.rows[0].hidden = gpu === null || gpu.renderer === null
    setText(renderer, percent(gpu?.renderer))
    setText(facts.labels[1], `Peak, ${shortSpan(model.historyMs)}`)
    setText(peak, peakText(model))
  }

  return detailView(frame, update)
}
