import { useEffect, useRef, useState } from 'react'
import { resourceKind, type DriveLibrary, type Resource } from '../drive'
import { bytes } from '../resources'
import { importPath, parseManifest, type ImportEntry } from '../imports'

export function ImportPanel({ library, onChange, connected, reconnect }: {
  library: DriveLibrary; onChange: () => Promise<void>; connected: boolean; reconnect: () => void
}) {
  const [entries, setEntries] = useState<ImportEntry[]>([])
  const [files, setFiles] = useState<Map<string, File>>(new Map())
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const stop = useRef(false)
  useEffect(() => () => { stop.current = true }, [])
  const absent = entries.filter(entry => files.get(entry.path)?.size !== entry.size)
  async function run() {
    if (!connected || !entries.length || absent.length) return
    setBusy(true)
    setError('')
    stop.current = false
    let finished = 0
    let added = 0
    try {
      const [current, account] = await Promise.all([library.list(), library.account()])
      const imported = new Map(current.filter(item => item.importKey).map(item => [item.importKey, item]))
      const pending: { entry: ImportEntry; ordinal: number }[] = []
      function verify(entry: ImportEntry, item: Resource, ordinal: number) {
        if (item.size !== entry.size || (entry.md5 && item.md5Checksum?.toLowerCase() !== entry.md5.toLowerCase())) {
          throw new Error(`La comprobación de integridad falló en el archivo ${ordinal}. Revisa el original y la copia de Drive.`)
        }
      }
      for (const [index, entry] of entries.entries()) {
        const existing = imported.get(entry.key)
        if (existing) {
          verify(entry, existing, index + 1)
          finished++
        } else {
          pending.push({ entry, ordinal: index + 1 })
        }
      }
      const needed = pending.reduce((total, { entry }) => total + entry.size, 0)
      if (account.storage.limit !== undefined && account.storage.limit - account.storage.usage < needed) {
        throw new Error(`Drive necesita ${bytes(needed)} libres para completar esta importación.`)
      }
      let next = 0
      let sent = 0
      let failed = false
      const active = new Map<string, number>()
      const report = () => {
        const transferred = sent + [...active.values()].reduce((total, value) => total + value, 0)
        const percentage = needed ? Math.floor(transferred / needed * 100) : 100
        setProgress(`${finished} de ${entries.length} verificados · ${percentage} % de la carga pendiente`)
      }
      async function worker() {
        while (!stop.current && !failed && next < pending.length) {
          const { entry, ordinal } = pending[next++]
          try {
            const item = await library.create({
              title: entry.title, kind: resourceKind({ type: entry.mimeType, name: entry.path }), source: entry.source,
              topicId: entry.topicId, tags: entry.tags, needsReview: entry.needsReview,
              relatedTopicIds: entry.relatedTopicIds, sourcePath: entry.path,
            }, files.get(entry.path), done => { active.set(entry.key, done); report() }, entry.key)
            verify(entry, item, ordinal)
            if (item.importKey !== entry.key || item.topicId !== entry.topicId || item.source !== entry.source ||
              item.tags.join('\0') !== entry.tags.join('\0') || !!item.needsReview !== !!entry.needsReview ||
              (item.relatedTopicIds ?? []).join('\0') !== (entry.relatedTopicIds ?? []).join('\0')) {
              throw new Error(`Drive guardó una organización distinta en el archivo ${ordinal}. Revisa su ficha antes de continuar.`)
            }
            active.delete(entry.key)
            sent += entry.size
            added++
            finished++
            report()
          } catch (failure) {
            if (!failed) setError(failure instanceof Error ? failure.message : 'La importación se interrumpió. Puedes reintentar.')
            failed = true
          }
        }
      }
      report()
      await Promise.all(Array.from({ length: Math.min(4, pending.length) }, worker))
      setProgress(finished === entries.length
        ? `${finished} recursos verificados. ${added} incorporados en esta sesión.`
        : `Pausa en ${finished} de ${entries.length}. Puedes continuar con los mismos archivos.`)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'La importación se interrumpió. Puedes reintentar.')
    } finally {
      setBusy(false)
      await onChange()
    }
  }
  return <div className="resource-form">
    <p className="form-hint">Selecciona el manifiesto privado y la carpeta preparada en el Mac. Los archivos se envían a tu Drive.</p>
    <fieldset disabled={busy}>
      <label>Manifiesto<input type="file" accept=".json,application/json" onChange={async event => {
        const file = event.currentTarget.files?.[0]
        setError('')
        setEntries([])
        if (!file) return
        try { setEntries(parseManifest(JSON.parse(await file.text()))) }
        catch (failure) { setError(failure instanceof Error ? failure.message : 'El manifiesto no se puede leer.') }
      }} /></label>
      <label>Carpeta de originales<input type="file" {...{ webkitdirectory: '' }} multiple onChange={event => {
        const selected = new Map<string, File>()
        for (const file of Array.from(event.currentTarget.files ?? [])) {
          const path = file.webkitRelativePath.split('/').slice(1).join('/')
          if (path) selected.set(importPath(path), file)
        }
        setFiles(selected)
      }} /></label>
    </fieldset>
    {!!entries.length && <p className="form-hint">{entries.length} recursos · {bytes(entries.reduce((total, item) => total + item.size, 0))}
      {files.size > 0 && absent.length > 0 && ` · ${absent.length} archivos faltan o tienen otro tamaño`}
    </p>}
    {progress && <p role="status" className="form-hint">{progress}</p>}
    {error && <p role="alert" className="form-error">{error}</p>}
    {busy ? <button className="button" onClick={() => { stop.current = true; setProgress('Pausa solicitada al terminar las transferencias activas…') }}>Pausar</button>
      : !connected ? <button className="button primary" onClick={reconnect}>Reconectar Drive</button>
        : <button className="button primary" onClick={run} disabled={!entries.length || absent.length > 0}>Confirmar subida privada</button>}
  </div>
}
