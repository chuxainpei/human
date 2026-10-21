// 模型适配器：OpenAI 兼容 Chat Completions（默认 DeepSeek）。可替换为任意兼容服务。
import type { Config } from './config.js'

export interface Msg { role: 'system' | 'user' | 'assistant'; content: string }
export interface LlmProvider {
  name: string
  model: string
  stream(messages: Msg[], opts: { signal: AbortSignal; maxTokens?: number; temperature?: number }, onDelta: (t: string) => void): Promise<{ text: string; usage?: Usage }>
  complete(messages: Msg[], opts: { signal: AbortSignal; maxTokens?: number; temperature?: number; json?: boolean }): Promise<{ text: string; usage?: Usage }>
  probe(): Promise<{ ok: boolean; checkedAt: string; detail: string; latencyMs?: number }>
}
export interface Usage { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }

export class LlmError extends Error { constructor(public code: 'UPSTREAM_UNAVAILABLE' | 'TIMEOUT' | 'CANCELLED' | 'NOT_CONFIGURED' | 'NO_BALANCE', msg?: string) { super(msg ?? code) } }

export function openAiCompatible(cfg: Config['llm']): LlmProvider {
  const headers = () => ({ 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey ?? ''}` })
  const body = (messages: Msg[], o: { maxTokens?: number; temperature?: number; json?: boolean }, stream: boolean) => JSON.stringify({
    model: cfg.model, messages, stream, max_tokens: o.maxTokens ?? 600, temperature: o.temperature ?? 0.4,
    thinking: { type: 'disabled' }, // DeepSeek：关闭思考，首字更快；其他兼容服务会忽略
    ...(o.json ? { response_format: { type: 'json_object' } } : {}),
    ...(stream ? { stream_options: { include_usage: true } } : {}),
  })
  function wrap(signal: AbortSignal) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort('TIMEOUT'), cfg.timeoutMs)
    const onAbort = () => ctrl.abort('CANCELLED')
    if (signal.aborted) ctrl.abort('CANCELLED'); else signal.addEventListener('abort', onAbort, { once: true })
    return { ctrl, done: () => { clearTimeout(timer); signal.removeEventListener('abort', onAbort) } }
  }
  function mapErr(e: unknown, ctrl: AbortController): never {
    if (ctrl.signal.aborted) throw new LlmError(ctrl.signal.reason === 'TIMEOUT' ? 'TIMEOUT' : 'CANCELLED')
    if (e instanceof LlmError) throw e
    throw new LlmError('UPSTREAM_UNAVAILABLE', String((e as Error)?.message ?? e).slice(0, 200))
  }
  return {
    name: 'openai-compatible', model: cfg.model,
    async stream(messages, opts, onDelta) {
      if (!cfg.apiKey) throw new LlmError('NOT_CONFIGURED')
      const { ctrl, done } = wrap(opts.signal)
      let text = ''; let usage: Usage | undefined
      try {
        const r = await fetch(`${cfg.baseUrl}/chat/completions`, { method: 'POST', headers: headers(), body: body(messages, opts, true), signal: ctrl.signal })
        if (!r.ok || !r.body) throw new LlmError(r.status === 402 ? 'NO_BALANCE' : 'UPSTREAM_UNAVAILABLE', `HTTP ${r.status}`)
        const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = ''
        for (;;) {
          const { value, done: end } = await reader.read()
          if (end) break
          buf += dec.decode(value, { stream: true })
          let i: number
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1)
            if (!line.startsWith('data:')) continue
            const data = line.slice(5).trim()
            if (data === '[DONE]') continue
            try {
              const j = JSON.parse(data)
              if (j.usage) usage = j.usage
              const d = j.choices?.[0]?.delta?.content
              if (d) { text += d; onDelta(d) }
            } catch { /* 跨块的半行由 buf 处理；坏行忽略 */ }
          }
        }
        if (!text) throw new LlmError('UPSTREAM_UNAVAILABLE', 'empty completion')
        return { text, usage }
      } catch (e) { mapErr(e, ctrl) } finally { done() }
    },
    async complete(messages, opts) {
      if (!cfg.apiKey) throw new LlmError('NOT_CONFIGURED')
      const { ctrl, done } = wrap(opts.signal)
      try {
        const r = await fetch(`${cfg.baseUrl}/chat/completions`, { method: 'POST', headers: headers(), body: body(messages, opts, false), signal: ctrl.signal })
        if (!r.ok) throw new LlmError(r.status === 402 ? 'NO_BALANCE' : 'UPSTREAM_UNAVAILABLE', `HTTP ${r.status}`)
        const j = await r.json() as { choices?: { message?: { content?: string } }[]; usage?: Usage }
        const text = j.choices?.[0]?.message?.content ?? ''
        if (!text) throw new LlmError('UPSTREAM_UNAVAILABLE', 'empty completion')
        return { text, usage: j.usage }
      } catch (e) { mapErr(e, ctrl) } finally { done() }
    },
    async probe() {
      const checkedAt = new Date().toISOString()
      if (!cfg.apiKey) return { ok: false, checkedAt, detail: 'NOT_CONFIGURED' }
      const t0 = Date.now()
      try {
        // 真实 1 token 补全探测：/models 在账户余额不足（402）时仍返回 2xx，不能代表能生成。
        const r = await fetch(`${cfg.baseUrl}/chat/completions`, { method: 'POST', headers: { ...headers(), 'content-type': 'application/json' }, body: JSON.stringify({ model: cfg.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, stream: false }), signal: AbortSignal.timeout(10000) })
        const detail = r.ok ? 'completion 2xx' : r.status === 402 ? 'NO_BALANCE: 大模型账户余额不足（HTTP 402）' : `HTTP ${r.status}`
        return { ok: r.ok, checkedAt, detail, latencyMs: Date.now() - t0 }
      } catch (e) { return { ok: false, checkedAt, detail: 'unreachable: ' + String((e as Error).message).slice(0, 80) } }
    },
  }
}
