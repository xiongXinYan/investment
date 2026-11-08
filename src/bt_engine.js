// ============================================================================
// ⚠ 归档文件，不是当前策略引擎 ⚠
//   本文件 = v1.2 规则的择时引擎（V0/S1/S2/S3 分级、timeRule 周期边界、估值门槛）。
//   v1.6 已删除整个择时层，当前策略的正式引擎是 bt_r_clause.js，
//   正式回测入口是 phase5_run.js，指标唯一来源是 metrics_v16.js。见 ENGINES.md。
//
//   保留原因：bt_data.js / bt_extended.js / probe_valuation.js 三个历史报告
//   生成器 require 本文件；删除会使第一、二轮的 HTML 报告无法复现。
//   本文件产出的任何数字属 v1.2 口径，与 v1.6 不可比较、不可混用。
// ============================================================================
// 回测引擎 v5（2026-11-07）：同步 v1.2 规则 + 风控分级修复 + 估值层/真实股息率
// v4 改动：timeRule 双口径；风控分级可升级且不自动恢复；cycleEndMode；costMult
// v5 新增（默认全部关闭，旧数字逐位可复现）：
//   1. dySeries：真实逐年股息率（小数数组，按交易日索引），替代常数 divYield
//   2. vScore + useValuation：v1.2 第 4.2 节四维估值分作为 S1/S2/S3 的必要条件
//      valThresholds=[2,3,3]；市场广度 B 无历史序列，此处按 v1.2「数据缺失折算」显式跳过 B
//   3. 返回 valBlocks：估值门槛阻止开周期的次数
// 保持 simulate / bh / met / PX / N / BASE 的签名与 bt_data.js 字段兼容。
const fs = require('fs');
const PT = require('../lib/paths.js');
const raw = JSON.parse(fs.readFileSync(PT.resolve('hs300_daily_2010_2026.json'), 'utf8'));
const PX = raw.data.klines.map(s => { const [dt, c] = s.split(','); return { dt, c: +c }; });
const N = PX.length;

const BASE = {
  corePct: 0.22, divYield: 0.025, feeAnn: 0.005, cashRate: 0.025, tradeFee: 0.0005,
  costMult: 1,
  gap: 5, drop: 0.05, size: 6,
  tp: [0.12, 0.20, 0.28], tpQty: [0.25, 0.75, 1.00],
  trail1: 0.15, trail2: 0.22,
  t504: 504, t756: 756, t1260: 1260, W: 252,
  poolMode: 'cap',
  anchor: 'lastTx',
  useTrail: true, useTP: true, useTime: true,
  stageCaps: [15, 30, 40], stageDrops: [0.15, 0.25, 0.35],
  riskLines: [0.255, 0.30, 0.345], riskTarget: 0.10,
  timeRule: 'v12',
  cycleEndMode: 'newhigh',
  dySeries: null, vScore: null, useValuation: false, valThresholds: [2, 3, 3]
};

function simulate(opt, S, E) {
  const o = Object.assign({}, BASE, opt || {});
  const fee = o.tradeFee * o.costMult;
  S = S || 0; E = E === undefined ? N - 1 : E;
  const dyAt = o.dySeries ? (i => o.dySeries[i]) : (() => o.divYield);
  const valOK = (lvl, i) => !o.useValuation || !o.vScore || o.vScore[i] >= o.valThresholds[lvl];
  let valBlocks = 0;

  let cash = 1 - o.corePct;
  let coreUnits = o.corePct / PX[S].c;
  let lots = [];
  const trades = [], navs = [], expo = [], closedLots = [], riskEvents = [];
  let paid = 0, target = 0, stageCap = 0;
  let inCycle = false, H = 0, candH = PX[S].c, cyc = null, cycles = [];
  let lastIdx = -999, lastPx = 0, anchorPx = 0, peakNav = 1, riskHit = null, cool = -1;
  let stopBuys = false, riskLevel = 0;

  const navOf = p => coreUnits * p + lots.reduce((a, l) => a + l.units * p, 0) + cash;

  const sell = (lot, units, p, why, i) => {
    units = Math.min(units, lot.units);
    if (units <= 1e-12) return;
    cash += units * p * (1 - fee);
    lot.units -= units; lot.sold += units; lot.proceeds += units * p * (1 - fee);
    lot.exits.push({ why, dt: PX[i].dt, px: +p.toFixed(0), frac: units / lot.q0 });
    if (lot.units <= 1e-9) { lot.closed = true; lot.closeIdx = i; }
    if (o.anchor === 'lastTx') anchorPx = p;
  };

  const closeCycle = (i) => {
    cyc.end = PX[i].dt; cyc.endIdx = i; cycles.push(cyc);
    inCycle = false; cyc = null; stageCap = 0; cool = i + 20;
    candH = PX[i].c;
  };

  for (let i = S; i <= E; i++) {
    const p = PX[i].c;
    const eq = coreUnits * p + lots.reduce((a, l) => a + l.units * p, 0);
    cash += eq * (dyAt(i) - o.feeAnn) / 252;
    cash *= (1 + o.cashRate / 252);

    // ---- 周期开启 ----
    if (!inCycle && !stopBuys && i >= S + o.W && i > cool) {
      let refH = 0;
      if (o.cycleEndMode === 'rules') {
        candH = Math.max(candH, p);
        refH = candH;
      } else {
        for (let j = i - o.W + 1; j <= i; j++) if (PX[j].c > refH) refH = PX[j].c;
      }
      const ok3 = k => i >= 2 && (1 - PX[i - 1].c / refH) >= k && (1 - PX[i - 2].c / refH) >= k;
      const sigOpen = 1 - p / refH >= o.stageDrops[0] && ok3(o.stageDrops[0]);
      if (sigOpen && !valOK(0, i)) valBlocks++;
      if (sigOpen && valOK(0, i)) {
        inCycle = true; H = refH; stageCap = o.stageCaps[0];
        cyc = { start: PX[i].dt, H: +refH.toFixed(0), startIdx: i, peakD: 0, minPx: p, hadBuys: false };
        paid = 0; target = o.stageCaps[0]; lastIdx = -999; lastPx = 0; anchorPx = 0;
      }
    }

    if (inCycle) {
      const D = 1 - p / H;
      if (D > cyc.peakD) cyc.peakD = D;
      if (p < cyc.minPx) cyc.minPx = p;

      const endedByNewHigh = o.cycleEndMode === 'newhigh' && p > H;
      const endedByRules = o.cycleEndMode === 'rules' && cyc.hadBuys && lots.length === 0;
      if (endedByNewHigh || endedByRules) {
        closeCycle(i);
      } else {
        const ok3 = k => i >= 2 && (1 - PX[i - 1].c / H) >= k && (1 - PX[i - 2].c / H) >= k;
        const sig3 = D >= o.stageDrops[2] && ok3(o.stageDrops[2]) && valOK(2, i);
        const sig2 = D >= o.stageDrops[1] && ok3(o.stageDrops[1]) && valOK(1, i);
        const sig1 = D >= o.stageDrops[0] && ok3(o.stageDrops[0]) && valOK(0, i);
        if (sig3) stageCap = Math.max(stageCap, o.stageCaps[2]);
        else if (sig2) stageCap = Math.max(stageCap, o.stageCaps[1]);
        else if (sig1) stageCap = Math.max(stageCap, o.stageCaps[0]);

        const nav = navOf(p);
        const mobVal = lots.reduce((a, l) => a + l.units * p, 0);
        const room = o.poolMode === 'cap' ? stageCap - mobVal / nav * 100 : target - paid;
        const ref = o.anchor === 'lastBuy' ? lastPx : (anchorPx || lastPx);

        if (!stopBuys && room >= 2 && i - lastIdx >= o.gap && (ref === 0 || p <= ref * (1 - o.drop))) {
          const amtPct = Math.min(o.size, room);
          let amt = Math.min(nav * amtPct / 100, cash * 0.995);
          if (amt > 1e-6) {
            const units = amt * (1 - fee) / p;
            cash -= amt;
            lots.push({ q0: units, units, cost: p * (1 + fee), peak: p, reached12: false, sold: 0,
                        stage1: false, openIdx: i, amt, proceeds: 0, exits: [], px0: p });
            if (o.poolMode === 'cum') paid += amtPct;
            cyc.hadBuys = true;
            lastIdx = i; lastPx = p; if (!anchorPx) anchorPx = p;
            trades.push({ dt: PX[i].dt, px: +p.toFixed(0), pct: +amtPct.toFixed(2), stage: stageCap });
          }
        }
      }
    }

    // ---- 逐批次退出 ----
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
        if (o.timeRule === 'v12') {
          if (held >= o.t1260) sell(lot, lot.units, p, '时间退出5年硬边界', i);
          else if (held >= o.t756 && !lot.ck756) {
            lot.ck756 = true;
            if (r <= -0.15) sell(lot, lot.units, p, '时间退出3年条件清', i);
          } else if (held >= o.t504 && r <= 0 && !lot.halfTime) {
            lot.halfTime = true; sell(lot, lot.units * 0.5, p, '时间退出2年', i);
          }
        } else {
          if (held >= o.t756) sell(lot, lot.units, p, '时间退出3年', i);
          else if (held >= o.t504 && r <= 0 && !lot.halfTime) { lot.halfTime = true; sell(lot, lot.units * 0.5, p, '时间退出2年', i); }
        }
      }
    }
    for (const l of lots) if (l.closed) closedLots.push(l);
    lots = lots.filter(l => !l.closed && l.units > 1e-12);

    // ---- 风控：分级、可升级、触发后不自动恢复 ----
    const nav = navOf(p);
    if (nav > peakNav) peakNav = nav;
    const ddNav = 1 - nav / peakNav;
    const lvl = ddNav >= o.riskLines[2] ? 3 : ddNav >= o.riskLines[1] ? 2 : ddNav >= o.riskLines[0] ? 1 : 0;
    if (lvl > riskLevel) {
      riskLevel = lvl;
      riskEvents.push({ dt: PX[i].dt, level: lvl, dd: ddNav, nav });
      if (!riskHit) riskHit = PX[i].dt;
      if (lvl >= 1) stopBuys = true;                       // 7.3 检查一：停止新增下单
      if (lvl >= 2) {                                      // 7.3 检查二：减至核心仓
        lots.forEach(l => sell(l, l.units, p, '账户风控30%', i));
        for (const l of lots) if (l.closed) closedLots.push(l);
        lots = [];
      }
      if (lvl >= 3) {                                      // 7.3 检查三：权益降至 10%
        const eqCore = coreUnits * p, navNow = navOf(p), tgtEq = navNow * o.riskTarget;
        if (eqCore > tgtEq) {
          const u = (eqCore - tgtEq) / p;
          coreUnits -= u; cash += u * p * (1 - fee);
          riskEvents[riskEvents.length - 1].coreTrim = +(u * p * 100).toFixed(2);
        }
      }
      cool = Math.max(cool, i + 20);
    }
    navs.push(navOf(p)); expo.push(1 - cash / navOf(p));
  }
  for (const l of lots) if (l.closed) closedLots.push(l);
  if (cyc) { cyc.end = null; cyc.endIdx = E; cycles.push(cyc); }
  return { navs, expo, trades, cycles, riskHit, riskEvents, riskLevel, stopBuys, closedLots,
    valBlocks, avgExp: expo.reduce((a, b) => a + b, 0) / expo.length, final: navs[navs.length - 1] };
}

function bh(eqPct, S, E, rebal, dySeries) {
  S = S || 0; E = E === undefined ? N - 1 : E;
  let cash = 1 - eqPct, units = eqPct / PX[S].c;
  const out = [];
  for (let i = S; i <= E; i++) {
    const p = PX[i].c, eq = units * p;
    cash += eq * ((dySeries ? dySeries[i] : BASE.divYield) - BASE.feeAnn) / 252;
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
    'v1.2 现行规则': {},
    'v1.1 旧口径（756 强清）': { timeRule: 'v11' },
    '文档 8.2 周期口径': { cycleEndMode: 'rules' },
    '交易费用 ×3': { costMult: 3 },
    '无止盈': { useTP: false },
    '无时间退出': { useTime: false },
    '无移动退出': { useTrail: false }
  };
  console.log('变体                        年化    回撤   波动  Sharpe 敞口  买入  风控');
  for (const [n, o] of Object.entries(VAR)) {
    const r = simulate(o), m = met(r.navs);
    console.log(n.padEnd(26), (m.cagr * 100).toFixed(2).padStart(6) + '%', (m.mdd * 100).toFixed(1).padStart(7) + '%',
      (m.vol * 100).toFixed(1).padStart(6) + '%', m.sharpe.toFixed(2).padStart(6),
      (r.avgExp * 100).toFixed(1).padStart(6) + '%', String(r.trades.length).padStart(5),
      r.riskEvents.length ? r.riskEvents.map(e => e.level).join('/') : '未触发');
  }
  console.log('\n基准:');
  const B = [['沪深300 100%', bh(1, 0, N - 1, false)], ['60/40 季再平衡', bh(0.6, 0, N - 1, true)],
             ['40% 常数·季再平衡', bh(0.40, 0, N - 1, true)], ['22% 核心·季再平衡', bh(0.22, 0, N - 1, true)]];
  for (const [n, v] of B) {
    const m = met(v);
    console.log(n.padEnd(26), (m.cagr * 100).toFixed(2).padStart(6) + '%', (m.mdd * 100).toFixed(1).padStart(7) + '%',
      (m.vol * 100).toFixed(1).padStart(6) + '%', m.sharpe.toFixed(2).padStart(6));
  }
}
