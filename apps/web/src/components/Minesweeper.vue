<script setup lang="ts">
// 扫雷彩蛋。
// 自研实现：9×9、10 颗雷、首点安全、右键/长按插旗、空白自动展开；纯前端，不上报任何数据。
import { computed, ref } from 'vue'
const N = 9, MINES = 10
type Cell = { mine: boolean; open: boolean; flag: boolean; n: number }
const cells = ref<Cell[]>([])
const state = ref<'ready' | 'play' | 'won' | 'lost'>('ready')
const t0 = ref(0), secs = ref(0)
let timer: ReturnType<typeof setInterval> | undefined
function reset() { cells.value = Array.from({ length: N * N }, () => ({ mine: false, open: false, flag: false, n: 0 })); state.value = 'ready'; clearInterval(timer); secs.value = 0 }
reset()
const nb = (i: number) => { const x = i % N, y = Math.floor(i / N), r: number[] = []; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < N && Y < N) r.push(Y * N + X) } return r }
function seed(safe: number) {
  const ban = new Set([safe, ...nb(safe)]); let k = 0
  while (k < MINES) { const i = Math.floor(Math.random() * N * N); if (!ban.has(i) && !cells.value[i].mine) { cells.value[i].mine = true; k++ } }
  cells.value.forEach((c, i) => { c.n = nb(i).filter((j) => cells.value[j].mine).length })
  state.value = 'play'; t0.value = Date.now(); timer = setInterval(() => { secs.value = Math.floor((Date.now() - t0.value) / 1000) }, 1000)
}
function open(i: number) {
  if (state.value === 'won' || state.value === 'lost') return
  if (state.value === 'ready') seed(i)
  const c = cells.value[i]; if (c.open || c.flag) return
  if (c.mine) { c.open = true; state.value = 'lost'; clearInterval(timer); cells.value.forEach((d) => { if (d.mine) d.open = true }); return }
  const stack = [i]
  while (stack.length) { const j = stack.pop()!; const d = cells.value[j]; if (d.open || d.flag) continue; d.open = true; if (d.n === 0) stack.push(...nb(j)) }
  if (cells.value.every((d) => d.mine || d.open)) { state.value = 'won'; clearInterval(timer) }
}
function flag(i: number) { const c = cells.value[i]; if (!c.open && state.value !== 'won' && state.value !== 'lost') c.flag = !c.flag }
let press: ReturnType<typeof setTimeout> | undefined, longed = false
function down(i: number, e: PointerEvent) { if (e.pointerType === 'mouse') return; longed = false; press = setTimeout(() => { longed = true; flag(i) }, 420) }
function up(i: number, e: PointerEvent) { if (e.pointerType === 'mouse') return; clearTimeout(press); if (!longed) open(i) }
const left = computed(() => MINES - cells.value.filter((c) => c.flag).length)
const face = computed(() => ({ ready: '开局', play: '进行中', won: '通关！', lost: '踩雷了' })[state.value])
</script>
<template>
  <div class="ms" aria-label="扫雷小游戏（彩蛋）">
    <div class="hud mono"><span>旗 {{ String(left).padStart(2, '0') }}</span><button class="face" @click="reset" :aria-label="'重新开始，当前：' + face">{{ face }}</button><span>{{ String(secs).padStart(3, '0') }} 秒</span></div>
    <div class="grid" role="grid">
      <button v-for="(c, i) in cells" :key="i" class="c" :class="{ o: c.open, m: c.open && c.mine, f: c.flag, ['n' + c.n]: c.open && !c.mine }"
        @click="(e) => (e as PointerEvent).pointerType === 'mouse' || !(e as PointerEvent).pointerType ? open(i) : null"
        @contextmenu.prevent="flag(i)" @pointerdown="down(i, $event)" @pointerup="up(i, $event)"
        :aria-label="c.open ? (c.mine ? '雷' : c.n ? c.n + '' : '空') : c.flag ? '已插旗' : '未翻开'">
        <template v-if="c.open && c.mine">✱</template><template v-else-if="c.open && c.n">{{ c.n }}</template><template v-else-if="c.flag">▲</template>
      </button>
    </div>
    <p class="tip mono">左键翻开 · 右键或长按插旗</p>
  </div>
</template>
<style scoped>
.ms { display: grid; gap: 8px; justify-items: center; }
.hud { display: flex; justify-content: space-between; align-items: center; width: 100%; font-size: 12px; }
.face { padding: 2px 10px; font-size: 12px; background: var(--butter); }
.grid { display: grid; grid-template-columns: repeat(9, 24px); grid-auto-rows: 24px; border: 1px solid var(--ink); background: var(--ink); gap: 1px; }
.c { padding: 0; border: 0; font-family: var(--mono); font-size: 12px; font-weight: 700; letter-spacing: 0; background: var(--paper-3); box-shadow: inset -2px -2px 0 rgba(20,2,6,.25), inset 2px 2px 0 #fff; transition: none; }
.c:hover:not(.o) { background: var(--pink-l); }
.c.o { background: var(--white); box-shadow: none; } .c.m { background: var(--pink); } .c.f { color: var(--pink); }
.n1 { color: #2b6cb0; } .n2 { color: var(--green-d); } .n3 { color: var(--bad); } .n4 { color: var(--lilac-d); } .n5, .n6, .n7, .n8 { color: var(--orange); }
.tip { margin: 0; font-size: 11px; color: var(--muted); }
</style>
