import { useMemo, useRef, useState } from 'react'
import { ArrowRight, Search } from 'lucide-react'
import type { Attempt, Draft, LabEvent, LabPackage, Lesson } from './model'
import { isBasicTechnologyTopic, labBlocks, labTopics as topics } from './study-scope'
const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es')
const key = (pack: LabPackage, lesson: Lesson) => JSON.stringify([pack.id, pack.version, lesson.id])
const numericOrder = new Intl.Collator('en', { numeric: true })
const lessonPageSize = 60

export function latestLabPackages(packages: LabPackage[]) {
  const versions = new Map<string, LabPackage>()
  for (const pack of packages) {
    const previous = versions.get(pack.id)
    if (!previous || (numericOrder.compare(pack.version, previous.version) || pack.version.localeCompare(previous.version)) > 0) {
      versions.set(pack.id, pack)
    }
  }
  return versions
}

function buildCatalogue(packages: LabPackage[], events: LabEvent[], accountId: string, includePrevious: boolean) {
  const latest = latestLabPackages(packages)
  const current = packages.filter(pack => includePrevious || latest.get(pack.id) === pack)
  const lessonCounts = new Map<string, number>()
  if (!includePrevious) for (const pack of current) for (const lesson of pack.lessons) {
    lessonCounts.set(lesson.id, (lessonCounts.get(lesson.id) ?? 0) + 1)
  }
  const entries = current.flatMap(pack => {
    const objectives = new Map(pack.objectives.map(objective => [objective.id, objective]))
    const activities = new Map(pack.activities.map(activity => [activity.id, activity]))
    const matching = events.filter((event): event is Attempt | Draft => (event.kind === 'attempt' || event.kind === 'draft')
      && event.accountId === accountId && event.packageId === pack.id && event.packageVersion === pack.version
      && activities.get(event.activityId)?.version === event.activityVersion)
    const answered = new Set(matching.filter((event): event is Attempt => event.kind === 'attempt' && event.outcome !== 'omitted')
      .map(event => event.activityId))
    const progress = new Set(matching.map(event => event.activityId))
    return pack.lessons.map(lesson => {
      const own = lesson.objectiveIds.flatMap(id => objectives.get(id) ?? [])
      const firstUnitByTopic = new Map<string, string>()
      for (const { topicId, unitId } of own) {
        const first = firstUnitByTopic.get(topicId)
        if (!first || numericOrder.compare(unitId, first) < 0) firstUnitByTopic.set(topicId, unitId)
      }
      const lessonTopics = [...firstUnitByTopic.keys()]
      const content = (lessonCounts.get(lesson.id) ?? 0) > 1
        ? JSON.stringify([lesson, own, lesson.activityIds.map(id => activities.get(id))])
        : lesson.id
      return { pack, lesson, topicIds: lessonTopics, firstUnitByTopic, answered: lesson.activityIds.filter(id => answered.has(id)).length,
        progress: lesson.activityIds.filter(id => progress.has(id)).length, content,
        search: normalize([lesson.title, ...own.flatMap(objective => [objective.statement, ...objective.concepts]),
          ...topics.filter(topic => lessonTopics.includes(topic.id)).map(topic => topic.title)].join(' ')) }
    })
  })
  if (includePrevious) return entries
  const distinct = new Map<string, typeof entries[number]>()
  for (const item of entries) {
    const previous = distinct.get(item.content)
    if (previous?.progress && item.progress) {
      distinct.set(key(item.pack, item.lesson), item)
    } else if (!previous || item.progress > previous.progress) {
      distinct.set(item.content, item)
    }
  }
  return [...distinct.values()]
}

function orderedLessonGroups(visible: ReturnType<typeof buildCatalogue>, block = 'all', topicId = 'all') {
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
  for (const [id, items] of orderedGroups) {
    items.sort((a, b) => numericOrder.compare(a.firstUnitByTopic.get(id) ?? '', b.firstUnitByTopic.get(id) ?? ''))
  }
  return orderedGroups
}

export function nextCatalogueLesson(packages: LabPackage[], events: LabEvent[], accountId: string, pack: LabPackage, lesson: Lesson) {
  const oldEdition = latestLabPackages(packages).get(pack.id) !== pack
  const entries = orderedLessonGroups(buildCatalogue(oldEdition ? [pack] : packages, events, accountId, false)).flatMap(([, items]) => items)
  const exact = entries.findIndex(item => item.pack === pack && item.lesson === lesson)
  const index = exact >= 0 ? exact : entries.findIndex(item => item.lesson.id === lesson.id)
  if (index < 0) return undefined
  const basicTechnology = entries[index].topicIds.some(isBasicTechnologyTopic)
  return entries.slice(index + 1).find(item => item.lesson.id !== lesson.id
    && item.topicIds.some(isBasicTechnologyTopic) === basicTechnology)
}

export function LessonCatalog({ packages, events, accountId, openLesson }: {
  packages: LabPackage[]; events: LabEvent[]; accountId: string; openLesson: (pack: LabPackage, lesson: Lesson) => void
}) {
  const [query, setQuery] = useState('')
  const search = useRef<HTMLInputElement>(null)
  const [block, setBlock] = useState('all')
  const [topicId, setTopicId] = useState('all')
  const [includePrevious, setIncludePrevious] = useState(false)
  const [limit, setLimit] = useState(lessonPageSize)
  const latest = useMemo(() => latestLabPackages(packages), [packages])
  const previousAvailable = packages.some(pack => latest.get(pack.id) !== pack && pack.lessons.length > 0)
  const catalogue = useMemo(() => buildCatalogue(packages, events, accountId, includePrevious), [packages, events, accountId, includePrevious])
  const titleCounts = new Map<string, number>()
  for (const { lesson } of catalogue) titleCounts.set(lesson.title, (titleCounts.get(lesson.title) ?? 0) + 1)
  const availableTopics = topics.filter(topic => catalogue.some(item => item.topicIds.includes(topic.id))
    && (block === 'all' || topic.block === block))
  const words = normalize(query).trim().split(/\s+/).filter(Boolean)
  const visible = catalogue.filter(item => (block === 'all' || item.topicIds.some(id => id.startsWith(block + '.')))
    && (topicId === 'all' || item.topicIds.includes(topicId)) && words.every(word => item.search.includes(word)))
  let remaining = limit
  const orderedGroups = orderedLessonGroups(visible, block, topicId).map(([id, items]) => {
    const page = items.slice(0, remaining)
    remaining -= page.length
    return { id, items: page }
  }).filter(({ items }) => items.length > 0)
  return <section className="lab-catalog" aria-labelledby="lab-catalog-heading">
    <header><h2 id="lab-catalog-heading" data-study-heading tabIndex={-1}>Explorar lecciones</h2><p>Elige un tema y avanza a tu ritmo.</p></header>
    <div className="lab-catalog-filters">
      <label className="lab-catalog-search"><span className="sr-only">Buscar lecciones</span><Search size={18} aria-hidden="true" />
        <input ref={search} type="search" value={query} onChange={event => { setQuery(event.target.value); setLimit(lessonPageSize) }} placeholder="Buscar un concepto o una lección" /></label>
      <div className="lab-block-filter" aria-label="Filtrar por bloque">{[
        ['all', 'Todos'], ...labBlocks.map(item => [item.roman, `Bloque ${item.roman}`]),
      ].map(([id, title]) => <button key={id} aria-pressed={block === id} onClick={() => { setBlock(id); setTopicId('all'); setLimit(lessonPageSize) }}>{title}</button>)}</div>
      <label className="lab-topic-filter">Tema<select value={topicId} onChange={event => { setTopicId(event.target.value); setLimit(lessonPageSize) }}>
        <option value="all">Todos los temas disponibles</option>
        {availableTopics.map(topic => <option key={topic.id} value={topic.id}>{topic.id} · {topic.title}</option>)}
      </select></label>
    </div>
    {previousAvailable && <label className="lab-editions-filter">
      <input type="checkbox" checked={includePrevious} onChange={event => { setIncludePrevious(event.target.checked); setTopicId('all'); setLimit(lessonPageSize) }} />
      Mostrar ediciones anteriores
    </label>}
    <p className="lab-catalog-count" role="status">{visible.length} {visible.length === 1 ? 'lección disponible' : 'lecciones disponibles'}</p>
    {orderedGroups.map(({ id, items }) => {
      const topic = topics.find(topic => topic.id === id)
      return <section className="lab-topic-group" key={id} aria-label={topic ? `${id} ${topic.title}` : 'Otras lecciones'}>
        <h3>{topic && <span>{id}</span>}{topic?.title ?? 'Otras lecciones'}</h3>
        <div className="lab-lesson-list">{items.map(({ pack, lesson, answered }) => <button className="lab-lesson" key={key(pack, lesson)}
          onClick={() => openLesson(pack, lesson)}>
          <span><strong>{lesson.title}</strong><small>{lesson.minutes} min de contenido nuevo</small>
            <small>{answered} de {lesson.activityIds.length} actividades respondidas</small>
            {(titleCounts.get(lesson.title) ?? 0) > 1
              && <small>{pack.title} · Edición {pack.version}</small>}</span>
          <ArrowRight size={19} aria-hidden="true" />
        </button>)}</div>
      </section>
    })}
    {visible.length > limit && <button className="button lab-catalog-more" onClick={() => setLimit(count => count + lessonPageSize)}>Mostrar más lecciones</button>}
    {!visible.length && <div className="lab-catalog-empty"><p>No hay lecciones disponibles con estos filtros.</p>
      <button className="text-link" onClick={() => { setBlock('all'); setTopicId('all'); setQuery(''); setLimit(lessonPageSize); search.current?.focus() }}>Mostrar todas las lecciones</button></div>}
  </section>
}
