import type { BlockerKind, EnergyImpact, SleepBlocker } from '../../src/protocol.ts'
import { batteryEstimate, batteryLabel, batteryState } from '../cards/battery.ts'
import { meter } from '../cards/common.ts'
import { el, setText } from '../dom.ts'
import { percent } from '../format.ts'
import type { PanelActions, PanelModel } from '../state.ts'
import { card, detailFrame, detailView, heading, sectionTitle } from './frame.ts'

type ImpactRow = { element: HTMLElement; name: HTMLElement; fill: HTMLElement; value: HTMLElement }
type BlockerRow = { element: HTMLElement; name: HTMLElement; why: HTMLElement }

export function blockerText(kinds: readonly BlockerKind[]): string {
  return kinds.includes('display') ? 'Keeps the display on' : 'Prevents sleep'
}

export function impactText(value: number): string {
  return value.toFixed(1)
}

export function createEnergyView(actions: PanelActions) {
  const source = el('span', { className: 'vt-sub' })
  const level = el('div', { className: 'vt-huge', text: '–' })
  const bar = meter('s3')
  const time = el('span')
  const state = el('span')
  const battery = card('vt-battery-h1', [
    el('div', { className: 'vt-card-head' }, [
      el('div', { className: 'vt-head-text' }, [heading('Battery', 'vt-battery-h1'), source]),
      level
    ]),
    bar.element,
    el('div', { className: 'vt-foot' }, [time, state])
  ])

  const impactHint = el('span', { className: 'vt-sub' })
  const impactList = el('div', { className: 'vt-impact' })
  const impactEmpty = el('p', { className: 'vt-muted' })
  const impact = card('vt-impact-h2', [
    el('div', { className: 'vt-card-head vt-baseline' }, [
      sectionTitle('Energy impact', 'vt-impact-h2'),
      impactHint
    ]),
    impactList,
    impactEmpty
  ])
  const impactRows: ImpactRow[] = []

  const awakeList = el('div', { className: 'vt-rows' })
  const awakeEmpty = el('p', {
    className: 'vt-muted',
    text: 'Nothing is keeping this computer awake.'
  })
  const awake = card('vt-awake-h2', [
    sectionTitle('Keeping this computer awake', 'vt-awake-h2'),
    awakeList,
    awakeEmpty
  ])
  const awakeRows: BlockerRow[] = []
  const frame = detailFrame(actions, [battery, impact, awake])

  function showImpact(list: readonly EnergyImpact[]): void {
    while (impactRows.length < list.length) {
      const name = el('span', { className: 'vt-impact-name' })
      const fill = el('span', { className: 'vt-impact-fill' })
      const value = el('span', { className: 'vt-impact-value' })
      const element = el('div', { className: 'vt-impact-row' }, [
        name,
        el('span', { className: 'vt-impact-bar', attrs: { 'aria-hidden': 'true' } }, [fill]),
        value
      ])
      impactRows.push({ element, name, fill, value })
    }
    const max = Math.max(...list.map((entry) => entry.impact), 0)
    list.forEach((entry, index) => {
      const row = impactRows[index]
      setText(row.name, entry.name)
      row.name.title = `${entry.name} (PID ${entry.pid})`
      setText(row.value, impactText(entry.impact))
      row.fill.style.width = `${max > 0 ? (100 * entry.impact) / max : 0}%`
    })
    const nodes = impactRows.slice(0, list.length).map((row) => row.element)
    if (
      impactList.children.length !== nodes.length ||
      nodes.some((n, i) => impactList.children[i] !== n)
    ) {
      impactList.replaceChildren(...nodes)
    }
  }

  function showBlockers(list: readonly SleepBlocker[]): void {
    while (awakeRows.length < list.length) {
      const name = el('span', { className: 'vt-impact-name' })
      const why = el('span', { className: 'vt-fg2 vt-why' })
      awakeRows.push({ element: el('div', { className: 'vt-row' }, [name, why]), name, why })
    }
    list.forEach((entry, index) => {
      setText(awakeRows[index].name, entry.name)
      awakeRows[index].name.title = `${entry.name} (PID ${entry.pid})`
      setText(awakeRows[index].why, blockerText(entry.kinds))
    })
    const nodes = awakeRows.slice(0, list.length).map((row) => row.element)
    if (
      awakeList.children.length !== nodes.length ||
      nodes.some((n, i) => awakeList.children[i] !== n)
    ) {
      awakeList.replaceChildren(...nodes)
    }
  }

  function update(model: PanelModel): void {
    const reading = model.battery
    battery.hidden = reading === null
    if (reading) {
      setText(source, reading.onBattery ? 'On battery power' : 'On power adapter')
      setText(level, percent(reading.percent))
      bar.set(reading.percent / 100, batteryLabel(reading))
      setText(time, batteryEstimate(reading))
      setText(state, batteryState(reading))
    }
    impact.hidden = !model.sections.energy
    setText(impactHint, reading ? 'Higher uses more battery' : 'Higher uses more energy')
    const energy = model.energy
    showImpact(energy?.impact ?? [])
    impactEmpty.hidden = energy !== null && energy.impact.length > 0
    setText(
      impactEmpty,
      energy
        ? 'No process used measurable energy in the last sample.'
        : 'Measuring energy impact. This takes a few seconds.'
    )
    const blockers = energy?.blockers ?? null
    awake.hidden = !model.sections.energy || blockers === null
    showBlockers(blockers ?? [])
    awakeEmpty.hidden = blockers === null || blockers.length > 0
    if (blockers === null) awakeList.replaceChildren()
  }

  return detailView(frame, update)
}
