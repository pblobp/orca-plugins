import type { BatteryReading } from '../../src/protocol.ts'
import { el, setText } from '../dom.ts'
import { duration, percent } from '../format.ts'
import type { PanelActions, PanelModel } from '../state.ts'
import { cardTitle, meter } from './common.ts'

export function batteryTime(battery: BatteryReading): string {
  const left = battery.minutesLeft === null ? null : duration(battery.minutesLeft * 60)
  if (battery.state === 'discharging') return left ? `${left} left` : 'On battery'
  if (battery.state === 'charging') return left ? `Full in ${left}` : 'Charging'
  if (battery.state === 'charged') return 'Charged'
  if (battery.state === 'finishing') return 'Finishing charge'
  if (battery.state === 'not-charging') return 'Not charging'
  return battery.onBattery ? 'On battery' : 'On power adapter'
}

export function batteryState(battery: BatteryReading): string {
  if (battery.state === 'charging') return 'Charging'
  if (battery.state === 'discharging') return 'On battery'
  if (battery.state === 'charged') return 'Charged'
  if (battery.state === 'finishing') return 'Finishing charge'
  if (battery.state === 'not-charging') return 'Not charging'
  return ''
}

export function batteryEstimate(battery: BatteryReading): string {
  if (battery.minutesLeft === null) return ''
  const left = duration(battery.minutesLeft * 60)
  if (battery.state === 'discharging') return `About ${left} left`
  if (battery.state === 'charging') return `About ${left} until full`
  return ''
}

export function batteryLabel(battery: BatteryReading): string {
  const source = battery.onBattery ? 'on battery power' : 'on the power adapter'
  return `Battery at ${Math.round(battery.percent)} percent, ${source}`
}

export function createBatteryCard(actions: PanelActions) {
  const title = cardTitle('Battery', 'vt-battery-title', 'energy', actions)
  const level = el('span', { className: 'vt-mid' })
  const time = el('span', { className: 'vt-sub' })
  const bar = meter('s3')
  const battery = el(
    'section',
    { className: 'vt-card vt-card-tight', attrs: { 'aria-labelledby': 'vt-battery-title' } },
    [
      el('div', { className: 'vt-card-head vt-center' }, [
        title,
        el('div', { className: 'vt-amount vt-amount-fit' }, [level, time])
      ]),
      bar.element
    ]
  )
  const energy = el(
    'section',
    { className: 'vt-card vt-card-tight', attrs: { 'aria-labelledby': 'vt-energy-title' } },
    [
      el('div', { className: 'vt-head-text' }, [
        cardTitle('Energy', 'vt-energy-title', 'energy', actions),
        el('span', { className: 'vt-sub', text: 'Which apps use the most energy' })
      ])
    ]
  )
  const element = el('div', { className: 'vt-contents' }, [battery, energy])

  function update(model: PanelModel): void {
    const reading = model.battery
    battery.hidden = reading === null
    energy.hidden = reading !== null || !model.sections.energy
    if (!reading) return
    setText(level, percent(reading.percent))
    setText(time, batteryTime(reading))
    bar.set(reading.percent / 100, batteryLabel(reading))
  }

  return { element, update }
}
