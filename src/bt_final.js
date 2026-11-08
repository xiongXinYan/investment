// 最终方案独立审计数据包 v1（2026-11-07）
// 目标：v1.4 用「择时增量 0.03pp、bootstrap 跨零」砍掉整个择时层，却保留了
//       70/30 相对单资产 +0.47pp 的配置倾斜，后者从未做过同等强度的证伪。
// 本脚本只做「常数敞口 + 双资产 + 季度再平衡」这一最终方案本身，不碰择时规则。
// 所有数字从本地价格/估值序列重算，不含手工填写的结论。
const fs = require('fs');
const PT = require('../lib/paths.js');
const V = require('./valuation_series.js');

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

// 常数敞口组合。rebal:
//   'frozen' = 现行 bt_extended.js mixReal：份额同比例缩放，权益内比例冻结（实现缺陷）
//   'reset'  = 文档口径：每季度把权益内市值比例重置回 70/30
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
const TWO = x => +Number(x).toFixed(2);

// ============ 1. 再平衡口径：现行冻结 vs 文档 70/30 ============
const rebalance = [0.30, 0.40, 0.50, 0.55].map(eq => {
  const f = mix({ eq, rebal: 'frozen' }), r = mix({ eq, rebal: 'reset' });
  return { eq: TWO(eq * 100), frozenCagr: f.m.cagr, frozenMdd: f.m.mdd, frozenEndW: TWO(f.endWeight),
    resetCagr: r.m.cagr, resetMdd: r.m.mdd, resetEndW: TWO(r.endWeight),
    dCagr: TWO(r.m.cagr - f.m.cagr), dMdd: TWO(r.m.mdd - f.m.mdd) };
});

// ============ 2. 权重扫描 + 分段（配置倾斜是否只是近期赢家） ============
const WS = [0, 0.10, 0.20, 0.25, 0.30, 0.35, 0.419, 0.50, 0.75, 1.0];
const SEGS = [[0, 1007, '2010-01~2014-01'], [1008, 2015, '2014-01~2018-01'],
              [2016, 3023, '2018-01~2022-01'], [3024, N - 1, '2022-01~2026-11']];
const PHASES = [[0, idxOf('2015-03-19') - 1, '2010-01~2015-03'],
                [idxOf('2015-03-19'), idxOf('2020-05-20') - 1, '2015-03~2020-05'],
                [idxOf('2020-05-20'), N - 1, '2020-05~2026-11']];
const weightScan = WS.map(w => {
  const full = mix({ w }).m;
  return { w: TWO(w * 100), cagr: full.cagr, mdd: full.mdd,
    segs: SEGS.map(([s, e]) => mix({ w, S: s, E: e }).m.cagr),
    phases: PHASES.map(([s, e]) => mix({ w, S: s, E: e }).m.cagr) };
});
// 40% 敞口下 70/30 相对单资产的收益归因：价格序列 vs 股息率差
const attrBase = mix({ w: 0 }).m.cagr;
const attrPriceOnly = mix({ w: 0.30, dyD: V.dyHS }).m.cagr;   // 红利股息率=沪深300
const attrFull = mix({ w: 0.30 }).m.cagr;
const attribution = {
  single: attrBase, priceOnly: attrPriceOnly, full: attrFull,
  totalGain: TWO(attrFull - attrBase), priceGain: TWO(attrPriceOnly - attrBase),
  divGain: TWO(attrFull - attrPriceOnly),
  divShare: TWO((attrFull - attrPriceOnly) / (attrFull - attrBase) * 100)
};

// ============ 3. 同等强度证伪：bootstrap / 起点 / 窗口 / 分段 ============
function boot(d, Bn = 2000, block = 20) {
  let sd = 20261107;
  const rr = () => { sd = (sd * 1664525 + 1013904223) >>> 0; return sd / 4294967296; };
  const n = d.length, out = [];
  for (let b = 0; b < Bn; b++) {
    let s = 0, cnt = 0;
    while (cnt < n) { const st = Math.floor(rr() * n), len = Math.min(block, n - cnt); for (let k = 0; k < len; k++) { s += d[(st + k) % n]; cnt++; } }
    out.push(s / n * 252);
  }
  out.sort((a, b) => a - b);
  return { lo: TWO(out[50] * 100), median: TWO(out[1000] * 100), hi: TWO(out[1950] * 100),
    pos: TWO(out.filter(x => x > 0).length / Bn * 100) };
}
const navBase = mix({ w: 0 }).nav, navTilt = mix({ w: 0.30 }).nav;
const diff = [];
for (let i = 1; i < navBase.length; i++) diff.push(navTilt[i] / navTilt[i - 1] - 1 - (navBase[i] / navBase[i - 1] - 1));
const bootstrap = boot(diff);

const START_DATES = ['2010-01-04', '2013-01-04', '2016-01-04', '2019-01-04'];
const starts = START_DATES.map(d => {
  const s = idxOf(d);
  return { start: d, single: mix({ w: 0, S: s }).m.cagr, tilt: mix({ w: 0.30, S: s }).m.cagr,
    edge: TWO(mix({ w: 0.30, S: s }).m.cagr - mix({ w: 0, S: s }).m.cagr) };
});
const windows = [[0, 1259], [1260, 2519], [2520, 3779]].map(([s, e]) => ({
  period: DATES[s] + '~' + DATES[e], single: mix({ w: 0, S: s, E: e }).m.cagr,
  tilt: mix({ w: 0.30, S: s, E: e }).m.cagr,
  edge: TWO(mix({ w: 0.30, S: s, E: e }).m.cagr - mix({ w: 0, S: s, E: e }).m.cagr)
}));
const segs = SEGS.map(([s, e, name]) => ({
  period: name + ' (' + DATES[s] + '~' + DATES[e] + ')',
  single: mix({ w: 0, S: s, E: e }).m.cagr, tilt: mix({ w: 0.30, S: s, E: e }).m.cagr,
  edge: TWO(mix({ w: 0.30, S: s, E: e }).m.cagr - mix({ w: 0, S: s, E: e }).m.cagr)
}));

// ============ 4. 样本外：把「红利权重 w」当作可调参数做 walk-forward ============
const WCANDS = [0, 0.10, 0.20, 0.30, 0.419, 0.60, 1.0];
const folds = [];
for (let s = 0; s + 1260 + 630 <= N; s += 630) {
  const tr = [s, s + 1259], te = [s + 1260, s + 1889];
  let best = null;
  for (const w of WCANDS) {
    const c = mix({ w, S: tr[0], E: tr[1] }).m.cagr;
    if (!best || c > best.cagr) best = { w, cagr: c };
  }
  const oosBest = mix({ w: best.w, S: te[0], E: te[1] }).m.cagr;
  const oos30 = mix({ w: 0.30, S: te[0], E: te[1] }).m.cagr;
  const oos0 = mix({ w: 0, S: te[0], E: te[1] }).m.cagr;
  folds.push({ train: DATES[tr[0]] + '~' + DATES[tr[1]], test: DATES[te[0]] + '~' + DATES[te[1]],
    picked: TWO(best.w * 100), trainCagr: best.cagr, oosBest, oos30, oos0,
    edgePickedVs30: TWO(oosBest - oos30), edge30Vs0: TWO(oos30 - oos0) });
}
const walkForward = { folds, summary: {
  n: folds.length, picks: [...new Set(folds.map(f => f.picked))],
  bestBeats30: folds.filter(f => f.edgePickedVs30 > 0).length,
  tiltBeatsSingle: folds.filter(f => f.edge30Vs0 > 0).length,
  avgEdge30Vs0: TWO(folds.reduce((a, f) => a + f.edge30Vs0, 0) / folds.length)
} };

// ============ 5. 执行成本与口径 realism ============
const COST_CASES = [
  { name: '现行基线（无交易费/税/滑点、当日成交、现金 2.5%）', o: {} },
  { name: '+ 季度再平衡双边费 5bp', o: { tradeFee: 0.0005 } },
  { name: '+ 滑点 10bp', o: { tradeFee: 0.0005, slippage: 0.001 } },
  { name: '+ 股息税 10%（持股 1 月~1 年）', o: { divTax: 0.10 } },
  { name: '+ 股息税 20%（持股 1 月内）', o: { divTax: 0.20 } },
  { name: '+ 次日成交（T+1 收盘）', o: { execLag: 1 } },
  { name: '现金收益 1.5%', o: { cashRate: 0.015 } },
  { name: '现金收益 2.0%', o: { cashRate: 0.020 } },
  { name: '现金收益 3.5%', o: { cashRate: 0.035 } },
  { name: '全成本叠加（费+滑点+税10%+T+1+现金2.0%）',
    o: { tradeFee: 0.0005, slippage: 0.001, divTax: 0.10, execLag: 1, cashRate: 0.020 } }
];
const baseCagr = mix({}).m.cagr;
const costs = COST_CASES.map(c => {
  const r = mix(c.o);
  return { name: c.name, cagr: r.m.cagr, mdd: r.m.mdd, dCagr: TWO(r.m.cagr - baseCagr),
    rebalCount: r.rebalCount, turnover: TWO(r.turnover), cost: TWO(r.feePaid + r.taxPaid) };
});
// 现金利率敏感性（供宏观成员结论落地时查表）
const cashSens = [0.005, 0.010, 0.015, 0.020, 0.025, 0.030, 0.035, 0.040].map(r => ({
  rate: TWO(r * 100), cagr: mix({ cashRate: r }).m.cagr, dCagr: TWO(mix({ cashRate: r }).m.cagr - baseCagr)
}));

// ============ 6. R 减半条款：真实历史里到底触发过没有 ============
function rHits(eq, R) {
  const nav = mix({ eq, rebal: 'reset' }).nav;
  let pk = nav[0], hit = 0, first = null, maxDd = 0;
  for (let i = 0; i < nav.length; i++) {
    if (nav[i] > pk) pk = nav[i];
    const dd = 1 - nav[i] / pk; if (dd > maxDd) maxDd = dd;
    if (!hit && dd >= R) { hit = 1; first = DATES[i]; }
  }
  return { eq: TWO(eq * 100), R: TWO(R * 100), mdd: TWO(maxDd * 100),
    headroom: TWO((R - maxDd) * 100), hits: hit, first };
}
const riskRule = {
  table: [[0.30, 0.15], [0.40, 0.20], [0.50, 0.25], [0.55, 0.30]].map(([eq, R]) => rHits(eq, R)),
  // 交叉：固定 40% 敞口，把 R 收紧，看什么时候才会触发
  cross: [0.10, 0.12, 0.15, 0.18, 0.20, 0.25].map(R => rHits(0.40, R))
};

// ============ 7. 增益是否被成本吃掉 / 反事实 / bootstrap 块长稳健性 ============
const FULL_COST = { tradeFee: 0.0005, slippage: 0.001, divTax: 0.10, execLag: 1, cashRate: 0.020 };
const costEdge = [
  { name: '基线口径', o: {} },
  { name: '全成本叠加', o: FULL_COST },
  { name: '现金收益 1.5%', o: { cashRate: 0.015 } },
  { name: '全成本 + 现金 1.5%', o: Object.assign({}, FULL_COST, { cashRate: 0.015 }) }
].map(c => {
  const tilt = mix(Object.assign({}, c.o, { w: 0.30 })).m.cagr;
  const single = mix(Object.assign({}, c.o, { w: 0 })).m.cagr;
  return { name: c.name, tilt, single, edge: TWO(tilt - single) };
});

// 反事实：把中证红利的价格序列替换掉，只保留真实股息率差
function edgeUnder(prices) {
  const bak = D.map(x => x.c);
  prices.forEach((v, i) => { D[i].c = v; });
  const tilt = mix({ w: 0.30 }).m.cagr, single = mix({ w: 0 }).m.cagr;
  bak.forEach((v, i) => { D[i].c = v; });
  return { tilt, single, edge: TWO(tilt - single) };
}
const kCut = idxOf('2020-05-20');
const cfAfter = D.map((x, i) => i < kCut ? x.c : D[kCut - 1].c * (A[i].c / A[kCut - 1].c));
const counterfactual = [
  { name: '真实历史（对照）', ...edgeUnder(D.map(x => x.c)) },
  { name: '2020-05 后红利价格改为跟随沪深300（剔除近期价格超额）', ...edgeUnder(cfAfter) },
  { name: '全期两指数价格完全相同（只剩股息率差）', ...edgeUnder(A.map(x => x.c)) }
];
const bootRobust = [5, 10, 20, 40, 60].map(b => ({ block: b, ...boot(diff, 2000, b) }));

// ============ 8. 现金利率情景（宏观策略师口径落地，可本地复现） ============
// 三段式：2010-14 3.0% / 2015-21 2.3% / 2022-26 1.3%（货基近似，成员联网检索 2026-11-07）
const SEG_RATE = DATES.map(d => { const y = +d.slice(0, 4); return y <= 2014 ? 0.030 : y <= 2021 ? 0.023 : 0.013; });
const baseM = mix({}).m;
const cashScenarios = [
  { name: '现行常数 2.5%（基线）', o: {} },
  { name: '三段式 3.0% / 2.3% / 1.3%（货基近似）', o: { cashRate: SEG_RATE } },
  { name: '前瞻基准 1.3%（全期）', o: { cashRate: 0.013 } },
  { name: '定存口径下界 2.0%（全期）', o: { cashRate: 0.020 } },
  { name: '货基口径上界 3.0%（全期）', o: { cashRate: 0.030 } }
].map(c => {
  const m = mix(c.o).m;
  return { name: c.name, cagr: m.cagr, mdd: m.mdd,
    dCagr: TWO(m.cagr - baseM.cagr), dMdd: TWO(m.mdd - baseM.mdd) };
});
const mddOf = nav => { let pk = nav[0], m = 0; for (const v of nav) { if (v > pk) pk = v; const d = 1 - v / pk; if (d > m) m = d; } return TWO(m * 100); };
const cashMddSegs = SEGS.map(([s, e, name]) => {
  const b = mix({}).nav.slice(s, e + 1), t = mix({ cashRate: SEG_RATE }).nav.slice(s, e + 1);
  const bm = mddOf(b), tm = mddOf(t);
  return { period: name, baseMdd: bm, segMdd: tm, d: TWO(tm - bm) };
});

// ============ 9. v1.5 主口径 R→敞口表 ============
// 主口径：分段真实利率 + 真 70/30 季度再平衡 + 双边费/滑点 + T+1 成交。
// 股息税不进主口径（ETF/场外指数基金层面已扣，不重复计），另列含税保守值。
const V15 = { cashRate: SEG_RATE, rebal: 'reset', tradeFee: 0.0005, slippage: 0.001, execLag: 1 };
// 沿用 v1.4 的四档 E，只更新口径数字；不因为口径变化借机抬高敞口。
const v15Table = [[0.15, 0.30], [0.20, 0.40], [0.25, 0.50], [0.30, 0.55]].map(([R, eq]) => {
  const m = mix(Object.assign({}, V15, { eq })).m;
  const taxM = mix(Object.assign({}, V15, { eq, divTax: 0.10 })).m;
  const old = mix({ eq }).m;
  return { R: TWO(R * 100), eq: TWO(eq * 100), cagr: m.cagr, mdd: m.mdd,
    pass: m.mdd / 100 <= R, headroom: TWO(R * 100 - m.mdd),
    taxCagr: taxM.cagr, taxMdd: taxM.mdd, oldCagr: old.cagr, oldMdd: old.mdd };
});

// ============ 10. 相对估值重估：红利/沪深300 折价是否收敛 ============
// 估值定价师核心论证：+0.48pp 中约 2/3 来自一次性相对重估，且折价已收敛、未来难重复。
// 本段用本地 valuation_semiannual_2010_2026.json（34 个半年度观测）独立复现。
const REPR = V.obs.map(o => ({
  d: o.d,
  peR: +(o.hl[0] / o.hs[0]).toFixed(4),
  pbR: +(o.hl[1] / o.hs[1]).toFixed(4),
  spread: +((o.hl[2] - o.hs[2]) * 100).toFixed(1)   // bp
}));
const rankOf = (arr, v) => +(arr.filter(x => x <= v).length / arr.length * 100).toFixed(1);
const peArr = REPR.map(r => r.peR), pbArr = REPR.map(r => r.pbR);
const lastR = REPR[REPR.length - 1], trough = REPR.reduce((a, b) => a.peR < b.peR ? a : b);
const peak = REPR.reduce((a, b) => a.spread > b.spread ? a : b);
const pre = REPR.filter(r => r.d < '2020-01-01'), post = REPR.filter(r => r.d >= '2020-01-01');
const regime = a => ({ n: a.length, avgSpread: TWO(a.reduce((x, y) => x + y.spread, 0) / a.length),
  pctAbove150: TWO(a.filter(r => r.spread >= 150).length / a.length * 100) });
const valuationRepricing = {
  series: REPR,
  summary: {
    obs: REPR.length, from: REPR[0].d, to: lastR.d,
    peAvg: TWO(peArr.reduce((a, b) => a + b, 0) / peArr.length), peNow: lastR.peR, pePct: rankOf(peArr, lastR.peR),
    pbAvg: TWO(pbArr.reduce((a, b) => a + b, 0) / pbArr.length), pbNow: lastR.pbR, pbPct: rankOf(pbArr, lastR.pbR),
    trough: { d: trough.d, peR: trough.peR, pbR: trough.pbR },
    peGainFromTrough: TWO((lastR.peR / trough.peR - 1) * 100),
    pbGainFromTrough: TWO((lastR.pbR / trough.pbR - 1) * 100),
    peakSpread: { d: peak.d, bp: peak.spread }, spreadNow: lastR.spread,
    regimePre2020: regime(pre), regimePost2020: regime(post)
  }
};

// ============ 11. v1.5 最终执行口径：权益内 75/25 ============
// 风险诊断师更正输入后重新收口：30% → 25%（单点、主动硬上限 25%）。
// 第 1~8 节的审计检验对象仍是 v1.4 的 70/30（不改历史结论）；本节只给新执行口径的数字。
const W_FINAL = 0.25;
const fpMain = o => mix(Object.assign({}, V15, { w: W_FINAL }, o || {})).m;
const finalPlan = {
  w: 25, auditW: 30,
  base: mix({ w: W_FINAL }).m,
  main: fpMain(),
  full: mix(Object.assign({}, V15, { w: W_FINAL, divTax: 0.10 })).m,
  single: mix(Object.assign({}, V15, { w: 0 })).m,
  audit70: mix(Object.assign({}, V15, { w: 0.30 })).m,
  edgeVsSingle: TWO(fpMain().cagr - mix(Object.assign({}, V15, { w: 0 })).m.cagr),
  dCagrVs70: TWO(fpMain().cagr - mix(Object.assign({}, V15, { w: 0.30 })).m.cagr),
  rebalWeight: {
    frozen: TWO(mix({ eq: 0.40, w: W_FINAL, rebal: 'frozen' }).endWeight),
    reset: TWO(mix({ eq: 0.40, w: W_FINAL, rebal: 'reset' }).endWeight)
  },
  table: [[0.15, 0.30], [0.20, 0.40], [0.25, 0.50], [0.30, 0.55]].map(([R, eq]) => {
    const m = mix(Object.assign({}, V15, { eq, w: W_FINAL })).m;
    const tax = mix(Object.assign({}, V15, { eq, w: W_FINAL, divTax: 0.10 })).m;
    const old = mix({ eq, w: 0.30 }).m;
    const w70 = mix(Object.assign({}, V15, { eq, w: 0.30 })).m;
    return { R: TWO(R * 100), eq: TWO(eq * 100), cagr: m.cagr, mdd: m.mdd,
      pass: m.mdd / 100 <= R, headroom: TWO(R * 100 - m.mdd),
      taxCagr: tax.cagr, taxMdd: tax.mdd, oldCagr: old.cagr, oldMdd: old.mdd,
      dVs70: TWO(m.cagr - w70.cagr) };
  })
};

const out = {
  generated: '2026-11-07',
  engine: 'bt_final.js v1（常数敞口双资产，独立于择时引擎）',
  sample: { from: DATES[0], to: DATES[N - 1], days: N, cashRateConst: 2.5, feeAnn: 0.5,
    rebalIntervalDays: 63, note: '季度再平衡以 63 个交易日近似，非日历季度末；成交按当日收盘价' },
  rebalance, weightScan, attribution, segLabels: SEGS.map(x => x[2]), phaseLabels: PHASES.map(x => x[2]),
  bootstrap, starts, windows, segs, walkForward, costs, cashSens, riskRule,
  costEdge, counterfactual, bootRobust, cashScenarios, cashMddSegs, v15Table, valuationRepricing, finalPlan
};
fs.writeFileSync(PT.out('final_audit_data.json'), JSON.stringify(out));

console.log('=== 1 再平衡口径 ==='); console.table(out.rebalance);
console.log('=== 2 权重扫描（年化%） ===');
console.table(out.weightScan.map(x => ({ '红利权重%': x.w, 全期: x.cagr, ...Object.fromEntries(x.phases.map((p, i) => [out.phaseLabels[i], p])) })));
console.log('归因', JSON.stringify(out.attribution));
console.log('=== 3 bootstrap ===', JSON.stringify(out.bootstrap));
console.log('起点'); console.table(out.starts);
console.log('不重叠窗口'); console.table(out.windows);
console.log('分段'); console.table(out.segs);
console.log('=== 4 walk-forward ==='); console.table(out.walkForward.folds);
console.log('汇总', JSON.stringify(out.walkForward.summary));
console.log('=== 5 成本 ==='); console.table(out.costs);
console.log('现金敏感性'); console.table(out.cashSens);
console.log('=== 6 R 触发 ==='); console.table(out.riskRule.table);
console.log('R 收紧交叉'); console.table(out.riskRule.cross);
