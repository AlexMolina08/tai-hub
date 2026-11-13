import { GoogleSession, SessionExpiredError } from './auth';
import type { MediaSource, UploadProgress } from './types';

const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const CHUNK_BYTES = 8 * 1024 * 1024;
const MULTIPART_BYTES = 4 * 1024 * 1024;
const REPLACEMENT_KEY = 'taiHubReplacement';

export const FILE_FIELDS = 'id,name,mimeType,size,description,modifiedTime,createdTime,headRevisionId,md5Checksum,appProperties,webViewLink,webContentLink,trashed,parents,ownedByMe,shared';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  description?: string;
  createdTime?: string;
  modifiedTime?: string;
  headRevisionId?: string;
  md5Checksum?: string;
  appProperties?: Record<string, string>;
  webViewLink?: string;
  webContentLink?: string;
  trashed?: boolean;
  ownedByMe?: boolean;
  shared?: boolean;
  parents?: string[];
};

type FileMetadata = Partial<DriveFile>;

export class DriveError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'DriveError';
  }
}

function url(path: string, query?: Record<string, string>, base = DRIVE): string {
  const address = new URL(base + path);
  for (const [name, value] of Object.entries(query ?? {})) address.searchParams.set(name, value);
  return address.href;
}

export function driveValue(value: string): string {
  return "'" + value.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}

export function appProperty(key: string, value: string): string {
  return `appProperties has { key=${driveValue(key)} and value=${driveValue(value)} }`;
}

export function filePath(id: string): string {
  return '/files/' + encodeURIComponent(id);
}

async function responseError(response: Response): Promise<DriveError> {
  let reason: string | undefined;
  try {
    const body = await response.json() as { error?: { errors?: { reason?: string }[] } };
    reason = body.error?.errors?.[0]?.reason;
  } catch {
    // Non-JSON gateway responses still have a useful HTTP status.
  }
  const status = response.status;
  if (reason === 'storageQuotaExceeded') return new DriveError('Google Drive se ha quedado sin espacio.', status);
  if (status === 429 || reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded') {
    return new DriveError('Drive está limitando las solicitudes. Espera un momento e inténtalo de nuevo.', status);
  }
  const messages: Record<number, string> = {
    400: 'Google Drive ha rechazado los datos de la operación.',
    403: 'Google Drive no ha autorizado esta operación.',
    404: 'El archivo ya no está disponible en Google Drive.',
    409: 'Ya existe un archivo asociado a esta operación.',
    413: 'Google Drive ha rechazado el tamaño del archivo.',
  };
  return new DriveError(messages[status] ?? `Google Drive no pudo completar la operación (HTTP ${status}).`, status);
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function nextByte(response: Response, fallback: number): number {
  const range = response.headers.get('Range');
  const parsed = range?.match(/^bytes=0-(\d+)$/);
  return parsed ? Number(parsed[1]) + 1 : fallback;
}

export class DriveClient {
  readonly signal: AbortSignal;
  #token: string;
  #session: GoogleSession;

  constructor(session: GoogleSession) {
    const { token, signal } = session.access();
    this.#session = session;
    this.#token = token;
    this.signal = signal;
  }

  async json<T>(path: string, query?: Record<string, string>, init?: RequestInit): Promise<T> {
    if (init?.method && init.method !== 'GET') return (await this.#request(url(path, query), init)).json() as Promise<T>;
    const controller = new AbortController();
    const abort = () => controller.abort(this.signal.reason);
    this.signal.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      return await (await this.#request(url(path, query), { ...init, signal: controller.signal })).json() as T;
    } catch (error) {
      if (controller.signal.aborted && !this.signal.aborted) {
        throw new DriveError('Google Drive no respondió a tiempo. Puedes volver a intentarlo.', 0);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      this.signal.removeEventListener('abort', abort);
    }
  }

  async generateIds(count: number): Promise<string[]> {
    const { ids } = await this.json<{ ids: string[] }>('/files/generateIds', { count: String(count), space: 'drive' });
    if (!Array.isArray(ids) || ids.length !== count || new Set(ids).size !== count || ids.some(id => typeof id !== 'string' || !id)) {
      throw new DriveError('Drive no devolvió los identificadores de los archivos.', 0);
    }
    return ids;
  }

  async list(query: string, fields = FILE_FIELDS): Promise<DriveFile[]> {
    const files: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const result = await this.json<{ nextPageToken?: string; files?: DriveFile[] }>('/files', {
        q: `trashed = false and 'me' in owners and (${query})`,
        spaces: 'drive',
        fields: `nextPageToken,files(${fields})`,
        pageSize: '1000',
        ...(pageToken ? { pageToken } : {}),
      });
      files.push(...(result.files ?? []));
      pageToken = result.nextPageToken;
    } while (pageToken);
    return files;
  }

  source(path: string): MediaSource {
    this.signal.throwIfAborted();
    return {
      url: url(path, { alt: 'media' }),
      httpHeaders: { Authorization: `Bearer ${this.#token}` },
    };
  }

  media(path: string): Promise<Response> {
    return this.#request(url(path, { alt: 'media' }));
  }

  async upload(metadata: FileMetadata, content: Blob, id?: string, progress?: UploadProgress, keepRevision = false, generatedId?: string): Promise<DriveFile> {
    const path = id ? filePath(id) : '/files';
    const method = id ? 'PATCH' : 'POST';
    const mime = content.type || 'application/octet-stream';
    const fields = FILE_FIELDS;
    const uploadOptions: Record<string, string> = { fields };
    if (keepRevision) uploadOptions.keepRevisionForever = 'true';
    const newId = id ? undefined : generatedId ?? (await this.generateIds(1))[0];
    const replacement = id && keepRevision ? crypto.randomUUID() : undefined;
    const fileMetadata = { ...metadata };
    if (newId) fileMetadata.id = newId;
    if (replacement) fileMetadata.appProperties = { ...metadata.appProperties, [REPLACEMENT_KEY]: replacement };
    progress?.(0, content.size);

    try {
      if (content.size <= MULTIPART_BYTES) {
        const boundary = 'tai_hub_' + crypto.randomUUID();
        const multipart = new Blob([
          `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
          JSON.stringify(fileMetadata),
          `\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`,
          content,
          `\r\n--${boundary}--\r\n`,
        ]);
        const result = await this.#request(url(path, { uploadType: 'multipart', ...uploadOptions }, UPLOAD), {
          method,
          headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
          body: multipart,
        });
        const file = await result.json() as DriveFile;
        progress?.(content.size, content.size);
        return file;
      }

      const initiationUrl = url(path, { uploadType: 'resumable', ...uploadOptions }, UPLOAD);
      const start = await this.#request(initiationUrl, {
        method,
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': mime,
          'X-Upload-Content-Length': String(content.size),
        },
        body: JSON.stringify(fileMetadata),
      });
      const location = start.headers.get('Location');
      if (!location) throw new DriveError('Drive no ha devuelto la sesión de carga.', 0);
      const uploadUrl = new URL(location, initiationUrl);
      if (uploadUrl.protocol !== 'https:' || uploadUrl.username || uploadUrl.password
        || !['www.googleapis.com', 'content.googleapis.com'].includes(uploadUrl.host)) {
        throw new DriveError('Drive ha devuelto una dirección de carga inesperada.', 0);
      }
      return await this.#uploadChunks(uploadUrl.href, content, progress);
    } catch (error) {
      const recoverId = newId ?? (replacement ? id : undefined);
      const interrupted = error instanceof DriveError && [0, 404, 409, 500, 502, 503, 504].includes(error.status);
      if (recoverId && (interrupted || error instanceof SyntaxError)) {
        // The final response may disappear after the generated ID or pinned revision commits.
        try {
          const existing = await this.json<DriveFile>(filePath(recoverId), { fields });
          const matchesWrite = !replacement || existing.appProperties?.[REPLACEMENT_KEY] === replacement;
          if (matchesWrite && Number(existing.size) === content.size && !existing.trashed) {
            progress?.(content.size, content.size);
            return existing;
          }
        } catch (recoveryError) {
          if (recoveryError instanceof SessionExpiredError || this.signal.aborted) throw recoveryError;
        }
      }
      if (content.size > MULTIPART_BYTES && error instanceof DriveError && error.status === 404) {
        throw new DriveError('La sesión de carga de Drive ha caducado. Vuelve a iniciar la carga.', 404);
      }
      throw error;
    }
  }

  async #uploadChunks(uploadUrl: string, content: Blob, progress?: UploadProgress): Promise<DriveFile> {
    let offset = 0;
    let attempts = 0;
    let checkOffset = false;
    while (offset < content.size) {
      const end = Math.min(offset + CHUNK_BYTES, content.size);
      try {
        const response = await this.#request(uploadUrl, {
          method: 'PUT',
          headers: {
            'Content-Range': checkOffset ? `bytes */${content.size}` : `bytes ${offset}-${end - 1}/${content.size}`,
            'Content-Type': content.type || 'application/octet-stream',
          },
          body: checkOffset ? undefined : content.slice(offset, end),
        }, { allowIncomplete: true, authorize: false });
        if (response.status !== 308) {
          const file = await response.json() as DriveFile;
          progress?.(content.size, content.size);
          return file;
        }
        // Drive may omit Range from the exposed CORS headers. A completed chunk
        // advances by its full size, but a recovery probe uses the last known offset.
        const next = nextByte(response, checkOffset ? offset : end);
        if (next < 0 || next >= content.size || (!checkOffset && next <= offset)) {
          throw new DriveError('Drive no ha confirmado el avance de la carga.', 0);
        }
        offset = next;
        if (!checkOffset) attempts = 0;
        checkOffset = false;
        progress?.(offset, content.size);
      } catch (error) {
        if (!(error instanceof DriveError) || ![0, 429, 500, 502, 503, 504].includes(error.status) || attempts >= 3) {
          throw error;
        }
        await wait(500 * 2 ** attempts, this.signal);
        attempts += 1;
        checkOffset = true;
      }
    }
    throw new DriveError('Drive no ha confirmado que el archivo se haya guardado.', 0);
  }

  async #request(
    address: string,
    init: RequestInit = {},
    { allowIncomplete = false, authorize = true } = {},
  ): Promise<Response> {
    this.signal.throwIfAborted();
    const headers = new Headers(init.headers);
    if (authorize) headers.set('Authorization', `Bearer ${this.#token}`);
    let response: Response;
    try {
      response = await fetch(address, {
        ...init,
        headers,
        signal: init.signal ?? this.signal,
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
    } catch (error) {
      if (this.signal.aborted) throw error;
      throw new DriveError('No se pudo conectar con Google Drive. Revisa la conexión e inténtalo de nuevo.', 0);
    }
    if (response.status === 401) {
      this.#session.expire(this.#token);
      throw new SessionExpiredError();
    }
    if (response.ok || (allowIncomplete && response.status === 308)) return response;
    throw await responseError(response);
  }
}

export function jsonBody(method: string, data: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  };
}
