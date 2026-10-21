// 构建产物不得包含隐藏约束或密钥形态。用法：node tools/scripts/check-bundle-secrets.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
const root = path.resolve('apps/web/dist')
const bad = [/serverOnly/, /buyerMaximum/, /rolePolicy/, /exampleFinalOffer/, /\b1280\b/, /12\.80/, /sk-[A-Za-z0-9]{20,}/, /DEEPSEEK_API_KEY/]
const walk = (d) => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : [p] })
let hits = 0
for (const f of walk(root).filter((f) => /\.(js|css|html|json|map)$/.test(f))) {
  const t = readFileSync(f, 'utf8')
  for (const re of bad) if (re.test(t)) { console.log('HIT', re, path.relative(root, f)); hits++ }
}
console.log(hits ? `FAIL ${hits} hits` : `OK: ${walk(root).length} files scanned, no hidden constraints or keys`)
process.exit(hits ? 1 : 0)
