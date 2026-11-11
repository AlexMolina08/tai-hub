export interface OfflineStatus { revision: string; shell: boolean; sql: boolean; python: boolean; bytes: number; totalBytes: number }
async function service(prepare: boolean) {
  if (!('serviceWorker' in navigator)) throw new Error('Este navegador no permite preparar el acceso sin conexión.')
  const path = import.meta.env.BASE_URL + 'lab-offline-worker.js'
  let registration = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL)
  if (!registration && !prepare) return undefined
  if (!registration) registration = await navigator.serviceWorker.register(path, { scope: import.meta.env.BASE_URL })
  if (!registration.active) registration = await navigator.serviceWorker.ready
  if (!registration.active) throw new Error('El acceso sin conexión todavía no está listo.')
  return registration.active
}
export async function offlineStatus(prepare = false, sql = false, progress?: (bytes: number) => void, python = false): Promise<OfflineStatus> {
  const worker = await service(prepare)
  if (!worker) return { revision: '', shell: false, sql: false, python: false, bytes: 0, totalBytes: 0 }
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel()
    let timer: ReturnType<typeof setTimeout>
    const close = () => { clearTimeout(timer); channel.port1.close() }
    const arm = () => {
      clearTimeout(timer)
      timer = setTimeout(() => { close(); reject(new Error('La descarga no avanza. Revisa la conexión y vuelve a comprobar.')) }, 30_000)
    }
    channel.port1.onmessage = event => {
      if (typeof event.data.progress === 'number') { arm(); progress?.(event.data.progress) }
      else if (event.data.error) { close(); reject(new Error(event.data.error)) }
      else if (event.data.result) { close(); resolve(event.data.result) }
    }
    arm()
    worker.postMessage({ kind: prepare ? 'lab-offline-prepare' : 'lab-offline-status', sql, python }, [channel.port2])
  })
}
