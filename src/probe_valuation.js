// 估值门槛「+1pp 增量」的证伪检验（2026-11-07）
// 目的：判断估值分带来的是真实增量信息，还是「变相提高回撤阈值」/样本内巧合。
const B = require('./bt_engine.js');
const V = require('./valuation_series.js');
const { simulate, bh, met, PX, N } = B;
const pct = x => +(x * 100).toFixed(2);

function run(o, s = 0, e = N - 1) {
  const r = simulate(Object.assign({ dySeries: V.dyHS }, o), s, e);
  const m = met(r.navs), c = met(bh(r.avgExp, s, e, true, V.dyHS));
  return { cagr: m.cagr, mdd: m.mdd, exp: r.avgExp, buys: r.trades.length,
    edge: m.cagr - c.cagr, navs: r.navs, expo: r.expo, blocks: r.valBlocks, risk: r.riskEvents.length };
}
const show = (n, x) => console.log(n.padEnd(28), '年化', pct(x.cagr) + '%', '回撤', pct(x.mdd) + '%',
  '敞口', pct(x.exp) + '%', '买入', String(x.buys).padStart(3), '增量', pct(x.edge) + 'pp', '阻止', x.blocks);

console.log('=== 1. 基准对照（真实股息率口径） ===');
const base = run({}), valExp = run({ useValuation: true, vScore: V.vExp }), valDoc = run({ useValuation: true, vScore: V.vDoc });
show('无估值门槛', base); show('估值分 exp（无前视）', valExp); show('估值分 doc（含前视）', valDoc);

console.log('\n=== 2. 等效回撤阈值：估值分是否只是变相调参？ ===');
const grid = [];
for (const k of [1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.7, 2.0]) {
  const o = { stageDrops: [0.15, 0.25, 0.35].map(x => +(x * k).toFixed(4)) };
  const x = run(o);
  grid.push({ k, ...x });
  show('stageDrops ×' + k.toFixed(1), x);
}
const best = grid.reduce((a, b) => a.cagr > b.cagr ? a : b);
console.log('单纯调阈值最高年化', pct(best.cagr) + '%（×' + best.k + '），估值分 exp', pct(valExp.cagr) + '%');

console.log('\n=== 3. 循环移位（保留序列自相关，错开与价格的对应关系） ===');
const shift = (a, k) => { const n = a.length, o = new Array(n); for (let i = 0; i < n; i++) o[i] = a[(i + k + n) % n]; return o; };
const shifted = [];
for (let k = 60; k <= 2400; k += 60) {
  const x = run({ useValuation: true, vScore: shift(V.vExp, k) });
  shifted.push({ k, cagr: x.cagr, edge: x.edge, mdd: x.mdd });
}
const sc = shifted.map(x => x.cagr).sort((a, b) => a - b);
console.log('移位 40 次年化分布: min', pct(sc[0]) + '%', '中位', pct(sc[20]) + '%', 'max', pct(sc[sc.length - 1]) + '%');
console.log('真实对齐值', pct(valExp.cagr) + '%', '在移位分布中的分位',
  (shifted.filter(x => x.cagr < valExp.cagr).length / shifted.length * 100).toFixed(0) + '%');

console.log('\n=== 4. 随机打乱（破坏时序，保留边际分布） ===');
let seed = 20261107;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const shuf = [];
for (let t = 0; t < 120; t++) {
  const a = V.vExp.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  shuf.push(run({ useValuation: true, vScore: a }).cagr);
}
shuf.sort((a, b) => a - b);
console.log('打乱 120 次年化: min', pct(shuf[0]) + '%', '中位', pct(shuf[60]) + '%', 'max', pct(shuf[119]) + '%');
console.log('真实序列', pct(valExp.cagr) + '%', '超过打乱样本比例',
  (shuf.filter(x => x < valExp.cagr).length / shuf.length * 100).toFixed(0) + '%');

console.log('\n=== 5. 分段检验（增量符号是否稳定） ===');
const segs = [[0, 2016], [2017, 4038], [0, 1007], [1008, 2015], [2016, 3023], [3024, 4038]];
for (const [s, e] of segs) {
  const b = run({}, s, e), v = run({ useValuation: true, vScore: V.vExp }, s, e);
  console.log(PX[s].dt + '~' + PX[e].dt, '无估值增量', pct(b.edge) + 'pp',
    '有估值增量', pct(v.edge) + 'pp', '年化', pct(b.cagr) + '% -> ' + pct(v.cagr) + '%',
    '增量差', pct(v.cagr - b.cagr) + 'pp');
}

console.log('\n=== 6. block bootstrap（估值门槛策略 vs 同敞口常数，年化差） ===');
function boot(d, Bn = 1000, block = 20) {
  let sd = 7777; const rr = () => { sd = (sd * 1664525 + 1013904223) >>> 0; return sd / 4294967296; };
  const n = d.length, out = [];
  for (let b = 0; b < Bn; b++) {
    let s = 0, cnt = 0;
    while (cnt < n) { const st = Math.floor(rr() * n), len = Math.min(block, n - cnt); for (let k = 0; k < len; k++) { s += d[(st + k) % n]; cnt++; } }
    out.push(s / n * 252);
  }
  out.sort((a, b) => a - b);
  return { lo: pct(out[25]), median: pct(out[500]), hi: pct(out[975]), pos: (out.filter(x => x > 0).length / Bn * 100).toFixed(0) };
}
const diff = [], cNav = bh(valExp.exp, 0, N - 1, true, V.dyHS);
for (let i = 1; i < valExp.navs.length; i++) diff.push(valExp.navs[i] / valExp.navs[i - 1] - cNav[i] / cNav[i - 1]);
console.log('95%区间', JSON.stringify(boot(diff)));
console.log('对照：无估值门槛', JSON.stringify(boot((() => {
  const d = [], c = bh(base.exp, 0, N - 1, true, V.dyHS);
  for (let i = 1; i < base.navs.length; i++) d.push(base.navs[i] / base.navs[i - 1] - c[i] / c[i - 1]);
  return d;
})())));
