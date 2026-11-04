<script setup lang="ts">
// 学习页 v3：老师展示区与底部输入栏固定不动，只有对话内容滚动。
// 桌面：左 = 通话大窗（字幕、打断/暂停/静音/结束、倾听/思考/讲话灯；磋商时买家画中画）+ 下方输入栏；
//       右 = 只有对话栏。任务 / 出处 / 反馈 收成对话栏上方的小按钮，点开后在对话栏上方展开（再点或 × 收起）。
// 手机：整页不滚动。老师区固定在顶部、输入栏固定在底部；任务 / 出处 / 反馈 只在中间对话区里展开，永远不盖住老师区。
//       常见问题收进输入框左边的按钮，点开后换行排列，不再横向滑动。
import { fmtAnswer } from '../lib/format'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import CallStage from '../components/CallStage.vue'
import Win from '../components/Win.vue'
import RichText from '../components/RichText.vue'
import TypingBubble from '../components/TypingBubble.vue'
import { AVATARS, type AvatarId } from '../lib/avatars'
import { buildRegistry, plain } from '../lib/cites'
import { ask, clearError, doAction, endLearning, explain, loadEntry, negotiate, resumeSession, startSession, retryAnswer, retryQuestion, speaker, state, stopGenerating, stopSpeaking, submitFinalOffer } from '../lib/store'
import { useTyped } from '../composables/useTyped'
import type { Citation } from '../lib/api'

const router = useRouter()
const route = useRoute()
const home = import.meta.env.BASE_URL
const input = ref('')
const inputEl = ref<HTMLTextAreaElement | null>(null)
const mode = ref<'ask' | 'negotiate'>('ask')
const activeCard = ref('K1')
const logEl = ref<HTMLElement | null>(null)
const voiceOn = ref(true)
const offer = reactive({ price: '', deposit: '', days: '', margin: '' })
const retryForm = reactive({ grossProfit: '', grossMarginPercent: '', failing: [] as string[], explanation: '' })
const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
const booting = ref(true)
const isMobile = () => window.matchMedia('(max-width: 1099px)').matches

// ---------------------------------------------------------------- 固定布局：整页不滚动
// 桌面：把顶部导航的高度写进 --nav-h，学习页正好占满剩下的视口；手机：跟随 visualViewport（键盘弹出时整体缩短，老师区仍在顶部）。
let navRo: ResizeObserver | null = null
const rootStyle = document.documentElement.style
const onVV = () => { const vv = window.visualViewport; if (!vv) return; rootStyle.setProperty('--vvh', `${Math.round(vv.height)}px`); rootStyle.setProperty('--vvt', `${Math.round(vv.offsetTop)}px`) }
onMounted(() => {
  document.documentElement.classList.add('in-learn')
  const nav = document.querySelector('header.nav') as HTMLElement | null
  const setNav = () => rootStyle.setProperty('--nav-h', `${nav?.offsetHeight ?? 0}px`)
  setNav(); if (nav) { navRo = new ResizeObserver(setNav); navRo.observe(nav) }
  onVV(); window.visualViewport?.addEventListener('resize', onVV); window.visualViewport?.addEventListener('scroll', onVV)
})
onBeforeUnmount(() => {
  document.documentElement.classList.remove('in-learn'); navRo?.disconnect()
  window.visualViewport?.removeEventListener('resize', onVV); window.visualViewport?.removeEventListener('scroll', onVV)
  for (const k of ['--nav-h', '--vvh', '--vvt']) rootStyle.removeProperty(k)
})

onMounted(async () => {
  if (!state.course) await loadEntry()
  // 首页“和陈老师面对面 → 开始上课”带 ?start=1：没有进行中的课就直接开一节新课
  const autostart = route.query.start === '1'
  if (autostart) await router.replace({ path: '/learn', query: {} })
  if (!state.session && !(await resumeSession())) {
    if (!autostart) { await router.replace('/entry'); return }
    try { await startSession() } catch (e) { state.error = (e as Error).message || '开课失败，请刷新重试'; booting.value = false; return }
  }
  if (state.session?.stage === 'practice') mode.value = 'negotiate'
  booting.value = false
  await nextTick(); scrollLog(true)
})
onBeforeRouteLeave(async () => { await stopGenerating() })
onBeforeUnmount(() => { void stopGenerating() })

// ---------------------------------------------------------------- 阶段与角色
const STAGES = [{ id: 'intro', t: '认识任务' }, { id: 'explain', t: '概念讲解' }, { id: 'practice', t: '情景练习' }, { id: 'feedback', t: '反馈' }, { id: 'retry', t: '复练' }, { id: 'done', t: '完成' }]
const stage = computed(() => state.session?.stage ?? 'intro')
const stageIdx = computed(() => Math.max(0, STAGES.findIndex((s) => s.id === stage.value)))
const cards = computed(() => state.course?.cards ?? [])
const kase = computed(() => state.course?.case)
const paused = computed(() => !!state.session?.paused)
const ended = computed(() => !!state.session?.ended)
const busy = computed(() => state.generating)
const rigPhase = computed(() => state.phase)

// ---------------------------------------------------------------- 面板：任务 / 出处 / 反馈（同一时间最多开一个）
type PanelId = 'task' | 'src' | 'fb'
const panel = ref<PanelId | null>('task')
const taskSeen = ref(true)
watch(panel, (p) => { if (p === 'task') taskSeen.value = true })
function toggle(p: PanelId) { panel.value = panel.value === p ? null : p }
const PANEL_META = computed(() => ({
  task: { label: `任务 · ${STAGES[stageIdx.value].t}`, tone: 'orange' as const },
  src: { label: '出处', tone: 'green' as const },
  fb: { label: '反馈 · 方案核算', tone: 'pink' as const },
}))

// 讲话的人放大：磋商阶段买家画中画先滑进右下角，随后谁在说话谁占大画面
const activeRole = ref<AvatarId>('teacher')
const lastSpeaker = () => { const t = [...state.turns].reverse().find((x) => x.role === 'teacher' || x.role === 'buyer'); return (t?.role ?? 'teacher') as AvatarId }
let swapTimer: ReturnType<typeof setTimeout> | undefined
watch(() => state.turns.length, () => { if (stage.value === 'practice') activeRole.value = lastSpeaker() })
watch(stage, (s, old) => {
  mode.value = s === 'practice' ? 'negotiate' : 'ask'
  clearTimeout(swapTimer)
  if (s === 'practice') { activeRole.value = 'teacher'; swapTimer = setTimeout(() => { activeRole.value = lastSpeaker() }, reduced ? 0 : 1300) }
  else activeRole.value = 'teacher'
  if (old && s !== old) { if (s === 'feedback') taskSeen.value = false; else { panel.value = 'task'; taskSeen.value = true } void nextTick(() => { document.querySelector('.panelbody')?.scrollTo({ top: 0 }) }) }
}, { immediate: true })
const mainRole = computed<AvatarId>(() => (stage.value === 'practice' ? activeRole.value : 'teacher'))
const pipRole = computed<AvatarId | null>(() => (stage.value === 'practice' ? (mainRole.value === 'buyer' ? 'teacher' : 'buyer') : null))
function swap() { if (pipRole.value) activeRole.value = pipRole.value }

// 字幕：正在朗读的句子；没有声音时显示正在生成的最后一句
const lastBot = computed(() => [...state.turns].reverse().find((t) => t.role === 'teacher' || t.role === 'buyer'))
const subtitle = computed(() => {
  if (state.caption) return plain(state.caption)
  const t = lastBot.value
  if (state.generating && t?.streaming && t.text) { const s = plain(t.text).split(/(?<=[。！？\n])/).filter((x) => x.trim()); return (s.at(-1) ?? '').trim().slice(-60) }
  return ''
})

// ---------------------------------------------------------------- 出处（上标编号 [n] → 出处面板里对应的那一条）
const facts = computed<Citation[]>(() => state.course?.facts ?? [])
const registry = computed(() => buildRegistry(state.turns, facts.value))
const srcSel = ref<string | null>(null)
async function openCite(c: Citation) {
  srcSel.value = c.id; panel.value = 'src'
  await nextTick(); document.querySelector(`[data-src="${c.id}"]`)?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' })
}

// ---------------------------------------------------------------- 对话滚动：只有对话区自己滚
function scrollLog(force = false) {
  const el = logEl.value; if (!el) return
  if (force || el.scrollHeight - el.scrollTop - el.clientHeight < 200) el.scrollTop = el.scrollHeight
}
watch(() => state.turns.length, async () => { await nextTick(); scrollLog(true) })
watch(() => lastBot.value?.text.length, async () => { await nextTick(); scrollLog() })
watch(panel, async () => { await nextTick(); scrollLog() })

// ---------------------------------------------------------------- 输入
const SUGGEST = ['毛利率和成本加成率有什么区别？', '最终方案必须写清哪些条件？', '本案例单位成本是多少？', 'CIP 的保险要求是什么？']
const DEAL = ['每件 13.5 美元，首付款 30%，20 天交货', '我们单位成本是 10 美元，所以报价不能低于 12 美元', '理解您关心价格，我可以把首付款保持在 30%']
const negotiating = computed(() => mode.value === 'negotiate' && stage.value === 'practice')
const chipsOpen = ref(false)
// 占位符要短（手机一行放得下，不折行）：完整问题在“常见问题”里
const phLines = computed(() => (negotiating.value ? ['对买家说：每件 13.5 美元', '对买家说：首付款 30%', '对买家说：20 天交货'] : ['问：毛利率怎么算？', '问：首付款最少多少？', '问：报价要写清什么？', '问：CIP 保险要求？']))
const typedPh = useTyped(phLines)
const canSend = computed(() => !!input.value.trim() && !paused.value && !ended.value)
function suggest(q: string) {
  chipsOpen.value = false
  if (negotiating.value) { input.value = q; inputEl.value?.focus(); return } // 谈判示例只填入，方便改
  input.value = q; void send()
}
function toggleVoice() {
  voiceOn.value = !voiceOn.value
  if (!voiceOn.value) { stopSpeaking(); speaker.mode = 'off' } else speaker.mode = state.caps?.ttsMode === 'server-edge' ? 'server' : 'browser'
}
async function interrupt() { await stopGenerating(); inputEl.value?.focus() }
// 防重复发送：同一句话 4 秒内只发一次（连点芯片 / 回车 + 点击 都会造成同一个问题出现两遍）
let lastSent = { t: '', at: 0 }
async function send() {
  const t = input.value.trim(); if (!t || paused.value || ended.value) return
  const now = Date.now()
  if (t === lastSent.t && now - lastSent.at < 4000) { input.value = ''; return }
  lastSent = { t, at: now }
  input.value = ''; chipsOpen.value = false
  if (isMobile() && panel.value !== 'fb') panel.value = null // 手机：发问后把对话区让出来
  if (negotiating.value) await negotiate(t)
  else await ask(t)
}
function onKey(e: KeyboardEvent) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (canSend.value) void send() } }
function doExplain(id: string, again = false) { if (isMobile()) panel.value = null; void explain(id, again) }

// ---------------------------------------------------------------- 方案、反馈、复练
const toCents = (s: string) => Math.round(parseFloat(s) * 100)
const offerErr = ref('')
async function submitOffer() {
  offerErr.value = ''
  const body = { unitPriceCents: toCents(offer.price), quantity: kase.value?.quantity ?? 500, depositBasisPoints: Math.round(parseFloat(offer.deposit) * 100), leadDays: Number(offer.days), studentGrossMarginPercent: offer.margin === '' ? null : Number(offer.margin) }
  if (!Number.isFinite(body.unitPriceCents) || !Number.isFinite(body.depositBasisPoints) || !Number.isInteger(body.leadDays)) { offerErr.value = '请把单价、首付款比例、交付天数都填成数字（交付天数为整数）'; return }
  await submitFinalOffer(body)
}
async function startRetry() { await doAction('retry'); panel.value = 'task'; await retryQuestion() }
async function againDeal() { panel.value = null; await doAction('restartPractice') }
const retryErr = ref('')
async function submitRetry() {
  const q = state.retryQuestion; if (!q) return
  retryErr.value = ''
  if (q.type === 'margin' && (retryForm.grossProfit.trim() === '' || retryForm.grossMarginPercent.trim() === '' || !Number.isFinite(Number(retryForm.grossProfit)) || !Number.isFinite(Number(retryForm.grossMarginPercent)))) { retryErr.value = '请把毛利和毛利率都填成数字'; return }
  const body = q.type === 'margin'
    ? { grossProfit: Number(retryForm.grossProfit), grossMarginPercent: Number(retryForm.grossMarginPercent), explanation: retryForm.explanation }
    : { failing: retryForm.failing, explanation: retryForm.explanation }
  await retryAnswer(body)
}
const roleName = (r: string) => ({ student: '你', teacher: AVATARS.teacher.name, buyer: AVATARS.buyer.name + ' · 海外买家', system: '课堂' } as Record<string, string>)[r] ?? r
const money = (c?: number) => (c === undefined ? '—' : (c / 100).toFixed(2))
const fieldName: Record<string, string> = { unitPrice: '单价', quantity: '数量', deposit: '首付款', leadDays: '交期' }
const marginErrText: Record<string, string> = { none: '你算的毛利率正确', 'used-markup': '你填的是成本加成率，不是毛利率', wrong: '你算的毛利率不对', 'not-provided': '你没有填写自己算的毛利率' }
const feedback = ref<Record<string, any> | null>(null)
let fbTimer: ReturnType<typeof setInterval> | undefined
const fbAvailable = computed(() => !!state.check && (stage.value === 'feedback' || stage.value === 'retry' || stage.value === 'done'))
watch(fbAvailable, (v) => { if (!v && panel.value === 'fb') panel.value = null })
watch(() => state.check, (c) => {
  clearInterval(fbTimer); feedback.value = null
  if (!c || !state.session) return
  panel.value = 'fb'
  const id = state.session.id
  const poll = async () => { const { api } = await import('../lib/api'); const r = await api.report(id).catch(() => null); if (r?.feedback && r.feedback.status !== 'pending') { feedback.value = r.feedback; clearInterval(fbTimer) } }
  void poll(); fbTimer = setInterval(poll, 1500)
})
onBeforeUnmount(() => { clearInterval(fbTimer); clearTimeout(swapTimer) })
const chk = computed(() => state.check?.check)
const okCount = (side?: { checks: { ok: boolean }[] }) => (side ? `${side.checks.filter((c) => c.ok).length}/${side.checks.length}` : '—')
const observed = computed(() => (feedback.value?.dimensions ? `${feedback.value.dimensions.filter((d: any) => d.status === 'observed').length}/${feedback.value.dimensions.length}` : '…'))
type Miss = { k: string; t: string; how: 'retry' | 'deal' }
const misses = computed<Miss[]>(() => {
  const out: Miss[] = []; const c = chk.value
  if (!c) return out
  if (!c.valid) out.push({ k: 'invalid', t: '方案没有通过基本检查，请对照案例条件重新填写', how: 'deal' })
  for (const x of c.seller?.checks ?? []) if (!x.ok) out.push({ k: 's-' + x.field, t: `${fieldName[x.field]}不符合卖方条件：${x.rule}`, how: 'retry' })
  for (const x of c.buyer?.checks ?? []) if (!x.ok) out.push({ k: 'b-' + x.field, t: `${fieldName[x.field]}没有谈到买家能接受的范围`, how: 'deal' })
  const me = state.check?.studentMarginError
  if (me && me !== 'none') out.push({ k: 'margin', t: marginErrText[me], how: 'retry' })
  for (const d of feedback.value?.dimensions ?? []) if (d.status !== 'observed') out.push({ k: 'd-' + d.id, t: `表达：${d.name}（未观察到）`, how: 'deal' })
  return out
})
const fmtNum = (s?: string | number) => (s === undefined || s === null ? '—' : String(s))
</script>

<template>
  <main class="learn" :class="{ 'is-paused': paused }">
    <!-- 课程栏：标题 + 首页同款文件夹标签进度（桌面） -->
    <div class="classbar">
      <div class="classbar__t"><span class="label pink">嘟囔课堂</span><h1>{{ state.course?.unit ?? '出口报价与交易磋商' }}</h1></div>
      <ol class="folder-tabs steps" aria-label="课程进度">
        <li v-for="(s, i) in STAGES" :key="s.id" :class="{ on: i === stageIdx, past: i < stageIdx }" :aria-current="i === stageIdx ? 'step' : undefined"><span class="n">{{ i + 1 }}</span>{{ s.t }}</li>
      </ol>
    </div>

    <div class="main">
      <!-- 左 / 顶部：老师展示区（固定） -->
      <section class="callcol" aria-label="视频通话">
        <CallStage :main="mainRole" :pip="pipRole" :phase="rigPhase" :level="speaker.level" :subtitle="subtitle" :reduced-motion="reduced" :paused="paused"
          :title="stage === 'practice' ? '情景磋商 · 三方通话' : '面对面课堂 · 陈老师'" :error-text="state.error ?? ''" @retry="clearError" @swap="swap">
          <button class="cb" :disabled="!busy && !state.speaking" title="打断：停下声音和正在生成的回答，马上问新问题" @click="interrupt"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg><span>打断</span></button>
          <button class="cb" :disabled="ended" :title="paused ? '继续上课' : '暂停上课'" @click="doAction(paused ? 'resume' : 'pause')"><svg v-if="!paused" viewBox="0 0 24 24"><path d="M9 6v12M15 6v12" /></svg><svg v-else viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z" /></svg><span>{{ paused ? '继续' : '暂停' }}</span></button>
          <button class="cb" :aria-pressed="!voiceOn" :title="voiceOn ? '静音' : '打开声音'" @click="toggleVoice"><svg viewBox="0 0 24 24"><path d="M4 10v4h4l5 4V6L8 10z" /><path v-if="voiceOn" d="M16 9a4 4 0 010 6" /><path v-else d="M16 9l5 6M21 9l-5 6" /></svg><span>{{ voiceOn ? '静音' : '开声音' }}</span></button>
          <button class="cb end" :disabled="ended" title="结束本节课" @click="endLearning"><svg viewBox="0 0 24 24"><path d="M3 14c5-5 13-5 18 0l-2.5 2.5-3-2v-2.5c-2.3-.7-4.7-.7-7 0V14.5l-3 2z" /></svg><span>结束</span></button>
        </CallStage>
        <p v-if="state.voiceNote" class="vnote small">声音：{{ state.voiceNote }}，字幕照常显示。</p>
      </section>

      <!-- 右 / 中间：对话栏（只有这里滚动）。任务 / 出处 / 反馈 是上方的小按钮 -->
      <section class="side" aria-label="对话">
        <div class="tools no-print" role="toolbar" aria-label="课堂面板">
          <button type="button" class="tool t-orange" :class="{ on: panel === 'task' }" :aria-expanded="panel === 'task'" @click="toggle('task')">
            <i></i>任务<span class="cnt">{{ stageIdx + 1 }}/{{ STAGES.length }}<span class="cnt-l"> · {{ STAGES[stageIdx].t }}</span></span><b v-if="!taskSeen" class="dot" aria-label="有新任务"></b>
          </button>
          <button type="button" class="tool t-green" :class="{ on: panel === 'src' }" :aria-expanded="panel === 'src'" @click="toggle('src')"><i></i>出处<span class="cnt">{{ registry.length }}</span></button>
          <button v-if="fbAvailable" type="button" class="tool t-pink" :class="{ on: panel === 'fb' }" :aria-expanded="panel === 'fb'" @click="toggle('fb')"><i></i>反馈<span class="cnt">{{ okCount(chk?.seller) }}</span></button>
          <a :href="home" class="tool t-home">首页</a>
        </div>

        <Transition name="pop">
          <Win v-if="panel" :key="panel" class="panel" :class="`p-${panel}`" :label="PANEL_META[panel].label" :tone="PANEL_META[panel].tone" closable body-class="panelbody" @close="panel = null">
            <!-- 任务 -->
            <div v-if="panel === 'task'" :key="stage" class="px-fade task">
              <div v-if="state.error" class="alert" role="alert"><span>{{ state.error }}</span><button class="px-btn" @click="clearError">知道了</button></div>
              <p v-if="booting && !state.session" class="muted">正在接通陈老师…</p>

              <template v-if="stage === 'intro'">
                <h2>你是出口企业的业务员</h2>
                <p>海外买家要 500 件样品。先跟陈老师弄懂三个知识点，再和这位买家谈一轮，最后提交一份完整方案。</p>
                <ul class="goals"><li v-for="g in state.course?.learningGoals ?? []" :key="g">{{ g }}</li></ul>
                <p class="muted small">随时可以在下方输入框向陈老师提问；回答里的 [1] [2] 点开就是原文。</p>
                <button class="px-btn is-pink" @click="doAction('next')" :disabled="paused || !state.session">开始讲解</button>
              </template>

              <template v-if="stage === 'explain'">
                <div class="ktabs" role="tablist" aria-label="知识卡">
                  <button v-for="(c, i) in (cards as any[])" :key="c.id" role="tab" :aria-selected="activeCard === c.id" :class="{ on: activeCard === c.id }" @click="activeCard = c.id">
                    <span class="n">{{ Number(i) + 1 }}</span>{{ c.title }}<span v-if="state.session?.explainedCards.includes(c.id)" class="tick" aria-label="已讲解">✓</span>
                  </button>
                </div>
                <template v-for="c in cards" :key="c.id">
                  <div v-if="activeCard === c.id" class="kcard px-fade">
                    <p class="muted small">学习目标：{{ c.goal }}</p>
                    <div class="row">
                      <button class="px-btn is-pink" :disabled="busy || paused" @click="doExplain(c.id)">{{ state.session?.explainedCards.includes(c.id) ? '再讲一遍' : '请陈老师讲解' }}</button>
                      <button class="px-btn" :disabled="busy || paused || !state.session?.explainedCards.includes(c.id)" @click="doExplain(c.id, true)">换个例子</button>
                    </div>
                    <div v-if="state.lastExample" class="example"><b>当前例子（系统算好）</b><span v-for="(v, k2) in state.lastExample" :key="k2">{{ k2 }}：{{ v }}</span></div>
                  </div>
                </template>
                <hr />
                <p class="small">准备好了，就和海外买家 Markus Weber 磋商。他只关心自己的条件，不会替你写方案。</p>
                <button class="px-btn is-pink" :disabled="busy || paused" @click="doAction('startPractice')">开始买方谈判</button>
              </template>

              <template v-if="stage === 'practice'">
                <h2>{{ kase?.title }}</h2>
                <div class="facts3">
                  <div class="fact"><b>{{ money(kase?.unitCostCents) }}</b><span>美元 单位成本</span></div>
                  <div class="fact"><b>{{ kase?.quantity }}</b><span>件 固定数量</span></div>
                  <div class="fact"><b>{{ state.session?.practice.rounds ?? 0 }}</b><span>轮 已磋商</span></div>
                </div>
                <table class="kv small"><tbody>
                  <tr><th>卖方期望价</th><td>{{ money(kase?.sellerDesiredUnitPriceCents) }} 美元</td><th>卖方最低价</th><td>{{ money(kase?.sellerMinimumUnitPriceCents) }} 美元</td></tr>
                  <tr><th>首付款</th><td>不少于 {{ (kase?.minimumDepositBasisPoints ?? 0) / 100 }}%</td><th>交付</th><td>{{ kase?.minimumLeadDays }}–{{ kase?.maximumLeadDays }} 天</td></tr>
                </tbody></table>
                <p class="muted small">建议谈 {{ kase?.suggestedDialogueRounds?.minimum }}–{{ kase?.suggestedDialogueRounds?.maximum }} 轮。聊天里说“成交”不算数，以下面提交的方案为准。</p>
                <form class="offer" novalidate @submit.prevent="submitOffer">
                  <label>单价（美元）<input v-model="offer.price" inputmode="decimal" placeholder="如 12.50" required /></label>
                  <label>数量<input :value="kase?.quantity" disabled aria-label="数量（固定）" /></label>
                  <label>首付款（%）<input v-model="offer.deposit" inputmode="decimal" placeholder="如 30" required /></label>
                  <label>交付天数<input v-model="offer.days" inputmode="numeric" placeholder="如 20" required /></label>
                  <label class="wide">你算出的毛利率（%）<input v-model="offer.margin" inputmode="decimal" placeholder="选填，系统会核对" /></label>
                  <button class="px-btn is-pink wide" type="submit" :disabled="paused">提交最终方案</button>
                  <p v-if="offerErr" class="pill red wide">{{ offerErr }}</p>
                </form>
              </template>

              <template v-if="stage === 'feedback' && state.check">
                <h2>方案已核算</h2>
                <div class="facts3">
                  <div class="fact"><b>{{ chk?.valid ? chk.grossMarginText : '—' }}</b><span>毛利率</span></div>
                  <div class="fact"><b>{{ okCount(chk?.seller) }}</b><span>卖方条件</span></div>
                  <div class="fact"><b>{{ observed }}</b><span>表达观察</span></div>
                </div>
                <div class="row">
                  <button class="px-btn is-pink" :disabled="busy || paused" @click="startRetry">练我没掌握的部分</button>
                  <button class="px-btn" @click="panel = 'fb'">打开反馈</button>
                  <button class="px-btn" :disabled="busy" @click="againDeal">重新谈一次</button>
                </div>
              </template>

              <template v-if="stage === 'retry' || (stage === 'done' && state.retryQuestion)">
                <h2>针对性复练</h2>
                <p v-if="!state.retryQuestion" class="muted"><TypingBubble who="陈老师" /> 正在根据你的错误出题</p>
                <template v-else>
                  <p class="pill amber reason">{{ state.retryQuestion.reason }}</p>
                  <p class="q">{{ plain(state.retryQuestion.question) }}</p>
                  <form v-if="!state.retryResult" class="offer" novalidate @submit.prevent="submitRetry">
                    <template v-if="state.retryQuestion.type === 'margin'">
                      <label>毛利（美元）<input v-model="retryForm.grossProfit" inputmode="decimal" required /></label>
                      <label>毛利率（%）<input v-model="retryForm.grossMarginPercent" inputmode="decimal" required /></label>
                    </template>
                    <fieldset v-else class="wide"><legend>不满足的卖方条件</legend>
                      <label v-for="f in ['unitPrice', 'deposit', 'leadDays']" :key="f" class="chk"><input type="checkbox" :value="f" v-model="retryForm.failing" /> {{ fieldName[f] }}</label>
                    </fieldset>
                    <label class="wide">一句话说明<textarea v-model="retryForm.explanation" rows="2" maxlength="300"></textarea></label>
                    <button class="px-btn is-pink wide" :disabled="busy || paused">提交答案</button>
                    <p v-if="retryErr" class="pill red wide">{{ retryErr }}</p>
                  </form>
                  <div v-else>
                    <p class="pill" :class="state.retryResult.grade?.correct ? 'ok' : 'red'">{{ state.retryResult.grade?.correct ? '全部正确' : '还有错误' }}</p>
                    <ul class="small"><li v-for="d in state.retryResult.grade?.details" :key="d">{{ d }}</li></ul>
                    <p class="small muted">参考答案：{{ fmtAnswer(state.retryResult.answer) }}</p>
                    <div class="row"><RouterLink to="/report" class="px-btn is-pink">查看学习报告</RouterLink><button class="px-btn" :disabled="busy" @click="againDeal">重新谈一次</button></div>
                  </div>
                </template>
              </template>

              <template v-if="stage === 'done' && !state.retryQuestion">
                <h2>本节课结束了</h2>
                <p>谢谢你陪陈老师上完这节课。学习报告里有对话、方案核算和建议，可以打印。</p>
                <div class="row"><RouterLink to="/report" class="px-btn is-pink">查看学习报告</RouterLink><button class="px-btn" @click="againDeal">重新练习</button></div>
              </template>
            </div>

            <!-- 出处：点对话里的 [n] 就展开对应这一条 -->
            <div v-else-if="panel === 'src'" class="srcp">
              <p v-if="!registry.length" class="muted small">还没有引用。陈老师回答时引用的资料会按顺序列在这里，对话里的 [1] [2] 点开就是对应原文。</p>
              <ol v-else class="srcs">
                <li v-for="(c, i) in registry" :key="c.id" :data-src="c.id" :class="{ open: srcSel === c.id }">
                  <button type="button" class="src" :aria-expanded="srcSel === c.id" @click="srcSel = srcSel === c.id ? null : c.id"><span class="n">[{{ i + 1 }}]</span><span class="t">{{ c.title }}</span><span class="k">{{ c.sourceUrl ? '公开资料' : '案例条件' }}</span></button>
                  <div v-if="srcSel === c.id" class="srcd px-fade">
                    <p class="text">{{ c.text }}</p>
                    <blockquote v-if="c.quote" lang="en">原文摘录：{{ c.quote }}</blockquote>
                    <p v-if="c.sourceUrl" class="small"><a :href="c.sourceUrl" target="_blank" rel="noopener">打开原始网页</a></p>
                    <p v-else class="small muted">这是本节练习的案例条件，只在这次练习中适用。</p>
                  </div>
                </li>
              </ol>
            </div>

            <!-- 反馈 · 方案核算 -->
            <div v-else class="fbp">
              <div class="fstrip">
                <div class="fact"><b>{{ chk?.valid ? chk.grossMarginText : '—' }}</b><span>毛利率</span></div>
                <div class="fact"><b>{{ chk?.valid ? fmtNum(chk.grossProfit) : '—' }}</b><span>美元毛利</span></div>
                <div class="fact"><b>{{ okCount(chk?.seller) }}</b><span>卖方条件</span></div>
                <div class="fact"><b>{{ okCount(chk?.buyer) }}</b><span>买家条件</span></div>
                <div class="fact"><b>{{ observed }}</b><span>表达观察</span></div>
              </div>
              <div class="fbgrid">
                <h3>{{ chk?.agreement ? '双方条件都满足，达成本练习目标' : '还没有达成本练习目标' }}</h3>
                <p v-if="chk?.valid" class="small">销售收入 {{ chk.revenue }} 美元，总成本 {{ chk.cost }} 美元，毛利 {{ chk.grossProfit }} 美元；毛利率 {{ chk.grossMarginText }}，成本加成率 {{ chk.costMarkupText }}。</p>
                <p v-if="state.check?.studentMarginError" class="pill" :class="state.check.studentMarginError === 'none' ? 'ok' : 'amber'">{{ marginErrText[state.check.studentMarginError] }}</p>
                <h4>没达到的地方</h4>
                <p v-if="!misses.length" class="small">都达到了。可以重新谈一次，试试别的说法。</p>
                <ul class="miss">
                  <li v-for="m in misses" :key="m.k"><span>{{ m.t }}</span>
                    <button class="px-btn" :disabled="busy || paused" @click="m.how === 'retry' ? startRetry() : againDeal()">{{ m.how === 'retry' ? '练这一项' : '再谈一次' }}</button></li>
                </ul>
                <h4>表达建议（附你的原话）</h4>
                <p v-if="!feedback" class="muted small"><TypingBubble who="陈老师" /> 正在根据你的对话写建议</p>
                <p v-else-if="feedback.status === 'error'" class="pill red">建议暂时没写出来，客观核算不受影响。</p>
                <template v-else>
                  <div v-for="d in feedback.dimensions" :key="d.id" class="dim">
                    <b>{{ d.name }}</b> <span class="pill" :class="d.status === 'observed' ? 'ok' : 'grey'">{{ d.status === 'observed' ? '观察到' : '未观察到' }}</span>
                    <blockquote v-if="d.quote">“{{ d.quote }}”</blockquote>
                    <p class="small">{{ plain(d.comment) }} <span class="muted">建议：{{ plain(d.suggestion) }}</span></p>
                  </div>
                  <p class="small">{{ plain(feedback.summary) }}</p>
                </template>
              </div>
              <div class="row fbbtns">
                <button class="px-btn is-pink" :disabled="busy || paused" @click="startRetry">练我没掌握的部分</button>
                <button class="px-btn" :disabled="busy" @click="againDeal">重新谈一次</button>
                <RouterLink to="/report" class="px-btn">查看学习报告</RouterLink>
              </div>
            </div>
          </Win>
        </Transition>

        <Win class="w-chat" label="对话" tone="purple" body-class="chatbody">
          <template #bar><span class="cntb">{{ state.turns.length }} 条</span></template>
          <div ref="logEl" class="log" aria-live="polite">
            <div v-if="!state.turns.length" class="empty">
              <div class="empty__b"><i></i>{{ stage === 'practice' ? '我是 Markus Weber，先报个价吧。' : '同学你好，我是陈老师。' }}<b>{{ stage === 'practice' ? '价格、首付款、交期都可以谈。' : '哪里没懂，直接问我。' }}</b></div>
              <p class="muted small">回答里的 [1] [2] 是出处，点开能看到原文。</p>
            </div>
            <template v-for="t in state.turns" :key="t.turnId">
              <div v-if="(t as any).kind === 'divider'" class="divider small">{{ t.text }}</div>
              <div v-else class="msg" :class="`m-${t.role}`">
                <div class="who">{{ roleName(t.role) }}</div>
                <div class="bubble">
                  <TypingBubble v-if="t.streaming && !t.text" :who="t.role === 'buyer' ? '买家' : '陈老师'" />
                  <template v-else><RichText :text="t.text" :registry="registry" :streaming="t.streaming" @open="openCite" /><span v-if="t.streaming" class="caret" aria-hidden="true"></span></template>
                </div>
                <div v-if="t.insufficient" class="small muted">资料没有覆盖这个问题，所以没有标注出处。</div>
                <div v-if="t.failed" class="small err-t">{{ t.failed }}</div>
              </div>
            </template>
          </div>
        </Win>
      </section>

      <!-- 输入栏（固定）：桌面在老师区下方，手机在屏幕底部 -->
      <div class="composer no-print">
        <div v-if="stage === 'practice'" class="modes" role="radiogroup" aria-label="发给谁">
          <label :class="{ on: mode === 'negotiate' }"><input type="radio" value="negotiate" v-model="mode" />对买家说</label>
          <label :class="{ on: mode === 'ask' }"><input type="radio" value="ask" v-model="mode" />问老师（不计入谈判）</label>
        </div>
        <div id="learn-chips" class="chips" :class="{ open: chipsOpen }" aria-label="建议">
          <button v-for="q in (negotiating ? DEAL : SUGGEST)" :key="q" type="button" class="px-chip" :disabled="paused || ended || !state.session" @click="suggest(q)">{{ q }}</button>
        </div>
        <div class="inrow">
          <button type="button" class="chipbtn" :class="{ on: chipsOpen }" :aria-expanded="chipsOpen" aria-controls="learn-chips" @click="chipsOpen = !chipsOpen">{{ negotiating ? '示例' : '常见问题' }}<svg class="caret2" :class="{ up: !chipsOpen }" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5l3 3 3-3" /></svg></button>
          <textarea ref="inputEl" v-model="input" rows="1" maxlength="1500" :placeholder="typedPh || ' '" :disabled="paused || ended || !state.session" aria-label="输入框" @keydown="onKey"></textarea>
          <button class="px-btn is-pink send" :disabled="!canSend" @click="send">发送<span class="arr" aria-hidden="true">→</span></button>
        </div>
      </div>
    </div>
  </main>
</template>

<style scoped>
/* ---------------- 桌面：整页正好占满视口，只有对话区滚动 ---------------- */
.learn { max-width: 1480px; margin: 0 auto; padding: 0 24px 16px; height: calc(100dvh - var(--nav-h, 70px)); display: flex; flex-direction: column; }
.classbar { flex: none; display: flex; justify-content: space-between; align-items: flex-end; gap: 12px 24px; padding: 0 4px; flex-wrap: wrap; }
.classbar__t { display: grid; gap: 2px; padding-bottom: 8px; } .classbar__t h1 { font-size: clamp(22px, 2.2vw, 30px); margin: 0; line-height: 1.15; }
.steps { padding-right: 18px; }
.main { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) minmax(380px, 460px); grid-template-areas: "call side" "comp side"; grid-template-rows: minmax(0, 1fr) auto; gap: 14px 20px; border: 1px solid var(--line); background: var(--white) var(--sky) center bottom / 1200px auto repeat-x; padding: 16px; box-shadow: var(--shadow-lg); position: relative; }
.callcol { grid-area: call; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.callcol :deep(.call) { flex: 1; min-height: 0; }
.side { grid-area: side; min-height: 0; display: flex; flex-direction: column; gap: 10px; }
.composer { grid-area: comp; }
.vnote { margin: 6px 2px 0; color: var(--muted); flex: none; }

/* 通话控制按钮 */
.cb { flex: 1 1 0; min-width: 0; display: inline-flex; align-items: center; justify-content: center; gap: 7px; height: 46px; padding: 0 8px; border: 0; border-right: 1px solid var(--line); background: transparent; font-size: 14px; box-shadow: none; }
.cb svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: square; flex: none; }
.cb:hover:not(:disabled) { background: var(--paper-3); }
.cb:disabled { border-style: solid !important; border-width: 0 1px 0 0 !important; }
.cb.end { background: var(--pink); } .cb.end:hover:not(:disabled) { background: var(--pink-2); } .cb.end svg { fill: currentColor; stroke: none; }

/* 面板按钮条 */
.tools { flex: none; display: flex; gap: 8px; flex-wrap: wrap; }
.tool { position: relative; display: inline-flex; align-items: center; gap: 7px; height: 34px; padding: 0 12px; font-size: 13px; background: var(--white); border: 1px solid var(--ink); box-shadow: 2px 2px 0 var(--ink); text-decoration: none; color: var(--ink); font-family: var(--pixel); white-space: nowrap; }
.tool i { width: 9px; height: 9px; background: var(--ink); flex: none; }
.tool.t-orange i { background: var(--orange); } .tool.t-green i { background: var(--green-d); } .tool.t-pink i { background: var(--pink); }
.tool .cnt { font-size: 12px; color: var(--muted); }
.tool.on { background: var(--ink); color: #fff; box-shadow: none; transform: translate(2px, 2px); } .tool.on .cnt { color: var(--pink-l); }
.tool .dot { position: absolute; top: -4px; right: -4px; width: 9px; height: 9px; background: var(--pink); border: 1px solid var(--ink); }
.tool.t-home { margin-left: auto; display: none; }

/* 展开的面板：在对话栏上方，最多占一半多，自己滚动 */
.panel { flex: 0 1 auto; max-height: 62%; min-height: 0; box-shadow: var(--shadow); }
.panel :deep(.panelbody) { overflow-y: auto; overscroll-behavior: contain; padding: 14px 16px; min-height: 0; }
.p-fb :deep(.panelbody) { padding: 0 0 14px; }
.pop-enter-active { transition: transform .3s var(--ease), opacity .2s; } .pop-leave-active { transition: opacity .15s; }
.pop-enter-from { transform: translateY(-10px); opacity: 0; } .pop-leave-to { opacity: 0; }

.w-chat { flex: 1 1 0; min-height: 140px; box-shadow: var(--shadow); }
.w-chat :deep(.chatbody) { padding: 0; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
.cntb { font: 400 12px/1 var(--pixel); color: var(--text-2); white-space: nowrap; }

.task { display: grid; gap: 10px; overflow-wrap: anywhere; }
.task h2 { font-size: 22px; margin: 0; }
.task p { margin: 0; }
.goals { margin: 0; padding-left: 20px; display: grid; gap: 2px; }
.alert { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 10px 12px; background: var(--pink-xl); border: 1px solid var(--ink); }
.ktabs { display: grid; border: 1px solid var(--line); }
.ktabs button { display: flex; align-items: center; gap: 8px; text-align: left; border: 0; border-bottom: 1px solid var(--line); background: var(--white); padding: 9px 12px; font-size: 14px; box-shadow: none; }
.ktabs button:last-child { border-bottom: 0; }
.ktabs .n { font-size: 12px; color: var(--muted); } .ktabs .tick { margin-left: auto; color: var(--green-d); }
.ktabs button.on { background: var(--ink); color: #fff; } .ktabs button.on .n { color: var(--pink-l); } .ktabs button.on .tick { color: var(--green); }
.kcard { display: grid; gap: 8px; }
.row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.example { display: flex; flex-wrap: wrap; gap: 4px 16px; background: var(--paper); border: 1px dashed var(--line); padding: 10px 12px; font-size: 13px; }
.example b { width: 100%; font: 400 13px/1.4 var(--pixel); }
.facts3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border: 1px solid var(--line); }
.facts3 .fact { flex-direction: column; align-items: flex-start; gap: 4px; padding: 8px 10px; border-right: 1px solid var(--line); white-space: normal; }
.facts3 .fact:last-child { border-right: 0; } .facts3 .fact b { font-size: 22px; } .facts3 .fact span { font-size: 12px; }
.kv { border-collapse: collapse; table-layout: fixed; width: 100%; border: 1px solid var(--line); word-break: break-word; }
.kv th { text-align: left; color: var(--text-2); font-weight: 400; padding: 6px 8px; background: var(--paper); border: 1px solid var(--hair); font-size: 12.5px; } .kv td { padding: 6px 8px; border: 1px solid var(--hair); }
.offer { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; align-items: end; }
.offer label { display: grid; gap: 4px; font: 400 13px/1.3 var(--pixel); color: var(--text-2); min-width: 0; }
.offer input, .offer textarea { width: 100%; min-width: 0; font-family: var(--sans); }
.offer .wide { grid-column: 1 / -1; } .chk { display: inline-flex !important; gap: 6px; margin-right: 14px; color: var(--ink) !important; }
fieldset { border: 1px solid var(--line); } legend { font: 400 13px/1 var(--pixel); }
.reason { white-space: normal; } .q { font-size: 16px; line-height: 1.6; color: var(--ink); font-weight: 600; }
hr { border: 0; border-top: 1px dashed var(--line); margin: 6px 0; width: 100%; }

/* 对话 */
.log { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 14px; display: grid; gap: 14px; align-content: start; }
.msg { display: grid; grid-template-columns: minmax(0, 1fr); gap: 4px; animation: rise .32s var(--ease) both; }
.msg .who { color: var(--muted); font: 400 12px/1.2 var(--pixel); }
@keyframes rise { from { transform: translateY(14px) scale(.98); opacity: 0; } to { transform: none; opacity: 1; } }
.bubble { overflow-wrap: anywhere; max-width: 100%; padding: 10px 13px; background: var(--paper); border: 1px solid var(--line); font-size: 15px; line-height: 1.7; }
.m-teacher .bubble { background: var(--white); box-shadow: 3px 3px 0 0 var(--purple); }
.m-student { justify-items: end; } .m-student .bubble { background: var(--pink-l); max-width: 88%; } .m-student .who { text-align: right; }
.m-buyer .bubble { background: var(--butter); }
.m-system .bubble { background: var(--paper-2); font-size: 13px; }
.caret { display: inline-block; width: 2px; height: 1em; margin-left: 2px; vertical-align: -.12em; background: var(--pink); animation: blink 1s steps(1, end) infinite; } @keyframes blink { 50% { opacity: 0; } }
.err-t { color: var(--bad); }
.divider { text-align: center; color: var(--muted); font-family: var(--pixel); padding: 6px 0; border-top: 1px dashed var(--line); }
.empty { display: grid; gap: 10px; justify-items: start; }
.empty__b { background: var(--ink); color: #fff; padding: 12px 14px; font-size: 14px; line-height: 1.55; display: grid; }
.empty__b i { width: 8px; height: 8px; background: var(--green); margin-bottom: 6px; } .empty__b b { font-family: var(--serif); font-weight: 400; font-size: 19px; }

/* 出处列表 */
.srcs { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.src { width: 100%; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 8px; align-items: center; text-align: left; padding: 7px 10px; font-size: 13px; box-shadow: none; }
.src .n { color: #c4153a; } .src .t { font-family: var(--sans); font-size: 14px; color: var(--ink); } .src .k { font-size: 12px; color: var(--muted); }
.src:hover { background: var(--mint) !important; }
.srcs li.open .src { background: var(--mint); }
.srcd { border: 1px solid var(--line); border-top: 0; padding: 10px 12px; display: grid; gap: 8px; background: var(--white); }
.srcd .text { white-space: pre-wrap; margin: 0; font-size: 14px; } .srcd p { margin: 0; }
.srcd blockquote { margin: 0; font-size: 13px; }

/* 输入栏 */
.composer { display: grid; gap: 10px; padding: 12px; background: var(--paper); border: 1px solid var(--line); box-shadow: var(--shadow); }
.modes { display: flex; border: 1px solid var(--line); width: fit-content; max-width: 100%; }
.modes label { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; font: 400 13px/1.2 var(--pixel); cursor: pointer; background: var(--white); }
.modes label + label { border-left: 1px solid var(--line); }
.modes label.on { background: var(--ink); color: #fff; }
.modes input { position: absolute; opacity: 0; pointer-events: none; }
.modes label:has(input:focus-visible) { outline: 2px solid var(--pink); outline-offset: 2px; }
.chips { flex-wrap: wrap; } /* 换行排列，不横向滑动 */
.chips .px-chip { white-space: normal; text-align: left; max-width: 100%; }
.chipbtn { display: none; }
.inrow { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: stretch; }
.inrow textarea { resize: none; min-height: 48px; font-size: 15px; line-height: 1.5; padding: 12px; }
.send { height: auto; min-height: 48px; }

/* 反馈 */
.fstrip { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 1px; border-bottom: 1px solid var(--line); background: var(--line); }
.fstrip .fact { flex-direction: column; align-items: center; gap: 2px; padding: 10px 4px; background: var(--paper); white-space: normal; text-align: center; } .fstrip .fact b { font-size: 20px; } .fstrip .fact span { font-size: 12px; }
.fbgrid { display: grid; gap: 4px; padding: 12px 16px 0; }
.fbgrid h3 { font-size: 20px; margin: 0; } .fbgrid h4 { margin: 12px 0 4px; font: 400 14px/1.3 var(--pixel); color: var(--ink); }
.fbgrid p { margin: 4px 0; } .fbgrid .pill { justify-self: start; }
.miss { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.miss li { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--line); background: var(--white); font-size: 14px; }
.miss .px-btn { min-height: 32px; padding: 0 12px; font-size: 13px; flex: none; }
.dim { border: 1px solid var(--line); padding: 10px 12px; margin-top: 6px; background: var(--white); }
blockquote { margin: 8px 0; padding: 8px 12px; background: var(--butter); border-left: 3px solid var(--ink); font-family: var(--serif); }
.fbbtns { padding: 14px 16px 0; }
.is-paused .task { opacity: .75; }

/* ---------------- 手机 / 平板：老师区顶部固定，输入栏底部固定，中间对话区独立滚动 ---------------- */
@media (max-width: 1099px) {
  .learn { position: fixed; left: 0; right: 0; top: var(--vvt, 0px); height: var(--vvh, 100dvh); max-width: none; padding: 0; z-index: 10; background: var(--paper); }
  .classbar { display: none; }
  .main { display: flex; flex-direction: column; border: 0; box-shadow: none; padding: 0; gap: 0; background: var(--paper); }
  .callcol { flex: none; padding: max(6px, env(safe-area-inset-top)) 8px 0; z-index: 3; background: var(--paper); }
  .callcol :deep(.call) { flex: none; max-width: 640px; width: 100%; margin: 0 auto; }
  .vnote { display: none; }
  .cb { height: 40px; font-size: 13px; gap: 5px; }
  .side { flex: 1 1 0; min-height: 0; gap: 8px; padding: 8px 8px 8px; position: relative; z-index: 1; }
  .tools { gap: 6px; flex-wrap: nowrap; }
  .tool { height: 32px; padding: 0 10px; }
  .tool .cnt-l { display: none; }
  .tool.t-home { display: inline-flex; }
  .panel { max-height: 72%; box-shadow: 3px 3px 0 var(--ink); }
  .panel :deep(.panelbody) { padding: 12px; }
  .w-chat { min-height: 90px; box-shadow: 3px 3px 0 var(--ink); }
  .w-chat :deep(.bar) { display: none; }
  .log { padding: 12px 10px; gap: 12px; }
  .composer { flex: none; gap: 8px; padding: 8px 8px calc(8px + env(safe-area-inset-bottom)); border: 0; border-top: 1px solid var(--line); box-shadow: 0 -3px 0 rgba(20,2,6,.08); z-index: 2; }
  .chips { display: none; } .chips.open { display: flex; }
  .chips .px-chip { font-size: 13px; padding: 7px 10px; }
  .inrow { grid-template-columns: auto minmax(0, 1fr) auto; gap: 8px; }
  .chipbtn { display: inline-flex; align-items: center; gap: 4px; padding: 0 9px; font-size: 13px; box-shadow: 2px 2px 0 var(--ink); }
  .chipbtn.on { background: var(--ink); color: #fff; box-shadow: none; }
  .caret2 { width: 10px; height: 10px; fill: none; stroke: currentColor; stroke-width: 1.6; transition: transform .2s; } .caret2.up { transform: rotate(180deg); }
  .inrow textarea { min-height: 44px; padding: 10px; font-size: 16px; }
  .inrow textarea::placeholder { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .send { min-height: 44px; padding: 0 12px; }
  .send .arr { display: none; }
  .modes label { padding: 5px 9px; font-size: 12px; }
  .p-fb :deep(.panelbody) { padding: 0 0 12px; }
  .fstrip { grid-template-columns: repeat(3, minmax(0, 1fr)); } .fstrip .fact:last-child { grid-column: span 2; }
  .fbgrid { padding: 10px 12px 0; } .fbbtns { padding: 12px 12px 0; }
}
@media (min-width: 1100px) and (max-width: 1360px) { .main { grid-template-columns: minmax(0, 1fr) minmax(340px, 400px); } .fstrip { grid-template-columns: repeat(3, minmax(0, 1fr)); } .fstrip .fact:last-child { grid-column: span 2; } }
@media (max-width: 600px) {
  .cb { height: 38px; padding: 0 4px; gap: 4px; } .cb svg { width: 14px; height: 14px; }
  .miss li { flex-direction: column; align-items: stretch; }
  .task h2 { font-size: 20px; }
  .facts3 .fact { padding: 8px; } .facts3 .fact b { font-size: 19px; }
}
@media print { .learn { display: none; } }
</style>
