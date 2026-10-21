// 自建课程 API 客户端：普通 JSON + SSE（delta/done/error），每个请求带 requestId。
export const API = `${import.meta.env.BASE_URL}api`

export interface Citation { id: string; title: string; text: string; sourceType: string; sourceUrl: string | null; locator: string; quote: string | null }
export interface Turn { turnId: string; role: 'student' | 'teacher' | 'buyer' | 'system'; stage: string; kind: string; text: string; citations?: Citation[]; at: string; insufficient?: boolean }
export interface SessionView {
  id: string; stage: Stage; paused: boolean; ended: boolean; role: 'teacher' | 'buyer'; turns: Turn[]
  practice: { rounds: number; startedAt: string | null }; finalOfferSubmitted: boolean; explainedCards: string[]
  retry: { type: string; reason: string; question: string; submitted: boolean; result: null | { correct: boolean; details: string[]; feedback: string } } | null
}
export type Stage = 'intro' | 'explain' | 'practice' | 'feedback' | 'retry' | 'done'
export class ApiError extends Error { constructor(public status: number, public code: string, msg: string) { super(msg) } }

async function j<T>(method: string, path: string, body?: unknown): Promise<T> {
  let r: Response
  try {
    r = await fetch(API + path, { method, credentials: 'same-origin', headers: body !== undefined ? { 'content-type': 'application/json' } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined })
  } catch { throw new ApiError(0, 'NETWORK', '网络连接失败，请检查网络后重试') }
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new ApiError(r.status, data.code ?? 'ERROR', data.message ?? `请求失败（${r.status}）`)
  return data as T
}
export const api = {
  capabilities: (refresh = false) => j<Record<string, any>>('GET', `/capabilities${refresh ? '?refresh=1' : ''}`),
  course: (id: string) => j<Record<string, any>>('GET', `/courses/${id}`),
  createSession: () => j<SessionView>('POST', '/sessions', {}),
  session: (id: string) => j<SessionView>('GET', `/sessions/${id}`),
  action: (id: string, action: string) => j<SessionView>('POST', `/sessions/${id}/actions`, { action }),
  cancel: (id: string, requestId?: string) => j<{ cancelled: boolean }>('POST', `/sessions/${id}/cancel`, { requestId }),
  finalOffer: (id: string, body: Record<string, unknown>) => j<Record<string, any>>('POST', `/sessions/${id}/final-offer`, body),
  report: (id: string) => j<Record<string, any>>('GET', `/sessions/${id}/report`),
  regenerateFeedback: (id: string) => j<Record<string, any>>('POST', `/sessions/${id}/feedback/regenerate`),
  remove: (id: string) => j<unknown>('DELETE', `/sessions/${id}`),
}

const LIVE = new Set<ReadableStreamDefaultReader<Uint8Array>>()
export interface StreamHandlers { onDelta?: (t: string) => void; onDone: (d: any) => void; onError: (code: string, msg: string) => void }
/** POST 后读取 SSE。处理跨分块、无 done 断流、重复结束和中止。 */
export async function sse(path: string, body: Record<string, unknown>, signal: AbortSignal, h: StreamHandlers) {
  let finished = false
  // 回调里的异常不能打断读流（否则连接被浏览器中止）；记到控制台即可
  const finish = (fn: () => void) => { if (finished) return; finished = true; try { fn() } catch (e) { console.error('[sse handler]', e) } }
  let r: Response
  try {
    r = await fetch(API + path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal })
  } catch (e) {
    return finish(() => h.onError(signal.aborted ? 'CANCELLED' : 'NETWORK', signal.aborted ? '已停止' : '网络连接失败'))
  }
  if (!r.ok || !r.body) {
    const d = await r.json().catch(() => ({}))
    return finish(() => h.onError(d.code ?? 'ERROR', d.message ?? `请求失败（${r.status}）`))
  }
  const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = ''
  LIVE.add(reader) // 保持强引用：只被挂起的 async 帧引用的读流可能被回收，浏览器会把请求记为中止
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let i: number
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2)
        const ev = /^event: (.+)$/m.exec(block)?.[1]; const data = /^data: (.+)$/m.exec(block)?.[1]
        if (!ev || !data) continue
        const d = JSON.parse(data)
        if (ev === 'delta') { if (!finished) { try { h.onDelta?.(d.text) } catch (e) { console.error('[sse delta]', e) } } }
        else if (ev === 'done') finish(() => h.onDone(d))
        else if (ev === 'error') finish(() => h.onError(d.code, d.message))
      }
    }
  } catch {
    return finish(() => h.onError(signal.aborted ? 'CANCELLED' : 'STREAM_BROKEN', signal.aborted ? '已停止' : '连接中断，回复不完整'))
  } finally { LIVE.delete(reader) }
  finish(() => h.onError('STREAM_BROKEN', '连接中断，没有收到完整回复'))
}

export const newRequestId = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`)
