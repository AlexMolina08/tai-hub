import { canonical } from './history'
import type { SqlActivity } from './model'

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
