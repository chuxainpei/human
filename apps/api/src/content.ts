import { readFileSync } from 'node:fs'

export interface Fact {
  id: string; title: string; text: string; sourceType: string
  sourceUrl?: string | null; publicLocator?: string; quote?: string; reviewStatus: string
  sourcePath?: string; locator?: string
}
export interface Card { id: string; title: string; goal: string; factIds: string[]; exampleKind: 'margin' | 'terms' | 'talk' }
export interface CaseVisible {
  isFictional: boolean; currency: string; product: string; unitCostCents: number; quantity: number
  sellerMinimumUnitPriceCents: number; sellerDesiredUnitPriceCents: number; minimumDepositBasisPoints: number
  minimumLeadDays: number; maximumLeadDays: number; openingBuyerMessage: string; task: string
  suggestedDialogueRounds: { minimum: number; maximum: number }; factIds: string[]
}
export interface CaseHidden {
  buyerMaximumUnitPriceCents: number; buyerMaximumDepositBasisPoints: number; buyerMaximumLeadDays: number
  buyerRequiredQuantity: number; rolePolicy: string; executionPolicy: string
  testCases: { id: string; offer: Offer; expect: Record<string, unknown> }[]
}
export interface Offer { unitPriceCents: number; quantity: number; depositBasisPoints: number; leadDays: number }
export interface CoursePack {
  courseId: string; version: string; name: string; unit: string; audience: string; reviewStatus: string; provenance: string
  learningGoals: string[]; rubricVersion: string; facts: Fact[]; knowledgeCards: Card[]
  cases: { id: string; title: string; studentVisible: CaseVisible; serverOnly: CaseHidden }[]
  retryTemplate: { unitCostCentsCandidates: number[]; priceMultiplierCandidates: number[]; quantityCandidates: number[] }
}

export function loadCourse(file: string): CoursePack {
  const c = JSON.parse(readFileSync(file, 'utf8')) as CoursePack
  if (!c.courseId || !c.facts?.length || !c.cases?.length) throw new Error('invalid course pack')
  return c
}

/** 学生可见投影：只含公开片段；不含 serverOnly、答案键、内部路径。 */
export function publicFact(f: Fact) {
  return { id: f.id, title: f.title, text: f.text, sourceType: f.sourceType, sourceUrl: f.sourceUrl ?? null, locator: f.publicLocator ?? f.id, quote: f.quote ?? null, reviewStatus: f.reviewStatus }
}
export function publicCourse(c: CoursePack) {
  const k = c.cases[0]
  return {
    courseId: c.courseId, version: c.version, name: c.name, unit: c.unit, audience: c.audience,
    reviewStatus: c.reviewStatus, provenance: c.provenance, learningGoals: c.learningGoals,
    stages: ['intro', 'explain', 'practice', 'feedback', 'retry', 'done'],
    cards: c.knowledgeCards.map((x) => ({ id: x.id, title: x.title, goal: x.goal, factIds: x.factIds })),
    facts: c.facts.map(publicFact),
    case: { id: k.id, title: k.title, ...k.studentVisible },
  }
}

// ---------- 本地检索：中文二元组 + 英文词 + 同义词扩展，按片段打分 ----------
const SYN: [RegExp, string][] = [
  [/利润率|毛利润率|赚多少|利润比例/g, '毛利率'],
  [/加价率|成本加成|加成/g, '成本加成率'],
  [/定金|预付款|预付|订金|首付/g, '首付款'],
  [/交货期|交期|几天交货|交付时间|发货时间|交货时间/g, '交付天数'],
  [/单价|报价|价格|多少钱/g, '单价 报价'],
  [/保险/g, '保险 CIF CIP'],
  [/贸易术语|国际贸易术语|术语/g, 'Incoterms 贸易术语'],
  [/费用|成本项|运费/g, '费用 成本 A9/B9'],
  [/顾虑|担心|异议|反对/g, '顾虑 回应'],
  [/谈判|磋商|沟通|说服/g, '磋商 对话 解释'],
  [/最少|至少|最低|下限/g, '不少于 至少 最低'],
  [/成本|卖多少|案例数据|这个案例|本案/g, '单位成本 案例 数据'],
]
export function expandQuery(q: string) {
  let x = q
  for (const [re, add] of SYN) if (re.test(q)) x += ' ' + add
  return x
}
function grams(s: string): Set<string> {
  const out = new Set<string>()
  const t = s.toLowerCase().replace(/[，。、；：！？（）()“”"'《》\s,.;:!?]+/g, ' ')
  for (const w of t.match(/[a-z0-9/]+/g) ?? []) if (w.length > 1) out.add(w)
  const han = t.replace(/[a-z0-9/ ]+/g, ' ')
  for (const seg of han.split(' ')) for (let i = 0; i + 1 < seg.length; i++) out.add(seg.slice(i, i + 2))
  return out
}
const STOP = new Set(['什么', '怎么', '如何', '可以', '一个', '这个', '我们', '你们', '是否', '为什么', '本案', '案例', '课堂', '本课', '需要', '应该', '多少'])
export function retrieve(c: CoursePack, query: string, k = 3) {
  const qg = [...grams(expandQuery(query))].filter((g) => !STOP.has(g))
  const scored = c.facts.map((f) => {
    const fg = grams(f.title + ' ' + f.text + ' ' + (f.quote ?? ''))
    const tg = grams(f.title)
    let s = 0
    for (const g of qg) { if (fg.has(g)) s += 1; if (tg.has(g)) s += 1.5 }
    return { fact: f, score: qg.length ? s / Math.sqrt(qg.length) : 0 }
  }).sort((a, b) => b.score - a.score)
  return scored.filter((x) => x.score >= 0.6).slice(0, k)
}
