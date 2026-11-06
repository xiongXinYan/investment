// v1.1 回测引擎 v3：修正再入场锚点 + 滚动窗口 + 年度收益
const fs = require('fs');
const raw = JSON.parse(fs.readFileSync('hs300_daily_2010_2026.json', 'utf8'));
const PX = raw.data.klines.map(s => { const [dt, c] = s.split(','); return { dt, c: +c }; });
const N = PX.length;

const BASE = {
  corePct: 0.22, divYield: 0.025, feeAnn: 0.005, cashRate: 0.025, tradeFee: 0.0005,
  gap: 5, drop: 0.05, size: 6,
  tp: [0.12, 0.20, 0.28], tpQty: [0.25, 0.75, 1.00],
  trail1: 0.15, trail2: 0.22,
  t504: 504, t756: 756, W: 252,
  poolMode: 'cap',
  anchor: 'lastTx',        // 'lastBuy' | 'lastTx'
  useTrail: true, useTP: true, useTime: true,
  stageCaps: [15, 30, 40]
};

function simulate(opt, S, E) {
  const o = Object.assign({}, BASE, opt || {});
  S = S || 0; E = E === undefined ? N - 1 : E;

  let cash = 1 - o.corePct;
  let coreUnits = o.corePct / PX[S].c;
  let lots = [];
  const trades = [], navs = [], expo = [], closedLots = [];
  let paid = 0, target = 0, stageCap = 0;
  let inCycle = false, H = 0, cyc = null, cycles = [];
  let lastIdx = -999, lastPx = 0, anchorPx = 0, peakNav = 1, riskHit = null, cool = -1;

  const navOf = p => coreUnits * p + lots.reduce((a, l) => a + l.units * p, 0) + cash;

  const sell = (lot, units, p, why, i) => {
    units = Math.min(units, lot.units);
    if (units <= 1e-12) return;
    cash += units * p * (1 - o.tradeFee);
    lot.units -= units; lot.sold += units; lot.proceeds += units * p * (1 - o.tradeFee);
    lot.exits.push({ why, dt: PX[i].dt, px: +p.toFixed(0), frac: units / lot.q0 });
    if (lot.units <= 1e-9) { lot.closed = true; lot.closeIdx = i; }
    if (o.anchor === 'lastTx') anchorPx = p;
  };

  for (let i = S; i <= E; i++) {
    const p = PX[i].c;
    const eq = coreUnits * p + lots.reduce((a, l) => a + l.units * p, 0);
    cash += eq * (o.divYield - o.feeAnn) / 252;
    cash *= (1 + o.cashRate / 252);

    if (!inCycle && i >= S + o.W && i > cool) {
      let h = 0;
      for (let j = i - o.W + 1; j <= i; j++) if (PX[j].c > h) h = PX[j].c;
      const ok3 = k => i >= 2 && (1 - PX[i - 1].c / h) >= k && (1 - PX[i - 2].c / h) >= k;
      if (1 - p / h >= 0.15 && ok3(0.15)) {
        inCycle = true; H = h; stageCap = o.stageCaps[0];
        cyc = { start: PX[i].dt, H: +h.toFixed(0), startIdx: i, peakD: 0, minPx: p };
        paid = 0; target = o.stageCaps[0]; lastIdx = -999; lastPx = 0; anchorPx = 0;
      }
    }

    if (inCycle) {
      const D = 1 - p / H;
      if (D > cyc.peakD) cyc.peakD = D;
      if (p < cyc.minPx) cyc.minPx = p;

      if (p > H) {
        cyc.end = PX[i].dt; cyc.endIdx = i; cycles.push(cyc);
        inCycle = false; cyc = null; stageCap = 0; cool = i + 20;
      } else {
        const ok3 = k => i >= 2 && (1 - PX[i - 1].c / H) >= k && (1 - PX[i - 2].c / H) >= k;
        if (D >= 0.35 && ok3(0.35)) stageCap = Math.max(stageCap, o.stageCaps[2]);
        else if (D >= 0.25 && ok3(0.25)) stageCap = Math.max(stageCap, o.stageCaps[1]);
        else if (D >= 0.15 && ok3(0.15)) stageCap = Math.max(stageCap, o.stageCaps[0]);

        const nav = navOf(p);
        const mobVal = lots.reduce((a, l) => a + l.units * p, 0);
        const room = o.poolMode === 'cap' ? stageCap - mobVal / nav * 100 : target - paid;
        const ref = o.anchor === 'lastBuy' ? lastPx : (anchorPx || lastPx);

        if (room >= 2 && i - lastIdx >= o.gap && (ref === 0 || p <= ref * (1 - o.drop))) {
          const amtPct = Math.min(o.size, room);
          let amt = Math.min(nav * amtPct / 100, cash * 0.995);
          if (amt > 1e-6) {
            const units = amt * (1 - o.tradeFee) / p;
            cash -= amt;
            lots.push({ q0: units, units, cost: p * (1 + o.tradeFee), peak: p, reached12: false, sold: 0,
                        stage1: false, openIdx: i, amt, proceeds: 0, exits: [], px0: p });
            if (o.poolMode === 'cum') paid += amtPct;
            lastIdx = i; lastPx = p; if (!anchorPx) anchorPx = p;
            trades.push({ dt: PX[i].dt, px: +p.toFixed(0), pct: +amtPct.toFixed(2), stage: stageCap });
          }
        }
      }
    }

    for (const lot of lots) {
      if (lot.closed) continue;
      const r = p / lot.cost - 1;
      if (p > lot.peak) lot.peak = p;
      if (r >= o.tp[0]) lot.reached12 = true;
      let did = false;
      if (o.useTrail && lot.reached12) {
        const dd = 1 - p / lot.peak;
        if (dd >= o.trail2) { sell(lot, lot.units, p, '移动退出二段', i); did = true; }
        else if (dd >= o.trail1 && !lot.stage1) { lot.stage1 = true; sell(lot, lot.units * 0.5, p, '移动退出一段', i); did = true; }
      }
      if (did || lot.closed) continue;
      if (o.useTP) {
        let tgt = 0, why = '';
        if (r >= o.tp[2]) { tgt = o.tpQty[2]; why = '止盈高位'; }
        else if (r >= o.tp[1]) { tgt = o.tpQty[1]; why = '止盈中位'; }
        else if (r >= o.tp[0]) { tgt = o.tpQty[0]; why = '止盈首档'; }
        const want = tgt * lot.q0 - lot.sold;
        if (want > 1e-12) sell(lot, want, p, why, i);
      }
      if (o.useTime && !lot.closed) {
        const held = i - lot.openIdx;
        if (held >= o.t756) sell(lot, lot.units, p, '时间退出3年', i);
        else if (held >= o.t504 && r <= 0 && !lot.halfTime) { lot.halfTime = true; sell(lot, lot.units * 0.5, p, '时间退出2年', i); }
      }
    }
    for (const l of lots) if (l.closed) closedLots.push(l);
    lots = lots.filter(l => !l.closed && l.units > 1e-12);

    const nav = navOf(p);
    if (nav > peakNav) peakNav = nav;
    if (!riskHit && 1 - nav / peakNav >= 0.30 && lots.length) {
      lots.forEach(l => sell(l, l.units, p, '账户风控30%', i));
      for (const l of lots) if (l.closed) closedLots.push(l);
      lots = []; riskHit = PX[i].dt;
    }
    navs.push(nav); expo.push(1 - cash / nav);
  }
  for (const l of lots) if (l.closed) closedLots.push(l);
  if (cyc) { cyc.end = null; cyc.endIdx = E; cycles.push(cyc); }
  return { navs, expo, trades, cycles, riskHit, closedLots,
    avgExp: expo.reduce((a, b) => a + b, 0) / expo.length, final: navs[navs.length - 1] };
}

function bh(eqPct, S, E, rebal) {
  S = S || 0; E = E === undefined ? N - 1 : E;
  let cash = 1 - eqPct, units = eqPct / PX[S].c;
  const out = [];
  for (let i = S; i <= E; i++) {
    const p = PX[i].c, eq = units * p;
    cash += eq * (BASE.divYield - BASE.feeAnn) / 252;
    cash *= (1 + BASE.cashRate / 252);
    if (rebal && i > S && (i - S) % 63 === 0) {
      const nav = eq + cash, d = nav * eqPct - eq; units += d / p; cash -= d;
    }
    out.push(units * p + cash);
  }
  return out;
}

function met(nav) {
  const y = nav.length / 252;
  const cagr = Math.pow(nav[nav.length - 1] / nav[0], 1 / y) - 1;
  let pk = nav[0], mdd = 0;
  for (const v of nav) { if (v > pk) pk = v; const d = 1 - v / pk; if (d > mdd) mdd = d; }
  const r = []; for (let i = 1; i < nav.length; i++) r.push(nav[i] / nav[i - 1] - 1);
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  const sd = Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / r.length) * Math.sqrt(252);
  return { cagr, mdd, vol: sd, sharpe: (cagr - BASE.cashRate) / sd, calmar: cagr / mdd, total: nav[nav.length - 1] / nav[0] - 1, years: y };
}

module.exports = { simulate, bh, met, PX, N, BASE };

if (require.main === module) {
  const VAR = {
    'A 原锚点(上一笔买价)': { anchor: 'lastBuy' },
    'B 修正锚点(上一笔成交)': { anchor: 'lastTx' },
    'C 修正锚点·无止盈': { anchor: 'lastTx', useTP: false },
    'D 修正锚点·无时间退出': { anchor: 'lastTx', useTime: false },
    'E 修正锚点·无移动退出': { anchor: 'lastTx', useTrail: false },
    'F 修正锚点·全无卖出': { anchor: 'lastTx', useTP: false, useTime: false, useTrail: false },
    'G 修正·止盈15/25/40': { anchor: 'lastTx', tp: [0.15, 0.25, 0.40] },
  };
  console.log('变体                        年化    回撤   波动  Sharpe Calmar 敞口  买入次数');
  for (const [n, o] of Object.entries(VAR)) {
    const r = simulate(o), m = met(r.navs);
    console.log(n.padEnd(24), (m.cagr * 100).toFixed(2).padStart(6) + '%', (m.mdd * 100).toFixed(1).padStart(7) + '%',
      (m.vol * 100).toFixed(1).padStart(6) + '%', m.sharpe.toFixed(2).padStart(6), m.calmar.toFixed(2).padStart(6),
      (r.avgExp * 100).toFixed(1).padStart(6) + '%', String(r.trades.length).padStart(6));
  }
  console.log('\n基准:');
  const B = [['沪深300 100%', bh(1, 0, N - 1, false)], ['60/40 季再平衡', bh(0.6, 0, N - 1, true)],
             ['22% 核心·不再平衡', bh(0.22, 0, N - 1, false)], ['22% 核心·季再平衡', bh(0.22, 0, N - 1, true)],
             ['全现金 2.5%', bh(0, 0, N - 1, false)]];
  for (const [n, v] of B) {
    const m = met(v);
    console.log(n.padEnd(24), (m.cagr * 100).toFixed(2).padStart(6) + '%', (m.mdd * 100).toFixed(1).padStart(7) + '%',
      (m.vol * 100).toFixed(1).padStart(6) + '%', m.sharpe.toFixed(2).padStart(6), m.calmar.toFixed(2).padStart(6));
  }
}
