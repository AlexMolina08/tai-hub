import type { PredictionControl, PredictionExercise } from './prediction'

export const RADIO_MODEL_VERSION = 'radio-model-v1'

interface Channel {
  centerMHz: number
  widthMHz: number
}

interface Reading {
  signalDbm: number
  busyPercent: number
}

export interface RadioProfile {
  channels: (Channel & { label: string })[]
  locations: { label: string; readings: Reading[] }[]
  neighbor: Channel
  minimumSignalDbm: number
  maximumBusyPercent: number
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function integer(value: unknown, lower: number, upper: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= lower && value <= upper
}

function channel(value: unknown): value is Channel {
  return record(value) && integer(value.centerMHz, 2300, 7200)
    && [20, 40, 80, 160, 320].some(width => value.widthMHz === width)
}

function labeled(value: unknown): value is Record<string, unknown> & { label: string } {
  return record(value) && typeof value.label === 'string' && value.label === value.label.trim()
    && integer(value.label.length, 1, 60)
}

function variants(value: unknown): value is (Record<string, unknown> & { label: string })[] {
  return Array.isArray(value) && integer(value.length, 2, 8) && value.every(labeled)
    && new Set(value.map(item => item.label)).size === value.length
}

export function validRadioProfile(value: unknown): value is RadioProfile {
  if (!record(value) || !channel(value.neighbor) || !variants(value.channels) || !value.channels.every(channel)
    || !integer(value.minimumSignalDbm, -110, -20) || !integer(value.maximumBusyPercent, 0, 100)
    || !variants(value.locations)) return false
  const channelCount = value.channels.length
  return value.locations.every(location => Array.isArray(location.readings) && location.readings.length === channelCount
    && location.readings.every(reading => record(reading) && integer(reading.signalDbm, -120, -10)
      && integer(reading.busyPercent, 0, 100)))
}

export function radioControls(profile: RadioProfile): PredictionControl[] {
  const locations = profile.locations.map(location => location.label)
  const channels = profile.channels.map(channel => channel.label)
  return [
    { label: 'Punto de medida', options: locations, initial: locations[0] },
    { label: 'Canal candidato', options: channels, initial: channels[0] },
  ]
}

function interval({ centerMHz, widthMHz }: Channel) {
  return [centerMHz - widthMHz / 2, centerMHz + widthMHz / 2] as const
}

export function describeRadio(profile: RadioProfile, values: string[]): PredictionExercise {
  const location = profile.locations.find(item => item.label === values[0]) ?? profile.locations[0]
  const index = Math.max(0, profile.channels.findIndex(item => item.label === values[1]))
  const candidate = profile.channels[index]
  const { signalDbm, busyPercent } = location.readings[index]
  const [lower, upper] = interval(candidate)
  const [neighborLower, neighborUpper] = interval(profile.neighbor)
  const overlap = Math.max(0, Math.min(upper, neighborUpper) - Math.max(lower, neighborLower))
  const adequateSignal = signalDbm >= profile.minimumSignalDbm
  const adequateTime = busyPercent <= profile.maximumBusyPercent
  const yesNo = (label: string, accepted: boolean) =>
    ({ label, expected: accepted ? 'Sí' : 'No', options: ['Sí', 'No'] })
  return {
    facts: [
      `Canal candidato: centro ${candidate.centerMHz} MHz y ancho ${candidate.widthMHz} MHz.`,
      `Canal vecino: centro ${profile.neighbor.centerMHz} MHz y ancho ${profile.neighbor.widthMHz} MHz.`,
      `Medida del punto: señal ${signalDbm} dBm y ocupación ${busyPercent} %.`,
      `La política del ejercicio exige señal mínima de ${profile.minimumSignalDbm} dBm, ocupación máxima de ${profile.maximumBusyPercent} % y cero solapamiento nominal.`,
      'Las medidas están preparadas por caso. Los intervalos ideales no estiman la interferencia real ni la cobertura en otros puntos.',
    ],
    answers: [
      { label: 'Solapamiento nominal en MHz', expected: String(overlap), format: 'integer' },
      yesNo('¿Cumple el umbral de señal?', adequateSignal),
      yesNo('¿Se acepta el canal en este punto?', overlap === 0 && adequateSignal && adequateTime),
    ],
    steps: ['La decisión combina tres condiciones independientes. Una señal por encima del umbral no compensa un canal ocupado o solapado en esta política.'],
    trace: [
      `Canal candidato [${lower}, ${upper}] MHz. Canal vecino [${neighborLower}, ${neighborUpper}] MHz. Su intersección mide ${overlap} MHz.`,
      `Señal ${signalDbm} dBm. ${adequateSignal ? 'Alcanza' : 'Queda por debajo de'} el mínimo de ${profile.minimumSignalDbm} dBm.`,
      `Ocupación ${busyPercent} %. ${adequateTime ? 'No supera' : 'Supera'} el máximo de ${profile.maximumBusyPercent} %.`,
    ],
  }
}
