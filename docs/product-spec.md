# 实现规格（与任务包 03 的对应）

页面：`/human/` 课程入口、`/human/learn` 学习工作台、`/human/report` 学习报告（窄屏单列）。
阶段：intro → explain → practice → feedback → retry → done（服务端校验；自由答疑为插入动作，记录 returnStage）。

## API（前缀 /human/api，均为本项目自建）
| 接口 | 实现说明 |
|---|---|
| GET /capabilities | 实时探测 LLM（/models）与 TTS（合成一个字），返回 checkedAt、detail；`?refresh=1` 强制重测 |
| GET /courses/:id | 学生可见投影（无 serverOnly / 买方阈值 / 答案键 / 内部路径） |
| POST /sessions · GET/DELETE /sessions/:id | 匿名会话，HttpOnly cookie 归属，2 h TTL |
| POST /sessions/:id/turns | `{requestId, intent: ask|explain|negotiate, text?, cardId?, again?}` → SSE delta/done/error；买家回复整段校验后一次下发 |
| POST /sessions/:id/actions | next / startPractice / finishPractice / retry / restartPractice / pause / resume / end |
| POST /sessions/:id/final-offer | 结构化方案 + 可选自算毛利率 → 规则核算；异步生成证据化反馈 |
| POST /sessions/:id/cancel | 按 requestId 取消，重复调用安全 |
| POST /sessions/:id/retry/question · /retry/answer | 服务器出题并保留答案；判分后返回答案与反馈 |
| GET /sessions/:id/report | 本次会话的完整报告数据 |
| POST /tts | 单句 ≤300 字 → audio/mpeg |

保护：单会话 1 个生成、全局 2 个、模型 30 s 超时、文本 ≤1500 字、请求体 ≤64 KB；错误不返回伪成功。
