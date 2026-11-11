import { describe, expect, it } from 'vitest'
import { describeTransaction, transactionControls, validTransactionProfile, type TransactionProfile } from './transaction-model'

const visibility: TransactionProfile = {
  kind: 'visibility', initialIsolation: 'READ COMMITTED', initialEndB: 'COMMIT',
  initialValue: 4, updatedValue: 2, insertedValue: 6, threshold: 5,
}
const deadlock: TransactionProfile = {
  kind: 'deadlock', initialSchedule: 'Misma fila, A confirma',
  initialValues: [1, 3], increments: { aFirst: 2, bOther: 4, bFirst: 5, aOther: 6 },
}
const skew: TransactionProfile = { kind: 'write-skew', initialIsolation: 'REPEATABLE READ', initialActive: 4 }
const expected = (profile: TransactionProfile, controls: string[]) =>
  describeTransaction(profile, controls).answers.map(answer => answer.expected)

describe('transaction model', () => {
  it('varies snapshots by PostgreSQL isolation and by the end of session B', () => {
    expect(expected(visibility, ['READ COMMITTED', 'COMMIT'])).toEqual(['4', '2', '1', '1'])
    expect(expected(visibility, ['READ UNCOMMITTED', 'COMMIT'])).toEqual(['4', '2', '1', '1'])
    expect(expected(visibility, ['REPEATABLE READ', 'COMMIT'])).toEqual(['4', '4', '0', '1'])
    expect(expected(visibility, ['SERIALIZABLE', 'COMMIT'])).toEqual(['4', '4', '0', '1'])
    expect(expected(visibility, ['READ COMMITTED', 'ROLLBACK'])).toEqual(['4', '4', '0', '0'])
    expect(expected({ ...visibility, threshold: 2 }, [])).toEqual(['4', '2', '2', '2'])
  })

  it('separates an ordinary wait, independent rows and a wait cycle', () => {
    expect(expected(deadlock, ['Misma fila, A confirma'])).toEqual(['Espera a A', 'Sin error', '8, 3'])
    expect(expected(deadlock, ['Misma fila, A revierte'])).toEqual(['Espera a A', 'Sin error', '6, 3'])
    expect(expected(deadlock, ['Filas independientes'])).toEqual(['Termina', 'Sin error', '3, 7'])
    expect(expected(deadlock, ['Solicitudes en ciclo'])).toEqual(['Espera a A', 'Deadlock (40P01)', '3, 9 o 6, 7'])
  })

  it('deduplicates choices when two permitted outcomes coincide', () => {
    const profile = { ...deadlock, increments: { aFirst: 2, bOther: 3, bFirst: 2, aOther: 3 } }
    const result = describeTransaction(profile, ['Solicitudes en ciclo']).answers[2]
    expect(result.expected).toBe('3, 6')
    expect(result.options).toEqual(['5, 3', '3, 3', '3, 6'])
  })

  it('models the count after a serializable rejection', () => {
    expect(expected(skew, ['REPEATABLE READ'])).toEqual(['4', 'Ninguna', '2'])
    expect(expected(skew, ['SERIALIZABLE'])).toEqual(['4', '40001', '3'])
  })

  it('validates bounds and falls back to declared controls', () => {
    expect([visibility, deadlock, skew].every(validTransactionProfile)).toBe(true)
    expect(validTransactionProfile({ ...visibility, initialIsolation: 'SNAPSHOT' })).toBe(false)
    expect(validTransactionProfile({ ...visibility, threshold: Number.NaN })).toBe(false)
    expect(validTransactionProfile({ ...deadlock, initialValues: [1, 3, 5] })).toBe(false)
    expect(validTransactionProfile({ ...deadlock, increments: { ...deadlock.increments, bFirst: 0 } })).toBe(false)
    expect(validTransactionProfile({ ...skew, initialActive: 1 })).toBe(false)
    expect(validTransactionProfile(null)).toBe(false)
    expect(transactionControls(visibility).map(control => control.initial)).toEqual(['READ COMMITTED', 'COMMIT'])
    expect(expected(visibility, ['corrupt', 'missing'])).toEqual(expected(visibility, []))
  })
})
