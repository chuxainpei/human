import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const BASE = '/human/'
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url))
const HOME = here('./home/index.html') // 静态首页，原样输出为 dist/index.html

// 首页是一份静态 HTML（不经过 Vite 打包）；Vue 应用的入口是 app.html。
// 开发时：/human/ → 首页；/human/learn、/human/report 等应用路由 → app.html。
function homepage(): Plugin {
  return {
    name: 'dunang-homepage',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0]
        if (url === BASE || url === BASE + 'index.html') {
          res.setHeader('content-type', 'text/html; charset=utf-8'); res.setHeader('cache-control', 'no-cache')
          res.end(readFileSync(HOME, 'utf8')); return
        }
        if (/^\/human\/(learn|report|entry)(\/|$)/.test(url)) req.url = BASE + 'app.html' + (req.url!.includes('?') ? req.url!.slice(req.url!.indexOf('?')) : '')
        next()
      })
    },
    closeBundle() { writeFileSync(here('./dist/index.html'), readFileSync(HOME, 'utf8')) },
  }
}

export default defineConfig({
  base: BASE,
  plugins: [vue(), homepage()],
  server: { port: 5180, host: '127.0.0.1', proxy: { '/human/api': { target: 'http://127.0.0.1:8420', changeOrigin: false } } },
  preview: { port: 5181, host: '127.0.0.1', proxy: { '/human/api': { target: 'http://127.0.0.1:8420' } } },
  build: { sourcemap: false, target: 'es2020', rollupOptions: { input: { app: here('./app.html') } } },
})
