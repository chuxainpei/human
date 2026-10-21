# Mori Classroom · 经管课程数字助教 MVP（human）

一位能讲、能答、能陪练并给出可核对反馈的课程数字助教。首个单元：《国际贸易实务》相关的“出口报价与交易磋商”。学生在 8–10 分钟内完成：**看懂知识点 → 提出自己的问题（带出处） → 与模拟买家磋商 → 规则核算 + 附原话的反馈 → 针对错误复练 → 打印学习报告**。

> 研发原型。课程内容为虚构课堂案例 + ICC 官网公开摘录，**尚未经教师审核**；回答由大模型实时生成。不代表学院采纳。

- 线上：https://pkusi.com/human/ 
- 大模型：DeepSeek `deepseek-flash`（OpenAI 兼容适配器，可替换）
- 语音：服务端 Microsoft Edge 中文神经语音（edge-tts），浏览器 SpeechSynthesis 兜底
- 形象：二维 Mori 角色（用户自有 IP），idle / thinking / speaking / error，嘴型跟随真实音频音量

## 目录

```
apps/api      Fastify 课程 API：检索、引用校验、状态机、买家规则、反馈、复练、TTS（src/ test/）
apps/web      Vue 3 + Vite：课程入口 / 学习工作台 / 学习报告
content/      course.json（含 serverOnly，仅服务端读取）
evals/        30 条冻结评测 + 运行脚本 + 结果
deploy/       nginx 片段、systemd、发布包构建与服务器安装脚本、env 模板
docs/         decisions / product-spec / course-review / design / demo-script / 说明书
tools/        端到端脚本、录屏合成、沙箱初始化、素材源文件
```

## 本地运行

需要 Node ≥ 20.19、Python 3（朗读用 `pip install edge-tts==7.3.1`）。

```bash
npm install
cp .env.example .env            # 填 DEEPSEEK_API_KEY（只放服务端环境变量）
export $(grep -v '^#' .env | xargs)
npm run build                   # 构建 API 与网页
SERVE_WEB=1 PORT=8420 npm start # http://127.0.0.1:8420/human/
```

开发模式：`npm run dev:api`（8420）+ `npm run dev`（Vite 5180，代理 /human/api）。没有模型密钥时页面如实显示“不可用”，问答返回错误事件，不会给固定回答。

## 测试

```bash
npm test                                        # 19 项：规则夹具 R1–R5、边界、取消/并发、状态机、隔离、引用伪造、反馈核对
npm run typecheck
python3 tools/scripts/api_e2e.py http://127.0.0.1:8420/human/api out.json      # 真实模型端到端
python3 evals/run_evals.py http://127.0.0.1:8420/human/api evals/results.json  # 30 条评测
python3 tools/scripts/browser_e2e.py http://127.0.0.1:8420/human/ out-dir      # 真实浏览器走完整流程（截图、录屏、播放事件）
```

## 部署（pkusi.com/human）

`deploy/scripts/build-release.sh` 生成自包含发布包；服务器以 root 运行 `deploy/scripts/install-server.sh`（需要 `/etc/human/human.env`）。只新增 `/etc/nginx/snippets/human.conf` 与站点文件里的一行 include、`human-api` systemd 服务（127.0.0.1:8318）。回滚：`ln -sfn /var/www/human/releases/<旧sha> /var/www/human/current && systemctl restart human-api`；完全撤下：删除 include 行与 snippet，`nginx -t && systemctl reload nginx`，`systemctl disable --now human-api`。

## 测试入口

无需账号：打开首页点“开始学习”即创建匿名会话（HttpOnly cookie，2 小时过期，可在报告页之外随时“结束学习”）。

## 文档

- 产品说明书：`docs/说明书.md`；演示脚本：`docs/demo-script.md`
- 评测结果：`evals/results-2026-10-17.md`
- 第三方清单：`THIRD_PARTY_NOTICES.md`
