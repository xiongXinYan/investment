const fs = require('fs');
const B = require('./bt_engine.js');
const { simulate, bh, met, PX, N, BASE } = B;

const MAIN = { anchor: 'lastTx' };
const S = simulate(MAIN);
const navS = S.navs, navBH = bh(1, 0, N - 1, false), nav6040 = bh(0.6, 0, N - 1, true);
const navCore = bh(0.22, 0, N - 1, true), navCoreNR = bh(0.22, 0, N - 1, false);
const navMatch = bh(S.avgExp, 0, N - 1, true);

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

// 滚动 5 年
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

// 卖出规则变体
const VAR = [
  ['不修改（v1.1 原样，含 3 年强清）', { anchor: 'lastTx' }],
  ['取消时间退出', { anchor: 'lastTx', useTime: false }],
  ['取消固定止盈（只留移动退出）', { anchor: 'lastTx', useTP: false }],
  ['取消移动退出', { anchor: 'lastTx', useTrail: false }],
  ['取消全部卖出', { anchor: 'lastTx', useTP: false, useTime: false, useTrail: false }],
  ['止盈档改为 15/25/40', { anchor: 'lastTx', tp: [0.15, 0.25, 0.40] }],
  ['入场仍锚定上一笔买价（v1.1 字面）', { anchor: 'lastBuy' }]
];
const variants = VAR.map(([n, o]) => {
  const r = simulate(o), m = met(r.navs);
  return { n, cagr: m.cagr, mdd: m.mdd, calmar: m.calmar, sharpe: m.sharpe, exp: r.avgExp, buys: r.trades.length, tot: m.total };
});

// 溢价敏感性
const sens = [];
[0.025, 0.045, 0.065, 0.085].forEach(dy => {
  BASE.divYield = dy;
  const s2 = simulate(MAIN), m = met(s2.navs);
  const cm = met(bh(s2.avgExp, 0, N - 1, true));
  sens.push({ carry: dy - BASE.feeAnn, strat: m.cagr, match: cm.cagr, full: met(bh(1, 0, N - 1, false)).cagr,
    s60: met(bh(0.6, 0, N - 1, true)).cagr });
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

// ---- 标的选择对照：中证红利 ----
const _mS = met(navS), _mB = met(navBH), _m60 = met(nav6040), _mC = met(navCore), _mM = met(navMatch);
const out0 = { strat: _mS.cagr, match: _mM.cagr, s60: _m60.cagr, bh: _mB.cagr, core: _mC.cagr,
  ddS: _mS.mdd, ddM: _mM.mdd, exp: S.avgExp };
const HLraw = JSON.parse(fs.readFileSync('csi_dividend_2010_2026.json', 'utf8'));
const HL = HLraw.data.klines.map(s => { const [dt, c] = s.split(','); return { dt, c: +c }; });
const hs300Px = PX.map(x => ({ dt: x.dt, c: x.c }));
PX.length = 0; HL.forEach(x => PX.push(x));
BASE.divYield = 0.045;
const SH = simulate(MAIN), mSH = met(SH.navs);
const assetComp = [
  { name: '沪深300', div: 0.025, strat: out0.strat, match: out0.match, s60: out0.s60, bh: out0.bh, core: out0.core, ddS: out0.ddS, ddM: out0.ddM, exp: out0.exp },
  { name: '中证红利', div: 0.045, strat: mSH.cagr, match: met(bh(SH.avgExp, 0, N - 1, true)).cagr,
    s60: met(bh(0.6, 0, N - 1, true)).cagr, bh: met(bh(1, 0, N - 1, false)).cagr,
    core: met(bh(0.22, 0, N - 1, true)).cagr, ddS: mSH.mdd, ddM: met(bh(SH.avgExp, 0, N - 1, true)).mdd, exp: SH.avgExp }
];
PX.length = 0; hs300Px.forEach(x => PX.push(x));
BASE.divYield = 0.025;

const out = {
  period: [PX[0].dt, PX[N - 1].dt],
  assetComp,
  metrics: { strat: met(navS), bh: met(navBH), s60: met(nav6040), core: met(navCore), coreNR: met(navCoreNR), match: met(navMatch) },
  avgExp: S.avgExp, ann, roll, cyc, variants, sens, ser,
  cycles: S.cycles.map(c => ({ start: c.start, end: c.end, H: c.H, dd: c.peakD })),
  byEx: (() => { const o = {}; S.closedLots.forEach(l => { const w = l.exits[l.exits.length - 1].why; o[w] = (o[w] || 0) + 1; }); return o; })(),
  lotCount: S.closedLots.length,
  lotWin: S.closedLots.filter(l => l.proceeds > l.amt).length / S.closedLots.length,
  buys: S.trades.length, riskHit: S.riskHit,
  lastNav: navS[N - 1]
};
fs.writeFileSync('bt_data.json', JSON.stringify(out));
console.log('OK 窗口', roll.length, '年度', ann.length, '序列', ser.d.length);
console.log('策略年化', (out.metrics.strat.cagr * 100).toFixed(2) + '%',
  ' 同敞口', (out.metrics.match.cagr * 100).toFixed(2) + '%',
  ' 60/40', (out.metrics.s60.cagr * 100).toFixed(2) + '%');
console.log('批次', out.lotCount, '胜率', (out.lotWin * 100).toFixed(0) + '%', '买入次数', out.buys);
