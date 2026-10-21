<script setup lang="ts">
// 学习页 v2：延续首页“和陈老师视频通话”（docs/design-v2.md 方向 A）。
// 桌面：左 ≈60% 通话大窗（字幕、打断/暂停/静音/结束、倾听/思考/讲话灯；磋商时买家画中画）+ 下方输入栏；
//       右侧可拖动、可最小化到 Dock 的窗口：任务 / 对话 / 出处。提交方案后反馈窗从底部升起。
// 手机：通话窗吸顶约 1/3 屏，下面 对话 / 任务 / 出处 标签（出处为底部抽屉），输入栏固定在底部。
import { fmtAnswer } from '../lib/format'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import CallStage from '../components/CallStage.vue'
import Win from '../components/Win.vue'
import Dock from '../components/Dock.vue'
import RichText from '../components/RichText.vue'
import TypingBubble from '../components/TypingBubble.vue'
import CitationDrawer from '../components/CitationDrawer.vue'
import { AVATARS, type AvatarId } from '../lib/avatars'
import { buildRegistry, plain } from '../lib/cites'
import { ask, clearError, doAction, endLearning, explain, loadEntry, negotiate, openCitation, openCitationNo, resumeSession, startSession, retryAnswer, retryQuestion, speaker, state, stopGenerating, stopSpeaking, submitFinalOffer } from '../lib/store'
import { useTyped } from '../composables/useTyped'
import type { Citation } from '../lib/api'

const router = useRouter()
const route = useRoute()
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
// 手机：把通话窗的实际高度写进 --call-h，让标签栏贴在它下面
const learnEl = ref<HTMLElement | null>(null); const callEl = ref<HTMLElement | null>(null)
let ro: ResizeObserver | null = null
onMounted(() => { ro = new ResizeObserver(() => learnEl.value?.style.setProperty('--call-h', `${callEl.value?.offsetHeight ?? 0}px`)); if (callEl.value) ro.observe(callEl.value) })
onBeforeUnmount(() => ro?.disconnect())

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
  if (old && s !== old) { mtab.value = 'task'; taskSeen.value = false; mins.task = false; void nextTick(() => { document.querySelector('.w-task .taskbody')?.scrollTo({ top: 0 }) }) }
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

// ---------------------------------------------------------------- 出处（上标编号）
const facts = computed<Citation[]>(() => state.course?.facts ?? [])
const registry = computed(() => buildRegistry(state.turns, facts.value))
function openCite(c: Citation, n?: number) { openCitationNo.value = n ?? registry.value.findIndex((x) => x.id === c.id) + 1; openCitation.value = c; srcSheet.value = false }
const srcSheet = ref(false)

// ---------------------------------------------------------------- 窗口、Dock、手机标签
const mins = reactive({ task: false, chat: false, src: false })
const WINS = { task: { label: '任务', tone: 'orange' }, chat: { label: '对话', tone: 'purple' }, src: { label: '出处', tone: 'green' } } as const
const dockItems = computed(() => [
  ...(Object.keys(WINS) as (keyof typeof WINS)[]).filter((k) => mins[k]).map((k) => ({ id: k, ...WINS[k] })),
  ...(fbMin.value && fbAvailable.value ? [{ id: 'fb', label: '反馈', tone: 'pink' }] : []),
])
function restore(id: string) { if (id === 'fb') { fbMin.value = false; return } mins[id as keyof typeof mins] = false }
const mtab = ref<'chat' | 'task'>('task')
const taskSeen = ref(true)
watch(mtab, (t) => { if (t === 'task') taskSeen.value = true })
const isMobile = () => window.matchMedia('(max-width: 1099px)').matches
// 新消息：桌面滚对话窗，手机（整页滚动）滚到页底；对话标签不在前台时不打扰
watch(() => state.turns.length, async () => {
  await nextTick()
  if (isMobile()) { if (mtab.value === 'chat') window.scrollTo({ top: document.documentElement.scrollHeight, behavior: reduced ? 'auto' : 'smooth' }) }
  else if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight
})
watch(mtab, async (t) => { if (t === 'chat' && isMobile()) { await nextTick(); window.scrollTo({ top: document.documentElement.scrollHeight }) } })
watch(() => lastBot.value?.text.length, async () => {
  await nextTick()
  if (isMobile()) { const d = document.documentElement; if (mtab.value === 'chat' && d.scrollHeight - d.scrollTop - innerHeight < 220) d.scrollTop = d.scrollHeight; return }
  const el = logEl.value; if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight
})

// ---------------------------------------------------------------- 输入
const SUGGEST = ['毛利率和成本加成率有什么区别？', '最终方案必须写清哪些条件？', '本案例单位成本是多少？', 'CIP 的保险要求是什么？']
const DEAL = ['每件 13.5 美元，首付款 30%，20 天交货', '我们单位成本是 10 美元，所以报价不能低于 12 美元', '理解您关心价格，我可以把首付款保持在 30%']
const negotiating = computed(() => mode.value === 'negotiate' && stage.value === 'practice')
// 占位符要短（手机一行放得下）：完整问题在下面的芯片里
const phLines = computed(() => (negotiating.value ? ['对买家说：每件 13.5 美元', '对买家说：首付款 30%', '对买家说：20 天交货'] : ['问陈老师：毛利率怎么算？', '问陈老师：首付款最少多少？', '问陈老师：报价要写清什么？', '问陈老师：CIP 保险要求？']))
const typedPh = useTyped(phLines)
const canSend = computed(() => !!input.value.trim() && !paused.value && !ended.value)
function suggest(q: string) {
  if (negotiating.value) { input.value = q; inputEl.value?.focus(); return } // 谈判示例只填入，方便改
  input.value = q; void send()
}
function toggleVoice() {
  voiceOn.value = !voiceOn.value
  if (!voiceOn.value) { stopSpeaking(); speaker.mode = 'off' } else speaker.mode = state.caps?.ttsMode === 'server-edge' ? 'server' : 'browser'
}
async function interrupt() { await stopGenerating(); inputEl.value?.focus() }
async function send() {
  mtab.value = 'chat'; mins.chat = false
  const t = input.value.trim(); if (!t) return
  input.value = ''
  if (negotiating.value) await negotiate(t)
  else await ask(t)
}
function onKey(e: KeyboardEvent) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (canSend.value) void send() } }

// ---------------------------------------------------------------- 方案、反馈、复练
const toCents = (s: string) => Math.round(parseFloat(s) * 100)
const offerErr = ref('')
async function submitOffer() {
  offerErr.value = ''
  const body = { unitPriceCents: toCents(offer.price), quantity: kase.value?.quantity ?? 500, depositBasisPoints: Math.round(parseFloat(offer.deposit) * 100), leadDays: Number(offer.days), studentGrossMarginPercent: offer.margin === '' ? null : Number(offer.margin) }
  if (!Number.isFinite(body.unitPriceCents) || !Number.isFinite(body.depositBasisPoints) || !Number.isInteger(body.leadDays)) { offerErr.value = '请把单价、首付款比例、交付天数都填成数字（交付天数为整数）'; return }
  await submitFinalOffer(body)
}
async function startRetry() { fbMin.value = true; mtab.value = 'task'; await doAction('retry'); await retryQuestion() }
async function againDeal() { fbMin.value = true; mtab.value = 'chat'; await doAction('restartPractice') }
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
const roleName = (r: string) => ({ student: '你', teacher: AVATARS.teacher.name, buyer: AVATARS.buyer.name + ' · 模拟买家', system: '课堂' } as Record<string, string>)[r] ?? r
const money = (c?: number) => (c === undefined ? '—' : (c / 100).toFixed(2))
const fieldName: Record<string, string> = { unitPrice: '单价', quantity: '数量', deposit: '首付款', leadDays: '交期' }
const marginErrText: Record<string, string> = { none: '你算的毛利率正确', 'used-markup': '你填的是成本加成率，不是毛利率', wrong: '你算的毛利率不对', 'not-provided': '你没有填写自己算的毛利率' }
const feedback = ref<Record<string, any> | null>(null)
let fbTimer: ReturnType<typeof setInterval> | undefined
const fbMin = ref(false)
const fbAvailable = computed(() => !!state.check && stage.value === 'feedback')
const fbShow = computed(() => fbAvailable.value && !fbMin.value)
watch(() => state.check, (c) => {
  clearInterval(fbTimer); feedback.value = null
  if (!c || !state.session) return
  fbMin.value = false
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
  <main ref="learnEl" class="learn" :class="{ 'is-paused': paused, 'fb-open': fbShow }">
    <!-- 课程栏：标题 + 首页同款文件夹标签进度 -->
    <div class="classbar">
      <div class="classbar__t"><span class="label pink">嘟囔课堂</span><h1>{{ state.course?.unit ?? '出口报价与交易磋商' }}</h1></div>
      <ol class="folder-tabs steps" aria-label="课程进度">
        <li v-for="(s, i) in STAGES" :key="s.id" :class="{ on: i === stageIdx, past: i < stageIdx }" :aria-current="i === stageIdx ? 'step' : undefined"><span class="n">{{ i + 1 }}</span>{{ s.t }}</li>
      </ol>
    </div>

    <div class="main">
      <!-- 左：通话大窗 + 输入栏 -->
      <section ref="callEl" class="callcol" aria-label="视频通话">
        <div class="callsticky">
          <CallStage :main="mainRole" :pip="pipRole" :phase="rigPhase" :level="speaker.level" :subtitle="subtitle" :reduced-motion="reduced" :paused="paused"
            :title="stage === 'practice' ? '情景磋商 · 三方通话' : '面对面课堂 · 陈老师'" :error-text="state.error ?? ''" @retry="clearError" @swap="swap">
            <button class="cb" :disabled="!busy && !state.speaking" title="打断：停下声音和正在生成的回答，马上问新问题" @click="interrupt"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg><span>打断</span></button>
            <button class="cb" :disabled="ended" :title="paused ? '继续上课' : '暂停上课'" @click="doAction(paused ? 'resume' : 'pause')"><svg v-if="!paused" viewBox="0 0 24 24"><path d="M9 6v12M15 6v12" /></svg><svg v-else viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z" /></svg><span>{{ paused ? '继续' : '暂停' }}</span></button>
            <button class="cb" :aria-pressed="!voiceOn" :title="voiceOn ? '静音' : '打开声音'" @click="toggleVoice"><svg viewBox="0 0 24 24"><path d="M4 10v4h4l5 4V6L8 10z" /><path v-if="voiceOn" d="M16 9a4 4 0 010 6" /><path v-else d="M16 9l5 6M21 9l-5 6" /></svg><span>{{ voiceOn ? '静音' : '开声音' }}</span></button>
            <button class="cb end" :disabled="ended" title="结束本节课" @click="endLearning"><svg viewBox="0 0 24 24"><path d="M3 14c5-5 13-5 18 0l-2.5 2.5-3-2v-2.5c-2.3-.7-4.7-.7-7 0V14.5l-3 2z" /></svg><span>结束</span></button>
          </CallStage>
        </div>
        <p v-if="state.voiceNote" class="vnote small">声音：{{ state.voiceNote }}，字幕照常显示。</p>
      </section>

      <!-- 手机/平板：对话 / 任务 / 出处 -->
      <div class="mtabs" role="tablist" aria-label="切换面板">
        <button role="tab" :aria-selected="mtab === 'chat'" :class="{ on: mtab === 'chat' }" @click="mtab = 'chat'">对话<span class="cnt">{{ state.turns.length }}</span></button>
        <button role="tab" :aria-selected="mtab === 'task'" :class="{ on: mtab === 'task' }" @click="mtab = 'task'">任务<span class="cnt">{{ stageIdx + 1 }}/{{ STAGES.length }}</span><i v-if="!taskSeen" class="dot" aria-label="有新任务"></i></button>
        <button role="tab" :aria-selected="srcSheet" @click="srcSheet = true">出处<span class="cnt">{{ registry.length }}</span></button>
      </div>

      <!-- 右：窗口栈（可拖动、可最小化到 Dock） -->
      <div class="stack">
        <Win v-show="!mins.task" class="w-task" :class="{ 'm-off': mtab !== 'task' }" :label="`任务 · ${STAGES[stageIdx].t}`" tone="orange" draggable minimizable dock enter body-class="taskbody" @minimize="mins.task = true">
          <div :key="stage" class="px-fade task">
            <div v-if="state.error" class="alert" role="alert"><span>{{ state.error }}</span><button class="px-btn" @click="clearError">知道了</button></div>
            <p v-if="booting && !state.session" class="muted">正在接通陈老师…</p>

            <template v-if="stage === 'intro'">
              <h2>你是出口企业的业务员</h2>
              <p>海外买家要 500 件样品。先跟陈老师弄懂三个知识点，再和模拟买家谈一轮，最后提交一份完整方案。</p>
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
                    <button class="px-btn is-pink" :disabled="busy || paused" @click="explain(c.id)">{{ state.session?.explainedCards.includes(c.id) ? '再讲一遍' : '请陈老师讲解' }}</button>
                    <button class="px-btn" :disabled="busy || paused || !state.session?.explainedCards.includes(c.id)" @click="explain(c.id, true)">换个例子</button>
                  </div>
                  <div v-if="state.lastExample" class="example"><b>当前例子（系统算好）</b><span v-for="(v, k2) in state.lastExample" :key="k2">{{ k2 }}：{{ v }}</span></div>
                </div>
              </template>
              <hr />
              <p class="small">准备好了，就和模拟买家 Markus Weber 磋商。他只关心自己的条件，不会替你写方案。</p>
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
              <p v-if="fbShow" class="muted small">完整反馈在下方升起的窗口里。</p>
              <div v-else class="row">
                <button class="px-btn is-pink" :disabled="busy || paused" @click="startRetry">练我没掌握的部分</button>
                <button class="px-btn" @click="fbMin = false">打开反馈</button>
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
        </Win>

        <Win v-show="!mins.chat" class="w-chat" :class="{ 'm-off': mtab !== 'chat' }" label="对话" tone="purple" draggable minimizable dock enter body-class="chatbody" @minimize="mins.chat = true">
          <template #bar><span class="cntb">{{ state.turns.length }} 条</span></template>
          <div ref="logEl" class="log" aria-live="polite">
            <div v-if="!state.turns.length" class="empty">
              <div class="empty__b"><i></i>{{ stage === 'practice' ? '我是模拟买家，先报个价吧。' : '同学你好，我是陈老师。' }}<b>{{ stage === 'practice' ? '价格、首付款、交期都可以谈。' : '哪里没懂，直接问我。' }}</b></div>
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

        <Win v-show="!mins.src" class="w-src" label="出处" tone="green" draggable minimizable dock enter body-class="srcbody" @minimize="mins.src = true">
          <template #bar><span class="cntb">{{ registry.length }} 条</span></template>
          <p v-if="!registry.length" class="muted small">还没有引用。陈老师回答时引用的资料会按顺序列在这里。</p>
          <ol v-else class="srcs">
            <li v-for="(c, i) in registry" :key="c.id"><button type="button" class="src" @click="openCite(c, i + 1)"><span class="n">[{{ i + 1 }}]</span><span class="t">{{ c.title }}</span><span class="k">{{ c.sourceUrl ? '公开资料' : '案例条件' }}</span></button></li>
          </ol>
        </Win>
      </div>

      <!-- 输入栏：桌面在通话窗下方，手机固定在底部 -->
      <div class="composer no-print">
        <div v-if="stage === 'practice'" class="modes" role="radiogroup" aria-label="发给谁">
          <label :class="{ on: mode === 'negotiate' }"><input type="radio" value="negotiate" v-model="mode" />对买家说</label>
          <label :class="{ on: mode === 'ask' }"><input type="radio" value="ask" v-model="mode" />问老师（不计入谈判）</label>
        </div>
        <div class="chips" aria-label="建议">
          <button v-for="q in (negotiating ? DEAL : SUGGEST)" :key="q" type="button" class="px-chip" :disabled="paused || ended || !state.session" @click="suggest(q)">{{ q }}</button>
        </div>
        <div class="inrow">
          <textarea ref="inputEl" v-model="input" rows="1" maxlength="1500" :placeholder="typedPh || ' '" :disabled="paused || ended || !state.session" aria-label="输入框" @keydown="onKey"></textarea>
          <button class="px-btn is-pink send" :disabled="!canSend" @click="send">发送<span class="arr" aria-hidden="true">→</span></button>
        </div>
      </div>
    </div>

    <!-- 反馈窗：从底部升起 -->
    <Transition name="sheet">
      <div v-if="fbShow" class="fbwrap">
        <Win class="fbwin" label="反馈 · 方案核算" tone="pink" minimizable dock body-class="fbbody" @minimize="fbMin = true">
          <div class="fstrip">
            <div class="fact"><b>{{ chk?.valid ? chk.grossMarginText : '—' }}</b><span>毛利率</span></div>
            <div class="fact"><b>{{ chk?.valid ? fmtNum(chk.grossProfit) : '—' }}</b><span>美元毛利</span></div>
            <div class="fact"><b>{{ okCount(chk?.seller) }}</b><span>卖方条件</span></div>
            <div class="fact"><b>{{ okCount(chk?.buyer) }}</b><span>买家条件</span></div>
            <div class="fact"><b>{{ observed }}</b><span>表达观察</span></div>
          </div>
          <div class="fbgrid">
            <div>
              <h3>{{ chk?.agreement ? '双方条件都满足，达成本练习目标' : '还没有达成本练习目标' }}</h3>
              <p v-if="chk?.valid" class="small">销售收入 {{ chk.revenue }} 美元，总成本 {{ chk.cost }} 美元，毛利 {{ chk.grossProfit }} 美元；毛利率 {{ chk.grossMarginText }}，成本加成率 {{ chk.costMarkupText }}。</p>
              <p v-if="state.check?.studentMarginError" class="pill" :class="state.check.studentMarginError === 'none' ? 'ok' : 'amber'">{{ marginErrText[state.check.studentMarginError] }}</p>
              <h4>没达到的地方</h4>
              <p v-if="!misses.length" class="small">都达到了。可以重新谈一次，试试别的说法。</p>
              <ul class="miss">
                <li v-for="m in misses" :key="m.k"><span>{{ m.t }}</span>
                  <button class="px-btn" :disabled="busy || paused" @click="m.how === 'retry' ? startRetry() : againDeal()">{{ m.how === 'retry' ? '练这一项' : '再谈一次' }}</button></li>
              </ul>
            </div>
            <div>
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
          </div>
          <div class="row fbbtns">
            <button class="px-btn is-pink" :disabled="busy || paused" @click="startRetry">练我没掌握的部分</button>
            <button class="px-btn" :disabled="busy" @click="againDeal">重新谈一次</button>
            <RouterLink to="/report" class="px-btn">查看学习报告</RouterLink>
          </div>
        </Win>
      </div>
    </Transition>

    <!-- 手机：出处底部抽屉 -->
    <Transition name="sheet">
      <div v-if="srcSheet" class="srcsheet-scrim" @click.self="srcSheet = false">
        <Win class="srcsheet" label="出处" tone="green" closable body-class="srcbody" @close="srcSheet = false">
          <p v-if="!registry.length" class="muted small">还没有引用。陈老师回答时引用的资料会按顺序列在这里。</p>
          <ol v-else class="srcs">
            <li v-for="(c, i) in registry" :key="c.id"><button type="button" class="src" @click="openCite(c, i + 1)"><span class="n">[{{ i + 1 }}]</span><span class="t">{{ c.title }}</span><span class="k">{{ c.sourceUrl ? '公开资料' : '案例条件' }}</span></button></li>
          </ol>
        </Win>
      </div>
    </Transition>

    <Dock :items="dockItems" @restore="restore" />
    <CitationDrawer />
  </main>
</template>

<style scoped>
.learn { max-width: 1480px; margin: 0 auto; padding: 4px 24px 40px; }
.classbar { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px 24px; padding: 2px 4px 0; flex-wrap: wrap; }
.classbar__t { display: grid; gap: 4px; padding-bottom: 10px; } .classbar__t h1 { font-size: clamp(24px, 2.4vw, 32px); margin: 0; line-height: 1.15; }
.steps { padding-right: 18px; }
.main { display: grid; grid-template-columns: minmax(0, 3fr) minmax(360px, 2fr); grid-template-areas: "call stack" "comp stack"; grid-template-rows: auto 1fr; gap: 18px 22px; align-items: start; border: 1px solid var(--line); background: var(--white) var(--sky) center bottom / 1200px auto repeat-x; padding: 20px; box-shadow: var(--shadow-lg); position: relative; }
.callcol { grid-area: call; min-width: 0; }
.composer { grid-area: comp; }
.stack { grid-area: stack; position: sticky; top: 78px; height: calc(100vh - 100px); min-height: 560px; display: flex; flex-direction: column; gap: 14px; }
.mtabs { display: none; }
.vnote { margin: 8px 2px 0; color: var(--muted); }

/* 通话控制按钮 */
.cb { flex: 1 1 0; min-width: 0; display: inline-flex; align-items: center; justify-content: center; gap: 7px; height: 46px; padding: 0 8px; border: 0; border-right: 1px solid var(--line); background: transparent; font-size: 14px; box-shadow: none; }
.cb svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: square; flex: none; }
.cb:hover:not(:disabled) { background: var(--paper-3); }
.cb:disabled { border-style: solid !important; border-width: 0 1px 0 0 !important; }
.cb.end { background: var(--pink); } .cb.end:hover:not(:disabled) { background: var(--pink-2); } .cb.end svg { fill: currentColor; stroke: none; }

/* 右侧窗口栈 */
.stack :deep(.win) { box-shadow: var(--shadow); }
.w-task { flex: 0 1 auto; max-height: 56%; }
.w-task :deep(.taskbody) { overflow-y: auto; padding: 16px 18px; }
.w-chat { flex: 1 1 0; min-height: 220px; }
.w-chat :deep(.chatbody) { padding: 0; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
.w-src { flex: 0 0 auto; max-height: 26%; }
.w-src :deep(.srcbody) { overflow-y: auto; padding: 10px 12px; }
.cntb { font: 400 12px/1 var(--pixel); color: var(--text-2); white-space: nowrap; }

.task { display: grid; gap: 10px; overflow-wrap: anywhere; }
.task h2 { font-size: 24px; margin: 0; }
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
.facts3 .fact { flex-direction: column; align-items: flex-start; gap: 4px; padding: 10px 12px; border-right: 1px solid var(--line); white-space: normal; }
.facts3 .fact:last-child { border-right: 0; } .facts3 .fact b { font-size: 26px; }
.kv { border-collapse: collapse; table-layout: fixed; width: 100%; border: 1px solid var(--line); word-break: break-word; }
.kv th { text-align: left; color: var(--text-2); font-weight: 400; padding: 6px 8px; background: var(--paper); border: 1px solid var(--hair); font-size: 12.5px; } .kv td { padding: 6px 8px; border: 1px solid var(--hair); }
.offer { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; align-items: end; }
.offer label { display: grid; gap: 4px; font: 400 13px/1.3 var(--pixel); color: var(--text-2); min-width: 0; }
.offer input, .offer textarea { width: 100%; min-width: 0; font-family: var(--sans); }
.offer .wide { grid-column: 1 / -1; } .chk { display: inline-flex !important; gap: 6px; margin-right: 14px; color: var(--ink) !important; }
fieldset { border: 1px solid var(--line); } legend { font: 400 13px/1 var(--pixel); }
.reason { white-space: normal; } .q { font-size: 17px; line-height: 1.6; color: var(--ink); font-weight: 600; }
hr { border: 0; border-top: 1px dashed var(--line); margin: 6px 0; width: 100%; }

/* 对话 */
.log { flex: 1; overflow-y: auto; padding: 14px; display: grid; gap: 14px; align-content: start; }
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

/* 输入栏 */
.composer { display: grid; gap: 10px; padding: 12px; background: var(--paper); border: 1px solid var(--line); box-shadow: var(--shadow); }
.modes { display: flex; border: 1px solid var(--line); width: fit-content; max-width: 100%; }
.modes label { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; font: 400 13px/1.2 var(--pixel); cursor: pointer; background: var(--white); }
.modes label + label { border-left: 1px solid var(--line); }
.modes label.on { background: var(--ink); color: #fff; }
.modes input { position: absolute; opacity: 0; pointer-events: none; }
.modes label:has(input:focus-visible) { outline: 2px solid var(--pink); outline-offset: 2px; }
.inrow { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: stretch; }
.inrow textarea { resize: none; min-height: 48px; font-size: 15px; line-height: 1.5; padding: 12px; }
.send { height: auto; min-height: 48px; }

/* 反馈窗 */
.fbwrap { position: fixed; left: 0; right: 0; bottom: 0; z-index: 1800; display: flex; justify-content: center; padding: 0 24px; pointer-events: none; }
.fbwin { pointer-events: auto; width: min(1180px, 100%); max-height: min(78vh, 760px); box-shadow: 0 -8px 0 0 var(--ink), 8px 0 0 0 var(--ink) !important; border-bottom: 0; }
.fbwin :deep(.fbbody) { overflow-y: auto; padding: 0 0 16px; }
.fstrip { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); border-bottom: 1px solid var(--line); background: var(--paper); }
.fstrip .fact { justify-content: center; padding: 16px 8px; border-right: 1px solid var(--line); }
.fstrip .fact:last-child { border-right: 0; }
.fbgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; padding: 16px 22px 0; }
.fbgrid h3 { font-size: 22px; } .fbgrid h4 { margin: 14px 0 6px; font: 400 14px/1.3 var(--pixel); color: var(--ink); }
.fbgrid p { margin: 6px 0; }
.miss { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.miss li { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--line); background: var(--white); font-size: 14px; }
.miss .px-btn { min-height: 34px; padding: 0 12px; font-size: 13px; flex: none; }
.dim { border: 1px solid var(--line); padding: 10px 12px; margin-top: 8px; background: var(--white); }
blockquote { margin: 8px 0; padding: 8px 12px; background: var(--butter); border-left: 3px solid var(--ink); font-family: var(--serif); }
.fbbtns { padding: 16px 22px 0; }
.sheet-enter-active { transition: transform .45s var(--ease), opacity .3s; } .sheet-leave-active { transition: transform .3s ease, opacity .25s; }
.sheet-enter-from, .sheet-leave-to { transform: translateY(100%); opacity: 0; }
.srcsheet-scrim { display: none; }
.is-paused .task { opacity: .75; }

@media (max-width: 1360px) { .main { grid-template-columns: minmax(0, 1fr) minmax(340px, 400px); } .offer { grid-template-columns: 1fr 1fr; } }

/* ---------------- 手机 / 平板：通话吸顶，标签切换，输入栏固定在底部 ---------------- */
@media (max-width: 1099px) {
  .learn { padding: 0 0 calc(132px + env(safe-area-inset-bottom)); }
  .classbar { display: none; }
  .main { display: block; border: 0; box-shadow: none; padding: 0; background: var(--paper); }
  .callcol { position: sticky; top: 0; z-index: 30; background: var(--paper); padding: 6px 8px 0; }
  .callsticky { max-width: 640px; margin: 0 auto; }
  .vnote { display: none; }
  .cb { height: 40px; font-size: 13px; gap: 5px; }
  .mtabs { display: grid; grid-template-columns: repeat(3, 1fr); position: sticky; top: var(--call-h, 0px); z-index: 29; margin: 8px 8px 0; border: 1px solid var(--line); background: var(--white); box-shadow: 3px 3px 0 var(--ink); }
  .mtabs button { position: relative; height: 40px; border: 0; background: var(--paper); font-size: 14px; white-space: nowrap; display: inline-flex; align-items: center; justify-content: center; gap: 6px; box-shadow: none; }
  .mtabs button + button { border-left: 1px solid var(--line); }
  .mtabs button.on { background: var(--ink); color: #fff; } .mtabs button.on .cnt { color: var(--pink-l); }
  .mtabs .cnt { font-size: 12px; color: var(--muted); }
  .mtabs .dot { width: 8px; height: 8px; background: var(--pink); }
  .stack { position: static; height: auto; min-height: 0; display: block; padding: 10px 8px 0; }
  .stack :deep(.win) { box-shadow: 3px 3px 0 var(--ink); transform: none !important; animation: none; }
  .stack :deep(.bar) { display: none; }
  .w-src { display: none !important; }
  .m-off { display: none !important; }
  .w-task, .w-chat { max-height: none; }
  .w-chat { min-height: calc(100dvh - var(--call-h, 280px) - 190px); }
  .w-chat :deep(.chatbody) { overflow: visible; }
  .log { overflow: visible; padding: 12px 10px; }
  .composer { position: fixed; left: 0; right: 0; bottom: 0; z-index: 1200; gap: 8px; padding: 8px 8px calc(8px + env(safe-area-inset-bottom)); border: 0; border-top: 1px solid var(--line); box-shadow: 0 -3px 0 rgba(20,2,6,.08); }
  .chips { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; padding: 0 2px 3px; } .chips::-webkit-scrollbar { display: none; } .px-chip { flex: none; }
  .inrow textarea { min-height: 44px; padding: 10px; }
  .send { min-height: 44px; padding: 0 14px; }
  .modes label { padding: 5px 9px; font-size: 12px; }
  .fbwrap { padding: 0; z-index: 1900; }
  .fbwin { max-height: 86dvh; box-shadow: 0 -6px 0 0 var(--ink) !important; border-left: 0; border-right: 0; }
  .fstrip { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .fstrip .fact { flex-direction: column; align-items: center; gap: 2px; padding: 10px 4px; border-bottom: 1px solid var(--line); white-space: normal; text-align: center; }
  .fbgrid { grid-template-columns: 1fr; gap: 6px; padding: 12px 14px 0; }
  .fbbtns { padding: 14px 14px 0; }
  .srcsheet-scrim { display: flex; position: fixed; inset: 0; z-index: 2400; align-items: flex-end; background: rgba(20,2,6,.28); }
  .srcsheet { width: 100%; max-height: 70dvh; border-left: 0; border-right: 0; box-shadow: 0 -6px 0 0 var(--ink); }
  .srcsheet :deep(.srcbody) { overflow-y: auto; }
}
@media (max-width: 600px) {
  .offer { grid-template-columns: 1fr 1fr; }
  .facts3 .fact { padding: 8px; } .facts3 .fact b { font-size: 20px; } .facts3 .fact span { font-size: 12px; }
  .cb { height: 40px; padding: 0 4px; gap: 4px; } .cb svg { width: 14px; height: 14px; }
  .miss li { flex-direction: column; align-items: stretch; }
  .task h2 { font-size: 21px; }
}
@media print { .learn { display: none; } }
</style>
