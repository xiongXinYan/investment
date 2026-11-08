# 引擎与脚本权威登记表

> **只解决一个问题**：打开这个仓库的人，能否在 30 秒内判断「哪个脚本才是当前策略的正式计算入口」。
>
> 2026-11-08 建立（外部审阅问题 2）。此前 `src/bt_engine.js` 头部写着「回测引擎 v5：同步 v1.2 规则」，而当前策略是 v1.6 —— 文件名和版本号都不能告诉你谁是权威。

## 一句话结论

```text
当前正式入口 = phase5_run.js（主回测）+ metrics_v16.js（指标生成）
当前正式引擎 = bt_r_clause.js
bt_engine.js 是 v1.2 择时引擎，不参与 v1.6 的任何数字。
```

## 一、当前生效（v1.6 的全部数字来自这条链）

| 文件 | 角色 | 规则版本 | 被谁依赖 | 产出 |
| :--- | :--- | :--- | :--- | :--- |
| `src/valuation_series.js` | 估值/股息率序列加载与插值 | — | `phase2_indices` `bt_final` `bt_extended` `probe_valuation` `data_audit` | 内存序列 |
| `src/phase2_indices.js` | **数据基线加载器**：两指数对齐、收益序列、主口径参数 `P_MAIN_OPT` | — | `bt_r_clause` `phase3_quant_probe` `phase5_*` `phase6_*` `execution_simulator` `test_regression` | 内存数据 |
| `src/bt_r_clause.js` | **当前正式引擎**：固定敞口 + 双资产 + 季度再平衡 + R 条款状态机 | v1.6 | `phase5_*` `phase6_*` `metrics_v16` `execution_simulator` `test_regression` | 净值/事件/计数 |
| `src/phase5_run.js` | **主回测入口**：三路径 + V0 对齐 + 表 A/B | v1.6 | — | `data/processed/phase5_backtest_data.json` |
| `src/phase5_sensitivity.js` | C 表口径敏感性（追加写入同一 JSON） | v1.6 | — | 同上（追加） |
| `src/phase6_stress_v16.js` | 压力路径补跑（先复现旧 36 单元再扩展） | v1.6 | `metrics_v16` | `data/derived/phase6_stress_v16.json` |
| `src/metrics_v16.js` | **关键指标唯一数据源**：四档 R→E + 六种口径极差 + 撤销结论 | v1.6 | `test_report_consistency` | `data/derived/metrics_v16.json` |
| `src/execution_simulator.js` | 实盘执行模拟：整手 100 份 / 最低 5 元佣金 / T+1 | v1.6 | — | 控制台 + 订单明细 |
| `config/strategy/v1.6.json` | **策略参数登记**（分配 / 再平衡 / 成本 / 四档 R→E / 执行假设） | v1.6 | `config/verify_config.js` | 机器可读的「这一版到底是什么」 |
| `src/manifest.js` | **回测指纹**：config / data / 引擎 / 产物 四组哈希 + git commit | v1.6 | — | `manifest.json` |
| `lib/paths.js` | **目录登记表**：全部数据与报告的路径基准（LAYOUT） | — | 全部脚本 | 路径解析 |

## 二、质量闸门（改引擎前后必须各跑一次）

| 文件 | 拦什么 | 失败后 |
| :--- | :--- | :--- |
| `src/data_audit.js` | 日期对齐、缺失、异常跳变、股息前视、复权口径、数据版本 | **拒绝出数**（exit 1） |
| `tests/test_regression.js` | 17 个用例的整条净值序列（容差 1e-9）+ 数据 sha256 | 说明引擎行为变了，必须解释为什么 |
| `tests/test_report_consistency.js` | MD / HTML / README 是否与 `data/derived/metrics_v16.json` 逐位一致 + 有无已撤销措辞 | 说明有一份文档被单独改了 |
| `tests/test_ledger_v16.js` | 纸面执行台账的计算逻辑（浮点边界、空行守卫） | 说明台账会算错数 |
| `config/verify_config.js` | 配置登记与代码是否一致（34 项断言）；不一致说明有一份在说谎 | 说明配置已过期或代码已改 |
| `src/manifest.js` | 生成回测指纹；数据哈希变化时提醒「这份报告不是用这份数据跑的」 | 说明输入已变，必须重新出数 |
| `tests/test_engine_invariants.js` | 引擎路径是否自洽（高水位/回撤、无负现金、T+1、重置后 75/25、成本单调、重跑确定性）。**不依赖历史基线**，所以基线被人为更新时它仍然有效 | 说明引擎算错了，任何绩效数字都不可引用 |
| `tests/test_data_provenance.js` | 每份原始数据的来源证据等级、分红口径、行数与区间、sha256 三方一致 | 说明输入说不清出处，结论不可追溯 |

> **不变量测试与回归测试的分工**：回归测试锁「数字等于历史基线」，基线可以被人为更新（`--update`），所以它挡不住「引擎系统性算错但基线跟着错」。不变量测试用会计恒等式与时序规则判路径是否合法，没有基线可更新——这是两者都不能省的原因。

## 三、历史引擎（保留，但**不是**当前入口）

| 文件 | 角色 | 规则版本 | 状态 | 为什么不能删 |
| :--- | :--- | :--- | :--- | :--- |
| `src/bt_engine.js` | v5 择时引擎（V0/S1/S2/S3 分级、timeRule、估值门槛） | **v1.2** | 归档 | `src/bt_data.js` / `src/bt_extended.js` / `src/probe_valuation.js` 三个历史报告生成器 require 它；删了这三个报告无法复现 |
| `src/bt_final.js` | 第三轮常数敞口引擎 | v1.4 | 归档 | 产出 `data/derived/final_audit_data.json`，而 `src/phase5_run.js` 用它做 V0 逐位对齐校验 |
| `src/bt_data.js` | 第一轮择时数据包 | v1.3 | 归档 | 生成 `data/derived/bt_data.json` |
| `src/bt_extended.js` | 第二轮扩展验证 | v1.4 | 归档 | 生成 `data/derived/extended_data.json` |
| `src/probe_valuation.js` | 估值证伪探针 | v1.4 | 归档 | 生成 `data/derived/final_team_notes.json` 的估值部分 |
| `src/phase2_baseline.js` / `src/phase3_quant_probe.js` | 第四轮 Phase 2/3 的一次性探针 | v1.6 前置 | 归档 | 支撑 `docs/decisions/round4_phase2_baseline.md` 与 `docs/decisions/round4_phase3_quant.md` 的数字 |
| `src/bt_report.js` / `src/opt_report.js` / `src/alloc_report.js` / `src/ext_report.js` / `src/final_report.js` | 各轮 HTML 报告生成器 | 对应各轮 | 归档 | 报告可复现性 |

> **口径纪律**：`src/bt_engine.js` 产出的每一个数字都属于 v1.2 口径（70/30、旧股息率、旧成本假设），与 v1.6 **不可比较、不可混用**。见 `README.md` 的五组口径提醒。

## 四、为什么没有把历史文件移进 `archive/`

外部审阅建议建 `archive/` 目录迁移旧引擎。**没有采纳，理由是依赖会断**：

`src/bt_engine.js` 被 3 个仍在 README 复现命令里的脚本 require。移进子目录后，这 3 个脚本的 `require('./bt_engine.js')` 会全部报错，而它们生成的 HTML 报告是历史证据的一部分。

替代方案（本表 + 文件头横幅 + `run_all.js` 单一入口）解决的是同一个问题：**判断权威的成本**。目录结构不是问题的根源，「文件名不代表版本」才是。

## 五、`run_all.js` 怎么用

```bash
node run_all.js            # 只跑九道闸门（快，约 1 秒）
node run_all.js --full     # 闸门 + 重算 + 重算后指标/一致性/回归/指纹闭环（视机器，数秒）
node run_all.js --verbose  # 打印每道闸门的完整输出
```

任一闸门失败，`run_all.js` 最终 exit 1 并列出失败项；第一道数据审计失败会立即停止，避免用坏数据继续产出「看起来正常」的数字。**这是提交前的唯一必需命令。**
