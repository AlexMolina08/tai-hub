import { expect, it } from 'vitest'
import { describeRadio, radioControls, validRadioProfile, type RadioProfile } from './radio-model'
import { parsePredictionDraft } from './prediction'

const profile: RadioProfile = {
  channels: [
    { label: 'A', centerMHz: 5260, widthMHz: 40 },
    { label: 'B', centerMHz: 5300, widthMHz: 20 },
    { label: 'C', centerMHz: 5340, widthMHz: 80 },
  ],
  locations: [
    { label: 'Norte', readings: [
      { signalDbm: -63, busyPercent: 35 }, { signalDbm: -67, busyPercent: 40 }, { signalDbm: -68, busyPercent: 22 },
    ] },
    { label: 'Sur', readings: [
      { signalDbm: -52, busyPercent: 25 }, { signalDbm: -55, busyPercent: 41 }, { signalDbm: -60, busyPercent: 25 },
    ] },
  ],
  neighbor: { centerMHz: 5270, widthMHz: 40 },
  minimumSignalDbm: -67,
  maximumBusyPercent: 40,
}

const answers = (place: string, channel: string) =>
  describeRadio(profile, [place, channel]).answers.map(answer => answer.expected)

it('separates touching intervals, overlapping channels, weak signal and high occupancy', () => {
  expect(answers('Norte', 'A')).toEqual(['30', 'Sí', 'No'])
  expect(answers('Norte', 'B')).toEqual(['0', 'Sí', 'Sí'])
  expect(answers('Norte', 'C')).toEqual(['0', 'No', 'No'])
  expect(answers('Sur', 'B')).toEqual(['0', 'Sí', 'No'])
  expect(answers('Sur', 'C')).toEqual(['0', 'Sí', 'Sí'])
})

it('rejects incomplete and out-of-range measurement tables', () => {
  expect(validRadioProfile(profile)).toBe(true)
  expect(validRadioProfile({ ...profile, neighbor: { centerMHz: 5260, widthMHz: 0 } })).toBe(false)
  expect(validRadioProfile({ ...profile, channels: [profile.channels[0], profile.channels[0]] })).toBe(false)
  expect(validRadioProfile({ ...profile, locations: [...profile.locations, { label: 'Este', readings: [] }] })).toBe(false)
  expect(validRadioProfile({ ...profile, maximumBusyPercent: 101 })).toBe(false)
  expect(validRadioProfile({ ...profile, locations: [
    profile.locations[0], { ...profile.locations[1], readings: [
      { signalDbm: -60, busyPercent: -1 }, ...profile.locations[1].readings.slice(1),
    ] },
  ] })).toBe(false)
})

it('restores the selected measurement and trace position without accepting a stale location', () => {
  const parse = (draft: unknown) => parsePredictionDraft(JSON.stringify(draft), radioControls(profile),
    values => describeRadio(profile, values))
  const saved = { controls: ['Sur', 'C'], answers: ['0', 'Sí', 'Sí'], step: 2 }
  expect(parse(saved)).toEqual(saved)
  expect(parse({ ...saved, step: 3 })).not.toHaveProperty('step')
  expect(parse({ ...saved, controls: ['Retirado', 'C'] })).toEqual({ controls: ['Norte', 'A'], answers: ['', '', ''] })
})
