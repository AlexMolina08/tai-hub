import { useMemo, useRef, useState } from 'react'
import { ArrowRight, Search } from 'lucide-react'
import { blocks } from '../syllabus'
import type { Attempt, LabEvent, LabPackage, Lesson } from './model'

const topics = blocks.filter(block => block.id === 'b3' || block.id === 'b4').flatMap(block =>
  block.topics.map(topic => ({ id: `${block.roman}.${topic.number}`, block: block.roman, title: topic.title })))
const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es')
const key = (pack: LabPackage, lesson: Lesson) => JSON.stringify([pack.id, pack.version, lesson.id])

export function LessonCatalog({ packages, events, accountId, openLesson }: {
  packages: LabPackage[]; events: LabEvent[]; accountId: string; openLesson: (pack: LabPackage, lesson: Lesson) => void
}) {
  const [query, setQuery] = useState('')
  const search = useRef<HTMLInputElement>(null)
  const [block, setBlock] = useState('all')
  const [topicId, setTopicId] = useState('all')
  const catalogue = useMemo(() => packages.flatMap(pack => {
    const objectives = new Map(pack.objectives.map(objective => [objective.id, objective]))
    const answered = new Set(events.filter((event): event is Attempt => event.kind === 'attempt' && event.accountId === accountId
      && event.packageId === pack.id && event.packageVersion === pack.version && event.outcome !== 'omitted'
      && pack.activities.some(activity => activity.id === event.activityId && activity.version === event.activityVersion))
      .map(event => event.activityId))
    return pack.lessons.map(lesson => {
      const own = lesson.objectiveIds.flatMap(id => objectives.get(id) ?? [])
      const lessonTopics = [...new Set(own.map(objective => objective.topicId))]
      return { pack, lesson, topicIds: lessonTopics, answered: lesson.activityIds.filter(id => answered.has(id)).length,
        search: normalize([lesson.title, ...own.map(objective => objective.statement),
          ...topics.filter(topic => lessonTopics.includes(topic.id)).map(topic => topic.title)].join(' ')) }
    })
  }), [packages, events, accountId])
  const availableTopics = topics.filter(topic => catalogue.some(item => item.topicIds.includes(topic.id))
    && (block === 'all' || topic.block === block))
  const words = normalize(query).trim().split(/\s+/).filter(Boolean)
  const visible = catalogue.filter(item => (block === 'all' || item.topicIds.some(id => id.startsWith(block + '.')))
    && (topicId === 'all' || item.topicIds.includes(topicId)) && words.every(word => item.search.includes(word)))
  const groups = new Map<string, typeof visible>()
  for (const item of visible) {
    // Multi-topic lessons appear once, under the selected topic when applicable.
    const groupId = topicId !== 'all' ? topicId : item.topicIds.find(id => topics.some(topic => topic.id === id)
      && (block === 'all' || id.startsWith(block + '.'))) ?? 'other'
    groups.set(groupId, [...(groups.get(groupId) ?? []), item])
  }
  const orderedGroups = [...groups.entries()].sort(([a], [b]) => {
    const ai = topics.findIndex(topic => topic.id === a), bi = topics.findIndex(topic => topic.id === b)
    return (ai < 0 ? topics.length : ai) - (bi < 0 ? topics.length : bi)
  })
  return <section className="lab-catalog" aria-labelledby="lab-catalog-heading">
    <header><h2 id="lab-catalog-heading">Explorar lecciones</h2><p>Elige un tema y avanza a tu ritmo.</p></header>
    <div className="lab-catalog-filters">
      <label className="lab-catalog-search"><span className="sr-only">Buscar lecciones</span><Search size={18} aria-hidden="true" />
        <input ref={search} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar un concepto o una lección" /></label>
      <div className="lab-block-filter" aria-label="Filtrar por bloque">{[
        ['all', 'Todos'], ['III', 'Bloque III'], ['IV', 'Bloque IV'],
      ].map(([id, title]) => <button key={id} aria-pressed={block === id} onClick={() => { setBlock(id); setTopicId('all') }}>{title}</button>)}</div>
      <label className="lab-topic-filter">Tema<select value={topicId} onChange={event => setTopicId(event.target.value)}>
        <option value="all">Todos los temas disponibles</option>
        {availableTopics.map(topic => <option key={topic.id} value={topic.id}>{topic.id} · {topic.title}</option>)}
      </select></label>
    </div>
    <p className="lab-catalog-count" role="status">{visible.length} {visible.length === 1 ? 'lección disponible' : 'lecciones disponibles'}</p>
    {orderedGroups.map(([id, items]) => {
      const topic = topics.find(topic => topic.id === id)
      return <section className="lab-topic-group" key={id} aria-label={topic ? `${id} ${topic.title}` : 'Otras lecciones'}>
        <h3>{topic && <span>{id}</span>}{topic?.title ?? 'Otras lecciones'}</h3>
        <div className="lab-lesson-list">{items.map(({ pack, lesson, answered }) => <button className="lab-lesson" key={key(pack, lesson)}
          onClick={() => openLesson(pack, lesson)}>
          <span><strong>{lesson.title}</strong><small>{lesson.minutes} min de contenido nuevo</small>
            <small>{answered} de {lesson.activityIds.length} actividades respondidas</small>
            {catalogue.filter(item => item.lesson.title === lesson.title).length > 1
              && <small>{pack.title} · Edición {pack.version}</small>}</span>
          <ArrowRight size={19} aria-hidden="true" />
        </button>)}</div>
      </section>
    })}
    {!visible.length && <div className="lab-catalog-empty"><p>No hay lecciones disponibles con estos filtros.</p>
      <button className="text-link" onClick={() => { setBlock('all'); setTopicId('all'); setQuery(''); search.current?.focus() }}>Mostrar todas las lecciones</button></div>}
  </section>
}
