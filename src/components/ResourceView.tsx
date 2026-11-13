import { useEffect, useState } from 'react'
import { Download, ExternalLink, FileQuestion } from 'lucide-react'
import type { DriveLibrary, Resource } from '../drive'
import { safeLink } from '../resources'
import { HtmlReader } from './HtmlReader'

const images = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp'])
const audio = new Set(['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/wav', 'audio/x-wav'])
const richText = new Set(['application/rtf', 'application/x-rtf', 'text/rtf', 'text/richtext'])
export function ResourceView({ resource, library, connected, download, sectionId, inDialog }: {
  resource: Resource
  library: DriveLibrary
  connected: boolean
  download: () => void
  sectionId?: string
  inDialog?: boolean
}) {
  const [preview, setPreview] = useState<{ url?: string; text?: string }>()
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const previewMime = resource.mimeType === 'audio/x-m4a' ? 'audio/mp4' : resource.mimeType
  const image = resource.kind === 'image' && images.has(previewMime) && resource.size <= 16 * 1024 ** 2
  const sound = resource.kind === 'audio' && audio.has(previewMime) && resource.size <= 16 * 1024 ** 2
  const text = resource.kind === 'text' && resource.size <= 2 * 1024 ** 2
    && !richText.has(previewMime) && !/\.rtf$/i.test(resource.name)
  useEffect(() => {
    if (!connected || (!image && !sound && !text)) return
    setPreview(undefined)
    setError(false)
    let live = true
    let url = ''
    library.readBlob(resource.id, text ? 2 * 1024 ** 2 : 16 * 1024 ** 2).then(async blob => {
      if (text) {
        const value = await blob.text()
        if (live) setPreview({ text: value })
      } else if (live) {
        url = URL.createObjectURL(new Blob([blob], { type: previewMime }))
        setPreview({ url })
      }
    }).catch(() => { if (live) setError(true) })
    return () => { live = false; if (url) URL.revokeObjectURL(url) }
  }, [resource.id, resource.version, previewMime, image, sound, text, library, connected, attempt])

  if (resource.kind === 'html' || resource.mimeType === 'text/html') return <HtmlReader
    resource={resource} library={library} connected={connected} download={download} sectionId={sectionId} inDialog={inDialog} />
  if (resource.kind === 'note') return <div className="note-preview">{resource.note}</div>
  if (resource.kind === 'link') {
    const link = safeLink(resource.url)
    return <div className="fallback-preview">{link
      ? <a className="button primary" href={link} target="_blank" rel="noreferrer"><ExternalLink size={17} /> Abrir enlace</a>
      : <p>El recurso no contiene un enlace válido.</p>}</div>
  }
  const external = library.viewUrl(resource)
  const browserDownload = library.downloadInBrowser(resource)
  const matroska = resource.kind === 'video' && (resource.mimeType === 'video/x-matroska' || /\.mkv$/i.test(resource.name))
  return <div className="file-preview">
    {connected && (image || sound || text) && !preview && !error && <p role="status" className="form-hint">Cargando vista previa…</p>}
    {connected && image && preview?.url && !error && <img src={preview.url} alt={resource.title} onError={() => setError(true)} />}
    {connected && sound && preview?.url && !error && <audio controls src={preview.url} onError={() => setError(true)} />}
    {connected && text && preview && <pre>{preview.text}</pre>}
    <div className="fallback-preview">
      <FileQuestion size={24} aria-hidden="true" />
      <p>{matroska ? 'La reproducción de este formato depende de Drive. También puedes descargar el original.'
        : resource.kind === 'video'
        ? 'Reproduce el vídeo en tu sesión de Drive. Drive se encarga de la carga progresiva y los controles de reproducción.'
        : error ? 'No se pudo cargar la vista previa. Puedes abrir o descargar el original.'
          : browserDownload && !browserDownload.direct ? 'Abre el original en Drive para descargarlo.' : 'El original está disponible en Drive.'}</p>
      <div className="actions">
        <a className="button primary" href={external} target="_blank" rel="noreferrer"><ExternalLink size={16} /> {resource.kind === 'video' && !matroska ? 'Reproducir en Drive' : 'Abrir en Drive'}</a>
        {browserDownload ? browserDownload.direct && <a className="button" href={browserDownload.href} target="_blank" rel="noreferrer"><Download size={16} /> Descargar original</a>
          : <button className="button" disabled={!connected} onClick={download}><Download size={16} /> Descargar original</button>}
        {connected && error && <button className="button" onClick={() => setAttempt(value => value + 1)}>Reintentar vista previa</button>}
      </div>
    </div>
  </div>
}
