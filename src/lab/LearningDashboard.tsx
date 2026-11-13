import { useState } from 'react'
import { ArrowRight, CalendarDays, Layers, Lightbulb } from 'lucide-react'
import { labTopics } from './study-scope'
import type { LearningSnapshot } from './learning'
import type { LearningRecommendation, RecommendationResult } from './recommendation'

export function LearningDashboard({ snapshot, queue, open, skip, reset, initialTopic }: {
  snapshot: LearningSnapshot; queue: RecommendationResult; open: (proposal: LearningRecommendation) => void
  skip: (id: string) => void; reset: () => void; initialTopic?: string
}) {
  const [block, setBlock] = useState(initialTopic?.split('.')[0] ?? 'all')
  const [topic, setTopic] = useState(initialTopic ?? 'all')
  const objectiveTopics = new Map(snapshot.objectives.map(objective => [objective.key, objective.topicId]))
  const items = queue.items.filter(proposal => (block === 'all' || proposal.block === block)
    && (topic === 'all' || proposal.objectiveKeys.some(key => objectiveTopics.get(key) === topic)))
  return <section className="lab-learning" aria-label="Cola de repaso">
    <div className="lab-review-filters">
      <label>Bloque<select value={block} onChange={event => { setBlock(event.target.value); setTopic('all') }}>
        <option value="all">Todos</option>
        {['II', 'III', 'IV'].map(item => <option value={item} key={item}>Bloque {item}</option>)}
      </select></label>
      <label>Tema<select value={topic} onChange={event => setTopic(event.target.value)}>
        <option value="all">Todos los temas</option>
        {labTopics.filter(item => block === 'all' || item.block === block).map(item =>
          <option value={item.id} key={item.id}>{item.id} · {item.title}</option>)}
      </select></label>
    </div>
    {items.length ? <ul className="lab-review-list">{items.map(proposal => {
      const topics = [...new Set(proposal.objectiveKeys.flatMap(key => objectiveTopics.get(key) ?? []))]
      return <li key={proposal.id} className="lab-review-row">
        <div><p className="context-label">{topics.length ? topics.join(', ') + ' · ' : ''}{reasonLabels[proposal.reason]}</p>
          <h3>{proposal.title}</h3><p>{proposal.message}</p></div>
        <div className="lab-actions">
          <button className="button primary" onClick={() => open(proposal)}>Empezar propuesta <ArrowRight size={17} aria-hidden="true" /></button>
          <button className="text-link" onClick={() => skip(proposal.id)}>Omitir propuesta</button>
        </div>
      </li>
    })}</ul> : <p>No hay propuestas en esta selección. <button className="text-link" onClick={reset}>Restablecer propuestas</button></p>}
    {queue.limitations.length > 0 && <details><summary>Disponibilidad de los repasos</summary>
      {queue.limitations.map(limit => <p key={limit}>{limit}</p>)}
    </details>}
  </section>
}

const reasonLabels = {
  resume: 'Actividad en curso',
  prerequisite: 'Base recomendada',
  'critical-error': 'Para repasar',
  due: 'Repaso del día',
  continue: 'Siguiente lección',
  transfer: 'Caso nuevo',
  'balance-iv': 'Repaso del bloque IV',
}

export function TopicLearning({ snapshot, topic }: { snapshot: LearningSnapshot; topic?: string }) {
  const [expanded, setExpanded] = useState(false)
  const objectives = snapshot.objectives.filter(objective => !topic || objective.topicId === topic)
  if (!objectives.length) return null

  const count = (field: 'understandingIds' | 'retentionIds' | 'transferIds') => new Set(objectives.flatMap(objective => objective[field])).size
  const labels = { insufficient: 'En aprendizaje', consolidated: 'Consolidado', 'review-open': 'Pendiente de repaso', uncertain: 'Comprobación incompleta' }
  const visible = expanded ? objectives : objectives.filter(objective => objective.qualifyingCorrectIds.length || objective.reviews.length).slice(0, 4)
  return <details className="lab-learning-details lab-topic-learning">
    <summary>Comprensión, retención y transferencia</summary>
    <p>{objectives.filter(objective => objective.status === 'consolidated').length} de {objectives.length} objetivos consolidados</p>
    <div className="lab-learning-dimensions">
      <div><Lightbulb size={20} aria-hidden="true" /><strong>{count('understandingIds')}</strong><h3>Comprensión</h3><p>Primeras respuestas correctas sin ayuda.</p></div>
      <div><CalendarDays size={20} aria-hidden="true" /><strong>{count('retentionIds')}</strong><h3>Retención</h3><p>Aciertos al repasar después del intervalo previsto.</p></div>
      <div><Layers size={20} aria-hidden="true" /><strong>{count('transferIds')}</strong><h3>Transferencia</h3><p>Aciertos sin ayuda en ejercicios de un tipo nuevo.</p></div>
    </div>
    <details className="lab-learning-details"><summary>Cómo avanza tu aprendizaje</summary>
      <p>Cada dimensión se apoya en respuestas guardadas. Completar una lección no equivale a consolidarla.</p>
      <ul className="lab-learning-mobile-definitions">
        <li>Comprensión: primeras respuestas correctas sin ayuda.</li>
        <li>Retención. Aciertos al repasar después del intervalo previsto.</li>
        <li>Transferencia. Aciertos sin ayuda en ejercicios de un tipo nuevo.</li>
      </ul>
      <p>Consolidación: tres aciertos sin ayuda, dos familias y dos días separados por al menos 24 horas; una recuperación diferida y una familia nueva. Los errores pendientes abren repaso.</p>
      <p>Los intervalos orientativos son 1, 3, 7, 14 y 30 días. Usamos las fechas de tus dispositivos y el historial disponible; la sincronización puede completar o revisar los indicadores.</p>
      <p>Las respuestas antiguas siguen guardadas. Si les faltan datos sobre presentación, ayudas o fechas, no se convierten en nueva evidencia.</p>
      {snapshot.uncertainties.length > 0 && <p>Hay evidencia pendiente o ambigua. Sus límites aparecen al revisar cada objetivo.</p>}
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
    {objectives.length > 0 && <button className="text-link" onClick={() => setExpanded(value => !value)}>
      {expanded ? 'Mostrar solo progreso reciente' : 'Ver todos los objetivos disponibles'}</button>}
  </details>
}
