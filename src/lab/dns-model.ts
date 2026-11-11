import type { PredictionAnswer, PredictionControl, PredictionExercise } from './prediction'

export const DNS_MODEL_VERSION = 'dns-model-v1'

const types = ['A','AAAA','CNAME','NS','SOA','MX','PTR','TXT','SRV','CAA'] as const
const outcomes = ['RRset solicitado','NODATA','NXDOMAIN'] as const
type DnsType = typeof types[number]
type Outcome = typeof outcomes[number]
type Row = { owner:string; type:DnsType; value:string }
type Lookup = { kind:'lookup'; label:string; zone:string; name:string; query:DnsType; rows:Row[] }
type Delegation = {
  kind:'delegation'; label:string; parent:string; child:string; server:string
  cut:boolean; glue:boolean; knownAddress:boolean; authoritative:boolean
}
type Cache = {
  kind:'cache'; label:string; name:string; query:DnsType; cachedName:string; cachedType:DnsType
  ttl:number; elapsed:number; current:Outcome
} & ({ cached:'RRset solicitado' } | { cached:'NODATA'|'NXDOMAIN'; soaMinimum:number })
type DnsCase = Lookup | Delegation | Cache
export type DnsProfile = { cases:DnsCase[] }

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const short = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= max && v.trim() === v && !/[\u0000-\u001f\u007f]/.test(v)
const inList = <T extends string>(v: unknown, values: readonly T[]): v is T => typeof v === 'string' && values.some(item => item === v)
const seconds = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 604800
const name = (v: unknown): v is string => short(v,160) && /^(?:[a-z0-9_][a-z0-9_-]{0,62}\.)+$/.test(v)
const within = (candidate: string, zone: string) => candidate === zone || candidate.endsWith('.' + zone)
const bool = (v: unknown): v is boolean => typeof v === 'boolean'

function dnsRow(v: unknown, zone: string): v is Row {
  return record(v) && name(v.owner) && within(v.owner,zone) && inList(v.type,types) && short(v.value,120)
    && (v.type !== 'CNAME' || (v.owner !== zone && name(v.value) && within(v.value,zone)))
}

function validCase(v: unknown): v is DnsCase {
  if (!record(v) || !short(v.label,80)) return false
  switch (v.kind) {
    case 'lookup': {
      if (!name(v.zone) || !name(v.name) || !within(v.name,v.zone) || !inList(v.query,types)
        || !Array.isArray(v.rows) || v.rows.length > 18) return false
      const zone = v.zone
      if (!v.rows.every(row => dnsRow(row,zone))) return false
      const rows = v.rows as Row[]
      if (new Set(rows.map(r => JSON.stringify([r.owner,r.type,r.value]))).size !== rows.length) return false
      return rows.every(r => r.type !== 'CNAME' || rows.filter(other => other.owner === r.owner).length === 1)
    }
    case 'delegation':
      return name(v.parent) && name(v.child) && v.child !== v.parent && within(v.child,v.parent) && name(v.server)
        && bool(v.cut) && bool(v.glue) && bool(v.knownAddress) && bool(v.authoritative)
        && (!v.glue || (v.cut && within(v.server,v.child)))
    case 'cache':
      return name(v.name) && name(v.cachedName) && inList(v.query,types) && inList(v.cachedType,types)
        && inList(v.cached,outcomes) && inList(v.current,outcomes) && seconds(v.ttl) && seconds(v.elapsed)
        && (v.cached === 'RRset solicitado' ? v.soaMinimum === undefined : seconds(v.soaMinimum))
    default: return false
  }
}

export function validDnsProfile(v: unknown): v is DnsProfile {
  return record(v) && Array.isArray(v.cases) && v.cases.length > 0 && v.cases.length <= 10 && v.cases.every(validCase)
    && new Set(v.cases.map(c => c.label)).size === v.cases.length
}

export function dnsControls(profile: DnsProfile): PredictionControl[] {
  return [{ label:'Caso', options:profile.cases.map(c => c.label), initial:profile.cases[0].label }]
}

const select = (label: string, expected: string, options: readonly string[]): PredictionAnswer => ({ label, expected, options:[...options] })
const integer = (label: string, expected: number): PredictionAnswer => ({ label, expected:String(expected), format:'integer' })

function lookup(c: Lookup): PredictionExercise {
  let owner = c.name
  let matches: Row[] = []
  let result: Outcome | 'Alias circular' = 'Alias circular'
  const seen = new Set<string>()
  const trace = [`Buscar ${c.query} para ${c.name} dentro de ${c.zone}.`]
  while (!seen.has(owner)) {
    seen.add(owner)
    const at = c.rows.filter(r => r.owner === owner)
    matches = at.filter(r => r.type === c.query)
    if (matches.length) {
      result = 'RRset solicitado'
      break
    }
    const alias = at.find(r => r.type === 'CNAME')
    if (alias) {
      trace.push(`${owner} es alias de ${alias.value}. La búsqueda continúa con el mismo tipo.`)
      owner = alias.value
    } else {
      const exists = owner === c.zone || at.length > 0 || c.rows.some(r => within(r.owner,owner))
      result = exists ? 'NODATA' : 'NXDOMAIN'
      break
    }
  }
  trace.push(matches.length
    ? `En ${owner} se obtienen ${matches.length} registros ${c.query}: ${matches.map(r => r.value).join(' · ')}.`
    : `En ${owner}: ${result}. No hay registros del tipo solicitado.`)
  return {
    facts:[`Zona de clase IN: ${c.zone} Consulta: ${c.name} ${c.query}.`,
      'Perfil completo para los nombres indicados, sin comodines, DNAME ni delegaciones internas.',
      ...c.rows.map(r => `${r.owner} ${r.type} ${r.value}`)],
    answers:[
      select('Resultado del tipo solicitado',result,[...outcomes,'Alias circular']),
      select('Último nombre examinado',owner,[...new Set([c.name,c.zone,...c.rows.map(r => r.owner),
        ...c.rows.filter(r => r.type === 'CNAME').map(r => r.value)])]),
      integer('Número de registros del tipo solicitado',matches.length),
    ],
    steps:['Compara primero nombre y tipo. Un CNAME conduce a otro nombre si el tipo buscado es distinto. Separa ausencia de tipo y ausencia de nombre.'],
    trace,
  }
}

function delegation(c: Delegation): PredictionExercise {
  const address = !c.cut ? 'Sin dirección usada' : c.glue ? 'Glue del padre'
    : c.knownAddress ? 'Dirección obtenida por separado' : 'Sin dirección usada'
  const parent = c.cut ? 'Referencia' : 'NXDOMAIN autoritativo'
  const result = !c.cut ? 'NXDOMAIN' : c.authoritative && address !== 'Sin dirección usada' ? 'RRset solicitado' : 'Fallo de resolución'
  return {
    facts:[
      `Zona padre: ${c.parent} Zona prevista: ${c.child} Servidor previsto: ${c.server}`,
      'Se pregunta por un nombre bajo la zona prevista. Solo se considera este servidor y el camino descrito.',
      c.cut ? 'El padre tiene los NS de la delegación.' : 'No hay corte ni existe ese nombre en la zona padre.',
      c.glue ? 'La referencia contiene la dirección de este NS como glue.' : 'El padre no aporta dirección de este NS como glue.',
      c.knownAddress ? 'La dirección también consta por un dato obtenido independientemente.' : 'No hay otra dirección utilizable para este NS.',
      c.authoritative ? 'El servidor previsto tiene la zona cargada y el RRset existe.' : 'El servidor previsto no tiene autoridad para esa zona.',
    ],
    answers:[
      select('Respuesta inicial del padre',parent,['Referencia','NXDOMAIN autoritativo']),
      select('Origen de la dirección utilizada',address,['Glue del padre','Dirección obtenida por separado','Sin dirección usada']),
      select('Resultado para la consulta',result,['RRset solicitado','NXDOMAIN','Fallo de resolución']),
    ],
    steps:['Identifica el corte, comprueba cómo se obtiene la dirección del NS y verifica que ese endpoint sea autoridad.'],
    trace:[`Primera respuesta: ${parent}.`,`Dirección del NS: ${address.toLowerCase()}.`,`Resultado en este perfil: ${result}.`],
  }
}

function cache(c: Cache): PredictionExercise {
  const initialTtl = c.cached === 'RRset solicitado' ? c.ttl : Math.min(c.ttl,c.soaMinimum)
  const remaining = Math.max(0,initialTtl - c.elapsed)
  const applies = c.cachedName === c.name && (c.cached === 'NXDOMAIN' || c.cachedType === c.query)
  const hit = applies && remaining > 0
  return {
    facts:[
      `Consulta ${c.name} ${c.query}. Entrada previa para ${c.cachedName} ${c.cachedType}: ${c.cached}.`,
      c.cached === 'RRset solicitado' ? `TTL inicial del RRset: ${c.ttl} s.`
        : `TTL del SOA negativo: ${c.ttl} s. SOA.MINIMUM: ${c.soaMinimum} s.`,
      `Han transcurrido ${c.elapsed} s. Si debe acudir a la autoridad, el resultado actual es ${c.current}.`,
      'Una entrada NXDOMAIN se aplica al mismo nombre. El modelo no amplía el resultado a descendientes ni sirve entradas vencidas.',
    ],
    answers:[
      select('Origen del resultado',hit ? 'Caché' : 'Autoridad',['Caché','Autoridad']),
      select('Resultado entregado',hit ? c.cached : c.current,outcomes),
      integer('TTL restante de la entrada servida (0 si no se usa)',hit ? remaining : 0),
    ],
    steps:['Calcula cuánto dura la entrada. Comprueba su vigencia y si su clave incluye el tipo pedido.'],
    trace:[
      `Vigencia inicial: ${initialTtl} s. Tras el intervalo quedan ${remaining} s.`,
      applies ? 'La clave de esa entrada se aplica a la consulta.' : 'La clave de esa entrada no coincide con la consulta.',
      hit ? `La caché entrega ${c.cached} con ${remaining} s restantes.` : `Se consulta la autoridad. Resultado actual: ${c.current}.`,
    ],
  }
}

export function describeDns(profile: DnsProfile, values: string[]): PredictionExercise {
  const item = profile.cases.find(c => c.label === values[0]) ?? profile.cases[0]
  switch (item.kind) {
    case 'lookup': return lookup(item)
    case 'delegation': return delegation(item)
    case 'cache': return cache(item)
  }
}
