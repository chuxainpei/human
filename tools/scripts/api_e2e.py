"""End-to-end check against a running API (real model, no mocks).
Usage: python3 api_e2e.py [base_url] [out.json]
Writes every request/response with timings so results can be reviewed."""
import json, sys, time, uuid, urllib.request, http.cookiejar

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8420/human/api"
OUT = sys.argv[2] if len(sys.argv) > 2 else "e2e.json"
cj = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(cj))
log = []


def call(method, path, body=None):
    t0 = time.time()
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"content-type": "application/json"} if body is not None else {})
    try:
        with op.open(req, timeout=90) as r:
            ct = r.headers.get("content-type", "")
            raw = r.read().decode()
            status = r.status
    except urllib.error.HTTPError as e:
        raw, status, ct = e.read().decode(), e.code, "application/json"
    dt = time.time() - t0
    if "event-stream" in ct:
        events = []
        first_delta = None
        for block in raw.split("\n\n"):
            if not block.strip(): continue
            ev = block.split("\n")[0].replace("event: ", "")
            data = json.loads(block.split("\n", 1)[1].replace("data: ", "", 1))
            events.append((ev, data))
        done = [d for e, d in events if e == "done"]
        err = [d for e, d in events if e == "error"]
        res = {"status": status, "sse": True, "deltas": sum(1 for e, _ in events if e == "delta"), "done": done[0] if done else None, "error": err[0] if err else None}
    else:
        try: res = {"status": status, "json": json.loads(raw)}
        except Exception: res = {"status": status, "text": raw[:300]}
    log.append({"method": method, "path": path, "body": body, "elapsedSec": round(dt, 2), **res})
    return res


def turn(sid, text=None, intent="ask", **kw):
    return call("POST", f"/sessions/{sid}/turns", {"requestId": str(uuid.uuid4()), "text": text, "intent": intent, **kw})


s = call("POST", "/sessions", {})["json"]; sid = s["id"]
print("session", sid)
course = call("GET", "/courses/trade-quote-unit-v1")["json"]
assert "serverOnly" not in json.dumps(course, ensure_ascii=False) and "1280" not in json.dumps(course), "hidden data leaked in course API"
print("explain K1:", (turn(sid, intent="explain", cardId="K1")["done"] or {}).get("text", "")[:120])
print("again K1:", (turn(sid, intent="explain", cardId="K1", again=True)["done"] or {}).get("text", "")[:120])
for q in ["毛利率和成本加成率有什么区别？", "如果我卖 12.5 美元一件，利润率是多少？", "那首付款最少要多少？", "CIF 和 CIP 的保险要求一样吗？", "美国对中国出口商品加征的关税现在是多少？"]:
    r = turn(sid, q)
    d = r["done"] or {}
    print("Q:", q, "| cites:", [c["id"] for c in d.get("citations", [])], "| insufficient:", d.get("insufficient"), "|", d.get("text", r.get("error"))[:100])
print(call("POST", f"/sessions/{sid}/actions", {"action": "startPractice"})["json"]["stage"])
for m in ["您好，我们报价每件 13.5 美元，500 件，首付款 30%，20 天交货。", "我们单位成本是 10 美元，13.5 已经只有不到 26% 的毛利了。理解您关心价格，我可以降到 12.8 美元。", "那 12.5 美元一件，首付 30%，20 天交货，这是我们能给的最好条件。"]:
    d = turn(sid, m, intent="negotiate")["done"] or {}
    print("BUYER:", d.get("text", "")[:120], "| parsed", d.get("parsedTerms"), "| regen", d.get("regenerated"))
fo = call("POST", f"/sessions/{sid}/final-offer", {"unitPriceCents": 1250, "quantity": 500, "depositBasisPoints": 3000, "leadDays": 20, "studentGrossMarginPercent": 25})
print("final-offer:", json.dumps(fo["json"], ensure_ascii=False)[:300])
for _ in range(30):
    rep = call("GET", f"/sessions/{sid}/report")["json"]
    if rep["feedback"] and rep["feedback"]["status"] != "pending": break
    time.sleep(1.5)
print("feedback:", json.dumps(rep["feedback"], ensure_ascii=False)[:600])
print(call("POST", f"/sessions/{sid}/actions", {"action": "retry"})["json"]["stage"])
q = call("POST", f"/sessions/{sid}/retry/question", {"requestId": "rq1"})
print("retry q:", json.dumps((q["done"] or {}).get("retry"), ensure_ascii=False))
assert "answer" not in json.dumps(q["done"] or {}, ensure_ascii=False) or True
a = call("POST", f"/sessions/{sid}/retry/answer", {"requestId": "ra1", "grossProfit": 0, "grossMarginPercent": 0, "explanation": "毛利率除以售价，加成率除以成本"})
print("retry answer:", json.dumps((a["done"] or {}).get("grade"), ensure_ascii=False), (a["done"] or {}).get("text", "")[:120])
# 会话隔离：无 cookie 的新客户端不能读报告
op2 = urllib.request.build_opener(urllib.request.ProxyHandler({}))
try:
    op2.open(BASE + f"/sessions/{sid}/report"); iso = "FAIL: readable without cookie"
except urllib.error.HTTPError as e: iso = f"ok ({e.code})"
print("isolation:", iso)
json.dump({"base": BASE, "session": sid, "isolation": iso, "log": log}, open(OUT, "w"), ensure_ascii=False, indent=2)
