import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../../..')

function num(name: string, def: number) {
  const v = Number(process.env[name])
  return Number.isFinite(v) && v > 0 ? v : def
}

export interface Config {
  port: number
  host: string
  basePath: string // e.g. /human  -> API at /human/api
  contentFile: string
  webDist: string | null
  llm: { baseUrl: string; model: string; apiKey: string | null; timeoutMs: number }
  tts: { mode: 'edge' | 'off'; voice: string; python: string; timeoutMs: number }
  limits: { textMax: number; globalGen: number; ttsMax: number; sessionTtlMs: number; maxSessions: number }
  cookieSecure: boolean
}

export function loadConfig(env = process.env): Config {
  const basePath = (env.BASE_PATH ?? '/human').replace(/\/$/, '')
  return {
    port: num('PORT', 8420),
    host: env.HOST ?? '127.0.0.1',
    basePath,
    contentFile: env.CONTENT_FILE ?? path.join(root, 'content/course.json'),
    webDist: env.SERVE_WEB === '1' ? path.join(root, 'apps/web/dist') : null,
    llm: {
      baseUrl: (env.LLM_BASE_URL ?? 'https://api.deepseek.com').replace(/\/$/, ''),
      model: env.LLM_MODEL ?? 'deepseek-flash',
      apiKey: env.DEEPSEEK_API_KEY && env.DEEPSEEK_API_KEY.length > 4 ? env.DEEPSEEK_API_KEY : null,
      timeoutMs: num('LLM_TIMEOUT_MS', 30_000),
    },
    tts: {
      mode: env.TTS_MODE === 'off' ? 'off' : 'edge',
      voice: env.TTS_VOICE_TEACHER ?? 'zh-CN-YunyangNeural',
      python: env.TTS_PYTHON ?? 'python3',
      timeoutMs: num('TTS_TIMEOUT_MS', 15_000),
    },
    limits: { textMax: 1500, globalGen: num('GLOBAL_GEN', 2), ttsMax: 300, sessionTtlMs: 2 * 3600_000, maxSessions: 500 },
    cookieSecure: env.COOKIE_SECURE === '1',
  }
}
