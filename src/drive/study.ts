import type { PdfAnnotation } from '../pdf/model';
import { DriveError } from './client';
import type { DriveLibrary } from './library';

export type StudyPosition = {
  version: string;
  page: number;
  openedAt: string;
};

export type StudyState = {
  favorites: Record<string, boolean>;
  positions: Record<string, StudyPosition>;
  annotations: Record<string, Record<string, PdfAnnotation[]>>;
};

export type StudyPatch =
  | { kind: 'favorite'; resourceId: string; value: boolean }
  | { kind: 'position'; resourceId: string; value: StudyPosition }
  | { kind: 'annotation'; resourceId: string; version: string; annotationId: string; value: PdfAnnotation | null };

export type StudyOperation = { id: string; clock: number; patch: StudyPatch };
export type StudyStatus = 'idle' | 'pending' | 'syncing' | 'error';
type StudyReplica = { version: string; operations: StudyOperation[] };
type LocalStudy = { pending: StudyOperation[]; replicas: Record<string, StudyReplica> };

const EMPTY: LocalStudy = { pending: [], replicas: {} };
const DB_NAME = 'tai-hub-study-v1';
const STORE = 'accounts';

function entityKey({ patch }: StudyOperation): string {
  return patch.kind === 'annotation'
    ? JSON.stringify([patch.kind, patch.resourceId, patch.version, patch.annotationId])
    : JSON.stringify([patch.kind, patch.resourceId]);
}

function compare(a: StudyOperation, b: StudyOperation): number {
  return a.clock - b.clock || (a.id < b.id ? -1 : a.id === b.id ? 0 : 1);
}

export function mergeStudyOperations(...groups: StudyOperation[][]): StudyOperation[] {
  const entities = new Map<string, StudyOperation>();
  for (const group of groups) {
    for (const op of group) {
      const key = entityKey(op);
      const current = entities.get(key);
      if (!current || compare(current, op) < 0) entities.set(key, op);
    }
  }
  return [...entities.values()];
}

export function studyState(operations: StudyOperation[]): StudyState {
  const favorites: Record<string, boolean> = Object.create(null);
  const positions: Record<string, StudyPosition> = Object.create(null);
  const annotations: Record<string, Record<string, PdfAnnotation[]>> = Object.create(null);
  for (const { patch } of operations) {
    const { resourceId } = patch;
    if (patch.kind === 'favorite') favorites[resourceId] = patch.value;
    if (patch.kind === 'position') positions[resourceId] = patch.value;
    if (patch.kind === 'annotation' && patch.value) {
      const versions = annotations[resourceId] ??= Object.create(null);
      (versions[patch.version] ??= []).push(patch.value);
    }
  }
  for (const versions of Object.values(annotations)) {
    for (const entries of Object.values(versions)) entries.sort((a, b) => a.page - b.page || a.createdAt.localeCompare(b.createdAt));
  }
  return { favorites, positions, annotations };
}

function isStudyOperation(value: unknown): value is StudyOperation {
  if (!value || typeof value !== 'object') return false;
  const { id, clock, patch } = value as StudyOperation;
  if (typeof id !== 'string' || !Number.isSafeInteger(clock) || !patch || typeof patch.resourceId !== 'string') return false;
  if (patch.kind === 'favorite') return typeof patch.value === 'boolean';
  if (patch.kind === 'position') {
    return Boolean(patch.value && typeof patch.value.version === 'string' && Number.isSafeInteger(patch.value.page)
      && patch.value.page >= 0 && typeof patch.value.openedAt === 'string');
  }
  if (patch.kind === 'annotation') {
    return typeof patch.version === 'string' && typeof patch.annotationId === 'string'
      && (patch.value === null || Boolean(patch.value && patch.value.id === patch.annotationId
        && Number.isSafeInteger(patch.value.page) && patch.value.page >= 1
        && ['bookmark', 'note', 'highlight'].includes(patch.value.kind) && typeof patch.value.createdAt === 'string'));
  }
  return false;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function localStudy(accountId: string, update?: (state: LocalStudy) => LocalStudy): Promise<LocalStudy> {
  const database = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, update ? 'readwrite' : 'readonly');
      const store = transaction.objectStore(STORE);
      const request = store.get(accountId);
      let value: LocalStudy = EMPTY;
      request.onsuccess = () => {
        value = (request.result as LocalStudy | undefined) ?? EMPTY;
        if (update) {
          value = update(value);
          store.put(value, accountId);
        }
      };
      transaction.oncomplete = () => resolve(value);
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

export class StudySync {
  #library: DriveLibrary;
  #accountId: string;
  #writer = crypto.randomUUID();
  #writerFile?: string;
  #writerOperations: StudyOperation[] = [];
  #pending: StudyOperation[] = [];
  #replicas: Record<string, StudyReplica> = {};
  #state = studyState([]);
  #status: StudyStatus = 'idle';
  #listeners = new Set<() => void>();
  #clock = 0;
  #closed = false;
  #running?: Promise<void>;
  #scheduled?: number;
  #interval: number;

  constructor(library: DriveLibrary, accountId: string) {
    this.#library = library;
    this.#accountId = accountId;
    window.addEventListener('online', this.#backgroundRefresh);
    window.addEventListener('focus', this.#backgroundRefresh);
    document.addEventListener('visibilitychange', this.#onVisibility);
    this.#interval = window.setInterval(this.#onVisibility, 60_000);
  }

  snapshot = (): StudyState => this.#state;

  status = (): StudyStatus => this.#status;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  async apply(patch: StudyPatch): Promise<void> {
    if (this.#closed) return;
    this.#clock = Math.max(Date.now(), this.#clock + 1);
    const operation = { id: crypto.randomUUID(), clock: this.#clock, patch };
    this.#pending = mergeStudyOperations(this.#pending, [operation]);
    this.#publish('pending');
    await localStudy(this.#accountId, state => ({
      ...state,
      pending: mergeStudyOperations(state.pending, [operation]),
    })).catch(() => {
      // Use the in-memory queue when the browser denies IndexedDB.
    });
    this.#schedule();
  }

  refresh(): Promise<void> {
    if (this.#closed) return Promise.resolve();
    if (this.#running) return this.#running;
    this.#running = this.#synchronize().finally(() => { this.#running = undefined; });
    return this.#running;
  }

  close(): void {
    this.#closed = true;
    clearTimeout(this.#scheduled);
    clearInterval(this.#interval);
    window.removeEventListener('online', this.#backgroundRefresh);
    window.removeEventListener('focus', this.#backgroundRefresh);
    document.removeEventListener('visibilitychange', this.#onVisibility);
    this.#listeners.clear();
  }

  #schedule(): void {
    if (this.#closed) return;
    clearTimeout(this.#scheduled);
    this.#scheduled = window.setTimeout(() => {
      this.#scheduled = undefined;
      this.#backgroundRefresh();
    }, 1_200);
  }

  #onVisibility = (): void => {
    if (document.visibilityState === 'visible') this.#backgroundRefresh();
  };

  #backgroundRefresh = (): void => {
    void this.refresh().catch(() => {
      // Local changes remain queued and the UI can expose the sync state.
    });
  };

  async #synchronize(): Promise<void> {
    this.#publish('syncing');
    try {
      const cached = await localStudy(this.#accountId).catch(() => EMPTY);
      if (this.#closed) return;
      this.#replicas = { ...cached.replicas, ...this.#replicas };
      this.#pending = mergeStudyOperations(cached.pending, this.#pending);
      this.#publish('syncing');

      const files = await this.#library.listStudyFiles(this.#accountId);
      if (this.#closed) return;
      // Keep the last verified progress when a replica is missing or unreadable.
      const remote: Record<string, StudyReplica> = Object.assign(Object.create(null), this.#replicas);
      let unreadableReplica = false;
      for (let offset = 0; offset < files.length; offset += 6) {
        await Promise.all(files.slice(offset, offset + 6).map(async file => {
          const version = file.headRevisionId ?? file.modifiedTime ?? '';
          if (remote[file.id]?.version === version) return;
          try {
            const payload = await this.#library.readStudyFile<{ schema: number; operations: unknown }>(this.#accountId, file.id);
            if (payload?.schema === 1 && Array.isArray(payload.operations) && payload.operations.every(isStudyOperation)) {
              remote[file.id] = { version, operations: payload.operations };
            } else {
              unreadableReplica = true;
            }
          } catch (error) {
            if (!(error instanceof SyntaxError) && !(error instanceof DriveError && error.status === 404)) throw error;
            unreadableReplica = true;
          }
        }));
        if (this.#closed) return;
      }
      this.#replicas = remote;
      const sent = this.#pending;
      if (sent.length) {
        const operations = mergeStudyOperations(this.#writerOperations, sent);
        const file = await this.#library.writeStudyFile(this.#accountId, this.#writer, { schema: 1, operations }, this.#writerFile);
        if (this.#closed) return;
        this.#writerFile = file.id;
        this.#writerOperations = operations;
        this.#replicas[file.id] = { version: file.headRevisionId ?? file.modifiedTime ?? '', operations };
        const sentIds = new Set(sent.map(op => op.id));
        this.#pending = this.#pending.filter(op => !sentIds.has(op.id));
        await localStudy(this.#accountId, state => ({
          pending: state.pending.filter(op => !sentIds.has(op.id)),
          replicas: this.#replicas,
        })).catch(() => {});
      } else {
        await localStudy(this.#accountId, state => ({ ...state, replicas: this.#replicas })).catch(() => {});
      }
      if (this.#pending.length) this.#schedule();
      if (unreadableReplica) {
        throw new Error('No se pudieron leer todas las copias del progreso. Se conservan las últimas copias válidas.');
      }
      this.#publish(this.#pending.length ? 'pending' : 'idle');
    } catch (error) {
      this.#publish('error');
      throw error;
    }
  }

  #publish(status: StudyStatus): void {
    if (this.#closed) return;
    const operations = mergeStudyOperations(
      ...Object.values(this.#replicas).map(replica => replica.operations),
      this.#writerOperations,
      this.#pending,
    );
    for (const operation of operations) this.#clock = Math.max(this.#clock, operation.clock);
    this.#state = studyState(operations);
    this.#status = status;
    for (const listener of this.#listeners) listener();
  }
}
