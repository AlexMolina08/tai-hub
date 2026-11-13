import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFile } from 'node:fs/promises'
import worker from './worker.mjs'

const origin = 'https://tai-hub.example.test'
const prefix = origin + '/tai-hub/session/'
const scope = 'https://www.googleapis.com/auth/drive.file'
const account = 'study@example.test'
const firstRefresh = 'synthetic-first-refresh'
const secondRefresh = 'synthetic-second-refresh'

function d1() {
  const database = new DatabaseSync(':memory:')
  return {
    database,
    prepare(sql) {
      const statement = database.prepare(sql)
      return { bind: (...args) => ({ run: () => ({ meta: statement.run(...args) }), first: () => statement.get(...args) }) }
    },
    async batch(statements) {
      database.exec('BEGIN')
      try {
        for (const statement of statements) statement.run()
        database.exec('COMMIT')
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
    },
  }
}

test('authorization, refresh after expiry, account restriction and session revocation', async () => {
  const sessions = d1()
  sessions.database.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'))
  const env = { APP_ORIGIN: origin, GOOGLE_CLIENT_ID: 'synthetic.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'synthetic-client-secret', SESSION_KEY: Buffer.alloc(32, 7).toString('base64url'),
    ALLOWED_GOOGLE_ACCOUNT: account, SESSIONS: sessions }
  const originalFetch = globalThis.fetch
  let tokenCount = 0
  let forceRevoke = false
  let outage = false
  let email = account
  let challenge
  globalThis.fetch = async (url, init) => {
    if (url.startsWith('https://www.googleapis.com/drive/v3/about?')) {
      return Response.json({ user: { permissionId: 'synthetic-drive-id', emailAddress: email } })
    }
    assert.equal(url, 'https://oauth2.googleapis.com/token')
    const body = init.body
    assert.equal(body.get('client_secret'), env.GOOGLE_CLIENT_SECRET)
    if (body.get('grant_type') === 'authorization_code') {
      const actual = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body.get('code_verifier')))).toString('base64url')
      assert.equal(actual, challenge)
      assert.equal(body.get('redirect_uri'), prefix + 'callback')
      return Response.json({ scope, token_type: 'Bearer', access_token: 'first-access', expires_in: 3600, refresh_token: firstRefresh })
    }
    assert.equal(body.get('grant_type'), 'refresh_token')
    if (outage) return Response.json({ error: 'temporary' }, { status: 503 })
    if (forceRevoke) return Response.json({ error: 'invalid_grant' }, { status: 400 })
    assert.equal(body.get('refresh_token'), tokenCount === 0 ? firstRefresh : secondRefresh)
    tokenCount++
    return Response.json({ token_type: 'Bearer', access_token: 'access-' + tokenCount, expires_in: 3600,
      ...(tokenCount === 1 ? { refresh_token: secondRefresh } : {}) })
  }
  try {
    const post = (path, cookie = '', from = origin) => worker.fetch(new Request(prefix + path, {
      method: 'POST', headers: { Origin: from, Cookie: cookie },
    }), env)
    async function begin() {
      const response = await post('start')
      assert.equal(response.status, 200)
      const destination = new URL((await response.json()).url)
      assert.equal(destination.searchParams.get('access_type'), 'offline')
      assert.equal(destination.searchParams.get('scope'), scope)
      assert.ok(!destination.href.includes(encodeURIComponent(account)))
      challenge = destination.searchParams.get('code_challenge')
      return { state: destination.searchParams.get('state'), cookie: response.headers.getSetCookie()[0].split(';')[0] }
    }
    async function finish(initial, state = initial.state) {
      return worker.fetch(new Request(prefix + 'callback?code=synthetic-code&state=' + state, {
        headers: { Cookie: initial.cookie },
      }), env)
    }
    assert.equal((await post('token')).status, 401)
    const unconfigured = await worker.fetch(new Request(prefix + 'start', { method: 'POST', headers: { Origin: origin } }),
      { ...env, GOOGLE_CLIENT_SECRET: undefined })
    assert.equal(unconfigured.status, 503)
    assert.equal((await post('start', '', 'https://other.example.test')).status, 403)
    const start = await begin()
    assert.equal((await finish(start, 'different-state')).headers.get('Location'), '/tai-hub/?drive=cancelled')
    assert.equal(tokenCount, 0)
    email = 'other@example.test'
    assert.equal((await finish(start)).headers.get('Location'), '/tai-hub/?drive=account')
    assert.equal(sessions.database.prepare('SELECT count(*) AS n FROM sessions').get().n, 0)
    email = account
    const authorized = await finish(start)
    const session = authorized.headers.getSetCookie().find(value => value.startsWith('__Host-tai_session='))
    assert.match(session, /Secure; HttpOnly; SameSite=Lax/)
    const cookie = session.split(';')[0]
    const row = sessions.database.prepare('SELECT id, refresh FROM sessions').get()
    assert.equal(row.id.length, 43)
    assert.ok(!session.includes(firstRefresh) && !row.refresh.includes(firstRefresh))
    const issued = await post('token', cookie)
    assert.equal(issued.headers.get('Cache-Control'), 'no-store')
    assert.deepEqual(await issued.json(), { accountId: 'synthetic-drive-id', token: 'access-1', expiresIn: 3600 })
    outage = true
    assert.equal((await post('token', cookie)).status, 503)
    outage = false
    const now = Math.floor(Date.now() / 1000)
    sessions.database.prepare('UPDATE sessions SET expires = ?').run(now + 60)
    const renewed = await post('token', cookie)
    assert.equal((await renewed.json()).token, 'access-2')
    assert.match(renewed.headers.get('Set-Cookie'), /Max-Age=7776000/)
    assert.ok(sessions.database.prepare('SELECT expires FROM sessions').get().expires >= now + 7776000)
    assert.equal((await post('logout', cookie, 'https://other.example.test')).status, 403)
    forceRevoke = true
    assert.equal((await post('token', cookie)).status, 401)
    assert.equal(sessions.database.prepare('SELECT count(*) AS n FROM sessions').get().n, 0)
    assert.equal((await post('logout', cookie)).status, 200)
  } finally {
    sessions.database.close()
    globalThis.fetch = originalFetch
  }
})
