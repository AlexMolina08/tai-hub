import { requiredGates, type Attempt, type ChoiceActivity, type LabPackage } from './model'

/** Synthetic fixtures only. These are not editorial evidence or teaching materials. */
export function samplePackage(): LabPackage {
  const activities: ChoiceActivity[] = ['p1', 'p2', 'i1', 'i2', 'i3', 'r1', 'd1'].map(id => ({
    id, version: '1', title: 'Ejemplo sintético ' + id, kind: 'choice', objectiveIds: ['o1'], familyId: 'f-' + id,
    scenarioId: 's-' + id, phase: id.startsWith('p') ? 'practice' : id.startsWith('i') ? 'immediate' : id === 'r1' ? 'reserved' : 'delayed',
    state: 'validated', provenance: { kind: 'didactic', status: 'eligible' },
    mode: { kind: 'simulation', engine: 'fixture', version: '1', limits: 'Datos sintéticos de prueba' },
    prompt: 'Selecciona la opción marcada como válida en este ejemplo sintético.',
    hints: id.startsWith('p') ? ['Pista uno.', 'Pista dos.', 'Pista tres.'] : [], solution: 'La opción A es la válida.',
    claims: [{ text: 'Regla del ejemplo', sourceId: 's1', locator: 'fixture' }],
    options: [{ id: 'a', text: 'Válida', explanation: 'Coincide con la regla del ejemplo.', correct: true },
      { id: 'b', text: 'Inválida', explanation: 'No coincide con la regla del ejemplo.', correct: false }],
  }))
  const pack: LabPackage = {
    schema: 1, privacy: 'tai-lab-private', id: 'synthetic', version: '1', title: 'Paquete sintético de prueba',
    sources: [{ id: 's1', title: 'Fuente sintética', url: 'https://example.org/fixture', edition: '1', locator: 'fixture',
      consultedOn: '2026-11-11', verification: 'verified', authority: 'execution', rights: 'original' }],
    objectives: [{ id: 'o1', unitId: 'synthetic-U01', topicId: 'synthetic', statement: 'Discriminar la regla sintética.', concepts: ['Regla'],
      depth: 'A', officialClauses: ['synthetic-a'], state: 'validated', lessonIds: ['l1'], practiceIds: ['p1', 'p2'],
      immediateIds: ['i1', 'i2', 'i3'], reservedIds: ['r1'], delayedIds: ['d1'], sourceIds: ['s1'] }],
    lessons: [{ id: 'l1', version: '1', title: 'Lección sintética', objectiveIds: ['o1'], prerequisites: [], minutes: 15, state: 'validated',
      explanation: [{ title: 'Regla', body: 'Una opción satisface la condición.' }], workedExample: [{ title: 'Ejemplo', body: 'Compara cada opción.' }],
      activityIds: ['p1', 'p2', 'i1', 'i2', 'i3'], material: { resourceId: 'synthetic-html', sectionId: 'fixture' },
      claims: [{ text: 'Regla del ejemplo', sourceId: 's1', locator: 'fixture' }] }], activities, evidence: [],
  }
  pack.evidence = [...pack.activities, ...pack.lessons].flatMap(subject => requiredGates.map(gate => ({
    id: subject.id + '-' + gate, subjectId: subject.id, subjectVersion: '1', gate, method: 'manual', environment: 'Synthetic fixture',
    procedure: 'Synthetic fixture', expected: 'Synthetic pass', observed: 'Synthetic pass', result: 'pass',
    artifact: 'synthetic-fixture', sha256: '0'.repeat(64), recordedAt: '2026-11-11T10:00:00.000Z',
  })))
  return pack
}
export function sampleAttempt(id = 'a1', deviceId = 'device-a'): Attempt {
  return { kind: 'attempt', id, deviceId, accountId: 'account-a', createdAt: '2026-11-11T10:00:00.000Z',
    activityId: 'p1', activityVersion: '1', packageId: 'synthetic', packageVersion: '1', familyId: 'f-p1',
    objectiveIds: ['o1'], attemptGroupId: id, ordinal: 1, answer: 'a', outcome: 'correct', hintCount: 0,
    solutionViewed: false, activeMs: 1000, phase: 'practice', feedback: 'Coincide con la regla.', gradingVersion: 'choice-v1' }
}
