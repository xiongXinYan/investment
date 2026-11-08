// 生成回测数据包 v2（2026-11-07）
// 主口径 = v1.2 现行规则（756 日条件清 + 1260 日硬清）；保留 v1.1 旧口径作对照。
// 新增：规则差异、收益归因、起点/独立窗口稳健性、参数 ±30% 敏感性、成本敏感性、
//       周期口径对照、匹配敞口基准敏感性、block bootstrap 显著性。
// 所有字段名与 bt_report.js 兼容。
const fs = require('fs');
const B = require('./bt_engine.js');
const { simulate, bh, met, PX, N, BASE } = B;

const MAIN = { anchor: 'lastTx' };
const S = simulate(MAIN);
const navS = S.navs, navBH = bh(1, 0, N - 1, false), nav6040 = bh(0.6, 0, N - 1, true);
const navCore = bh(0.22, 0, N - 1, true), navCoreNR = bh(0.22, 0, N - 1, false);
const navMatch = bh(S.avgExp, 0, N - 1, true);
const mS = met(navS), mMatch = met(navMatch);
const edge = (a, b) => +(a - b).toFixed(4);
const pct = x => +(x * 100).toFixed(2);

// 年度
const yearEnd = {};
for (let i = 0; i < N; i++) yearEnd[PX[i].dt.slice(0, 4)] = i;
const ys = Object.keys(yearEnd).sort();
const ann = [];
ys.forEach((y, k) => {
  const e = yearEnd[y], b = k === 0 ? null : yearEnd[ys[k - 1]];
  const f = (arr) => b === null ? arr[e] / arr[0] - 1 : arr[e] / arr[b] - 1;
  ann.push({ y, str: f(navS), bh: f(navBH), s60: f(nav6040), core: f(navCore),
    idx: b === null ? PX[e].c / PX[0].c - 1 : PX[e].c / PX[b].c - 1,
    exp: S.expo.slice(b === null ? 0 : b + 1, e + 1).reduce((a, v) => a + v, 0) / (e - (b === null ? 0 : b)) });
});

// 滚动 5 年（重叠窗口，仅作路径展示，不用于统计推断）
const roll = [];
for (let s = 0; s + 252 * 5 < N; s += 10) {
  const e = s + 252 * 5 - 1;
  const st = simulate(MAIN, s, e);
  const a = met(st.navs).cagr, b = met(bh(1, s, e, false)).cagr;
  const c = met(bh(0.6, s, e, true)).cagr;
  roll.push({ s: PX[s].dt, e: PX[e].dt, a, b, c, d: a - b });
}

// 逐周期
const cyc = S.cycles.map(c => {
  const b = bh(1, c.startIdx, c.endIdx, false);
  const bu = S.trades.filter(t => t.dt >= c.start && t.dt <= PX[c.endIdx].dt).length;
  return { start: c.start, end: c.end, H: c.H, dd: c.peakD, bu,
    str: S.navs[c.endIdx] / S.navs[c.startIdx] - 1,
    idx: b[b.length - 1] / b[0] - 1,
    yrs: (c.endIdx - c.startIdx) / 252 };
});

// 卖出规则变体（名称保持与 bt_report.js 的查找前缀一致）
const VAR = [
  ['不修改（v1.2 现行规则）', {}],
  ['取消时间退出', { useTime: false }],
  ['取消固定止盈（只留移动退出）', { useTP: false }],
  ['取消移动退出', { useTrail: false }],
  ['取消全部卖出', { useTP: false, useTime: false, useTrail: false }],
  ['止盈档改为 15/25/40', { tp: [0.15, 0.25, 0.40] }],
  ['入场仍锚定上一笔买价（v1.1 字面）', { anchor: 'lastBuy' }]
];
const variants = VAR.map(([n, o]) => {
  const r = simulate(Object.assign({ anchor: 'lastTx' }, o)), m = met(r.navs);
  return { n, cagr: m.cagr, mdd: m.mdd, calmar: m.calmar, sharpe: m.sharpe, exp: r.avgExp, buys: r.trades.length, tot: m.total };
});

// ---- 新增 1：规则版本差异 ----
const ruleDiff = [
  ['v1.1 旧口径（756 日无条件强清）', { timeRule: 'v11' }],
  ['v1.2 现行规则', {}],
  ['文档 8.2 周期口径', { cycleEndMode: 'rules' }],
  ['交易费用 ×3', { costMult: 3 }]
].map(([n, o]) => {
  const r = simulate(o), m = met(r.navs), cm = met(bh(r.avgExp, 0, N - 1, true));
  return { n, cagr: pct(m.cagr), mdd: pct(m.mdd), exp: pct(r.avgExp), match: pct(cm.cagr),
    edge: pct(m.cagr - cm.cagr), buys: r.trades.length, lots: r.closedLots.length,
    risk: r.riskEvents.length };
});

// ---- 新增 2：股息率假设敏感性（原「ERP 假设」，实为 divYield） ----
const sens = [];
[0.025, 0.045, 0.065, 0.085].forEach(dy => {
  BASE.divYield = dy;
  const s2 = simulate(MAIN), m = met(s2.navs);
  const cm = met(bh(s2.avgExp, 0, N - 1, true));
  sens.push({ divYield: dy, carry: dy - BASE.feeAnn, strat: m.cagr, match: cm.cagr,
    full: met(bh(1, 0, N - 1, false)).cagr, s60: met(bh(0.6, 0, N - 1, true)).cagr,
    edge: m.cagr - cm.cagr });
});
BASE.divYield = 0.025;

// 采样序列（每 5 个交易日）
const step = 5;
const ser = { d: [], s: [], b: [], c: [], k: [], x: [], e: [] };
for (let i = 0; i < N; i += step) {
  ser.d.push(PX[i].dt); ser.s.push(+navS[i].toFixed(4)); ser.b.push(+navBH[i].toFixed(4));
  ser.c.push(+nav6040[i].toFixed(4)); ser.k.push(+navCore[i].toFixed(4));
  ser.x.push(+(PX[i].c / PX[0].c).toFixed(4)); ser.e.push(+S.expo[i].toFixed(3));
}
ser.d.push(PX[N - 1].dt); ser.s.push(+navS[N - 1].toFixed(4)); ser.b.push(+navBH[N - 1].toFixed(4));
ser.c.push(+nav6040[N - 1].toFixed(4)); ser.k.push(+navCore[N - 1].toFixed(4));
ser.x.push(+(PX[N - 1].c / PX[0].c).toFixed(4)); ser.e.push(+S.expo[N - 1].toFixed(3));

// ---- 新增 3：标的对照 + 2×2 归因分解 ----
const HLraw = JSON.parse(fs.readFileSync('csi_dividend_2010_2026.json', 'utf8'));
const HL = HLraw.data.klines.map(s => { const [dt, c] = s.split(','); return { dt, c: +c }; });
const hs300Px = PX.map(x => ({ dt: x.dt, c: x.c }));
const setPx = arr => { PX.length = 0; arr.forEach(x => PX.push(x)); };
const runAt = (arr, dy) => {
  setPx(arr); BASE.divYield = dy;
  const r = simulate(MAIN), m = met(r.navs), cm = met(bh(r.avgExp, 0, N - 1, true));
  return { cagr: m.cagr, mdd: m.mdd, exp: r.avgExp, match: cm.cagr, edge: m.cagr - cm.cagr, buys: r.trades.length };
};
const A = runAt(hs300Px, 0.025), Bx = runAt(hs300Px, 0.045);
const C = runAt(HL, 0.025), D4 = runAt(HL, 0.045);
setPx(hs300Px); BASE.divYield = 0.025;

const assetComp = [
  { name: '沪深300', div: 0.025, strat: A.cagr, match: A.match, s60: met(bh(0.6, 0, N - 1, true)).cagr,
    bh: met(bh(1, 0, N - 1, false)).cagr, core: met(bh(0.22, 0, N - 1, true)).cagr,
    ddS: A.mdd, ddM: met(bh(A.exp, 0, N - 1, true)).mdd, exp: A.exp },
  { name: '中证红利', div: 0.045, strat: D4.cagr, match: D4.match, s60: met(bh(0.6, 0, N - 1, true)).cagr,
    bh: met(bh(1, 0, N - 1, false)).cagr, core: met(bh(0.22, 0, N - 1, true)).cagr,
    ddS: D4.mdd, ddM: met(bh(D4.exp, 0, N - 1, true)).mdd, exp: D4.exp }
];
const attribution = {
  cells: [
    { name: '沪深300 + 股息 2.5%', ...A }, { name: '沪深300 + 股息 4.5%（只改假设）', ...Bx },
    { name: '红利 + 股息 2.5%（只改序列）', ...C }, { name: '红利 + 股息 4.5%（报告口径）', ...D4 }
  ].map(o => ({ name: o.name, cagr: pct(o.cagr), mdd: pct(o.mdd), match: pct(o.match), edge: pct(o.edge), buys: o.buys })),
  total: pct(D4.cagr - A.cagr), fromAssumption: pct(Bx.cagr - A.cagr),
  fromPrice: pct(C.cagr - A.cagr), interaction: pct((D4.cagr - C.cagr) - (Bx.cagr - A.cagr)),
  assumptionShare: +(((Bx.cagr - A.cagr) / (D4.cagr - A.cagr)) * 100).toFixed(0)
};

// ---- 新增 4：起点敏感性 ----
const starts = ['2010-01-04', '2013-01-04', '2016-01-04', '2019-01-04'].map(y => {
  const s = PX.findIndex(x => x.dt >= y);
  const r = simulate(MAIN, s, N - 1), a = met(r.navs).cagr, c = met(bh(r.avgExp, s, N - 1, true)).cagr;
  return { start: PX[s].dt, cagr: pct(a), match: pct(c), edge: pct(a - c), mdd: pct(met(r.navs).mdd) };
});

// ---- 新增 5：不重叠 5 年窗口（独立样本） ----
const indep = [];
for (let s = 0; s + 1260 <= N; s += 1260) {
  const e = Math.min(s + 1259, N - 1);
  const r = simulate(MAIN, s, e), a = met(r.navs).cagr, c = met(bh(r.avgExp, s, e, true)).cagr;
  indep.push({ s: PX[s].dt, e: PX[e].dt, cagr: pct(a), match: pct(c), edge: pct(a - c), bh: pct(met(bh(1, s, e, false)).cagr) });
}

// ---- 新增 6：参数 ±30% 敏感性网格 ----
const scale = [0.7, 1.0, 1.3];
const paramGrid = [
  { name: '入场回撤阈值 15/25/35%', opts: scale.map(k => ({ k, o: { stageDrops: [0.15, 0.25, 0.35].map(x => +(x * k).toFixed(4)) } })) },
  { name: '止盈档 12/20/28%', opts: scale.map(k => ({ k, o: { tp: [0.12, 0.20, 0.28].map(x => +(x * k).toFixed(4)) } })) },
  { name: '移动退出 15/22%', opts: scale.map(k => ({ k, o: { trail1: +(0.15 * k).toFixed(4), trail2: +(0.22 * k).toFixed(4) } })) },
  { name: '买入跌幅门槛 5%', opts: scale.map(k => ({ k, o: { drop: +(0.05 * k).toFixed(4) } })) },
  { name: '每笔规模 6%', opts: scale.map(k => ({ k, o: { size: +(6 * k).toFixed(2) } })) },
  { name: '时间退出 504/756/1260 日', opts: scale.map(k => ({ k, o: { t504: Math.round(504 * k), t756: Math.round(756 * k), t1260: Math.round(1260 * k) } })) }
].map(g => ({ name: g.name, vals: g.opts.map(({ k, o }) => {
  const r = simulate(Object.assign({ anchor: 'lastTx' }, o)), m = met(r.navs);
  return { k, cagr: pct(m.cagr), mdd: pct(m.mdd), buys: r.trades.length };
}) }));

// ---- 新增 7：交易成本敏感性 ----
const costSens = [1, 2, 3, 5].map(k => {
  const r = simulate({ costMult: k }), m = met(r.navs);
  return { k, cagr: pct(m.cagr), mdd: pct(m.mdd) };
});

// ---- 新增 8：周期口径对照 ----
const cycleCompare = [
  { name: 'p > H 结束（旧引擎）', o: { cycleEndMode: 'newhigh' } },
  { name: '机动仓清空结束（文档 8.2）', o: { cycleEndMode: 'rules' } }
].map(x => {
  const r = simulate(x.o), m = met(r.navs);
  return { name: x.name, cagr: pct(m.cagr), mdd: pct(m.mdd), cycles: r.cycles.length, buys: r.trades.length };
});

// ---- 新增 9：匹配敞口基准的设定敏感性 ----
const benchSens = [0.30, 0.35, 0.40, S.avgExp, 0.50, 0.55].map(e => {
  const m = met(bh(e, 0, N - 1, true));
  return { eq: pct(e), cagr: pct(m.cagr), mdd: pct(m.mdd) };
});

// ---- 新增 10：block bootstrap（策略 − 同敞口常数，年化差） ----
function bootstrap(d, Bn = 1000, block = 20) {
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const n = d.length, out = [];
  for (let b = 0; b < Bn; b++) {
    let s = 0, cnt = 0;
    while (cnt < n) {
      const st = Math.floor(rnd() * n), len = Math.min(block, n - cnt);
      for (let k = 0; k < len; k++) { s += d[(st + k) % n]; cnt++; }
    }
    out.push(s / n * 252);
  }
  out.sort((a, b) => a - b);
  return { mean: +(out.reduce((a, b) => a + b) / Bn * 100).toFixed(2),
    lo: +(out[Math.floor(Bn * 0.025)] * 100).toFixed(2),
    hi: +(out[Math.floor(Bn * 0.975)] * 100).toFixed(2),
    posRate: +(out.filter(x => x > 0).length / Bn * 100).toFixed(0) };
}
const dailyDiff = [];
for (let i = 1; i < navS.length; i++) dailyDiff.push(navS[i] / navS[i - 1] - navMatch[i] / navMatch[i - 1]);
const boot = bootstrap(dailyDiff);

const out = {
  engine: 'v4 / v1.2 现行规则', period: [PX[0].dt, PX[N - 1].dt],
  assetComp, attribution, ruleDiff, starts, indep, paramGrid, costSens, cycleCompare, benchSens, boot,
  metrics: { strat: mS, bh: met(navBH), s60: met(nav6040), core: met(navCore), coreNR: met(navCoreNR), match: mMatch },
  avgExp: S.avgExp, ann, roll, cyc, variants, sens, ser,
  cycles: S.cycles.map(c => ({ start: c.start, end: c.end, H: c.H, dd: c.peakD })),
  byEx: (() => { const o = {}; S.closedLots.forEach(l => { const w = l.exits[l.exits.length - 1].why; o[w] = (o[w] || 0) + 1; }); return o; })(),
  allExits: (() => { const o = {}; S.closedLots.forEach(l => l.exits.forEach(e => o[e.why] = (o[e.why] || 0) + 1)); return o; })(),
  risk: { events: S.riskEvents, level: S.riskLevel, maxDD: pct(mS.mdd), hit: S.riskHit },
  lotCount: S.closedLots.length,
  lotWin: S.closedLots.length ? S.closedLots.filter(l => l.proceeds > l.amt).length / S.closedLots.length : 0,
  buys: S.trades.length, riskHit: S.riskHit,
  lastNav: navS[N - 1]
};
fs.writeFileSync('bt_data.json', JSON.stringify(out));
console.log('OK 窗口', roll.length, '年度', ann.length, '序列', ser.d.length);
console.log('v1.2 策略年化', pct(mS.cagr) + '%', ' 同敞口', pct(mMatch.cagr) + '%',
  ' 增量', pct(mS.cagr - mMatch.cagr) + 'pp');
console.log('归因: 总', attribution.total + 'pp', '假设', attribution.fromAssumption + 'pp',
  '价格', attribution.fromPrice + 'pp', '假设占比', attribution.assumptionShare + '%');
console.log('bootstrap 95%区间', boot.lo + 'pp ~ ' + boot.hi + 'pp', '正值比例', boot.posRate + '%');
console.log('批次', out.lotCount, '胜率', (out.lotWin * 100).toFixed(0) + '%', '买入次数', out.buys,
  '风控触发', S.riskEvents.length);
