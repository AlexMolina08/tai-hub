import { useState, type FormEvent } from 'react'
import { Upload } from 'lucide-react'
import type { Resource, ResourceDraft } from '../drive'
import { blocks } from '../syllabus'
import { kindFor, safeLink } from '../resources'

export function TopicOptions() {
  return <><option value="">General</option>{blocks.map(block =>
    <optgroup key={block.id} label={`Bloque ${block.roman} · ${block.title}`}>
      {block.topics.map(topic => <option key={topic.id} value={topic.id}>{block.roman}.{topic.number} {topic.title}</option>)}
    </optgroup>
  )}</>
}

export function ResourceForm({ resource, initialTopic, sources, save }: {
  resource?: Resource
  initialTopic: string | null
  sources: string[]
  save: (draft: ResourceDraft, file?: File, replace?: File, progress?: (done: number, total: number) => void) => Promise<void>
}) {
  const [mode, setMode] = useState<'file' | 'link' | 'note'>(resource?.kind === 'link' || resource?.kind === 'note' ? resource.kind : 'file')
  const [title, setTitle] = useState(resource?.title ?? '')
  const [source, setSource] = useState(resource?.source ?? '')
  const [topic, setTopic] = useState(resource?.topicId ?? initialTopic ?? '')
  const [tags, setTags] = useState(resource?.tags.join(', ') ?? '')
  const [review, setReview] = useState(resource?.needsReview ?? false)
  const [url, setUrl] = useState(resource?.url ?? '')
  const [note, setNote] = useState(resource?.note ?? '')
  const [file, setFile] = useState<File>()
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<number>()
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    const link = mode === 'link' ? safeLink(url) : undefined
    if (!title.trim()) return setError('Escribe un título.')
    if (mode === 'link' && !link) return setError('Introduce una dirección http o https válida.')
    if (mode === 'file' && !resource && !file) return setError('Selecciona un archivo.')
    if (resource && file && kindFor(file.type, file.name) !== resource.kind) return setError('Selecciona un archivo del mismo tipo.')
    setBusy(true)
    try {
      const draft: ResourceDraft = {
        title: title.trim(),
        kind: resource?.kind ?? (mode === 'file' ? kindFor(file!.type, file!.name) : mode),
        source: source.trim() || 'Personal',
        topicId: topic || null,
        tags: [...new Set(tags.split(',').map(tag => tag.trim()).filter(Boolean))],
        url: link,
        note: mode === 'note' ? note : undefined,
        sourcePath: resource?.sourcePath,
        relatedTopicIds: resource?.relatedTopicIds?.filter(id => id !== topic),
        needsReview: review,
      }
      await save(draft, resource ? undefined : file, resource ? file : undefined, (done, total) => setProgress(total ? done / total : 0))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo guardar el recurso.')
    } finally {
      setBusy(false)
    }
  }
  return <form className="resource-form" onSubmit={submit}>
    <fieldset disabled={busy}>
      {!resource && <div className="segmented" aria-label="Clase de recurso">
        {(['file', 'link', 'note'] as const).map((value, index) => <button type="button" key={value} aria-pressed={mode === value} onClick={() => { setMode(value); setFile(undefined) }}>{['Archivo', 'Enlace', 'Nota'][index]}</button>)}
      </div>}
      {mode === 'file' && (!resource || resource.kind === 'pdf') && <label className="file-zone"><Upload size={19} /><span>{resource ? 'Elegir nueva versión' : 'Seleccionar archivo'}</span>
        <input type="file" accept={resource ? '.pdf,application/pdf' : undefined} onChange={event => {
          const selected = event.target.files?.[0]
          setFile(selected)
          if (selected && !title) setTitle(selected.name.replace(/\.[^.]+$/, ''))
        }} /></label>}
      {resource && file && <p className="form-hint">Al guardar, la nueva versión será la vigente. La anterior se conserva en Drive.</p>}
      <label>Título<input required maxLength={280} value={title} onChange={event => setTitle(event.target.value)} /></label>
      {mode === 'link' && <label>Dirección<input required type="url" placeholder="https://" value={url} onChange={event => setUrl(event.target.value)} /></label>}
      {mode === 'note' && <label>Nota<textarea required rows={6} maxLength={12000} value={note} onChange={event => setNote(event.target.value)} /></label>}
      <label>Ubicación<select value={topic} onChange={event => setTopic(event.target.value)}><TopicOptions /></select></label>
      <div className="form-columns">
        <label>Fuente<input maxLength={120} list="resource-sources" value={source} onChange={event => setSource(event.target.value)} placeholder="Personal" /></label>
        <label>Etiquetas<input maxLength={400} value={tags} onChange={event => setTags(event.target.value)} placeholder="Separadas por comas" /></label>
      </div>
      <datalist id="resource-sources">{sources.map(item => <option key={item} value={item} />)}</datalist>
      {resource?.needsReview && <label className="checkbox"><input type="checkbox" checked={review} onChange={event => setReview(event.target.checked)} /> Requiere revisión</label>}
    </fieldset>
    {error && <p role="alert" className="form-error">{error}</p>}
    {busy && progress !== undefined && <progress value={progress} max={1} />}
    <button className="button primary" disabled={busy}>{busy ? 'Guardando en Drive…' : resource ? 'Guardar cambios' : 'Añadir recurso'}</button>
  </form>
}
