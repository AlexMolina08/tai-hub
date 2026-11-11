import type { PredictionAnswer, PredictionControl, PredictionExercise } from './prediction'

export const ACCESS_MODEL_VERSION = 'access-model-v1'

export type AccessProfile =
  | { kind: 'line'; medium: 'copper' | 'fiber' }
  | { kind: 'ethernet' }

export function validAccessProfile(value: unknown): value is AccessProfile {
  if (!value || typeof value !== 'object' || !('kind' in value)) return false
  return value.kind === 'ethernet' || (value.kind === 'line' && 'medium' in value
    && (value.medium === 'copper' || value.medium === 'fiber'))
}

const modem = 'Módem xDSL'
const ont = 'ONT'
const dslam = 'Puerto xDSL del DSLAM'
const olt = 'Puerto PON de la OLT'
const bridge = 'Puente'
const router = 'Router'
const hub = 'Hub'
const switchDevice = 'Switch'

const select = (label: string, options: string[], initial = options[0]): PredictionControl => ({ label, options, initial })
const cut = (label: string): PredictionControl => ({ label, options: ['0', '1'], initial: '0', toggle: true })
const prediction = (label: string, condition: boolean): PredictionAnswer =>
  ({ label, expected: condition ? 'Sí' : 'No', options: ['Sí', 'No'] })

export function accessControls(profile: AccessProfile): PredictionControl[] {
  if (profile.kind === 'line') {
    const fiber = profile.medium === 'fiber'
    return [
      select('Terminación del abonado', [modem, ont], fiber ? ont : modem),
      select('Terminación del proveedor', [dslam, olt], fiber ? olt : dslam),
      select('Función del equipo del abonado', [bridge, router], router),
      cut('Cortar el medio de acceso'),
    ]
  }
  return [
    select('Equipo entre A y B', [hub, switchDevice], switchDevice),
    select('Función del equipo hacia C', [bridge, router], router),
    cut('Desconectar el enlace de A'),
    cut('Desconectar el enlace de C'),
  ]
}

export function describeAccess(profile: AccessProfile, values: string[]): PredictionExercise {
  if (profile.kind === 'line') {
    const [local, remote, mode, cutLine] = values
    const fiber = profile.medium === 'fiber'
    const medium = fiber ? 'fibra de una red FTTH PON' : 'par de cobre de una línea xDSL'
    const matching = fiber ? local === ont && remote === olt : local === modem && remote === dslam
    const up = matching && cutLine === '0'
    const bridged = mode === bridge
    return {
      facts: [
        `Camino: terminal, LAN, ${mode}, ${local}, ${medium}, ${remote}.`,
        'La LAN está conectada. Se supone un perfil compatible y aprovisionado si se escoge el par de terminaciones del medio.',
        'En modo puente, el caso representa un servicio Ethernet transparente de una VLAN, sin filtrado. En modo router se pregunta por la difusión de capa 2 original.',
      ],
      answers: [
        prediction('¿Se establece el enlace de acceso?', up),
        prediction('¿Alcanza la difusión Ethernet el extremo del proveedor?', up && bridged),
      ],
      steps: [
        cutLine === '1' ? 'El medio está interrumpido y la señal no alcanza el extremo remoto.'
          : matching ? `Las terminaciones de ${local} y ${remote} corresponden al medio y completan el enlace del perfil.`
            : `El perfil de ${medium} requiere ${fiber ? 'ONT y OLT' : 'módem xDSL y puerto xDSL del DSLAM'}.`,
        !up ? 'La difusión no puede alcanzar el extremo remoto por un enlace que no está operativo.'
          : bridged ? 'El puente conserva el dominio de difusión del servicio declarado y la trama llega al extremo remoto.'
            : 'El router delimita la difusión de capa 2. Un enlace operativo no convierte la LAN y el acceso en una sola LAN.',
      ],
    }
  }
  const [device, mode, cutA, cutC] = values
  const aConnected = cutA === '0'
  const cConnected = cutC === '0'
  const repeats = device === hub
  const bridged = mode === bridge
  const reachesC = aConnected && cConnected && bridged
  return {
    facts: [
      `A y B enlazan con el ${device.toLowerCase()}. Este enlaza con un ${mode.toLowerCase()}, que tiene otra interfaz hacia C.`,
      'Con hub, el segmento de A, B y la interfaz próxima del equipo hacia C funciona en semidúplex. Con switch, los enlaces funcionan en dúplex completo.',
      'Las interfaces de puente pertenecen a la misma VLAN. Se envía una trama de difusión desde A y los enlaces sin corte están operativos.',
    ],
    answers: [
      prediction('¿Recibe B la difusión de A?', aConnected),
      prediction('¿Recibe C la difusión de A?', reachesC),
      prediction('¿Comparten A y B un dominio de colisión activo?', aConnected && repeats),
    ],
    steps: [
      aConnected ? `El ${device.toLowerCase()} hace llegar la difusión a B en la LAN compartida.`
        : 'El corte de A impide que su trama entre en la red.',
      reachesC ? 'El puente reenvía la trama hacia C en la misma VLAN.'
        : !aConnected || !cConnected ? 'El corte impide el recorrido de extremo a extremo hacia C.'
          : 'El router separa los dominios de difusión de sus interfaces.',
      !aConnected ? 'A está desconectado y no comparte un dominio de colisión activo con B.'
        : repeats ? 'Los puertos del hub comparten un segmento de repetición en semidúplex.'
          : 'Los enlaces conmutados funcionan en dúplex completo. A y B no comparten un segmento de colisión.',
    ],
  }
}
