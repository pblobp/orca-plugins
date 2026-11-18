import type { BatteryReading, BatteryState } from '../protocol.ts'

export type BatteryFiles = {
  capacity: string | null
  status: string | null
  powerNow: string | null
  currentNow: string | null
  voltageNow: string | null
  energyNow: string | null
  energyFull: string | null
  chargeNow: string | null
  chargeFull: string | null
}

const STATES = new Map<string, BatteryState>([
  ['charging', 'charging'],
  ['discharging', 'discharging'],
  ['full', 'charged'],
  ['not charging', 'not-charging']
])

const MICRO = 1_000_000

function number(text: string | null): number | null {
  const value = Number((text ?? '').trim())
  return text !== null && text.trim() !== '' && Number.isFinite(value) ? value : null
}

export function linuxBattery(files: BatteryFiles): BatteryReading | null {
  const capacity = number(files.capacity)
  if (capacity === null || capacity < 0 || capacity > 100) return null
  const state = STATES.get((files.status ?? '').trim().toLowerCase()) ?? null
  const power = number(files.powerNow)
  const current = number(files.currentNow)
  const voltage = number(files.voltageNow)
  const microwatts =
    power !== null
      ? Math.abs(power)
      : current !== null && voltage !== null
        ? Math.abs(current * voltage) / MICRO
        : null
  const watts = microwatts !== null && microwatts > 0 ? Math.round(microwatts / 10_000) / 100 : null
  const energyNow = number(files.energyNow)
  const energyFull = number(files.energyFull)
  const chargeNow = number(files.chargeNow)
  const chargeFull = number(files.chargeFull)
  let hours: number | null = null
  if (state === 'discharging') {
    if (energyNow !== null && power) hours = energyNow / Math.abs(power)
    else if (chargeNow !== null && current) hours = chargeNow / Math.abs(current)
  } else if (state === 'charging') {
    if (energyNow !== null && energyFull !== null && power) {
      hours = (energyFull - energyNow) / Math.abs(power)
    } else if (chargeNow !== null && chargeFull !== null && current) {
      hours = (chargeFull - chargeNow) / Math.abs(current)
    }
  }
  const minutes =
    hours !== null && Number.isFinite(hours) && hours > 0 ? Math.round(hours * 60) : null
  return {
    percent: capacity,
    onBattery: state === 'discharging',
    state,
    minutesLeft: minutes,
    watts
  }
}
