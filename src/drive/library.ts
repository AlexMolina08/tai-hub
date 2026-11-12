import { GoogleSession } from './auth';
import { sha256 } from './checksum';
import { DriveClient, DriveError, FILE_FIELDS, FOLDER_MIME, appProperty, filePath, jsonBody } from './client';
import type { DriveFile } from './client';
import { externalUrl } from './types';
import type { DriveAccount, DriveRevision, Resource, ResourceDraft, ResourceKind, UploadProgress } from './types';

const DOWNLOAD_LIMIT = 32 * 1024 * 1024;
const METADATA_LIMIT = 16_000;
const APP_KEY = 'taiHub';
const RESOURCES = appProperty(APP_KEY, 'resource');
const ROOT = appProperty(APP_KEY, 'library');
const INDEXES = appProperty(APP_KEY, 'pdfIndex');
const STUDY = appProperty(APP_KEY, 'study');
const JSON_MIME = 'application/json';
const LAB_PACKAGES = appProperty(APP_KEY, 'labPackage');
const LAB_ARCHIVE = 'labEventArchive';
const KINDS = new Set<ResourceKind>(['pdf', 'html', 'video', 'image', 'audio', 'text', 'link', 'note', 'other']);

export type LabPackageUpload = { file: File; editionKey: string; sha256: string };

const KNOWN_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
  wmv: 'video/x-ms-wmv',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  txt: 'text/plain',
  md: 'text/markdown',
  html: 'text/html',
  htm: 'text/html',
  csv: 'text/csv',
};

type FileFormat = Pick<File, 'name' | 'type'>;

export function fileMime(file: FileFormat): string {
  if (file.type && file.type !== 'application/octet-stream') return file.type;
  return KNOWN_MIME[file.name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}

export function resourceKind(file: FileFormat): ResourceKind {
  const mime = fileMime(file);
  if (mime === 'application/pdf' || /\.pdf$/i.test(file.name)) return 'pdf';
  if (mime === 'text/html' || /\.html?$/i.test(file.name)) return 'html';
  if (mime === 'image/svg+xml') return 'other';
  for (const kind of ['video', 'image', 'audio', 'text'] as const) {
    if (mime.startsWith(kind + '/')) return kind;
  }
  return 'other';
}

function normalizeDraft(draft: ResourceDraft): ResourceDraft {
  const title = draft.title.trim();
  const kind = draft.kind;
  if (!title) throw new Error('Escribe un nombre para el recurso.');
  if (!KINDS.has(kind)) throw new Error('El tipo de recurso no es válido.');
  const tags = [...new Set(draft.tags.map(tag => tag.trim()).filter(Boolean))];
  const topicId = draft.topicId || null;
  const relatedTopicIds = [...new Set(draft.relatedTopicIds ?? [])].filter(id => id && id !== topicId);
  const url = kind === 'link' && draft.url ? externalUrl(draft.url.trim()) : undefined;
  if (kind === 'link' && !url) throw new Error('Introduce un enlace web válido.');
  return {
    title,
    kind,
    source: draft.source.trim(),
    topicId,
    tags,
    relatedTopicIds: relatedTopicIds.length ? relatedTopicIds : undefined,
    url,
    note: kind === 'note' ? (draft.note ?? '').trim() : undefined,
    sourcePath: draft.sourcePath,
    needsReview: draft.needsReview || undefined,
  };
}

function describe(draft: ResourceDraft): string {
  const description = JSON.stringify({ schema: 1, ...draft });
  if (new TextEncoder().encode(description).byteLength > METADATA_LIMIT) {
    throw new Error('Los metadatos son demasiado largos. Guarda textos extensos como archivo.');
  }
  return description;
}

function readDraft(file: DriveFile): ResourceDraft {
  try {
    const data = JSON.parse(file.description ?? '') as Partial<ResourceDraft> & { schema?: number };
    if (data.schema === 1 && typeof data.title === 'string' && data.kind && KINDS.has(data.kind)) {
      return {
        title: data.title,
        kind: data.kind,
        source: typeof data.source === 'string' ? data.source : '',
        topicId: typeof data.topicId === 'string' ? data.topicId : null,
        tags: data.tags?.filter(tag => typeof tag === 'string') ?? [],
        relatedTopicIds: data.relatedTopicIds?.filter(id => typeof id === 'string'),
        url: typeof data.url === 'string' ? externalUrl(data.url) : undefined,
        note: typeof data.note === 'string' ? data.note : undefined,
        sourcePath: typeof data.sourcePath === 'string' ? data.sourcePath : undefined,
        needsReview: data.needsReview === true,
      };
    }
  } catch {
    // A user can change a file's description in Drive. Keep its binary accessible.
  }
  return {
    title: file.name,
    source: '',
    topicId: null,
    tags: [],
    kind: resourceKind({ name: file.name, type: file.mimeType }),
    needsReview: true,
  };
}

function asResource(file: DriveFile): Resource {
  return {
    ...readDraft(file),
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    size: Number(file.size ?? 0),
    version: file.md5Checksum ?? file.headRevisionId ?? file.id,
    modifiedTime: file.modifiedTime ?? file.createdTime ?? '',
    webViewLink: file.webViewLink,
    webContentLink: file.webContentLink,
    md5Checksum: file.md5Checksum,
    importKey: file.appProperties?.importKey,
  };
}

function driveLink(address?: string): string | undefined {
  if (!address) return;
  try {
    const link = new URL(address);
    if (link.protocol === 'https:' && !link.username && !link.password
      && ['drive.google.com', 'docs.google.com', 'drive.usercontent.google.com'].includes(link.hostname)) {
      return link.href;
    }
  } catch {
    return undefined;
  }
}

function saveLink(url: string, name?: string): void {
  const link = document.createElement('a');
  link.href = url;
  if (name) link.download = name;
  else link.target = '_blank';
  link.rel = 'noopener noreferrer';
  document.body.append(link);
  link.click();
  link.remove();
}

async function saveResponse(response: Response, name: string): Promise<void> {
  const content = await response.blob();
  // A download should never interpret private bytes as HTML or script.
  const address = URL.createObjectURL(new Blob([content], { type: 'application/octet-stream' }));
  saveLink(address, name);
  setTimeout(() => URL.revokeObjectURL(address), 30_000);
}

function firstCreated(files: DriveFile[]): DriveFile | undefined {
  return files.sort((a, b) => (a.createdTime ?? '').localeCompare(b.createdTime ?? '') || a.id.localeCompare(b.id))[0];
}

async function jsonBlob(value: unknown, compress = false): Promise<Blob> {
  const plain = new Blob([JSON.stringify(value)], { type: JSON_MIME });
  if (!compress || plain.size < 1024 || typeof CompressionStream === 'undefined') return plain;
  const zipped = plain.stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(zipped, { headers: { 'Content-Type': 'application/gzip' } }).blob();
}

export class DriveLibrary {
  #session: GoogleSession;
  #account?: { signal: AbortSignal; value: Promise<DriveAccount> };
  #folder?: { signal: AbortSignal; value: Promise<string> };
  #indexList?: { signal: AbortSignal; value: Promise<DriveFile[]>; validUntil: number };

  constructor(session: GoogleSession) {
    this.#session = session;
  }

  account(): Promise<DriveAccount> {
    const client = this.#client();
    if (this.#account?.signal === client.signal) return this.#account.value;
    const value = client.json<{
      user?: { permissionId?: string; displayName?: string; emailAddress?: string };
      storageQuota?: { limit?: string; usage?: string };
    }>('/about', { fields: 'user(permissionId,displayName,emailAddress),storageQuota(limit,usage)' }).then(data => {
      const id = data.user?.permissionId;
      if (!id) throw new Error('Google Drive no ha identificado la cuenta.');
      client.signal.throwIfAborted();
      this.#session.rememberAccount(data.user?.emailAddress, id);
      return {
        id,
        name: data.user?.displayName || 'Google Drive',
        email: data.user?.emailAddress,
        storage: {
          usage: Number(data.storageQuota?.usage ?? 0),
          limit: data.storageQuota?.limit ? Number(data.storageQuota.limit) : undefined,
        },
      };
    }).catch((error: unknown) => {
      if (this.#account?.signal === client.signal) this.#account = undefined;
      throw error;
    });
    this.#account = { signal: client.signal, value };
    return value;
  }

  async list(): Promise<Resource[]> {
    return (await this.#client().list(RESOURCES)).map(asResource);
  }

  async create(draft: ResourceDraft, file?: File, progress?: UploadProgress, importKey?: string): Promise<Resource> {
    const client = this.#client();
    const normalized = normalizeDraft(draft);
    if (importKey && !/^[a-zA-Z0-9._:-]{1,100}$/.test(importKey)) throw new Error('La clave de importación no es válida.');
    if (importKey) {
      const existing = firstCreated(await client.list(`${RESOURCES} and ${appProperty('importKey', importKey)}`));
      if (existing) return asResource(existing);
    }

    const virtual = normalized.kind === 'link' || normalized.kind === 'note';
    if (virtual && file) throw new Error('Guarda los enlaces y notas sin adjuntar un archivo.');
    if (!virtual && !file) throw new Error('Selecciona un archivo.');
    if (file && normalized.kind === 'pdf') await checkPdf(file);
    const description = describe(normalized);
    const content = file
      ? file.slice(0, file.size, normalized.kind === 'pdf' ? 'application/pdf' : fileMime(file))
      : await jsonBlob(virtualContents(normalized));
    const appProperties = { [APP_KEY]: 'resource', ...(importKey ? { importKey } : {}) };
    const name = file?.name ?? normalized.title + '.json';
    const parents = [await this.#ensureFolder(client)];
    return asResource(await client.upload({ name, mimeType: content.type, description, appProperties, parents }, content, undefined, progress));
  }

  async update(id: string, draft: ResourceDraft): Promise<Resource> {
    const client = this.#client();
    const file = await this.#resourceFile(client, id);
    const previous = readDraft(file);
    const normalized = normalizeDraft(draft);
    const virtual = previous.kind === 'link' || previous.kind === 'note';
    if (virtual !== (normalized.kind === 'link' || normalized.kind === 'note')) {
      throw new Error('Un archivo y una nota o un enlace se guardan como recursos distintos.');
    }
    const description = describe(normalized);
    if (virtual) {
      const content = await jsonBlob(virtualContents(normalized));
      return asResource(await client.upload({ name: normalized.title + '.json', description }, content, id));
    }
    return asResource(await client.json<DriveFile>(filePath(id), { fields: FILE_FIELDS }, jsonBody('PATCH', { description })));
  }

  async replace(id: string, file: File, draft: ResourceDraft, progress?: UploadProgress): Promise<Resource> {
    const client = this.#client();
    const previous = await this.#resourceFile(client, id);
    if (readDraft(previous).kind !== 'pdf' || draft.kind !== 'pdf') throw new Error('La sustitución de versiones está disponible para PDFs.');
    const description = describe(normalizeDraft(draft));
    await checkPdf(file);
    if (previous.headRevisionId) {
      // Pin the previous original before uploading the replacement.
      await client.json<DriveRevision>(revisionPath(id, previous.headRevisionId), { fields: 'id,keepForever' }, jsonBody('PATCH', { keepForever: true }));
    }
    return asResource(await client.upload(
      { name: file.name, mimeType: 'application/pdf', description, appProperties: previous.appProperties },
      file.slice(0, file.size, 'application/pdf'),
      id,
      progress,
      true,
    ));
  }

  async trash(id: string): Promise<void> {
    const client = this.#client();
    await this.#resourceFile(client, id);
    await client.json<DriveFile>(filePath(id), { fields: 'id,trashed' }, jsonBody('PATCH', { trashed: true }));
  }

  async revisions(id: string): Promise<DriveRevision[]> {
    const client = this.#client();
    const current = await this.#resourceFile(client, id);
    const revisions: DriveRevision[] = [];
    let pageToken: string | undefined;
    do {
      const page = await client.json<{ nextPageToken?: string; revisions?: DriveRevision[] }>(filePath(id) + '/revisions', {
        fields: 'nextPageToken,revisions(id,modifiedTime,originalFilename,keepForever,size)',
        pageSize: '200',
        ...(pageToken ? { pageToken } : {}),
      });
      revisions.push(...(page.revisions ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return revisions.filter(revision => revision.keepForever && revision.id !== current.headRevisionId)
      .sort((a, b) => (b.modifiedTime ?? '').localeCompare(a.modifiedTime ?? ''));
  }

  mediaSource(id: string) {
    return this.#client().source(filePath(id));
  }

  pdfSource(id: string) {
    return this.mediaSource(id);
  }

  viewUrl(resource: Resource): string {
    return driveLink(resource.webViewLink) ?? `https://drive.google.com/file/d/${encodeURIComponent(resource.id)}/view`;
  }

  async readBlob(id: string, maxBytes = DOWNLOAD_LIMIT): Promise<Blob> {
    const client = this.#client();
    const file = await this.#resourceFile(client, id);
    if (file.size === undefined || Number(file.size) > maxBytes) throw new Error('Abre este archivo en Google Drive para previsualizarlo.');
    const response = await client.media(filePath(id));
    const oversized = () => new Error('Abre este archivo en Google Drive para previsualizarlo.');
    if (!response.body || Number(response.headers.get('Content-Length')) > maxBytes) {
      await response.body?.cancel();
      throw oversized();
    }
    const reader = response.body.getReader();
    const chunks: BlobPart[] = [];
    let total = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        total += chunk.value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw oversized();
        }
        chunks.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
    return new Blob(chunks, { type: file.mimeType });
  }

  downloadInBrowser(resource: Resource): { href: string; direct: boolean } | undefined {
    if (resource.size <= DOWNLOAD_LIMIT) return;
    const direct = driveLink(resource.webContentLink);
    return direct ? { href: direct, direct: true } : { href: this.viewUrl(resource), direct: false };
  }

  async download(resource: Resource, revisionId?: string): Promise<void> {
    const browser = revisionId ? undefined : this.downloadInBrowser(resource);
    if (browser) {
      saveLink(browser.href);
      return;
    }
    const client = this.#client();
    if (revisionId) {
      const revision = await client.json<DriveRevision>(revisionPath(resource.id, revisionId), {
        fields: 'id,originalFilename,keepForever',
      });
      if (!revision.keepForever) throw new Error('Drive solo permite descargar las versiones anteriores conservadas.');
      await saveResponse(await client.media(revisionPath(resource.id, revisionId)), revision.originalFilename ?? resource.name);
      return;
    }
    await saveResponse(await client.media(filePath(resource.id)), resource.name);
  }

  async loadIndex<T>(id: string, version: string): Promise<T | null> {
    const client = this.#client();
    const indexes = await this.#getIndexes(client);
    const file = indexes.find(item => item.appProperties?.resourceId === id && item.appProperties.version === version);
    if (!file) return null;
    const response = await client.media(filePath(file.id));
    if (file.appProperties?.codec === 'gzip') {
      if (typeof DecompressionStream === 'undefined' || !response.body) return null;
      const plain = response.body.pipeThrough(new DecompressionStream('gzip'));
      return new Response(plain).json() as Promise<T>;
    }
    return response.json() as Promise<T>;
  }

  async saveIndex<T>(id: string, version: string, value: T): Promise<void> {
    const client = this.#client();
    const resource = asResource(await this.#resourceFile(client, id));
    if (resource.kind !== 'pdf' || resource.version !== version.replace(/^\d+:/, '')) {
      throw new DriveError('El PDF ha cambiado. Actualiza la biblioteca antes de reindexar.', 409);
    }
    const indexes = await this.#getIndexes(client);
    const existing = indexes.find(item => item.appProperties?.resourceId === id);
    const content = await jsonBlob(value, true);
    const appProperties = { [APP_KEY]: 'pdfIndex', resourceId: id, version, codec: content.type === 'application/gzip' ? 'gzip' : 'json' };
    const metadata = { name: `TAI Hub PDF ${id}.index`, mimeType: content.type, appProperties };
    const file = await client.upload(
      existing ? metadata : { ...metadata, parents: [await this.#ensureFolder(client)] },
      content,
      existing?.id,
    );
    if (existing) indexes.splice(indexes.indexOf(existing), 1, file);
    else indexes.push(file);
  }

  async listStudyFiles(accountId: string): Promise<DriveFile[]> {
    const client = await this.#accountClient(accountId);
    return client.list(STUDY, 'id,name,mimeType,headRevisionId,modifiedTime,appProperties');
  }

  async readStudyFile<T>(accountId: string, id: string): Promise<T> {
    const client = await this.#accountClient(accountId);
    const response = await client.media(filePath(id));
    return response.json() as Promise<T>;
  }

  async writeStudyFile(accountId: string, writer: string, value: unknown, existingId?: string): Promise<DriveFile> {
    const client = await this.#accountClient(accountId);
    const content = await jsonBlob(value);
    const metadata = { name: 'TAI Hub · Progreso ' + writer, mimeType: JSON_MIME, appProperties: { [APP_KEY]: 'study', writer } };
    return client.upload(
      existingId ? metadata : { ...metadata, parents: [await this.#ensureFolder(client)] },
      content,
      existingId,
    );
  }

  async listLabFiles(accountId: string, kind: 'labEvents' | 'labPackage'): Promise<DriveFile[]> {
    const client = await this.#accountClient(accountId);
    const files = await client.list(appProperty(APP_KEY, kind), FILE_FIELDS);
    if (kind === 'labEvents' && files.some(file => !file.ownedByMe || file.shared || file.trashed)) {
      throw new Error('El laboratorio solo carga archivos privados de esta cuenta.');
    }
    return files;
  }

  async installLabPackages(
    accountId: string, packages: LabPackageUpload[], prepare: () => Promise<void>, progress: (completed: number) => void,
  ): Promise<void> {
    const client = await this.#accountClient(accountId);
    const existing = await client.list(LAB_PACKAGES, 'id,appProperties,ownedByMe,shared,trashed');
    const installed = new Set<string>();
    const requested = new Map(packages.map(pack => [pack.editionKey, pack]));
    for (const file of existing) {
      const key = file.appProperties?.labEdition;
      const pack = key ? requested.get(key) : undefined;
      if (!pack) continue;
      if (!file.ownedByMe || file.shared || file.trashed) throw new Error('La edición existente en Drive debe ser privada y de tu propiedad.');
      if (file.appProperties?.labSha256 !== pack.sha256) {
        throw new Error('Esa versión ya existe en Drive con otro contenido. Conserva el archivo anterior y usa una versión nueva.');
      }
      installed.add(pack.editionKey);
    }
    await prepare();
    progress(installed.size);
    if (installed.size === packages.length) return;
    const folderId = await this.#ensureFolder(client);
    const folder = await client.json<DriveFile>(filePath(folderId), { fields: 'id,ownedByMe,shared,trashed' });
    if (!folder.ownedByMe || folder.shared || folder.trashed) throw new Error('La carpeta de TAI Hub debe ser privada y de tu propiedad.');
    for (const { file, editionKey, sha256 } of packages) {
      if (installed.has(editionKey)) continue;
      if (file.size > DOWNLOAD_LIMIT) throw new Error('El paquete supera 32 MB.');
      const content = file.slice(0, file.size, JSON_MIME);
      const saved = await client.upload({ name: file.name, mimeType: JSON_MIME, parents: [folderId],
        appProperties: { [APP_KEY]: 'labPackage', labEdition: editionKey, labSha256: sha256 } }, content);
      if (!saved.ownedByMe || saved.shared || saved.trashed || saved.appProperties?.[APP_KEY] !== 'labPackage'
        || saved.appProperties.labEdition !== editionKey || saved.appProperties.labSha256 !== sha256) {
        throw new Error('No se pudo verificar el archivo privado que devolvió Drive.');
      }
      installed.add(editionKey);
      progress(installed.size);
    }
  }

  async readLabFile(accountId: string, id: string, kind: 'labEvents' | 'labPackage'): Promise<unknown> {
    const client = await this.#accountClient(accountId);
    const file = await client.json<DriveFile>(filePath(id), { fields: FILE_FIELDS });
    const type = file.appProperties?.[APP_KEY];
    if (file.trashed || !file.ownedByMe || file.shared
      || (type !== kind && !(kind === 'labEvents' && type === LAB_ARCHIVE))) {
      throw new Error('El laboratorio solo carga archivos privados de esta cuenta.');
    }
    const response = await client.media(filePath(id));
    if (!response.body) throw new Error('El archivo del laboratorio está vacío.');
    const reader = response.body.getReader();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > DOWNLOAD_LIMIT) { await reader.cancel(); throw new Error('El paquete excede el límite de descarga.'); }
        chunks.push(new Uint8Array(chunk.value));
      }
    } finally { reader.releaseLock(); }
    const body = new Blob(chunks);
    const checksum = kind === 'labPackage' ? file.appProperties?.labSha256 : undefined;
    if (checksum && checksum !== await sha256(await body.arrayBuffer())) {
      throw new Error('El contenido del paquete no coincide con la edición instalada en Drive.');
    }
    return JSON.parse(await body.text()) as unknown;
  }

  async appendLabEvents(accountId: string, value: unknown): Promise<DriveFile> {
    const client = await this.#accountClient(accountId);
    const content = await jsonBlob(value);
    return client.upload({ name: 'TAI Hub · Laboratorio ' + crypto.randomUUID(), mimeType: JSON_MIME,
      appProperties: { [APP_KEY]: 'labEvents' }, parents: [await this.#ensureFolder(client)] }, content);
  }

  async archiveLabEvents(accountId: string, files: Pick<DriveFile, 'id' | 'headRevisionId'>[]): Promise<void> {
    const client = await this.#accountClient(accountId);
    for (const reference of files) {
      const path = filePath(reference.id);
      const file = await client.json<DriveFile>(path, { fields: 'id,appProperties,ownedByMe,shared,trashed,headRevisionId' });
      if (!file.ownedByMe || file.shared || file.trashed || file.appProperties?.[APP_KEY] !== 'labEvents'
        || !reference.headRevisionId || file.headRevisionId !== reference.headRevisionId) continue;
      await client.json<DriveFile>(path, { fields: 'id,appProperties' }, jsonBody('PATCH', {
        appProperties: { [APP_KEY]: LAB_ARCHIVE },
      }));
    }
  }

  #client(): DriveClient {
    return new DriveClient(this.#session);
  }

  async #accountClient(accountId: string): Promise<DriveClient> {
    const client = this.#client();
    if ((await this.account()).id !== accountId) throw new Error('Vuelve a conectar la cuenta de Google de esta biblioteca.');
    client.signal.throwIfAborted();
    return client;
  }

  async #resourceFile(client: DriveClient, id: string): Promise<DriveFile> {
    const file = await client.json<DriveFile>(filePath(id), { fields: FILE_FIELDS });
    if (file.trashed || file.ownedByMe === false || file.appProperties?.[APP_KEY] !== 'resource') {
      throw new DriveError('El archivo ya no está disponible en TAI Hub.', 404);
    }
    return file;
  }

  #ensureFolder(client: DriveClient): Promise<string> {
    if (this.#folder?.signal === client.signal) return this.#folder.value;
    const value = this.#findOrCreateFolder(client).catch((error: unknown) => {
      if (this.#folder?.signal === client.signal) this.#folder = undefined;
      throw error;
    });
    this.#folder = { signal: client.signal, value };
    return value;
  }

  async #findOrCreateFolder(client: DriveClient): Promise<string> {
    const folder = firstCreated(await client.list(`${ROOT} and mimeType = '${FOLDER_MIME}'`));
    if (folder?.shared) throw new Error('Quita el acceso compartido de la carpeta de TAI Hub antes de añadir material privado.');
    if (folder) return folder.id;
    const { ids } = await client.json<{ ids: string[] }>('/files/generateIds', { count: '1', space: 'drive' });
    const created = await client.json<DriveFile>('/files', { fields: 'id' }, jsonBody('POST', {
      id: ids[0],
      name: 'TAI Hub · Biblioteca privada',
      mimeType: FOLDER_MIME,
      appProperties: { [APP_KEY]: 'library' },
    }));
    return created.id;
  }

  #getIndexes(client: DriveClient): Promise<DriveFile[]> {
    if (this.#indexList?.signal === client.signal && this.#indexList.validUntil > Date.now()) return this.#indexList.value;
    const value = client.list(INDEXES, 'id,name,mimeType,appProperties').catch((error: unknown) => {
      if (this.#indexList?.value === value) this.#indexList = undefined;
      throw error;
    });
    this.#indexList = { signal: client.signal, value, validUntil: Date.now() + 60_000 };
    return value;
  }
}

function virtualContents(draft: ResourceDraft): { title: string; url?: string; note?: string } {
  return { title: draft.title, url: draft.url, note: draft.note };
}

function revisionPath(id: string, revisionId: string): string {
  return filePath(id) + '/revisions/' + encodeURIComponent(revisionId);
}

async function checkPdf(file: File): Promise<void> {
  const header = await file.slice(0, 1024).text();
  if (!header.includes('%PDF-')) throw new Error('El archivo seleccionado no contiene una cabecera PDF.');
}
