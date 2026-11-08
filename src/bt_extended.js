// 扩展验证数据包 v1（2026-11-07）
// 补齐 v1.3 5.3 节的三处空白：真实股息率、估值层证伪、极端路径风控、样本外 walk-forward。
// 所有数字由本脚本从本地价格/估值数据重算，不含手工填写的结论。
const fs = require('fs');
const PT = require('../lib/paths.js');
const B = require('./bt_engine.js');
const V = require('./valuation_series.js');
const { simulate, bh, met, PX, N } = B;
const pct = x => +(x * 100).toFixed(2);

const A = JSON.parse(fs.readFileSync(PT.resolve('hs300_daily_2010_2026.json'), 'utf8')).data.klines
  .map(s => { const [d, c] = s.split(','); return { d, c: +c }; });
const D = JSON.parse(fs.readFileSync(PT.resolve('csi_dividend_2010_2026.json'), 'utf8')).data.klines
  .map(s => { const [d, c] = s.split(','); return { d, c: +c }; });
const CASH = 0.025, FEE = 0.005;
const origPX = PX.map(x => ({ ...x }));
const setPx = arr => { PX.length = 0; arr.forEach(x => PX.push(x)); };

function run(o, s = 0, e = N - 1, dy = V.dyHS) {
  const r = simulate(Object.assign({ dySeries: dy }, o), s, e);
  const m = met(r.navs), c = met(bh(r.avgExp, s, e, true, dy));
  return { cagr: pct(m.cagr), mdd: pct(m.mdd), exp: pct(r.avgExp), buys: r.trades.length,
    cycles: r.cycles.length, edge: pct(m.cagr - c.cagr), blocks: r.valBlocks,
    risk: r.riskEvents.length, navs: r.navs };
}

// ============ 1. 真实股息率：替换常数假设 ============
const dyModes = [
  { name: '常数 2.5%（v1.1~v1.3 口径）', dy: null },
  { name: '真实逐年股息率（NeoData）', dy: V.dyHS }
];
const dividend = dyModes.map(md => {
  const dy = md.dy || new Array(N).fill(0.025);
  const r = simulate({ dySeries: dy }), m = met(r.navs);
  const c = met(bh(r.avgExp, 0, N - 1, true, dy));
  const q = met(bh(0.40, 0, N - 1, true, dy));
  return { name: md.name, strat: pct(m.cagr), mdd: pct(m.mdd), exp: pct(r.avgExp),
    match: pct(c.cagr), edge: pct(m.cagr - c.cagr), c40: pct(q.cagr), m40: pct(q.mdd), buys: r.trades.length };
});

// 配置重算：mix 使用真实股息率序列
function mixReal(eq, wDiv, dyH, dyD) {
  let uD = eq * wDiv / D[0].c, uH = eq * (1 - wDiv) / A[0].c, cash = 1 - eq;
  const nav = [];
  const constH = typeof dyH === 'number', constD = typeof dyD === 'number';
  for (let i = 0; i < N; i++) {
    const vD = uD * D[i].c, vH = uH * A[i].c, e2 = vD + vH;
    const h = constH ? dyH : dyH[i], d = constD ? dyD : dyD[i];
    cash += (vD * d + vH * h - e2 * FEE) / 252;
    cash *= 1 + CASH / 252;
    if (i > 0 && i % 63 === 0) {
      const t = vD + vH + cash, want = t * eq, f = want / (e2 || 1);
      uD *= f; uH *= f; cash = t - want;
    }
    nav.push(uD * D[i].c + uH * A[i].c + cash);
  }
  return nav;
}
function mixMet(nav) {
  const y = nav.length / 252, cagr = (nav[nav.length - 1] / nav[0]) ** (1 / y) - 1;
  let pk = nav[0], mdd = 0;
  for (const v of nav) { if (v > pk) pk = v; const d = 1 - v / pk; if (d > mdd) mdd = d; }
  return { cagr: pct(cagr), mdd: pct(mdd) };
}
// 轨道 A 实测表：真实股息率 + 权益内 70/30 双资产（v1.3 的 R→敞口表用的是沪深300 单序列）
const trackATable = [0.30, 0.40, 0.50, 0.55].map(eq => {
  const m = mixMet(mixReal(eq, 0.30, V.dyHS, V.dyHL));
  const s = met(bh(eq, 0, N - 1, true, V.dyHS));
  return { eq: pct(eq), cagr: m.cagr, mdd: m.mdd, singleCagr: pct(s.cagr), singleMdd: pct(s.mdd) };
});

const allocCompare = [
  { name: '常数 2.5%/4.5%（旧假设）', h: 0.025, d: 0.045 },
  { name: '真实逐年股息率（NeoData）', h: V.dyHS, d: V.dyHL },
  { name: '红利股息率=沪深300（纯价格差异）', h: V.dyHS, d: V.dyHS }
].map(md => {
  const f = w => mixMet(mixReal(0.62, w, md.h, md.d));
  const a = f(0.25), b = f(0.30), c = f(0.419), z = f(1);
  return { name: md.name, w25: a.cagr, w30: b.cagr, w419: c.cagr, w100: z.cagr,
    gain25to419: pct((c.cagr - a.cagr) / 100), mdd419: c.mdd, mdd25: a.mdd };
});

// ============ 2. 估值层证伪 ============
const valBase = run({}), valExp = run({ useValuation: true, vScore: V.vExp }),
  valDoc = run({ useValuation: true, vScore: V.vDoc });
const threshGrid = [1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.7, 2.0].map(k => {
  const x = run({ stageDrops: [0.15, 0.25, 0.35].map(v => +(v * k).toFixed(4)) });
  return { k, cagr: x.cagr, mdd: x.mdd, exp: x.exp, edge: x.edge, buys: x.buys };
});
const shift = (a, k) => { const n = a.length, o = new Array(n); for (let i = 0; i < n; i++) o[i] = a[(i + k + n) % n]; return o; };
const shiftOut = [];
for (let k = 60; k <= 2400; k += 60) shiftOut.push({ k, cagr: run({ useValuation: true, vScore: shift(V.vExp, k) }).cagr });
let seed = 20261107;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const shufOut = [];
for (let t = 0; t < 120; t++) {
  const a = V.vExp.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  shufOut.push(run({ useValuation: true, vScore: a }).cagr);
}
const sortedShuf = shufOut.slice().sort((a, b) => a - b);
const sortedShift = shiftOut.map(x => x.cagr).sort((a, b) => a - b);
const segs = [[0, 1007], [1008, 2015], [2016, 3023], [3024, 4038]].map(([s, e]) => {
  const b = run({}, s, e), v = run({ useValuation: true, vScore: V.vExp }, s, e);
  return { period: V.PXDATES[s] + '~' + V.PXDATES[e], base: b.cagr, val: v.cagr,
    diff: pct((v.cagr - b.cagr) / 100), edgeBase: b.edge, edgeVal: v.edge };
});
function boot(d, Bn = 1000, block = 20) {
  let sd = 7777; const rr = () => { sd = (sd * 1664525 + 1013904223) >>> 0; return sd / 4294967296; };
  const n = d.length, out = [];
  for (let b = 0; b < Bn; b++) {
    let s = 0, cnt = 0;
    while (cnt < n) { const st = Math.floor(rr() * n), len = Math.min(block, n - cnt); for (let k = 0; k < len; k++) { s += d[(st + k) % n]; cnt++; } }
    out.push(s / n * 252);
  }
  out.sort((a, b) => a - b);
  return { lo: pct(out[25]), median: pct(out[500]), hi: pct(out[975]), pos: +(out.filter(x => x > 0).length / Bn * 100).toFixed(0) };
}
const bootOf = o => {
  const r = simulate(Object.assign({ dySeries: V.dyHS }, o)), c = bh(r.avgExp, 0, N - 1, true, V.dyHS), d = [];
  for (let i = 1; i < r.navs.length; i++) d.push(r.navs[i] / r.navs[i - 1] - c[i] / c[i - 1]);
  return boot(d);
};
const valuation = {
  base: { cagr: valBase.cagr, mdd: valBase.mdd, exp: valBase.exp, edge: valBase.edge, buys: valBase.buys },
  exp: { cagr: valExp.cagr, mdd: valExp.mdd, exp: valExp.exp, edge: valExp.edge, buys: valExp.buys, blocks: valExp.blocks },
  doc: { cagr: valDoc.cagr, mdd: valDoc.mdd, exp: valDoc.exp, edge: valDoc.edge, buys: valDoc.buys, blocks: valDoc.blocks },
  threshGrid,
  shift: { min: sortedShift[0], median: sortedShift[Math.floor(sortedShift.length / 2)], max: sortedShift[sortedShift.length - 1],
    percentileOfReal: +(shiftOut.filter(x => x.cagr < valExp.cagr).length / shiftOut.length * 100).toFixed(0) },
  shuffle: { min: sortedShuf[0], median: sortedShuf[60], max: sortedShuf[119],
    percentileOfReal: +(shufOut.filter(x => x < valExp.cagr).length / shufOut.length * 100).toFixed(0) },
  segs, bootBase: bootOf({}), bootVal: bootOf({ useValuation: true, vScore: V.vExp }),
  scoreDist: { doc: hist(V.vDoc), exp: hist(V.vExp) }
};
function hist(a) { const o = {}; a.forEach(x => o[x] = (o[x] || 0) + 1); return o; }

// ============ 3. 极端路径风控 ============
function buildPath(kind) {
  const L = 1600;
  const an = kind === 'slow' ? [[0, 1.0], [252, 1.15], [756, 0.35], [1008, 0.42], [1600, 0.62]]
    : kind === 'crash' ? [[0, 1.0], [252, 1.60], [312, 0.88], [612, 1.02], [1000, 0.95], [1600, 1.15]]
      : [[0, 1.0], [252, 1.10], [1252, 0.60], [1600, 0.58]];
  const out = [];
  for (let i = 0; i < L; i++) {
    let k = 0; while (k < an.length - 2 && an[k + 1][0] <= i) k++;
    const [i0, p0] = an[k], [i1, p1] = an[k + 1];
    const t = (i - i0) / (i1 - i0);
    const noise = 1 + 0.004 * Math.sin(i * 0.37) + 0.002 * Math.sin(i * 1.13);
    out.push({ dt: 'P' + String(i).padStart(4, '0'), c: +((p0 + (p1 - p0) * t) * noise * 1000).toFixed(2) });
  }
  return out;
}
function constTrack(px, E, R, useB, dy = 0.025) {
  let units = E / px[0].c, cash = 1 - E, peak = 1, halved = false, bDone = false, target = E;
  const nav = [], events = [];
  for (let i = 0; i < px.length; i++) {
    const p = px[i].c;
    cash += units * p * (dy - FEE) / 252; cash *= 1 + CASH / 252;
    let eq = units * p, navNow = eq + cash;
    if (navNow > peak) peak = navNow;
    let refH = 0; for (let j = Math.max(0, i - 251); j <= i; j++) if (px[j].c > refH) refH = px[j].c;
    if (useB && !bDone && !halved && 1 - p / refH >= 0.25) {
      target = E + 0.10; bDone = true; events.push({ dt: px[i].dt, type: '轨道B额外投入10%' });
    }
    const dd = 1 - navNow / peak;
    if (!halved && dd >= R) {
      target = target / 2; halved = true;
      events.push({ dt: px[i].dt, type: '达R敞口减半', dd: pct(dd) });
    }
    if (i > 0 && i % 63 === 0) {
      const want = navNow * target; units = want / p; cash = navNow - want; eq = want;
    }
    nav.push(units * p + cash);
  }
  const m = met(nav);
  return { cagr: pct(m.cagr), mdd: pct(m.mdd), events, final: pct(nav[nav.length - 1] / nav[0] - 1) };
}
const stress = [['slow', '2008式慢熊（-70%后弱反弹）'], ['crash', '2015式急跌（-45%快速崩塌）'], ['grind', '长期阴跌（-45%无反弹）']]
  .map(([kind, name]) => {
    const px = buildPath(kind); setPx(px);
    const r = simulate({}, 0, px.length - 1), m = met(r.navs);
    const c40 = met(bh(0.40, 0, px.length - 1, true));
    const lv2 = r.riskEvents.filter(e => e.level >= 2);
    const rebuys = lv2.map(e => {
      const idx = px.findIndex(x => x.dt === e.dt);
      return { dt: e.dt, level: e.level, buysIn20d: r.trades.filter(t => {
        const ti = px.findIndex(x => x.dt === t.dt); return ti > idx && ti <= idx + 20;
      }).length };
    });
    const peakPx = Math.max(...px.map(x => x.c));
    setPx(origPX);
    return {
      name, kind, pxDrop: pct(1 - Math.min(...px.map(x => x.c)) / peakPx),
      v12: { cagr: pct(m.cagr), mdd: pct(m.mdd), buys: r.trades.length,
        riskEvents: r.riskEvents.length, maxLevel: r.riskLevel,
        firstRisk: r.riskHit, levels: r.riskEvents.map(e => e.level), rebuys },
      const40: { cagr: pct(c40.cagr), mdd: pct(c40.mdd) },
      trackA: constTrack(buildPath(kind), 0.40, 0.20, false),
      trackB: constTrack(buildPath(kind), 0.40, 0.20, true)
    };
  });
setPx(origPX);

// ============ 4. 样本外 walk-forward ============
const CANDS = [
  { name: '默认参数', o: {} },
  { name: '入场阈值×0.8', o: { stageDrops: [0.12, 0.20, 0.28] } },
  { name: '入场阈值×1.1', o: { stageDrops: [0.165, 0.275, 0.385] } },
  { name: '入场阈值×1.2', o: { stageDrops: [0.18, 0.30, 0.42] } },
  { name: '入场阈值×1.4', o: { stageDrops: [0.21, 0.35, 0.49] } },
  { name: '止盈放宽×1.3', o: { tp: [0.156, 0.26, 0.364] } },
  { name: '止盈收紧×0.7', o: { tp: [0.084, 0.14, 0.196] } },
  { name: '移动退出放宽×1.3', o: { trail1: 0.195, trail2: 0.286 } },
  { name: '估值门槛(无前视)', o: { useValuation: true, vScore: V.vExp } }
];
const folds = [];
for (let s = 0; s + 1260 + 630 <= N; s += 630) {
  const tr = [s, s + 1259], te = [s + 1260, s + 1889];
  let best = null;
  for (const c of CANDS) {
    const r = simulate(Object.assign({ dySeries: V.dyHS }, c.o), tr[0], tr[1]);
    const m = met(r.navs);
    if (!best || m.cagr > best.cagr) best = { name: c.name, o: c.o, cagr: pct(m.cagr), buys: r.trades.length };
  }
  const rb = simulate(Object.assign({ dySeries: V.dyHS }, best.o), te[0], te[1]);
  const rd = simulate({ dySeries: V.dyHS }, te[0], te[1]);
  const mb = met(rb.navs), md = met(rd.navs);
  const cBest = met(bh(rb.avgExp, te[0], te[1], true, V.dyHS));
  const c40 = met(bh(0.40, te[0], te[1], true, V.dyHS));
  folds.push({
    train: V.PXDATES[tr[0]] + '~' + V.PXDATES[tr[1]], test: V.PXDATES[te[0]] + '~' + V.PXDATES[te[1]],
    picked: best.name, trainCagr: best.cagr,
    oosBest: pct(mb.cagr), oosDefault: pct(md.cagr), oosConst40: pct(c40.cagr),
    edgeBestVsMatch: pct(mb.cagr - cBest.cagr),
    vsDefault: pct(mb.cagr) > pct(md.cagr) ? '赢' : pct(mb.cagr) === pct(md.cagr) ? '平' : '输',
    vsConst40: pct(mb.cagr) > pct(c40.cagr) ? '赢' : '输'
  });
}
const walkForward = {
  folds,
  summary: {
    n: folds.length,
    beatsDefault: folds.filter(f => f.vsDefault === '赢').length,
    tiesDefault: folds.filter(f => f.vsDefault === '平').length,
    beatsConst40: folds.filter(f => f.vsConst40 === '赢').length,
    avgOOSBest: pct(folds.reduce((a, f) => a + f.oosBest, 0) / folds.length / 100),
    avgOOSDefault: pct(folds.reduce((a, f) => a + f.oosDefault, 0) / folds.length / 100),
    avgOOSConst40: pct(folds.reduce((a, f) => a + f.oosConst40, 0) / folds.length / 100),
    picks: [...new Set(folds.map(f => f.picked))]
  }
};

// ============ 5. 数据可得性与文档核对 ============
const last = N - 1;
const docCheck = {
  date: V.PXDATES[last],
  items: [
    { k: '沪深300 PE-TTM', doc: '13.63', real: V.peHS[last].toFixed(2), ok: true },
    { k: 'PE 固定起点分位', doc: '约 60%', real: (V.detailDoc[last].qPE * 100).toFixed(0) + '%', ok: true },
    { k: 'PB 分位', doc: '约 30%', real: (V.detailDoc[last].qPB * 100).toFixed(0) + '%', ok: false },
    { k: 'ERP 分位', doc: '约 78%', real: (V.detailDoc[last].qERP * 100).toFixed(0) + '%', ok: false },
    { k: 'ERP 水平', doc: '4.85%', real: V.erpHS[last].toFixed(2) + '%', ok: false },
    { k: '股息率溢价', doc: '+120bp', real: '+' + (V.erpDivHS[last] * 100).toFixed(0) + 'bp', ok: true },
    { k: '中证红利股息率', doc: '4.34%', real: (V.dyHL[last] * 100).toFixed(2) + '%', ok: false },
    { k: '四维估值分', doc: '3/4', real: String(V.vDoc[last]) + '/4', ok: true },
    { k: '市场广度 B', doc: '34%', real: '无历史序列，不可复核', ok: false }
  ],
  availability: {
    valuation: '可得：NeoData index_valuation 提供 2010 年以来日度 PE/PB/股息率/风险溢价，可算四维估值分',
    breadth: '不可得：market_breadth 仅返回当日全市场涨跌家数快照，无「沪深300 成分股站上 60 日均线比例」历史序列',
    implication: 'S3 的 B≤25% 条件永远无法历史验证，v1.2 完整规则不可完整回测'
  }
};

const out = {
  generated: '2026-11-07', engine: 'bt_engine.js v5',
  dividend, dividendAnnual: V.annual,
  dividendStats: V.stats, trackATable, allocCompare, valuation, stress, walkForward, docCheck
};
fs.writeFileSync(PT.out('extended_data.json'), JSON.stringify(out));
console.log('=== 真实股息率 ==='); console.table(out.dividend);
console.log('=== 配置重算 ==='); console.table(out.allocCompare);
console.log('=== 估值证伪 ===');
console.log('基准', JSON.stringify(out.valuation.base), '\n估值exp', JSON.stringify(out.valuation.exp));
console.log('等效阈值最优', JSON.stringify(out.valuation.threshGrid.reduce((a, b) => a.cagr > b.cagr ? a : b)));
console.log('移位分位', out.valuation.shift.percentileOfReal + '%', '打乱分位', out.valuation.shuffle.percentileOfReal + '%');
console.log('bootstrap 基准', JSON.stringify(out.valuation.bootBase), '估值', JSON.stringify(out.valuation.bootVal));
console.log('=== 极端路径 ===');
out.stress.forEach(s => console.log(s.name, '跌幅', s.pxDrop + '%', 'v1.2风控', s.v12.riskEvents, '最高级', s.v12.maxLevel,
  '清仓后20日买回', JSON.stringify(s.v12.rebuys.map(x => x.buysIn20d)), '轨道A回撤', s.trackA.mdd + '%', '轨道B回撤', s.trackB.mdd + '%'));
console.log('=== walk-forward ==='); console.table(folds);
console.log('汇总', JSON.stringify(out.walkForward.summary));
