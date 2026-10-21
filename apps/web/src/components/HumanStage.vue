<script setup lang="ts">
// 面对面视频窗口。
// 写实照片形象（AI 生成的虚构人物）+ 2.5D 贴片：嘴型透明度只由真实音频音量驱动；眨眼随机；轻微呼吸位移。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { AVATARS, type AvatarId } from '../lib/avatars'

const props = withDefaults(defineProps<{
  role: AvatarId; phase: 'idle' | 'thinking' | 'speaking' | 'error'; level?: () => number
  caption?: string; reducedMotion?: boolean; compact?: boolean; live?: boolean; label?: string; errorText?: string
}>(), { level: () => -1, caption: '', reducedMotion: false, compact: false, live: true, label: '面对面课堂', errorText: '' })
const emit = defineEmits<{ retry: [] }>()

const base = import.meta.env.BASE_URL + 'assets/avatar/'
const mouth = ref(0)
const blink = ref(0)
const sway = ref({ x: 0, y: 0, s: 1 })
let raf = 0, t0 = performance.now(), nextBlink = performance.now() + 2500, blinkUntil = 0, smooth = 0

function frame(now: number) {
  const speaking = props.phase === 'speaking'
  let target = 0
  if (speaking) {
    const lv = props.level()
    // 有音量分析：按音量；无分析器（浏览器语音兜底）：按节奏，但仍只在播放事件后才动
    target = lv >= 0 ? Math.min(1, Math.max(0, (lv - 0.015) * 7)) : 0.35 + 0.35 * Math.abs(Math.sin((now - t0) / 95))
  }
  smooth += (target - smooth) * (target > smooth ? 0.55 : 0.3)
  mouth.value = smooth < 0.03 ? 0 : smooth
  if (!props.reducedMotion) {
    if (now > nextBlink) { blinkUntil = now + 130; nextBlink = now + 2600 + Math.random() * 3200 }
    blink.value = now < blinkUntil ? 1 : 0
    const k = (now - t0) / 1000
    const amp = speaking ? 1 : 0.6
    sway.value = { x: Math.sin(k * 0.45) * 0.35 * amp, y: Math.sin(k * 0.9) * 0.25 * amp, s: 1.012 + Math.sin(k * 0.6) * 0.004 }
  } else { blink.value = 0; sway.value = { x: 0, y: 0, s: 1 } }
  raf = requestAnimationFrame(frame)
}
onMounted(() => { raf = requestAnimationFrame(frame) })
onBeforeUnmount(() => cancelAnimationFrame(raf))

// 角色切换：交叉淡入
const shown = ref<AvatarId>(props.role)
const fading = ref(false)
watch(() => props.role, (r) => { fading.value = true; setTimeout(() => { shown.value = r; fading.value = false }, props.reducedMotion ? 0 : 260) })
const a = computed(() => AVATARS[shown.value])
const pos = (p: { left: number; top: number; width: number; height: number }) => ({ left: p.left + '%', top: p.top + '%', width: p.width + '%', height: p.height + '%' })
const stateLabel = computed(() => ({ idle: props.role === 'buyer' ? '等你开口' : '待命', thinking: props.role === 'buyer' ? '买家在考虑…' : '正在思考…', speaking: '正在讲话', error: '连接出错' })[props.phase])
</script>

<template>
  <div class="stage" :class="[`is-${phase}`, { compact, fading }]" :data-phase="phase" :data-role="shown">
    <header class="bar">
      <span class="tag"><i class="sq"></i>{{ label }}</span>
      <span class="rule" aria-hidden="true"></span>
      <span v-if="live" class="live"><i></i>{{ phase === 'error' ? 'OFFLINE' : 'LIVE' }}</span>
      <span class="state" role="status" aria-live="polite"><i class="dot"></i>{{ stateLabel }}</span>
    </header>
    <div class="screen" role="img" :aria-label="`${a.name}，${stateLabel}`">
      <div class="frame" :style="{ transform: `translate(${sway.x}%, ${sway.y}%) scale(${sway.s})` }">
        <img class="base" :src="base + a.image" alt="" draggable="false" />
        <img class="patch" :src="base + a.eyes.src" :style="{ ...pos(a.eyes), opacity: blink }" alt="" draggable="false" />
        <img class="patch" :src="base + a.mouth.src" :style="{ ...pos(a.mouth), opacity: mouth }" alt="" draggable="false" />
      </div>
      <div class="scan" aria-hidden="true"></div>
      <div class="name" :class="{ hidecap: !!caption && phase === 'speaking' }"><b>{{ a.name }}</b><span>{{ a.title }}</span></div>
      <p v-if="caption && phase === 'speaking'" class="cc" aria-hidden="true">{{ caption }}</p>
      <div class="think" v-if="phase === 'thinking'" aria-hidden="true"><i></i><i></i><i></i></div>
      <div v-if="phase === 'error' && errorText" class="busy" role="alert">
        <h3>{{ shown === 'buyer' ? '买家暂时掉线了' : '陈老师暂时离开了讲台' }}</h3>
        <p>{{ errorText }}</p>
        <button class="primary" @click="emit('retry')">知道了</button>
      </div>
      <div v-if="$slots.cta" class="cta"><slot name="cta" /></div>
    </div>
    <div v-if="$slots.default" class="ctrl"><slot /></div>
  </div>
</template>

<style scoped>
.stage { position: relative; background: var(--white); border: 1px solid var(--line); display: flex; flex-direction: column; }
.bar { display: flex; align-items: center; gap: 10px; height: 30px; padding: 0 8px 0 10px; border-bottom: 1px solid var(--line); background: var(--paper); flex: none; }
.tag { display: inline-flex; align-items: center; gap: 7px; font-family: var(--mono); font-size: 12px; letter-spacing: .06em; white-space: nowrap; color: var(--ink); }
.sq { width: 9px; height: 9px; background: var(--pink); }
.rule { flex: 1; min-width: 16px; height: 11px; background: repeating-linear-gradient(to bottom, var(--ink) 0 1px, transparent 1px 3px); }
.live, .state { display: inline-flex; align-items: center; gap: 6px; height: 20px; padding: 0 8px; font-family: var(--mono); font-size: 12px; letter-spacing: .05em; border: 1px solid var(--ink); background: var(--white); color: var(--ink); white-space: nowrap; }
.live { background: var(--ink); color: #fff; }
.live i { width: 7px; height: 7px; background: var(--pink); animation: blinkSq 1s steps(1, end) infinite; }
.is-error .live i { background: #9a948c; animation: none; }
.dot { width: 7px; height: 7px; background: #9a948c; }
.is-thinking .dot { background: var(--orange); animation: blinkSq .5s steps(1, end) infinite; }
.is-speaking .dot { background: var(--green-d); animation: blinkSq .35s steps(1, end) infinite; }
.is-speaking .state { background: var(--mint); }
.is-error .dot { background: var(--bad); }
@keyframes blinkSq { 50% { opacity: 0; } }
.screen { position: relative; aspect-ratio: 16 / 9; overflow: hidden; background: #2a2420; isolation: isolate; }
.frame { position: absolute; inset: 0; transform-origin: 50% 40%; will-change: transform; transition: opacity .26s ease; }
.fading .frame { opacity: 0; }
.base, .patch { position: absolute; display: block; user-select: none; pointer-events: none; }
.base { inset: 0; width: 100%; height: 100%; object-fit: cover; }
.patch { transition: opacity 40ms linear; }
/* 极淡的扫描线 + 底部压暗：像素/抖动影像质感，但不影响人物识别 */
.scan { position: absolute; inset: 0; pointer-events: none; background: repeating-linear-gradient(to bottom, rgba(0,0,0,.05) 0 1px, transparent 1px 3px), linear-gradient(180deg, transparent 58%, rgba(20,2,6,.62) 100%); }
.name { position: absolute; left: 0; bottom: 0; display: flex; align-items: stretch; border-top: 1px solid var(--ink); border-right: 1px solid var(--ink); background: var(--white); transition: opacity .2s; }
.name b { font-family: var(--serif); font-weight: 400; font-size: 17px; padding: 4px 12px; border-right: 1px solid var(--ink); color: var(--ink); white-space: nowrap; }
.name span { font-family: var(--mono); font-size: 12px; letter-spacing: .04em; padding: 0 12px; display: flex; align-items: center; color: var(--text); background: var(--paper); white-space: nowrap; }
.cc { position: absolute; left: 50%; bottom: 46px; transform: translateX(-50%); width: max-content; max-width: min(80%, 760px); margin: 0; padding: 7px 14px; background: rgba(20,2,6,.82); color: #fff; font-size: 16px; line-height: 1.5; text-align: center; border: 1px solid rgba(255,255,255,.18); }
.think { position: absolute; right: 14px; top: 14px; display: flex; gap: 4px; padding: 6px 8px; background: var(--white); border: 1px solid var(--ink); }
.think i { width: 6px; height: 6px; background: var(--ink); animation: hop 1s steps(2, end) infinite; } .think i:nth-child(2) { animation-delay: .2s; } .think i:nth-child(3) { animation-delay: .4s; }
@keyframes hop { 50% { transform: translateY(-4px); background: var(--pink); } }
.busy { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: 10px; text-align: center; padding: 20px; background: rgba(20,2,6,.35); backdrop-filter: blur(14px); color: #fff; }
.busy h3 { color: #fff; font-size: clamp(20px, 2.4vw, 28px); margin: 0; } .busy p { margin: 0; max-width: 460px; font-size: 14px; }
.cta { position: absolute; right: 16px; bottom: 16px; display: flex; }
.ctrl { display: flex; flex-wrap: wrap; border-top: 1px solid var(--line); background: var(--paper); }
.compact .cc { display: none; }
@media (max-width: 760px) {
  .name b { font-size: 15px; padding: 3px 9px; } .name span { display: none; }
  .cc { bottom: 36px; font-size: 13.5px; max-width: 94%; } .name.hidecap { opacity: 0; }
  .bar .state { display: none; }
}
@media (prefers-reduced-motion: reduce) { .frame { transition: none; } }
</style>
