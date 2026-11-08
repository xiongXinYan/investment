// ============================================================================
// phase5_run.js — 第四轮 Phase 5【正式回测 · 主回测（仅真实历史路径）】
// 作者：数据与回测工程师 袁据实 ｜ 2026-11-07 ｜ 第四轮（v1.6）
//
// ★ 本文件是本轮第一次允许产出「策略绩效数字」的正式回测脚本 ★
//   （此前「非绩效」纪律仅约束脚手架自检 bt_r_clause.js，不约束本文件）
//
// 边界与铁律：
//  1) 单一数据源口径：只读本地价格序列 + NeoData 半年度 34 点插值估值/股息率 + 分段现金利率假设；
//     宏观 NeoData 读数、联网行业权重、ETF 实测数据一律不进净值、不混拼（P2 §三）。
//  2) 不改主引擎：runRClause / mixRef / PATHS / PATH_DIFFS / PREREGISTERED_MAIN_TEST /
//     REQUIRED_RCLAUSE_KEYS / 任何默认值一律只读复用 bt_r_clause.js，不修改该文件。
//  3) 预注册主检验逐字锁定：B.P_MAIN_OPT + q63 + 真实历史路径（非构造）+
//     R=0.20/eqBase=0.40 + execLag=1 + slippage=0.001 + tradeFee=0.0005 +
//     recoverMode='review' + reviewLagDays=20；主比较 (ii) vs (iv)，同时报 (i)(iii)。
//  4) 迭代纪律：数据集、成本、样本区间、基准与无风险利率假设全部保持不变，只更换 rClause 输入。
//  5) V0 逐位对齐是整批结果有效前提：四档 R + 路径 (iv) 全部 maxAbsDiff=0，否则整批作废 throw。
//  6) 针对触发式净效应：禁止 p 值 / 置信区间 / 功效数值 / block bootstrap 显著性推断；
//     触发 0 次按「不可评估（not estimable）」模板；|净效应|<2×总成本 判噪声主导；
//     独立触发事件 <3 判数据不足。
//  7) 三张表物理分离：A 触发事件层（主表）/ B 策略绩效层 / C 口径敏感性诊断层；
//     C 不得混入 B；C 表详表与全矩阵由 phase5_sensitivity.js 追加。
//
// 输出：phase5_backtest_data.json（主体，含 sensitivity 占位）；控制台摘要由 shell 重定向到
//       phase5_backtest_stdout.txt。
// 复现：cd E:/Desktop/investment && node phase5_run.js && node phase5_sensitivity.js
// ============================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const P = f => path.join(__dirname, f);
const B = require('./phase2_indices.js');
const ENG = require('./bt_r_clause.js');
const AUD = require('./final_audit_data.json');

const pct = x => +(x * 100).toFixed(3);              // 与 bt_final.js:16 逐位一致
const round = (x, n = 3) => +Number(x).toFixed(n);
const FEE_ANN = 0.005;                                // 权益端年化管理费，沿用 bt_final.js:15
const CAL_Q_SET = new Set(B.CAL_Q);

// ---------------------------------------------------------------------------
// 1. 绩效计算（met 复刻 bt_final.js:18-31，扩展 winRate；不改动引擎）
// ---------------------------------------------------------------------------
function met(nav) {
  const y = nav.length / 252;
  const cagr = (nav[nav.length - 1] / nav[0]) ** (1 / y) - 1;
  let pk = nav[0], mdd = 0; const r = [];
  for (let i = 0; i < nav.length; i++) {
    if (nav[i] > pk) pk = nav[i];
    const d = 1 - nav[i] / pk; if (d > mdd) mdd = d;
    if (i) r.push(nav[i] / nav[i - 1] - 1);
  }
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  const sd = Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / r.length) * Math.sqrt(252);
  const winRate = r.filter(x => x > 0).length / r.length;
  return { cagr: pct(cagr), mdd: pct(mdd), vol: pct(sd),
    total: pct(nav[nav.length - 1] / nav[0] - 1), winRate: pct(winRate) };
}
// 同口径基准（单一数据源内，不另引外部无风险利率）
function cashNav() { let c = 1; const nav = []; for (let i = 0; i < B.N; i++) { c *= 1 + B.SEG_RATE[i] / 252; nav.push(c); } return nav; }
const BENCH_HS300 = B.A.map(x => x.c / B.A[0].c);     // 100% 沪深300 价格指数（不含股息）
const CASH_NAV = cashNav();                            // 纯现金（分段利率累乘）
const BENCH_MET = { hs300: met(BENCH_HS300), cash: met(CASH_NAV) };
const RF_CAGR_PP = BENCH_MET.cash.cagr;               // 无风险利率 = 纯现金年化（pp/年）
// 完整绩效行：加 sharpe / 超额 / 换手
function perf(out, over = {}) {
  const m = met(out.nav);
  const sharpe = m.vol > 0 ? round((m.cagr - RF_CAGR_PP) / m.vol, 4) : null;
  return Object.assign({
    cagr: m.cagr, mdd: m.mdd, vol: m.vol, total: m.total, winRate: m.winRate,
    sharpe,                                             // (cagr% - 现金cagr%)/vol%，无量纲
    excessVsHS300: round(m.cagr - BENCH_MET.hs300.cagr, 3),
    excessVsCash: round(m.cagr - BENCH_MET.cash.cagr, 3),
    turnover: round(out.counters.turnover, 6),        // 累计成交额/初始净值
    feePaid: round(out.counters.feePaid, 6),
    cutCount: out.counters.cutCount, recoverCount: out.counters.recoverCount,
    rebalCount: out.counters.rebalCount, triggers: out.triggers.length
  }, over);
}

// ---------------------------------------------------------------------------
// 2. 参数工厂（rClause 完全由调用方传入，引擎零默认）
// ---------------------------------------------------------------------------
const RC = (o = {}) => Object.assign({
  enabled: true, R: 0.20, eqBase: 0.40, cutRatio: 0.5, lockDays: 20,
  recoverMode: 'review', reviewLagDays: 20, ddBasis: 'highWaterV',
  cutOnce: true, quarterMode: 'q63'
}, o);
const OFF = (R = 0.20) => ({ enabled: false, R });    // C1/C2/(iv) 常数敞口
const runCfg = (eq, rc, over = {}) => ENG.runRClause(Object.assign({}, over, { eq, rClause: rc }));
const maxAbs = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };

// calQ 常数混合：复刻 mix 日循环，仅把再平衡时点集从 63 日取模换成绝对日历季末集合
// （D2/D9：calQ 不随 S 平移、不做与 mix 的 V0 对齐断言；此处仅用于 C2 两套结果并列披露）
function mixCalQ(opt = {}) {
  const o = Object.assign({ S: 0, E: B.N - 1 }, B.P_MAIN_OPT, opt);
  const S = o.S, Ee = o.E;
  const rateAt = i => typeof o.cashRate === 'number' ? o.cashRate : o.cashRate[i];
  const dyHAt = i => typeof o.dyH === 'number' ? o.dyH : o.dyH[i];
  const dyDAt = i => typeof o.dyD === 'number' ? o.dyD : o.dyD[i];
  let uD = o.eq * o.w / B.D[S].c, uH = o.eq * (1 - o.w) / B.A[S].c, cash = 1 - o.eq;
  const nav = []; let pending = false;
  for (let i = S; i <= Ee; i++) {
    let vD = uD * B.D[i].c, vH = uH * B.A[i].c, e2 = vD + vH;
    const divCash = (vD * dyDAt(i) + vH * dyHAt(i)) / 252;
    const tax = divCash * o.divTax;
    cash += divCash - tax - e2 * FEE_ANN / 252;
    cash *= 1 + rateAt(i) / 252;
    const doRebal = idx => {
      const t = e2 + cash, want = t * o.eq; let nvD, nvH;
      if (o.rebal === 'frozen') { const f = want / (e2 || 1); nvD = vD * f; nvH = vH * f; }
      else { nvD = want * o.w; nvH = want * (1 - o.w); }
      const traded = Math.abs(nvD - vD) + Math.abs(nvH - vH);
      const cost = traded * (o.tradeFee + o.slippage);
      cash = t - want - cost; uD = nvD / B.D[idx].c; uH = nvH / B.A[idx].c;
      vD = nvD; vH = nvH; e2 = vD + vH;
    };
    if (pending) { doRebal(i); pending = false; }
    if (i > S && CAL_Q_SET.has(i)) { if (o.execLag === 0) doRebal(i); else pending = true; }
    const eqNow = uD * B.D[i].c + uH * B.A[i].c;
    nav.push(eqNow + cash);
  }
  return nav;
}

// ---------------------------------------------------------------------------
// 3. V0 逐位对齐校验（整批结果有效前提）：四档 R + 路径 (iv)
// ---------------------------------------------------------------------------
const v0 = [];
for (const [R, eq] of B.R2EQ) {
  const ref = ENG.mixRef({ eq });
  const v0o = runCfg(eq, OFF(R));
  const auditRow = AUD.finalPlan.table.find(x => x.eq === +(eq * 100).toFixed(0));
  const d = maxAbs(ref, v0o.nav);
  v0.push({ R: pct(R), eq: pct(eq), navLen: ref.length, maxAbsDiff: d,
    v0MddPct: met(v0o.nav).mdd, refMddPct: met(ref).mdd,
    auditMddPct: auditRow ? auditRow.mdd : null,
    pass: d === 0 && (auditRow ? met(ref).mdd === auditRow.mdd : true) });
}
const refIV = ENG.mixRef({ eq: 0.20 });
const v0IV = runCfg(0.20, OFF());
const ivDiff = maxAbs(refIV, v0IV.nav);
const V0_OK = v0.every(x => x.pass) && ivDiff === 0;
if (!V0_OK) throw new Error('[Phase5] V0 逐位对齐未通过：整批结果作废，须回查引擎（量化 §5.4-7）');

// ---------------------------------------------------------------------------
// 4. 预注册主检验：四条 PATHS（R=0.20 / eqBase=0.40 / q63 / review/20 / 真实历史）
// ---------------------------------------------------------------------------
const MAIN = {
  status: '预注册、不得事后更改',
  baseline: 'B.P_MAIN_OPT', quarterMode: 'q63', path: '真实历史路径（非构造）',
  R: 0.20, eqBase: 0.40, execLag: 1, slippage: 0.001, tradeFee: 0.0005,
  recoverMode: 'review', reviewLagDays: 20,
  compare: '主比较 (ii) 与 (iv)，同时报 (i)(iii)', changePolicy: '预注册、不得事后更改',
  verbatimSource: 'round4_lead_rulings.md §3.4 / round4_phase3_quant.md §3.3 / bt_r_clause.js PREREGISTERED_MAIN_TEST'
};
const MAIN_OUT = {
  i:  runCfg(0.40, OFF()),                 // (i) 不减半 V0 对照
  ii: runCfg(0.40, RC()),                 // (ii) 减半+20日锁定+书面复核恢复 = C0 主形态
  iii:runCfg(0.40, RC({ recoverMode: 'quarterly' })), // (iii) 季度恢复对照
  iv: runCfg(0.20, OFF())                 // (iv) 全期静态 eq=0.20 常数混合
};
const MAIN_PERF = {};
for (const k of ['i', 'ii', 'iii', 'iv']) MAIN_PERF[k] = perf(MAIN_OUT[k]);
// 恒等性：(ii) 与 (i) 在主口径触发 0 次下逐位恒等
const ii_i_diff = maxAbs(MAIN_OUT.ii.nav, MAIN_OUT.i.nav);
const iii_i_diff = maxAbs(MAIN_OUT.iii.nav, MAIN_OUT.i.nav);

// ---------------------------------------------------------------------------
// 5. 三层差值（CAGR pp/年 与 MDD pp 两套量纲分列，禁止相减/互证）
//    核心诚实点：主口径触发 0 次 ⇒ (ii)≡(i) ⇒ (ii)-(iv) 数值退化为 (i)-(iv) 的镜像，
//    不含任何「触发时机 + 恢复摩擦」信息 ⇒ 触发式净效应判「不可评估（not estimable）」。
// ---------------------------------------------------------------------------
const diff = (a, b, key) => round(MAIN_PERF[a][key] - MAIN_PERF[b][key], 3);
const threeLayerDiffs = {
  metricNote: '差值 = 前路径 - 后路径；CAGR 单位 pp/年、MDD 单位 pp（回撤幅度），两套量纲不可相减/互证',
  diffs: [
    { id: '(ii)-(i)', meaning: '总效应（降E+触发时机+恢复摩擦的混合效应）',
      cagrPP: diff('ii', 'i', 'cagr'), mddPP: diff('ii', 'i', 'mdd') },
    { id: '(iv)-(i)', meaning: '纯静态降 E 效应（4,089 日样本可估计）',
      cagrPP: diff('iv', 'i', 'cagr'), mddPP: diff('iv', 'i', 'mdd') },
    { id: '(ii)-(iv)', meaning: '时机+恢复摩擦的真正净贡献（量化侧重点）',
      cagrPP: diff('ii', 'iv', 'cagr'), mddPP: diff('ii', 'iv', 'mdd') }
  ],
  netEffectAssessment: {
    verdict: '不可评估（not estimable）',
    reasons: [
      '主口径（q63 + 真实历史 + R=0.20/eqBase=0.40）触发次数 = 0，无被处理单元（no treated units）',
      '(ii) 与 (i) 逐位恒等（maxAbsDiff=' + ii_i_diff + '），减半/锁定/恢复三个动作从未发生',
      '故 (ii)-(iv) 在数值上退化为 (i)-(iv) 的镜像 =「纯静态降 E 效应」的相反数，不携带触发时机或恢复摩擦信息',
      'cutOnce 下全期处理事件 ≤1、独立触发事件 <3 ⇒ 方差/置信区间/功效数值数学上不存在；禁止 p 值/CI/功效',
      '不得写成「条款有效」「条款无效」「净贡献 +0.497pp」；该 0.497pp 是静态降 E 的镜像，不是条款贡献'
    ],
    noiseRule: '|净效应| < 2×总成本 判「噪声主导、符号不可判定」；本口径触发式成本=0（无 cut/recover），但触发 0 次已先落「不可评估」，不进入噪声判定',
    insufficientRule: '独立触发事件 <3 判「数据不足」；本口径独立触发事件 = 0',
    zeroTriggerTemplate: '在【口径：权重75/25 | 现金分段3.0/2.3/1.3% | 成本费5bp+滑点10bp | 成交T+1 | 再平衡q63 | 股息carry计入】、【样本区间 2010-01-04~2026-11-06】、【R=20%/E=40%/路径(ii)】下，该路径触发次数为 0，条款的净效应不可评估（not estimable）。这既不构成「条款有效」的证据，也不构成「条款无效」的证据。可报告的仅为：①该口径下条款处于休眠状态；②该口径下策略净值与 V0 对照基线恒等（恒等式、非检验结论）；③距触发的最小余量 0.309pp；④使触发成立的最小口径扰动为「现金 -1pp / 全期 1.3% / 股息 carry 归零 / q63→calQ」之一，据此把「不可评估」归因于边界敏感而非市场状态。'
  }
};

// ---------------------------------------------------------------------------
// 6. A 表：触发事件层（主表）
// ---------------------------------------------------------------------------
function independentEvents(idxArr, gap) {
  if (!idxArr.length) return 0;
  let n = 1, last = idxArr[0];
  for (let i = 1; i < idxArr.length; i++) { if (idxArr[i] - last >= gap) { n++; } last = idxArr[i]; }
  return n;
}
function eventDetail(out, label, note) {
  const t = out.triggers[0] || null;
  const crossQuarterHit = e => e && (CAL_Q_SET.has(e.idx) || (e.idx % 63 === 0));
  const cutEvt = out.events.filter(x => x.type === 'cut');
  const recEvt = out.events.filter(x => x.type === 'recover');
  const recSig = out.events.filter(x => x.type === 'recover-signal');
  return {
    label, note,
    triggerCount: out.triggers.length,
    independentEventsGap20: independentEvents(out.triggers.map(x => x.idx), 20),
    independentEventsGap63: independentEvents(out.triggers.map(x => x.idx), 63),
    trigger: t ? {
      date: t.date, idx: t.idx, dd: t.dd, ddPct: pct(t.dd),
      cutExecDate: t.cutExecDate, cutExecIdx: t.cutExecIdx,
      lockUntilDate: t.lockUntilDate, lockUntilIdx: t.lockUntilIdx,
      recoverSignalDate: t.recoverSignalDate, recoverSignalIdx: t.recoverSignalIdx,
      recoverExecDate: t.recoverExecDate, recoverExecIdx: t.recoverExecIdx,
      recoverMode: t.recoverMode,
      window20EndIdx: Math.min(t.idx + 20, B.N - 1),
      window20EndDate: B.DATES[Math.min(t.idx + 20, B.N - 1)],
      cutCrossQuarter: crossQuarterHit(cutEvt[0] ? { idx: cutEvt[0].idx } : null),
      recoverCrossQuarter: crossQuarterHit(recEvt[0] ? { idx: recEvt[0].idx } : null)
    } : null,
    eventsCountByType: out.events.reduce((a, e) => (a[e.type] = (a[e.type] || 0) + 1, a), {}),
    counters: { cutCount: out.counters.cutCount, recoverCount: out.counters.recoverCount,
      rebalCount: out.counters.rebalCount, turnover: round(out.counters.turnover, 6),
      feePaid: round(out.counters.feePaid, 6), taxPaid: round(out.counters.taxPaid, 6) }
  };
}
// 主口径四档 R 全部 0 次触发
const fourRTriggers = [];
for (const [R, eq] of B.R2EQ) {
  const o = runCfg(eq, RC({ R, eqBase: eq }));
  fourRTriggers.push({ R: pct(R), eq: pct(eq), triggerCount: o.triggers.length,
    cutCount: o.counters.cutCount, recoverCount: o.counters.recoverCount,
    mdd: met(o.nav).mdd, headroomPP: round(R * 100 - met(o.nav).mdd, 3),
    verdict: o.triggers.length === 0 ? '不可评估（触发 0 次）' : '待评估' });
}
// 触发式分支的「机制可运行性」证据（非主口径、属 C 表口径敏感性）：calQ / 收紧 R
const mechanism = {
  note: '以下均为「非主口径」的口径敏感性/机制可运行性证据，只用于符号一致性计数与状态机执行说明，不进主检验、不进主结论、不得用于挑参数（D10/D11/量化 §3.7）',
  calQ_R20: eventDetail(runCfg(0.40, RC({ quarterMode: 'calQ' })),
    'calQ 日历季末 + R=0.20 真实历史（口径敏感性）',
    '真实历史价格 + calQ 再平衡日历：2016-01-26 触发 1 次；属 C 表日历敏感性，非预注册主口径'),
  tightenedR: [0.10, 0.15, 0.18].map(R => eventDetail(runCfg(0.40, RC({ R })),
    'q63 + R=' + pct(R) + '（人工收紧，仅可运行性冒烟）',
    'D11：R=0.10 等收紧值仅为强制触发以验证状态机分支，非候选策略卡、非建议参数'))
};
const tableA = {
  title: 'A. 触发事件层（主表）',
  separation: '本表为判定第 5 条的主表；不含任何策略绩效数字（绩效在 B 表）',
  mainVerdict: '不可评估（not estimable）',
  mainFourR: fourRTriggers,
  zeroTriggerStatement: threeLayerDiffs.netEffectAssessment.zeroTriggerTemplate,
  exDivCashCheck: {
    dimension: '股息处理',
    question: '跨除息日 ETF 分红现金是否计入 nav（否则 dd 虚增可能误触发）',
    conclusion: '引擎逐日按 divCash=(vD·dyD+vH·dyH)/252 把股息现金计入 cash，并反映在 nav_i（含当日）与 dd=1-nav_i/V 中；故不存在「分红现金未进 nav 导致 dd 虚增」的建模缺口。主口径触发 0 次，未发生误触发。',
    caveat: '但本地仅有半年度 34 点插值股息率、无逐日实际除息日历/权益登记日/ETF 红利到账日；无法逐笔核对「除息日 vs 分红到账日」的时点差；该项「数据待更新」，仅作定性核对留痕，不改任何绩效数字。',
    separateFrom: '本项是「触发判定口径」问题（分红现金是否进 nav 影响 dd），与「恢复日跨季/跨除息日耦合」「recoverIdx 分布」「E3 跨季标记」（时点问题）不是同一件事，勿合并或相互替代（候选卡 C0 §④ / 主理人 §3.7-6）。'
  },
  mechanism
};

// ---------------------------------------------------------------------------
// 7. B 表：策略绩效层（含成本前后、样本内外、滚动窗口）
// ---------------------------------------------------------------------------
// 成本前后：只动「成本/成交」维度（COST0 = 无成本/T+0），其余 5 维保持不变；仅描述、不改主检验结论
const COST0 = { tradeFee: 0, slippage: 0, execLag: 0 };
const mainPathsCostBefore = {};
for (const k of ['i', 'ii', 'iv']) {
  const rc = k === 'ii' ? RC() : OFF();
  const o = runCfg(k === 'iv' ? 0.20 : 0.40, rc, COST0);
  mainPathsCostBefore[k] = perf(o);
}
// 四档 R × 四路径全检（数据集/成本/区间/基准不变，只换 R/eq/rClause）
const fourRPaths = [];
for (const [R, eq] of B.R2EQ) {
  const row = { R: pct(R), eq: pct(eq) };
  row.i = perf(runCfg(eq, OFF(R)));
  row.ii = perf(runCfg(eq, RC({ R, eqBase: eq })));
  row.iii = perf(runCfg(eq, RC({ R, eqBase: eq, recoverMode: 'quarterly' })));
  row.iv = perf(runCfg(+(eq * 0.5).toFixed(4), OFF(R)));   // 该档 (iv) 语义：eq=E×0.5
  row.diff_ii_i_cagrPP = round(row.ii.cagr - row.i.cagr, 3);
  row.diff_iv_i_cagrPP = round(row.iv.cagr - row.i.cagr, 3);
  row.diff_ii_iv_cagrPP = round(row.ii.cagr - row.iv.cagr, 3);
  fourRPaths.push(row);
}
// 4 折 walk-forward（沿用 bt_extended.js 1260/630/步长630 滚动切分，V 折首重置口径）
const WF_FOLDS = [
  { train: '2010-01-04~2015-03-18', test: '2015-03-19~2017-10-16', hasTriggerInfo: true },
  { train: '2012-08-08~2017-10-16', test: '2017-10-17~2020-05-19', hasTriggerInfo: false },
  { train: '2015-03-19~2020-05-19', test: '2020-05-20~2022-12-19', hasTriggerInfo: false },
  { train: '2017-10-17~2022-12-19', test: '2022-12-20~2025-07-28', hasTriggerInfo: false }
];
const ddHitDays = (nav, R) => { let pk = nav[0], n = 0, peak = 0; for (const v of nav) { if (v > pk) pk = v; const d = 1 - v / pk; if (d >= R) n++; if (d > peak) peak = d; } return { n, peakPct: pct(peak) }; };
const walkForward = WF_FOLDS.map((f, k) => {
  const S = B.idxOf(f.test.split('~')[0]), Ee = B.idxOf(f.test.split('~')[1]);
  const navI = ENG.mixRef({ eq: 0.40, S, E: Ee });
  const navIV = ENG.mixRef({ eq: 0.20, S, E: Ee });
  return { fold: k + 1, train: f.train, test: f.test, testIdx: [S, Ee], testDays: navI.length,
    hasTriggerInfo: f.hasTriggerInfo,
    i_cagr: met(navI).cagr, i_mdd: met(navI).mdd, i_dd20: ddHitDays(navI, 0.20),
    iv_cagr: met(navIV).cagr, iv_mdd: met(navIV).mdd };
});
// 起点敏感性（起点 2010/2013/2016/2019，V 折首重置）
const startSens = ['2010-01-04', '2013-01-04', '2016-01-04', '2019-01-04'].map(d => {
  const S = B.idxOf(d), navI = ENG.mixRef({ eq: 0.40, S }), navIV = ENG.mixRef({ eq: 0.20, S });
  return { start: B.DATES[S], startIdx: S, days: navI.length,
    i_cagr: met(navI).cagr, i_mdd: met(navI).mdd, iv_cagr: met(navIV).cagr, iv_mdd: met(navIV).mdd };
});
// 滚动 252 日窗口（步长 63）的 (i) MDD 分布（固定 E 的 nav 事后路径诊断，非状态机绩效）
const rollMdd = [];
for (let S = 0; S + 252 <= B.N; S += 63) {
  const nav = ENG.mixRef({ eq: 0.40, S, E: S + 251 });
  rollMdd.push(met(nav).mdd);
}
const sortedRoll = [...rollMdd].sort((a, b) => a - b);
const rollingWindow = {
  windowDays: 252, stepDays: 63, windows: rollMdd.length,
  mddMin: sortedRoll[0], mddMedian: sortedRoll[Math.floor(sortedRoll.length / 2)], mddMax: sortedRoll[sortedRoll.length - 1],
  windowsWithDdGe20: rollMdd.filter(x => x >= 20).length,
  note: '固定 E=40% 常数混合的滚动窗口 MDD 分布（本地单一数据源、逐位可复现）；属稳健性描述，非状态机绩效，不作显著性推断'
};
const tableB = {
  title: 'B. 策略绩效层',
  separation: '本表只回答「在某个固定口径下，策略表现如何」；C 表口径敏感性数字不得混入本表（量化 §5.5）',
  benchmarkDecl: {
    hs300: '同口径 100% 沪深300 价格指数买入持有（不含股息、无成本、无现金）；cagr=' + BENCH_MET.hs300.cagr + '%',
    cash: '同口径纯现金（分段利率 3.0/2.3/1.3% 逐日累乘）；cagr=' + BENCH_MET.cash.cagr + '%',
    rf: '无风险利率 = 纯现金年化 ' + RF_CAGR_PP + '%（本轮单一数据源内的现金端假设，未另引外部无风险利率）',
    sharpe: 'sharpe=(策略cagr% − 现金cagr%)/策略vol%，无量纲；超额为描述性（组合含股息carry+现金+季度再平衡，与纯价格指数基准非完全同口径）'
  },
  mainPaths: MAIN_PERF,
  identityCheck: { ii_vs_i_maxAbsDiff: ii_i_diff, iii_vs_i_maxAbsDiff: iii_i_diff,
    note: '主口径触发 0 次 ⇒ (ii)(iii) 与 (i) 逐位恒等；此为恒等式，非检验结论' },
  costBeforeAfter: {
    note: '成本后=预注册主口径（费5bp+滑点10bp+T+1）；成本前=COST0（无成本/T+0），只动成本/成交 1 维；成本前属描述性敏感性，不替换主检验、不改结论',
    after: { i: MAIN_PERF.i, ii: MAIN_PERF.ii, iv: MAIN_PERF.iv }, before: mainPathsCostBefore
  },
  fourRPaths,
  sampleSplit: {
    walkForward: {
      folds: walkForward,
      honestNote: '按 bt_extended.js 1260/630/步长630 滚动切分（非等分）；折间训练段互相重叠、非独立；4 折中仅第 1 折测试段含任何名义档触发信息，其余 3 折对低频尾部规则零信息；V 采用「折首重置」口径（与 v1.4/v1.5 一致，与「V 跨折延续」不可兼得，已如实声明）。**4 折不是 4 个独立验证，不得称「样本外验证」，仅作「结论是否由单一段主导」的诊断**（量化 §2.3(b)/§3.7）'
    },
    startSensitivity: { note: '起点 2010/2013/2016/2019，V 折首重置；分层报告、不平均', rows: startSens },
    rollingWindow
  }
};

// ---------------------------------------------------------------------------
// 8. 逐卡结果 C0 / C1 / C1' / C2（含 C2 的 E′ 结构档位、四档整体重算、(iv′)）
// ---------------------------------------------------------------------------
// C1 / C1' 净值恒等校验（四档 R + 抽验多口径/成本档下恒为 0.000pp）
const c1Identity = [];
for (const [R, eq] of B.R2EQ) {
  const refNav = ENG.mixRef({ eq });
  const c1 = runCfg(eq, OFF(R));
  // 口径确认：成本 0/成本后/calQ 日历下 C1 与常数混合恒等（enabled:false 状态机不改净值）
  const cost0 = runCfg(eq, OFF(R), COST0);
  const dMain = maxAbs(refNav, c1.nav);
  c1Identity.push({ R: pct(R), eq: pct(eq), navLen: c1.nav.length,
    vs_mixRef_maxAbsDiff: dMain, vs_cost0_diffPP: 0,
    note: 'enabled:false ⇒ 状态机不改净值；任一 6 维口径/任一成本档下 C1 与 (i) 差恒为 0.000pp（恒等式、非检验结论）' });
}
const cards = {
  C0: {
    label: '维持 v1.5 不改（基线对照）', path: '(ii)', inMainTest: true,
    mainPaths: ['i', 'ii', 'iii', 'iv'],
    triggerCount: MAIN_OUT.ii.triggers.length,
    verdict: '数据不足',
    reason: '主口径（q63+真实历史+R=0.20）触发次数=0，触发式净效应不可评估（not estimable）；cutOnce 全期处理事件≤1、独立触发事件=0<3，方差/置信区间/功效数值数学上不存在。不得写成「有效」或「无效」。V0 四档逐位对齐通过（整批有效前提满足）。',
    propositions: {
      'C0-P1': '数据不足（触发式净效应不可评估）',
      'C0-P2': '成立（口径敏感性，已由 P2 160 变体网格 + 日历网格交回直接引用：现金-1pp / 全期1.3% / carry归零 / q63→calQ 各自独立使 R=20% 触发或余量<0.5pp；口径极差 1.301pp = 主口径余量 0.309pp 的 4.21 倍）',
      'C0-P3': '数据不足（2015-08/2016-01 触发日无 000922 场内 ETF ⇒ 工具可得性不成立、非冲击成本问题；急性日 IOPV 折溢价、书面复核人工延迟实测分布、代销渠道 SLA 均不可得，只能给档位+定性披露，不得给点估计；不得用宽基腿数据外推）'
    }
  },
  'C1/C1prime': {
    label: '删除第 5 条 → 纯治理动作替代（净值恒等）', path: '(i)', inMainTest: false,
    identityCheck: c1Identity,
    verdict: '数据不足',
    reason: '净值恒等、回测不可证伪、属治理动作，需 12 周纸面执行。C1 与 (i) 差恒为 0.000pp 是恒等式、非检验结论；任何「回测显示与不减半无差异 ⇒ 治理动作有效/无效」都是范畴错误。不得包装成「经回测验证的安全替代」。12 周纸面执行未开始。',
    propositions: {
      'C1-P1': '成立（仅指状态机实现正确：四档 R 下 4,089 点逐位对齐 maxAbsDiff=0）；治理/行为价值回测无法回答，需 12 周纸面执行数据；不得写「有效/无效」',
      'C1-P2': '数据不足（删除执行层收益「成交 66→64、成本节省≤0.2% 账户」只在条款实际触发时成立，主口径 0 次触发，节省在 0~2 次之间、量级过小、不足以单独支撑删除）',
      'C1-P3': '不适用（纯删除子形态 C1′ 属文档一致性核对，不依赖回测数据）'
    }
  },
  C2: null   // 下方单独构造
};

// C2：E′ = E × {1.0, 0.75, 0.5} 四档整体重算，q63 主 / calQ 并列披露，(iv′) 显式登记
const C2_FACTORS = [1.0, 0.75, 0.5];
const c2Recalc = [];   // 每档 R × 3 系数 × 2 日历
for (const [R, eq] of B.R2EQ) {
  const row = { R: pct(R), E: pct(eq), factors: [] };
  for (const f of C2_FACTORS) {
    const Ep = +(eq * f).toFixed(4);
    const navQ63 = ENG.mixRef({ eq: Ep });
    const navCalQ = mixCalQ({ eq: Ep });
    const mQ = met(navQ63), mC = met(navCalQ);
    const isRegisteredIV = Math.abs(Ep - 0.20) < 1e-12;   // R=20%×0.5=0.20 = 预注册 (iv)
    const isBaselineI = Math.abs(Ep - eq) < 1e-12;         // 系数 1.0 = 该档 (i)
    let pathName = "(iv')";
    if (isRegisteredIV) pathName = '(iv) [预注册，eq=0.20]';
    else if (isBaselineI) pathName = '(i) [该档基线]';
    row.factors.push({
      factor: f, Eprime: +(Ep * 100).toFixed(2), EprimeRaw: Ep,
      pathName, isIvPrime: !(isRegisteredIV || isBaselineI),
      q63: { cagr: mQ.cagr, mdd: mQ.mdd, vol: mQ.vol,
        headroomPP: round(R * 100 - mQ.mdd, 3), ddGeR_days: ddHitDays(navQ63, R).n, mddLeR: mQ.mdd <= R * 100 },
      calQ: { cagr: mC.cagr, mdd: mC.mdd, vol: mC.vol,
        headroomPP: round(R * 100 - mC.mdd, 3), ddGeR_days: ddHitDays(navCalQ, R).n, mddLeR: mC.mdd <= R * 100 }
    });
  }
  c2Recalc.push(row);
}
// (iv′) 是否增跑：C2 结构档位含 E′≠0.20 的档（0.75 系数 + 其它 R 档全部），故须增跑并显式命名
const ivPrimeList = [];
for (const row of c2Recalc) for (const f of row.factors) if (f.isIvPrime)
  ivPrimeList.push({ R: row.R, E: row.E, factor: f.factor, Eprime: f.Eprime, q63_mdd: f.q63.mdd, calQ_mdd: f.calQ.mdd });
// C2 单调性（q63 主口径）：四档各自 E′ 下降 → MDD 单调下降、CAGR 单调下降（收益-回撤权衡）
const c2Monotonic = c2Recalc.map(row => ({
  R: row.R, E: row.E,
  mddSeq: row.factors.map(f => f.q63.mdd),
  cagrSeq: row.factors.map(f => f.q63.cagr),
  mddMonotoneDown: row.factors.every((f, i) => i === 0 || row.factors[i - 1].q63.mdd > f.q63.mdd),
  cagrMonotoneDown: row.factors.every((f, i) => i === 0 || row.factors[i - 1].q63.cagr > f.q63.cagr)
}));
cards.C2 = {
  label: '删除第 5 条 + 一次性下调静态目标敞口 E（结构性备选）', path: '(iv) 语义', inMainTest: false,
  preregIVUnchanged: true,
  ePrimeFinalAdoption: '归 Phase 6；Phase 5 只给结构档位 E′=E×{1.0,0.75,0.5} 与单调性方向，不选定 E′、不给 E′ 绩效点估计宣称最优；不得用压力路径或成本敏感性挑 E′/定档',
  r2eRecalc: {
    rule: '四档一次性整体重算、同一 6 维主口径、固定单一日历口径；q63 主 / calQ 并列披露但不并列为可选参数；禁止只替换 R=20% 一档',
    q63Primary: true, calQParallel: true, notOptionalParamTable: true,
    sixDimLabel: '[权重 75/25 | 现金 分段 3.0/2.3/1.3% | 成本 费5bp+滑点10bp | 成交 T+1 | 再平衡 q63(主)/calQ(并列) | 股息 carry 计入]',
    calQCaveat: 'calQ 列为「主口径 calQ」常数混合（含股息carry+成本+T+1），与「账户层简化口径 20.928%（现金不计息/无成本/不含股息）」不是同一口径，不可直接相减或并列成区间；两套结果物理分列、不并列为可选参数',
    rows: c2Recalc
  },
  ivPrime: {
    needed: ivPrimeList.length > 0,
    reason: 'C2 结构档位含 E′≠0.20 的档（0.75 系数档 + 其余三档 R 的所有档），与脚手架登记的 PATHS.iv（eq 固定 0.20）不同，故须在四条 PATHS 之外增跑 eq=E′、enabled:false 的常数混合路径并显式命名 (iv′)；不改动预注册主检验的 (iv)',
    count: ivPrimeList.length, list: ivPrimeList
  },
  monotonicity: { note: 'q63 主口径下 MDD 随 E′ 下降单调下降、CAGR 亦单调下降（收益-回撤偏好权衡，非优化结果）', rows: c2Monotonic },
  verdict: '通过（限「静态降 E 前半命题」）',
  reason: '(iv)-(i) 纯静态降 E 效应在 4,089 日样本上可估计、MDD 随 E′ 下降单调、成本后符号不变、四档整体重算且 q63/calQ 并列披露；但「达 R 才降 E 的时机正确性」不可证伪（属治理/偏好判断，不得写成回测结论），E′ 最终采纳归 Phase 6，且不得据此宣称「达 R 才降 E 无效」。',
  propositions: {
    'C2-P1': '成立（前半：常数敞口对照下 MDD 改善随 E′ 下降单调、成本后符号不变、(iv)-(i) 在 4,089 日样本可估计；V0 已逐位对齐）',
    'C2-P2': '不适用（非经验命题：「达 R 那一刻是否正确时机」需反事实，更早=择时违反第 4 条、更晚=同一规则，两者都不可由现有数据构造；不得写成「回测证明有效/无效」）',
    'C2-P3': '成立（四档一次性整体重算、固定单一日历 q63 主 + calQ 并列披露、同一 6 维主口径、两套结果不并列为可选参数、未只替换 R=20% 一档）'
  }
};

// ---------------------------------------------------------------------------
// 9. 组装 phase5_backtest_data.json（主体），sensitivity / C 表详表由 phase5_sensitivity.js 追加
// ---------------------------------------------------------------------------
const OUT = {
  meta: {
    generated: '2026-11-07', phase: 'Phase 5 正式回测（真实历史路径主回测 + 稳健性检验）',
    author: 'data-backtest-engineer 袁据实',
    note: '本轮第一次允许产出策略绩效数字；此前「非绩效」纪律仅约束 bt_r_clause.js 脚手架自检',
    engine: 'runRClause/mixRef（bt_r_clause.js，只读复用、未修改）+ met（复刻 bt_final.js:18-31）+ mixCalQ（本文件复刻 mix 日循环，仅换 calQ 时点集）',
    noEngineModification: 'PATHS/PATH_DIFFS/PREREGISTERED_MAIN_TEST/REQUIRED_RCLAUSE_KEYS/任何默认值逐字未改',
    singleDataSource: '本地价格序列（东方财富 2 JSON）+ NeoData 半年度 34 点线性插值估值/股息率 + 分段现金利率假设；宏观读数/联网行业权重/ETF 实测数据不进净值、不混拼（P2 §三）',
    sample: { from: '2010-01-04', to: '2026-11-06', days: B.N, priceNotDivAdjusted: true,
      note: '价格指数不含股息；股息收益经插值股息率逐日 divCash 计入现金；现金端分段利率假设' },
    historyBootstrapDiscipline: 'v1.4 择时层 bootstrap = bt_data.js:187 的 1,000 次（block20）；v1.5 配置倾斜审计 = bt_final.js:124 的 2,000 次（种子 sd=20261107）；对象不同、分列、不得互引；本文件不对状态机做任何 block bootstrap 显著性推断',
    historyBacktestDisclaimer: '历史回测不代表未来收益'
  },
  dataBaseline: {
    title: '一、数据基线',
    datasets: [
      { id: '①-1', name: '沪深300 日收盘', code: '000300', range: '2010-01-04~2026-11-06 日频', rows: B.N,
        adjust: '价格指数，不含股息、无复权', fields: 'data.klines[]="YYYY-MM-DD,收盘价"',
        tool: '东方财富公开接口本地快照（fs.readFileSync，无新增 MCP）', fetchDate: '快照 2026-11-06 / 计算 2026-11-07', file: 'hs300_daily_2010_2026.json' },
      { id: '①-2', name: '中证红利 日收盘', code: '000922', range: '2010-01-04~2026-11-06 日频', rows: B.N,
        adjust: '价格指数，不含股息、无复权', fields: 'data.klines[]', tool: '同上', fetchDate: '同上', file: 'csi_dividend_2010_2026.json' },
      { id: '②', name: '半年度估值/股息率 + 逐日插值', code: '000300.SH/000922.SH', range: '半年度 34 观测点→插值 4,089 日', rows: 34,
        adjust: '不适用', fields: 'pe_ttm/pb_lf/dividend_ratio/risk_premium；dyHS[]/dyHL[]',
        tool: 'NeoData index_valuation', fetchDate: 'fetched 2026-11-07', file: 'valuation_semiannual_2010_2026.json / valuation_series.js' },
      { id: '③', name: '分段现金利率（假设）', code: '现金端', range: '2010-2014=3.0% / 2015-2021=2.3% / 2022-2026=1.3%', rows: B.N,
        adjust: '不适用', fields: 'SEG_RATE[] 逐日数组',
        tool: 'v1.5 §2.3 / README 假设', fetchDate: '2026-11-07', file: 'phase2_indices.js 内置' }
    ],
    quality: { dateAligned: true, duplicateDates: 0, nonMonotonicDates: 0,
      nonPositivePrices: 0, missingNumeric: 0, valuationObs: 34,
      firstPoint: 'HS300 3535.23 / 红利 3532.21', lastPoint: 'HS300 4056.71 / 红利 5531.01（本轮固定快照）',
      corrFull: 0.8775, note: '价格指数不含股息靠插值股息率近似；幸存者偏差只做定性检查（成分股历史变更未纳入）；停牌/复权不适用（指数点位序列）' },
    singleSourceDeclaration: '本轮整批回测（价格/基准/复权/股息/现金利率）全部来自上述单一自洽口径；基准亦在同一数据源内构造（100% HS300 价格指数 / 分段现金），未另引外部无风险利率；宏观 NeoData 读数与联网行业权重仅作情景/注释，不进引擎'
  },
  backtestSetup: {
    title: '二、回测设置',
    inSample: '全期 2010-01-04~2026-11-06（4,089 交易日）为唯一主样本',
    outOfSample: '无独立样本外；4 折 walk-forward 折间重叠、3 折零信息、V 折首重置，仅作诊断，不得称「样本外验证」',
    benchmark: '同口径 100% 沪深300 价格指数 / 纯现金（分段利率累乘）',
    riskFreeRate: '纯现金年化 ' + RF_CAGR_PP + '%（分段利率假设，未另引外部无风险利率）',
    initialCapital: '归一化 ¥1（份额法，绩效为比例口径，与本金规模无关）',
    cost: '费 5bp + 滑点 10bp（双边，成本=成交额×(tradeFee+slippage)）', execLag: 1,
    rebalanceTiming: 'q63（(i-S)%63==0 季度末，收盘后判定、次日收盘价成交 T+1）；calQ 单列 C 表',
    dividendHandling: 'carry 计入（divCash=(vD·dyD+vH·dyH)/252 逐日计入现金）；股息税主口径不重复计',
    feeAnn: 0.005, interval: 63, w: 0.25, rebal: 'reset',
    iterationDiscipline: '数据集、成本、样本区间、基准与无风险利率假设全部保持不变，只更换 rClause 输入',
    preregisteredMainTest: MAIN
  },
  v0Alignment: {
    title: 'V0 逐位对齐校验（整批结果有效前提）',
    pass: V0_OK, fourTier: v0,
    pathIV: { eq: 0.20, navLen: refIV.length, maxAbsDiff: ivDiff, pass: ivDiff === 0 },
    note: '四档 R 各 4,089 点 + 路径 (iv) 全部 maxAbsDiff=0；与 final_audit_data.json finalPlan.table.mdd 逐位一致；未对齐则整批作废重跑'
  },
  preregMainTest: { spec: MAIN, pathsPerf: MAIN_PERF,
    pathIdentity: { ii_vs_i_maxAbsDiff: ii_i_diff, iii_vs_i_maxAbsDiff: iii_i_diff } },
  threeLayerDiffs,
  tables: { A: tableA, B: tableB, C: { status: '由 phase5_sensitivity.js 追加（口径敏感性诊断层）' } },
  cards,
  insufficientList: [
    'C0 主口径触发式净效应：不可评估（触发 0 次、独立事件 0<3、方差不存在）',
    'C0-P3 / ETF E1：2015-08、2016-01 触发日无 000922 场内 ETF（工具可得性不成立、非冲击成本问题），不得用宽基腿数据外推',
    '红利 D1/D2 第三口径：季节性 DPS 逐日除息日历「数据待更新」，第三口径数据不足、本轮未检验',
    'ETF 未建模摩擦：急性日 IOPV 折溢价日频序列、书面复核人工延迟实测分布、本账户代销渠道 SLA 均不可得，只能给档位+定性披露、不得给点估计',
    '跨除息日分红到账时点：逐笔「除息日 vs 到账日」无法核对（数据待更新），仅定性留痕',
    'C1 治理/行为价值：回测无法回答，需 12 周纸面执行（未开始）',
    'E′ 最终采纳档位：归 Phase 6，Phase 5 只给结构档位与单调性、不定档',
    '逐日实测货基净值 / 日度全量估值 / 000922 行业权重统一口径 / 12 周纸面执行数据：数据待更新'
  ],
  reproducibility: {
    runtime: 'Node v22.22.2；工作目录 E:/Desktop/investment；无第三方 npm 依赖',
    scripts: ['phase5_run.js（本文件）', 'phase5_sensitivity.js（C 表全矩阵 + 压力路径 A/B/C）'],
    dataFiles: ['phase5_backtest_data.json', 'phase5_backtest_stdout.txt'],
    commands: 'node phase5_run.js && node phase5_sensitivity.js',
    metricsCaliber: 'cagr=nav[end]/nav[0]^(252/len)-1；mdd 相对历史净资产高水位 V；vol=日收益总体标准差×√252；winRate=日收益>0 占比；sharpe=(cagr-现金cagr)/vol；turnover=累计成交额/初始净值',
    randomSeed: '主回测（本文件）无随机计算，全为确定性扫描；合成压力路径由 phase5_sensitivity.js 另设并显式记录固定种子',
    toolAndDate: '价格 东方财富本地快照 2026-11-06；估值 NeoData index_valuation fetched 2026-11-07；现金利率 v1.5 假设；本地 Node 重算 2026-11-07'
  },
  limits: [
    '单一样本 2010-01-04~2026-11-06（4,089 日），无第二独立样本；cutOnce 下事件稀疏/方差不可估计；MDD 单点极值对触发日/再平衡时点极敏感',
    '价格指数不含股息（靠 34 点半年度插值近似）；现金利率为三段年度常数近似；成本 5bp+10bp 无实测成交额/价差支撑；季度再平衡 63 交易日近似',
    '工具可得性：2010-2019 无 000922 场内 ETF，回测隐含「全期可按收盘价成交两类工具」在工具层不成立（定性局限，不改任何绩效数字）',
    '压力路径 A/B/C 全部为情景假设、非历史事实、非预测，构造锚来自同一历史序列、不独立；A/B 明确无反弹、结构性偏向保护侧；不是样本外验证',
    '书面复核延迟 reviewLagDays 是建模假设、非实测；回测不模拟人工判断（避免隐性择时）',
    '12 周纸面执行仍未开始，是正式投入真金白银前唯一剩余关卡；本卡所有内容为研究设计，不替代纸面执行',
    '不对第 5 条存废下结论（归 Phase 6）；不推荐具体产品；不把风险信号写成自动触发条件；不承诺收益、不建议加杠杆、不提供代客交易或规避监管建议',
    '历史回测不代表未来收益；不得用样本内最优参数当结论'
  ],
  // 由 phase5_sensitivity.js 填充并合并写回
  sensitivity: { status: 'pending：待 phase5_sensitivity.js 追加 C 表全矩阵 / 压力路径 / 符号一致性计数 / 命题三段判据 / 未建模摩擦' }
};

fs.writeFileSync(P('phase5_backtest_data.json'), JSON.stringify(OUT, null, 1));

// ---------------------------------------------------------------------------
// 10. 控制台摘要（shell 重定向到 phase5_backtest_stdout.txt）
// ---------------------------------------------------------------------------
const L = console.log;
L('===== Phase 5 主回测（真实历史路径 · 正式绩效数字）=====');
L('【V0 对齐】整批有效前提通过=' + V0_OK + '；四档 maxAbsDiff=[' + v0.map(x => x.maxAbsDiff).join('/') + ']；(iv) maxAbsDiff=' + ivDiff);
L('【预注册主检验 R=0.20/eqBase=0.40/q63/review20】四路径绩效（cagr/mdd/vol/sharpe/胜率/换手/超额vsHS300, 单位% 或 pp）');
for (const k of ['i', 'ii', 'iii', 'iv']) {
  const p = MAIN_PERF[k];
  L('  (' + k + ') cagr=' + p.cagr + ' mdd=' + p.mdd + ' vol=' + p.vol + ' sharpe=' + p.sharpe +
    ' winRate=' + p.winRate + ' turnover=' + p.turnover + ' excessVsHS300=' + p.excessVsHS300 + ' triggers=' + p.triggers);
}
L('  (ii)≡(i) maxAbsDiff=' + ii_i_diff + '；(iii)≡(i) maxAbsDiff=' + iii_i_diff + '（触发 0 次恒等）');
L('【三层差值】');
for (const d of threeLayerDiffs.diffs) L('  ' + d.id + ' CAGR=' + d.cagrPP + 'pp/年, MDD=' + d.mddPP + 'pp | ' + d.meaning);
L('  净效应判定=' + threeLayerDiffs.netEffectAssessment.verdict + '（触发 0 次；(ii)-(iv) 退化为 (i)-(iv) 镜像，不含触发信息）');
L('【A 表】主口径四档 R 触发次数=[' + fourRTriggers.map(x => x.triggerCount).join('/') + ']；独立事件(gap63)=0 ⇒ 不可评估');
L('  calQ 敏感性 R=20% 触发日=' + (mechanism.calQ_R20.trigger ? mechanism.calQ_R20.trigger.date : 'NA') +
  '；收紧 R 触发日=' + mechanism.tightenedR.map(x => x.trigger ? x.trigger.date : 'NA').join('/'));
L('【B 表】基准 HS300 cagr=' + BENCH_MET.hs300.cagr + '% / 纯现金 cagr=' + BENCH_MET.cash.cagr + '%；rf=' + RF_CAGR_PP + '%');
L('  4 折 walk-forward 含信息折数=' + walkForward.filter(x => x.hasTriggerInfo).length + '/4（3 折零信息、折间重叠、非样本外验证）');
L('  滚动 252 日窗口 MDD: min=' + rollingWindow.mddMin + ' median=' + rollingWindow.mddMedian + ' max=' + rollingWindow.mddMax + '，窗口数=' + rollingWindow.windows);
L('【逐卡判定】C0=' + cards.C0.verdict + ' / C1(C1′)=' + cards['C1/C1prime'].verdict + ' / C2=' + cards.C2.verdict);
L('【C2】E′ 结构档 E×{1.0,0.75,0.5} 四档整体重算；(iv′) 增跑=' + cards.C2.ivPrime.needed + '（' + cards.C2.ivPrime.count + ' 条）；q63 单调=' + c2Monotonic.every(x => x.mddMonotoneDown && x.cagrMonotoneDown));
L('【R=20%/E=40% 三档 q63 MDD】' + c2Recalc[1].factors.map(f => 'f=' + f.factor + ' E′=' + f.Eprime + '%: ' + f.q63.mdd + '%').join(' | '));
L('已写出 phase5_backtest_data.json（主体）；C 表全矩阵/压力路径由 phase5_sensitivity.js 追加');
L('本内容为研究分析，不构成投资建议。');
