"""Real-browser end-to-end walk-through (real model, real TTS audio) with screenshots, video and audio capture.
Usage: python3 browser_e2e.py <base_url> <outdir> [--wrong]   (base e.g. http://127.0.0.1:8420/human/)
Outputs: screenshots/*.png, video.webm, tts/*.mp3, speech-log.json, run.json (timings, checks)."""
import asyncio, json, pathlib, sys, time
from playwright.async_api import async_playwright

BASE = sys.argv[1].rstrip('/') + '/'
OUT = pathlib.Path(sys.argv[2]); (OUT / 'screenshots').mkdir(parents=True, exist_ok=True); (OUT / 'tts').mkdir(exist_ok=True)
W, H = (390, 844) if '--mobile' in sys.argv else (1440, 900)
checks, tts_files = [], []


def check(name, ok, detail=''):
    checks.append({'name': name, 'ok': bool(ok), 'detail': detail}); print(('PASS ' if ok else 'FAIL ') + name, detail)


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--no-proxy-server'])
        ctx = await b.new_context(viewport={'width': W, 'height': H}, record_video_dir=str(OUT / 'video'), record_video_size={'width': W, 'height': H}, locale='zh-CN')
        t_video0 = time.time()
        page = await ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))

        async def on_tts(route):
            # 透传到真实 /api/tts，同时保存页面实际拿到的音频字节（用于合成录屏音轨）
            resp = await route.fetch()
            body = await resp.body()
            if resp.status == 200:
                text = json.loads(route.request.post_data or '{}').get('text', '')
                f = OUT / 'tts' / f'{len(tts_files):03d}.mp3'; f.write_bytes(body); tts_files.append({'file': f.name, 'text': text, 'bytes': len(body)})
            await route.fulfill(response=resp, body=body)
        await page.route('**/api/tts', on_tts)
        shot = lambda n: page.screenshot(path=str(OUT / 'screenshots' / f'{n}.png'), full_page=False)
        log = lambda: page.evaluate('window.__speechLog || []')

        async def wait_idle(timeout=60):
            # 生成结束（无闪烁光标、无“思考中”）
            t0 = time.time()
            while time.time() - t0 < timeout:
                busy = await page.evaluate("!!document.querySelector('.caret') || document.querySelector('.status')?.textContent.includes('思考')")
                if not busy: return True
                await asyncio.sleep(0.3)
            return False

        async def wait_speech_start(n_before, timeout=30):
            t0 = time.time()
            while time.time() - t0 < timeout:
                lg = await log()
                if sum(1 for e in lg if e['type'] == 'start') > n_before: return True
                await asyncio.sleep(0.2)
            return False

        async def wait_speech_idle(timeout=90):
            t0 = time.time()
            while time.time() - t0 < timeout:
                if not await page.evaluate('window.__speakerActive && window.__speakerActive()') and not await page.evaluate("!!document.querySelector('.caret')"):
                    await asyncio.sleep(0.5)
                    if not await page.evaluate('window.__speakerActive()'): return True
                await asyncio.sleep(0.3)
            return False

        starts = lambda lg: sum(1 for e in lg if e['type'] == 'start')

        # 1 入口
        await page.goto(BASE, wait_until='networkidle'); await asyncio.sleep(1.5)
        await shot('01-entry')
        check('entry shows live model status', await page.locator('text=已连接').count() > 0)
        await page.click('button:has-text("开始上课") >> nth=0'); await page.wait_for_url('**/learn'); await asyncio.sleep(1)
        await shot('02-learn-intro')
        await page.click('text=开始讲解'); await asyncio.sleep(0.5)
        # 2 讲解 K1 + 真实语音 + 角色状态跟随播放
        n = starts(await log())
        await page.click('text=请陈老师讲解')
        await asyncio.sleep(1.2); await shot('03-thinking')
        ok = await wait_speech_start(n)
        await asyncio.sleep(0.6)
        phase_during = await page.get_attribute('.rig-wrap', 'data-phase')
        await shot('04-speaking')
        check('speech started from real audio playing event', ok)
        check('avatar phase is speaking while audio plays', phase_during == 'speaking', phase_during)
        await asyncio.sleep(3)
        # 3 停止讲话（只停声音，文字保留）
        txt_before = await page.locator('.m-teacher .bubble').last.inner_text()
        await page.click('button[title="停止讲话"]'); await asyncio.sleep(0.8)
        lg = await log(); cancels = [e for e in lg if e['type'] == 'cancel']
        check('stop speaking emits cancel with latency', bool(cancels), str(cancels[-1].get('latencyMs') if cancels else None))
        check('stop keeps the text', len(await page.locator('.m-teacher .bubble').last.inner_text()) >= len(txt_before) - 2)
        check('avatar leaves speaking after stop', (await page.get_attribute('.rig-wrap', 'data-phase')) != 'speaking')
        await wait_idle()
        ex1 = await page.locator('.example').inner_text() if await page.locator('.example').count() else ''
        # 4 换个例子（动态生成）
        n_t = await page.locator('.m-teacher').count()
        await page.click('text=换个例子')
        for _ in range(100):
            if await page.locator('.m-teacher').count() > n_t: break
            await asyncio.sleep(0.2)
        await asyncio.sleep(0.5); await wait_idle(); await asyncio.sleep(0.8)
        ex2 = await page.locator('.example').inner_text() if await page.locator('.example').count() else ''
        check('new example differs', ex1 != ex2, f'{ex1[:60]} | {ex2[:60]}')
        await shot('05-example')
        await wait_speech_idle(40)
        # 5 自由提问 + 打开出处
        await page.fill('textarea', '毛利率和成本加成率到底差在哪？举个数说明'); await page.keyboard.press('Enter')
        await wait_idle(); await asyncio.sleep(0.5)
        cites = page.locator('.m-teacher').last.locator('.cite')
        check('free question answered with citation', await cites.count() > 0)
        if await cites.count():
            await cites.first.click(); await asyncio.sleep(0.6); await shot('06-citation'); await page.click('.drawer header button')
        # 6 讲话中途打断再问（旧回复不应覆盖新回复）
        await page.fill('textarea', '请详细说说 CIF 和 CIP 的保险要求有什么不同，以及对报价有什么影响？'); await page.keyboard.press('Enter')
        await page.wait_for_selector('.caret', timeout=20000)  # 第一条正在流式输出时打断
        await page.fill('textarea', '美国现在对中国商品的关税是多少？'); await page.keyboard.press('Enter')
        await asyncio.sleep(1.0)
        for _ in range(150):
            done_txt = await page.evaluate("(() => { const b = [...document.querySelectorAll('.m-teacher')].pop(); return b && !b.querySelector('.caret') ? b.querySelector('.bubble').innerText : '' })()")
            if done_txt: break
            await asyncio.sleep(0.3)
        await asyncio.sleep(0.5)
        last = await page.locator('.m-teacher .bubble').last.inner_text()
        check('out-of-scope question answered as insufficient', '材料不足' in last, last[:60])
        stopped = await page.locator('text=已停止生成').count()
        check('interrupted request marked stopped, not overwritten', stopped >= 1, f'stopped bubbles={stopped}')
        await shot('07-out-of-scope')
        await wait_speech_idle(40)
        # 7 买家磋商
        await page.click('button:has-text("开始买方谈判")'); await asyncio.sleep(1)
        check('role switched to buyer', await page.locator('text=当前角色：模拟买家').count() > 0)
        for m in ['您好，我们报价每件 13.5 美元，500 件，首付款 30%，20 天交货。', '我理解您担心价格。我们的单位成本是 10 美元，13.5 美元的毛利率也只有约 26%。我可以降到 12.8 美元。', '那就 12.5 美元一件、首付款 30%、20 天交货，这是我们最好的条件了。']:
            await page.fill('textarea', m); await page.keyboard.press('Enter'); await wait_idle(); await asyncio.sleep(0.5)
        await shot('08-negotiation')
        buyer_txt = ' '.join(await page.locator('.m-buyer .bubble').all_inner_texts())
        check('buyer never reveals 12.80 threshold unprompted', '12.80' not in buyer_txt)
        await wait_speech_idle(40)
        # 8 提交带错误的方案（把加成率当毛利率）
        wrong = '--wrong' in sys.argv or True
        await page.fill('input[placeholder="如 12.50"]', '12.5'); await page.fill('input[placeholder="如 30"]', '30'); await page.fill('input[placeholder="如 20"]', '20')
        await page.fill('input[placeholder="选填，系统会核对"]', '20' if '--correct' in sys.argv else '25')
        await page.click('text=提交最终方案')
        await page.wait_for_selector('text=反馈：客观核算', timeout=15000)
        for _ in range(60):
            if await page.locator('.dim').count(): break
            await asyncio.sleep(1)
        await asyncio.sleep(0.5); await shot('09-feedback')
        check('margin self-check classified', await page.locator('text=' + ('你算的毛利率正确' if '--correct' in sys.argv else '你填的是成本加成率')).count() > 0)
        check('gross profit 1250.00', await page.locator('text=1250.00 美元').count() > 0)
        # 9 复练
        await page.click('text=练我没掌握的部分')
        await page.wait_for_selector('text=针对性复练'); await wait_idle(); await asyncio.sleep(0.5)
        q = await page.locator('.card:has-text("针对性复练") b').first.inner_text()
        await shot('10-retry-question')
        import re
        nums = re.findall(r'(\d+(?:\.\d+)?)', q)
        cost, price, qty = float(nums[0]), float(nums[1]), float(nums[2])
        gp = (price - cost) * qty; gm = (price - cost) / price * 100
        await page.fill('.card:has-text("针对性复练") input >> nth=0', f'{gp:.2f}')
        await page.fill('.card:has-text("针对性复练") input >> nth=1', f'{gm:.2f}')
        await page.fill('.card:has-text("针对性复练") textarea', '毛利率用毛利除以售价，成本加成率用毛利除以成本，分母不同。')
        await page.click('text=提交答案'); await wait_idle(); await asyncio.sleep(1)
        check('retry graded correct', await page.locator('text=全部正确').count() > 0, q)
        await shot('11-retry-result')
        await wait_speech_idle(40)
        # 10 报告
        await page.click('text=查看学习报告'); await page.wait_for_selector('text=学习报告'); await asyncio.sleep(1.5)
        await shot('12-report')
        await page.screenshot(path=str(OUT / 'screenshots' / '13-report-full.png'), full_page=True)
        await page.pdf(path=str(OUT / 'report.pdf'), format='A4', print_background=True)
        check('report contains transcript turn ids', await page.locator('text=T001').count() > 0)
        check('no page errors', not errors, '; '.join(errors)[:300])
        speech = await log()
        await ctx.close()
        vids = list((OUT / 'video').glob('*.webm'))
        if vids: vids[0].rename(OUT / 'video.webm')
        await b.close()
    json.dump(speech, open(OUT / 'speech-log.json', 'w'), ensure_ascii=False, indent=1)
    json.dump({'base': BASE, 'viewport': [W, H], 'videoStartWall': t_video0 * 1000, 'checks': checks, 'tts': tts_files, 'pageErrors': errors}, open(OUT / 'run.json', 'w'), ensure_ascii=False, indent=1)
    print('passed', sum(c['ok'] for c in checks), '/', len(checks))

asyncio.run(main())
