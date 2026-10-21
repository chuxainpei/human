import type { CaseHidden, CaseVisible, Offer } from './content.js'

export type CheckResult =
  | { valid: false; error: string; grossMargin: null }
  | {
      valid: true
      revenueCents: number; costCents: number; grossProfitCents: number
      grossMargin: number; costMarkup: number
      seller: { pass: boolean; checks: { field: string; ok: boolean; rule: string }[] }
      buyer: { pass: boolean; checks: { field: string; ok: boolean; rule: string }[] }
      agreement: boolean
    }

const isPosInt = (n: unknown) => Number.isInteger(n) && (n as number) > 0

export function validateOffer(o: Partial<Offer>): string | null {
  if (o == null) return 'MISSING_FIELDS'
  if (o.unitPriceCents === undefined || o.quantity === undefined || o.depositBasisPoints === undefined || o.leadDays === undefined) return 'MISSING_FIELDS'
  if (!isPosInt(o.unitPriceCents)) return 'INVALID_PRICE'
  if (!isPosInt(o.quantity)) return 'INVALID_QUANTITY'
  if (!Number.isInteger(o.depositBasisPoints) || o.depositBasisPoints! < 0 || o.depositBasisPoints! > 10000) return 'INVALID_DEPOSIT'
  if (!isPosInt(o.leadDays)) return 'INVALID_LEAD_DAYS'
  return null
}

/** 客观核算：全部整数分/基点，规则来自 course.json objectiveRules。 */
export function checkOffer(o: Offer, v: CaseVisible, h: CaseHidden): CheckResult {
  const err = validateOffer(o)
  if (err) return { valid: false, error: err, grossMargin: null }
  const revenueCents = o.unitPriceCents * o.quantity
  const costCents = v.unitCostCents * o.quantity
  const grossProfitCents = revenueCents - costCents
  const grossMargin = (o.unitPriceCents - v.unitCostCents) / o.unitPriceCents
  const costMarkup = (o.unitPriceCents - v.unitCostCents) / v.unitCostCents
  const sellerChecks = [
    { field: 'unitPrice', ok: o.unitPriceCents >= v.sellerMinimumUnitPriceCents, rule: `单价 ≥ ${(v.sellerMinimumUnitPriceCents / 100).toFixed(2)} 美元` },
    { field: 'quantity', ok: o.quantity === v.quantity, rule: `数量 = ${v.quantity} 件` },
    { field: 'deposit', ok: o.depositBasisPoints >= v.minimumDepositBasisPoints, rule: `首付款 ≥ ${v.minimumDepositBasisPoints / 100}%` },
    { field: 'leadDays', ok: o.leadDays >= v.minimumLeadDays && o.leadDays <= v.maximumLeadDays, rule: `交付 ${v.minimumLeadDays}–${v.maximumLeadDays} 天（含边界）` },
  ]
  const buyerChecks = [
    { field: 'unitPrice', ok: o.unitPriceCents <= h.buyerMaximumUnitPriceCents, rule: `模拟买方可接受单价上限 ${(h.buyerMaximumUnitPriceCents / 100).toFixed(2)} 美元` },
    { field: 'quantity', ok: o.quantity === h.buyerRequiredQuantity, rule: `模拟买方需要 ${h.buyerRequiredQuantity} 件` },
    { field: 'deposit', ok: o.depositBasisPoints <= h.buyerMaximumDepositBasisPoints, rule: `模拟买方可接受首付款上限 ${h.buyerMaximumDepositBasisPoints / 100}%` },
    { field: 'leadDays', ok: o.leadDays <= h.buyerMaximumLeadDays, rule: `模拟买方可接受交期上限 ${h.buyerMaximumLeadDays} 天` },
  ]
  const sp = sellerChecks.every((c) => c.ok), bp = buyerChecks.every((c) => c.ok)
  return { valid: true, revenueCents, costCents, grossProfitCents, grossMargin, costMarkup, seller: { pass: sp, checks: sellerChecks }, buyer: { pass: bp, checks: buyerChecks }, agreement: sp && bp }
}

/** 粗粒度标签：买家模型只拿到这些标签，拿不到阈值数字。 */
export function buyerLabels(o: Partial<Offer>, h: CaseHidden) {
  const out: Record<string, 'acceptable' | 'needs_change' | 'unknown'> = { price: 'unknown', deposit: 'unknown', leadDays: 'unknown', quantity: 'unknown' }
  if (o.unitPriceCents) out.price = o.unitPriceCents <= h.buyerMaximumUnitPriceCents ? 'acceptable' : 'needs_change'
  if (o.depositBasisPoints !== undefined) out.deposit = o.depositBasisPoints <= h.buyerMaximumDepositBasisPoints ? 'acceptable' : 'needs_change'
  if (o.leadDays) out.leadDays = o.leadDays <= h.buyerMaximumLeadDays ? 'acceptable' : 'needs_change'
  if (o.quantity) out.quantity = o.quantity === h.buyerRequiredQuantity ? 'acceptable' : 'needs_change'
  return out
}

/** 从学生的中文磋商话语里抽取条件（尽力而为；最终以结构化提交为准）。 */
export function parseOfferText(text: string): Partial<Offer> {
  const t = text.replace(/，/g, ',').replace(/．/g, '.')
  const o: Partial<Offer> = {}
  // 取最后一个“非成本”价格：磋商中后说的数字代表最新报价
  const prices: number[] = []
  const re = /(?:\$|USD\s*)(\d{1,3}(?:\.\d{1,2})?)|(\d{1,3}(?:\.\d{1,2})?)\s*(?:美元|美金|刀|USD)/gi
  for (const m of t.matchAll(re)) {
    const before = t.slice(Math.max(0, (m.index ?? 0) - 6), m.index)
    if (/成本|运费|保险|毛利|利润/.test(before)) continue
    const p = Math.round(parseFloat(m[1] ?? m[2]) * 100)
    if (p > 0 && p < 100000) prices.push(p)
  }
  if (prices.length) o.unitPriceCents = prices[prices.length - 1]
  const dep = t.match(/(?:首付款?|预付款?|定金|订金)[^\d]{0,6}(\d{1,3})\s*%/) ?? t.match(/(\d{1,3})\s*%\s*(?:的)?(?:首付|预付|定金|订金)/)
  if (dep) o.depositBasisPoints = Math.min(10000, parseInt(dep[1], 10) * 100)
  const lead = t.match(/(\d{1,3})\s*(?:个)?(?:工作)?天/)
  if (lead) o.leadDays = parseInt(lead[1], 10)
  const qty = t.match(/(\d{2,6})\s*件/)
  if (qty) o.quantity = parseInt(qty[1], 10)
  return o
}

/** 买家回复泄露检查：不得出现隐藏阈值的数字形态。 */
export function leaksHidden(reply: string, h: CaseHidden, v: CaseVisible, studentSaid = ''): boolean {
  const p = h.buyerMaximumUnitPriceCents / 100
  const forms = [p.toFixed(2), String(p), String(h.buyerMaximumUnitPriceCents)]
  // 买方首付款/交期上限与卖方公开条件重合时不算泄露，避免误杀
  if (h.buyerMaximumDepositBasisPoints !== v.minimumDepositBasisPoints) forms.push(`${h.buyerMaximumDepositBasisPoints / 100}%`)
  return forms.some((f) => reply.includes(f) && !studentSaid.includes(f.replace(/0$/, ''))) || /(底价|最高能接受|上限是|保留价)/.test(reply) && /\d/.test(reply)
}

export function claimsTeacher(reply: string) {
  return /(我是(你的)?(老师|助教|教师|Mori|林老师|陈老师)|作为(老师|助教))/.test(reply)
}

export const pct = (x: number) => (x * 100).toFixed(2) + '%'
export const usd = (c: number) => (c / 100).toFixed(2)
