import { expect, it } from 'vitest'
import { describeDhcp, dhcpControls, validDhcpProfile, type DhcpProfile } from './dhcp-model'
import { parsePredictionDraft } from './prediction'

const profile: DhcpProfile = { scenarios: [
  { kind: 'startup', label: 'A', outcome: 'direct' },
  { kind: 'startup', label: 'B', outcome: 'relayed' },
  { kind: 'startup', label: 'C', outcome: 'no-relay' },
  { kind: 'startup', label: 'D', outcome: 'ack-not-delivered' },
  { kind: 'startup', label: 'E', outcome: 'reboot-nak' },
  { kind: 'lease', label: 'F', outcome: 'renew', duration: 2400 },
  { kind: 'lease', label: 'G', outcome: 'rebind', duration: 2400, t1: 700, t2: 2200 },
  { kind: 'lease', label: 'H', outcome: 'expire', duration: 2400, t1: 700 },
] }
const exercise = (label: string) => describeDhcp(profile, [label])
const expected = (label: string) => exercise(label).answers.map(answer => answer.expected)

it('distinguishes offers, usable acknowledgements, relay delivery and restart', () => {
  expect(expected('A')).toEqual(['Sí', 'BOUND'])
  expect(expected('B')).toEqual(['Sí', 'BOUND', '192.0.2.5:67'])
  expect(expected('C')).toEqual(['No', 'SELECTING sin oferta'])
  expect(expected('D')).toEqual(['No', 'REQUESTING sin confirmación', '192.0.2.5:67'])
  expect(expected('E')).toEqual(['No', 'INIT'])
  expect(exercise('D').trace?.at(-2)).toContain('198.51.100.20:67 → 192.0.2.5:67')
  expect(exercise('D').trace?.at(-1)).toContain('no llega')
})

it('derives default and explicit lease timers and uses different destinations by phase', () => {
  expect(expected('F')).toEqual(['Sí', '1200', '2100', '198.51.100.20:67', 'BOUND por renovación'])
  expect(expected('G')).toEqual(['Sí', '700', '2200', '198.51.100.20:67', 'BOUND por revinculación'])
  expect(expected('H')).toEqual(['No', '700', '2100', '198.51.100.20:67', 'INIT por caducidad'])
  expect(exercise('G').trace?.[2]).toContain('255.255.255.255:67')
  expect(exercise('G').trace?.at(-1)).toContain('198.51.100.21:67')
  expect(exercise('H').trace?.at(-1)).toContain('t=2400')
})

it('rejects unsupported durations, ambiguous labels and invalid timer order', () => {
  expect(validDhcpProfile(profile)).toBe(true)
  for (const update of [{ duration: 11 }, { t2: 2400 }, { t1: 2200, t2: 2200 }, { duration: 604801 }, { t1: null }]) {
    expect(validDhcpProfile({ scenarios: [profile.scenarios[0], { ...profile.scenarios[5], ...update }] })).toBe(false)
  }
  expect(validDhcpProfile({ scenarios: [profile.scenarios[0], profile.scenarios[0]] })).toBe(false)
})

it('restores only the answer shape and cursor belonging to the saved scenario', () => {
  const draft = { controls: ['G'], answers: expected('G'), step: 3 }
  const parse = (raw: unknown) => parsePredictionDraft(JSON.stringify(raw), dhcpControls(profile),
    controls => describeDhcp(profile, controls))
  expect(parse(draft)).toEqual(draft)
  expect(parse({ ...draft, controls: ['C'] })).not.toHaveProperty('step')
  expect(parse({ ...draft, controls: ['Desconocido'] })).toEqual({ controls: ['A'], answers: ['', ''] })
})
