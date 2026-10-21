# 嘟囔 设计系统（v2）

从首页（`apps/web/home/index.html`）提取，落地为
`apps/web/src/styles.css` 的 CSS 变量与 `apps/web/src/components/` 下的共享组件。
所有应用页（/learn、/report、/entry、错误页）只用这里的令牌和组件，保证和首页是一家人。

## 1. 颜色

| 令牌 | 值 | 用途 |
|---|---|---|
| `--paper` | `#f7f4ef` | 米色底（全站背景） |
| `--paper-2` / `--paper-3` | `#eae5de` / `#e4ddd2` | 次级底、悬停底、禁用底 |
| `--ink` | `#140206` | 1px 硬边框、硬投影、正文强调 |
| `--text` / `--text-2` / `--muted` | `#28292a` / `#484748` / `#5f5a54` | 正文 / 次要 / 弱化（弱化色在米色上 ≥ 4.5:1） |
| `--pink` | `#ff5a85` | 主强调：主按钮、当前步骤、光标、窗口小方块 |
| `--pink-l` / `--pink-xl` | `#ffb4c5` / `#ffe3ea` | 学生气泡、提示条 |
| `--green` / `--green-d` / `--mint` | `#38f261` / `#0a8f2a` / `#d5ffde` | 绿色窗口（出处）、“讲话”灯、通过 |
| `--purple` / `--purple-d` / `--lilac` | `#d0c9ed` / `#433d5b` / `#e4e0f2` | 紫色窗口（对话） |
| `--orange` / `--butter` | `#ff6810` / `#ffe8bc` | 橙色窗口（任务）、“思考”灯、买家气泡 |
| `--sky` | 像素天空纹理 `assets/art/sky-dither.png` + 6s 像素淡入淡出 | 页面顶部/空状态背景 |

对比度：墨色字压粉色 `#ff5a85` ≈ 6.8:1；禁用态一律 **米灰底 `--paper-2` + `--muted` 字 + 虚线边框**（≈ 5.5:1），
不再用 `opacity` 让粉色按钮发灰。

## 2. 字体

- 标题：Noto Serif SC（`--serif`）。站内子集 `public/assets/fonts/noto-serif-sc-app.woff2`，首页子集 `public/home/fonts/noto-serif-sc-home.woff2`。
- 标签与按钮：Fusion Pixel 12px（`--pixel`）。子集 `public/assets/fonts/fusion-pixel-app.woff2`（首页另有 `fusion-pixel-home.woff2`）。
- 正文：系统无衬线（`--sans`：PingFang SC → Noto Sans SC → 微软雅黑）。模型生成的回答只用正文字体，避免子集缺字。
- 字体子集按 `apps/web/src`、`content/`、`apps/api/src` 的实际字符生成。
- 中文排版：`line-break: strict`、`text-wrap: pretty`（标题 `balance`），避免一字成行。

## 3. 复古窗口（`Win.vue`）

- 白底、1px 墨色边框、0 圆角、硬投影 `5px 5px 0 var(--ink)`（大窗口 `8px 10px 0`）。
- 标题栏 30px：彩色小方块（按窗口色）+ 像素字标题 + 1px/2px 细横线填充 + 方形最小化按钮（可选关闭）。
- 色调：`pink`（课堂/通话）、`purple`（对话）、`green`（出处）、`orange`（任务/方案）、`plain`、`ink`。
- 行为：只能拖标题栏、限制在父容器内、点击置顶；最小化后进入页面底部的 **Dock**（`Dock.vue`），点 Dock 里的图标还原。
- 入场：`win-up` 关键帧 —— `translateY(60px) scale(.9)` → 原位，0.45s `cubic-bezier(.2,.8,.2,1)`（取自首页窗口的 slideUp）。

## 4. 按钮、标签页、芯片

- 像素按钮 `.px-btn`：像素字、1px 墨边、硬投影 `3px 4px 0`；悬停上移 2px、投影加深；按下（仅鼠标设备）回落。
  变体：`.is-pink`（主操作）、`.is-green`、`.is-ghost`、`.is-ink`。
- 禁用：`--paper-2` 底、`--muted` 字、虚线边框、无投影（≥ 4.5:1）。
- 标签页（首页“四个场景”的文件夹标签）`.folder-tabs`：斜切右边、前压后，当前页白底升高 3px，序号粉色；切换时内容做 **像素淡入**（`px-fade`：`steps(6)` 的 clip/opacity）。
- 芯片 `.px-chip`：像素字小按钮，手机上横向滑动（容器 `.chips`）。

## 5. 动效清单

| 动效 | 实现 |
|---|---|
| 打字标题/占位符轮播 | `TypedLine.vue`、`useTyped()`（逐字打出→停留→删除，粉色 2px 光标 1s steps） |
| 打字气泡 | `TypingBubble.vue`：“陈老师正在输入”+ 三个跳动像素点；流式回答逐字出现并带光标 |
| 窗口上浮 | `win-up` 关键帧；`v-reveal` 指令做滚动显现 |
| 拖动 | `Win.vue` 标题栏 pointer 事件，限制在父容器 |
| 最小化到 Dock | `Win.vue` 发出 `minimize`，`Dock.vue` 显示图标，点击还原 |
| 标签切换 | `.folder-tabs` + `px-fade` |
| 像素淡入淡出 | `PixelField.vue`（6s 周期随机格子） |
| 跑马灯 | `.marquee`（首页事实条同款大字，24s 线性循环，悬停暂停） |
| 循环视频 | `<video autoplay loop muted playsinline poster>` 装在复古窗口里 |

所有动效在 `prefers-reduced-motion: reduce` 下关闭或直接显示终态。

## 6. 版式

- 页面最大宽 1480px，左右 24px（手机 8–12px）。
- 数字大字（首页事实条）：`.fact` = 衬线 2rem 数字 + 像素 1rem 说明，横排；手机竖排。
- 打印：`@media print` 去掉投影、像素纹理、导航、Dock、按钮，只留黑白文档。

## 7. 品牌与内容规则

- 品牌只写“嘟囔”。人物只有陈老师与模拟买家 Markus Weber。
- 内容只来自 `content/course.json`（出口报价与交易磋商）与服务端算好的数字，不编数据。
- 回答中的出处标记 `[F-…]` 一律渲染为上标 `[1] [2]`，点开看原文；页面上不出现任何内部编号。
