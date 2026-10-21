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

  /** 必须在用户手势中调用一次：创建 AudioContext 与可复用的 audio 元素（解锁自动播放）。 */
  unlock() {
    if (this.ctx) { void this.ctx.resume(); return }
    try {
      this.audio = new Audio(); this.audio.preload = 'auto'
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.ctx = new AC()
      const src = this.ctx.createMediaElementSource(this.audio)
      this.analyser = this.ctx.createAnalyser(); this.analyser.fftSize = 512
      src.connect(this.analyser); this.analyser.connect(this.ctx.destination)
      this.data = new Uint8Array(new ArrayBuffer(this.analyser.fftSize))
      this.audio.play().catch(() => {}) // 空播放解锁
    } catch { /* 无 WebAudio：仍可播放，但嘴型按节奏 */ }
  }

  /** 0..1 的实时音量；没有分析器时返回 -1（角色改用节奏动画，但仍只在播放中说话）。 */
  level = (): number => {
    if (!this.analyser || !this.data || !this.speaking || this.mode !== 'server') return -1
    this.analyser.getByteTimeDomainData(this.data)
    let sum = 0
    for (let i = 0; i < this.data.length; i++) { const v = (this.data[i] - 128) / 128; sum += v * v }
    return Math.sqrt(sum / this.data.length)
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
          await this.playUrl(url, g, text)
          URL.revokeObjectURL(url)
        } else if (this.mode === 'browser') {
          const ok = await this.speakBrowser(text, g, item.r)
          if (!ok && g === this.gen) { this.emit({ type: 'error', at: performance.now(), detail: '浏览器没有可用的中文语音，已改为仅文字' }); this.mode = 'off'; this.queue = []; break }
        }
      }
    } finally {
      if (g === this.gen) { this.busy = false; this.setSpeaking(false); this.emit({ type: 'idle', at: performance.now() }) }
    }
  }

  private setSpeaking(v: boolean) { this.speaking = v }

  private playUrl(url: string, g: number, text = '') {
    return new Promise<void>((resolve) => {
      const a = this.audio ?? (this.audio = new Audio())
      const cleanup = () => { a.onplaying = a.onended = a.onerror = a.onpause = null; resolve() }
      a.onplaying = () => { if (g !== this.gen) return; this.setSpeaking(true); this.emit({ type: 'start', at: performance.now(), detail: text }) }
      a.onended = () => { this.setSpeaking(false); this.emit({ type: 'end', at: performance.now() }); cleanup() }
      a.onpause = () => { if (!a.ended) { this.setSpeaking(false); const at = performance.now(); this.emit({ type: 'cancel', at, latencyMs: this.stopClickedAt ? Math.round(at - this.stopClickedAt) : undefined }); cleanup() } }
      a.onerror = () => { this.setSpeaking(false); this.emit({ type: 'error', at: performance.now(), detail: '音频播放失败' }); cleanup() }
      a.src = url
      a.play().catch((e) => { this.setSpeaking(false); this.emit({ type: 'error', at: performance.now(), detail: '浏览器阻止了播放：' + (e?.name ?? '') }); cleanup() })
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
