// 语音适配器（服务端）：默认 Microsoft Edge 在线神经语音（经 edge-tts Python 包），输出 MP3。
// 前端另有浏览器 SpeechSynthesis 兜底；两者都由真实播放事件驱动角色。
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Config } from './config.js'

export interface TtsProvider { name: string; voice: string; synth(text: string, signal: AbortSignal, voice?: string): Promise<Buffer>; probe(): Promise<{ ok: boolean; checkedAt: string; detail: string }> }

export function edgeTts(cfg: Config['tts']): TtsProvider {
  const childEnv = () => {
    const e: NodeJS.ProcessEnv = { ...process.env }
    // edge-tts(aiohttp) 不接受带凭据的代理串；该服务直连即可
    if (process.env.TTS_DIRECT === '1') for (const k of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']) delete e[k]
    return e
  }
  async function synth(text: string, signal: AbortSignal, voice?: string): Promise<Buffer> {
    const dir = await mkdtemp(path.join(tmpdir(), 'tts-'))
    const out = path.join(dir, 'a.mp3')
    try {
      await new Promise<void>((resolve, reject) => {
        const p = spawn(cfg.python, ['-m', 'edge_tts', '--voice', voice ?? cfg.voice, '--rate', '+8%', '--text', text, '--write-media', out], { env: childEnv(), stdio: ['ignore', 'ignore', 'pipe'] })
        let err = ''
        p.stderr.on('data', (d) => { err += d })
        const kill = () => p.kill('SIGKILL')
        const timer = setTimeout(kill, cfg.timeoutMs)
        signal.addEventListener('abort', kill, { once: true })
        p.on('close', (code) => { clearTimeout(timer); signal.removeEventListener('abort', kill); code === 0 ? resolve() : reject(new Error(signal.aborted ? 'CANCELLED' : `edge-tts exit ${code}: ${err.slice(-160)}`)) })
        p.on('error', reject)
      })
      const buf = await readFile(out)
      if (buf.length < 500) throw new Error('empty audio')
      return buf
    } finally { await rm(dir, { recursive: true, force: true }) }
  }
  return {
    name: 'edge-tts', voice: cfg.voice, synth,
    async probe() {
      const checkedAt = new Date().toISOString()
      if (cfg.mode === 'off') return { ok: false, checkedAt, detail: 'TTS_MODE=off' }
      try { const b = await synth('好', AbortSignal.timeout(12000)); return { ok: true, checkedAt, detail: `synth ok ${b.length}B` } }
      catch (e) { return { ok: false, checkedAt, detail: String((e as Error).message).slice(0, 120) } }
    },
  }
}
