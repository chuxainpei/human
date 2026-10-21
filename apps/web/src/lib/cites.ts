// 出处标记：服务端回答里的 [F-…] 一律渲染为上标 [1] [2]（按本节课第一次出现的顺序编号），点开看原文；页面上不显示内部编号。
import type { Citation } from './api'

const TOKEN = /\[(F-[A-Z]+-\d{2})\]/g
const PARTIAL = /\[(?:F(?:-[A-Z]*(?:-\d{0,2})?)?)?$/ // 流式输出时句尾还没写完的标记

export type Seg = { t: 'text'; v: string } | { t: 'cite'; n: number; c: Citation }

/** 本节课的出处表：按文本中第一次出现的顺序。lookup 先查回合自带的 citations，再查课程 facts。 */
export function buildRegistry(turns: { text: string; citations?: Citation[] }[], facts: Citation[] = []) {
  const order: Citation[] = []
  const seen = new Set<string>()
  for (const t of turns) {
    const own = new Map((t.citations ?? []).map((c) => [c.id, c]))
    for (const m of t.text.matchAll(TOKEN)) {
      const id = m[1]
      if (seen.has(id)) continue
      const c = own.get(id) ?? facts.find((f) => f.id === id)
      if (!c) continue
      seen.add(id); order.push(c)
    }
    for (const c of t.citations ?? []) if (!seen.has(c.id)) { seen.add(c.id); order.push(c) }
  }
  return order
}

/** 把一段回答切成文字 + 上标；未知编号直接去掉，句尾半截标记先隐藏。 */
export function segments(text: string, registry: Citation[], streaming = false): Seg[] {
  const src = streaming ? text.replace(PARTIAL, '') : text
  const out: Seg[] = []
  let last = 0
  for (const m of src.matchAll(TOKEN)) {
    const before = src.slice(last, m.index).replace(/[ \u3000]+$/, '')
    if (before) out.push({ t: 'text', v: before })
    const i = registry.findIndex((c) => c.id === m[1])
    if (i >= 0) {
      const prev = out[out.length - 1]
      if (!(prev && prev.t === 'cite' && prev.n === i + 1)) out.push({ t: 'cite', n: i + 1, c: registry[i] })
    }
    last = (m.index ?? 0) + m[0].length
  }
  const rest = src.slice(last)
  if (rest) out.push({ t: 'text', v: rest })
  return out
}

/** 纯文本（字幕、朗读、打印）：去掉标记。 */
export const plain = (t: string) => t.replace(TOKEN, '').replace(PARTIAL, '').replace(/[ \u3000]+([，。；！？、])/g, '$1')
