const scope = 'https://www.googleapis.com/auth/drive.file'
const home = '/tai-hub/'
const auth = home + 'session/'
const sessionCookie = '__Host-tai_session'
const stateCookie = '__Host-tai_oauth'
const sessionAge = 90 * 24 * 3600
const extendWithin = 30 * 24 * 3600
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
  const form = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, ...params })
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', signal: timeout(), redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString(),
  })
  // Workers does not support redirect: 'error'. Never forward OAuth credentials on redirects.
  if (response.status >= 300 && response.status < 400) throw new Error('Google redirected the token exchange')
  const value = await response.json()
  if (response.status === 400 && value.error === 'invalid_grant') return null
  if (!response.ok || !tokenPattern.test(value.access_token ?? '') || typeof value.token_type !== 'string'
    || value.token_type.toLowerCase() !== 'bearer'
    || !Number.isSafeInteger(value.expires_in) || value.expires_in < 1
    || (value.scope !== undefined && (typeof value.scope !== 'string' || value.scope.trim() !== scope))) {
    const reason = !response.ok ? (['invalid_client', 'unauthorized_client', 'invalid_request', 'invalid_scope'].includes(value.error)
      ? value.error : 'http_error') : 'unexpected_token_response'
    console.warn('Drive token exchange rejected', { status: response.status, reason })
    throw new Error('Google OAuth response')
  }
  return value
}

async function start(request, env, url) {
  if (request.headers.get('Origin') !== url.origin) return json(403, { error: 'origin' })
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.ALLOWED_GOOGLE_ACCOUNT || !env.SESSION_KEY) {
    return json(503, { error: 'unavailable' })
  }
  const state = random()
  const verifier = random()
  const destination = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  destination.search = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: url.origin + auth + 'callback', response_type: 'code', scope, access_type: 'offline',
    prompt: 'consent', state, code_challenge_method: 'S256',
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
  let stage = 'exchange'
  try {
    const value = await exchange(env, { code, code_verifier: verifier, grant_type: 'authorization_code',
      redirect_uri: url.origin + auth + 'callback' })
    if (!value || value.scope?.trim() !== scope || !tokenPattern.test(value.refresh_token ?? '')) {
      return redirect(home + '?drive=reauthorize', clear)
    }
    stage = 'account'
    const about = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(permissionId,emailAddress)', {
      headers: { Authorization: 'Bearer ' + value.access_token }, signal: timeout(), redirect: 'manual',
    })
    if (!about.ok) {
      console.warn('Drive account lookup rejected', { status: about.status })
      throw new Error('Drive could not verify the account')
    }
    const { user } = await about.json()
    if (!user?.permissionId || !env.ALLOWED_GOOGLE_ACCOUNT
      || user.emailAddress?.toLowerCase() !== env.ALLOWED_GOOGLE_ACCOUNT.toLowerCase()) {
      return redirect(home + '?drive=account', clear)
    }
    stage = 'store'
    const secret = random()
    const id = await hash(secret)
    const previous = getCookie(request, sessionCookie)
    const create = env.SESSIONS.prepare('INSERT INTO sessions (id, drive_account, refresh, expires) VALUES (?, ?, ?, ?)')
      .bind(id, user.permissionId, await seal(value.refresh_token, env, id), Math.floor(Date.now() / 1000) + sessionAge)
    const cleanup = env.SESSIONS.prepare('DELETE FROM sessions WHERE expires <= ? OR id = ?')
      .bind(Math.floor(Date.now() / 1000), previous ? await hash(previous) : '')
    await env.SESSIONS.batch([cleanup, create])
    return redirect(home + '?drive=connected', clear, cookie(sessionCookie, secret, sessionAge))
  } catch (error) {
    const kind = ['TimeoutError', 'AbortError', 'TypeError'].includes(error?.name) ? error.name : 'Error'
    console.warn('Drive session callback failed', { stage, kind })
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
  const now = Math.floor(Date.now() / 1000)
  const session = await env.SESSIONS.prepare('SELECT drive_account, refresh, expires FROM sessions WHERE id = ? AND expires > ?')
    .bind(id, now).first()
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
  const cookies = []
  if (session.expires - now <= extendWithin) {
    const extended = await env.SESSIONS.prepare('UPDATE sessions SET expires = MAX(expires, ?) WHERE id = ? AND expires > ?')
      .bind(now + sessionAge, id, now).run()
    if (extended.meta.changes === 0) return json(401, {}, [clear])
    cookies.push(cookie(sessionCookie, secret, sessionAge))
  }
  return json(200, { accountId: session.drive_account, token: value.access_token, expiresIn: value.expires_in }, cookies)
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
