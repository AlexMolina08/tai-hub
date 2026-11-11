import { expect, it } from 'vitest'
import { describeRelation, relationControls, validRelationProfile, type RelationProfile } from './relation-model'

const example: RelationProfile = {
  kind: 'identifier',
  documents: [{ owner: 'E4', ordinal: 1, recipients: 1 }, { owner: 'E4', ordinal: 2, recipients: 1 }],
  addition: { owner: 'E6', ordinal: 1, recipients: 2 },
}
const links: RelationProfile = {
  kind: 'cardinality', left: ['L1', 'L2'], right: ['R1', 'R2'],
  rightPerLeft: [1, 2], leftPerRight: [0, 1], links: [[0, 0], [1, 1]],
}
const answers = (profile: RelationProfile, controls: string[]) => describeRelation(profile, controls).answers.map(a => a.expected)

it('distinguishes the owner scope and a multivalued attribute after adding a document', () => {
  const controls = relationControls(example).map(c => c.initial)
  expect(answers(example, controls)).toEqual(['2', 'Sí'])
  expect(answers(example, [controls[0], controls[1], '1'])).toEqual(['2', 'No'])
  expect(answers(example, ['Código de expediente', controls[1], '0'])).toEqual(['1', 'Sí'])
  expect(answers(example, ['Expediente y número', 'Colección de códigos', '1'])).toEqual(['3', 'Sí'])
})

it('counts missing participation and a maximum breach independently', () => {
  const controls = relationControls(links).map(c => c.initial)
  expect(controls).toEqual(['1', '0', '0', '1'])
  expect(answers(links, controls)).toEqual(['0', '0'])
  expect(answers(links, ['1', '1', '0', '0'])).toEqual(['1', '0'])
  expect(answers(links, ['1', '0', '1', '0'])).toEqual(['0', '1'])
  expect(answers(links, ['0', '0', '0', '0'])).toEqual(['2', '0'])
  expect(answers(links, ['1', '1', '1', '1'])).toEqual(['0', '2'])
})

it('rejects links outside the profile and profiles with ambiguous identities', () => {
  expect(validRelationProfile(links)).toBe(true)
  expect(validRelationProfile(example)).toBe(true)
  for (const invalid of [
    { ...links, links: [[0, 0], [0, 0]] },
    { ...links, links: [[0, 2]] },
    { ...links, rightPerLeft: [2, 1] },
    { ...links, right: ['L1', 'R2'] },
    { ...example, addition: example.documents[0] },
  ]) expect(validRelationProfile(invalid)).toBe(false)
})
