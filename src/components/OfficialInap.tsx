import { useEffect, useState } from 'react'
import { Bell, Building2, ExternalLink } from 'lucide-react'
import './official-inap.css'

const portal = 'https://www.inap.es/es/seleccion/procesos-selectivos-de-cuerposescalas-generales/cuerpo-de-tecnicos-auxiliares-de-informatica-de-la-administracion-del-estado'
const sede = 'https://sede.inap.gob.es/es/procedimientos-y-servicios/seleccion/procesos-selectivos-de-cuerpos-y-escalas-generales/cuerpo-de-tecnicos-auxiliares-de-informatica-de-la-administracion-del-estado'
const offer = 'https://www.boe.es/diario_boe/txt.php?id=BOE-A-2026-9946'
const feedUrl = 'https://raw.githubusercontent.com/AlexMolina08/tai-hub/official-data/official-inap.json'
const seenKey = 'tai-hub.inap-seen.v1'
const knownOrigins = new Set([
  'https://www.inap.es', 'https://inap.es', 'https://sede.inap.gob.es', 'https://www.boe.es',
  'https://boe.es', 'https://ips.redsara.es', 'https://administracion.gob.es',
])
const shortcuts = [
  { label: 'Portal INAP · Cuerpo TAI', url: portal },
  { label: 'Sede electrónica · Procesos TAI', url: sede },
  { label: 'Espacio del opositor', url: 'https://www.inap.es/es/seleccion/informacion-al-opositor' },
  { label: 'Comisión Permanente de Selección', url: 'https://www.inap.es/es/seleccion/comision-permanente-de-seleccion' },
  { label: 'Inscripción en Pruebas Selectivas', url: 'https://ips.redsara.es/IPSC/secure/buscarConvocatorias' },
  { label: 'Código de normativa TAI en el BOE', url: 'https://www.boe.es/biblioteca_juridica/codigos/codigo.php?id=470' },
]

type OfficialLink = { label: string; url: string }
type OfficialGroup = { title: string; links: OfficialLink[] }
type Call = OfficialLink & { year: number; sections: OfficialGroup[] }
type Notice = OfficialLink & { id: string; date: string; kind: 'call' | 'notice' }
type Change = OfficialLink & { id: number; at: string; detail?: string }
type Feed = {
  schema: 1
  sequence: number
  inapCheckedAt?: string
  boeThrough?: string
  calls: Call[]
  resources: OfficialGroup[]
  boe: Notice[]
  changes: Change[]
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function link(value: unknown): value is OfficialLink {
  if (!record(value) || typeof value.label !== 'string' || typeof value.url !== 'string') return false
  try { return knownOrigins.has(new URL(value.url).origin) }
  catch { return false }
}

function groups(value: unknown): value is OfficialGroup[] {
  return Array.isArray(value) && value.every(group => record(group) && typeof group.title === 'string'
    && Array.isArray(group.links) && group.links.every(link))
}

function parse(value: unknown): Feed {
  if (!record(value) || value.schema !== 1 || !Number.isSafeInteger(value.sequence)
    || typeof value.sequence !== 'number' || value.sequence < 0
    || !Array.isArray(value.calls) || !value.calls.length || !value.calls.every((call: unknown) => {
      if (!record(call)) return false
      return Number.isSafeInteger(call.year) && groups(call.sections) && link(call)
    }) || !groups(value.resources)
    || !Array.isArray(value.boe) || !value.boe.every((notice: unknown) => {
      if (!record(notice)) return false
      return typeof notice.id === 'string' && validDate(notice.date)
        && (notice.kind === 'call' || notice.kind === 'notice') && link(notice)
    }) || !Array.isArray(value.changes) || !value.changes.every((change: unknown) => {
      if (!record(change)) return false
      return Number.isSafeInteger(change.id) && validDate(change.at)
        && (change.detail === undefined || typeof change.detail === 'string') && link(change)
    }) || (value.inapCheckedAt !== undefined && !validDate(value.inapCheckedAt))
    || (value.boeThrough !== undefined && !validDate(value.boeThrough))) {
    throw new Error('El índice oficial tiene un formato inesperado.')
  }
  return value as Feed
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function readSeen() {
  try {
    const value = Number(localStorage.getItem(seenKey))
    return Number.isSafeInteger(value) && value >= 0 ? value : 0
  } catch { return 0 }
}

export function useOfficialInap() {
  const [feed, setFeed] = useState<Feed>()
  const [loading, setLoading] = useState(true)
  const [seen, setSeen] = useState(readSeen)
  useEffect(() => {
    const abort = new AbortController()
    let hasRemote = false
    let lastRequest = 0

    async function load(url: string) {
      const response = await fetch(url, { signal: abort.signal, credentials: 'omit' })
      if (!response.ok) throw new Error('Índice oficial no disponible.')
      return parse(await response.json())
    }

    function refresh() {
      if (Date.now() - lastRequest < 60_000) return
      lastRequest = Date.now()
      void load(feedUrl).then(value => {
        if (abort.signal.aborted) return
        hasRemote = true
        setFeed(current => !current || value.sequence >= current.sequence ? value : current)
      }).catch(() => {})
    }

    const initial = Promise.allSettled([
      load(`${import.meta.env.BASE_URL}official-inap.json`).then(value => {
        if (!abort.signal.aborted && !hasRemote) setFeed(value)
      }),
      load(feedUrl).then(value => {
        if (!abort.signal.aborted) { hasRemote = true; setFeed(value) }
      }),
    ])
    lastRequest = Date.now()
    void initial.then(() => { if (!abort.signal.aborted) setLoading(false) })
    const timer = window.setInterval(refresh, 15 * 60_000)
    window.addEventListener('focus', refresh)
    const syncSeen = (event: StorageEvent) => {
      if (event.key === seenKey) setSeen(readSeen())
    }
    window.addEventListener('storage', syncSeen)
    return () => {
      abort.abort()
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('storage', syncSeen)
    }
  }, [])

  const markSeen = () => {
    if (!feed) return
    setSeen(feed.sequence)
    try { localStorage.setItem(seenKey, String(feed.sequence)) } catch { /* memory only */ }
  }
  return { feed, loading, unread: (feed?.sequence ?? 0) > seen, markSeen }
}

const formatDate = new Intl.DateTimeFormat('es-ES', {
  dateStyle: 'medium', timeZone: 'Europe/Madrid',
})

function Links({ links }: { links: OfficialLink[] }) {
  return <ul className="inap-links">
    {links.map(({ label, url }) => <li key={`${url}:${label}`}>
      <a href={url} target="_blank" rel="noopener noreferrer">
        <span>{label}</span><ExternalLink size={15} aria-hidden="true" />
      </a>
    </li>)}
  </ul>
}

function Group({ title, links }: OfficialGroup) {
  return <details className="inap-group">
    <summary>{title}<span>{links.length}</span></summary>
    <Links links={links} />
  </details>
}

export function OfficialInap({ feed, loading, unread, markSeen }: ReturnType<typeof useOfficialInap>) {
  const latest = feed?.calls.find(call => /libre/i.test(call.label))
  return <>
    <div className="page-heading">
      <p className="context-label"><Building2 size={16} /> Fuentes oficiales</p>
      <h1>INAP y BOE</h1>
      <p>Convocatorias, documentos del proceso y exámenes del Cuerpo de Técnicos Auxiliares de Informática.</p>
    </div>

    <section className="inap-overview" aria-label="Situación de la oposición">
      <article className="inap-card">
        <p className="context-label">OEP 2026</p>
        <h2>1.000 plazas de ingreso libre</h2>
        <p>Plazas autorizadas en la oferta de empleo público. Las bases y los plazos se publican en la convocatoria.</p>
        <a className="text-link" href={offer} target="_blank" rel="noopener noreferrer">Consultar la OEP en el BOE <ExternalLink size={15} aria-hidden="true" /></a>
      </article>
      <article className="inap-card">
        <p className="context-label">Última convocatoria en INAP</p>
        <h2>{latest ? `Convocatoria ${latest.year}` : 'Ingreso libre'}</h2>
        <p>{latest ? 'Ficha oficial con las bases, el ejercicio y las publicaciones del proceso.' : 'Consulta la ficha oficial del cuerpo para ver las convocatorias disponibles.'}</p>
        <a className="text-link" href={latest?.url ?? portal} target="_blank" rel="noopener noreferrer">Abrir ficha oficial <ExternalLink size={15} aria-hidden="true" /></a>
      </article>
    </section>

    <section className="section" aria-labelledby="inap-notices">
      <div className="section-head">
        <div>
          <h2 id="inap-notices"><Bell size={18} aria-hidden="true" /> Avisos</h2>
          <p>Los cambios detectados aparecen aquí al abrir TAI Hub.</p>
        </div>
        {unread && <button type="button" className="button" onClick={markSeen}>Marcar como leídos</button>}
      </div>
      {loading && !feed && <p role="status">Cargando fuentes oficiales…</p>}
      {!loading && !feed && <p role="status">No se pudo cargar el índice de avisos. Puedes consultar las fuentes oficiales más abajo.</p>}
      {feed && <div className="inap-card">
        <p className="inap-status">INAP {feed.inapCheckedAt ? `revisado el ${formatDate.format(Date.parse(feed.inapCheckedAt))}` : 'pendiente de revisión'}.
          {' '}BOE {feed.boeThrough ? `revisado hasta el ${formatDate.format(Date.parse(feed.boeThrough))}` : 'pendiente de revisión'}.</p>
        {feed.changes.length ? <ul className="inap-links">
          {feed.changes.map(change => <li key={change.id}>
            <a href={change.url} target="_blank" rel="noopener noreferrer">
              <span><strong>{change.label}</strong>
                <small>{formatDate.format(Date.parse(change.at))}{change.detail ? ` · ${change.detail}` : ''}</small>
              </span>
              <ExternalLink size={15} aria-hidden="true" />
            </a>
          </li>)}
        </ul> : <p>Sin novedades desde la primera revisión.</p>}
      </div>}
      {!!feed?.boe.length && <Group title="Publicaciones detectadas en el BOE" links={feed.boe} />}
    </section>

    {!!feed?.calls.length && <section className="section" aria-labelledby="inap-calls">
      <div className="section-head"><h2 id="inap-calls">Convocatorias y documentos</h2></div>
      {feed.calls.map(call => <details className="inap-group" key={call.url} open={call === latest}>
        <summary>{call.year} · {call.label}<span>{call.sections.reduce((count, section) => count + section.links.length, 0)}</span></summary>
        <div className="inap-call">
          <a className="text-link" href={call.url} target="_blank" rel="noopener noreferrer">Abrir convocatoria en el INAP <ExternalLink size={15} aria-hidden="true" /></a>
          {call.sections.map(section => <Group key={section.title} {...section} />)}
        </div>
      </details>)}
    </section>}

    <section className="section" aria-labelledby="inap-resources">
      <div className="section-head"><h2 id="inap-resources">Recursos oficiales</h2></div>
      <div className="inap-card"><Links links={shortcuts} /></div>
      {feed?.resources.map(group => <Group key={group.title} {...group} />)}
    </section>
  </>
}
