export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

type AuthStatus = 'loading' | 'ready' | 'connecting' | 'connected' | 'expired' | 'error';
export type AuthSnapshot = Readonly<{ status: AuthStatus; error?: string }>;

type TokenResponse = {
  access_token?: string;
  expires_in?: number | string;
  scope?: string;
  error?: string;
};

type TokenClient = {
  requestAccessToken(config: { prompt: string; include_granted_scopes: false; login_hint?: string }): void;
};

type GoogleOAuth = {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    include_granted_scopes: boolean;
    callback: (response: TokenResponse) => void;
    error_callback: (error: { type: string }) => void;
  }): TokenClient;
};

type Access = { token: string; signal: AbortSignal };
type SessionOptions = { redirectUri?: string; useRedirect?: boolean };
type RedirectRequest = {
  state: string; expiresAt: number; redirectUri: string; clientId: string;
  generation?: string; returnTo?: string;
};
type BrowserAccount = { clientId: string; id: string; generation: string; hint?: string };
type GoogleWindow = Window & { google?: { accounts?: { oauth2?: GoogleOAuth } } };
const oauth = () => (window as GoogleWindow).google?.accounts?.oauth2;
const GOOGLE_SCRIPT = 'https://accounts.google.com/gsi/client';
const GOOGLE_AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const REDIRECT_STATE = 'tai-hub.google-oauth.v1';
const BROWSER_ACCOUNT = 'tai-hub.google-account.v1';
const QUIET_RETRY = 'tai-hub.google-resume.v1';
const REDIRECT_TIMEOUT = 5 * 60 * 1000;
const REDIRECT_START_TIMEOUT = 8_000;
const TOKEN_PATTERN = /^[a-zA-Z0-9._~+\/-]+=*$/;
const OAUTH_FIELDS = ['state', 'access_token', 'token_type', 'scope', 'expires_in', 'error'];
const MISSING_CLIENT = 'Falta configurar el cliente OAuth de TAI Hub.';
const CANCELLED = 'Se ha cancelado la conexión con Google.';
const DENIED = 'No se ha autorizado el acceso a Drive.';
const FAILED = 'Google no pudo completar la autorización.';
const INVALID_REDIRECT = 'La autorización de Google ha caducado o no coincide. Vuelve a conectar.';
const RECONNECT = 'Vuelve a conectar Google Drive para continuar.';

let loadingGoogle: Promise<GoogleOAuth> | undefined;

function readBrowserAccount(clientId: string): BrowserAccount | undefined {
  try {
    const value = JSON.parse(window.localStorage.getItem(BROWSER_ACCOUNT) ?? 'null') as BrowserAccount | null;
    if (value?.clientId === clientId && typeof value.id === 'string' && value.id
      && typeof value.generation === 'string' && (value.hint === undefined || typeof value.hint === 'string')) return value;
  } catch {
    // Private browsing and blocked storage can still use an in-memory session.
  }
}

function loadGoogle(): Promise<GoogleOAuth> {
  const loaded = oauth();
  if (loaded) return Promise.resolve(loaded);
  if (loadingGoogle) return loadingGoogle;

  loadingGoogle = new Promise<GoogleOAuth>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GOOGLE_SCRIPT;
    script.async = true;
    const fail = () => {
      clearTimeout(timeout);
      script.remove();
      reject(new Error('No se pudo cargar el acceso de Google. Revisa la conexión y vuelve a intentarlo.'));
    };
    const timeout = window.setTimeout(fail, 15_000);
    script.onload = () => {
      const api = oauth();
      if (!api) return fail();
      clearTimeout(timeout);
      resolve(api);
    };
    script.onerror = fail;
    document.head.append(script);
  }).catch((error: unknown) => {
    loadingGoogle = undefined;
    throw error;
  });
  return loadingGoogle;
}

export class SessionExpiredError extends Error {
  constructor() {
    super(RECONNECT);
    this.name = 'SessionExpiredError';
  }
}

export class GoogleSession {
  #clientId: string;
  #redirectUri?: string;
  #useRedirect: boolean;
  #google?: GoogleOAuth;
  #snapshot: AuthSnapshot = { status: 'loading' };
  #listeners = new Set<() => void>();
  #credential?: { token: string; expiresAt: number; controller: AbortController };
  #expiryTimer?: number;
  #cancelConnect?: () => void;
  #cancelRedirect?: () => void;
  #hint?: string;
  #browserAccount?: BrowserAccount;
  #expectedAccount?: string;
  #redirectReturned = false;
  #returnTo?: string;

  constructor(clientId: string, { redirectUri, useRedirect = false }: SessionOptions = {}) {
    this.#clientId = clientId.trim();
    this.#redirectUri = redirectUri;
    this.#useRedirect = useRedirect;
    if (typeof window !== 'undefined') {
      this.#consumeRedirect();
      this.#browserAccount = readBrowserAccount(this.#clientId);
      this.#hint = this.#browserAccount?.hint;
      window.addEventListener?.('storage', this.#onAccountChange);
    }
  }

  snapshot = (): AuthSnapshot => this.#snapshot;

  /** Identity only, never a credential. Disconnect and cross-tab changes revoke local access. */
  localAccountId(): string | undefined {
    const saved = readBrowserAccount(this.#clientId);
    return saved?.generation === this.#browserAccount?.generation ? saved?.id : undefined;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  async prepare(): Promise<void> {
    if (this.#google) return;
    if (!this.#validClient()) {
      this.#publish('error', MISSING_CLIENT);
      return;
    }
    if (this.#useRedirect) {
      if (this.#snapshot.status === 'loading') this.#publish('ready');
      return;
    }
    try {
      this.#google = await loadGoogle();
      if (this.#snapshot.status === 'loading') this.#publish('ready');
    } catch (error) {
      if (this.#snapshot.status === 'loading') this.#publish('error', (error as Error).message);
    }
  }

  resume(): boolean {
    if (!this.#validClient() || !this.#browserAccount || this.#credential || this.#redirectReturned
      || this.#cancelConnect || this.#cancelRedirect || !navigator.onLine || !this.#callbackUrl()) return false;
    try {
      if (Number(window.sessionStorage.getItem(QUIET_RETRY)) > Date.now()) return false;
      // An interrupted round trip must never cause a reload loop.
      window.sessionStorage.setItem(QUIET_RETRY, String(Date.now() + REDIRECT_TIMEOUT));
    } catch {
      return false;
    }
    void this.#startRedirect({ quiet: true }).catch(() => {});
    return true;
  }

  takeReturnLocation(): string | undefined {
    const value = this.#returnTo;
    this.#returnTo = undefined;
    return value;
  }

  connect({ sameTab = this.#useRedirect || !this.#google, returnTo }: { sameTab?: boolean; returnTo?: string } = {}): Promise<void> {
    if (!this.#validClient()) return Promise.reject(new Error(MISSING_CLIENT));
    if (this.#cancelConnect || this.#cancelRedirect) return Promise.reject(new Error('Ya hay una autorización de Google en curso.'));
    if (!sameTab && !this.#google) return Promise.reject(new Error('El acceso de Google aún no está disponible.'));
    this.#expectedAccount = undefined;
    if (sameTab) return this.#startRedirect({ returnTo });

    return new Promise<void>((resolve, reject) => {
      let finished = false;
      const cleanup = () => {
        finished = true;
        this.#cancelConnect = undefined;
        clearTimeout(timeout);
      };
      const fail = (message: string) => {
        if (finished) return;
        cleanup();
        this.#publish(this.#credential ? 'connected' : 'error', message);
        reject(new Error(message));
      };
      const timeout = window.setTimeout(() => fail('La conexión con Google tardó demasiado. Inténtalo de nuevo.'), 120_000);
      this.#cancelConnect = () => {
        cleanup();
        reject(new DOMException('La conexión se ha cancelado.', 'AbortError'));
      };
      this.#publish('connecting');

      try {
        const client = this.#google!.initTokenClient({
          client_id: this.#clientId,
          scope: DRIVE_SCOPE,
          include_granted_scopes: false,
          callback: (response) => {
            if (finished) return;
            const expiresIn = Number(response.expires_in);
            if (response.error || !response.access_token || !TOKEN_PATTERN.test(response.access_token)
              || !Number.isSafeInteger(expiresIn) || expiresIn <= 0) {
              fail(response.error === 'access_denied' ? DENIED : FAILED);
              return;
            }
            if (response.scope?.trim() !== DRIVE_SCOPE) {
              fail('Autoriza el acceso a los archivos de TAI Hub en la ventana de Google.');
              return;
            }
            cleanup();
            this.#acceptToken(response.access_token, expiresIn);
            resolve();
          },
          error_callback: (error) => {
            const messages: Record<string, string> = {
              popup_failed_to_open: 'Permite las ventanas emergentes para este sitio y pulsa Conectar de nuevo.',
              popup_closed: 'La ventana de Google se ha cerrado. Puedes volver a conectar.',
            };
            fail(messages[error.type] ?? 'No se pudo abrir la autorización de Google.');
          },
        });
        // Keep this call in the original click stack for Safari's popup policy.
        client.requestAccessToken(this.#hint
          ? { prompt: '', include_granted_scopes: false, login_hint: this.#hint }
          : { prompt: 'select_account', include_granted_scopes: false });
      } catch {
        fail('No se pudo iniciar la autorización de Google.');
      }
    });
  }

  rememberAccount(email?: string, accountId?: string): void {
    const previous = accountId && readBrowserAccount(this.#clientId);
    if (this.#expectedAccount && (accountId !== this.#expectedAccount || !previous
      || previous.generation !== this.#browserAccount?.generation)) {
      this.expire();
      throw new SessionExpiredError();
    }
    this.#expectedAccount = undefined;
    this.#hint = email;
    if (!accountId || !this.#credential) return;
    this.#redirectReturned = false;
    const account: BrowserAccount = {
      clientId: this.#clientId, id: accountId, hint: email,
      generation: previous && previous.id === accountId ? previous.generation : crypto.randomUUID(),
    };
    try {
      window.localStorage.setItem(BROWSER_ACCOUNT, JSON.stringify(account));
      this.#browserAccount = account;
      window.sessionStorage.removeItem(QUIET_RETRY);
    } catch {
      // The current tab can still use the access held in memory.
    }
  }

  access(): Access {
    if (!this.#credential || Date.now() >= this.#credential.expiresAt) {
      if (this.#credential) this.expire();
      throw new SessionExpiredError();
    }
    return { token: this.#credential.token, signal: this.#credential.controller.signal };
  }

  expire(expectedToken?: string): void {
    if (!this.#credential || (expectedToken && this.#credential.token !== expectedToken)) return;
    this.#clearAccess();
    this.#expectedAccount = undefined;
    if (!this.#cancelConnect && !this.#cancelRedirect) this.#publish('expired', RECONNECT);
  }

  disconnect(): void {
    try {
      if (readBrowserAccount(this.#clientId)) window.localStorage.removeItem(BROWSER_ACCOUNT);
      window.sessionStorage.removeItem(QUIET_RETRY);
    } catch {
      // Disconnect in memory even when storage is unavailable.
    }
    this.#dropSession();
  }

  #dropSession(): void {
    this.#cancelConnect?.();
    this.#cancelRedirect?.();
    this.#clearAccess();
    this.#hint = undefined;
    this.#browserAccount = undefined;
    this.#expectedAccount = undefined;
    this.#returnTo = undefined;
    this.#publish('ready', undefined, true);
  }

  #onAccountChange = (event: StorageEvent) => {
    if ((event.key === BROWSER_ACCOUNT || event.key === null) && this.#browserAccount
      && readBrowserAccount(this.#clientId)?.generation !== this.#browserAccount.generation) this.#dropSession();
  };

  #validClient(): boolean {
    return /^[\w.-]+\.apps\.googleusercontent\.com$/.test(this.#clientId);
  }

  #callbackUrl(): URL | undefined {
    if (!window.location) return undefined;
    try {
      const callback = new URL(this.#redirectUri ?? window.location.pathname, window.location.origin);
      const secure = callback.protocol === 'https:'
        || (callback.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(callback.hostname));
      if (secure && callback.origin === window.location.origin && !callback.username && !callback.password
        && !callback.search && !callback.hash) return callback;
    } catch {
      return undefined;
    }
  }

  #startRedirect({ quiet = false, returnTo }: { quiet?: boolean; returnTo?: string }): Promise<void> {
    const callback = this.#callbackUrl();
    if (!callback) return Promise.reject(new Error('La dirección de retorno de Google no está configurada.'));
    const state = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
    const pending: RedirectRequest = {
      state,
      expiresAt: Date.now() + REDIRECT_TIMEOUT,
      redirectUri: callback.href,
      clientId: this.#clientId,
      generation: quiet ? this.#browserAccount?.generation : undefined,
      returnTo,
    };
    try {
      window.sessionStorage.setItem(REDIRECT_STATE, JSON.stringify(pending));
    } catch {
      const message = 'Safari necesita permitir el almacenamiento temporal de este sitio para conectar Google Drive.';
      this.#publish(quiet ? 'ready' : this.#credential ? 'connected' : 'error', quiet ? undefined : message);
      return Promise.reject(new Error(message));
    }

    const authorize = new URL(GOOGLE_AUTHORIZE);
    authorize.search = new URLSearchParams({
      client_id: this.#clientId,
      redirect_uri: callback.href,
      response_type: 'token',
      scope: DRIVE_SCOPE,
      include_granted_scopes: 'false',
      state,
      ...(this.#hint ? { login_hint: this.#hint } : {}),
      ...(quiet ? { prompt: 'none' } : this.#hint ? {} : { prompt: 'select_account' }),
    }).toString();
    const cancel = () => {
      clearTimeout(timeout);
      window.removeEventListener('pageshow', onReturn);
      this.#cancelRedirect = undefined;
      // Back navigation can restore the page that started the authorization from Safari's cache.
      try {
        const saved = JSON.parse(window.sessionStorage.getItem(REDIRECT_STATE) ?? 'null') as RedirectRequest | null;
        if (saved?.state === state) window.sessionStorage.removeItem(REDIRECT_STATE);
      } catch {
        // A missing or blocked storage entry cannot be used to authorize.
      }
    };
    const onReturn = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      cancel();
      this.#publish(quiet ? 'ready' : this.#credential ? 'connected' : 'error', quiet ? undefined : CANCELLED);
    };
    const timeout = window.setTimeout(() => {
      cancel();
      this.#publish(quiet ? 'ready' : this.#credential ? 'connected' : 'error', quiet ? undefined : INVALID_REDIRECT);
    }, REDIRECT_START_TIMEOUT);
    this.#cancelRedirect = cancel;
    window.addEventListener('pageshow', onReturn);
    this.#publish('connecting');
    try {
      if (quiet) window.location.replace(authorize.href);
      else window.location.assign(authorize.href);
      return Promise.resolve();
    } catch {
      cancel();
      this.#publish(quiet ? 'ready' : this.#credential ? 'connected' : 'error', quiet ? undefined : FAILED);
      return Promise.reject(new Error(FAILED));
    }
  }

  #consumeRedirect(): void {
    const fragment = new URLSearchParams(window.location?.hash.slice(1));
    if (!['access_token', 'token_type', 'error'].some(field => fragment.has(field))) return;
    this.#redirectReturned = true;

    // Drop the callback fragment before loading GIS or rendering the application.
    const clean = new URL(window.location.href);
    clean.hash = '';
    try {
      window.history.replaceState(window.history.state, '', clean.href);
    } catch {
      this.#useRedirect = true;
      this.#publish('error', INVALID_REDIRECT);
      window.location.replace(clean.href);
      return;
    }

    let pending: RedirectRequest | null = null;
    try {
      const saved = window.sessionStorage.getItem(REDIRECT_STATE);
      window.sessionStorage.removeItem(REDIRECT_STATE);
      if (saved) pending = JSON.parse(saved) as RedirectRequest;
    } catch {
      // An inaccessible nonce cannot authorize an incoming token.
    }
    const callback = this.#callbackUrl();
    if (!this.#validClient() || !pending || typeof pending.state !== 'string'
      || !/^[0-9a-f]{64}$/.test(pending.state) || !Number.isSafeInteger(pending.expiresAt)
      || pending.expiresAt <= Date.now() || pending.clientId !== this.#clientId
      || !callback || callback.href !== pending.redirectUri
      || callback.pathname !== window.location.pathname || window.location.search
      || OAUTH_FIELDS.some(field => fragment.getAll(field).length > 1)
      || fragment.get('state') !== pending.state) {
      this.#publish('error', INVALID_REDIRECT);
      return;
    }
    if (pending.generation) {
      const account = readBrowserAccount(this.#clientId);
      if (!account || pending.generation !== account.generation) {
        this.#publish('ready');
        return;
      }
      this.#expectedAccount = account.id;
    }
    const error = fragment.get('error');
    if (error) {
      this.#expectedAccount = undefined;
      if (pending.generation) this.#publish('ready');
      else this.#publish('error', error === 'access_denied' ? DENIED : FAILED);
      return;
    }
    const token = fragment.get('access_token');
    const scope = fragment.get('scope')?.trim().split(/\s+/);
    const lifetime = Number(fragment.get('expires_in'));
    if (!token || !TOKEN_PATTERN.test(token) || fragment.get('token_type')?.toLowerCase() !== 'bearer'
      || !Number.isSafeInteger(lifetime) || lifetime <= 0) {
      this.#publish('error', FAILED);
      return;
    }
    if (!scope?.length || scope.some(value => value !== DRIVE_SCOPE)) {
      this.#publish('error', 'Autoriza solo el acceso a los archivos de TAI Hub en Google Drive.');
      return;
    }
    this.#returnTo = typeof pending.returnTo === 'string' ? pending.returnTo : undefined;
    this.#acceptToken(token, lifetime);
  }

  #acceptToken(token: string, expiresIn: number): void {
    this.#clearAccess();
    const seconds = Math.min(expiresIn, 3600);
    const lifetime = Math.max(1, seconds - Math.min(30, seconds / 10)) * 1000;
    this.#credential = {
      token,
      expiresAt: Date.now() + lifetime,
      controller: new AbortController(),
    };
    this.#expiryTimer = window.setTimeout(() => this.expire(), lifetime);
    this.#publish('connected');
  }

  #clearAccess(): void {
    this.#credential?.controller.abort();
    this.#credential = undefined;
    clearTimeout(this.#expiryTimer);
    this.#expiryTimer = undefined;
  }

  #publish(status: AuthStatus, error?: string, force = false): void {
    if (!force && this.#snapshot.status === status && this.#snapshot.error === error) return;
    this.#snapshot = { status, error };
    for (const listener of this.#listeners) listener();
  }
}
