# OpenAI 兼容假模型：故意返回长文本、长英文单词、长数字，用来压测排版
import json, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
LONG = ("好的，我们一起来看这个报价。单价 13.50 美元、首付款 30%、交期 20 天在本案例中都满足条件 [F-CASE-01]。"
        "注意毛利率=毛利/销售收入，不是成本加成率 [F-QUOTE-01]。Supercalifragilisticexpialidocious_CIF_Hamburg_Incoterms2020_reference_"
        "1234567890123456789012345678901234567890 这是一个很长的不换行串。再补充一句较长的说明，确保气泡会折行而不会撑开容器。")
FB = {"dimensions":[{"id":"D1","status":"not_observed","turnId":None,"quote":None,"comment":"对话中未观察到相关表达，"+"很长的评价"*20,"suggestion":"建议"+"VeryLongEnglishWordWithoutSpaces"*3},
 {"id":"D2","status":"not_observed","turnId":None,"quote":None,"comment":"x"*120,"suggestion":"把首付款比例和交期一起报出来。"*4},
 {"id":"D3","status":"not_observed","turnId":None,"quote":None,"comment":"未观察到","suggestion":"https://example.com/"+"a"*90}],"summary":"两句话总评。"*10}
class H(BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def do_GET(self):
        self.send_response(200); self.send_header('content-type','application/json'); self.end_headers(); self.wfile.write(b'{"data":[{"id":"deepseek-flash"}]}')
    def do_POST(self):
        n=int(self.headers.get('content-length',0)); body=json.loads(self.rfile.read(n) or b'{}')
        isjson = body.get('response_format',{}).get('type')=='json_object'
        text = json.dumps(FB, ensure_ascii=False) if isjson else LONG
        if body.get('stream'):
            self.send_response(200); self.send_header('content-type','text/event-stream'); self.end_headers()
            for i in range(0,len(text),12):
                ch={"choices":[{"delta":{"content":text[i:i+12]},"index":0}]}
                self.wfile.write(f"data: {json.dumps(ch,ensure_ascii=False)}\n\n".encode()); self.wfile.flush(); time.sleep(0.005)
            self.wfile.write(b"data: [DONE]\n\n"); self.wfile.flush()
        else:
            r={"choices":[{"message":{"role":"assistant","content":text},"index":0,"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}
            b=json.dumps(r,ensure_ascii=False).encode(); self.send_response(200); self.send_header('content-type','application/json'); self.send_header('content-length',str(len(b))); self.end_headers(); self.wfile.write(b)
ThreadingHTTPServer(('127.0.0.1',8499),H).serve_forever()
