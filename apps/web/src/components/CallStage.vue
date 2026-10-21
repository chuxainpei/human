<script setup lang="ts">
// 视频通话窗口（首页“和陈老师面对面”的延续）：大画面 = 当前讲话的人；情景磋商时另一位缩进右下角画中画。
// 形象沿用 HumanStage 的口型/眨眼贴片：嘴型只由真实音频音量驱动（没有声音就不开口），眨眼随机，轻微呼吸位移。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { AVATARS, type AvatarId } from '../lib/avatars'

const props = withDefaults(defineProps<{
  main: AvatarId; pip?: AvatarId | null; phase: 'idle' | 'thinking' | 'speaking' | 'error'; level?: () => number
  subtitle?: string; reducedMotion?: boolean; paused?: boolean; errorText?: string; title?: string
}>(), { pip: null, level: () => -1, subtitle: '', reducedMotion: false, paused: false, errorText: '', title: '面对面课堂' })
const emit = defineEmits<{ retry: []; swap: [] }>()

const base = import.meta.env.BASE_URL + 'assets/avatar/'
const mouth = ref(0)
const blink = ref(0)
const blinkPip = ref(0)
const sway = ref({ x: 0, y: 0, s: 1 })
let raf = 0, smooth = 0
const t0 = performance.now()
let nextBlink = t0 + 2500, blinkUntil = 0, nextBlinkPip = t0 + 4100, blinkPipUntil = 0

function frame(now: number) {
  const speaking = props.phase === 'speaking'
  let target = 0
  if (speaking) {
    const lv = props.level()
    target = lv >= 0 ? Math.min(1, Math.max(0, (lv - 0.015) * 7)) : 0.35 + 0.35 * Math.abs(Math.sin((now - t0) / 95))
  }
  smooth += (target - smooth) * (target > smooth ? 0.55 : 0.3)
  mouth.value = smooth < 0.03 ? 0 : smooth
  if (!props.reducedMotion) {
    if (now > nextBlink) { blinkUntil = now + 130; nextBlink = now + 2600 + Math.random() * 3200 }
    if (now > nextBlinkPip) { blinkPipUntil = now + 130; nextBlinkPip = now + 3000 + Math.random() * 3600 }
    blink.value = now < blinkUntil ? 1 : 0
    blinkPip.value = now < blinkPipUntil ? 1 : 0
    const k = (now - t0) / 1000, amp = speaking ? 1 : 0.6
    sway.value = { x: Math.sin(k * 0.45) * 0.35 * amp, y: Math.sin(k * 0.9) * 0.25 * amp, s: 1.012 + Math.sin(k * 0.6) * 0.004 }
  } else { blink.value = 0; blinkPip.value = 0; sway.value = { x: 0, y: 0, s: 1 } }
  raf = requestAnimationFrame(frame)
}
onMounted(() => { raf = requestAnimationFrame(frame) })
onBeforeUnmount(() => cancelAnimationFrame(raf))

// 换人：交叉淡入（讲话的人放大）
const shown = ref<AvatarId>(props.main)
const fading = ref(false)
watch(() => props.main, (r) => { fading.value = true; setTimeout(() => { shown.value = r; fading.value = false }, props.reducedMotion ? 0 : 240) })
const a = computed(() => AVATARS[shown.value])
const p = computed(() => (props.pip ? AVATARS[props.pip] : null))
const pos = (q: { left: number; top: number; width: number; height: number }) => ({ left: q.left + '%', top: q.top + '%', width: q.width + '%', height: q.height + '%' })
const LIGHTS = [{ k: 'idle', t: '倾听' }, { k: 'thinking', t: '思考' }, { k: 'speaking', t: '讲话' }] as const
const who = computed(() => (shown.value === 'buyer' ? 'Markus Weber' : '陈老师'))
</script>

<template>
  <section class="call" :class="[`is-${phase}`, { fading, paused }]" :data-phase="phase" :data-role="shown" :aria-label="title">
    <header class="bar">
      <span class="tag"><i class="sq"></i>{{ title }}</span>
      <span class="rule" aria-hidden="true"></span>
      <span class="live"><i></i>{{ phase === 'error' ? '已断开' : '通话中' }}</span>
    </header>
    <div class="screen" role="img" :aria-label="`${a.name}的画面`">
      <div class="frame" :style="{ transform: `translate(${sway.x}%, ${sway.y}%) scale(${sway.s})` }">
        <img class="base" :src="base + a.image" alt="" draggable="false" />
        <img class="patch" :src="base + a.eyes.src" :style="{ ...pos(a.eyes), opacity: blink }" alt="" draggable="false" />
        <img class="patch" :src="base + a.mouth.src" :style="{ ...pos(a.mouth), opacity: mouth }" alt="" draggable="false" />
      </div>
      <div class="scan" aria-hidden="true"></div>
      <div class="name"><b>{{ a.name }}</b><span>{{ shown === 'buyer' ? '模拟买家' : '经管课老师' }}</span></div>
      <p v-if="subtitle" class="cc" aria-live="off">{{ subtitle }}</p>
      <div v-if="phase === 'thinking'" class="think" aria-hidden="true"><i></i><i></i><i></i></div>
      <Transition name="pip">
        <button v-if="p" type="button" class="pip" :aria-label="`把${p.name}放大`" @click="emit('swap')">
          <span class="pip__f">
            <img class="base" :src="base + p.image" alt="" draggable="false" />
            <img class="patch" :src="base + p.eyes.src" :style="{ ...pos(p.eyes), opacity: blinkPip }" alt="" draggable="false" />
          </span>
          <span class="pip__n">{{ p.name }}</span>
        </button>
      </Transition>
      <div v-if="paused" class="veil"><b>已暂停</b><span>点“继续”回到刚才的环节</span></div>
      <div v-if="phase === 'error' && errorText" class="veil err" role="alert">
        <b>{{ shown === 'buyer' ? '买家暂时掉线了' : '陈老师暂时离开了讲台' }}</b>
        <span>{{ errorText }}</span>
        <button class="px-btn is-pink" @click="emit('retry')">知道了</button>
      </div>
    </div>
    <footer class="ctrl">
      <div class="btns"><slot /></div>
      <div class="lights" role="status" :aria-label="`${who}：${LIGHTS.find((l) => l.k === phase)?.t ?? '出错'}`">
        <span v-for="l in LIGHTS" :key="l.k" class="lt" :class="[`lt-${l.k}`, { on: phase === l.k }]"><i></i>{{ l.t }}</span>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.call { position: relative; background: var(--white); border: 1px solid var(--line); box-shadow: var(--shadow-lg); display: flex; flex-direction: column; animation: win-up .45s var(--ease) both; }
.bar { display: flex; align-items: center; gap: 10px; height: 30px; padding: 0 8px 0 10px; border-bottom: 1px solid var(--line); background: var(--pink-xl); flex: none; }
.tag { display: inline-flex; align-items: center; gap: 7px; font: 400 13px/1 var(--pixel); white-space: nowrap; color: var(--ink); }
.sq { width: 10px; height: 10px; background: var(--pink); }
.rule { flex: 1; min-width: 16px; height: 11px; background: repeating-linear-gradient(to bottom, var(--ink) 0 1px, transparent 1px 3px); }
.live { display: inline-flex; align-items: center; gap: 6px; height: 20px; padding: 0 8px; font: 400 12px/1 var(--pixel); background: var(--ink); color: #fff; white-space: nowrap; }
.live i { width: 7px; height: 7px; background: var(--green); animation: blinkSq 1s steps(1, end) infinite; }
.is-error .live i { background: #9a948c; animation: none; }
@keyframes blinkSq { 50% { opacity: 0; } }
.screen { position: relative; aspect-ratio: 16 / 9; overflow: hidden; background: #2a2420; isolation: isolate; }
.frame { position: absolute; inset: 0; transform-origin: 50% 40%; will-change: transform; transition: opacity .24s ease; }
.fading .frame { opacity: 0; }
.base, .patch { position: absolute; display: block; user-select: none; pointer-events: none; }
.base { inset: 0; width: 100%; height: 100%; object-fit: cover; }
.patch { transition: opacity 40ms linear; }
.scan { position: absolute; inset: 0; pointer-events: none; background: repeating-linear-gradient(to bottom, rgba(0,0,0,.045) 0 1px, transparent 1px 3px), linear-gradient(180deg, transparent 55%, rgba(20,2,6,.6) 100%); }
.name { position: absolute; left: 0; top: 0; display: flex; align-items: stretch; border-bottom: 1px solid var(--ink); border-right: 1px solid var(--ink); background: var(--white); }
.name b { font: 400 17px/1.5 var(--serif); padding: 2px 12px; border-right: 1px solid var(--ink); color: var(--ink); white-space: nowrap; }
.name span { font: 400 12px/1 var(--pixel); padding: 0 10px; display: flex; align-items: center; color: var(--text); background: var(--paper); white-space: nowrap; }
.cc { position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%); width: max-content; max-width: min(78%, 720px); margin: 0; padding: 7px 14px; background: rgba(20,2,6,.84); color: #fff; font-size: 17px; line-height: 1.5; text-align: center; border: 1px solid rgba(255,255,255,.2); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.think { position: absolute; right: 14px; top: 14px; display: flex; gap: 4px; padding: 7px 9px; background: var(--white); border: 1px solid var(--ink); }
.think i { width: 6px; height: 6px; background: var(--ink); animation: hop 1s steps(2, end) infinite; } .think i:nth-child(2) { animation-delay: .2s; } .think i:nth-child(3) { animation-delay: .4s; }
@keyframes hop { 50% { transform: translateY(-4px); background: var(--pink); } }
.pip { position: absolute; right: 14px; bottom: 14px; width: 24%; min-width: 120px; padding: 0; border: 1px solid var(--ink); background: var(--white); box-shadow: 4px 4px 0 var(--ink); display: grid; cursor: pointer; z-index: 3; }
.pip__f { position: relative; display: block; aspect-ratio: 16 / 9; overflow: hidden; background: #2a2420; }
.pip__n { display: block; padding: 3px 8px; font: 400 12px/1.3 var(--pixel); text-align: left; border-top: 1px solid var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pip:hover { background: var(--pink-xl) !important; }
.pip-enter-active { transition: transform .5s var(--ease), opacity .3s; } .pip-leave-active { transition: transform .3s ease, opacity .3s; }
.pip-enter-from, .pip-leave-to { transform: translate(40px, 60px) scale(.8); opacity: 0; }
.veil { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: 8px; text-align: center; padding: 20px; background: rgba(20,2,6,.42); backdrop-filter: blur(10px); color: #fff; z-index: 4; }
.veil b { font: 400 clamp(20px, 2.4vw, 30px)/1.2 var(--serif); } .veil span { font-size: 14px; max-width: 440px; }
.ctrl { display: flex; align-items: stretch; justify-content: space-between; border-top: 1px solid var(--line); background: var(--paper); }
.btns { display: flex; flex: 1; min-width: 0; }
.lights { display: flex; align-items: center; gap: 10px; padding: 0 12px; border-left: 1px solid var(--line); background: var(--white); }
.lt { display: inline-flex; align-items: center; gap: 5px; font: 400 13px/1 var(--pixel); color: var(--muted); white-space: nowrap; }
.lt i { width: 10px; height: 10px; border: 1px solid var(--ink); background: var(--paper-2); }
.lt.on { color: var(--ink); }
.lt-idle.on i { background: #2b6cb0; } .lt-thinking.on i { background: var(--orange); animation: blinkSq .5s steps(1, end) infinite; } .lt-speaking.on i { background: var(--green); animation: blinkSq .35s steps(1, end) infinite; }
@media (max-width: 1099px) {
  .call { box-shadow: none; animation: none; }
  .bar { height: 26px; }
  .cc { bottom: 10px; font-size: 14px; max-width: 92%; padding: 5px 10px; }
  .name b { font-size: 14px; padding: 1px 8px; } .name span { display: none; }
  .pip { width: 30%; min-width: 96px; right: 8px; bottom: 8px; box-shadow: 3px 3px 0 var(--ink); }
  .pip__n { font-size: 11px; padding: 2px 6px; }
  .lights { gap: 6px; padding: 0 8px; } .lt { font-size: 12px; gap: 4px; }
}
@media (max-width: 420px) { .lt:not(.on) { display: none; } }
@media (prefers-reduced-motion: reduce) { .frame { transition: none; } }
</style>
