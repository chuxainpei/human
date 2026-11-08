import { reactive, ref } from 'vue'
import { api, ApiError, newRequestId, setSessionKey, sse, type Citation, type SessionView, type Turn } from './api'
import { Speaker, type SpeechEvent } from './speech'

export const COURSE_ID = 'trade-quote-unit-v1'
export type Phase = 'idle' | 'thinking' | 'speaking' | 'error'

export const speaker = new Speaker()
;(window as unknown as { __speakerActive: () => boolean }).__speakerActive = () => speaker.active()
// 建课可能不在用户手势里（首页 ?start=1 在 onMounted 中建课），此时 AudioContext 建出来就是 suspended。
// 挂一个全局手势兜底：用户第一次点/按任意元素时把声音唤醒。
speaker.installGestureUnlock()
export const state = reactive({
  course: null as null | Record<string, any>,
  caps: null as null | Record<string, any>,
  session: null as null | SessionView,
  turns: [] as (Turn & { streaming?: boolean; failed?: string })[],
  generating: false,
  speaking: false,
  phase: 'idle' as Phase,
  error: '' as string,
  voiceNote: '' as string,
  caption: '' as string,
  stopLatencies: [] as number[],
  lastExample: null as null | Record<string, string>,
  check: null as null | Record<string, any>,
  retryQuestion: null as null | { type: string; reason: string; question: string },
  retryResult: null as null | Record<string, any>,
  timings: [] as { requestId: string; kind: string; ttftMs: number | null; totalMs: number; ok: boolean }[],
})
export const openCitation = ref<Citation | null>(null)
export const openCitationNo = ref(0) // 出处在本节课里的序号 [n]

let current: { requestId: string; ctrl: AbortController; t0: number; ttft: number | null; kind: string; bubble?: Turn & { streaming?: boolean; failed?: string } } | null = null

// 可复核的播放事件日志（验收用：讲话状态 vs 真实音频事件、停止讲话时延）
const speechLog: (SpeechEvent & { phase?: string })[] = ((window as unknown as { __speechLog: SpeechEvent[] }).__speechLog = [])
speaker.on((e: SpeechEvent) => {
  speechLog.push({ ...e, phase: state.phase, wall: performance.timeOrigin + e.at } as never)
  if (e.type === 'start') { state.speaking = true; state.caption = e.detail ?? '' }
  if (e.type === 'idle' || e.type === 'cancel') state.caption = ''
  if (e.type === 'end' || e.type === 'idle' || e.type === 'cancel' || e.type === 'error') state.speaking = false
  if (e.type === 'cancel' && e.latencyMs !== undefined) state.stopLatencies.push(e.latencyMs)
  if (e.type === 'error' && e.detail) state.voiceNote = e.detail
  syncPhase()
})
export function syncPhase() {
  state.phase = state.error ? 'error' : state.speaking ? 'speaking' : state.generating ? 'thinking' : 'idle'
}
function setError(msg: string) { state.error = msg; syncPhase() }
export function clearError() { state.error = ''; syncPhase() }

let capsTimer: ReturnType<typeof setTimeout> | undefined
export async function refreshCaps(force = false, attempt = 0) {
  clearTimeout(capsTimer)
  try { state.caps = await api.capabilities(force) } catch (e) { const er = e as { status?: number; message?: string }; state.caps = { liveChat: false, ttsMode: 'unknown', error: true, detail: er.status ? `HTTP ${er.status}` : (er.message ?? '') } }
  speaker.mode = state.caps?.ttsMode === 'server-edge' ? 'server' : 'browser'
  // 不可用时自动复检（5s、15s、30s、之后每 60s），恢复后停止
  if (!state.caps?.liveChat) capsTimer = setTimeout(() => void refreshCaps(true, attempt + 1), [5000, 15000, 30000][attempt] ?? 60000)
}
export async function loadEntry() {
  const [course] = await Promise.allSettled([api.course(COURSE_ID), refreshCaps()])
  if (course.status === 'fulfilled') state.course = course.value
  else setError('课程加载失败，请刷新重试')
}

export async function startSession(stage?: string) {
  speaker.unlock() // 用户点击“开始学习”时才解锁声音
  clearError()
  const s = await api.createSession(stage)
  setSessionKey(s.key ?? null); delete s.key
  state.session = s; state.turns = [...s.turns]; state.check = null; state.retryQuestion = null; state.retryResult = null
  sessionStorage.setItem('tam_session', s.id)
  return s
}
export async function resumeSession() {
  const id = sessionStorage.getItem('tam_session')
  if (!id) return null
  try { const s = await api.session(id); state.session = s; state.turns = [...s.turns]; return s }
  catch {
    // 服务端已经没有这节课了（重启/超时/钥匙失效）。清掉本地痕迹，让上层重新开一节，
    // 但不要把学生直接踢回首页——那会让他以为自己点的按钮没反应。
    sessionStorage.removeItem('tam_session'); setSessionKey(null); state.session = null
    return null
  }
}

/** 停止讲话：只停声音，保留文字与阶段。 */
export function stopSpeaking() { speaker.stop(); state.speaking = false; syncPhase() }
/** 停止生成：中止当前请求及其后续音频。 */
export async function stopGenerating() {
  const c = current
  stopSpeaking()
  if (!c || !state.session) return
  c.ctrl.abort()
  current = null
  // 被中止的回复：标记为已停止且不保存（服务端也不会记入会话），后续事件因 requestId 不同被忽略
  if (c.bubble?.streaming) { c.bubble.streaming = false; c.bubble.failed = c.bubble.text ? '已停止生成（以上为部分内容，未保存）' : '已停止生成' }
  state.generating = false; syncPhase()
  await api.cancel(state.session.id, c.requestId).catch(() => {})
}

export async function doAction(action: string, recovered = false) {
  if (!state.session) {
    // 没有会话就静默返回，学生点了「开始讲解」却毫无反应。宁可重开一节新课继续。
    if (!recovered) { try { await startSession(); await doAction(action, true) } catch { /* 下面统一提示 */ } }
    return
  }
  if (action !== 'pause' && action !== 'resume') await stopGenerating()
  if (action === 'pause') { await stopGenerating() }
  try {
    const s = await api.action(state.session.id, action)
    state.session = s; state.turns = [...s.turns]
    if (action === 'startPractice' || action === 'restartPractice') { state.check = null; state.retryQuestion = null; state.retryResult = null; const open = s.turns.at(-1); if (open?.role === 'buyer') speaker.enqueue(open.text, 'buyer') }
    clearError()
  } catch (e) {
    // 会话已失效：任何阶段动作都自动换一节新课再做一次，别把「会话过期」甩给学生。
    if ((e as ApiError).code === 'NOT_FOUND' && !recovered) {
      const stage = state.session?.stage
      try { await startSession(stage); return await doAction(action, true) } catch { /* fallthrough */ }
    }
    setError((e as ApiError).message)
  }
}

interface RunOpts { path: string; body: Record<string, unknown>; kind: string; studentText?: string; role: 'teacher' | 'buyer'; streamText: boolean; onDone?: (d: any) => void; recovered?: boolean }
/** 发起一次生成：旧请求一律作废；旧回调因 requestId 不同被忽略。 */
async function run(o: RunOpts) {
  if (!state.session) return
  await stopGenerating()
  clearError()
  const requestId = newRequestId()
  const ctrl = new AbortController()
  const me: NonNullable<typeof current> = { requestId, ctrl, t0: performance.now(), ttft: null, kind: o.kind }
  current = me
  state.generating = true; syncPhase()
  if (o.studentText) state.turns.push({ turnId: 'pending-s-' + requestId, role: 'student', stage: state.session.stage, kind: o.kind, text: o.studentText, at: new Date().toISOString() })
  const bubble = reactive({ turnId: 'pending-' + requestId, role: o.role, stage: state.session.stage, kind: o.kind, text: '', at: new Date().toISOString(), streaming: true, citations: [] as Citation[] }) as Turn & { streaming?: boolean; failed?: string }
  state.turns.push(bubble)
  me.bubble = bubble
  let spokenUpTo = 0
  const speakNew = (final = false) => {
    // 流式朗读：只把已完整的句子送进队列
    const t = bubble.text
    const cut = final ? t.length : Math.max(t.lastIndexOf('。'), t.lastIndexOf('！'), t.lastIndexOf('？'), t.lastIndexOf('\n')) + 1
    if (cut > spokenUpTo) { speaker.enqueue(t.slice(spokenUpTo, cut), o.role); spokenUpTo = cut }
  }
  await sse(o.path, { requestId, ...o.body }, ctrl.signal, {
    onDelta: (t) => {
      if (current?.requestId !== requestId) return
      if (me.ttft === null) me.ttft = performance.now() - me.t0
      if (o.streamText) { bubble.text += t; speakNew() }
    },
    onDone: (d) => {
      if (current?.requestId !== requestId || d.requestId !== requestId) return
      bubble.text = d.text; bubble.citations = d.citations ?? []; bubble.turnId = d.turnId; bubble.streaming = false; bubble.insufficient = d.insufficient
      if (me.ttft === null) me.ttft = performance.now() - me.t0
      const st = state.turns.find((t) => t.turnId === 'pending-s-' + requestId); if (st && d.studentTurnId) st.turnId = d.studentTurnId
      if (o.streamText) speakNew(true); else speaker.enqueue(d.text, o.role)
      o.onDone?.(d)
      state.timings.push({ requestId, kind: o.kind, ttftMs: Math.round(me.ttft), totalMs: Math.round(performance.now() - me.t0), ok: true })
      // 收到 done 即视为完成：后续操作不再中止这条已完成的请求（服务端可能稍后才关闭连接）
      current = null; state.generating = false; syncPhase()
    },
    onError: (code, msg) => {
      if (current?.requestId !== requestId) return
      // 会话在服务端已不存在（服务重启、超时、钥匙丢失）：不打扰学生，自动重新开一节课并把这句话重发一次。
      // 以前只对 ask 生效，谈判（negotiate）、讲解（explain）、复练（retry）一旦遇到会话失效就直报
      // 「会话不存在或已过期」，老师在企业微信里彻底失联——这正是线上「没办法说话沟通」的主症状。
      if (code === 'NOT_FOUND' && !o.recovered) {
        recoverAfter = { o, oldId: state.session!.id, stage: state.session?.stage }
        state.turns = state.turns.filter((t) => t !== bubble && t.turnId !== 'pending-s-' + requestId)
        return
      }
      bubble.streaming = false
      if (code === 'CANCELLED') { bubble.failed = bubble.text ? '已停止生成（以上为部分内容，未保存）' : '已停止生成'; }
      else { bubble.failed = msg; setError(msg) }
      state.timings.push({ requestId, kind: o.kind, ttftMs: me.ttft === null ? null : Math.round(me.ttft), totalMs: Math.round(performance.now() - me.t0), ok: false })
    },
  })
  if (current?.requestId === requestId) { current = null; state.generating = false; syncPhase() }
  if (recoverAfter && recoverAfter.o === o) {
    const { oldId, stage } = recoverAfter; recoverAfter = null
    const keep = state.turns.slice()
    // 重开时把阶段带回去，学生不用从第一关重来
    try { await startSession(stage) } catch { setError('课堂连接断开了，请刷新页面重新开始'); return }
    state.turns = [...keep, ...state.turns]
    await run({ ...o, path: o.path.replace(oldId, state.session!.id), recovered: true })
  }
}
let recoverAfter: { o: RunOpts; oldId: string; stage?: string } | null = null

export const ask = (text: string) => run({ path: `/sessions/${state.session!.id}/turns`, body: { intent: 'ask', text }, kind: 'ask', studentText: text, role: 'teacher', streamText: true })
export const explain = (cardId: string, again = false) => run({ path: `/sessions/${state.session!.id}/turns`, body: { intent: 'explain', cardId, again }, kind: again ? 'example' : 'explain', role: 'teacher', streamText: true, onDone: (d) => { state.lastExample = d.example ?? null; refresh() } })
export const negotiate = (text: string) => run({ path: `/sessions/${state.session!.id}/turns`, body: { intent: 'negotiate', text }, kind: 'negotiate', studentText: text, role: 'buyer', streamText: false, onDone: () => refresh() })
export const retryQuestion = () => run({ path: `/sessions/${state.session!.id}/retry/question`, body: {}, kind: 'retry', role: 'teacher', streamText: true, onDone: (d) => { state.retryQuestion = d.retry } })
export const retryAnswer = (body: Record<string, unknown>) => run({ path: `/sessions/${state.session!.id}/retry/answer`, body, kind: 'retry', role: 'teacher', streamText: true, onDone: (d) => { state.retryResult = { grade: d.grade, answer: d.answer, text: d.text }; refresh() } })

export async function refresh() { if (!state.session) return; try { const s = await api.session(state.session.id); state.session = s } catch { /* */ } }

export async function submitFinalOffer(body: Record<string, unknown>) {
  if (!state.session) return
  await stopGenerating()
  try {
    const r = await api.finalOffer(state.session.id, body)
    state.check = r
    await refresh()
    clearError()
    return r
  } catch (e) { setError((e as ApiError).message); return null }
}

export async function endLearning() {
  await stopGenerating()
  await doAction('end')
}
