// ============================================================================
// Phase 2 统一数据基线 · 可复用索引与函数（供 Phase 5 状态机直接 require）
// 作者：数据与回测工程师 袁据实 ｜ 2026-11-07
//
// 用法：
//   const B = require('./phase2_indices.js');
//   B.idxOf('2015-08-26')            → 1371
//   B.SEGMENTS.crash2015.startIdx    → 1315
//   B.rH(1371), B.rD(1371)          → 当日两指数涨跌幅（小数）
//   B.P_MAIN_OPT                    → v1.5 主口径完整 opt，可直接喂给 bt_final.js 的 mix()
//   B.BASE                          → phase2_baseline_data.json 全部预检结果
//
// 口径铁律：本模块只读本地价格/估值 JSON，不引入任何宏观读数或联网行业权重。
// 全部索引以 DATES（hs300_daily_2010_2026.json 的交易日历）为准，0-based。
// ============================================================================
const fs = require('fs');
const path = require('path');
const P = f => path.join(__dirname, f);

const kl = f => JSON.parse(fs.readFileSync(P(f), 'utf8')).data.klines.map(s => {
  const [d, c] = s.split(','); return { d, c: +c };
});
const A = kl('hs300_daily_2010_2026.json');    // 000300 沪深300，价格指数（不含股息）
const D = kl('csi_dividend_2010_2026.json');   // 000922 中证红利，价格指数（不含股息）
const N = A.length, DATES = A.map(x => x.d);
const V = require('./valuation_series.js');    // NeoData 半年度 34 点线性插值股息率

const idxOf = d => { const i = DATES.findIndex(x => x >= d); return i < 0 ? N - 1 : i; };
const rH = i => A[i].c / A[i - 1].c - 1;
const rD = i => D[i].c / D[i - 1].c - 1;
const rEq = i => 0.75 * rH(i) + 0.25 * rD(i);       // 权益内 75/25 每日重置
const corr = (xs, ys) => {
  const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const a = xs[i] - mx, b = ys[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
  return sxy / Math.sqrt(sxx * syy);
};
const mddOf = nav => { let pk = nav[0], m = 0; for (const v of nav) { if (v > pk) pk = v; const d = 1 - v / pk; if (d > m) m = d; } return m; };

// ---- 口径常量（与 bt_final.js / phase2_baseline.js 逐位一致） ----
const R2EQ = [[0.15, 0.30], [0.20, 0.40], [0.25, 0.50], [0.30, 0.55]];
const SEG_RATE = DATES.map(d => { const y = +d.slice(0, 4); return y <= 2014 ? 0.030 : y <= 2021 ? 0.023 : 0.013; });
const SEG_UP = SEG_RATE.map(r => r + 0.01), SEG_DN = SEG_RATE.map(r => r - 0.01);
const COST0 = { tradeFee: 0, slippage: 0, divTax: 0, execLag: 0 };
const COST_T0 = { tradeFee: 0.0005, slippage: 0.001, divTax: 0, execLag: 0 };
const COST_T1 = { tradeFee: 0.0005, slippage: 0.001, divTax: 0, execLag: 1 };
const COST_T1_TAX = { tradeFee: 0.0005, slippage: 0.001, divTax: 0.10, execLag: 1 };
const DIV_IN = { dyH: V.dyHS, dyD: V.dyHL }, DIV_OUT = { dyH: 0, dyD: 0 };
// v1.5 主口径（75/25 执行口径）—— Phase 5 状态机的默认输入基线
const P_MAIN_OPT = Object.assign({ eq: 0.40, w: 0.25, rebal: 'reset', interval: 63, cashRate: SEG_RATE }, COST_T1, DIV_IN);
const P_AUDIT_BASE = Object.assign({ eq: 0.40, w: 0.30, rebal: 'reset', interval: 63, cashRate: 0.025 }, COST0, DIV_IN);

// ---- 日历季末（3/6/9/12 月最后交易日）与 63 交易日近似 ----
const CAL_Q = [];
for (let i = 1; i < N; i++) {
  const m = +DATES[i].slice(5, 7);
  if ([3, 6, 9, 12].includes(m) && DATES[i + 1] && DATES[i + 1].slice(5, 7) !== DATES[i].slice(5, 7)) CAL_Q.push(i);
}
const Q63 = []; for (let i = 63; i < N; i += 63) Q63.push(i);
const quarterEndIndices = mode => mode === 'calQ' ? CAL_Q : Q63;

// ---- 预检结果（全部数字的唯一权威出处） ----
const BASE = JSON.parse(fs.readFileSync(P('phase2_baseline_data.json'), 'utf8'));
const SEGMENTS = Object.fromEntries(BASE.segments.map(s => [s.key, s]));
const LOW_POINTS = BASE.lowPoints;
const EXCLUDE_2015 = BASE.exclude2015;
const HIST_DD = BASE.historicalDrawdowns;

module.exports = {
  N, DATES, A, D, V, idxOf, rH, rD, rEq, corr, mddOf,
  R2EQ, SEG_RATE, SEG_UP, SEG_DN, COST0, COST_T0, COST_T1, COST_T1_TAX, DIV_IN, DIV_OUT,
  P_MAIN_OPT, P_AUDIT_BASE, CAL_Q, Q63, quarterEndIndices,
  BASE, SEGMENTS, LOW_POINTS, EXCLUDE_2015, HIST_DD
};
