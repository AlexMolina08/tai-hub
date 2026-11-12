import type { LabPackageUpload } from '../drive/library'
import { sha256 } from '../drive/checksum'
import type { LabPackage } from './model'
import { parsePackage } from './validate'

export async function readPackageFiles(files: File[]): Promise<{ content: LabPackage[]; uploads: LabPackageUpload[] }> {
  const content: LabPackage[] = []
  const uploads = new Map<string, LabPackageUpload>()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const encoder = new TextEncoder()
  for (const file of files) {
    if (file.size > 32 * 1024 ** 2) throw new Error('El paquete supera 32 MB.')
    const bytes = await file.arrayBuffer()
    const pack = parsePackage(JSON.parse(decoder.decode(bytes)))
    const key = JSON.stringify([pack.id, pack.version])
    const checksum = await sha256(bytes)
    const previous = uploads.get(key)
    if (previous && previous.sha256 !== checksum) throw new Error('Los archivos seleccionados contienen dos copias distintas de una misma edición.')
    if (previous) continue
    uploads.set(key, { file, editionKey: await sha256(encoder.encode(key)), sha256: checksum })
    content.push(pack)
  }
  return { content, uploads: [...uploads.values()] }
}
