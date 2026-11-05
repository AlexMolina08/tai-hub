import { topicById } from './syllabus'

export type ImportEntry = {
  key: string
  path: string
  title: string
  source: string
  topicId: string | null
  tags: string[]
  mimeType: string
  size: number
  md5?: string
  needsReview?: boolean
  relatedTopicIds?: string[]
}
export function importPath(path: string) {
  return path.replace(/\\/g, '/').normalize('NFC')
}

export function parseManifest(raw: unknown): ImportEntry[] {
  if (!raw || typeof raw !== 'object' || !('version' in raw) || raw.version !== 1 || !('resources' in raw) || !Array.isArray(raw.resources)) {
    throw new Error('El manifiesto debe usar el formato de importación de TAI Hub.')
  }
  const keys = new Set<string>()
  const paths = new Set<string>()
  return raw.resources.map((entry: ImportEntry) => {
    if (!entry || typeof entry.path !== 'string' || typeof entry.key !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(entry.key) || typeof entry.title !== 'string' || !entry.title.trim() ||
      typeof entry.source !== 'string' || !Array.isArray(entry.tags) || entry.tags.some(tag => typeof tag !== 'string') ||
      typeof entry.mimeType !== 'string' || !Number.isSafeInteger(entry.size) || entry.size < 0 ||
      (entry.topicId !== null && !topicById.has(entry.topicId)) ||
      (entry.md5 !== undefined && !/^[a-f0-9]{32}$/i.test(entry.md5)) ||
      (entry.relatedTopicIds !== undefined && (!Array.isArray(entry.relatedTopicIds) || entry.relatedTopicIds.some(id => !topicById.has(id))))) {
      throw new Error('El manifiesto contiene una entrada inválida.')
    }
    const path = importPath(entry.path)
    if (path.split('/').some(segment => !segment || segment === '..' || segment === '.') || keys.has(entry.key) || paths.has(path)) {
      throw new Error('El manifiesto contiene rutas o huellas repetidas o inválidas.')
    }
    keys.add(entry.key)
    paths.add(path)
    return { ...entry, path }
  })
}
