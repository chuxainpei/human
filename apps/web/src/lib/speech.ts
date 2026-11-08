// SpeechAdapter：句子队列串行播放。角色“讲话中”只由真实播放事件（playing/ended/pause/error）驱动。
// 模式 server：服务端 /api/tts 返回 MP3，经 WebAudio 分析音量驱动嘴型；模式 browser：浏览器 SpeechSynthesis 兜底。
import { API } from './api'

export type SpeechEvent = { type: 'start' | 'end' | 'idle' | 'cancel' | 'error'; at: number; detail?: string; latencyMs?: number }
export type SpeechMode = 'server' | 'browser' | 'off'
export type Voice = 'teacher' | 'buyer'

const strip = (t: string) => t.replace(/\[(F-[A-Z]+-\d{2})\]/g, '').replace(/[*#>`_~]/g, '').replace(/\s+/g, ' ').trim()

export class Speaker {
  mode: SpeechMode = 'server'
  speaking = false
  private queue: { t: string; r: Voice }[] = []
  private pending = new Map<string, Promise<string | null>>() // role|text -> objectURL（预取下一句）
  private audio: HTMLAudioElement | null = null
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private data: Uint8Array<ArrayBuffer> | null = null
  private gen = 0 // 每次 stop() 递增，旧回调失效
  private fetchCtrl = new AbortController()
  private busy = false
  private listeners: ((e: SpeechEvent) => void)[] = []
  private stopClickedAt = 0
  lastError = ''

  on(fn: (e: SpeechEvent) => void) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter((x) => x !== fn) } }
  private emit(e: SpeechEvent) { for (const f of this.listeners) f(e) }

  /** 幂等解锁：可安全重复调用。
   *  浏览器策略要求 AudioContext 在「用户手势」里创建或恢复，否则建出来就是 suspended。
   *  而 iOS Safari / 企业微信 WebView 更严：在 suspended 状态下用 createMediaElementSource
   *  接好的音频链路，后续即使 resume() 成功也可能永远不通向扬声器——表现是「老师在说话、嘴也不动，但听不到声」。
   *  所以不要在非手势的地方建 ctx：真正创建推迟到第一次真实手势（installGestureUnlock 捕获），
   *  那时 ctx 一诞生就是 running，链路是通的。 */
  unlock() {
    if (this.ctx) { void this.resumeCtx(); return }
    this.buildAudioGraph()
  }

  /** 在用户手势的同步栈里真正建好音频链路。
   *  ctx 与 analyser 必须在这里一次性建成：iOS 上事后 resume 救不回已断开的链路。 */
  private buildAudioGraph() {
    if (this.ctx) return
    try {
      this.audio = new Audio(); this.audio.preload = 'auto'
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new AC()
      this.ctx = ctx
      const src = ctx.createMediaElementSource(this.audio)
      const analyser = ctx.createAnalyser(); analyser.fftSize = 512
      src.connect(analyser); analyser.connect(ctx.destination)
      this.analyser = analyser
      this.data = new Uint8Array(new ArrayBuffer(analyser.fftSize))
      // 空播放：在手势内解锁媒体元素，后面播 MP3 才不会被拦
      this.audio.play().catch(() => {})
      void ctx.resume().catch(() => {})
    } catch { /* 无 WebAudio：仍可播放，但嘴型按节奏 */ }
  }

  /** 恢复被浏览器挂起的 AudioContext。成功与否都无所谓：失败时下一个手势还会再试。 */
  private async resumeCtx() {
    const ctx = this.ctx
    if (!ctx) return
    if (ctx.state === 'running') return
    try { await ctx.resume() } catch { /* 需要用户手势，等下一次交互 */ }
  }

  /** 在页面级捕获任意一次真实用户手势，用来把声音真正唤醒。
   *  这里不只是 resume，还要在手势栈内把整条音频链路建起来——iOS 上这是能否出声的关键。 */
  installGestureUnlock() {
    if (typeof document === 'undefined') return
    const handler = () => {
      this.buildAudioGraph()
      void this.resumeCtx()
      if (this.ctx?.state === 'running') this.removeGestureUnlock()
    }
    this.gestureHandler = handler
    const opts = { capture: true, passive: true } as AddEventListenerOptions
    document.addEventListener('pointerdown', handler, opts)
    document.addEventListener('touchstart', handler, opts)
    document.addEventListener('keydown', handler, opts)
    document.addEventListener('click', handler, opts)
  }
  private gestureHandler: ((e: Event) => void) | null = null
  private removeGestureUnlock() {
    if (!this.gestureHandler) return
    const opts = { capture: true } as AddEventListenerOptions
    document.removeEventListener('pointerdown', this.gestureHandler, opts)
    document.removeEventListener('touchstart', this.gestureHandler, opts)
    document.removeEventListener('keydown', this.gestureHandler, opts)
    document.removeEventListener('click', this.gestureHandler, opts)
    this.gestureHandler = null
  }

  /** 0..1 的实时音量；没有分析器时返回 -1（角色改用节奏动画，但仍只在播放中说话）。 */
  level = (): number => {
    if (!this.analyser || !this.data || !this.speaking || this.mode !== 'server') return -1
    this.analyser.getByteTimeDomainData(this.data)
    let sum = 0
    for (let i = 0; i < this.data.length; i++) { const v = (this.data[i] - 128) / 128; sum += v * v }
    return Math.sqrt(sum / this.data.length)
  }

  /** 语音链路诊断：给 ?voice=1 的调试面板用。定位「无声 / 嘴不动」时看这里最快。 */
  diag() {
    const ctx = this.ctx
    let zhVoices = 0
    try {
      const vs = window.speechSynthesis?.getVoices?.() ?? []
      zhVoices = vs.filter((v) => /^zh/i.test(v.lang)).length
    } catch { /* 无 speechSynthesis */ }
    return {
      mode: this.mode,
      ctxState: ctx ? ctx.state : 'none',
      hasGraph: !!this.analyser,
      speaking: this.speaking,
      level: this.level(),
      pending: this.queue.length,
      lastError: this.lastError,
      zhVoices,
      hasSpeechSynthesis: typeof window.speechSynthesis !== 'undefined',
    }
  }

  /** 加入一段文字（流式时可多次调用），按句切分后排队。 */
  enqueue(text: string, role: Voice = 'teacher') {
    if (this.mode === 'off') return
    const parts = strip(text).split(/(?<=[。！？!?；\n])/).map((s) => s.trim()).filter((s) => s.length > 0)
    for (let p of parts) { while (p.length > 140) { this.queue.push({ t: p.slice(0, 140), r: role }); p = p.slice(140) } if (p) this.queue.push({ t: p, r: role }) }
    // 提前合成后两句，缩短句间停顿
    if (this.mode === 'server') for (const q of this.queue.slice(0, 2)) void this.fetchAudio(q)
    void this.pump()
  }

  private fetchAudio(q: { t: string; r: Voice }): Promise<string | null> {
    const text = q.t, key = q.r + '|' + q.t
    if (!this.pending.has(key)) {
      const g = this.gen
      this.pending.set(key, fetch(`${API}/tts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, role: q.r }), signal: this.fetchCtrl.signal })
        .then(async (r) => { if (!r.ok) throw new Error(`TTS ${r.status}`); const b = await r.blob(); return g === this.gen ? URL.createObjectURL(b) : null })
        .catch((e) => { if (g === this.gen) this.lastError = String(e.message ?? e); return null }))
    }
    return this.pending.get(key)!
  }

  private async pump() {
    if (this.busy) return
    this.busy = true
    const g = this.gen
    try {
      while (this.queue.length && g === this.gen) {
        const item = this.queue.shift()!
        const text = item.t
        if (this.mode === 'server') {
          if (this.queue[0]) void this.fetchAudio(this.queue[0]) // 预取下一句
          const url = await this.fetchAudio(item)
          this.pending.delete(item.r + '|' + text)
          if (g !== this.gen) { if (url) URL.revokeObjectURL(url); break }
          if (!url) { this.emit({ type: 'error', at: performance.now(), detail: '服务器朗读失败，已切换为浏览器语音' }); this.mode = 'browser'; this.queue.unshift(item); continue }
          const played = await this.playUrl(url, g, text)
          URL.revokeObjectURL(url)
          // 播放被浏览器策略拦下：退回浏览器语音，并把这一句放回队列（保留角色）
          if (!played && g === this.gen) { this.mode = 'browser'; this.queue.unshift(item); continue }
        } else if (this.mode === 'browser') {
          const ok = await this.speakBrowser(text, g, item.r)
          if (!ok && g === this.gen) {
            // 浏览器没有中文语音（iOS 企业微信常见）：不能悄悄静音，要说清楚。
            this.emit({ type: 'error', at: performance.now(), detail: '这台设备没有可用的中文语音，且服务器朗读被浏览器拦截了；请换一个浏览器打开，或检查手机静音开关' })
            this.mode = 'off'; this.queue = []; break
          }
        }
      }
    } finally {
      if (g === this.gen) { this.busy = false; this.setSpeaking(false); this.emit({ type: 'idle', at: performance.now() }) }
    }
  }

  private setSpeaking(v: boolean) { this.speaking = v }

  /** 播放一段音频。返回 false 表示被浏览器策略拦下、未能真正播出（调用方负责降级）。 */
  private playUrl(url: string, g: number, text = '') {
    return new Promise<boolean>((resolve) => {
      const a = this.audio ?? (this.audio = new Audio())
      let settled = false
      const cleanup = () => { a.onplaying = a.onended = a.onerror = a.onpause = null }
      const done = (ok: boolean) => { if (settled) return; settled = true; cleanup(); resolve(ok) }
      a.onplaying = () => { if (g !== this.gen) return; this.setSpeaking(true); this.emit({ type: 'start', at: performance.now(), detail: text }) }
      a.onended = () => { this.setSpeaking(false); this.emit({ type: 'end', at: performance.now() }); done(true) }
      a.onpause = () => { if (!a.ended) { this.setSpeaking(false); const at = performance.now(); this.emit({ type: 'cancel', at, latencyMs: this.stopClickedAt ? Math.round(at - this.stopClickedAt) : undefined }); done(true) } }
      a.onerror = () => { this.setSpeaking(false); this.emit({ type: 'error', at: performance.now(), detail: '音频播放失败' }); done(false) }
      a.src = url
      // 播放前先把被策略挂起的 AudioContext 拉回来；否则 analyser 拿不到音量，嘴型不动
      void this.resumeCtx()
      a.play().catch((e) => {
        const name = (e as { name?: string } | undefined)?.name ?? ''
        // NotAllowedError = 浏览器自动播放策略拦截：唤醒 ctx 后重试一次
        if (name === 'NotAllowedError' && g === this.gen) {
          void this.resumeCtx().then(() => {
            a.play()
              .then(() => { /* 播出去了，等 onplaying/onended 收尾 */ })
              .catch(() => { this.setSpeaking(false); this.emit({ type: 'error', at: performance.now(), detail: '浏览器阻止了播放，已切换为浏览器语音' }); done(false) })
          })
          return
        }
        this.setSpeaking(false); this.emit({ type: 'error', at: performance.now(), detail: '浏览器阻止了播放：' + name }); done(false)
      })
    })
  }

  private speakBrowser(text: string, g: number, role: Voice = 'teacher') {
    return new Promise<boolean>((resolve) => {
      const ss = window.speechSynthesis
      if (!ss) return resolve(false)
      const voice = ss.getVoices().find((v) => /^zh(-|_)?(CN|Hans)?/i.test(v.lang))
      if (!voice) return resolve(false)
      const u = new SpeechSynthesisUtterance(text); u.voice = voice; u.lang = voice.lang; u.rate = 1.05; u.pitch = role === 'buyer' ? 0.8 : 1.05
      u.onstart = () => { if (g !== this.gen) return; this.setSpeaking(true); this.emit({ type: 'start', at: performance.now(), detail: text }) }
      u.onend = () => { this.setSpeaking(false); this.emit({ type: 'end', at: performance.now() }); resolve(true) }
      u.onerror = (e) => { this.setSpeaking(false); if (e.error !== 'interrupted' && e.error !== 'canceled') this.emit({ type: 'error', at: performance.now(), detail: e.error }); resolve(e.error === 'interrupted' || e.error === 'canceled') }
      ss.speak(u)
    })
  }

  /** 是否还有待播或正在播放的语音（验收脚本用来判断整段朗读是否结束）。 */
  active() { return this.busy || this.queue.length > 0 }

  /** 停止讲话：清空队列、中止取音频、立即暂停；保留文字与教学阶段。 */
  stop() {
    this.stopClickedAt = performance.now()
    this.gen++
    this.queue = []
    this.fetchCtrl.abort(); this.fetchCtrl = new AbortController()
    for (const p of this.pending.values()) void p.then((u) => u && URL.revokeObjectURL(u))
    this.pending.clear()
    const wasSpeaking = this.speaking
    if (this.audio && !this.audio.paused) this.audio.pause()
    else if (wasSpeaking) this.emit({ type: 'cancel', at: performance.now(), latencyMs: 0 })
    try { window.speechSynthesis?.cancel() } catch { /* */ }
    this.setSpeaking(false)
    this.busy = false
  }
}
