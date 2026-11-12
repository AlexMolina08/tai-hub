import { useMemo } from 'react'
import type { LabEvent, LabPackage } from './model'
import type { LearningDestination } from './recommendation'

const sections = [
  { title: 'SQL', checks: [
    { objective: 'III.3-U06-O03', label: 'Claves y restricciones' },
    { objective: 'III.3-U02-O02', label: 'Comparaciones con NULL' },
    { objective: 'III.3-U03-O01', label: 'INNER JOIN' },
    { objective: 'III.3-U04-O01', label: 'Agrupación' },
  ] },
  { title: 'Lectura de código', checks: [
    { objective: 'III.2-U03-O01', label: 'Orden de los operadores' },
    { objective: 'III.2-U05-O02', label: 'Bucles' },
  ] },
  { title: 'POO', checks: [
    { objective: 'III.4-U01-O01', label: 'Identidad y referencias' },
    { objective: 'III.4-U02-O03', label: 'Sobreescritura de métodos' },
  ] },
  { title: 'Redes', checks: [
    { objective: 'IV.7-U02-O02', label: 'Prefijo y máscara IPv4' },
    { objective: 'IV.7-U04-O02', label: 'Puerta de enlace y siguiente salto' },
  ] },
]
const wanted = new Set(sections.flatMap(section => section.checks.map(check => check.objective)))
const editions = new Intl.Collator('en', { numeric: true })
type DiagnosticTarget = Extract<LearningDestination, { kind: 'activity' }> & { attemptGroupId: string }

function diagnosticTargets(packages: LabPackage[]) {
  const current = new Map<string, LabPackage>()
  for (const pack of packages) {
    const previous = current.get(pack.id)
    if (!previous || (editions.compare(pack.version, previous.version) || pack.version.localeCompare(previous.version)) > 0) {
      current.set(pack.id, pack)
    }
  }
  const targets = new Map<string, DiagnosticTarget>()
  for (const pack of [...current.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    const activities = new Map(pack.activities.map(activity => [activity.id, activity]))
    for (const objective of pack.objectives) {
      if (!wanted.has(objective.id) || targets.has(objective.id) || objective.state !== 'validated') continue
      const activity = [...objective.practiceIds, ...objective.immediateIds].map(id => activities.get(id)).find(candidate =>
        candidate?.kind === 'choice' && candidate.state === 'validated' && candidate.provenance.status === 'eligible'
        && (candidate.phase === 'practice' || candidate.phase === 'immediate'))
      if (!activity) continue
      targets.set(objective.id, { kind: 'activity', packageId: pack.id, packageVersion: pack.version, activityId: activity.id,
        attemptGroupId: JSON.stringify(['initial-diagnostic', pack.id, pack.version, activity.id, activity.version]) })
    }
  }
  return targets
}

export function InitialDiagnostic({ packages, events, open }: {
  packages: LabPackage[]; events: LabEvent[]; open: (target: LearningDestination) => void
}) {
  const targets = useMemo(() => diagnosticTargets(packages), [packages])
  if (targets.size !== wanted.size) return null
  const groups = new Set(Array.from(targets.values(), target => target.attemptGroupId))
  const results = new Map<string, { ordinal: number; label: string }>()
  for (const event of events) {
    if (event.kind !== 'attempt' || event.outcome === 'omitted' || !groups.has(event.attemptGroupId)) continue
    const previous = results.get(event.attemptGroupId)
    if (previous && previous.ordinal < event.ordinal) continue
    const label = event.solutionViewed || event.hintCount > 0 ? 'Respuesta con ayuda'
      : event.outcome === 'correct' ? 'Acierto inicial' : 'Conviene repasar'
    results.set(event.attemptGroupId, { ordinal: event.ordinal,
      label: previous?.ordinal === event.ordinal ? 'Varias respuestas iniciales' : label })
  }
  return <details className="lab-learning-details">
    <summary>Diagnóstico inicial</summary>
    <p>Prueba estos diez conceptos en el orden que prefieras. Puedes volver en cualquier momento y consultar la primera respuesta de cada ejercicio.</p>
    {sections.map(section => <section key={section.title} aria-label={section.title}>
      <h3>{section.title}</h3>
      <div className="lab-lesson-list">{section.checks.map(({ objective, label }) => {
        const target = targets.get(objective)!
        return <button key={objective} className="lab-lesson" onClick={() => open(target)}>
          <span><strong>{label}</strong><small>{results.get(target.attemptGroupId)?.label ?? 'Por comprobar'}</small></span>
        </button>
      })}</div>
    </section>)}
  </details>
}
