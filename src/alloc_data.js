// 生成配置对比报告数据
const fs = require('fs');
const PT = require('../lib/paths.js');
const load = f => JSON.parse(fs.readFileSync(PT.resolve(f), 'utf8')).data.klines.map(s => { const [d, c] = s.split(','); return { d, c: +c }; });
const A = load('hs300_daily_2010_2026.json'), D = load('csi_dividend_2010_2026.json');
const N = A.length, CASH = 0.025, FEE = 0.005;
// 2026-11-07：股息率不再是唯一常数，改为可检验的参数；HS300 固定 2.5%
const DIV_BASE = 0.045;

function mix(eq, wDiv, dy = DIV_BASE) {
  let uD = eq * wDiv / D[0].c, uH = eq * (1 - wDiv) / A[0].c, cash = 1 - eq;
  const nav = [];
  for (let i = 0; i < N; i++) {
    const vD = uD * D[i].c, vH = uH * A[i].c, e2 = vD + vH;
    cash += e2 * (dy * (vD / (e2 || 1)) + 0.025 * (vH / (e2 || 1)) - FEE) / 252;
    cash *= 1 + CASH / 252;
    if (i > 0 && i % 63 === 0) { const t = e2 + cash, want = t * eq, f = want / (e2 || 1); uD *= f; uH *= f; cash = t - want; }
    nav.push(uD * D[i].c + uH * A[i].c + cash);
  }
  return nav;
}
function met(nav) {
  const y = nav.length / 252, cagr = (nav[nav.length - 1] / nav[0]) ** (1 / y) - 1;
  let pk = nav[0], mdd = 0;
  for (const v of nav) { if (v > pk) pk = v; const d = 1 - v / pk; if (d > mdd) mdd = d; }
  const r = []; for (let i = 1; i < nav.length; i++) r.push(nav[i] / nav[i - 1] - 1);
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  const sd = Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / r.length) * Math.sqrt(252);
  return { cagr: +(cagr * 100).toFixed(2), mdd: +(mdd * 100).toFixed(1), sharpe: +((cagr - CASH) / sd).toFixed(2), calmar: +(cagr / mdd).toFixed(2), total: +((nav[nav.length - 1] - 1) * 100).toFixed(0) };
}

// 1. 红利权重扫描 @62%
const scan = [];
for (let w = 0; w <= 1.0001; w += 0.1) {
  const m = met(mix(0.62, Math.round(w * 100) / 100));
  scan.push({ w: Math.round(w * 100), ...m });
}

// 2. 权益 × 红利 矩阵
const ws = [0, 0.3, 0.5, 0.7, 1.0], lv = [22, 37, 44, 52, 62];
const grid = lv.map(e => ({
  eq: e,
  v: ws.map(w => { const m = met(mix(e / 100, w)); return { cagr: m.cagr, mdd: m.mdd }; })
}));

// 3. 压力路径分解
const FALL = { div: .25, hs: .30, c500: .35, star: .40, sec: .40 };
function path(core, mob) {
  const t = Object.values(mob).reduce((a, b) => a + b, 0);
  const s = Object.keys(mob).reduce((a, k) => a + mob[k] * FALL[k], 0) / t;
  const bottom = 0.65 * (1 - s);
  const dL = core.div * Math.min(1, (1 - bottom) * 0.85), hL = core.hs * (1 - bottom);
  const coreEnd = +(core.div + core.hs - dL - hL).toFixed(2);
  const lots = []; let acc = coreEnd;
  [[15, .85, 'S1'], [15, .75, 'S2'], [10, .65, 'S3']].forEach(([amt, e, nm]) => {
    const v = +(amt * bottom / e).toFixed(2); lots.push({ nm, v }); acc += v;
  });
  return { s: +(s * 100).toFixed(1), bottom: +bottom.toFixed(3), dd: +(100 - acc - 38).toFixed(1), coreEnd, lots, nav: +(acc + 38).toFixed(2) };
}
const pOld = path({ div: 12, hs: 10 }, { div: 3.5, hs: 13, c500: 12, star: 5.5, sec: 6 });
const pNew = path({ div: 14, hs: 8 }, { div: 12, hs: 16, c500: 6, star: 2, sec: 4 });

// 4. 构成堆叠
const comp = {
  old: { name: 'v1.1', vals: [[12, 10, 0, 0, 0], [13.5, 15, 4.5, 2, 2], [14.5, 20, 9, 4, 4.5], [15.5, 23, 12, 5.5, 6]] },
  neu: { name: 'v1.2', vals: [[14, 8, 0, 0, 0], [18, 15, 2, 0.5, 1.5], [22, 20, 4.5, 1.5, 4], [26, 24, 6, 2, 4]] }
};

// 5. 分档见底回撤
const stepOld = [11.5, 19.0, 25.4, 28.7], stepNew = [10.9, 18.0, 24.0, 27.1];

// 2026-11-07 新增：配置提升对股息率假设的敏感性
// dy = 2.5% 时红利与 HS300 持有收益相同，剩下的差异纯粹来自价格序列。
const assumptionScan = [0.025, 0.035, 0.045, 0.055].map(dy => {
  const c = w => met(mix(0.62, w, dy)).cagr;
  return { dy: +(dy * 100).toFixed(1), w0: c(0), w25: c(0.25), w419: c(0.419), w100: c(1),
    gain: +(c(0.419) - c(0.25)).toFixed(2) };
});
const priceOnly = assumptionScan[0].gain;

const out = {
  period: [A[0].d, A[N - 1].d],
  assumptionScan, priceOnly,
  keyRange: { dy: [2.5, 5.5], gain: [priceOnly, assumptionScan[assumptionScan.length - 1].gain] },
  scan, grid, ws, lv,
  stress: { old: pOld, neu: pNew },
  comp, stepOld, stepNew,
  key: {
    cagrOld: met(mix(0.62, 0.25)).cagr, cagrNew: met(mix(0.62, 0.419)).cagr,
    divOld: 25.0, divNew: 41.9,
    edgeOld: 64.8, edgeNew: 65.3, edgePar: 78.6
  }
};
fs.writeFileSync(PT.out('alloc_data.json'), JSON.stringify(out));
console.log(JSON.stringify(out.key, null, 1));
console.log('scan', scan.map(s => `${s.w}%:${s.cagr}%/${s.mdd}%`).join(' '));
console.log('stress old', JSON.stringify(pOld), '\nstress new', JSON.stringify(pNew));
