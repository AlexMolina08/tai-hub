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
type GoogleWindow = Window & { google?: { accounts?: { oauth2?: GoogleOAuth } } };
const oauth = () => (window as GoogleWindow).google?.accounts?.oauth2;
const GOOGLE_SCRIPT = 'https://accounts.google.com/gsi/client';
const RECONNECT = 'Vuelve a conectar Google Drive para continuar.';

let loadingGoogle: Promise<GoogleOAuth> | undefined;

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
  #google?: GoogleOAuth;
  #snapshot: AuthSnapshot = { status: 'loading' };
  #listeners = new Set<() => void>();
  #credential?: { token: string; expiresAt: number; controller: AbortController };
  #expiryTimer?: number;
  #cancelConnect?: () => void;
  #hint?: string;

  constructor(clientId: string) {
    this.#clientId = clientId.trim();
  }

  snapshot = (): AuthSnapshot => this.#snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  async prepare(): Promise<void> {
    if (this.#google) return;
    if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(this.#clientId)) {
      this.#publish('error', 'Falta configurar el cliente OAuth de TAI Hub.');
      return;
    }
    this.#publish('loading');
    try {
      this.#google = await loadGoogle();
      this.#publish('ready');
    } catch (error) {
      this.#publish('error', (error as Error).message);
    }
  }

  connect({ switchAccount = false }: { switchAccount?: boolean } = {}): Promise<void> {
    if (!this.#google) return Promise.reject(new Error('El acceso de Google aún no está disponible.'));
    if (this.#cancelConnect) return Promise.reject(new Error('Ya hay una ventana de Google abierta.'));
    if (switchAccount) {
      this.#clearAccess();
      this.#hint = undefined;
    }

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
            if (response.error || !response.access_token || !Number.isFinite(expiresIn) || expiresIn <= 0) {
              fail(response.error === 'access_denied' ? 'No se ha autorizado el acceso a Drive.' : 'Google no pudo completar la autorización.');
              return;
            }
            if (!response.scope?.split(/\s+/).includes(DRIVE_SCOPE)) {
              fail('Autoriza el acceso a los archivos de TAI Hub en la ventana de Google.');
              return;
            }
            cleanup();
            this.#clearAccess();
            const lifetime = Math.max(1, expiresIn - Math.min(30, expiresIn / 10)) * 1000;
            this.#credential = {
              token: response.access_token,
              expiresAt: Date.now() + lifetime,
              controller: new AbortController(),
            };
            this.#expiryTimer = window.setTimeout(() => this.expire(), lifetime);
            this.#publish('connected');
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

  rememberAccount(email?: string): void {
    this.#hint = email;
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
    if (!this.#cancelConnect) this.#publish('expired', RECONNECT);
  }

  disconnect(): void {
    this.#cancelConnect?.();
    this.#clearAccess();
    this.#hint = undefined;
    this.#publish(this.#google ? 'ready' : 'loading');
  }

  #clearAccess(): void {
    this.#credential?.controller.abort();
    this.#credential = undefined;
    clearTimeout(this.#expiryTimer);
    this.#expiryTimer = undefined;
  }

  #publish(status: AuthStatus, error?: string): void {
    if (this.#snapshot.status === status && this.#snapshot.error === error) return;
    this.#snapshot = { status, error };
    for (const listener of this.#listeners) listener();
  }
}
