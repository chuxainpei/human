import { randomBytes, randomUUID } from 'node:crypto'
import type { Offer } from './content.js'
import type { CheckResult } from './rules.js'

export type Stage = 'intro' | 'explain' | 'practice' | 'feedback' | 'retry' | 'done'
export type Role = 'student' | 'teacher' | 'buyer' | 'system'
export interface Citation { id: string; title: string; text: string; sourceType: string; sourceUrl: string | null; locator: string; quote: string | null }
export interface Turn {
  turnId: string; role: Role; stage: Stage; kind: 'ask' | 'explain' | 'example' | 'negotiate' | 'opening' | 'retry' | 'divider'
  text: string; citations?: Citation[]; at: string; requestId?: string; insufficient?: boolean
}
export interface Dimension { id: string; name: string; status: 'observed' | 'not_observed'; turnId: string | null; quote: string | null; comment: string; suggestion: string }
export interface RetryState {
  type: 'margin' | 'conditions'; reason: string; question: string; createdAt: string
  params: Record<string, number>; answer: Record<string, unknown> // 服务端保留，提交前不下发
  submission?: Record<string, unknown>; result?: { correct: boolean; details: string[]; feedback: string; at: string }
}
export interface Session {
  id: string; owner: string; createdAt: number; lastAt: number
  stage: Stage; paused: boolean; ended: boolean
  turns: Turn[]
  practice: { startedAt?: string; rounds: number; parsed: Partial<Offer> }
  finalOffer?: Offer & { studentGrossMarginPercent?: number | null; submittedAt: string }
  check?: CheckResult
  studentMarginError?: 'none' | 'used-markup' | 'wrong' | 'not-provided'
  feedback?: { status: 'pending' | 'ready' | 'error'; dimensions: Dimension[]; summary: string; generatedAt?: string; error?: string }
  retry?: RetryState
  explainedCards: string[]
  active?: { requestId: string; ctrl: AbortController; kind: string }
  usage: { prompt: number; completion: number; calls: number }
  metrics: { requestId: string; kind: string; ttftMs: number | null; totalMs: number; ok: boolean; at: string }[]
}

export const ACTIONS: Record<string, { from: Stage[]; to?: Stage }> = {
  next: { from: ['intro'], to: 'explain' },
  startPractice: { from: ['explain', 'intro'], to: 'practice' },
  finishPractice: { from: ['practice'] }, // 需先提交最终方案（final-offer 会切到 feedback）
  retry: { from: ['feedback'], to: 'retry' },
  restartPractice: { from: ['feedback', 'retry', 'done'], to: 'practice' },
  pause: { from: ['intro', 'explain', 'practice', 'feedback', 'retry', 'done'] },
  resume: { from: ['intro', 'explain', 'practice', 'feedback', 'retry', 'done'] },
  end: { from: ['intro', 'explain', 'practice', 'feedback', 'retry', 'done'], to: 'done' },
}

export class SessionStore {
  private map = new Map<string, Session>()
  constructor(private ttlMs: number, private max: number) {}
  create(): Session {
    this.sweep()
    if (this.map.size >= this.max) { const oldest = [...this.map.values()].sort((a, b) => a.lastAt - b.lastAt)[0]; if (oldest) this.delete(oldest.id) }
    const s: Session = {
      id: randomUUID(), owner: randomBytes(24).toString('base64url'), createdAt: Date.now(), lastAt: Date.now(),
      stage: 'intro', paused: false, ended: false, turns: [], practice: { rounds: 0, parsed: {} }, explainedCards: [],
      usage: { prompt: 0, completion: 0, calls: 0 }, metrics: [],
    }
    this.map.set(s.id, s)
    return s
  }
  /** 只有持有同一 HttpOnly cookie 的浏览器才能读写该会话。 */
  get(id: string, owner: string | undefined): Session | null {
    const s = this.map.get(id)
    if (!s || !owner || s.owner !== owner) return null
    if (Date.now() - s.lastAt > this.ttlMs) { this.delete(id); return null }
    s.lastAt = Date.now()
    return s
  }
  delete(id: string) { const s = this.map.get(id); s?.active?.ctrl.abort('CANCELLED'); this.map.delete(id) }
  sweep() { const now = Date.now(); for (const [id, s] of this.map) if (now - s.lastAt > this.ttlMs) this.delete(id) }
  size() { return this.map.size }
}

export function addTurn(s: Session, t: Omit<Turn, 'turnId' | 'at' | 'stage'> & { stage?: Stage }): Turn {
  const turn: Turn = { turnId: `T${String(s.turns.length + 1).padStart(3, '0')}`, at: new Date().toISOString(), stage: t.stage ?? s.stage, ...t }
  s.turns.push(turn)
  return turn
}

export function publicSession(s: Session) {
  return {
    id: s.id, stage: s.stage, paused: s.paused, ended: s.ended,
    role: s.stage === 'practice' ? 'buyer' : 'teacher',
    turns: s.turns, practice: { rounds: s.practice.rounds, startedAt: s.practice.startedAt ?? null },
    finalOfferSubmitted: !!s.finalOffer, explainedCards: s.explainedCards,
    retry: s.retry ? { type: s.retry.type, reason: s.retry.reason, question: s.retry.question, submitted: !!s.retry.submission, result: s.retry.result ?? null } : null,
  }
}
