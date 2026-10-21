import { loadConfig } from './config.js'
import { buildApp } from './app.js'

const cfg = loadConfig()
const app = buildApp(cfg)
app.listen({ port: cfg.port, host: cfg.host }).then(() => {
  app.log.info(`Mori Classroom API on http://${cfg.host}:${cfg.port}${cfg.basePath}/api  (llm=${cfg.llm.model}, key=${cfg.llm.apiKey ? 'set' : 'MISSING'}, tts=${cfg.tts.mode})`)
})
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { void app.close().then(() => process.exit(0)) })
