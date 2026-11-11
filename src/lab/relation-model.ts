import type { PredictionControl, PredictionExercise } from './prediction'

export const RELATION_MODEL_VERSION = 'relation-model-v1'

type Document = { owner: string; ordinal: number; recipients: number }
type Bounds = [number, number]
type Link = [number, number]
export type RelationProfile =
  | { kind: 'identifier'; documents: Document[]; addition: Document }
  | { kind: 'cardinality'; left: string[]; right: string[]; rightPerLeft: Bounds; leftPerRight: Bounds; links: Link[] }

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const integer = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
const name = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9-]{1,12}$/.test(value)
const names = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length >= 2 && value.length <= 3 && value.every(name) && new Set(value).size === value.length
const document = (value: unknown): value is Document =>
  record(value) && name(value.owner) && integer(value.ordinal, 1, 99) && integer(value.recipients, 0, 5)
const bounds = (value: unknown, max: number): value is Bounds =>
  Array.isArray(value) && value.length === 2 && integer(value[1], 0, max) && integer(value[0], 0, value[1])

export function validRelationProfile(value: unknown): value is RelationProfile {
  if (!record(value)) return false
  if (value.kind === 'identifier') {
    if (!Array.isArray(value.documents) || value.documents.length < 2 || value.documents.length > 4
      || !value.documents.every(document) || !document(value.addition)) return false
    const examples = [...value.documents, value.addition]
    return new Set(examples.map(row => `${row.owner}/${row.ordinal}`)).size === examples.length
  }
  const { left, right, rightPerLeft, leftPerRight, links } = value
  return value.kind === 'cardinality' && names(left) && names(right) && new Set([...left, ...right]).size === left.length + right.length
    && bounds(rightPerLeft, right.length) && bounds(leftPerRight, left.length) && Array.isArray(links)
    && links.length <= left.length * right.length
    && links.every(link => Array.isArray(link) && link.length === 2 && integer(link[0], 0, left.length - 1)
      && integer(link[1], 0, right.length - 1))
    && new Set(links.map(link => link.join('/'))).size === links.length
}

const ordinal = 'Número de documento'
const owner = 'Código de expediente'
const both = 'Expediente y número'
const single = 'Un código por documento'
const collection = 'Colección de códigos'
const toggle = (label: string, selected = false): PredictionControl =>
  ({ label, options: ['0', '1'], initial: selected ? '1' : '0', toggle: true })

function possibleLinks(profile: Extract<RelationProfile, { kind: 'cardinality' }>): Link[] {
  return profile.left.flatMap((_, left) => profile.right.map((_, right): Link => [left, right]))
}
export function relationControls(profile: RelationProfile): PredictionControl[] {
  if (profile.kind === 'identifier') return [
    { label: 'Identificador elegido', options: [ordinal, owner, both], initial: ordinal },
    { label: 'Destinatarios del documento', options: [single, collection], initial: single },
    toggle('Añadir el documento propuesto'),
  ]
  return possibleLinks(profile).map(([left, right]) =>
    toggle(`Enlazar ${profile.left[left]} con ${profile.right[right]}`,
      profile.links.some(([a, b]) => a === left && b === right)))
}

export function describeRelation(profile: RelationProfile, controls: string[]): PredictionExercise {
  if (profile.kind === 'identifier') {
    const [identifier, recipients, add] = controls
    const rows = add === '1' ? [...profile.documents, profile.addition] : profile.documents
    const key = (row: Document) => identifier === ordinal ? String(row.ordinal)
      : identifier === owner ? row.owner : `${row.owner}/${row.ordinal}`
    const occurrences = rows.map(key)
    const fits = recipients === collection || rows.every(row => row.recipients <= 1)
    const rowText = (row: Document) => `Expediente ${row.owner}, documento ${row.ordinal}, destinatarios ${row.recipients}.`
    return {
      facts: [
        'El número se asigna dentro de cada expediente. El modelo debe conservar todos los códigos de destinatario.',
        ...profile.documents.map(rowText),
        `Documento propuesto. ${rowText(profile.addition)}`,
      ],
      answers: [
        { label: 'Número de claves distintas en la muestra', expected: String(new Set(occurrences).size), format: 'integer' },
        { label: '¿Caben todos los destinatarios de la muestra?', expected: fits ? 'Sí' : 'No', options: ['Sí', 'No'] },
      ],
      steps: [
        `Identificadores en orden: ${occurrences.join(', ')}. Si se repite alguno, la elección confunde documentos distintos.`,
        'El par expediente y número mantiene el ámbito de la regla. Que un número no se repita en una muestra no lo hace global.',
        fits ? 'La representación elegida conserva todos los destinatarios de esta muestra.'
          : 'Hay un documento con más de un destinatario y el campo solo conserva un código.',
      ],
    }
  }
  const links = possibleLinks(profile).filter((_, index) => controls[index] === '1')
  const counts = [
    ...profile.left.map((id, i) => ({ id, bound: profile.rightPerLeft, count: links.filter(([left]) => left === i).length })),
    ...profile.right.map((id, i) => ({ id, bound: profile.leftPerRight, count: links.filter(([, right]) => right === i).length })),
  ]
  const below = counts.filter(row => row.count < row.bound[0])
  const above = counts.filter(row => row.count > row.bound[1])
  return {
    facts: [
      `Cada elemento de ${profile.left.join(', ')} admite entre ${profile.rightPerLeft.join(' y ')} enlaces.`,
      `Cada elemento de ${profile.right.join(', ')} admite entre ${profile.leftPerRight.join(' y ')} enlaces.`,
      'Cada marca añade un enlace. Cuenta los enlaces de cada elemento y compáralos con sus propios límites.',
    ],
    answers: [
      { label: 'Elementos que incumplen su mínimo', expected: String(below.length), format: 'integer' },
      { label: 'Elementos que superan su máximo', expected: String(above.length), format: 'integer' },
    ],
    steps: counts.map(({ id, count, bound }) =>
      `${id} tiene ${count} enlace(s) y admite de ${bound[0]} a ${bound[1]}. ${count < bound[0] ? 'Falta participación.'
        : count > bound[1] ? 'Supera el máximo.' : 'Cumple sus límites.'}`),
  }
}
