import { useEffect, useState } from 'react'
import { Download, ExternalLink, FileQuestion } from 'lucide-react'
import type { DriveLibrary, Resource } from '../drive'
import { driveLink, safeLink } from '../resources'

const images = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp'])
const audio = new Set(['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/wav', 'audio/x-wav'])
export function ResourceView({ resource, library, download }: {
  resource: Resource
  library: DriveLibrary
  download: () => void
}) {
  const [preview, setPreview] = useState<{ url?: string; text?: string }>()
  const [error, setError] = useState(false)
  const image = resource.kind === 'image' && images.has(resource.mimeType) && resource.size <= 16 * 1024 ** 2
  const sound = resource.kind === 'audio' && audio.has(resource.mimeType) && resource.size <= 16 * 1024 ** 2
  const text = resource.kind === 'text' && resource.size <= 2 * 1024 ** 2
  useEffect(() => {
    if (!image && !sound && !text) return
    let live = true
    let url = ''
    library.readBlob(resource.id, text ? 2 * 1024 ** 2 : 16 * 1024 ** 2).then(async blob => {
      if (text) {
        const value = await blob.text()
        if (live) setPreview({ text: value })
      } else if (live) {
        url = URL.createObjectURL(new Blob([blob], { type: resource.mimeType }))
        setPreview({ url })
      }
    }).catch(() => { if (live) setError(true) })
    return () => { live = false; if (url) URL.revokeObjectURL(url) }
  }, [resource.id, resource.version, resource.mimeType, image, sound, text, library])

  if (resource.kind === 'note') return <div className="note-preview">{resource.note}</div>
  if (resource.kind === 'link') {
    const link = safeLink(resource.url)
    return <div className="fallback-preview">{link
      ? <a className="button primary" href={link} target="_blank" rel="noreferrer"><ExternalLink size={17} /> Abrir enlace</a>
      : <p>El recurso no contiene un enlace válido.</p>}</div>
  }
  const external = driveLink(resource)
  const matroska = resource.kind === 'video' && (resource.mimeType === 'video/x-matroska' || /\.mkv$/i.test(resource.name))
  return <div className="file-preview">
    {(image || sound || text) && !preview && !error && <p role="status" className="form-hint">Cargando vista previa…</p>}
    {image && preview?.url && !error && <img src={preview.url} alt={resource.title} onError={() => setError(true)} />}
    {sound && preview?.url && !error && <audio controls src={preview.url} onError={() => setError(true)} />}
    {text && preview && <pre>{preview.text}</pre>}
    <div className="fallback-preview">
      <FileQuestion size={24} aria-hidden="true" />
      <p>{matroska ? 'La reproducción de este formato depende de Drive. También puedes descargar el original.'
        : resource.kind === 'video'
        ? 'Reproduce el vídeo en tu sesión de Drive. Drive se encarga de la carga progresiva y los controles de reproducción.'
        : error ? 'No se pudo cargar la vista previa. Puedes abrir o descargar el original.'
          : 'El original está disponible en Drive.'}</p>
      <div className="actions">
        {external && <a className="button primary" href={external} target="_blank" rel="noreferrer"><ExternalLink size={16} /> {resource.kind === 'video' && !matroska ? 'Reproducir en Drive' : 'Abrir en Drive'}</a>}
        <button className="button" onClick={download}><Download size={16} /> Descargar original</button>
      </div>
    </div>
  </div>
}
