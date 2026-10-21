# 第三方来源与原创贡献

## 运行时依赖 / 服务
| 名称 | 用途 | 许可 / 条款 | 备注 |
|---|---|---|---|
| DeepSeek API（deepseek-flash） | 讲解、答疑、买家对话、反馈 JSON、复练出题措辞 | DeepSeek 开放平台服务条款 | 付费 API；用户自有密钥，仅服务端 |
| Microsoft Edge 在线语音（经 edge-tts 7.3.1，Python，LGPL-3.0） | 中文朗读 zh-CN-XiaoxiaoNeural | 非官方接口，微软可随时变更 | 失败自动切浏览器 SpeechSynthesis |
| Fastify 5、@fastify/cookie、@fastify/static | API 服务 | MIT | |
| Vue 3、vue-router 4、Vite 7、TypeScript 5.9、vue-tsc | 前端 | MIT / Apache-2.0 | |
| tsx | 开发与测试运行 | MIT | 仅开发 |

## 研究工具（不进入学生端）
| 名称 | 版本 | 许可 | 用途 |
|---|---|---|---|
| Playwright（Python） | 1.64.0 | Apache-2.0 | 研究会话交互、端到端测试、录屏 |
| Chromium | 155 | BSD 等 | 研究与测试浏览器 |


## 内容来源
| 内容 | 来源 | 状态 |
|---|---|---|
| F-QUOTE-01、F-TERMS-02、F-TALK-03、F-CASE-01、案例 C-EXPORT-01 | 任务包自拟虚构课堂案例 | 未经教师审核 |
| F-ICC-01/02/03 | ICC 官网 Incoterms® 2020 页面摘录（2026-10-17 核对）https://iccwbo.org/business-solutions/incoterms-rules/incoterms-2020/ | 短摘录用于教学引用；Incoterms® 为 ICC 注册商标 |

## 形象与字体
- Mori 角色底图 base.webp 与动作骨架 MoriRig.vue：来自用户此前的 Mori 项目（用户提供的 IP 原型的衍生图，原作者与授权信息仍待用户补充）。
- 界面使用系统中文字体；录屏字幕使用 Noto Sans SC（SIL OFL 1.1）。

## 原创贡献（本项目）
课程数据组织与学生可见投影；中文本地检索与引用校验（伪造编号剔除、材料不足识别）；服务端教学状态机；买家隐藏约束的规则执行（模型只拿粗标签、整段泄露检查）；整数分/基点的客观核算；附 turnId 与原话、服务器逐条核对的表达反馈；按实际错误选择题型的复练；真实播放事件驱动的数字人状态与可度量的“停止讲话”；三页学习流程与可打印报告。

## Fusion Pixel Font（缝合像素字体）
- 作者 TakWolf，许可 SIL Open Font License 1.1；版本 2026.10.16，12px proportional zh_hans。
- 用途：界面标签、按钮、导航与“嘟囔”字标的像素字体；以子集 woff2 自托管（apps/web/public/assets/fonts/），许可证副本 OFL-fusion-pixel.txt。
