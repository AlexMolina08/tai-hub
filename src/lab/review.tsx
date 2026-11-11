// Entry point served only by scripts/lab-review.mjs. No private package is imported into the public build.
import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { parsePackage } from './validate'
import { mergeEvents } from './history'
import type { LabEvent, LabPackage } from './model'
import { LessonView } from './Laboratory'
import '../style.css'

function Review({ pack }: { pack: LabPackage }) {
  const [index, setIndex] = useState(0)
  const [events, setEvents] = useState<LabEvent[]>([])
  const [material, setMaterial] = useState('')
  return <main className="laboratory" style={{ padding: '1rem' }}>
    <p role="status">Revisión editorial privada. Contenido sin validar. Los intentos de revisión no cuentan como estudio ni se sincronizan.</p>
    <h1>{pack.title}</h1><p>Versión {pack.version}</p>
    <label>Lección en revisión<select value={index} onChange={event => { setIndex(Number(event.target.value)); setMaterial('') }}>
      {pack.lessons.map((lesson, i) => <option key={lesson.id} value={i}>{lesson.title}</option>)}
    </select></label>
    {pack.lessons[index] && <LessonView key={pack.lessons[index].id} pack={pack} lesson={pack.lessons[index]}
      accountId="editorial-review" deviceId="local-preview" events={events}
      record={async incoming => setEvents(current => mergeEvents('editorial-review', current, incoming))}
      openMaterial={(resourceId, sectionId) => setMaterial(`${resourceId} · #${sectionId}`)} />}
    {material && <p style={{ overflowWrap: 'anywhere' }}>Destino del material: {material}</p>}
  </main>
}
const token = location.hash.slice(1)
history.replaceState(null, '', location.pathname)
fetch(import.meta.env.BASE_URL + '__lab-review/package', { headers: { 'X-Lab-Review-Token': token }, cache: 'no-store' })
  .then(response => { if (!response.ok) throw new Error('Acceso local no autorizado. Abre la URL completa de la consola.'); return response.json() })
  .then(input => createRoot(document.getElementById('root')!).render(<Review pack={parsePackage(input, 'authoring')} />))
  .catch(error => { document.getElementById('root')!.textContent = String(error) })
