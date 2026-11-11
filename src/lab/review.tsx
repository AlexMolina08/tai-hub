// Entry point served only by scripts/lab-review.mjs. No private package is imported into the public build.
import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { parsePackage } from './validate'
import { mergeEvents } from './history'
import type { LabEvent, LabPackage } from './model'
import { ActivityView, LessonView } from './Laboratory'
import { GuidedSessionView } from './GuidedSessionView'
import { ExamView } from './ExamView'
import '../style.css'

function Review({ pack }: { pack: LabPackage }) {
  const [index, setIndex] = useState(0)
  const [guided, setGuided] = useState<number | null>(null)
  const [examId, setExamId] = useState('')
  const [events, setEvents] = useState<LabEvent[]>([])
  const [material, setMaterial] = useState('')
  const trainingExams = pack.exams?.filter(form => form.partition === 'training') ?? []
  const exam = trainingExams.find(form => form.id === examId)
  return <main className="laboratory" style={{ padding: '1rem' }}>
    <p role="status">Revisión editorial privada. Contenido sin validar. Los intentos de revisión no cuentan como estudio ni se sincronizan.</p>
    <h1>{pack.title}</h1><p>Versión {pack.version}</p>
    <div className="lab-review-controls"><label>Lección en revisión<select aria-label="Lección en revisión" value={index} onChange={event => { setIndex(Number(event.target.value)); setGuided(null); setExamId(''); setMaterial('') }}>
      {pack.lessons.map((lesson, i) => <option key={lesson.id} value={i}>{lesson.title}</option>)}
    </select></label>
    {!!pack.sessions?.length && <label>Sesión en revisión<select aria-label="Sesión en revisión" value={guided ?? ''} onChange={event => { setGuided(event.target.value === '' ? null : Number(event.target.value)); setExamId(''); setMaterial('') }}>
      <option value="">Explorar una lección</option>{pack.sessions.map((session, i) => <option key={session.id} value={i}>{session.title}</option>)}
    </select></label>}
    {trainingExams.length > 0 && <label>Examen en revisión<select value={examId} onChange={event => {
      setExamId(event.target.value); setGuided(null); setMaterial('')
    }}>
      <option value="">Explorar una lección</option>
      {trainingExams.map(form => <option key={form.id} value={form.id}>{form.title}</option>)}
    </select></label>}</div>
    {exam ? <ExamView key={exam.id} pack={pack} form={exam} accountId="editorial-review" deviceId="local-preview" events={events}
      record={async incoming => setEvents(current => mergeEvents('editorial-review', current, incoming))} />
    : guided !== null && pack.sessions?.[guided] ? <GuidedSessionView key={pack.sessions[guided].id} pack={pack} session={pack.sessions[guided]}
      accountId="editorial-review" deviceId="local-preview" events={events}
      record={async incoming => setEvents(current => mergeEvents('editorial-review', current, incoming))}
      openMaterial={(resourceId, sectionId) => setMaterial(`${resourceId} · #${sectionId}`)}
      renderActivity={(activity, referenceVisible) => <ActivityView key={activity.id} activity={activity} pack={pack} accountId="editorial-review" deviceId="local-preview"
        events={events} referenceVisible={referenceVisible} record={async incoming => setEvents(current => mergeEvents('editorial-review', current, incoming))} />} />
    : pack.lessons[index] && <LessonView key={pack.lessons[index].id} pack={pack} lesson={pack.lessons[index]}
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
