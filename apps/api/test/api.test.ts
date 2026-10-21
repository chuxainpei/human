// HTTP 层测试：用可控的假模型验证取消、陈旧请求、并发、错误路径与访问隔离（真实模型的端到端见 tools/scripts/api_e2e.py）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadConfig } from '../src/config.js'
import { buildApp } from '../src/app.js'
import { LlmError, type LlmProvider } from '../src/llm.js'

function fakeLlm(opts: { delayMs?: number; fail?: boolean; text?: string } = {}): LlmProvider {
  const wait = (ms: number, signal: AbortSignal) => new Promise<void>((res, rej) => { const t = setTimeout(res, ms); signal.addEventListener('abort', () => { clearTimeout(t); rej(new LlmError('CANCELLED')) }, { once: true }) })
  return {
    name: 'fake', model: 'fake',
    async stream(_m, o, onDelta) { if (opts.fail) throw new LlmError('UPSTREAM_UNAVAILABLE'); const t = opts.text ?? '毛利率 = 毛利 ÷ 销售收入 [F-QUOTE-01]'; for (const ch of t.match(/.{1,4}/g)!) { await wait(opts.delayMs ?? 5, o.signal); onDelta(ch) } return { text: t } },
    async complete(_m, o) { if (opts.fail) throw new LlmError('UPSTREAM_UNAVAILABLE'); await wait(opts.delayMs ?? 5, o.signal); return { text: opts.text ?? '价格还是偏高，请再低一点。' } },
    async probe() { return { ok: !opts.fail, checkedAt: new Date().toISOString(), detail: 'fake' } },
  }
}
const fakeTts = { name: 'fake', voice: 'x', async synth() { return Buffer.alloc(1000) }, async probe() { return { ok: true, checkedAt: new Date().toISOString(), detail: 'fake' } } }

async function setup(llm: LlmProvider) {
  const app = buildApp({ ...loadConfig({}), basePath: '/human' }, { llm, tts: fakeTts })
  await app.ready()
  const r = await app.inject({ method: 'POST', url: '/human/api/sessions', payload: {} })
  const cookie = String(r.headers['set-cookie']).split(';')[0]
  return { app, sid: r.json().id as string, cookie }
}
const parseSse = (body: string) => body.split('\n\n').filter(Boolean).map((b) => ({ event: b.split('\n')[0].slice(7), data: JSON.parse(b.split('\n')[1].slice(6)) }))

test('ask returns SSE delta + done with validated citations', async () => {
  const { app, sid, cookie } = await setup(fakeLlm())
  const r = await app.inject({ method: 'POST', url: `/human/api/sessions/${sid}/turns`, headers: { cookie }, payload: { requestId: 'a1', intent: 'ask', text: '毛利率怎么算' } })
  const ev = parseSse(r.body)
  assert.ok(ev.some((e) => e.event === 'delta'))
  const done = ev.find((e) => e.event === 'done')!.data
  assert.equal(done.requestId, 'a1'); assert.deepEqual(done.citations.map((c: { id: string }) => c.id), ['F-QUOTE-01'])
})

test('model failure yields an honest error event, not a canned answer', async () => {
  const { app, sid, cookie } = await setup(fakeLlm({ fail: true }))
  const r = await app.inject({ method: 'POST', url: `/human/api/sessions/${sid}/turns`, headers: { cookie }, payload: { requestId: 'e1', intent: 'ask', text: '毛利率怎么算' } })
  const ev = parseSse(r.body)
  assert.equal(ev.length, 1); assert.equal(ev[0].event, 'error'); assert.equal(ev[0].data.code, 'UPSTREAM_UNAVAILABLE')
  const cap = await app.inject({ method: 'GET', url: '/human/api/capabilities' })
  assert.equal(cap.json().liveChat, false)
})

test('cancel aborts the active generation; a second concurrent request is BUSY', async () => {
  const { app, sid, cookie } = await setup(fakeLlm({ delayMs: 80, text: '一二三四五六七八九十一二三四五六七八九十' }))
  const p = app.inject({ method: 'POST', url: `/human/api/sessions/${sid}/turns`, headers: { cookie }, payload: { requestId: 'slow', intent: 'ask', text: '毛利率' } })
  await new Promise((r) => setTimeout(r, 120))
  const busy = await app.inject({ method: 'POST', url: `/human/api/sessions/${sid}/turns`, headers: { cookie }, payload: { requestId: 'other', intent: 'ask', text: '再问' } })
  assert.equal(busy.statusCode, 409); assert.equal(busy.json().code, 'BUSY')
  const c = await app.inject({ method: 'POST', url: `/human/api/sessions/${sid}/cancel`, headers: { cookie }, payload: { requestId: 'slow' } })
  assert.equal(c.json().cancelled, true)
  const ev = parseSse((await p).body)
  assert.equal(ev.at(-1)!.event, 'error'); assert.equal(ev.at(-1)!.data.code, 'CANCELLED')
  assert.ok(!ev.some((e) => e.event === 'done'))
  const again = await app.inject({ method: 'POST', url: `/human/api/sessions/${sid}/cancel`, headers: { cookie }, payload: { requestId: 'slow' } })
  assert.equal(again.json().cancelled, false) // 重复取消安全
})

test('state machine: negotiate before practice is rejected; final offer needed before finish', async () => {
  const { app, sid, cookie } = await setup(fakeLlm())
  const n = await app.inject({ method: 'POST', url: `/human/api/sessions/${sid}/turns`, headers: { cookie }, payload: { requestId: 'n1', intent: 'negotiate', text: '12.5 美元' } })
  assert.equal(n.statusCode, 409)
  await app.inject({ method: 'POST', url: `/human/api/sessions/${sid}/actions`, headers: { cookie }, payload: { action: 'startPractice' } })
  const f = await app.inject({ method: 'POST', url: `/human/api/sessions/${sid}/actions`, headers: { cookie }, payload: { action: 'finishPractice' } })
  assert.equal(f.statusCode, 409)
  const bad = await app.inject({ method: 'POST', url: `/human/api/sessions/${sid}/final-offer`, headers: { cookie }, payload: { unitPriceCents: 0, quantity: 500, depositBasisPoints: 3000, leadDays: 20 } })
  assert.equal(bad.statusCode, 400); assert.equal(bad.json().error, 'INVALID_PRICE')
})

test('empty dialogue is never rated: feedback says evidence insufficient', async () => {
  const { app, sid, cookie } = await setup(fakeLlm())
  await app.inject({ method: 'POST', url: `/human/api/sessions/${sid}/actions`, headers: { cookie }, payload: { action: 'startPractice' } })
  await app.inject({ method: 'POST', url: `/human/api/sessions/${sid}/final-offer`, headers: { cookie }, payload: { unitPriceCents: 1250, quantity: 500, depositBasisPoints: 3000, leadDays: 20 } })
  const rep = (await app.inject({ method: 'GET', url: `/human/api/sessions/${sid}/report`, headers: { cookie } })).json()
  assert.equal(rep.evidenceStatus, 'insufficient')
  assert.ok(rep.feedback.dimensions.every((d: { status: string }) => d.status === 'not_observed'))
})

test('another browser (no cookie / other cookie) cannot read the report', async () => {
  const { app, sid } = await setup(fakeLlm())
  const other = await app.inject({ method: 'POST', url: '/human/api/sessions', payload: {} })
  const otherCookie = String(other.headers['set-cookie']).split(';')[0]
  assert.equal((await app.inject({ method: 'GET', url: `/human/api/sessions/${sid}/report` })).statusCode, 404)
  assert.equal((await app.inject({ method: 'GET', url: `/human/api/sessions/${sid}/report`, headers: { cookie: otherCookie } })).statusCode, 404)
})

test('course API exposes no hidden constraints', async () => {
  const { app } = await setup(fakeLlm())
  const body = (await app.inject({ method: 'GET', url: '/human/api/courses/trade-quote-unit-v1' })).body
  assert.ok(!body.includes('serverOnly') && !body.includes('buyerMaximum') && !body.includes('1280'))
})
