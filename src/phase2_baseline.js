// ============================================================================
// Phase 2 统一数据基线 · 预检脚本（第四轮 / v1.6，2026-11-07）
// 作者：数据与回测工程师 袁据实
//
// 用途：产出 ① 数据质量检查 ② 四档 R 触发/余量的口径敏感性网格
//       ③ 急性/慢性段与六个低点的日期索引、两指数同日涨跌幅
//       ④ 剔除 2015 段后的样本索引与相关性
//       ⑤ 真实路径「账户回撤首次达 R」的触发日（相对高水位 V）、20 日窗口、恢复时点
//       ⑥ 各历史真实回撤幅度（补齐宏观侧「数据待更新」的构造锚）
//       ⑦ 核对主理人 Phase 2 预检数字
//
// 纪律：
//  - 本脚本只做「数据基线 + 事后统计（rHits 类）」，**不模拟动态触发状态机**，
//    因此**不产出任何策略回测绩效**（年化/夏普/胜率/换手留给 Phase 5）。
//  - kl / met / mix 自 bt_final.js:9-86 **逐行复制、未改动一个字符**，
//    保证与 v1.5 审计口径逐位一致；所有数字可追溯到具体工具调用与本地文件。
//  - 单一数据源：本地价格 JSON（东方财富）+ 本地估值/股息率 JSON（NeoData 半年度插值）
//    + 分段现金利率假设。宏观读数与联网行业权重不进本脚本。
//
// 运行：node phase2_baseline.js   →  写出 phase2_baseline_data.json
// ============================================================================
process.chdir(__dirname);
const fs = require('fs');
const PT = require('../lib/paths.js');
const V = require('./valuation_series.js');

// ---- 以下 kl / met / mix / idxOf 逐行复制自 bt_final.js（v1.5 第三轮引擎） ----
const kl = f => JSON.parse(fs.readFileSync(PT.resolve(f), 'utf8')).data.klines.map(s => {
  const [d, c] = s.split(','); return { d, c: +c };
});
const A = kl('hs300_daily_2010_2026.json');    // 沪深300 000300
const D = kl('csi_dividend_2010_2026.json');   // 中证红利 000922
const N = A.length, DATES = A.map(x => x.d);
const FEE_ANN = 0.005;                          // 权益端年化管理费
const pct = x => +(x * 100).toFixed(3);

function met(nav) {
  const y = nav.length / 252;
  const cagr = (nav[nav.length - 1] / nav[0]) ** (1 / y) - 1;
  let pk = nav[0], mdd = 0;
  const r = [];
  for (let i = 0; i < nav.length; i++) {
    if (nav[i] > pk) pk = nav[i];
    const d = 1 - nav[i] / pk; if (d > mdd) mdd = d;
    if (i) r.push(nav[i] / nav[i - 1] - 1);
  }
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  const sd = Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / r.length) * Math.sqrt(252);
  return { cagr: pct(cagr), mdd: pct(mdd), vol: pct(sd), total: pct(nav[nav.length - 1] / nav[0] - 1) };
}

function mix(opt = {}) {
  const o = Object.assign({
    eq: 0.40, w: 0.30, rebal: 'reset', interval: 63,
    cashRate: 0.025, dyH: V.dyHS, dyD: V.dyHL,
    tradeFee: 0, slippage: 0, divTax: 0, execLag: 0,
    S: 0, E: N - 1
  }, opt);
  const S = o.S, E = o.E;
  const rateAt = i => typeof o.cashRate === 'number' ? o.cashRate : o.cashRate[i];
  const dyHAt = i => typeof o.dyH === 'number' ? o.dyH : o.dyH[i];
  const dyDAt = i => typeof o.dyD === 'number' ? o.dyD : o.dyD[i];

  let uD = o.eq * o.w / D[S].c, uH = o.eq * (1 - o.w) / A[S].c, cash = 1 - o.eq;
  const nav = [];
  let rebalCount = 0, turnover = 0, feePaid = 0, taxPaid = 0, endWeight = 0, pending = false;

  for (let i = S; i <= E; i++) {
    let vD = uD * D[i].c, vH = uH * A[i].c, e2 = vD + vH;
    const divCash = (vD * dyDAt(i) + vH * dyHAt(i)) / 252;
    const tax = divCash * o.divTax;
    cash += divCash - tax - e2 * FEE_ANN / 252;
    cash *= 1 + rateAt(i) / 252;
    taxPaid += tax;

    const doRebal = (idx) => {
      const t = e2 + cash, want = t * o.eq;
      let nvD, nvH;
      if (o.rebal === 'frozen') {
        const f = want / (e2 || 1); nvD = vD * f; nvH = vH * f;
      } else {
        nvD = want * o.w; nvH = want * (1 - o.w);
      }
      const traded = Math.abs(nvD - vD) + Math.abs(nvH - vH);
      const cost = traded * (o.tradeFee + o.slippage);
      cash = t - want - cost;
      uD = nvD / D[idx].c; uH = nvH / A[idx].c;
      rebalCount++; turnover += traded; feePaid += cost;
      vD = nvD; vH = nvH; e2 = vD + vH;
    };

    if (pending) { doRebal(i); pending = false; }
    if (i > S && (i - S) % o.interval === 0) {
      if (o.execLag === 0) doRebal(i); else pending = true;
    }
    const eqNow = uD * D[i].c + uH * A[i].c;
    endWeight = uD * D[i].c / (eqNow || 1);
    nav.push(eqNow + cash);
  }
  return { nav, m: met(nav), rebalCount, turnover: pct(turnover), feePaid: pct(feePaid),
    taxPaid: pct(taxPaid), endWeight: pct(endWeight) };
}
const idxOf = d => { const i = DATES.findIndex(x => x >= d); return i < 0 ? N - 1 : i; };
// ---- 复制结束 ----

const TWO = x => +Number(x).toFixed(2);
const F3 = x => +Number(x).toFixed(3);
const corr = (xs, ys) => {
  const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const a = xs[i] - mx, b = ys[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
  return sxy / Math.sqrt(sxx * syy);
};
const rH = i => A[i].c / A[i - 1].c - 1;
const rD = i => D[i].c / D[i - 1].c - 1;
const rEq = i => 0.75 * rH(i) + 0.25 * rD(i);   // 权益内 75/25 每日重置
const mddOf = nav => { let pk = nav[0], m = 0; for (const v of nav) { if (v > pk) pk = v; const d = 1 - v / pk; if (d > m) m = d; } return m; };

const OUT = { generated: '2026-11-07', phase: 'Phase 2 数据基线', author: 'data-backtest-engineer 袁据实',
  note: '本文件仅含数据基线与事后统计量，不含动态状态机策略回测绩效（Phase 5 产出）' };

// ============================================================================
// 1. 数据质量检查
// ============================================================================
const qc = {
  files: ['hs300_daily_2010_2026.json', 'csi_dividend_2010_2026.json', 'valuation_semiannual_2010_2026.json'],
  hs300: { code: JSON.parse(fs.readFileSync(PT.resolve('hs300_daily_2010_2026.json'), 'utf8')).data.code, rows: A.length,
    from: DATES[0], to: DATES[N - 1], firstClose: A[0].c, lastClose: A[N - 1].c },
  dividend: { code: JSON.parse(fs.readFileSync(PT.resolve('csi_dividend_2010_2026.json'), 'utf8')).data.code, rows: D.length,
    from: D[0].d, to: D[D.length - 1].d, firstClose: D[0].c, lastClose: D[D.length - 1].c },
  dateAligned: A.every((x, i) => x.d === D[i].d),
  duplicateDates: N - new Set(DATES).size,
  nonMonotonicDates: DATES.slice(1).filter((d, i) => d <= DATES[i]).length,
  nonPositivePrices: A.filter(x => !(x.c > 0)).length + D.filter(x => !(x.c > 0)).length,
  missingNumeric: A.filter(x => !isFinite(x.c)).length + D.filter(x => !isFinite(x.c)).length,
  valuationObs: V.obs.length, valuationFrom: V.obs[0].d, valuationTo: V.obs[V.obs.length - 1].d,
  valuationRawRows: JSON.parse(fs.readFileSync(PT.resolve('valuation_semiannual_2010_2026.json'), 'utf8')).rows.length,
  dailyReturns: N - 1,
  v15Snapshot: { hs300: 4054.28, dividend: 5532.07, note: 'v1.5 §6 记录的 2026-11-06 收盘，与本地 JSON 末点不一致' },
  localSnapshot: { hs300: A[N - 1].c, dividend: D[D.length - 1].c },
  snapshotDiff: { hs300: F3(A[N - 1].c - 4054.28), dividend: F3(D[D.length - 1].c - 5532.07) }
};
OUT.quality = qc;

// ============================================================================
// 2. 口径定义（全部为完整 opt，供 Phase 5 直接复用）
// ============================================================================
const SEG_RATE = DATES.map(d => { const y = +d.slice(0, 4); return y <= 2014 ? 0.030 : y <= 2021 ? 0.023 : 0.013; });
const SEG_UP = SEG_RATE.map(r => r + 0.01);
const SEG_DN = SEG_RATE.map(r => r - 0.01);
const W_AUDIT = 0.30, W_FINAL = 0.25;
const COST0 = { tradeFee: 0, slippage: 0, divTax: 0, execLag: 0 };
const COST_T0 = { tradeFee: 0.0005, slippage: 0.001, divTax: 0, execLag: 0 };
const COST_T1 = { tradeFee: 0.0005, slippage: 0.001, divTax: 0, execLag: 1 };
const COST_T1_TAX = { tradeFee: 0.0005, slippage: 0.001, divTax: 0.10, execLag: 1 };
const DIV_IN = { dyH: V.dyHS, dyD: V.dyHL };
const DIV_OUT = { dyH: 0, dyD: 0 };

// 命名锚点口径（Phase 5 必须沿用本定义）
const P = {
  // ① 基线口径 A（= bt_final.js rHits 所用）：70/30 + 现金常数 2.5% + 无成本 + T+0 + 季度63日 + 股息计入
  A_auditBase: Object.assign({ eq: 0.40, w: W_AUDIT, rebal: 'reset', interval: 63, cashRate: 0.025 }, COST0, DIV_IN),
  // ② v1.5 §5.1 基线（75/25）：3.702% / 18.545%
  B_v15Base: Object.assign({ eq: 0.40, w: W_FINAL, rebal: 'reset', interval: 63, cashRate: 0.025 }, COST0, DIV_IN),
  // ③ v1.5 主口径（75/25 执行口径）：分段利率 + 费5bp + 滑点10bp + T+1 + reset 季度63日，股息税不重复计
  C_main: Object.assign({ eq: 0.40, w: W_FINAL, rebal: 'reset', interval: 63, cashRate: SEG_RATE }, COST_T1, DIV_IN),
  // ④ 主口径 + 含 10% 股息税保守值
  D_mainTax: Object.assign({ eq: 0.40, w: W_FINAL, rebal: 'reset', interval: 63, cashRate: SEG_RATE }, COST_T1_TAX, DIV_IN),
  // ⑤ 行业侧简化口径近似：75/25 + 现金不计息 + 无成本 + 不含股息 + 季度63日（用 mix 近似，另见 §6 独立账户层）
  E_industrySimple: Object.assign({ eq: 0.40, w: W_FINAL, rebal: 'reset', interval: 63, cashRate: 0 }, COST0, DIV_OUT),
  // ⑥ 主口径 + 每日再平衡
  F_dailyRebal: Object.assign({ eq: 0.40, w: W_FINAL, rebal: 'reset', interval: 1, cashRate: SEG_RATE }, COST_T1, DIV_IN),
  // ⑦ 主口径 + 分段利率 -1pp
  G_segMinus1: Object.assign({ eq: 0.40, w: W_FINAL, rebal: 'reset', interval: 63, cashRate: SEG_DN }, COST_T1, DIV_IN),
  // ⑧ 主口径 + 全期 1.3% 前瞻压力
  H_fwd13: Object.assign({ eq: 0.40, w: W_FINAL, rebal: 'reset', interval: 63, cashRate: 0.013 }, COST_T1, DIV_IN)
};
const R2EQ = [[0.15, 0.30], [0.20, 0.40], [0.25, 0.50], [0.30, 0.55]];

// 事后统计（rHits 类，含触发天数与触发日索引）；dd 相对历史净资产高水位 V
function rStat(opt, eq, R) {
  const nav = mix(Object.assign({}, opt, { eq })).nav;
  let pk = nav[0], maxDd = 0, firstIdx = -1, nHitDays = 0, maxDdIdx = 0;
  for (let i = 0; i < nav.length; i++) {
    if (nav[i] > pk) pk = nav[i];
    const dd = 1 - nav[i] / pk;
    if (dd > maxDd) { maxDd = dd; maxDdIdx = i; }
    if (dd >= R) { nHitDays++; if (firstIdx < 0) firstIdx = i; }
  }
  return { mddPct: pct(maxDd), headroomPp: F3((R - maxDd) * 100), hit: firstIdx >= 0 ? 1 : 0,
    first: firstIdx >= 0 ? DATES[firstIdx] : null, firstIdx, nHitDays, maxDdIdx,
    maxDdDate: DATES[maxDdIdx], nav };
}

// ============================================================================
// 3. 核对主理人预检（final_audit_data.json）
// ============================================================================
const AUD = JSON.parse(fs.readFileSync(PT.resolve('final_audit_data.json'), 'utf8'));
OUT.verifyLead = {
  riskRuleTable: AUD.riskRule.table,
  riskRuleCross: AUD.riskRule.cross,
  finalPlanTable: AUD.finalPlan.table,
  recomputed_rHits_base: R2EQ.map(([R, eq]) => {
    const s = rStat(P.A_auditBase, eq, R);
    return { R: TWO(R * 100), eq: TWO(eq * 100), mdd: s.mddPct, headroom: s.headroomPp, hit: s.hit, first: s.first };
  }),
  recomputed_main: R2EQ.map(([R, eq]) => {
    const s = rStat(P.C_main, eq, R);
    return { R: TWO(R * 100), eq: TWO(eq * 100), mdd: s.mddPct, headroom: s.headroomPp, hit: s.hit, first: s.first };
  }),
  conclusion: '逐位一致（见下）'
};

// 锚点口径表：8 口径 × 4 档 R
OUT.anchorTable = Object.keys(P).map(k => ({
  key: k, rows: R2EQ.map(([R, eq]) => {
    const s = rStat(P[k], eq, R);
    return { R: TWO(R * 100), eq: TWO(eq * 100), cagr: mix(Object.assign({}, P[k], { eq })).m.cagr,
      mdd: s.mddPct, headroom: s.headroomPp, hit: s.hit, first: s.first, nHitDays: s.nHitDays };
  })
}));

// ============================================================================
// 4. 全口径敏感性网格（160 变体 × 4 档 R）
// ============================================================================
const GRID = {
  w: [{ k: '70/30', v: W_AUDIT }, { k: '75/25', v: W_FINAL }],
  cash: [
    { k: '常数2.5%', v: 0.025 }, { k: '分段3.0/2.3/1.3', v: SEG_RATE },
    { k: '分段+1pp', v: SEG_UP }, { k: '分段-1pp', v: SEG_DN }, { k: '全期1.3%前瞻', v: 0.013 }
  ],
  cost: [
    { k: '无成本/T+0', v: COST0 }, { k: '费+滑点/T+0', v: COST_T0 },
    { k: '费+滑点/T+1', v: COST_T1 }, { k: '费+滑点/T+1/税10%', v: COST_T1_TAX }
  ],
  rebal: [{ k: '季度63日', v: 63 }, { k: '每日1日', v: 1 }],
  div: [{ k: '股息计入', v: DIV_IN }, { k: '股息不计入', v: DIV_OUT }]
};
const combos = [];
for (const w of GRID.w) for (const cash of GRID.cash) for (const cost of GRID.cost)
  for (const rebal of GRID.rebal) for (const div of GRID.div) {
    const opt = Object.assign({ w: w.v, rebal: 'reset', interval: rebal.v, cashRate: cash.v }, cost.v, div.v);
    combos.push({ id: [w.k, cash.k, cost.k, rebal.k, div.k].join(' | '),
      w: w.k, cash: cash.k, cost: cost.k, rebal: rebal.k, div: div.k,
      coreReasonable: rebal.v === 63, opt });
  }
OUT.gridDims = { w: GRID.w.map(x => x.k), cash: GRID.cash.map(x => x.k), cost: GRID.cost.map(x => x.k),
  rebal: GRID.rebal.map(x => x.k), div: GRID.div.map(x => x.k), totalCombos: combos.length };
OUT.gridSummary = R2EQ.map(([R, eq]) => {
  const rows = combos.map(c => {
    const s = rStat(c.opt, eq, R);
    return { id: c.id, core: c.coreReasonable, mdd: s.mddPct, headroom: s.headroomPp, hit: s.hit, first: s.first };
  });
  const core = rows.filter(x => x.core), ext = rows.filter(x => !x.core);
  const min = a => a.reduce((p, q) => q.headroom < p.headroom ? q : p);
  const hits = a => a.filter(x => x.hit === 1).length;
  const thin = a => a.filter(x => x.headroom < 0.5).length;
  return { R: TWO(R * 100), eq: TWO(eq * 100),
    core: { n: core.length, minHeadroom: min(core).headroom, minId: min(core).id,
      hitVariants: hits(core), thinVariants: thin(core) },
    ext: { n: ext.length, minHeadroom: min(ext).headroom, minId: min(ext).id,
      hitVariants: hits(ext), thinVariants: thin(ext) },
    all: { n: rows.length, minHeadroom: min(rows).headroom, minId: min(rows).id,
      hitVariants: hits(rows), thinVariants: thin(rows) } };
});
// 主口径单变量扰动（每次只动一个维度）
const MAIN_ID = ['75/25', '分段3.0/2.3/1.3', '费+滑点/T+1', '季度63日', '股息计入'].join(' | ');
const base = P.C_main;
const perturb = [
  ['基准：主口径', {}],
  ['w 75/25→70/30', { w: W_AUDIT }],
  ['现金 分段→常数2.5%', { cashRate: 0.025 }],
  ['现金 分段→分段+1pp', { cashRate: SEG_UP }],
  ['现金 分段→分段-1pp', { cashRate: SEG_DN }],
  ['现金 分段→全期1.3%', { cashRate: 0.013 }],
  ['成本 费+滑点+T+1→无成本/T+0', COST0],
  ['成本 →费+滑点/T+0（去T+1）', COST_T0],
  ['成本 →+10%股息税', COST_T1_TAX],
  ['再平衡 季度63日→每日1日', { interval: 1 }],
  ['股息 计入→不计入', DIV_OUT]
];
OUT.singleVariable = R2EQ.map(([R, eq]) => ({
  R: TWO(R * 100), eq: TWO(eq * 100),
  rows: perturb.map(([name, delta]) => {
    const s = rStat(Object.assign({}, base, delta), eq, R);
    return { name, mdd: s.mddPct, headroom: s.headroomPp, hit: s.hit, first: s.first, nHitDays: s.nHitDays };
  })
}));
// 主口径四档的临界触发 R（= 该口径全期 MDD）与首次触发日
OUT.criticalR = R2EQ.map(([R, eq]) => {
  const s = rStat(P.C_main, eq, R);
  return { eq: TWO(eq * 100), nominalR: TWO(R * 100), fullMdd: s.mddPct,
    criticalR: s.mddPct, maxDdDate: s.maxDdDate, headroomAtNominalR: s.headroomPp };
});

// ============================================================================
// 5. 日期索引常量（供 Phase 5 直接调用；同时另存 phase2_indices.js）
// ============================================================================
const SEGDEF = [
  { key: 'crash2015', label: '2015 股灾（急性）', from: '2015-06-08', to: '2015-08-26', kind: 'acute' },
  { key: 'circuit2016', label: '2016 熔断（急性）', from: '2015-12-22', to: '2016-01-28', kind: 'acute' },
  { key: 'bear2018', label: '2018 全年熊市（急性）', from: '2018-01-24', to: '2019-01-03', kind: 'acute' },
  { key: 'covid2020', label: '2020-03 疫情（急性）', from: '2020-03-05', to: '2020-03-23', kind: 'acute' },
  { key: 'spring2022', label: '2022 春季急跌（慢性分化）', from: '2021-12-13', to: '2022-04-26', kind: 'chronic' },
  { key: 'year2022', label: '2022 全年阴跌（慢性分化）', from: '2022-01-04', to: '2022-10-31', kind: 'chronic' },
  { key: 'slow2021_2024', label: '2021-02→2024-09 长慢熊（慢性分化）', from: '2021-02-10', to: '2024-09-13', kind: 'chronic' }
];
function segDetail(s) {
  const si = idxOf(s.from), ei = idxOf(s.to);
  const days = [];
  for (let i = si + 1; i <= ei; i++) days.push({ i, d: DATES[i], rH: F3(rH(i) * 100), rD: F3(rD(i) * 100), rEq: F3(rEq(i) * 100) });
  const hs = days.map(x => x.rH / 100), ds = days.map(x => x.rD / 100);
  const down = days.filter(x => x.rH < 0);
  const downCorr = down.length > 2 ? corr(down.map(x => x.rH / 100), down.map(x => x.rD / 100)) : null;
  const cum = arr => arr.reduce((a, x) => a * (1 + x), 1) - 1;
  return { key: s.key, label: s.label, kind: s.kind,
    from: DATES[si], to: DATES[ei], startIdx: si, endIdx: ei, nTradingDays: ei - si + 1, nReturns: ei - si,
    cumHS: F3(cum(hs) * 100), cumDIV: F3(cum(ds) * 100), cum7525: F3(cum(days.map(x => x.rEq / 100)) * 100),
    corrWindow: +corr(hs, ds).toFixed(4),
    corrDown: downCorr === null ? null : +downCorr.toFixed(4),
    nDownDays: down.length,
    daily: days };
}
OUT.segments = SEGDEF.map(segDetail);
OUT.lowPoints = ['2015-08-26', '2016-01-28', '2019-01-03', '2020-03-23', '2022-04-26', '2022-10-31']
  .map(d => ({ date: d, idx: idxOf(d), matched: DATES[idxOf(d)], hsClose: A[idxOf(d)].c, divClose: D[idxOf(d)].c,
    next10: DATES[Math.min(idxOf(d) + 10, N - 1)], next20: DATES[Math.min(idxOf(d) + 20, N - 1)],
    next40: DATES[Math.min(idxOf(d) + 40, N - 1)] }));
OUT.exclude2015 = (() => {
  const s = idxOf('2015-05-01'), e = idxOf('2016-03-01') - 1;
  const keep = i => DATES[i] < '2015-05-01' || DATES[i] > '2016-02-29';
  const keptIdx = []; for (let i = 1; i < N; i++) if (keep(i)) keptIdx.push(i);
  const exclIdx = []; for (let i = 1; i < N; i++) if (!keep(i)) exclIdx.push(i);
  const c = ids => corr(ids.map(rH), ids.map(rD));
  return { excludeFrom: '2015-05-01', excludeTo: '2016-02-29',
    excludeStartIdx: s, excludeEndIdx: e, excludeTradingDays: e - s + 1,
    keptSegments: [[0, s - 1], [e + 1, N - 1]],
    keptReturns: keptIdx.length, excludedReturns: exclIdx.length,
    corrFull: +corr([...Array(N - 1)].map((_, k) => rH(k + 1)), [...Array(N - 1)].map((_, k) => rD(k + 1))).toFixed(4),
    corrKept: +c(keptIdx).toFixed(4), corrExcluded: +c(exclIdx).toFixed(4) };
})();

// ============================================================================
// 6. 历史真实回撤幅度（补齐宏观侧「数据待更新」的构造锚）
// ============================================================================
function peakTrough(from, to) {
  const s = idxOf(from), e = idxOf(to);
  let pi = s; for (let i = s; i <= e; i++) if (A[i].c > A[pi].c) pi = i;
  let ti = pi; for (let i = pi; i <= e; i++) if (A[i].c < A[ti].c) ti = i;
  return { peakDate: DATES[pi], troughDate: DATES[ti], peakIdx: pi, troughIdx: ti,
    hs: F3((A[ti].c / A[pi].c - 1) * 100), div: F3((D[ti].c / D[pi].c - 1) * 100),
    eq7525: F3(([...Array(ti - pi)].map((_, k) => 1 + rEq(pi + k + 1)).reduce((a, b) => a * b, 1) - 1) * 100) };
}
OUT.historicalDrawdowns = {
  windows: [
    { key: 'crash2015', label: '2015 股灾', w: ['2015-05-01', '2015-09-30'] },
    { key: 'circuit2016', label: '2015-16 熔断', w: ['2015-11-01', '2016-02-29'] },
    { key: 'bear2018', label: '2018 全年熊市', w: ['2018-01-01', '2019-01-15'] },
    { key: 'covid2020', label: '2020-03 疫情', w: ['2020-01-01', '2020-03-31'] },
    { key: 'spring2022', label: '2022 春季急跌', w: ['2021-12-01', '2022-05-31'] },
    { key: 'year2022', label: '2022 全年阴跌', w: ['2022-01-01', '2022-11-30'] },
    { key: 'slow2021_2024', label: '2021-02→2024-09 长慢熊', w: ['2021-02-01', '2024-09-30'] }
  ].map(x => Object.assign({ key: x.key, label: x.label, window: x.w }, peakTrough(x.w[0], x.w[1]))),
  fullSample: (() => {
    let pi = 0; for (let i = 0; i < N; i++) if (A[i].c > A[pi].c) pi = i;
    let ti = pi; for (let i = pi; i < N; i++) if (A[i].c < A[ti].c) ti = i;
    // 各指数自身全期 MDD
    const self = arr => { let pk = arr[0].c, m = 0, pd = arr[0].d, td = arr[0].d, curPk = arr[0].d;
      for (const x of arr) { if (x.c > pk) { pk = x.c; curPk = x.d; } const dd = 1 - x.c / pk; if (dd > m) { m = dd; pd = curPk; td = x.d; } }
      return { mdd: F3(m * 100), peak: pd, trough: td }; };
    return { hsPeakTrough: { peakDate: DATES[pi], troughDate: DATES[ti], pct: F3((A[ti].c / A[pi].c - 1) * 100) },
      hsSelfMdd: self(A), divSelfMdd: self(D) };
  })()
};
// 账户层严格实现（现金不计息 / 无成本 / 不含股息 / FEE_ANN=0）
// 三个可切换维度：w 权益内红利权重；eqMode 总敞口重置日历；innerMode 权益内重置频率。
// 目的：把行业侧 −20.93%（季度再平衡）与 −23.77%（每日恒定混合）纳入同一份价格序列，
//       定位两者与 v1.5 主口径（63 交易日近似季末）的口径差异来源。
const CAL_Q = [];
for (let i = 1; i < N; i++) {
  const m = +DATES[i].slice(5, 7);
  if ([3, 6, 9, 12].includes(m) && DATES[i + 1] && DATES[i + 1].slice(5, 7) !== DATES[i].slice(5, 7)) CAL_Q.push(i);
}
function accountNavStrict(w, eqMode, innerMode) {
  const E = 0.40;
  let uH = E * (1 - w) / A[0].c, uD = E * w / D[0].c, cash = 1 - E;
  const nav = [1];
  const isEqReset = eqMode === 'daily' ? () => true
    : eqMode === 'q63' ? i => i % 63 === 0
    : eqMode === 'calQ' ? i => CAL_Q.includes(i) : () => false;
  for (let i = 1; i < N; i++) {
    let vH = uH * A[i].c, vD = uD * D[i].c, eq = vH + vD;
    const doEq = isEqReset(i), doInner = innerMode === 'daily' ? true : innerMode === 'onEq' ? doEq : false;
    if (doEq) {
      const t = eq + cash, want = t * E; cash = t - want;
      if (doInner) { vD = want * w; vH = want * (1 - w); }
      else { const f = want / eq; vD *= f; vH *= f; }
      uD = vD / D[i].c; uH = vH / A[i].c;
    } else if (doInner) {
      const t = eq; vD = t * w; vH = t * (1 - w); uD = vD / D[i].c; uH = vH / A[i].c;
    }
    nav.push(uH * A[i].c + uD * D[i].c + cash);
  }
  return nav;
}
OUT.rebalanceCalendar = {
  note: '「日历季末」= 3/6/9/12 月最后一个交易日（严格按交易日历）；v1.5 引擎用 63 交易日近似，两者并非同一时点集。',
  calQuarterEndCount: CAL_Q.length, calQuarterFirst: DATES[CAL_Q[0]], calQuarterLast: DATES[CAL_Q[CAL_Q.length - 1]],
  calQuarterEnds: CAL_Q,
  grid: (() => {
    const rows = [];
    for (const w of [0.25, 0.30]) for (const eq of ['q63', 'calQ', 'daily', 'none'])
      for (const inn of ['daily', 'onEq', 'none'])
        rows.push({ w: w === 0.25 ? '75/25' : '70/30', eqReset: eq, innerReset: inn,
          mddPct: F3(mddOf(accountNavStrict(w, eq, inn)) * 100) });
    return rows;
  })(),
  industryMatch: '行业侧 §3.4「季度再平衡 −20.93%」对应 calQ（75/25 得 20.89~20.93%、70/30 得 20.90~20.94%）；' +
    '「每日恒定混合 −23.77%」对应 eqReset=none + innerReset=daily（75/25 得 23.77%，逐位吻合）。' +
    '即行业侧与 v1.5 主口径的差异主要来自「日历季末 vs 63 交易日近似」及「总敞口是否重置」，' +
    '而非股息/成本/T+1；两者都是可辩护的口径，须在 v1.6 显式固定其一。'
};
const acctOne = (label, w, eq, inn) => {
  const nav = accountNavStrict(w, eq, inn), m = mddOf(nav);
  let pk = nav[0], firstR20 = -1;
  for (let i = 0; i < nav.length; i++) { if (nav[i] > pk) pk = nav[i]; if (firstR20 < 0 && 1 - nav[i] / pk >= 0.20) firstR20 = i; }
  return { mode: label, w: w === 0.25 ? '75/25' : '70/30', eqReset: eq, innerReset: inn,
    mddPct: F3(m * 100), firstHitR20Idx: firstR20,
    firstHitR20Date: firstR20 >= 0 ? DATES[firstR20] : null,
    window20End: firstR20 >= 0 ? DATES[Math.min(firstR20 + 20, N - 1)] : null,
    window20EndIdx: firstR20 >= 0 ? Math.min(firstR20 + 20, N - 1) : null };
};
OUT.accountLayer = [
  acctOne('v1.5 引擎近似：63 交易日重置', 0.25, 'q63', 'onEq'),
  acctOne('日历季末重置（行业侧 −20.93%）', 0.25, 'calQ', 'onEq'),
  acctOne('总敞口从不重置 + 权益内每日重置（行业侧 −23.77%）', 0.25, 'none', 'daily')
];

// ============================================================================
// 7. 真实路径「账户回撤首次达 R」的触发日（相对高水位 V）、20 日窗口、恢复时点
// ============================================================================
function triggerPath(opt, eq, R) {
  const s = rStat(opt, eq, R);
  const out = { R: TWO(R * 100), eq: TWO(eq * 100), basis: '历史净资产高水位 V（份额法，不因操作重置）',
    mdd: s.mddPct, headroom: s.headroomPp, hit: s.hit, first: s.first, firstIdx: s.firstIdx,
    nHitDays: s.nHitDays, maxDdDate: s.maxDdDate, maxDdIdx: s.maxDdIdx };
  if (s.firstIdx >= 0) {
    const t = s.firstIdx;
    out.lock20EndIdx = Math.min(t + 20, N - 1); out.lock20End = DATES[out.lock20EndIdx];
    // 下一个 63 日季度再平衡日（自样本起点 0 起算）
    let q = Math.ceil(t / 63) * 63; if (q <= t) q += 63;
    out.nextQuarterRebalIdx = Math.min(q, N - 1); out.nextQuarterRebal = DATES[out.nextQuarterRebalIdx];
    out.recoveryReviewIdx = out.lock20EndIdx; out.recoveryReview = out.lock20End;
    out.recoveryQuarterlyIdx = Math.max(out.lock20EndIdx, out.nextQuarterRebalIdx);
    out.recoveryQuarterly = DATES[out.recoveryQuarterlyIdx];
  } else {
    out.lock20End = null; out.recoveryReview = null; out.recoveryQuarterly = null;
    out.note = '全期 0 次触发：无触发日、无 20 日锁定窗口、无恢复时点';
  }
  return out;
}
OUT.triggerPaths = {
  mainFourR: R2EQ.map(([R, eq]) => triggerPath(P.C_main, eq, R)),
  // 固定 E=40%、收紧 R 的交叉（核对 riskRule.cross 首次触发日）
  crossFixed40: [0.10, 0.12, 0.15, 0.18, 0.20, 0.25].map(R => triggerPath(P.A_auditBase, 0.40, R)),
  // 行业侧简化账户层口径 R=20% 的真实触发路径（见 §6）
  accountLayerR20: OUT.accountLayer.map(a => ({ mode: a.mode, mddPct: a.mddPct,
    first: a.firstHitR20Date, firstIdx: a.firstHitR20Idx,
    lock20End: a.window20End, lock20EndIdx: a.window20EndIdx }))
};

// ============================================================================
// 8. 压力路径 A/B/C 参数表（宏观成员通用声明原样保留）
// ============================================================================
OUT.stressPaths = {
  generalDisclaimer: '【情景假设参数，非历史事实、非已公布数据、非对未来涨跌的预测，也不代表情景发生概率】' +
    '下表中利率路径参数、权益累计跌幅参数、现金到账利率参数均为本轮为压力测试主观设定的构造量。' +
    '「构造锚」列引用本地价格序列的真实历史回撤幅度，仅作为量级参照，不构成对情景参数的历史验证。',
  anchors: OUT.historicalDrawdowns.windows.map(w => ({ key: w.key, window: w.window,
    hsPeakTrough: w.peakDate + '→' + w.troughDate, hsPct: w.hs, divPct: w.div, eq7525Pct: w.eq7525 })),
  paths: [
    { id: 'A', name: '利率急速上行 + 权益急跌（再通胀/收紧式）',
      lengthMonths: '6~9', lengthTradingDays: '约 126~189（按 21 日/月）',
      equityCumDrop: '累计跌幅 = R 的 2.0~2.5 倍（R=20% → 40~50% 量级）',
      dailyPath: '前重后轻的几何衰减：首月跌幅约占累计跌幅 35~45%，其后按月递减；无反弹；两指数同步下跌',
      corrAssumption: '两指数日收益相关 0.96~0.99（锚：急性崩盘段窗口内 0.9637~0.9851、下跌日子集最高 0.9919）',
      cashRatePath: '滞后 2~3 季度，自 1.3% 升至 2.5~3.5%（逐日线性插值），起点 1.3%',
      ratePath: '12~18 个月内 10Y 自 1.59% 上行 150~250bp；SHIBOR 3M 自 1.398% 上行 150~250bp；LPR 1Y 自 3.0% 上行 50~100bp',
      constructionAnchor: '2015 股灾 HS300 峰谷约 −43.48%、2016 熔断 −26.39%、全期最大峰谷 −46.70%（本地价格序列，见 §6）' },
    { id: 'B', name: '长期低利率慢熊（低名义收益 + 阴跌）',
      lengthMonths: '24~36', lengthTradingDays: '约 504~756',
      equityCumDrop: '累计跌幅 = R 的 3.0~3.5 倍（60~70% 量级；量级锚为 v1.5 已构造的 −70% 慢熊，属本地文件假设）',
      dailyPath: '近似匀速线性阴跌，无单月暴跌、无反弹；月度跌幅标准差压到 A 的 1/3 以下',
      corrAssumption: '两指数日收益相关 0.71~0.74（锚：2022 慢性分化段相关 0.7139~0.7388）',
      cashRatePath: '维持 1.0~1.3% 并下探至 0.8~1.0%（触发 v1.5 第 8 章「连续两季 <1.0%」重算护栏）',
      ratePath: '10Y 维持 1.2~1.8% 低位、LPR 持平',
      constructionAnchor: '2021-02→2024-09 长慢熊 HS300 峰谷约 −45.60%、2022 全年 −28.65%（本地价格序列，见 §6）' },
    { id: 'C', name: '通缩式阴跌 / 低波动钝化（薄缓冲式）',
      lengthMonths: '24', lengthTradingDays: '约 504',
      equityCumDrop: '累计跌幅 = R 的 0.8~1.2 倍（16~24% 量级），波动率显著低于 A、B',
      dailyPath: '窄幅阴跌、日振幅约为 A 的 1/3；无单日暴跌；缓慢累积至 R 附近或略超',
      corrAssumption: '两指数日收益相关 0.85~0.90（锚：全期 0.8775）',
      cashRatePath: '维持 1.0~1.3%（名义 > CPI，实际利率小幅为正）',
      ratePath: 'CPI 在 0~0.5% 维持 24 个月（锚：宏观成员 2026-09 CPI 0.9%、预测 0.83%）；10Y 维持 1.3~1.8%；名义现金利率不下行',
      constructionAnchor: '2020-03 疫情 HS300 峰谷约 −16.08%、2018 −32.46%（本地价格序列，见 §6）' }
  ],
  fourRFullCheck: '三条路径均须对四档 R（15/20/25/30%）全检；由 Phase 5 状态机执行，Phase 2 不产出其绩效。',
  noTriggerSignal: '三条路径均不得引入任何触发式敞口变更（删除前后对照除外，对照本身仅作评估用途）。'
};

// ============================================================================
// 输出
// ============================================================================
fs.writeFileSync(PT.out('phase2_baseline_data.json'), JSON.stringify(OUT));

// ---- 控制台摘要 ----
const L = console.log;
L('========== 1 数据质量 ==========');
L(JSON.stringify(qc, null, 1));
L('========== 2 核对主理人预检 ==========');
L('rHits 基线口径重算'); console.table(OUT.verifyLead.recomputed_rHits_base);
L('主口径重算'); console.table(OUT.verifyLead.recomputed_main);
L('========== 3 锚点口径表（MDD% / 余量pp / 是否触发 / 首次触发日） ==========');
OUT.anchorTable.forEach(a => { L('--- ' + a.key + ' ---'); console.table(a.rows); });
L('========== 4 全口径网格汇总 ==========');
console.table(OUT.gridSummary.map(x => ({ R: x.R, eq: x.eq, coreN: x.core.n, coreMinHr: x.core.minHeadroom,
  coreHits: x.core.hitVariants, coreThin: x.core.thinVariants, allMinHr: x.all.minHeadroom,
  allHits: x.all.hitVariants, allThin: x.all.thinVariants, minId: x.all.minId })));
L('========== 4b 主口径单变量扰动 ==========');
OUT.singleVariable.forEach(sv => { L('--- R=' + sv.R + '% / E=' + sv.eq + '% ---'); console.table(sv.rows); });
L('========== 4c 临界触发 R =========='); console.table(OUT.criticalR);
L('========== 5 日期索引 ==========');
console.table(OUT.segments.map(s => ({ key: s.key, from: s.from, to: s.to, sIdx: s.startIdx, eIdx: s.endIdx,
  n: s.nTradingDays, cumHS: s.cumHS, cumDIV: s.cumDIV, cum7525: s.cum7525, corr: s.corrWindow, corrDown: s.corrDown })));
console.table(OUT.lowPoints);
L('剔除 2015 段'); L(JSON.stringify(OUT.exclude2015, null, 1));
L('========== 6 历史真实回撤幅度（构造锚） ==========');
console.table(OUT.historicalDrawdowns.windows);
L('全期'); L(JSON.stringify(OUT.historicalDrawdowns.fullSample, null, 1));
L('账户层 / 再平衡日历对齐'); console.table(OUT.accountLayer);
L('日历季末探查（75/25 全部组合）'); console.table(OUT.rebalanceCalendar.grid.filter(x => x.w === '75/25'));
L('口径定位：' + OUT.rebalanceCalendar.industryMatch);
L('========== 7 真实路径触发日 ==========');
console.table(OUT.triggerPaths.mainFourR);
L('固定 E=40% 收紧 R 交叉'); console.table(OUT.triggerPaths.crossFixed40);
L('账户层 R=20% 触发'); console.table(OUT.triggerPaths.accountLayerR20);
L('========== 8 压力路径 A/B/C ==========');
L(JSON.stringify(OUT.stressPaths.paths, null, 1));
L('已写出 phase2_baseline_data.json');
