import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openRangePdf, pdfAccessDenied } from './range'

const pdfjs = vi.hoisted(() => ({
  getDocument: vi.fn(),
  data: vi.fn(),
  destroy: vi.fn(),
}))
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  getDocument: pdfjs.getDocument,
  PDFDataRangeTransport: class {
    constructor(readonly length: number, readonly initialData: Uint8Array) {}
    onDataRange = pdfjs.data
  },
}))

const url = 'https://example.test/document'
const headers = { Authorization: 'Bearer fixture-value' }
const options = { url, httpHeaders: headers, rangeChunkSize: 4 }
const onFailure = vi.fn()
const fetchStub = vi.fn()

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('fetch', fetchStub)
  pdfjs.destroy.mockResolvedValue(undefined)
  pdfjs.getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 3 }), destroy: pdfjs.destroy })
})

afterEach(() => vi.unstubAllGlobals())

describe('partial PDF delivery', () => {
  it('accepts exactly sized 206 bodies with Content-Range hidden by CORS', async () => {
    fetchStub.mockResolvedValueOnce(partial([1, 2, 3, 4])).mockResolvedValueOnce(partial([5, 6, 7, 8]))
    const load = openRangePdf(url, headers, 12, options, onFailure)
    await load.promise
    const init = pdfjs.getDocument.mock.calls[0][0]
    expect(init).toMatchObject({ disableAutoFetch: true, disableStream: true,
      range: { length: 12, initialData: Uint8Array.of(1, 2, 3, 4) } })
    init.range.requestDataRange(4, 8)
    await vi.waitFor(() => expect(pdfjs.data).toHaveBeenCalledWith(4, Uint8Array.of(5, 6, 7, 8)))
    expect(fetchStub.mock.calls.map(([, { headers: requestHeaders }]) => requestHeaders.get('Range')))
      .toEqual(['bytes=0-3', 'bytes=4-7'])
    expect(fetchStub.mock.calls[1][1].headers.get('Authorization')).toBe(headers.Authorization)
    await load.destroy()
  })

  it('cancels a server response that ignored Range before starting normal streaming', async () => {
    const cancel = vi.fn()
    fetchStub.mockResolvedValueOnce(new Response(new ReadableStream({ cancel })))
    const load = openRangePdf(url, headers, 12, options, onFailure)
    await load.promise
    expect(cancel).toHaveBeenCalledOnce()
    expect(pdfjs.getDocument).toHaveBeenCalledExactlyOnceWith(options)
    expect(onFailure).not.toHaveBeenCalled()
    await load.destroy()
  })

  it('releases the range loader and signals recovery after a malformed later chunk', async () => {
    fetchStub.mockResolvedValueOnce(partial([1, 2, 3, 4])).mockResolvedValueOnce(partial([5, 6]))
    const load = openRangePdf(url, headers, 12, options, onFailure)
    await load.promise
    pdfjs.getDocument.mock.calls[0][0].range.requestDataRange(4, 8)
    await vi.waitFor(() => expect(onFailure).toHaveBeenCalledOnce())
    expect(pdfjs.data).not.toHaveBeenCalled()
    await load.destroy()
    expect(pdfjs.destroy).toHaveBeenCalledOnce()
  })

  it('reports expired access without attempting another download', async () => {
    fetchStub.mockResolvedValueOnce(new Response(null, { status: 401 }))
    const load = openRangePdf(url, headers, 12, options, onFailure)
    const failure = await load.promise.catch(error => error)
    expect(pdfAccessDenied(failure)).toBe(true)
    expect(pdfjs.getDocument).not.toHaveBeenCalled()
    await load.destroy()
  })
})

function partial(bytes: number[]) {
  return new Response(Uint8Array.from(bytes), { status: 206 })
}
