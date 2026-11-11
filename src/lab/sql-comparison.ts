import { canonical } from './history'
import type { SqlActivity } from './model'
import type { SqlResult } from './sql-runner'
import { sqlPreservedType } from './sql-output'

// PostgreSQL OIDs for int8, int2, int4 and numeric. The wire values may be strings.
const exactNumberTypes = new Set([20, 21, 23, 1700])

function normalizeExactNumber(value: unknown): unknown {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value)
  if (typeof value !== 'string') return value
  const match = /^(-?\d+)(?:\.(\d+))?$/.exec(value)
  if (!match) return value
  const fraction = (match[2] ?? '').replace(/0+$/, '')
  return fraction ? `${match[1]}.${fraction}` : match[1]
}

export function compareSqlResults(actual: SqlResult, expected: SqlResult, mode: SqlActivity['comparison']): boolean {
  if (actual.columns.length !== expected.columns.length) return false
  const exactColumns = actual.columnTypes.map((oid, index) =>
    exactNumberTypes.has(oid) && exactNumberTypes.has(expected.columnTypes[index]))
  const preservedColumns = actual.columnTypes.map((oid, index) =>
    sqlPreservedType(oid) !== undefined || sqlPreservedType(expected.columnTypes[index]) !== undefined)
  const normalize = (result: SqlResult) => result.rows.map(row => row.map((value, index) => {
    if (exactColumns[index]) return normalizeExactNumber(value)
    if (preservedColumns[index] && value !== null) return { type: sqlPreservedType(result.columnTypes[index]) ?? 'other', value }
    return value
  }))
  return compareSqlRows(normalize(actual), normalize(expected), mode)
}

/** Passing finite datasets is evidence for this requirement, not a proof of universal SQL equivalence. */
export function compareSqlRows(actual: unknown[][], expected: unknown[][], mode: SqlActivity['comparison']): boolean {
  const encode = (rows: unknown[][]) => rows.map(row => canonical(row))
  if (mode === 'ordered') return canonical(encode(actual)) === canonical(encode(expected))
  const normalize = (rows: unknown[][]) => {
    const encoded = encode(rows)
    return (mode === 'set' ? [...new Set(encoded)] : encoded).sort()
  }
  return canonical(normalize(actual)) === canonical(normalize(expected))
}
