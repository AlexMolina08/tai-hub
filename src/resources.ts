import { AudioLines, File, FileImage, FileText, Film, Link2, NotebookPen, ScrollText } from 'lucide-react'
import { topicById } from './syllabus'
import type { Resource } from './drive'

export const kinds = {
  pdf: { label: 'PDF', icon: FileText },
  video: { label: 'Vídeo', icon: Film },
  image: { label: 'Imagen', icon: FileImage },
  audio: { label: 'Audio', icon: AudioLines },
  text: { label: 'Texto', icon: ScrollText },
  link: { label: 'Enlace', icon: Link2 },
  note: { label: 'Nota', icon: NotebookPen },
  other: { label: 'Archivo', icon: File },
}

export function locationName(id: string | null) {
  const topic = id && topicById.get(id)
  return topic ? `${topic.block.roman}.${topic.number} ${topic.title}` : 'General'
}

export function bytes(value: number) {
  if (!value) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  const order = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1000)))
  return new Intl.NumberFormat('es', { maximumFractionDigits: 1 }).format(value / 1000 ** order) + ' ' + units[order]
}

export function safeLink(value?: string) {
  if (!value) return
  try {
    const url = new URL(value)
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.href
  } catch { /* Invalid address */ }
}

export function driveLink(resource: Resource) {
  if (resource.kind === 'link' || resource.kind === 'note') return undefined
  return `https://drive.google.com/file/d/${encodeURIComponent(resource.id)}/view`
}

export function fold(text: string) {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('es')
}
