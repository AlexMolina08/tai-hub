import { useEffect, useState } from 'react'
import { offlineStatus, type OfflineStatus } from './offline'

const size = (bytes: number) => (bytes / 1024 ** 2).toFixed(1) + ' MB'
export function OfflineControls({ needsSql, needsPython = false }: { needsSql: boolean; needsPython?: boolean }) {
  const [state, setState] = useState<OfflineStatus>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [downloaded, setDownloaded] = useState(0)
  async function check(prepare = false) {
    setBusy(true); setError(''); setDownloaded(0)
    try { setState(await offlineStatus(prepare, needsSql, setDownloaded, needsPython)) }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo comprobar el almacenamiento.') }
    finally { setBusy(false) }
  }
  useEffect(() => { void check() }, [needsSql, needsPython])
  const ready = state?.shell && (!needsSql || state.sql) && (!needsPython || state.python)
  return <details className="lab-offline"><summary>Acceso sin conexión: {ready ? 'preparado' : 'por preparar'}</summary>
    <p>{ready ? `Aplicación guardada (${size(state.bytes)}).` : 'Guarda la aplicación y los motores necesarios para abrir las lecciones descargadas sin conexión.'}
      {' '}El navegador puede liberar almacenamiento. Comprueba la disponibilidad antes de desconectarte.</p>
    <div className="lab-actions"><button className="button" disabled={busy} onClick={() => void check(true)}>Preparar acceso sin conexión</button>
      <button className="button" disabled={busy} onClick={() => void check()}>Comprobar descarga</button></div>
    {busy && <p role="status">{downloaded ? `Descargados ${size(downloaded)}…` : 'Comprobando archivos…'}</p>}
    {error && <p role="alert">{error}</p>}
    <p>Lecciones y respuestas permanecen en el almacenamiento privado de esta cuenta. Google Drive y los vídeos requieren conexión.</p>
    <a href={import.meta.env.BASE_URL + 'licenses/runtime-notices.txt'} target="_blank" rel="noreferrer">Licencias de los motores</a>
  </details>
}
