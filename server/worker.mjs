const scope = 'https://www.googleapis.com/auth/drive.file'
const home = '/tai-hub/'
const auth = home + 'session/'
const sessionCookie = '__Host-tai_session'
const stateCookie = '__Host-tai_oauth'
const sessionAge = 90 * 24 * 3600
const timeout = () => AbortSignal.timeout(8000)
const encoder = new TextEncoder()
const decoder = new TextDecoder()
const tokenPattern = /^[a-zA-Z0-9._~+\/-]+=*$/
const random = () => base64(crypto.getRandomValues(new Uint8Array(32)))

function base64(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function bytes(value) {
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0))
}

async function hash(value) {
  return base64(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))))
}

function cookie(name, value, maxAge) {
  return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`
}

function getCookie(request, name) {
  return request.headers.get('Cookie')?.split(';').map(value => value.trim())
    .find(value => value.startsWith(name + '='))?.slice(name.length + 1)
}

function json(status, body, cookies = []) {
  const headers = new Headers({ 'Cache-Control': 'no-store', 'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' })
  for (const value of cookies) headers.append('Set-Cookie', value)
  return new Response(JSON.stringify(body), { status, headers })
}

function redirect(location, ...cookies) {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
  for (const value of cookies) headers.append('Set-Cookie', value)
  return new Response(null, { status: 303, headers })
}

async function key(env) {
  const raw = bytes(env.SESSION_KEY)
  if (raw.length !== 32) throw new Error('Invalid session encryption key')
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

async function seal(value, env, sessionId) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(sessionId) },
    await key(env), encoder.encode(value))
  return base64(iv) + '.' + base64(new Uint8Array(encrypted))
}

async function unseal(value, env, sessionId) {
  const [iv, data] = value.split('.')
  return decoder.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(iv), additionalData: encoder.encode(sessionId) },
    await key(env), bytes(data)))
}

async function exchange(env, params) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', signal: timeout(), redirect: 'error',
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, ...params }),
  })
  const value = await response.json()
  if (response.status === 400 && value.error === 'invalid_grant') return null
  if (!response.ok || !tokenPattern.test(value.access_token ?? '') || value.token_type?.toLowerCase() !== 'bearer'
    || !Number.isSafeInteger(value.expires_in) || value.expires_in < 1
    || (value.scope !== undefined && value.scope.trim() !== scope)) throw new Error('Google OAuth response')
  return value
}

async function start(request, env, url) {
  if (request.headers.get('Origin') !== url.origin) return json(403, { error: 'origin' })
  const state = random()
  const verifier = random()
  const destination = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  destination.search = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: url.origin + auth + 'callback', response_type: 'code', scope, access_type: 'offline',
    prompt: 'consent', login_hint: env.ALLOWED_GOOGLE_ACCOUNT, state, code_challenge_method: 'S256',
    code_challenge: await hash(verifier) }).toString()
  return json(200, { url: destination.href }, [cookie(stateCookie, state + '.' + verifier, 600)])
}

async function callback(request, env, url) {
  const clear = cookie(stateCookie, '', 0)
  const [state, verifier] = (getCookie(request, stateCookie) ?? '').split('.')
  const code = url.searchParams.get('code')
  if (!state || !verifier || !code || state !== url.searchParams.get('state')
    || url.searchParams.has('error') || url.searchParams.getAll('state').length !== 1
    || url.searchParams.getAll('code').length !== 1) return redirect(home + '?drive=cancelled', clear)
  try {
    const value = await exchange(env, { code, code_verifier: verifier, grant_type: 'authorization_code',
      redirect_uri: url.origin + auth + 'callback' })
    if (!value || value.scope?.trim() !== scope || !tokenPattern.test(value.refresh_token ?? '')) {
      return redirect(home + '?drive=reauthorize', clear)
    }
    const about = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(permissionId,emailAddress)', {
      headers: { Authorization: 'Bearer ' + value.access_token }, signal: timeout(), redirect: 'error',
    })
    if (!about.ok) throw new Error('Drive could not verify the account')
    const { user } = await about.json()
    if (!user?.permissionId || !env.ALLOWED_GOOGLE_ACCOUNT
      || user.emailAddress?.toLowerCase() !== env.ALLOWED_GOOGLE_ACCOUNT.toLowerCase()) {
      return redirect(home + '?drive=account', clear)
    }
    const secret = random()
    const id = await hash(secret)
    const previous = getCookie(request, sessionCookie)
    const create = env.SESSIONS.prepare('INSERT INTO sessions (id, drive_account, refresh, expires) VALUES (?, ?, ?, ?)')
      .bind(id, user.permissionId, await seal(value.refresh_token, env, id), Math.floor(Date.now() / 1000) + sessionAge)
    const cleanup = env.SESSIONS.prepare('DELETE FROM sessions WHERE expires <= ? OR id = ?')
      .bind(Math.floor(Date.now() / 1000), previous ? await hash(previous) : '')
    await env.SESSIONS.batch([cleanup, create])
    return redirect(home + '?drive=connected', clear, cookie(sessionCookie, secret, sessionAge))
  } catch {
    return redirect(home + '?drive=unavailable', clear)
  }
}

async function authenticated(request, env, logout) {
  const secret = getCookie(request, sessionCookie)
  const clear = cookie(sessionCookie, '', 0)
  if (!secret || !/^[\w-]{43}$/.test(secret)) return json(logout ? 200 : 401, {}, [clear])
  const id = await hash(secret)
  const remove = () => env.SESSIONS.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run()
  if (logout) {
    await remove()
    return json(200, {}, [clear])
  }
  const session = await env.SESSIONS.prepare('SELECT drive_account, refresh FROM sessions WHERE id = ? AND expires > ?')
    .bind(id, Math.floor(Date.now() / 1000)).first()
  if (!session) return json(401, {}, [clear])
  const value = await exchange(env, { refresh_token: await unseal(session.refresh, env, id), grant_type: 'refresh_token' })
  if (!value) {
    await remove()
    return json(401, {}, [clear])
  }
  if (value.refresh_token && tokenPattern.test(value.refresh_token)) {
    await env.SESSIONS.prepare('UPDATE sessions SET refresh = ? WHERE id = ? AND refresh = ?')
      .bind(await seal(value.refresh_token, env, id), id, session.refresh).run()
  }
  return json(200, { accountId: session.drive_account, token: value.access_token, expiresIn: value.expires_in })
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.origin !== env.APP_ORIGIN) return json(421, { error: 'origin' })
    if (url.pathname === '/') return redirect(home)
    if (!url.pathname.startsWith(auth)) return env.ASSETS.fetch(request)
    const path = url.pathname.slice(auth.length)
    try {
      if (request.method === 'GET' && path === 'callback') return await callback(request, env, url)
      if (request.method !== 'POST' || request.headers.get('Origin') !== url.origin) return json(403, { error: 'origin' })
      if (path === 'start') return await start(request, env, url)
      if (path === 'token' || path === 'logout') return await authenticated(request, env, path === 'logout')
      return json(404, {})
    } catch {
      return json(503, { error: 'unavailable' })
    }
  },
}
