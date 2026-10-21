<script lang="ts">
let zTop = 10 // 所有窗口共享的置顶计数
</script>
<script setup lang="ts">
// 复古操作系统窗口：标题栏 = 彩色小方块 + 像素字标题 + 细横线填充 + 方形最小化/关闭按钮；硬投影。
// 只能拖标题栏、限制在父容器内、点击置顶；最小化有两种：就地收起（默认），或交给 Dock（dock=true 时发出 minimize）。
import { onBeforeUnmount, ref } from 'vue'

type Tone = 'plain' | 'pink' | 'mint' | 'green' | 'lilac' | 'purple' | 'butter' | 'orange' | 'peach' | 'frost' | 'ink'
const props = withDefaults(defineProps<{
  label: string; tone?: Tone
  draggable?: boolean; minimizable?: boolean; closable?: boolean; lift?: boolean; center?: boolean; bodyClass?: string
  dock?: boolean; enter?: boolean
}>(), { tone: 'plain', draggable: false, minimizable: false, closable: false, lift: false, center: false, bodyClass: '', dock: false, enter: false })
const emit = defineEmits<{ close: []; minimize: [] }>()

const el = ref<HTMLElement | null>(null)
const pos = ref({ x: 0, y: 0 })
const z = ref(1)
const mini = ref(false)
const dragging = ref(false)
let start: { px: number; py: number; x: number; y: number } | null = null

const canDrag = () => props.draggable && window.matchMedia('(pointer: fine) and (min-width: 1100px)').matches
function down(e: PointerEvent) {
  z.value = ++zTop
  if (!canDrag() || (e.target as HTMLElement).closest('button')) return
  start = { px: e.clientX, py: e.clientY, x: pos.value.x, y: pos.value.y }
  dragging.value = true
  ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
}
function move(e: PointerEvent) {
  if (!start || !el.value) return
  const parent = el.value.offsetParent as HTMLElement | null
  let x = start.x + e.clientX - start.px, y = start.y + e.clientY - start.py
  if (parent) { // 限制在父容器内
    const r = el.value.getBoundingClientRect(), pr = parent.getBoundingClientRect()
    const bx = r.left - pos.value.x, by = r.top - pos.value.y
    x = Math.min(Math.max(x, pr.left - bx), pr.right - bx - r.width)
    y = Math.min(Math.max(y, pr.top - by), Math.max(pr.top - by, pr.bottom - by - r.height))
  }
  pos.value = { x, y }
}
function up() { start = null; dragging.value = false }
function minimize() { if (props.dock) emit('minimize'); else mini.value = !mini.value }
function reset() { pos.value = { x: 0, y: 0 } }
defineExpose({ reset })
onBeforeUnmount(up)
</script>

<template>
  <section ref="el" class="win" :class="[`t-${tone}`, { lift, mini, drag: draggable, dragging, enter }]" :style="{ transform: pos.x || pos.y ? `translate(${pos.x}px, ${pos.y}px)` : undefined, zIndex: z }" :aria-label="label" @pointerdown="z = ++zTop">
    <header class="bar" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up" :class="{ center }">
      <span class="tag"><i class="sq"></i>{{ label }}</span>
      <span class="rule" aria-hidden="true"></span>
      <slot name="bar" />
      <button v-if="minimizable" class="box" :aria-label="dock ? `最小化${label}窗口` : mini ? '展开窗口' : '收起窗口'" :aria-expanded="dock ? undefined : !mini" @click="minimize"><svg viewBox="0 0 10 10"><path :d="mini ? 'M2 5h6M5 2v6' : 'M2 6.5h6'" /></svg></button>
      <button v-if="closable" class="box" aria-label="关闭" @click="emit('close')"><svg viewBox="0 0 10 10"><path d="M2 2l6 6M8 2L2 8" /></svg></button>
    </header>
    <div v-show="!mini" class="body" :class="bodyClass"><slot /></div>
  </section>
</template>

<style scoped>
.win { position: relative; background: var(--white); border: 1px solid var(--line); display: flex; flex-direction: column; min-width: 0; transition: box-shadow .2s; }
.win.lift { box-shadow: var(--shadow); }
.win.enter { animation: win-up .45s var(--ease) both; }
.win.dragging { box-shadow: 9px 11px 0 0 var(--ink); }
.bar { display: flex; align-items: center; gap: 10px; height: 30px; padding: 0 6px 0 10px; border-bottom: 1px solid var(--line); background: var(--paper); user-select: none; flex: none; touch-action: none; }
.drag .bar { cursor: grab; } .dragging .bar { cursor: grabbing; }
.mini .bar { border-bottom: 0; }
.tag { display: inline-flex; align-items: center; gap: 7px; font-family: var(--pixel); font-size: 13px; white-space: nowrap; color: var(--ink); }
.sq { width: 10px; height: 10px; background: var(--ink); flex: none; }
/* 标题两侧的细横线：1px 墨线 + 2px 间隔重复 */
.rule { flex: 1; min-width: 20px; height: 11px; background: repeating-linear-gradient(to bottom, var(--ink) 0 1px, transparent 1px 3px); opacity: .9; }
.center { justify-content: center; } .center .rule:first-child { order: -1; }
.box { width: 20px; height: 20px; padding: 0; display: grid; place-items: center; background: var(--white); border: 1px solid var(--ink); flex: none; box-shadow: none; }
.box svg { width: 10px; height: 10px; stroke: var(--ink); stroke-width: 1.4; fill: none; }
.box:hover { background: var(--pink-xl) !important; }
.body { padding: 18px 20px; min-width: 0; flex: 1; }
.t-pink .bar { background: var(--pink-xl); } .t-pink .sq { background: var(--pink); }
.t-mint .bar, .t-green .bar { background: var(--mint); } .t-mint .sq, .t-green .sq { background: var(--green-d); }
.t-lilac .bar, .t-purple .bar { background: var(--lilac); } .t-lilac .sq, .t-purple .sq { background: var(--purple-d); }
.t-butter .bar, .t-orange .bar { background: var(--butter); } .t-butter .sq, .t-orange .sq { background: var(--orange); }
.t-peach .bar { background: var(--peach); } .t-peach .sq { background: var(--ink); }
.t-frost .bar { background: var(--frost); } .t-frost .sq { background: #2b6cb0; }
.t-ink .bar { background: var(--ink); color: #fff; } .t-ink .tag { color: #fff; } .t-ink .sq { background: var(--pink); } .t-ink .rule { background: repeating-linear-gradient(to bottom, #fff 0 1px, transparent 1px 3px); }
@media (max-width: 760px) { .body { padding: 14px; } }
@media print { .win { border-color: #000; } .bar { background: #fff !important; } .box { display: none; } }
</style>
