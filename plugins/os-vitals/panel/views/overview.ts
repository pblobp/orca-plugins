import { drawCpuChart, readPalette } from '../charts.ts'
import { el, setAttr, setText } from '../dom.ts'
import { count, duration, loadAverage, minutes, percent } from '../format.ts'
import { latestWithCores, type PanelModel, type View } from '../state.ts'

const GAP_FLOOR_MS = 5000

function legendKey(series: string, label: string): { element: HTMLElement; label: HTMLElement } {
  const text = el('span', { text: label })
  const element = el('span', { className: 'vt-key' }, [
    el('span', { className: `vt-swatch vt-${series}`, attrs: { 'aria-hidden': 'true' } }),
    text
  ])
  return { element, label: text }
}

function createCpuCard() {
  const title = el('h2', { className: 'vt-title', text: 'CPU', attrs: { id: 'vt-cpu-title' } })
  const subtitle = el('span', { className: 'vt-sub' })
  const headline = el('div', { className: 'vt-big', text: '–' })
  const canvas = el('canvas', { attrs: { role: 'img' } })
  const user = legendKey('s1', 'User –')
  const system = legendKey('s2', 'System –')
  const cores = el('div', { className: 'vt-cores', attrs: { role: 'img' } })
  const coreCaption = el('div', { className: 'vt-caption' })
  const load = el('span')
  const uptime = el('span')
  const element = el(
    'section',
    { className: 'vt-card', attrs: { 'aria-labelledby': 'vt-cpu-title' } },
    [
      el('div', { className: 'vt-card-head' }, [
        el('div', { className: 'vt-head-text' }, [title, subtitle]),
        headline
      ]),
      el('div', { className: 'vt-chart' }, [canvas]),
      el('div', { className: 'vt-legend' }, [user.element, system.element]),
      el('div', { className: 'vt-cores-block' }, [cores, coreCaption]),
      el('div', { className: 'vt-foot' }, [load, uptime])
    ]
  )
  const bars: HTMLElement[] = []

  function syncBars(total: number): void {
    while (bars.length < total) {
      const bar = el('div', { className: 'vt-core' })
      bars.push(bar)
      cores.append(bar)
    }
    while (bars.length > total) bars.pop()?.remove()
  }

  function update(model: PanelModel): void {
    const { hello, samples } = model
    const latest = samples[samples.length - 1] ?? null
    const coreCount = hello.cores.length
    const coreText = count(coreCount, 'core', 'cores')
    setText(subtitle, hello.cpuModel ? `${hello.cpuModel} · ${coreText}` : coreText)
    setText(headline, percent(latest?.total))
    setText(user.label, `User ${percent(latest?.user)}`)
    setText(system.label, `System ${percent(latest?.system)}`)
    const span = minutes(model.historyMs)
    const reading = latest
      ? `, now user ${percent(latest.user)} and system ${percent(latest.system)}`
      : ', no reading yet'
    setAttr(canvas, 'aria-label', `CPU usage over ${span}, user and system${reading}`)

    syncBars(coreCount)
    const withCores = latestWithCores(samples)
    bars.forEach((bar, index) => {
      const value = withCores?.cores?.[index] ?? 0
      bar.style.height = `${Math.max(2, Math.min(100, value))}%`
    })
    setAttr(cores, 'aria-label', `Load on each of the ${coreText}`)
    setText(coreCaption, coreText)

    const current = model.current
    setText(load, current?.load ? `Load ${loadAverage(current.load)}` : '')
    setText(uptime, current ? `Up ${duration(current.uptime)}` : '')

    const end = latest ? latest.t : Date.now()
    drawCpuChart(
      canvas,
      samples,
      {
        start: end - model.historyMs,
        end,
        gapMs: 3 * Math.max(model.intervalMs, GAP_FLOOR_MS)
      },
      readPalette()
    )
  }

  return { element, update }
}

export function createOverview(): View {
  const cpu = createCpuCard()
  const element = el('div', { className: 'vt-stack' }, [cpu.element])
  return {
    element,
    update(model) {
      cpu.update(model)
    }
  }
}
