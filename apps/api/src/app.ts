import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import cookie from '@fastify/cookie'
import fastifyStatic from '@fastify/static'
import { existsSync } from 'node:fs'
import type { Config } from './config.js'
import { loadCourse, publicCourse, type CoursePack, type Offer } from './content.js'
import { withOutputRules } from './output-rules.js'
import { LlmError, openAiCompatible, type LlmProvider, type Msg } from './llm.js'
import { edgeTts, type TtsProvider } from './tts.js'
import { ACTIONS, addTurn, publicSession, SessionStore, type Session } from './sessions.js'
import { checkOffer, claimsTeacher, leaksHidden, parseOfferText, pct, usd, validateOffer } from './rules.js'
import * as T from './teach.js'

export interface Deps { llm?: LlmProvider; tts?: TtsProvider; course?: CoursePack }

type Code = 'BAD_INPUT' | 'NOT_FOUND' | 'BAD_STATE' | 'BUSY' | 'RATE_LIMITED' | 'UPSTREAM_UNAVAILABLE' | 'TIMEOUT' | 'NOT_CONFIGURED' | 'CANCELLED' | 'NO_BALANCE'
const MSG: Record<Code, string> = {
  BAD_INPUT: '输入无效', NOT_FOUND: '会话不存在或已过期，请重新开始', BAD_STATE: '当前阶段不能执行这个操作', BUSY: '上一条回复还在生成，请先停止或稍候',
  RATE_LIMITED: '当前使用人数较多，请稍后再试', UPSTREAM_UNAVAILABLE: '模型服务暂时不可用，请稍后重试', TIMEOUT: '模型响应超时，请重试', NOT_CONFIGURED: '模型服务未配置', NO_BALANCE: '大模型账户余额不足，需管理员充值后才能对话', CANCELLED: '已停止生成',
}
const send = (reply: FastifyReply, status: number, code: Code, requestId: string | null = null) => reply.code(status).send({ requestId, code, message: MSG[code] })

export function buildApp(cfg: Config, deps: Deps = {}) {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info', redact: ['req.headers.cookie', 'req.headers.authorization'] }, bodyLimit: 64 * 1024 })
  const course = deps.course ?? loadCourse(cfg.contentFile)
  const k = course.cases[0]
  const llm = withOutputRules(deps.llm ?? openAiCompatible(cfg.llm))
  const tts = deps.tts ?? edgeTts(cfg.tts)
  const store = new SessionStore(cfg.limits.sessionTtlMs, cfg.limits.maxSessions)
  let genActive = 0
  let llmHealth: Awaited<ReturnType<LlmProvider['probe']>> | null = null
  let ttsHealth: Awaited<ReturnType<TtsProvider['probe']>> | null = null
  const P = `${cfg.basePath}/api`
  const COOKIE = 'tam_sid'

  app.register(cookie)
  if (cfg.webDist && existsSync(cfg.webDist)) {
    app.register(fastifyStatic, { root: cfg.webDist, prefix: `${cfg.basePath}/`, index: ['index.html'], wildcard: true, setHeaders: (res, file) => { if (file.endsWith('.html')) res.setHeader('cache-control', 'no-cache') } })
    app.setNotFoundHandler((req, reply) => {
      // 首页是 dist/index.html（静态）；其余应用路由（/learn、/report…）交给 Vue 应用 app.html。带扩展名的缺失文件仍返回 404。
      const path = req.url.split('?')[0]
      if (path.startsWith(`${cfg.basePath}/`) && !path.startsWith(P) && !path.startsWith(`${cfg.basePath}/assets/`) && !path.startsWith(`${cfg.basePath}/home/`) && !/\.[a-z0-9]+$/i.test(path) && req.method === 'GET') return reply.header('cache-control', 'no-cache').sendFile('app.html')
      return reply.code(404).send({ code: 'NOT_FOUND' })
    })
  }

  function sess(req: FastifyRequest<{ Params: { id: string } }>): Session | null { return store.get(req.params.id, req.cookies[COOKIE]) }

  // ---------- 能力：真实探测，不以环境变量存在判在线 ----------
  app.get(`${P}/capabilities`, async (req) => {
    const fresh = (h: { checkedAt: string } | null, ms: number) => h && Date.now() - Date.parse(h.checkedAt) < ms
    const force = (req.query as { refresh?: string }).refresh === '1'
    // 成功缓存 60s/300s；失败只缓存 10s，并立即重试一次（避免一次网络抖动让页面长时间显示“不可用”）
    const ttl = (h: { ok: boolean } | null, okMs: number) => (h && !h.ok ? 10_000 : okMs)
    const probeLlm = async () => { let h = await llm.probe(); if (!h.ok) { await new Promise((r) => setTimeout(r, 800)); h = await llm.probe() } return h }
    await Promise.all([
      (force || !fresh(llmHealth, ttl(llmHealth, 60_000))) ? probeLlm().then((h) => { llmHealth = h }) : null,
      (force || !fresh(ttsHealth, ttl(ttsHealth, 300_000))) ? tts.probe().then((h) => { ttsHealth = h }) : null,
    ])
    const lh = llmHealth!, th = ttsHealth!
    return {
      liveChat: lh.ok, ttsMode: th.ok ? 'server-edge' : 'browser-fallback', voiceInput: false, avatarMode: 'photo-2.5d-audio-driven',
      providerStatus: { llm: { provider: llm.name, model: llm.model, ...lh }, tts: { provider: tts.name, voice: tts.voice, ...th } },
      contentVersion: course.version, reviewStatus: course.reviewStatus,
    }
  })
  app.get(`${P}/health`, async () => ({ ok: true, sessions: store.size(), genActive }))

  app.get<{ Params: { id: string } }>(`${P}/courses/:id`, async (req, reply) => req.params.id === course.courseId ? publicCourse(course) : send(reply, 404, 'NOT_FOUND'))

  app.post(`${P}/sessions`, async (_req, reply) => {
    const s = store.create()
    reply.setCookie(COOKIE, s.owner, { httpOnly: true, sameSite: 'lax', path: cfg.basePath || '/', secure: cfg.cookieSecure, maxAge: cfg.limits.sessionTtlMs / 1000 })
    return publicSession(s)
  })
  app.get<{ Params: { id: string } }>(`${P}/sessions/:id`, async (req, reply) => { const s = sess(req); return s ? publicSession(s) : send(reply, 404, 'NOT_FOUND') })
  app.delete<{ Params: { id: string } }>(`${P}/sessions/:id`, async (req, reply) => { const s = sess(req); if (!s) return send(reply, 404, 'NOT_FOUND'); store.delete(s.id); reply.clearCookie(COOKIE, { path: cfg.basePath || '/' }); return { deleted: true } })

  // ---------- 阶段动作：服务端状态机 ----------
  app.post<{ Params: { id: string }; Body: { action?: string } }>(`${P}/sessions/:id/actions`, async (req, reply) => {
    const s = sess(req); if (!s) return send(reply, 404, 'NOT_FOUND')
    const action = req.body?.action ?? ''
    const rule = ACTIONS[action]; if (!rule) return send(reply, 400, 'BAD_INPUT')
    if (!rule.from.includes(s.stage) || (s.ended && action !== 'restartPractice')) return send(reply, 409, 'BAD_STATE')
    if (action === 'finishPractice' && !s.finalOffer) return reply.code(409).send({ code: 'BAD_STATE', message: '请先提交结构化的最终方案，系统才能核算' })
    if (action === 'pause') { s.paused = true; s.active?.ctrl.abort('CANCELLED'); return publicSession(s) }
    if (action === 'resume') { s.paused = false; return publicSession(s) }
    s.active?.ctrl.abort('CANCELLED')
    if (action === 'end') { s.ended = true; s.stage = 'done'; s.paused = false; return publicSession(s) }
    if (s.paused) return reply.code(409).send({ code: 'BAD_STATE', message: '学习已暂停，请先继续' })
    if (action === 'startPractice' || action === 'restartPractice') {
      s.stage = 'practice'; s.ended = false; s.practice = { rounds: 0, parsed: {}, startedAt: new Date().toISOString() }
      s.finalOffer = undefined; s.check = undefined; s.feedback = undefined; s.studentMarginError = undefined
      if (action === 'restartPractice') addTurn(s, { role: 'system', kind: 'divider', text: '—— 重新开始一轮磋商，上一轮记录保留在上方 ——' })
      addTurn(s, { role: 'buyer', kind: 'opening', text: action === 'restartPractice' ? '好，我们重新谈一次。还是 500 件样品，请把单价、首付款和交期重新报给我。' : k.studentVisible.openingBuyerMessage })
      return publicSession(s)
    }
    if (action === 'retry') { s.stage = 'retry'; return publicSession(s) }
    if (rule.to) s.stage = rule.to
    return publicSession(s)
  })

  app.post<{ Params: { id: string }; Body: { requestId?: string } }>(`${P}/sessions/:id/cancel`, async (req, reply) => {
    const s = sess(req); if (!s) return send(reply, 404, 'NOT_FOUND')
    const rid = req.body?.requestId
    const hit = !!s.active && (!rid || s.active.requestId === rid)
    if (hit) { s.active!.ctrl.abort('CANCELLED'); s.active = undefined } // 立即释放，后续新请求不会被 BUSY 挡住
    return { cancelled: hit, requestId: rid ?? null }
  })

  // ---------- 生成：SSE delta / done / error ----------
  async function stream(req: FastifyRequest, reply: FastifyReply, s: Session, requestId: string, kind: string,
    run: (signal: AbortSignal, emit: (t: string) => void) => Promise<Record<string, unknown>>) {
    if (s.active) return send(reply, 409, 'BUSY', requestId)
    if (genActive >= cfg.limits.globalGen) return send(reply, 429, 'RATE_LIMITED', requestId)
    const ctrl = new AbortController()
    s.active = { requestId, ctrl, kind }; genActive++
    const t0 = Date.now(); let ttft: number | null = null
    reply.hijack()
    const raw = reply.raw
    raw.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' })
    const ev = (event: string, data: unknown) => { if (!raw.writableEnded) raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`) }
    raw.on('close', () => { if (!raw.writableFinished) ctrl.abort('CANCELLED') })
    let ok = false
    try {
      const done = await run(ctrl.signal, (t) => { if (ttft === null) ttft = Date.now() - t0; ev('delta', { requestId, text: t }) })
      if (ctrl.signal.aborted) throw new LlmError('CANCELLED')
      ev('done', { requestId, stage: s.stage, ...done }); ok = true
    } catch (e) {
      const code: Code = e instanceof LlmError ? e.code : 'UPSTREAM_UNAVAILABLE'
      ev('error', { requestId, code, message: MSG[code] })
      if (!(e instanceof LlmError)) req.log.error({ err: e }, 'generation failed')
    } finally {
      s.metrics.push({ requestId, kind, ttftMs: ttft, totalMs: Date.now() - t0, ok, at: new Date().toISOString() })
      if (s.active?.requestId === requestId) s.active = undefined
      genActive--; raw.end()
    }
  }
  const track = (s: Session, u?: { prompt_tokens?: number; completion_tokens?: number }) => { s.usage.calls++; s.usage.prompt += u?.prompt_tokens ?? 0; s.usage.completion += u?.completion_tokens ?? 0 }

  app.post<{ Params: { id: string }; Body: { requestId?: string; text?: string; intent?: string; cardId?: string; again?: boolean } }>(`${P}/sessions/:id/turns`, async (req, reply) => {
    const s = sess(req); if (!s) return send(reply, 404, 'NOT_FOUND')
    const { requestId, intent } = req.body ?? {}
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : ''
    if (!requestId || typeof requestId !== 'string' || requestId.length > 80) return send(reply, 400, 'BAD_INPUT')
    if (s.paused || s.ended && intent !== 'ask') return send(reply, 409, 'BAD_STATE', requestId)

    if (intent === 'ask') {
      if (!text || [...text].length > cfg.limits.textMax) return send(reply, 400, 'BAD_INPUT', requestId)
      const stageAtAsk = s.stage
      return stream(req, reply, s, requestId, 'ask', async (signal, emit) => {
        const { messages, facts } = T.buildAsk(course, s, text)
        const r = await llm.stream(messages, { signal, maxTokens: 500, temperature: 0.3 }, emit)
        track(s, r.usage)
        const fin = T.finalizeCitations(course, r.text, facts)
        const st = addTurn(s, { role: 'student', kind: 'ask', text, requestId, stage: stageAtAsk })
        const tt = addTurn(s, { role: 'teacher', kind: 'ask', text: fin.text, citations: fin.citations, insufficient: fin.insufficient, requestId, stage: stageAtAsk })
        return { role: 'teacher', turnId: tt.turnId, studentTurnId: st.turnId, text: fin.text, citations: fin.citations, insufficient: fin.insufficient, rejectedCitations: fin.rejected, returnStage: stageAtAsk }
      })
    }
    if (intent === 'explain') {
      const card = course.knowledgeCards.find((c) => c.id === req.body?.cardId)
      if (!card) return send(reply, 400, 'BAD_INPUT', requestId)
      if (!['intro', 'explain', 'feedback', 'retry', 'done'].includes(s.stage)) return send(reply, 409, 'BAD_STATE', requestId)
      if (s.stage === 'intro') s.stage = 'explain'
      const ex = T.exampleParams(card)
      return stream(req, reply, s, requestId, 'explain', async (signal, emit) => {
        const { messages, facts } = T.buildExplain(course, card, ex, !!req.body?.again)
        const r = await llm.stream(messages, { signal, maxTokens: 500, temperature: 0.7 }, emit)
        track(s, r.usage)
        const fixed = T.ensureNumbers(r.text, ex)
        const fin = T.finalizeCitations(course, fixed, facts)
        if (!s.explainedCards.includes(card.id)) s.explainedCards.push(card.id)
        const tt = addTurn(s, { role: 'teacher', kind: req.body?.again ? 'example' : 'explain', text: fin.text, citations: fin.citations, requestId })
        return { role: 'teacher', turnId: tt.turnId, text: fin.text, citations: fin.citations, example: ex.facts, appended: fixed !== r.text }
      })
    }
    if (intent === 'negotiate') {
      if (s.stage !== 'practice') return send(reply, 409, 'BAD_STATE', requestId)
      if (!text || [...text].length > cfg.limits.textMax) return send(reply, 400, 'BAD_INPUT', requestId)
      return stream(req, reply, s, requestId, 'negotiate', async (signal) => {
        const parsed = parseOfferText(text)
        const prevParsed = { ...s.practice.parsed }
        s.practice.parsed = { ...s.practice.parsed, ...parsed }
        s.practice.rounds++
        let out = ''; let regenerated = false; let ruleBased = false
        try {
          for (let attempt = 0; attempt < 2; attempt++) {
            const { messages } = T.buildBuyer(course, s, text, attempt > 0)
            const r = await llm.complete(messages, { signal, maxTokens: 260, temperature: 0.8 })
            track(s, r.usage)
            out = r.text.trim()
            const said = s.turns.filter((t) => t.role === 'student' && t.stage === 'practice').map((t) => t.text).join(' ') + ' ' + text
            if (!leaksHidden(out, k.serverOnly, k.studentVisible, said) && !claimsTeacher(out)) break
            regenerated = true; out = ''
          }
        } catch (e) { s.practice.rounds--; s.practice.parsed = prevParsed; throw e }
        if (!out) { out = T.ruleBuyerFallback(T.buildBuyer(course, s, text).labels); ruleBased = true }
        const st = addTurn(s, { role: 'student', kind: 'negotiate', text, requestId })
        const bt = addTurn(s, { role: 'buyer', kind: 'negotiate', text: out, requestId })
        // 买家回复整段校验后才下发（不边生成边推送，避免未经检查的内容出现）
        return { role: 'buyer', turnId: bt.turnId, studentTurnId: st.turnId, text: out, rounds: s.practice.rounds, regenerated, ruleBased, parsedTerms: parsed }
      })
    }
    return send(reply, 400, 'BAD_INPUT', requestId)
  })

  // ---------- 最终方案：规则核算 + 生成证据化反馈 ----------
  app.post<{ Params: { id: string }; Body: Partial<Offer> & { studentGrossMarginPercent?: number | null } }>(`${P}/sessions/:id/final-offer`, async (req, reply) => {
    const s = sess(req); if (!s) return send(reply, 404, 'NOT_FOUND')
    if (s.stage !== 'practice' || s.paused) return send(reply, 409, 'BAD_STATE')
    const b = req.body ?? {}
    const offer = { unitPriceCents: Number(b.unitPriceCents), quantity: Number(b.quantity), depositBasisPoints: Number(b.depositBasisPoints), leadDays: Number(b.leadDays) }
    const err = validateOffer(offer)
    if (err) return reply.code(400).send({ code: 'BAD_INPUT', error: err, message: '方案字段不完整或格式无效：价格、数量、首付款比例和交付天数都要填写正整数（比例 0–100%）' })
    s.active?.ctrl.abort('CANCELLED')
    const smp = b.studentGrossMarginPercent === null || b.studentGrossMarginPercent === undefined || (b.studentGrossMarginPercent as unknown) === '' ? null : Number(b.studentGrossMarginPercent)
    s.finalOffer = { ...offer, studentGrossMarginPercent: smp, submittedAt: new Date().toISOString() }
    const check = checkOffer(offer, k.studentVisible, k.serverOnly)
    s.check = check
    if (check.valid) {
      s.studentMarginError = smp === null || !Number.isFinite(smp) ? 'not-provided'
        : Math.abs(smp - check.grossMargin * 100) <= 0.05 ? 'none'
        : Math.abs(smp - check.costMarkup * 100) <= 0.05 ? 'used-markup' : 'wrong'
    }
    s.stage = 'feedback'
    const studentTurns = T.practiceStudentTurns(s)
    if (studentTurns.length === 0) {
      s.feedback = { status: 'ready', dimensions: ['D1', 'D2', 'D3'].map((id, i) => ({ id, name: ['解释报价依据', '回应具体顾虑', '明确交易条件'][i], status: 'not_observed', turnId: null, quote: null, comment: '证据不足：本次练习没有你的对话记录。', suggestion: '先和买家至少交流几轮，再提交方案。' })), summary: '证据不足：没有磋商对话，无法评价表达。', generatedAt: new Date().toISOString() }
    } else {
      s.feedback = { status: 'pending', dimensions: [], summary: '' }
      const ctrl = new AbortController()
      void (async () => {
        try {
          const r = await llm.complete(T.buildFeedback(course, s), { signal: ctrl.signal, maxTokens: 900, temperature: 0.2, json: true })
          track(s, r.usage)
          let parsed: unknown = null
          try { parsed = JSON.parse(r.text.replace(/^```json\s*|```$/g, '')) } catch { parsed = null }
          const v = T.verifyDimensions(parsed, s)
          s.feedback = { status: 'ready', ...v, generatedAt: new Date().toISOString() }
        } catch (e) { s.feedback = { status: 'error', dimensions: [], summary: '', error: e instanceof LlmError ? e.code : 'UPSTREAM_UNAVAILABLE' } }
      })()
    }
    return { stage: s.stage, check: publicCheck(check), studentMarginError: s.studentMarginError ?? null }
  })

  function publicCheck(c: ReturnType<typeof checkOffer>) {
    if (!c.valid) return c
    return { ...c, revenue: usd(c.revenueCents), cost: usd(c.costCents), grossProfit: usd(c.grossProfitCents), grossMarginText: pct(c.grossMargin), costMarkupText: pct(c.costMarkup) }
  }

  app.post<{ Params: { id: string } }>(`${P}/sessions/:id/feedback/regenerate`, async (req, reply) => {
    const s = sess(req); if (!s) return send(reply, 404, 'NOT_FOUND')
    if (!s.finalOffer || s.feedback?.status !== 'error') return send(reply, 409, 'BAD_STATE')
    s.feedback = { status: 'pending', dimensions: [], summary: '' }
    try {
      const r = await llm.complete(T.buildFeedback(course, s), { signal: AbortSignal.timeout(30000), maxTokens: 900, temperature: 0.2, json: true })
      track(s, r.usage)
      s.feedback = { status: 'ready', ...T.verifyDimensions(JSON.parse(r.text), s), generatedAt: new Date().toISOString() }
    } catch (e) { s.feedback = { status: 'error', dimensions: [], summary: '', error: e instanceof LlmError ? e.code : 'UPSTREAM_UNAVAILABLE' } }
    return s.feedback
  })

  // ---------- 复练 ----------
  app.post<{ Params: { id: string }; Body: { requestId?: string } }>(`${P}/sessions/:id/retry/question`, async (req, reply) => {
    const s = sess(req); if (!s) return send(reply, 404, 'NOT_FOUND')
    if (s.stage !== 'retry' || s.paused) return send(reply, 409, 'BAD_STATE')
    const requestId = req.body?.requestId ?? 'rq'
    const m = T.makeRetry(course, s)
    s.retry = { type: m.type, reason: m.reason, question: m.stem, createdAt: m.createdAt, params: m.params, answer: m.answer }
    return stream(req, reply, s, requestId, 'retry-question', async (signal, emit) => {
      const r = await llm.stream(T.buildRetryStem(m.stem, m.reason) as Msg[], { signal, maxTokens: 260, temperature: 0.6 }, emit)
      track(s, r.usage)
      const tt = addTurn(s, { role: 'teacher', kind: 'retry', text: r.text, requestId })
      return { role: 'teacher', turnId: tt.turnId, text: r.text, retry: { type: m.type, reason: m.reason, question: m.stem } }
    })
  })
  app.post<{ Params: { id: string }; Body: { requestId?: string; grossProfit?: number; grossMarginPercent?: number; failing?: string[]; explanation?: string } }>(`${P}/sessions/:id/retry/answer`, async (req, reply) => {
    const s = sess(req); if (!s) return send(reply, 404, 'NOT_FOUND')
    if (s.stage !== 'retry' || !s.retry || s.retry.result) return send(reply, 409, 'BAD_STATE')
    const requestId = req.body?.requestId ?? 'ra'
    const sub = { grossProfit: req.body?.grossProfit, grossMarginPercent: req.body?.grossMarginPercent, failing: req.body?.failing, explanation: String(req.body?.explanation ?? '').slice(0, 500) }
    s.retry.submission = sub
    const grade = T.gradeRetry(s.retry, sub)
    const fact = course.facts.find((f) => f.id === (s.retry!.type === 'margin' ? 'F-QUOTE-01' : 'F-TERMS-02'))!
    return stream(req, reply, s, requestId, 'retry-feedback', async (signal, emit) => {
      const r = await llm.stream(T.buildRetryFeedback(s.retry!, grade, sub.explanation, fact), { signal, maxTokens: 300, temperature: 0.3 }, emit)
      track(s, r.usage)
      const fin = T.finalizeCitations(course, r.text, [fact])
      s.retry!.result = { ...grade, feedback: fin.text, at: new Date().toISOString() }
      s.stage = 'done'
      const tt = addTurn(s, { role: 'teacher', kind: 'retry', text: fin.text, citations: fin.citations, requestId, stage: 'retry' })
      return { role: 'teacher', turnId: tt.turnId, text: fin.text, citations: fin.citations, grade, answer: publicAnswer(s.retry!) }
    })
  })
  function publicAnswer(r: NonNullable<Session['retry']>) {
    if (r.type === 'margin') { const a = r.answer as { grossProfitCents: number; grossMargin: number; costMarkup: number }; return { grossProfit: usd(a.grossProfitCents), grossMargin: pct(a.grossMargin), costMarkup: pct(a.costMarkup) } }
    return r.answer
  }

  // ---------- 报告 ----------
  app.get<{ Params: { id: string } }>(`${P}/sessions/:id/report`, async (req, reply) => {
    const s = sess(req); if (!s) return send(reply, 404, 'NOT_FOUND')
    const citations = new Map<string, unknown>()
    for (const t of s.turns) for (const c of t.citations ?? []) citations.set(c.id, c)
    return {
      generatedAt: new Date().toISOString(), course: { id: course.courseId, name: course.name, unit: course.unit, version: course.version, reviewStatus: course.reviewStatus, rubricVersion: course.rubricVersion },
      session: { id: s.id, stage: s.stage, ended: s.ended, createdAt: new Date(s.createdAt).toISOString() },
      transcript: s.turns,
      finalOffer: s.finalOffer ?? null, check: s.check ? publicCheck(s.check) : null, studentMarginError: s.studentMarginError ?? null,
      feedback: s.feedback ?? null,
      retry: s.retry ? { type: s.retry.type, reason: s.retry.reason, question: s.retry.question, submission: s.retry.submission ?? null, result: s.retry.result ?? null, answer: s.retry.result ? publicAnswer(s.retry) : null } : null,
      citations: [...citations.values()],
      evidenceStatus: T.practiceStudentTurns(s).length === 0 ? 'insufficient' : 'ok',
      usage: s.usage, metrics: s.metrics,
    }
  })

  // ---------- 朗读 ----------
  const ttsSlots = { n: 0 }
  // 角色音色白名单：老师（女声）/买家（男声）；不接受任意 voice 名
  const VOICES: Record<string, string> = { teacher: cfg.tts.voice, buyer: process.env.TTS_VOICE_BUYER ?? 'zh-CN-YunjianNeural' }
  app.post<{ Body: { text?: string; role?: string } }>(`${P}/tts`, async (req, reply) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.replace(/\[(F-[A-Z]+-\d{2})\]/g, '').replace(/[*#>`_~]/g, '').trim() : ''
    if (!text || [...text].length > cfg.limits.ttsMax) return send(reply, 400, 'BAD_INPUT')
    if (cfg.tts.mode === 'off') return send(reply, 503, 'UPSTREAM_UNAVAILABLE')
    if (ttsSlots.n >= 6) return send(reply, 429, 'RATE_LIMITED')
    ttsSlots.n++
    const ctrl = new AbortController()
    reply.raw.on('close', () => { if (!reply.raw.writableFinished) ctrl.abort() })
    try {
      const audio = await tts.synth(text, ctrl.signal, VOICES[req.body?.role ?? 'teacher'] ?? cfg.tts.voice)
      reply.header('cache-control', 'no-store')
      return reply.type('audio/mpeg').send(audio)
    } catch { return send(reply, 503, 'UPSTREAM_UNAVAILABLE') } finally { ttsSlots.n-- }
  })

  return app
}
