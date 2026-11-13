import { useEffect, useRef, useState } from 'react'

export type LabSection = 'map' | 'review' | 'exams' | 'settings'

export type StudyLocation = {
  pack: string
  lesson?: string
  activity?: string
  session?: string
  positionId?: string
  group?: string
  exam?: string
  examRun?: string
  proposal?: string
  topic?: string
}

type Route = { section: LabSection; topic?: string; selected?: StudyLocation }
type HistoryEntry = { accountId: string; route: Route; parent?: Route }
const map: Route = { section: 'map' }

function readRoute(accountId: string): Route {
  try {
    const value = JSON.parse(sessionStorage.getItem('tai-lab-location:' + accountId) ?? 'null')
    if (typeof value?.pack !== 'string') return map
    const selected: StudyLocation = { pack: value.pack }
    for (const key of ['lesson', 'activity', 'session', 'positionId', 'group', 'exam', 'examRun', 'proposal', 'topic'] as const) {
      if (typeof value[key] === 'string') selected[key] = value[key]
    }
    if (selected.lesson || selected.session || selected.exam || selected.activity && selected.group) {
      const section = selected.exam ? 'exams' : selected.proposal || !selected.lesson && !selected.session ? 'review' : 'map'
      return { section, topic: selected.topic, selected }
    }
  } catch { /* Study history remains available when session storage is unavailable. */ }
  return map
}

export function useStudyNavigation(accountId: string) {
  const [route, setRoute] = useState(() => {
    const entry = window.history.state?.laboratory as HistoryEntry | undefined
    return entry?.accountId === accountId ? entry.route : readRoute(accountId)
  })
  const current = useRef<HistoryEntry>({ accountId, route })

  function commit(next: Route, method: 'pushState' | 'replaceState', parent?: Route) {
    current.current = { accountId, route: next, parent }
    window.history[method]({ ...window.history.state, laboratory: current.current }, '')
    setRoute(next)
  }

  useEffect(() => {
    const entry = window.history.state?.laboratory as HistoryEntry | undefined
    if (entry?.accountId === accountId) {
      current.current = entry
      setRoute(entry.route)
    } else commit(current.current.route, 'replaceState')

    function restore(event: PopStateEvent) {
      const entry = event.state?.laboratory as HistoryEntry | undefined
      current.current = entry?.accountId === accountId ? entry : { accountId, route: map }
      setRoute(current.current.route)
    }
    const scrollRestoration = window.history.scrollRestoration
    window.history.scrollRestoration = 'manual'
    window.addEventListener('popstate', restore)
    return () => {
      window.removeEventListener('popstate', restore)
      window.history.scrollRestoration = scrollRestoration
    }
  }, [accountId])

  useEffect(() => {
    try {
      // A same-tab Drive reconnection creates a new history entry. Keep the study
      // destination under Settings so returning from Drive can reopen that work.
      const saved = route.selected ?? (route.section === 'settings' ? current.current.parent?.selected : undefined)
      if (saved) sessionStorage.setItem('tai-lab-location:' + accountId, JSON.stringify(saved))
      else sessionStorage.removeItem('tai-lab-location:' + accountId)
    } catch { /* Answers are saved separately. */ }
  }, [accountId, route])

  function navigate(next: Route, replace = false) {
    const entry = current.current
    commit(next, replace ? 'replaceState' : 'pushState', replace ? entry.parent : entry.route)
  }

  function close(fallback: Route) {
    if (current.current.parent) window.history.back()
    else navigate(fallback, true)
  }

  function updateSelected(update: (selected: StudyLocation | undefined) => StudyLocation | undefined) {
    const entry = current.current
    const selected = update(entry.route.selected)
    if (selected !== entry.route.selected) commit({ ...entry.route, selected }, 'replaceState', entry.parent)
  }

  return { route, navigate, close, updateSelected }
}
