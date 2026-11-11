import { describe, expect, it } from 'vitest'
import { samplePackage } from './fixtures.test-support'
import { describeTcp, tcpControls, TCP_MODEL_VERSION, validTcpProfile, type TcpProfile } from './tcp-model'
import { isPredictionActivity, matchesPredictionAnswer, parsePredictionDraft } from './prediction'
import { parsePackage } from './validate'

type Case = TcpProfile['cases'][number]
const open = { kind:'opening', label:'Apertura de prueba', a:42, b:156, loss:'none' } satisfies Case
const close = { kind:'closing', label:'Cierre de prueba', seq:800, bytes:22, event:'half' } satisfies Case
const loss = { kind:'recovery', label:'Recuperación de prueba', base:5000, bytes:100, duplicateAcks:3, expired:true } satisfies Case
const receive = {
  kind:'receive', label:'Recepción de prueba', base:6000,
  segments:[{ offset:0, bytes:50, delivered:false },{ offset:50, bytes:50, delivered:true },
    { offset:50, bytes:50, delivered:true },{ offset:0, bytes:50, delivered:true },{ offset:90, bytes:20, delivered:true }],
} satisfies Case
const window = { kind:'window', label:'Ventana de prueba', inFlight:3800, acknowledged:900, rwnd:3100, cwnd:5000 } satisfies Case
const exercise = (c: Case) => describeTcp({ cases:[c] },[c.label])
const answers = (c: Case) => exercise(c).answers.map(a => a.expected)

describe('finite TCP prediction', () => {
  it('keeps the same sequence on opening retries and separates emission from reception', () => {
    expect(answers(open)).toEqual(['43','157','ESTABLISHED'])
    expect(answers({ ...open, loss:'syn' })).toEqual(answers(open))
    expect(answers({ ...open, loss:'syn-ack' })).toEqual(answers(open))
    expect(answers({ ...open, loss:'final-ack' })).toEqual(['43','157','SYN-RECEIVED'])
  })

  it('counts FIN after data and separates the two halves of a close from a reset', () => {
    expect(answers(close)).toEqual(['823','FIN-WAIT-2','CLOSE-WAIT'])
    expect(answers({ ...close, event:'both' })).toEqual(['823','TIME-WAIT','CLOSED'])
    expect(answers({ ...close, event:'reset', bytes:0 })).toEqual(['0','CLOSED','CLOSED'])
  })

  it('tracks a contiguous prefix despite drops, duplicates and overlap', () => {
    expect(answers(receive)).toEqual(['6110','110'])
    expect(answers({ ...receive, segments:receive.segments.slice(0,3) })).toEqual(['6000','0'])
    const trace = exercise(receive).trace!
    expect(trace[2]).toContain('Se liberan 0 octetos')
    expect(trace[3]).toContain('Se liberan 100 octetos')
    expect(trace[4]).toContain('Se liberan 10 octetos')
  })

  it('retransmits after the third eligible duplicate ACK before expiry or on expiry', () => {
    expect(answers(loss)).toEqual(['Rápida','5400'])
    expect(answers({ ...loss, duplicateAcks:2 })).toEqual(['Por RTO','5300'])
    expect(answers({ ...loss, duplicateAcks:2, expired:false })).toEqual(['Sin retransmisión','5000'])
    expect(answers({ ...loss, duplicateAcks:0 })).toEqual(['Por RTO','5100'])
  })

  it('computes nonnegative credit after ACK and identifies the limiting window', () => {
    expect(answers(window)).toEqual(['2900','200','Receptor'])
    expect(answers({ ...window, cwnd:2700 })).toEqual(['2900','0','Congestión'])
    expect(answers({ ...window, rwnd:5000 })).toEqual(['2900','2100','Iguales'])
    expect(answers({ ...window, rwnd:0 })).toEqual(['2900','0','Receptor'])
  })

  it('rejects invalid, ambiguous and unbounded profile input', () => {
    expect(validTcpProfile({ cases:[open,close,receive,loss,window] })).toBe(true)
    for (const cases of [
      [open,open], [{ ...open, a:2**32 }], [{ ...open, loss:'other' }],
      [{ ...close, event:'reset' }], [{ ...receive, segments:[] }],
      [{ ...receive, segments:[{ offset:32768, bytes:1, delivered:true }] }],
      [{ ...loss, duplicateAcks:-1 }], [{ ...window, acknowledged:3801 }], [{ ...window, cwnd:0 }],
    ]) expect(validTcpProfile({ cases })).toBe(false)
  })

  it('parses a package, grades fields and persists a draft and trace without altering the profile', () => {
    const profile = { cases:[open,close,receive,loss,window] }
    const pack = samplePackage()
    const activity = {
      ...pack.activities[0], kind:'tcp-model' as const, phase:'practice' as const, profile,
      mode:{ kind:'simulation' as const, version:TCP_MODEL_VERSION, engine:'TCP', limits:'Datos sintéticos' },
    }
    pack.activities[0] = activity
    expect(isPredictionActivity(parsePackage(pack).activities[0])).toBe(true)
    expect(() => parsePackage({ ...pack, activities:[{ ...activity, mode:{ ...activity.mode, version:'future' } }] }))
      .toThrow(/perfil TCP inválido/)
    const before = structuredClone(profile)
    const draft = { controls:[receive.label], answers:answers(receive), step:2 }
    expect(parsePredictionDraft(JSON.stringify(draft),tcpControls(profile),values => describeTcp(profile,values))).toEqual(draft)
    expect(exercise(receive).answers.every((a,i) => matchesPredictionAnswer(a,draft.answers[i]))).toBe(true)
    expect(profile).toEqual(before)
  })
})
