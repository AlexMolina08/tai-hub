// PostgreSQL built-in OIDs. Preserve server text where JavaScript parsing would lose information.
const integerArrays = [1005, 1007, 1016]
const temporalTypes = [1082, 1114, 1184, 1182, 1115, 1185]
const preservedTypes = new Set([...integerArrays, ...temporalTypes])
const integerArrayTypes = new Set(integerArrays)

export const SQL_GRADING_VERSION = 'sql-datasets-v3'
export function supportsSqlGrading(version: string) {
  return version === SQL_GRADING_VERSION || version === 'sql-datasets-v2' || version === 'sql-datasets-v1'
}

export const sqlResultParsers = Object.fromEntries([...preservedTypes].map(oid => [oid, (text: string) => text]))

export function sqlPreservedType(oid: number): number | 'integer-array' | undefined {
  if (integerArrayTypes.has(oid)) return 'integer-array'
  if (preservedTypes.has(oid)) return oid
}
