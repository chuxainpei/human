import asyncio, sys, json, os
from playwright.async_api import async_playwright
BASE = sys.argv[1]
WIDTHS = [int(x) for x in (sys.argv[2] if len(sys.argv)>2 else '320,360,390,414,768,1024,1280,1440').split(',')]
CHECK = r"""(() => {
  const W = document.documentElement.clientWidth, out = [];
  const clipped = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const s = getComputedStyle(p); if (/(hidden|clip|auto|scroll)/.test(s.overflowX)) return true } return false };
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    const s = getComputedStyle(el); if (s.visibility === 'hidden' || s.position === 'fixed') continue;
    if ((r.right > W + 1 || r.left < -1) && !clipped(el)) out.push({ k: 'edge', el: el.tagName.toLowerCase() + '.' + [...el.classList].join('.'), l: Math.round(r.left), r: Math.round(r.right), txt: (el.innerText||'').slice(0,30) });
    if (/(auto|scroll)/.test(s.overflowX) && el.scrollWidth > el.clientWidth + 2 && !el.matches('.chips, textarea, .cases__tabs, .folders, pre')) out.push({ k: 'innerscroll', el: el.tagName.toLowerCase() + '.' + [...el.classList].join('.'), sw: el.scrollWidth, cw: el.clientWidth });
  }
  return { W, sw: document.documentElement.scrollWidth, bodysw: document.body.scrollWidth, issues: out.slice(0, 12) };
})()"""
async def step(pg, tag, res, W):
    await pg.wait_for_timeout(500)
    r = await pg.evaluate(CHECK)
    bad = r['sw'] > r['W'] or r['issues']
    res.append({'w': W, 'step': tag, 'sw': r['sw'], 'W': r['W'], 'issues': r['issues']})
    if bad: await pg.screenshot(path=f'/workspace/work/sweep/bad-{W}-{tag}.png')
async def click(pg, name, role='button'):
    await pg.get_by_role(role, name=name).first.click(timeout=6000)
async def tab(pg, name):
    t = pg.get_by_role('tab', name=name)
    if await t.count() and await t.first.is_visible(): await t.first.click()
async def run(b, W, res):
    pg = await b.new_page(viewport={'width': W, 'height': 800 if W < 700 else 900})
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    await pg.goto(BASE + os.environ.get('SWEEP_START', '')); await pg.wait_for_timeout(1200)  # 首页已是静态页：SWEEP_START=entry 从课程入口开课
    await pg.evaluate("window.scrollTo(0, document.body.scrollHeight)"); await pg.wait_for_timeout(600); await pg.evaluate("window.scrollTo(0,0)")
    await step(pg, 'home', res, W)
    try:
        await click(pg, '开始上课'); await pg.wait_for_timeout(1500); await step(pg, 'intro', res, W)
        await click(pg, '开始讲解'); await pg.wait_for_timeout(1200); await step(pg, 'concepts', res, W)
        await click(pg, '请陈老师讲解'); await pg.wait_for_timeout(3500); await tab(pg, '对话'); await step(pg, 'explain-chat', res, W)
        await tab(pg, '任务'); await click(pg, '开始买方谈判'); await pg.wait_for_timeout(2500); await step(pg, 'practice-task', res, W)
        await tab(pg, '对话'); ta = pg.locator('textarea'); await ta.fill('每件 13.5 美元，首付款 30%，20 天交货，Supercalifragilisticexpialidocious1234567890123456789'); await ta.press('Enter'); await pg.wait_for_timeout(3500); await step(pg, 'practice-chat', res, W)
        await tab(pg, '任务')
        await pg.get_by_placeholder('如 12.50').fill('13.5'); await pg.get_by_placeholder('如 30').fill('30'); await pg.get_by_placeholder('如 20').fill('20'); await pg.get_by_placeholder('选填，系统会核对').fill('25.93')
        await click(pg, '提交最终方案'); await pg.wait_for_timeout(4000); await step(pg, 'feedback', res, W)
        await click(pg, '练我没掌握的部分'); await pg.wait_for_timeout(4000); await step(pg, 'retry', res, W)
        gp = pg.locator('form.offer input[inputmode=decimal]')
        if await gp.count() >= 2: await gp.nth(0).fill('1750'); await gp.nth(1).fill('25.93')
        else:
            for cb in await pg.locator('form.offer input[type=checkbox]').all(): await cb.check()
        await pg.locator('form.offer textarea').fill('毛利率等于毛利除以销售收入'*8 + 'LongWordWithoutAnySpaces'*4)
        await click(pg, '提交答案'); await pg.wait_for_timeout(4000); await step(pg, 'retry-done', res, W)
        await click(pg, '重新谈一次'); await pg.wait_for_timeout(2500); await step(pg, 'restart', res, W)
    except Exception as e:
        res.append({'w': W, 'step': 'FLOW-ERROR', 'err': str(e)[:200]}); await pg.screenshot(path=f'/workspace/work/sweep/flow-{W}.png')
    try:
        await pg.goto(BASE + 'report'); await pg.wait_for_timeout(2000); await step(pg, 'report', res, W)
    except Exception as e: res.append({'w': W, 'step': 'REPORT-ERROR', 'err': str(e)[:200]})
    if errs: res.append({'w': W, 'step': 'JS-ERRORS', 'err': errs[:3]})
    await pg.close()
async def main():
    res = []
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=os.environ.get('CHROMIUM', '/usr/bin/chromium'), args=['--no-sandbox', '--no-proxy-server', '--disable-gpu'])
        for W in WIDTHS: await run(b, W, res)
        await b.close()
    json.dump(res, open('/workspace/work/sweep/result.json', 'w'), ensure_ascii=False, indent=1)
    for r in res:
        if r.get('issues') or r.get('err') or (r.get('sw', 0) > r.get('W', 1e9)): print(json.dumps(r, ensure_ascii=False)[:600])
    print('steps', len(res))
asyncio.run(main())
