import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, Check, ChevronRight, Search } from 'lucide-react'
import type { Attempt, Draft, LabEvent, LabPackage, Lesson } from './model'
import { isBasicTechnologyTopic, labBlocks, labTopics as topics } from './study-scope'
import './study-map.css'
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
  const eventsByEdition = new Map<string, (Attempt | Draft)[]>()
  for (const event of events) {
    if (event.accountId !== accountId || (event.kind !== 'attempt' && event.kind !== 'draft')) continue
    const edition = JSON.stringify([event.packageId, event.packageVersion])
    const saved = eventsByEdition.get(edition)
    if (saved) saved.push(event)
    else eventsByEdition.set(edition, [event])
  }
  if (!includePrevious) for (const pack of current) for (const lesson of pack.lessons) {
    lessonCounts.set(lesson.id, (lessonCounts.get(lesson.id) ?? 0) + 1)
  }
  const entries = current.flatMap(pack => {
    const objectives = new Map(pack.objectives.map(objective => [objective.id, objective]))
    const activities = new Map(pack.activities.map(activity => [activity.id, activity]))
    const matching = (eventsByEdition.get(JSON.stringify([pack.id, pack.version])) ?? [])
      .filter(event => activities.get(event.activityId)?.version === event.activityVersion)
    const answered = new Set(matching.filter((event): event is Attempt => event.kind === 'attempt' && event.outcome !== 'omitted')
      .map(event => event.activityId))
    const progress = new Set(matching.filter(event => event.kind !== 'draft' || event.value !== '').map(event => event.activityId))
    const savedCopies = new Set(matching.map(event => event.activityId))
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
        progress: lesson.activityIds.filter(id => progress.has(id)).length,
        saved: lesson.activityIds.filter(id => savedCopies.has(id)).length, content,
        search: normalize([lesson.title, ...lessonTopics, ...own.flatMap(objective => [objective.statement, ...objective.concepts]),
          ...topics.filter(topic => lessonTopics.includes(topic.id)).map(topic => topic.title)].join(' ')) }
    })
  })
  if (includePrevious) return entries
  const distinct = new Map<string, typeof entries[number]>()
  for (const item of entries) {
    const previous = distinct.get(item.content)
    if (previous?.saved && item.saved) {
      distinct.set(key(item.pack, item.lesson), item)
    } else if (!previous || item.saved > previous.saved) {
      distinct.set(item.content, item)
    }
  }
  return [...distinct.values()]
}

function orderedLessonGroups(visible: ReturnType<typeof buildCatalogue>) {
  const groups = new Map<string, typeof visible>()
  for (const item of visible) {
    // Multi-topic lessons appear once in the complete catalogue.
    const groupId = item.topicIds.find(id => topics.some(topic => topic.id === id)) ?? 'other'
    const group = groups.get(groupId)
    if (group) group.push(item)
    else groups.set(groupId, [item])
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

export function studyTopicForLesson(pack: LabPackage, lesson: Lesson, preferred?: string) {
  const ids = new Set(lesson.objectiveIds)
  const included = new Set(pack.objectives.filter(objective => ids.has(objective.id)).map(objective => objective.topicId))
  return topics.find(topic => topic.id === preferred && included.has(topic.id))
    ?? topics.find(topic => included.has(topic.id))
}

export function nextCatalogueTopic(packages: LabPackage[], topicId: string) {
  const available = new Set<string>()
  for (const pack of latestLabPackages(packages).values()) {
    const lessonObjectives = new Set(pack.lessons.flatMap(lesson => lesson.objectiveIds))
    for (const objective of pack.objectives) {
      if (lessonObjectives.has(objective.id)) available.add(objective.topicId)
    }
  }
  const position = topics.findIndex(topic => topic.id === topicId)
  if (position === -1) return undefined
  return topics.slice(position + 1).find(topic => available.has(topic.id)
    && isBasicTechnologyTopic(topic.id) === isBasicTechnologyTopic(topicId))
}

export function nextCatalogueLesson(packages: LabPackage[], events: LabEvent[], accountId: string, pack: LabPackage, lesson: Lesson, topicId?: string) {
  const oldEdition = latestLabPackages(packages).get(pack.id) !== pack
  const catalogue = buildCatalogue(oldEdition ? [pack] : packages, events, accountId, false)
  const entries = topicId ? uniqueLessons(topicLessons(catalogue, topicId)).primary : orderedLessonGroups(catalogue).flatMap(([, items]) => items)
  const original = catalogue.find(item => item.pack === pack && item.lesson === lesson)
  const exact = entries.findIndex(item => item.pack === pack && item.lesson === lesson)
  const index = exact >= 0 ? exact : entries.findIndex(item => original
    ? item.content === original.content : item.lesson.id === lesson.id)
  if (index < 0) return undefined
  const basicTechnology = entries[index].topicIds.some(isBasicTechnologyTopic)
  return entries.slice(index + 1).find(item => item.content !== entries[index].content
    && item.topicIds.some(isBasicTechnologyTopic) === basicTechnology)
}

type CatalogueLesson = ReturnType<typeof buildCatalogue>[number]
type StudyTopic = typeof topics[number]

function topicLessons(catalogue: CatalogueLesson[], topicId: string) {
  return catalogue.filter(item => item.topicIds.includes(topicId)).sort((a, b) =>
    numericOrder.compare(a.firstUnitByTopic.get(topicId) ?? '', b.firstUnitByTopic.get(topicId) ?? ''))
}

function isComplete(item: CatalogueLesson) {
  return item.lesson.activityIds.length > 0 && item.answered === item.lesson.activityIds.length
}

function uniqueLessons(items: CatalogueLesson[]) {
  const byContent = new Map<string, CatalogueLesson>()
  const alternatives: CatalogueLesson[] = []
  for (const item of items) {
    const previous = byContent.get(item.content)
    if (!previous) byContent.set(item.content, item)
    else if (item.answered > previous.answered) {
      byContent.set(item.content, item)
      alternatives.push(previous)
    } else alternatives.push(item)
  }
  return { primary: [...byContent.values()], alternatives }
}

function summarize(items: CatalogueLesson[]) {
  const done = items.filter(isComplete).length
  const total = items.length
  const percent = total ? done === total ? 100 : Math.min(99, Math.round(done * 100 / total)) : 0
  return { done, total, percent }
}

interface ReturnPoint {
  element: HTMLElement
  top: number
}

function returnTo(point?: ReturnPoint) {
  if (!point?.element.getClientRects().length) return false
  window.scrollTo({ top: point.top, behavior: 'instant' })
  point.element.focus({ preventScroll: true })
  return true
}

export function StudyMap({ packages, events, accountId, active = true, topicId, defaultTopicId, onTopicChange, openLesson, topicExtras }: {
  packages: LabPackage[]
  events: LabEvent[]
  accountId: string
  active?: boolean
  topicId?: string
  defaultTopicId?: string
  onTopicChange: (topicId?: string) => void
  openLesson: (pack: LabPackage, lesson: Lesson, topicId?: string) => void
  topicExtras?: (topicId: string) => ReactNode
}) {
  const [blockChoice, setBlock] = useState<string>()
  const [query, setQuery] = useState('')
  const [showSearchTopic, setShowSearchTopic] = useState(false)
  const [includePrevious, setIncludePrevious] = useState(false)
  const [limit, setLimit] = useState(lessonPageSize)
  const search = useRef<HTMLInputElement>(null)
  const detailHeading = useRef<HTMLHeadingElement>(null)
  const mapReturn = useRef<ReturnPoint>(undefined)
  const lessonReturn = useRef<ReturnPoint>(undefined)
  const previousView = useRef({ active, topicId })
  const latest = useMemo(() => latestLabPackages(packages), [packages])
  const current = useMemo(() => buildCatalogue(packages, events, accountId, false), [packages, events, accountId])
  const old = useMemo(() => includePrevious ? buildCatalogue(packages.filter(pack => latest.get(pack.id) !== pack), events, accountId, true) : [],
    [packages, events, latest, includePrevious])
  const previousAvailable = packages.some(pack => latest.get(pack.id) !== pack && pack.lessons.length > 0)
  const byTopic = useMemo(() => new Map(topics.map(topic => [topic.id, uniqueLessons(topicLessons(current, topic.id))])), [current])
  const progress = useMemo(() => new Map([...byTopic].map(([id, items]) => [id, summarize(items.primary)])), [byTopic])
  const unclassified = useMemo(() => current.filter(item => !item.topicIds.some(id => byTopic.has(id))), [current, byTopic])
  const unclassifiedOld = includePrevious ? old.filter(item => !item.topicIds.some(id => byTopic.has(id))) : []
  const unclassifiedOnly = unclassified.length > 0 && unclassified.length === current.length
  const otherLessons = [...unclassified, ...unclassifiedOld]
  const initial = topics.find(topic => topic.id === (defaultTopicId ?? 'III.1'))
  const block = topics.find(topic => topic.id === topicId)?.block ?? blockChoice ?? initial?.block ?? 'III'
  const blockTopics = topics.filter(topic => topic.block === block)
  const selected = blockTopics.find(topic => topic.id === topicId) ?? blockTopics.find(topic => topic.id === initial?.id)
    ?? blockTopics.find(topic => byTopic.get(topic.id)?.primary.length) ?? blockTopics[0]
  const words = normalize(query).trim().split(/\s+/).filter(Boolean)
  const searching = words.length > 0
  const results = searching ? [...current, ...old].filter(item => words.every(word => item.search.includes(word))) : []
  const matchingTopics = searching ? topics.filter(topic => {
    const searchable = normalize(`${topic.id} ${topic.title}`)
    return words.every(word => searchable.includes(word))
  }) : []
  const duplicateTitles = useMemo(() => {
    const counts = new Map<string, number>()
    for (const { lesson } of [...current, ...old]) counts.set(lesson.title, (counts.get(lesson.title) ?? 0) + 1)
    return counts
  }, [current, old])

  useLayoutEffect(() => {
    const previous = previousView.current
    previousView.current = { active, topicId }
    if (!active) return
    if (!previous.active && previous.topicId === topicId && returnTo(lessonReturn.current)) {
      lessonReturn.current = undefined
      return
    }
    if (previous.topicId === topicId) return
    if (!topicId && returnTo(mapReturn.current)) return
    if (topicId && detailHeading.current) {
      detailHeading.current.focus({ preventScroll: true })
      detailHeading.current.scrollIntoView({ block: 'nearest', behavior: 'instant' })
    }
  }, [active, topicId])

  function chooseTopic(topic: StudyTopic, element: HTMLButtonElement) {
    mapReturn.current = { element, top: window.scrollY }
    setBlock(topic.block)
    setLimit(lessonPageSize)
    setShowSearchTopic(true)
    onTopicChange(topic.id)
  }

  function chooseLesson(item: CatalogueLesson, element: HTMLButtonElement, topic?: string) {
    lessonReturn.current = { element, top: window.scrollY }
    openLesson(item.pack, item.lesson, topic)
  }

  function topicRow(topic: StudyTopic) {
    const entry = progress.get(topic.id)!
    return <li key={topic.id}>
      <button className="study-topic-row" aria-current={selected.id === topic.id ? 'true' : undefined}
        onClick={event => chooseTopic(topic, event.currentTarget)}>
        <span className="study-topic-name"><span>{topic.id}</span> {topic.title}</span>
        {entry.total > 0 && <strong className="study-percent">{entry.percent} %</strong>}
        <small>{entry.total ? `${entry.done} de ${entry.total} lecciones` : packages.length ? 'Sin contenido disponible' : 'Catálogo pendiente de cargar'}</small>
        {entry.total > 0 && <progress className="study-progress" value={entry.done} max={entry.total} aria-hidden="true" />}
      </button>
    </li>
  }

  function editionsToggle(className: string) {
    return previousAvailable && <label className={`lab-editions-filter ${className}`}>
      <input type="checkbox" checked={includePrevious} onChange={event => { setIncludePrevious(event.target.checked); setLimit(lessonPageSize) }} />
      Mostrar ediciones anteriores
    </label>
  }

  function lessonRow(item: CatalogueLesson, order?: number, topic?: string, next = false) {
    const { pack, lesson, answered } = item
    const previous = latest.get(pack.id) !== pack
    const complete = isComplete(item)
    return <li key={key(pack, lesson)}>
      <button className="lab-lesson study-lesson-row" data-next={next || undefined} onClick={event => chooseLesson(item, event.currentTarget, topic)}>
        {order !== undefined && <span className="study-lesson-number" data-complete={complete || undefined} aria-hidden="true">
          {complete ? <Check size={15} /> : order}</span>}
        <span>
          <strong>{lesson.title}</strong>
          {order === undefined && <small>{item.topicIds.map(id => {
            const name = topics.find(topic => topic.id === id)?.title
            return name ? `${id} ${name}` : id
          }).join(' · ')}</small>}
          <small>{complete ? 'Completada' : item.progress ? 'En curso' : 'Pendiente'} · {answered} de {lesson.activityIds.length} actividades respondidas</small>
          {(previous || (duplicateTitles.get(lesson.title) ?? 0) > 1) && <small>{pack.title} · Edición {pack.version}</small>}
        </span>
        <ChevronRight size={17} aria-hidden="true" />
      </button>
    </li>
  }

  const lessons = byTopic.get(selected.id)?.primary ?? []
  const alternatives = byTopic.get(selected.id)?.alternatives ?? []
  const earlierLessons = includePrevious ? topicLessons(old, selected.id) : []
  const summary = progress.get(selected.id) ?? summarize([])
  const nextLesson = lessons.find(item => !isComplete(item))
  const other = !searching && otherLessons.length > 0 && <details className="study-unclassified" open={unclassifiedOnly || undefined}>
    <summary>Otras lecciones</summary>
    <ul className="study-lesson-rows">{otherLessons.slice(0, limit).map(item => lessonRow(item))}</ul>
    {otherLessons.length > limit && <button className="button" onClick={() => setLimit(value => value + lessonPageSize)}>Mostrar más lecciones</button>}
  </details>

  return <section className="study-map" aria-label="Explorar lecciones" data-topic-open={Boolean(topicId)}>
    {unclassifiedOnly && !topicId && other}
    <div className="study-map-layout">
      <div className="study-map-list">
        <header className="study-map-header">
          <h2 data-study-heading tabIndex={-1}>Mapa del temario</h2>
          <label className="study-map-search">
            <Search size={18} aria-hidden="true" />
            <span className="sr-only">Buscar lecciones</span>
            <input ref={search} type="search" value={query} onChange={event => {
              setQuery(event.target.value)
              setShowSearchTopic(false)
              setLimit(lessonPageSize)
            }}
              placeholder="Buscar un tema o una lección" />
          </label>
        </header>
        {editionsToggle('study-editions-map')}
        {!searching && <>
          <div className="study-map-blocks" role="group" aria-label="Bloques del temario">
            {labBlocks.map(item => <button key={item.roman} aria-pressed={block === item.roman} onClick={() => {
              if (block === item.roman) return
              setBlock(item.roman)
              setLimit(lessonPageSize)
              mapReturn.current = undefined
              if (topicId) onTopicChange(undefined)
            }}>Bloque {item.roman}</button>)}
          </div>
          <p className="study-map-block-name">{labBlocks.find(item => item.roman === block)?.title}</p>
          <ul className="study-topics">{blockTopics.map(topicRow)}</ul>
        </>}
        {searching && <div className="study-map-results">
          {matchingTopics.length > 0 && <ul className="study-topics" aria-label="Temas encontrados">{matchingTopics.map(topicRow)}</ul>}
          <p role="status">{results.length} {results.length === 1 ? 'lección disponible' : 'lecciones disponibles'}</p>
          {results.length > 0 ? <ul className="study-lesson-rows">{results.slice(0, limit).map(item => lessonRow(item))}</ul>
            : <p>No hay lecciones disponibles con estos filtros.</p>}
          {results.length > limit && <button className="button" onClick={() => setLimit(value => value + lessonPageSize)}>Mostrar más lecciones</button>}
          <button className="text-link" onClick={() => { setQuery(''); search.current?.focus() }}>Volver al mapa</button>
        </div>}
      </div>
      <section className="study-topic-detail" aria-labelledby="study-topic-title" data-search-hidden={searching && !(topicId && showSearchTopic)}>
        {topicId && <button className="text-link study-map-back" onClick={() => onTopicChange(undefined)}>
          <ArrowLeft size={16} aria-hidden="true" /> Volver al mapa
        </button>}
        <header>
          <p className="study-topic-code">Tema {selected.id}</p>
          <h2 id="study-topic-title" ref={detailHeading} tabIndex={-1}>{selected.title}</h2>
          {summary.total > 0 ? <>
            <p className="study-topic-summary"><strong>{summary.percent} %</strong> · {summary.done} de {summary.total} lecciones completadas</p>
            <progress className="study-progress" value={summary.done} max={summary.total} aria-label="Lecciones completadas" />
          </> : <p className="study-topic-summary">{packages.length ? 'Sin contenido disponible' : 'Catálogo pendiente de cargar'}</p>}
        </header>
        {nextLesson && <button className="button primary study-continue-topic" onClick={event => chooseLesson(nextLesson, event.currentTarget, selected.id)}>
          Continuar tema <ArrowRight size={17} aria-hidden="true" />
        </button>}
        {lessons.length > 0 && <>
          <ol className="study-lesson-rows">{lessons.slice(0, limit).map((item, index) => lessonRow(item, index + 1, selected.id, item === nextLesson))}</ol>
          {lessons.length > limit && <button className="button" onClick={() => setLimit(value => value + lessonPageSize)}>Mostrar más lecciones</button>}
        </>}
        {alternatives.length > 0 && <details className="study-topic-older">
          <summary>Copias con trabajo guardado</summary>
          <ul className="study-lesson-rows">{alternatives.map(item => lessonRow(item, undefined, selected.id))}</ul>
        </details>}
        {editionsToggle('study-editions-detail')}
        {earlierLessons.length > 0 && <section className="study-topic-older" aria-label="Ediciones anteriores">
          <h3>Ediciones anteriores</h3>
          <ul className="study-lesson-rows">{earlierLessons.map(item => lessonRow(item, undefined, selected.id))}</ul>
        </section>}
        {active && topicExtras?.(selected.id)}
      </section>
    </div>
    {(!unclassifiedOnly || topicId) && other}
  </section>
}
