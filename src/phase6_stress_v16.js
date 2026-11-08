// ============================================================================
// phase6_stress_v16.js — 第四轮 Phase 6【补跑：压力路径 × v1.6 新 R→E 表】
// 作者：顾衡策（编排层）｜ 2026-11-08 ｜ 用途：修正 v1.6 的证据缺口
//
// 背景（为什么需要这个脚本）：
//   v1.6 把 R→E 表由 30/40/50/55 下调为 25/35/45/55，但压力路径网格仍绑定
//   phase2_indices.js:41 的 R2EQ = [[15,30],[20,40],[25,50],[30,55]]（v1.5 旧表）。
//   两者交集只有 55% —— 即 v1.6 推荐的 E=25%/35%/45% 三档在 36 个压力单元中
//   【一个都没有被测过】。本脚本补上这三档。
//
// 铁律：
//  1) 不改任何已交付文件（bt_r_clause.js / phase2_indices.js / phase5_*.js 全部只读）。
//  2) 压力路径仍是【人工构造、非历史事实、非预测】，只用于机制与倍数披露，
//     不得用于挑选 E、不得当样本外验证。
//  3) 物理越界单元（名义跌幅 ≤ -100%）判「不可评估」并留空，不截断、不外推、不伪造 MDD=0。
//  4) ★ 信任前提：本脚本的合成序列与状态机日循环是从 phase5_sensitivity.js 逐行复刻的，
//     因此【必须先逐位复现原有 35 个已评估单元】，任何一格 maxAbsDiff > 0 则整批 throw。
//     只有复现通过，扩展到新 eq 档才可采信。
//
// 输出：phase6_stress_v16.json + 控制台摘要
// 复现：node phase6_stress_v16.js
// ============================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const PT = require('../lib/paths.js');
const P = PT.resolve;
const B = require('./phase2_indices.js');
const ENG = require('./bt_r_clause.js');

const pct = x => +(x * 100).toFixed(3);
const round = (x, n = 3) => +Number(x).toFixed(n);
const FEE_ANN = 0.005;
const CAL_Q_SET = new Set(B.CAL_Q);

// ---------------------------------------------------------------------------
// 0. 绩效函数（复刻 phase5_run.js:44-58，不改动）
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
  // 非有限值守卫：NaN/Infinity 一律抛错，禁止静默产出 MDD=0 的假象值
  const chk = { cagr, mdd, vol: sd, total: nav[nav.length - 1] / nav[0] - 1, winRate };
  for (const [k, v] of Object.entries(chk)) {
    if (!Number.isFinite(v)) throw new Error('met() 产出非有限值 ' + k + '=' + v + '（物理越界未被守卫拦截）');
  }
  return { cagr: pct(cagr), mdd: pct(mdd), vol: pct(sd),
    total: pct(chk.total), winRate: pct(winRate) };
}

// ---------------------------------------------------------------------------
// 1. 合成路径（逐行复刻 phase5_sensitivity.js:305-352）
// ---------------------------------------------------------------------------
const SEED_BASE = 20261108;
function lcg(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
function gauss(rnd) {
  let u = 0, v = 0; while (u === 0) u = rnd(); while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function synthSeries(id, R, pick) {
  const cfg = ENG.stressPathConfig(id, R, pick);
  if (cfg.equityCumDropPct <= -100) {
    return { cfg, invalid: true,
      invalidReason: '名义累计跌幅 ' + cfg.equityCumDropPct + '%（dropMult × R 线性外推）越过权益 -100% 物理下限，ln(1+drop) 无实数解，构造不成立',
      A: null, D: null, dates: null, rho: null, targetCumDropPct: cfg.equityCumDropPct };
  }
  const n = cfg.lengthDays, rho = cfg.corr;
  const L21 = rho, L22 = Math.sqrt(Math.max(1e-12, 1 - rho * rho));
  const rnd = lcg(SEED_BASE + ({ A: 101, B: 202, C: 303 })[id] * 1000 + ({ lo: 1, mid: 2, hi: 3 })[pick] * 10 + Math.round(R * 100));
  const targetLog = cfg.equityCumDropPct / 100;
  const targetLn = Math.log(1 + targetLog);
  const w = [];
  for (let i = 0; i < n; i++) {
    if (id === 'A') w.push(Math.pow(0.985, i));
    else if (id === 'B') w.push(1);
    else w.push(1);
  }
  const wSum = w.reduce((a, b) => a + b, 0);
  const sigma = id === 'A' ? 0.006 : id === 'B' ? 0.003 : 0.002;
  const eH = [], eD = [];
  for (let i = 0; i < n; i++) {
    const z1 = gauss(rnd), z2 = gauss(rnd);
    eH.push(z1); eD.push(L21 * z1 + L22 * z2);
  }
  const meanH = eH.reduce((a, b) => a + b, 0) / n, meanD = eD.reduce((a, b) => a + b, 0) / n;
  const lnH = [], lnD = [];
  for (let i = 0; i < n; i++) {
    lnH.push(targetLn * w[i] / wSum + sigma * (eH[i] - meanH));
    lnD.push(targetLn * w[i] / wSum + sigma * (eD[i] - meanD));
  }
  let pH = 4056.71, pD = 5531.01; const A = [], D = [], dates = [];
  for (let i = 0; i < n; i++) {
    pH *= Math.exp(lnH[i]); pD *= Math.exp(lnD[i]);
    A.push({ c: pH }); D.push({ c: pD }); dates.push('SYN-' + i);
  }
  return { cfg, A, D, dates, rho, targetCumDropPct: cfg.equityCumDropPct };
}

const dyH0 = B.V.dyHS.reduce((a, b) => a + b, 0) / B.V.dyHS.length;
const dyD0 = B.V.dyHL.reduce((a, b) => a + b, 0) / B.V.dyHL.length;

// ---------------------------------------------------------------------------
// 2. 状态机日循环（逐行复刻 phase5_sensitivity.js:360-432）
// ---------------------------------------------------------------------------
const RC = (o = {}) => Object.assign({
  enabled: true, R: 0.20, eqBase: 0.40, cutRatio: 0.5, lockDays: 20,
  recoverMode: 'review', reviewLagDays: 20, ddBasis: 'highWaterV',
  cutOnce: true, quarterMode: 'q63'
}, o);

function runSynth(prices, cfg, opt = {}) {
  const A = prices.A, D = prices.D, n = A.length;
  const eq = opt.eq ?? 0.40, R = opt.R ?? 0.20, w = 0.25;
  const tradeFee = 0.0005, slippage = opt.slippage ?? 0.001, execLag = 1;
  const interval = 63, cashRatePath = cfg.cashRatePath;
  const divMode = opt.divMode || 'dpsFixed';
  const kappa = opt.kappa ?? 0, lagDays = opt.lagDays ?? 0;
  const rc = opt.rClause || RC({ R, eqBase: eq });
  const enabled = rc.enabled, recoverMode = rc.recoverMode, reviewLagDays = rc.reviewLagDays,
    lockDays = rc.lockDays, cutRatio = rc.cutRatio, quarterMode = rc.quarterMode || 'q63';
  const DPS_H = dyH0 * A[0].c, DPS_D = dyD0 * D[0].c;
  const rateAt = i => i < cashRatePath.length ? cashRatePath[i] : cashRatePath[cashRatePath.length - 1];
  const isQ = i => i > 0 && (quarterMode === 'calQ' ? CAL_Q_SET.has(Math.min(i, B.N - 1)) : (i % interval === 0));
  let uD = eq * w / D[0].c, uH = eq * (1 - w) / A[0].c, cash = 1 - eq;
  let eqTarget = enabled ? rc.eqBase : eq;
  let V = 0, cutDone = false, triggerIdx = -1, lockUntilIdx = -1, recovered = false;
  let pendingCut = false, pendingRecover = false, pendingRebal = false;
  let vD = 0, vH = 0, e2 = 0;
  const nav = [], ddArr = [], events = [], triggers = [];
  let cumDivCash = 0, cutCount = 0, recoverCount = 0, rebalCount = 0, turnover = 0, feePaid = 0;
  const doReset = (idx, target, kind) => {
    const t = e2 + cash, want = t * target;
    const nvD = want * w, nvH = want * (1 - w);
    const traded = Math.abs(nvD - vD) + Math.abs(nvH - vH);
    const cost = traded * (tradeFee + slippage);
    cash = t - want - cost; uD = nvD / D[idx].c; uH = nvH / A[idx].c;
    vD = nvD; vH = nvH; e2 = vD + vH;
    turnover += traded; feePaid += cost;
    if (kind === 'cut') cutCount++; else if (kind === 'recover') recoverCount++; else rebalCount++;
    events.push({ type: kind, idx });
  };
  for (let i = 0; i < n; i++) {
    vD = uD * D[i].c; vH = uH * A[i].c; e2 = vD + vH;
    let DPS_Hi = DPS_H, DPS_Di = DPS_D;
    if (divMode === 'dpsKappa' && i > lagDays) {
      const yrs = (i - lagDays) / 252;
      const f = Math.pow(1 + kappa, yrs);
      DPS_Hi *= f; DPS_Di *= f;
    }
    let divCash;
    if (divMode === 'mktValueDy') divCash = (vD * dyD0 + vH * dyH0) / 252;
    else divCash = (uD * DPS_Di + uH * DPS_Hi) / 252;
    cumDivCash += divCash;
    cash += divCash - e2 * FEE_ANN / 252;
    cash *= 1 + rateAt(i) / 252;
    if (pendingCut) { doReset(i, eqTarget, 'cut'); pendingCut = false; }
    if (pendingRecover) { doReset(i, eqTarget, 'recover'); pendingRecover = false; if (pendingRebal) pendingRebal = false; }
    else if (pendingRebal) { doReset(i, eqTarget, 'rebalance'); pendingRebal = false; }
    let scheduled = false;
    if (enabled && cutDone && !recovered && recoverMode !== 'none') {
      let due = false;
      if (recoverMode === 'review') due = i >= triggerIdx + Math.max(lockDays, reviewLagDays);
      else if (recoverMode === 'quarterly') due = i >= lockUntilIdx && isQ(i);
      if (due) { recovered = true; eqTarget = rc.eqBase; pendingRecover = true; scheduled = true;
        events.push({ type: 'recover-signal', idx: i });
        const tg = triggers[triggers.length - 1]; if (tg) tg.recoverSignalIdx = i; }
    }
    if (!scheduled && isQ(i)) pendingRebal = true;
    const eqNow = uD * D[i].c + uH * A[i].c;
    const navI = eqNow + cash; nav.push(navI);
    if (navI > V) V = navI;
    const dd = 1 - navI / V; ddArr.push(dd);
    if (enabled && !cutDone && dd >= R) {
      cutDone = true; triggerIdx = i; lockUntilIdx = i + lockDays;
      eqTarget = rc.eqBase * cutRatio; pendingCut = true;
      events.push({ type: 'trigger', idx: i, dd: +dd.toFixed(6) });
      triggers.push({ idx: i, dd: +dd.toFixed(6), cutExecIdx: Math.min(i + 1, n - 1) });
    }
  }
  return { nav, dd: ddArr, events, triggers,
    counters: { cutCount, recoverCount, rebalCount, turnover, feePaid, cumDivCash },
    metrics: met(nav) };
}

// ---------------------------------------------------------------------------
// 3. ★ 校准闸门：逐位复现原有 36 个压力单元（35 已评估 + 1 越界）
// ---------------------------------------------------------------------------
const OLD = JSON.parse(fs.readFileSync(PT.resolve('phase5_backtest_data.json'), 'utf8')).tables.C.stressPaths.results;
const calib = [];
let maxAbsDiffGlobal = 0, mismatchCount = 0, calibCells = 0;

for (const rec of OLD) {
  for (const cell of rec.byR) {
    const R = cell.R / 100, eq = cell.eq / 100;
    const s = synthSeries(rec.id, R, rec.pick);
    if (s.invalid) {
      const ok = (cell.status || '').indexOf('不可评估') === 0 && cell.ii_mdd === null;
      calib.push({ id: rec.id, pick: rec.pick, R: cell.R, eq: cell.eq, kind: 'invalid', reproduced: ok });
      if (!ok) { mismatchCount++; }
      continue;
    }
    if (cell.status && cell.status.indexOf('不可评估') === 0) {
      throw new Error('校准失败：original 判越界但本地可算 ' + rec.id + '/' + rec.pick + '×R=' + cell.R);
    }
    const II = runSynth(s, s.cfg, { eq, R, divMode: 'dpsFixed', rClause: RC({ R, eqBase: eq }) });
    const I = runSynth(s, s.cfg, { eq, R, divMode: 'dpsFixed', rClause: { enabled: false, R } });
    const dII = Math.abs(II.metrics.mdd - cell.ii_mdd);
    const dI = Math.abs(I.metrics.mdd - cell.i_mdd);
    const dTrig = II.triggers.length - cell.triggerCount;
    const d = Math.max(dII, dI, Math.abs(dTrig));
    calibCells++;
    if (d > maxAbsDiffGlobal) maxAbsDiffGlobal = d;
    if (d > 0) {
      mismatchCount++;
      console.error('  ✗ 不一致 ' + rec.id + '/' + rec.pick + '×R=' + cell.R + ' eq=' + cell.eq +
        ' 原=' + cell.ii_mdd + '/' + cell.i_mdd + ' 本=' + II.metrics.mdd + '/' + I.metrics.mdd +
        ' 触发 原=' + cell.triggerCount + ' 本=' + II.triggers.length);
    }
    calib.push({ id: rec.id, pick: rec.pick, R: cell.R, eq: cell.eq, kind: 'evaluated',
      orig_ii_mdd: cell.ii_mdd, local_ii_mdd: II.metrics.mdd,
      orig_i_mdd: cell.i_mdd, local_i_mdd: I.metrics.mdd,
      orig_trig: cell.triggerCount, local_trig: II.triggers.length, maxAbsDiff: d });
  }
}

if (mismatchCount > 0 || maxAbsDiffGlobal > 0) {
  throw new Error('★ 校准未通过：' + mismatchCount + ' 格不一致，maxAbsDiff=' + maxAbsDiffGlobal +
    '。复刻失败，扩展结果不可采信，整批作废。');
}
console.log('★ 校准通过：' + calibCells + ' 个已评估单元 + ' + (calib.length - calibCells) +
  ' 个越界单元逐位复现，maxAbsDiff=' + maxAbsDiffGlobal);

// ---------------------------------------------------------------------------
// 4. 扩展：v1.6 新 R→E 表 × A/B/C × lo/mid/hi
// ---------------------------------------------------------------------------
const R2EQ_V16 = [[0.15, 0.25], [0.20, 0.35], [0.25, 0.45], [0.30, 0.55]];
const R2EQ_V15 = [[0.15, 0.30], [0.20, 0.40], [0.25, 0.50], [0.30, 0.55]];
// 历史样本内 MDD（v1.6 §4.1，同一 6 维主口径、无触发条款）
const HIST_MDD = { 0.20: 9.746, 0.25: 12.173, 0.30: 14.728, 0.35: 17.234, 0.40: 19.691, 0.45: 22.102, 0.50: 24.469, 0.55: 26.792 };

const results = [];
for (const id of ['A', 'B', 'C']) {
  for (const pick of ['lo', 'mid', 'hi']) {
    const byR = [];
    for (const [R, eq] of R2EQ_V16) {
      const s = synthSeries(id, R, pick);
      if (s.invalid) {
        byR.push({ R: pct(R), eq: pct(eq), equityCumDropPct: s.cfg.equityCumDropPct,
          status: '不可评估（人工构造情景物理越界）', invalidReason: s.invalidReason,
          triggerCount: null, ii_mdd: null, i_mdd: null, mddOverRPct: null, mddOverHistPct: null });
        continue;
      }
      const II = runSynth(s, s.cfg, { eq, R, divMode: 'dpsFixed', rClause: RC({ R, eqBase: eq }) });
      const I = runSynth(s, s.cfg, { eq, R, divMode: 'dpsFixed', rClause: { enabled: false, R } });
      const histMdd = HIST_MDD[+eq.toFixed(2)];
      byR.push({ R: pct(R), eq: pct(eq), equityCumDropPct: s.cfg.equityCumDropPct,
        status: '已评估（人工构造、非历史事实、非预测；仅机制/倍数披露）',
        triggerCount: II.triggers.length,
        ii_mdd: II.metrics.mdd, i_mdd: I.metrics.mdd,
        // MDD 相对 R 的倍数：这是"R 不是回撤上限"的量化依据
        mddOverRPct: round((II.metrics.mdd / pct(R)) * 100, 1),
        // MDD 相对同 E 历史样本内 MDD 的倍数：压力情景比历史恶化多少
        mddOverHistPct: histMdd ? round((II.metrics.mdd / histMdd) * 100, 1) : null,
        histMddAtSameEq: histMdd ?? null });
    }
    const s0 = synthSeries(id, 0.20, pick);
    results.push({ id, name: s0.cfg.name, pick, lengthDays: s0.cfg.lengthDays,
      equityCumDropPct: s0.cfg.equityCumDropPct, byR });
  }
}

// 汇总：v1.6 推荐档下的最坏倍数
const ev = [];
results.forEach(r => r.byR.forEach(c => { if (c.mddOverRPct != null) ev.push({ id: r.id, name: r.name, pick: r.pick, ...c }); }));
const worst = (arr) => arr.reduce((a, b) => (a.mddOverRPct >= b.mddOverRPct ? a : b));
const summary = {
  totalCells: results.length * R2EQ_V16.length,
  evaluated: ev.length,
  invalid: results.length * R2EQ_V16.length - ev.length,
  maxMddOverR: worst(ev).mddOverRPct,
  maxMddOverR_at: { id: worst(ev).id, pick: worst(ev).pick, R: worst(ev).R, eq: worst(ev).eq, mdd: worst(ev).ii_mdd },
  byPath: ['A', 'B', 'C'].map(id => {
    const sub = ev.filter(x => x.id === id);
    const w = worst(sub);
    return { id, name: sub[0].name, maxOverR: w.mddOverRPct, at: { pick: w.pick, R: w.R, eq: w.eq, mdd: w.ii_mdd },
      minOverR: Math.min(...sub.map(x => x.mddOverRPct)) };
  }),
  // 关键披露：v1.6 最高档 E=55%/R=30% 的慢熊倍数
  slowBearAt55: ev.filter(x => x.id === 'B' && x.eq === 55).map(x => ({ pick: x.pick, R: x.R, eq: x.eq,
    mdd: x.ii_mdd, overR: x.mddOverRPct, overHist: x.mddOverHistPct })),
  // 推荐档 R=20%/E=35% 的慢熊倍数
  slowBearAt35: ev.filter(x => x.id === 'B' && x.eq === 35).map(x => ({ pick: x.pick, R: x.R, mdd: x.ii_mdd,
    overR: x.mddOverRPct, overHist: x.mddOverHistPct }))
};

const out = {
  meta: {
    // 保留 ISO 的 Z 后缀：旧写法截掉时区后看起来像本地时间，实际是 UTC。
    generated: new Date().toISOString(),
    author: '顾衡策（编排层）',
    purpose: '补跑 v1.6 新 R→E 表（25/35/45/55）在压力路径下的表现；修正「推荐 E 三档未被压力检验」的证据缺口',
    script: 'phase6_stress_v16.js',
    reproduces: 'phase5_sensitivity.js（合成序列与状态机日循环逐行复刻）'
  },
  calibration: {
    gate: '逐位复现 phase5_backtest_data.json 的 36 个压力单元',
    evaluatedCells: calibCells,
    invalidCells: calib.length - calibCells,
    maxAbsDiff: maxAbsDiffGlobal,
    mismatchCount,
    passed: mismatchCount === 0 && maxAbsDiffGlobal === 0,
    detail: calib
  },
  grid: { R2EQ_V16, R2EQ_V15, note: '本脚本新增 R2EQ_V16；R2EQ_V15 为原网格，仅在校准中使用' },
  disclaimer: 'A/B/C 三条压力路径均为【人工构造】，不代表真实市场概率、不是样本外验证、不得用于挑选 E 或任何参数。仅用于「机制是否存在」与「倍数量级」披露。',
  summary,
  results
};

const L = console.log;
// ---------------------------------------------------------------------------
// 5. 口径极差基准复核（修正 v1.6 引用的 1.301pp）
//    1.301pp 的来源：round4_phase3_quant.md §6.1 —— 「账户层简化口径」
//    （现金不计息 / 无成本 / 不含股息）下 q63 19.627% → calQ 20.928% 的日历单维差。
//    它既不是主口径，也不是全维极差。本节用主口径原始网格重算四档定义。
// ---------------------------------------------------------------------------
const P5 = JSON.parse(fs.readFileSync(PT.resolve('phase5_backtest_data.json'), 'utf8'));
const grid = P5.tables.C.realHistoryGrid;
const svRows = grid.singleVariable.rows.filter(r => typeof r.mddPct === 'number');
const svMin = Math.min(...svRows.map(r => r.mddPct));
const svMax = Math.max(...svRows.map(r => r.mddPct));
const calQ = grid.calQParallel.calQ.mddPct;
const calQ63 = grid.calQParallel.q63.mddPct;
const dimMin = Math.min(...Object.values(grid.byDimension).flat().map(d => d.R20_mddMin));
const dimMax = Math.max(...Object.values(grid.byDimension).flat().map(d => d.R20_mddMax));

const basisDefs = [
  { key: 'cal_simplified', label: 'v1.6 实际采用：账户层简化口径 日历单维', mddMin: 19.627, mddMax: 20.928,
    source: 'round4_phase3_quant.md §6.1（现金不计息/无成本/不含股息）' },
  { key: 'cal_main', label: '主口径 日历单维（q63→calQ）', mddMin: calQ63, mddMax: calQ,
    source: 'phase5_backtest_data.json tables.C.realHistoryGrid.calQParallel' },
  { key: 'single_main', label: '主口径 单变量极差（11 个单维变体）', mddMin: svMin, mddMax: svMax,
    source: 'phase5_backtest_data.json tables.C.realHistoryGrid.singleVariable' },
  { key: 'single_main_cal', label: '主口径 单变量 + 日历', mddMin: Math.min(svMin, calQ), mddMax: Math.max(svMax, calQ),
    source: '上两行合并' },
  { key: 'grid160', label: '主口径 全 160 格（R=20% 行）', mddMin: dimMin, mddMax: dimMax,
    source: 'phase5_backtest_data.json tables.C.realHistoryGrid.byDimension' },
  { key: 'grid160_cal', label: '主口径 全 160 格 + 日历', mddMin: Math.min(dimMin, calQ), mddMax: Math.max(dimMax, calQ),
    source: '上一行 + calQ' }
];
const MARGIN = 2.7;
basisDefs.forEach(b => { b.rangePP = round(b.mddMax - b.mddMin, 3); b.marginMultiple = round(MARGIN / b.rangePP, 2); });
const basisRef = basisDefs.find(b => b.key === 'cal_simplified');
const basisMain = basisDefs.find(b => b.key === 'single_main');
const basisWorst = basisDefs.find(b => b.key === 'grid160_cal');

out.caliberRangeAudit = {
  why: 'v1.6 §4.2/§4.3 用 1.301pp 作为口径极差并据此宣称「余量≈2 倍」。复核发现 1.301pp 是账户层简化口径下的日历单维差，既非主口径也非全维极差。',
  marginRulePP: MARGIN,
  basis: basisDefs,
  verdict: {
    claimed: '约 2 倍（基于 ' + basisRef.rangePP + 'pp）',
    mainSingle: basisMain.rangePP + 'pp → ' + basisMain.marginMultiple + '×',
    mainFullGrid: basisWorst.rangePP + 'pp → ' + basisWorst.marginMultiple + '×',
    understatedBy: round(basisWorst.rangePP / basisRef.rangePP, 2) + '× ~ ' + round(basisMain.rangePP / basisRef.rangePP, 2) + '×',
    note: '1.301pp 本身无计算错误，但它只覆盖「日历」一个维度、且是在简化口径下测的；用它作余量标尺会系统性高估安全垫。'
  }
};

fs.writeFileSync(PT.out('phase6_stress_v16.json'), JSON.stringify(out, null, 1), 'utf8');

L('');
L('=== 口径极差基准复核（v1.6 的「≈2 倍」是否成立）===');
L('基准口径'.padEnd(30) + '\t极差pp\t2.7pp余量=几倍');
basisDefs.forEach(b => L(b.label.padEnd(30) + '\t' + String(b.rangePP).padStart(7) + '\t' + b.marginMultiple + '×'));
L('');
L('★ v1.6 采用 ' + basisRef.rangePP + 'pp → 宣称 2.07×（「约 2 倍」）');
L('★ 主口径单维极差 ' + basisMain.rangePP + 'pp → 实际 ' + basisMain.marginMultiple + '×');
L('★ 主口径全网格含日历 ' + basisWorst.rangePP + 'pp → 实际仅 ' + basisWorst.marginMultiple + '×');
L('★ 低估倍数：' + round(basisWorst.rangePP / basisRef.rangePP, 2) + '×（最严）~' + round(basisMain.rangePP / basisRef.rangePP, 2) + '×（最宽）');

L('');
L('=== v1.6 新 R→E 表 × 压力路径（A/B/C × lo/mid/hi × 四档）===');
L('R→E（v1.6）:', R2EQ_V16.map(([r, e]) => Math.round(r * 100) + '%→' + Math.round(e * 100) + '%').join('  '));
L('单元：' + summary.totalCells + ' 总 / ' + summary.evaluated + ' 已评估 / ' + summary.invalid + ' 越界(不可评估)');
L('');
for (const p of ['A', 'B', 'C']) {
  const sub = ev.filter(x => x.id === p);
  L('【' + p + ' ' + sub[0].name + '】');
  for (const pick of ['lo', 'mid', 'hi']) {
    const row = sub.filter(x => x.pick === pick);
    L('  ' + pick.padEnd(3) + ' ' + row.map(x =>
      'R' + x.R + '/E' + x.eq + ':' + x.ii_mdd + '%(' + x.mddOverRPct + '%×R)').join('  '));
  }
}
L('');
L('★ 最坏倍数：' + summary.maxMddOverR + '% × R @ ' + summary.maxMddOverR_at.id + '/' +
  summary.maxMddOverR_at.pick + ' R=' + summary.maxMddOverR_at.R + ' E=' + summary.maxMddOverR_at.eq +
  ' MDD=' + summary.maxMddOverR_at.mdd);
L('★ B 慢熊 @ E=55%/R=30%：' + summary.slowBearAt55.map(x =>
  x.pick + '=' + (x.mdd == null ? '越界' : x.mdd + '%(' + x.overR + '%×R, ' + x.overHist + '%×历史)')).join('  '));
L('★ B 慢熊 @ E=35%/R=20%（v1.6 推荐）：' + summary.slowBearAt35.map(x =>
  x.pick + '=' + x.mdd + '%(' + x.overR + '%×R, ' + x.overHist + '%×历史)').join('  '));
L('');
L('输出：phase6_stress_v16.json');
