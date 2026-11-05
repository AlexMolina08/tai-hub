import { afterEach, describe, expect, it, vi } from 'vitest';
import { DRIVE_SCOPE, GoogleSession, SessionExpiredError } from './auth';
import { DriveClient } from './client';
import { DriveLibrary } from './library';
import { mergeStudyOperations, studyState, StudySync } from './study';
import type { StudyOperation } from './study';

const CLIENT_ID = 'tai-hub-test.apps.googleusercontent.com';
const TEST_TOKEN = 'mock-access-token';
const MEBIBYTE = 1024 * 1024;

function mockGoogle(response?: { scope?: string; error?: string }) {
  const request = vi.fn();
  const init = vi.fn((config: {
    callback: (result: { scope?: string; error?: string; access_token: string; expires_in: number }) => void;
  }) => ({
    requestAccessToken: (options: unknown) => {
      request(options);
      config.callback({ scope: DRIVE_SCOPE, access_token: TEST_TOKEN, expires_in: 3600, ...response });
    },
  }));
  vi.stubGlobal('window', { setTimeout, google: { accounts: { oauth2: { initTokenClient: init } } } });
  return { init, request };
}

const sessions: GoogleSession[] = [];
function newSession() {
  const session = new GoogleSession(CLIENT_ID);
  sessions.push(session);
  return session;
}

async function connectedSession() {
  mockGoogle();
  const session = newSession();
  await session.prepare();
  await session.connect();
  return session;
}

afterEach(() => {
  for (const session of sessions.splice(0)) session.disconnect();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Google OAuth', () => {
  it('opens Google synchronously with per-file permissions and clears credentials on disconnect', async () => {
    const { init, request } = mockGoogle();
    const session = newSession();
    await session.prepare();
    const connecting = session.connect();
    expect(request).toHaveBeenCalledWith({ prompt: 'select_account', include_granted_scopes: false });
    expect(init).toHaveBeenCalledWith(expect.objectContaining({ scope: DRIVE_SCOPE, include_granted_scopes: false }));
    await connecting;
    const access = session.access();
    expect(access.token).toBe(TEST_TOKEN);
    session.disconnect();
    expect(access.signal.aborted).toBe(true);
    expect(() => session.access()).toThrow(SessionExpiredError);
  });

  it('rejects authorization when the user declines the Drive scope', async () => {
    mockGoogle({ scope: 'openid' });
    const session = newSession();
    await session.prepare();
    await expect(session.connect()).rejects.toThrow('Autoriza el acceso');
    expect(() => session.access()).toThrow(SessionExpiredError);
  });

  it('expires on HTTP 401 and renews from a later click', async () => {
    const session = await connectedSession();
    session.rememberAccount('account@example.test');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })));
    await expect(new DriveClient(session).json('/about')).rejects.toThrow(SessionExpiredError);
    expect(session.snapshot().status).toBe('expired');
    await session.connect();
    expect(session.snapshot().status).toBe('connected');
  });
});

describe('Drive media', () => {
  it('uploads large files by chunks and resumes from Drive’s acknowledged range', async () => {
    vi.useFakeTimers();
    const session = await connectedSession();
    const file = new Blob([new Uint8Array(10 * MEBIBYTE)], { type: 'video/mp4' });
    const sessionAddress = 'https://www.googleapis.com/upload/drive/v3/files?upload_id=fake';
    const ranges: string[] = [];
    const request = vi.fn(async (input: string, init: RequestInit) => {
      const address = new URL(input);
      const headers = new Headers(init.headers);
      if (address.pathname.endsWith('/generateIds')) return Response.json({ ids: ['generated-id'] });
      if (init.method === 'POST') {
        expect(headers.get('Authorization')).toBe('Bearer ' + TEST_TOKEN);
        expect(JSON.parse(String(init.body)).id).toBe('generated-id');
        return new Response(null, { headers: { Location: sessionAddress } });
      }
      expect(headers.has('Authorization')).toBe(false);
      const range = headers.get('Content-Range') ?? '';
      ranges.push(range);
      if (ranges.length === 1) throw new TypeError('connection interrupted');
      if (ranges.length === 2) return new Response(null, { status: 308, headers: { Range: 'bytes=0-1048575' } });
      if (ranges.length === 3) {
        expect((init.body as Blob).size).toBe(8 * MEBIBYTE);
        return new Response(null, { status: 308, headers: { Range: 'bytes=0-9437183' } });
      }
      expect((init.body as Blob).size).toBe(MEBIBYTE);
      return Response.json({ id: 'generated-id', size: String(file.size) });
    });
    vi.stubGlobal('fetch', request);
    const progress = vi.fn();
    const upload = new DriveClient(session).upload({ name: 'synthetic.mp4' }, file, undefined, progress);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(upload).resolves.toMatchObject({ id: 'generated-id' });
    expect(ranges).toEqual([
      'bytes 0-8388607/10485760',
      'bytes */10485760',
      'bytes 1048576-9437183/10485760',
      'bytes 9437184-10485759/10485760',
    ]);
    expect(progress).toHaveBeenLastCalledWith(file.size, file.size);
  });

  it('recovers a pinned replacement when its final response is lost', async () => {
    const session = await connectedSession();
    const content = new Blob(['%PDF-1.7'], { type: 'application/pdf' });
    let writeMarker = '';
    vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit) => {
      const address = new URL(input);
      if (init.method === 'PATCH') {
        expect(address.searchParams.get('keepRevisionForever')).toBe('true');
        const requestBody = await (init.body as Blob).text();
        const properties = JSON.parse(requestBody.split('\r\n\r\n')[1].split('\r\n--')[0]).appProperties;
        writeMarker = properties.taiHubReplacement;
        expect(properties.taiHub).toBe('resource');
        expect(writeMarker).toBeTruthy();
        throw new TypeError('connection interrupted');
      }
      expect(address.pathname).toBe('/drive/v3/files/private-file-id');
      return Response.json({
        id: 'private-file-id',
        size: String(content.size),
        appProperties: { taiHub: 'resource', taiHubReplacement: writeMarker },
      });
    }));
    const result = await new DriveClient(session).upload(
      { appProperties: { taiHub: 'resource' } },
      content,
      'private-file-id',
      undefined,
      true,
    );
    expect(result.id).toBe('private-file-id');
  });

  it('opens private PDF bytes with a bearer header, not a credential in the URL', async () => {
    const session = await connectedSession();
    const source = new DriveLibrary(session).pdfSource('private-file-id');
    expect(source.url).toBe('https://www.googleapis.com/drive/v3/files/private-file-id?alt=media');
    expect(source.httpHeaders.Authorization).toBe('Bearer ' + TEST_TOKEN);
    expect(source.url).not.toContain(TEST_TOKEN);
  });

  it('keeps the PDF content version stable after updating metadata', async () => {
    const session = await connectedSession();
    const original = {
      id: 'file',
      name: 'synthetic.pdf',
      mimeType: 'application/pdf',
      size: '1024',
      modifiedTime: '2026-11-05T10:00:00Z',
      md5Checksum: 'content-checksum',
      appProperties: { taiHub: 'resource' },
    };
    vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit) => {
      if (init.method === 'PATCH') {
        const metadata = JSON.parse(String(init.body));
        return Response.json({ ...original, ...metadata, modifiedTime: '2026-11-05T11:00:00Z' });
      }
      if (new URL(input).pathname.endsWith('/files')) return Response.json({ files: [original] });
      return Response.json(original);
    }));
    const library = new DriveLibrary(session);
    const [before] = await library.list();
    const after = await library.update(before.id, { ...before, title: 'Ejemplo', tags: ['revisión'] });
    expect(after.title).toBe('Ejemplo');
    expect(after.tags).toEqual(['revisión']);
    expect(after.version).toBe(before.version);
    expect(after.modifiedTime).not.toBe(before.modifiedTime);
  });

  it('refuses to read a large preview before fetching the media', async () => {
    const session = await connectedSession();
    const request = vi.fn(async () => Response.json({
      id: 'large-file',
      name: 'video.mp4',
      mimeType: 'video/mp4',
      size: String(40 * MEBIBYTE),
      appProperties: { taiHub: 'resource' },
    }));
    vi.stubGlobal('fetch', request);
    await expect(new DriveLibrary(session).readBlob('large-file', 16 * MEBIBYTE)).rejects.toThrow('previsualizarlo');
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('Study synchronization', () => {
  it('merges concurrent entities and keeps deleted annotations deleted', () => {
    const resourceId = 'sample';
    const version = 'revision-1';
    const a: StudyOperation[] = [
      { id: 'a1', clock: 1, patch: { kind: 'favorite', resourceId, value: true } },
      { id: 'a2', clock: 2, patch: { kind: 'annotation', resourceId, version, annotationId: 'a-note', value: {
        id: 'a-note', kind: 'note', text: 'Nota sintética', createdAt: '2026-11-05T09:00:00Z', page: 1,
      } } },
      { id: 'a3', clock: 5, patch: { kind: 'annotation', resourceId, version, annotationId: 'a-note', value: null } },
    ];
    const b: StudyOperation[] = [
      { id: 'b1', clock: 3, patch: { kind: 'annotation', resourceId, version, annotationId: 'b-bookmark', value: {
        id: 'b-bookmark', kind: 'bookmark', createdAt: '2026-11-05T09:10:00Z', page: 3,
      } } },
      { id: 'b2', clock: 4, patch: { kind: 'position', resourceId, value: {
        version, openedAt: '2026-11-05T09:10:00Z', page: 3,
      } } },
    ];
    const fromBoth = studyState(mergeStudyOperations(a, b));
    expect(studyState(mergeStudyOperations(b, a, b))).toEqual(fromBoth);
    expect(fromBoth.favorites[resourceId]).toBe(true);
    expect(fromBoth.positions[resourceId].page).toBe(3);
    expect(fromBoth.annotations[resourceId][version].map(annotation => annotation.id)).toEqual(['b-bookmark']);
  });

  it('syncs two sessions and retries local edits after a connection failure', async () => {
    const browser = Object.assign(new EventTarget(), { setTimeout, setInterval });
    const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    vi.stubGlobal('window', browser);
    vi.stubGlobal('document', document);
    vi.stubGlobal('indexedDB', undefined);
    const remote = new Map<string, { payload: unknown; version: string }>();
    let offline = false;
    const drive = {
      async listStudyFiles() {
        if (offline) throw new Error('network offline');
        return [...remote].map(([id, state]) => ({ id, headRevisionId: state.version }));
      },
      async readStudyFile(_accountId: string, id: string) {
        return remote.get(id)?.payload;
      },
      async writeStudyFile(_accountId: string, writer: string, payload: unknown) {
        const version = crypto.randomUUID();
        remote.set(writer, { payload, version });
        return { id: writer, headRevisionId: version };
      },
    } as unknown as DriveLibrary;
    const mac = new StudySync(drive, 'account-id');
    const iphone = new StudySync(drive, 'account-id');
    try {
      offline = true;
      await mac.apply({ kind: 'favorite', resourceId: 'pdf', value: true });
      await expect(mac.refresh()).rejects.toThrow('network offline');
      expect(mac.snapshot().favorites.pdf).toBe(true);
      expect(mac.status()).toBe('error');
      offline = false;
      await mac.refresh();
      await iphone.refresh();
      expect(iphone.snapshot().favorites.pdf).toBe(true);
      await iphone.apply({ kind: 'position', resourceId: 'pdf', value: {
        version: 'first', page: 17, openedAt: '2026-11-05T09:10:00Z',
      } });
      await iphone.refresh();
      await mac.refresh();
      expect(mac.snapshot().positions.pdf.page).toBe(17);
      expect(mac.snapshot().favorites.pdf).toBe(true);
      expect(mac.status()).toBe('idle');
    } finally {
      mac.close();
      iphone.close();
    }
  });
});
