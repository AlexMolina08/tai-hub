import { useMemo, useState } from 'react'
import { ArrowRight, CalendarDays, Layers, Lightbulb } from 'lucide-react'
import type { LabEvent, LabPackage } from './model'
import type { LearningSnapshot } from './learning'
import { recommendLearning, type LearningDestination } from './recommendation'

export function LearningDashboard({ snapshot, packages, events, open }: {
  snapshot: LearningSnapshot; packages: LabPackage[]; events: LabEvent[]; open: (target: LearningDestination) => void
}) {
  const [skipped, setSkipped] = useState<string[]>([])
  const [expanded, setExpanded] = useState(false)
  const queue = useMemo(() => recommendLearning({ packages, events, learning: snapshot, skipped }), [packages, events, snapshot, skipped])
  const next = queue.items[0]
  const count = (field: 'understandingIds' | 'retentionIds' | 'transferIds') => new Set(snapshot.objectives.flatMap(objective => objective[field])).size
  const labels = { insufficient: 'En aprendizaje', consolidated: 'Consolidado', 'review-open': 'Repaso abierto', uncertain: 'Evidencia incompleta' }
  const reasonLabels = {
    resume: 'Actividad en curso',
    prerequisite: 'Base recomendada',
    'critical-error': 'Refuerzo de fallo',
    due: 'Repaso del día',
    continue: 'Siguiente lección',
    transfer: 'Caso nuevo',
    'balance-iv': 'Turno del Bloque IV',
  }
  const visible = expanded ? snapshot.objectives : snapshot.objectives.filter(objective => objective.qualifyingCorrectIds.length || objective.reviews.length).slice(0, 4)
  return <section className="lab-learning" aria-labelledby="lab-learning-heading">
    {next ? <section className="lab-next-step" aria-label="Siguiente paso recomendado">
      <div><p className="context-label">Siguiente paso · {reasonLabels[next.reason]}</p><h2>{next.title}</h2><p>{next.message}</p></div>
      <div className="lab-actions"><button className="button primary" onClick={() => open(next.target)}>Empezar propuesta <ArrowRight size={17} /></button>
        <button className="text-link" onClick={() => setSkipped(current => [...current, next.id])}>Otra propuesta</button></div>
    </section> : <p>No quedan propuestas en esta selección. Puedes explorar las lecciones o <button className="text-link" onClick={() => setSkipped([])}>restablecer propuestas</button>.</p>}
    <header><p className="context-label">Tu progreso</p><h2 id="lab-learning-heading">Comprender, recordar, aplicar</h2>
      <p className="lab-learning-lead">Objetivos acreditados en cada fase del estudio ({snapshot.objectives.length} objetivos en total):</p></header>
    <div className="lab-learning-dimensions">
      <div><Lightbulb size={20} aria-hidden="true" /><strong>{count('understandingIds')}</strong><h3>Comprensión</h3><p>Primeras respuestas correctas sin ayuda.</p></div>
      <div><CalendarDays size={20} aria-hidden="true" /><strong>{count('retentionIds')}</strong><h3>Retención</h3><p>Recuperaciones tras el intervalo previsto.</p></div>
      <div><Layers size={20} aria-hidden="true" /><strong>{count('transferIds')}</strong><h3>Transferencia</h3><p>Resoluciones sin ayuda de familias nuevas.</p></div>
    </div>
    <details className="lab-learning-details"><summary>Cómo avanza tu aprendizaje</summary>
      <p>Cada dimensión se apoya en respuestas guardadas. Completar una lección no equivale a consolidarla.</p>
      <ul className="lab-learning-mobile-definitions">
        <li>Comprensión: primeras respuestas correctas sin ayuda.</li>
        <li>Retención: recuperaciones tras el intervalo previsto.</li>
        <li>Transferencia: resoluciones sin ayuda de familias nuevas.</li>
      </ul>
      <p>Consolidación: tres aciertos sin ayuda, dos familias y dos días separados por al menos 24 horas; una recuperación diferida y una familia nueva. Los errores pendientes abren repaso.</p>
      <p>Los intervalos orientativos son 1, 3, 7, 14 y 30 días. Usamos las fechas de tus dispositivos y el historial disponible; la sincronización puede completar o revisar los indicadores.</p>
      <p>Las respuestas antiguas siguen guardadas. Si les faltan datos sobre presentación, ayudas o fechas, no se convierten en nueva evidencia.</p>
      <small>Regla de aprendizaje: {snapshot.policyVersion}. No estima tu puesto en el examen.</small>
      {snapshot.uncertainties.length > 0 && <p>Hay evidencia pendiente o ambigua. Sus límites aparecen al revisar cada objetivo.</p>}
      {queue.limitations.map(limit => <p key={limit}>{limit}</p>)}
    </details>
    {(visible.length > 0 || expanded) && <div className="lab-objective-progress">{visible.map(objective => <details key={objective.key}>
      <summary><span>{objective.title}</span><small>{labels[objective.status]}</small></summary>
      <p>{objective.requirements.correct.actual}/{objective.requirements.correct.required} aciertos elegibles · {objective.requirements.families.actual}/{objective.requirements.families.required} familias · {objective.requirements.days.actual}/{objective.requirements.days.required} días</p>
      <ul><li>{objective.requirements.delayed ? 'Recuperación diferida registrada.' : 'Falta recuperación diferida.'}</li>
        <li>{objective.requirements.freshTransfer ? 'Familia nueva resuelta sin ayuda.' : 'Falta comprobar una familia nueva.'}</li>
        <li>{objective.requirements.noOpenErrors ? 'Sin errores de repaso pendientes.' : 'Hay errores pendientes de repaso.'}</li></ul>
      {objective.schedule && <p>Próximo repaso orientativo: {new Intl.DateTimeFormat('es', { dateStyle: 'medium' }).format(new Date(objective.schedule.dueAt))}.</p>}
      {objective.reasons.map((reason, index) => <p key={`${reason.code}:${index}`}>{reason.message}</p>)}
      <small>Edición {objective.packageVersion} · {objective.topicId}</small>
    </details>)}</div>}
    {snapshot.objectives.length > 0 && <button className="text-link" onClick={() => setExpanded(value => !value)}>
      {expanded ? 'Mostrar solo progreso reciente' : 'Ver todos los objetivos disponibles'}</button>}
  </section>
}
