<script setup lang="ts">
// 课程入口 v2：和首页同一套语言——像素天空、衬线大标题、复古窗口里循环播放陈老师的视频、事实条跑马灯、文件夹标签课程地图。
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { loadEntry, startSession, state } from '../lib/store'
import Win from '../components/Win.vue'
import TypedLine from '../components/TypedLine.vue'
import PixelField from '../components/PixelField.vue'

const router = useRouter()
const base = import.meta.env.BASE_URL
const starting = ref(false)
const err = ref('')
onMounted(() => { if (!state.course) void loadEntry() })
async function start() {
  starting.value = true; err.value = ''
  try { await startSession(); await router.push('/learn') } catch (e) { err.value = (e as Error).message } finally { starting.value = false }
}
const kase = computed(() => state.course?.case)
const money = (c?: number) => (c === undefined ? '—' : (c / 100).toFixed(2))
const FACTS = [['3', '张知识卡'], ['7', '条课程资料'], ['1', '个磋商案例'], ['3', '项表达观察'], ['1', '份学习报告']]
const STEPS = [
  { t: '认识任务', h: '你是出口企业的业务员', d: '海外买家要 500 件教学样品。先弄清要报什么、谈什么、最后交什么。' },
  { t: '概念讲解', h: '三张知识卡，一张一张讲', d: '毛利与毛利率、完整报价的条件、磋商中怎样解释和回应。没听懂就点“换个例子”，换一组新数字再讲。' },
  { t: '情景练习', h: '和 Markus Weber 讨价还价', d: '围绕单价、首付款和交期来回磋商 4–6 轮。他不说出自己的底线，也不替你写方案。' },
  { t: '反馈', h: '提交方案，逐项核算', d: '收入、成本、毛利、毛利率和加成率逐项算给你看；表达建议附上你的原话。' },
  { t: '复练', h: '只练你没掌握的部分', d: '按你方案里的实际错误出一道题，先作答，再公布答案和讲评。' },
  { t: '完成', h: '拿到一份学习报告', d: '对话、方案、核算、建议、复练和引用资料都在里面，可以打印或存为 PDF。' },
]
const step = ref(0)
</script>

<template>
  <main class="entry">
    <section class="hero sky-bg">
      <PixelField :cols="72" :rows="16" :density="0.03" :colors="['#ffffff', '#d8edff', '#ffb4c5', '#d0c9ed']" />
      <div class="hero__in">
        <div class="copy">
          <span class="label pink">课程入口 · 约 20 分钟</span>
          <h1>出口报价<br />与交易磋商</h1>
          <p class="typed">今天和陈老师一起<TypedLine :lines="['弄懂毛利率', '写全一份报价', '和买家谈一轮', '只练错的地方']" /></p>
          <p class="lead">一位能讲、能答、能陪你和买家谈判，并给出可核对反馈的经管课老师。打开网页就能上课，不用注册。</p>
          <div class="btns">
            <button class="px-btn is-pink big" :disabled="starting || !state.course" @click="start">{{ starting ? '正在接通…' : '开始上课' }}</button>
            <a class="px-btn big" :href="base">先看看首页</a>
          </div>
          <p v-if="err" class="pill bad">{{ err }}</p>
        </div>
        <div class="callwrap">
          <Win label="和陈老师面对面" tone="pink" lift enter body-class="nopad">
            <div class="vid">
              <video autoplay loop muted playsinline preload="metadata" :poster="`${base}home/video/hero-chen.jpg`" :src="`${base}home/video/hero-chen.mp4`" aria-label="陈老师在讲台上等你"></video>
              <span class="tagname"><b>陈老师</b><i>经管课老师</i></span>
              <button class="callbtn px-btn is-green" :disabled="starting || !state.course" @click="start"><span class="dot"></span>和陈老师面对面</button>
            </div>
          </Win>
        </div>
      </div>
    </section>

    <div class="marquee" aria-label="一节课里有">
      <div class="marquee__track">
        <template v-for="k in 2" :key="k"><span v-for="f in FACTS" :key="k + f[1]" class="fact" :aria-hidden="k === 2 ? 'true' : undefined"><b>{{ f[0] }}</b><span>{{ f[1] }}</span></span></template>
      </div>
    </div>

    <section class="map">
      <h2 class="big" v-reveal>一节课，六个环节</h2>
      <ol class="folder-tabs" role="tablist" aria-label="课程环节">
        <li v-for="(s, i) in STEPS" :key="s.t" role="tab" tabindex="0" :aria-selected="step === i" :class="{ on: step === i, past: i < step }" @click="step = i" @keydown.enter="step = i"><span class="n">{{ i + 1 }}</span>{{ s.t }}</li>
      </ol>
      <div class="panel">
        <div :key="step" class="px-fade panel__in">
          <span class="label orange">第 {{ step + 1 }} 步</span>
          <h3>{{ STEPS[step].h }}</h3>
          <p>{{ STEPS[step].d }}</p>
        </div>
      </div>
    </section>

    <section class="trio">
      <Win label="学习目标" tone="purple" lift v-reveal>
        <ol class="goals"><li v-for="g in state.course?.learningGoals ?? []" :key="g">{{ g }}</li></ol>
      </Win>
      <Win label="本节案例" tone="orange" lift v-reveal="100">
        <p class="small">{{ kase?.title }}</p>
        <div class="kfacts">
          <div class="fact"><b>{{ money(kase?.unitCostCents) }}</b><span>美元 单位成本</span></div>
          <div class="fact"><b>{{ money(kase?.sellerMinimumUnitPriceCents) }}</b><span>美元 最低单价</span></div>
          <div class="fact"><b>{{ (kase?.minimumDepositBasisPoints ?? 0) / 100 }}%</b><span>首付款至少</span></div>
          <div class="fact"><b>{{ kase?.minimumLeadDays }}–{{ kase?.maximumLeadDays }}</b><span>天 交付</span></div>
        </div>
      </Win>
      <Win label="上课须知" tone="green" lift v-reveal="200">
        <ul class="notes"><li>有浏览器就能上课</li><li>建议打开声音，没有声音也有字幕</li><li>随时可以打断、暂停</li><li>学习报告可以打印或存为 PDF</li></ul>
      </Win>
    </section>

    <section class="cta">
      <h2>先听陈老师讲，再跟买家谈</h2>
      <button class="px-btn is-pink big" :disabled="starting || !state.course" @click="start">{{ starting ? '正在接通…' : '现在开始' }}</button>
    </section>
  </main>
</template>

<style scoped>
.entry { overflow-x: clip; }
.hero { position: relative; border-bottom: 1px solid var(--line); overflow: hidden; }
.hero__in { position: relative; max-width: 1280px; margin: 0 auto; padding: 48px 28px 64px; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr); gap: 48px; align-items: center; }
.copy { display: grid; gap: 14px; justify-items: start; }
.copy h1 { margin: 0; }
.typed { margin: 0; font: 400 clamp(20px, 2vw, 26px)/1.4 var(--serif); color: var(--ink); }
.typed :deep(.typed) { margin-left: .3em; color: #c4153a; }
.lead { margin: 0; max-width: 34em; font-size: 16px; color: var(--text); }
.btns { display: flex; gap: 12px; flex-wrap: wrap; }
.big { min-height: 50px; padding: 0 24px; font-size: 16px; }
.callwrap { width: 100%; }
.callwrap :deep(.nopad) { padding: 0; }
.vid { position: relative; aspect-ratio: 16 / 10; overflow: hidden; background: #2a2420; }
.vid video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: 50% 30%; }
.tagname { position: absolute; left: 0; top: 0; display: flex; background: var(--white); border-right: 1px solid var(--ink); border-bottom: 1px solid var(--ink); }
.tagname b { font: 400 17px/1.5 var(--serif); padding: 2px 12px; border-right: 1px solid var(--ink); color: var(--ink); } .tagname i { font: normal 400 12px/1 var(--pixel); padding: 0 10px; display: flex; align-items: center; background: var(--paper); }
.callbtn { position: absolute; right: 14px; bottom: 14px; }
.callbtn .dot { width: 9px; height: 9px; background: var(--ink); }
.marquee .fact { padding: 0 8px; }
.map { max-width: 1080px; margin: 0 auto; padding: 72px 24px 24px; }
.big { text-align: center; font-size: clamp(28px, 3.4vw, 44px); margin-bottom: 28px; }
h2.big { min-height: 0; padding: 0; font-weight: 400; }
.map .folder-tabs { overflow-x: auto; scrollbar-width: none; padding-top: 4px; }
.map .folder-tabs li { cursor: pointer; }
.panel { border: 1px solid var(--ink); background: var(--white); box-shadow: var(--shadow); min-height: 170px; }
.panel__in { padding: 26px 28px; display: grid; gap: 8px; justify-items: start; }
.panel__in h3 { font-size: 26px; margin: 0; } .panel__in p { margin: 0; max-width: 40em; }
.trio { max-width: 1180px; margin: 0 auto; padding: 48px 24px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; align-items: start; }
.goals, .notes { margin: 0; padding-left: 20px; display: grid; gap: 6px; }
.kfacts { display: grid; grid-template-columns: 1fr 1fr; border: 1px solid var(--ink); margin-top: 8px; }
.kfacts .fact { flex-direction: column; align-items: flex-start; gap: 2px; padding: 10px 12px; white-space: normal; border-bottom: 1px solid var(--ink); }
.kfacts .fact:nth-child(odd) { border-right: 1px solid var(--ink); } .kfacts .fact:nth-last-child(-n+2) { border-bottom: 0; }
.kfacts .fact b { font-size: 26px; }
.cta { text-align: center; padding: 40px 24px 80px; display: grid; justify-items: center; gap: 18px; }
.cta h2 { font-size: clamp(26px, 3vw, 38px); }
@media (max-width: 900px) {
  .hero__in { grid-template-columns: 1fr; padding: 28px 16px 40px; gap: 28px; }
  .trio { grid-template-columns: 1fr; padding: 32px 16px; }
  .map { padding: 48px 12px 12px; }
  .panel__in { padding: 18px; } .panel__in h3 { font-size: 22px; }
}
@media (max-width: 720px) {
  .map .folder-tabs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; overflow: visible; padding: 0 0 10px; }
  .map .folder-tabs li { margin: 0; padding: 0 8px; height: 38px; justify-content: center; border: 1px solid var(--ink); border-radius: 0; font-size: 13px; }
  .map .folder-tabs li::after { display: none; }
  .map .folder-tabs li.on { height: 38px; margin: 0; box-shadow: 3px 3px 0 var(--ink); }
}
@media (max-width: 480px) {
  .vid { aspect-ratio: 4 / 3; }
  .callbtn { right: 10px; bottom: 10px; min-height: 40px; padding: 0 12px; font-size: 14px; }
  .btns { width: 100%; } .btns .big { flex: 1; padding: 0 12px; }
}
</style>
