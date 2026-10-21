# 课程内容审核状态（content/course.json 版本 2026-10-17-dev-1）

| Fact | 来源类型 | 来源与定位 | 状态 |
|---|---|---|---|
| F-QUOTE-01 报价计算口径 | 虚构课堂规则 | 任务包 fixture | unreviewed（教师未审） |
| F-TERMS-02 最终方案条件 | 虚构课堂规则 | 任务包 fixture | unreviewed |
| F-CASE-01 案例公开数据 | 虚构课堂规则 | 由 cases[0].studentVisible 整理 | unreviewed |
| F-TALK-03 观察维度 | 虚构课堂规则 | 任务包 fixture | unreviewed |
| F-ICC-01 Incoterms 2020 概述 | 公开来源 | https://iccwbo.org/business-solutions/incoterms-rules/incoterms-2020/ 页首要点 | 2026-10-17 已对照原文；教师未审 |
| F-ICC-02 CIF/CIP 保险 | 公开来源 | 同上 · “What are the different levels of insurance coverage in CIF and CIP?” | 同上 |
| F-ICC-03 费用 A9/B9 | 公开来源 | 同上 · “Where are the costs listed in Incoterms® 2020?” | 同上 |

客观规则：金额整数分、比例基点；毛利率 = (p−c)/p；卖方条件 p ≥ 12.00、q = 500、首付 ≥ 30%、18 ≤ 交期 ≤ 21；买方隐藏条件见 serverOnly（报告中练后披露）。夹具 R1–R5 由单元测试逐条复算通过。

**比赛就绪还缺**：教师确认课程名称、量规与至少一份教师资料；当前状态只能称“开发冻结内容”，不得称“教师审核通过”。
