// ============================================================================
// 实盘执行模拟器 v1（2026-11-08）
//
// 解决什么问题：回测引擎假设「任意份额、按比例成交、10bp 滑点」，实盘不是。
// 实盘受三个硬约束，回测里一个都没有：
//   ① 最小交易单位：买入必须 100 份整数倍（ETF 一手 = 100 份）
//   ② 最低佣金：每笔 5 元起（万 2.5 的费率下，成交额 2 万元以下都被这个地板价覆盖）
//   ③ T+1：股票型 ETF 当日买入当日不可卖
// 本脚本把这三条加回去，回答两个问题：
//   Q1 50 万元、35% 权益、季末再平衡，每季实际该买卖多少份？
//   Q2 加上整手约束与最低佣金后，净值比回测差多少？
//
// 用法：
//   node execution_simulator.js                 # 全期回放，输出与回测的差异
//   node execution_simulator.js --orders 2024  # 只看某一年的季度订单明细
//   node execution_simulator.js --capital 300000 --eq 0.35
// ============================================================================
const B = require('./phase2_indices.js');
const ENG = require('./bt_r_clause.js');

// ---------------------------------------------------------------------------
// 实盘参数（与回测假设的差异全部集中在这里，改一处即可切换券商/账户）
// ---------------------------------------------------------------------------
const REAL = {
  lotSize: 100,             // ETF 最小买入单位（份）
  commissionRate: 0.00025,  // 佣金万 2.5（双边）
  commissionMin: 5,         // 每笔最低 5 元
  slippageBp: 10,           // 单边滑点 10bp（与回测同口径，便于对照）
  stampDuty: 0,             // ETF 场内免印花税
  transferFee: 0,           // ETF 免过户费
  priceUnit: 1000,          // 用「指数点位 / 1000」作为 ETF 单位价格（510330 ≈ 4 元量级）
  tPlus1: true              // 股票型 ETF 当日买入不可卖
};

// 回测假设（bt_r_clause.js）：可任意小数份额、按收盘价成交、无最低佣金
const BT = { lotSize: 0, commissionMin: 0, tPlus1: false };

const num = (x, n = 2) => +Number(x).toFixed(n);

// ---------------------------------------------------------------------------
// 单次再平衡的订单生成（本模拟器的核心）
//
// 输入：当前持仓、目标权重、两个价格、可用现金、可卖份额
// 输出：订单列表 + 成交后状态 + 未能达标的残差
// ---------------------------------------------------------------------------
function planRebalance(st, target) {
  const { cash, shares, prices, sellable, equityTarget, w } = st;
  const cfg = st.cfg || REAL;

  const navPre = cash + shares.H * prices.H + shares.D * prices.D;
  const wantEquity = navPre * equityTarget;
  const wantH = wantEquity * (1 - w);
  const wantD = wantEquity * w;

  const orders = [];
  let cashNow = cash;
  let sH = shares.H, sD = shares.D;
  let buyBlocked = 0;

  // ---- 第一步：卖出（先卖后买，卖出款当日可用于买入） ----
  for (const k of ['H', 'D']) {
    const px = prices[k], cur = k === 'H' ? sH : sD;
    const want = k === 'H' ? wantH : wantD;
    const curVal = cur * px;
    if (curVal <= want * 1.0005) continue;              // 未超配，无需卖
    const avail = sellable ? sellable[k] : cur;
    // 目标卖出份额；允许卖出零股（沪市 ETF 余额可一次性卖出）
    let sellSh = Math.min(avail, Math.ceil((curVal - want) / px));
    // 若卖完会低于目标，则按整手向下取整，避免过度卖出
    if (cur - sellSh > 0 && (cur - sellSh) * px < want) sellSh = Math.floor((curVal - want) / px / cfg.lotSize) * cfg.lotSize;
    sellSh = Math.min(sellSh, avail);
    if (sellSh <= 0) continue;
    const pxExec = px * (1 - cfg.slippageBp / 10000);
    const notional = sellSh * pxExec;
    const comm = Math.max(cfg.commissionMin, notional * cfg.commissionRate);
    cashNow += notional - comm - notional * cfg.stampDuty;
    if (k === 'H') sH -= sellSh; else sD -= sellSh;
    orders.push({ code: k, side: 'SELL', shares: sellSh, pxRef: num(px), pxExec: num(pxExec, 4),
      notional: num(notional), commission: num(comm), why: '超配减仓' });
  }

  // ---- 第二步：买入（受可用现金与整手约束） ----
  for (const k of ['H', 'D']) {
    const px = prices[k], cur = k === 'H' ? sH : sD;
    const want = k === 'H' ? wantH : wantD;
    const gap = want - cur * px;
    if (gap <= px * cfg.lotSize) continue;              // 差不足一手，不交易
    const pxExec = px * (1 + cfg.slippageBp / 10000);
    // 可用现金能买多少（含佣金）
    const affordable = Math.floor(cashNow / (pxExec * (1 + cfg.commissionRate)) / cfg.lotSize) * cfg.lotSize;
    let buySh = Math.floor(gap / pxExec / cfg.lotSize) * cfg.lotSize;
    if (buySh > affordable) { buySh = affordable; buyBlocked++; }
    if (buySh <= 0) continue;
    const notional = buySh * pxExec;
    const comm = Math.max(cfg.commissionMin, notional * cfg.commissionRate);
    if (notional + comm > cashNow) { buyBlocked++; continue; }
    cashNow -= notional + comm;
    if (k === 'H') sH += buySh; else sD += buySh;
    orders.push({ code: k, side: 'BUY', shares: buySh, pxRef: num(px), pxExec: num(pxExec, 4),
      notional: num(notional), commission: num(comm), why: '低配补仓' });
  }

  const navPost = cashNow + sH * prices.H + sD * prices.D;
  const eqPost = (sH * prices.H + sD * prices.D) / navPost;
  return {
    orders, cash: cashNow, shares: { H: sH, D: sD }, navPre, navPost,
    eqPost, eqTarget: equityTarget, eqResidualPP: num((eqPost - equityTarget) * 100, 3),
    buyBlocked,
    cashResidual: num(cashNow),
    totalCommission: num(orders.reduce((a, o) => a + o.commission, 0))
  };
}

// ---------------------------------------------------------------------------
// 全期回放：把回测的季度再平衡换成「带实盘约束」的执行
// ---------------------------------------------------------------------------
function replay(opt = {}) {
  const capital = opt.capital || 500000;
  const eq = opt.eq === undefined ? 0.35 : opt.eq;
  const w = opt.w === undefined ? 0.25 : opt.w;
  const interval = opt.interval || 63;
  const execLag = opt.execLag === undefined ? 1 : opt.execLag;   // 季末信号 → 次日成交（与回测同口径）
  const cfg = Object.assign({}, REAL, opt.cfg || {});
  if (opt.lotSize !== undefined) cfg.lotSize = opt.lotSize;
  if (opt.commissionRate !== undefined) cfg.commissionRate = opt.commissionRate;
  if (opt.commissionMin !== undefined) cfg.commissionMin = opt.commissionMin;
  // feeBp 覆盖：给了就按 notional × bp 计费且无最低佣金（复刻回测的 5bp 假设）
  if (opt.feeBp !== undefined) { cfg.commissionRate = opt.feeBp / 10000; cfg.commissionMin = 0; }
  const btnav = opt.benchmarkNav || null;   // 回测净值序列（同一 eq），用于逐日对照

  const pxOf = i => ({ H: B.A[i].c / cfg.priceUnit, D: B.D[i].c / cfg.priceUnit });
  const p0 = pxOf(0);
  let shares = { H: 0, D: 0 };
  let cash = capital;
  // 初始建仓：同样受整手约束（chargeInit=false 时不计成本，用于复刻回测基线）
  const initCfg = opt.chargeInit === false ? Object.assign({}, cfg, { commissionRate: 0, slippageBp: 0 }) : cfg;
  const init = planRebalance({
    cash, shares, prices: p0, sellable: null,
    equityTarget: eq, w, cfg: initCfg
  });
  shares = init.shares; cash = init.cash;
  const initOrders = init.orders;

  const nav = [capital], log = [];
  let turnover = 0, fees = 0, rebalCount = 0, blockedDays = 0;
  let pending = false;

  for (let i = 1; i < B.N; i++) {
    const px = pxOf(i);
    // 股息 carry + 管理费 + 现金利息（与回测口径一致，便于隔离「执行差异」）
    const vH = shares.H * px.H, vD = shares.D * px.D, e2 = vH + vD;
    const divCash = (vH * B.V.dyHS[i] + vD * B.V.dyHL[i]) / 252;
    cash += divCash - e2 * 0.005 / 252;
    cash *= 1 + B.SEG_RATE[i] / 252;

    // T+1 挂单：昨日季末信号，今日收盘成交
    if (pending) {
      const r = planRebalance({ cash, shares, prices: px, sellable: shares, equityTarget: eq, w, cfg });
      if (r.orders.length) {
        log.push({ idx: i, date: B.DATES[i], navPre: num(r.navPre), navPost: num(r.navPost),
          eqBefore: num((vH + vD) / (cash + vH + vD), 4), eqAfter: num(r.eqPost, 4),
          orders: r.orders, commission: r.totalCommission, blocked: r.buyBlocked });
        rebalCount++;
        turnover += r.orders.reduce((a, o) => a + o.notional, 0);
        fees += r.totalCommission;
        if (r.buyBlocked) blockedDays++;
      }
      shares = r.shares; cash = r.cash;
      pending = false;
    } else if (i % interval === 0) {
      if (execLag === 0) {
        const r = planRebalance({ cash, shares, prices: px, sellable: shares, equityTarget: eq, w, cfg });
        if (r.orders.length) {
          log.push({ idx: i, date: B.DATES[i], navPre: num(r.navPre), navPost: num(r.navPost),
            eqBefore: num((vH + vD) / (cash + vH + vD), 4), eqAfter: num(r.eqPost, 4),
            orders: r.orders, commission: r.totalCommission, blocked: r.buyBlocked });
          rebalCount++;
          turnover += r.orders.reduce((a, o) => a + o.notional, 0);
          fees += r.totalCommission;
          if (r.buyBlocked) blockedDays++;
        }
        shares = r.shares; cash = r.cash;
      } else pending = true;
    }
    nav.push(cash + shares.H * px.H + shares.D * px.D);
  }

  // 绩效
  const m = navMetrics(nav.map(x => x / capital));
  const out = {
    setup: { capital, eq, w, interval, execLag, lotSize: cfg.lotSize, commissionRate: cfg.commissionRate, commissionMin: cfg.commissionMin, slippageBp: cfg.slippageBp },
    initOrders, rebalCount, totalTurnover: num(turnover), totalCommission: num(fees),
    commissionPctOfCapital: num(fees / capital * 100, 3),
    buyBlockedTimes: blockedDays,
    final: { cash: num(cash), sharesH: shares.H, sharesD: shares.D, nav: num(nav[nav.length - 1]) },
    metrics: m,
    nav,
    log
  };

  // 与回测净值对照（同 eq/w/interval，但回测无整手与最低佣金）
  if (btnav) {
    const a = nav.map(x => x / capital), b = btnav;
    let maxRel = 0, at = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const d = Math.abs(a[i] - b[i]) / b[i];
      if (d > maxRel) { maxRel = d; at = i; }
    }
    out.vsBacktest = {
      maxRelDiffPct: num(maxRel * 100, 4), atDate: B.DATES[at],
      finalDiffPct: num((a[a.length - 1] / b[b.length - 1] - 1) * 100, 4),
      note: '差异来源只有三条：整手约束、每笔最低 5 元佣金、买卖不可同时净额轧差'
    };
  }
  return out;
}

function navMetrics(nav) {
  const L = nav.length, tot = nav[L - 1] / nav[0] - 1;
  let pk = nav[0], mdd = 0;
  for (const v of nav) { if (v > pk) pk = v; const d = 1 - v / pk; if (d > mdd) mdd = d; }
  const calYears = (new Date(B.DATES[B.N - 1]) - new Date(B.DATES[0])) / 31557600000;
  return {
    totalPct: num(tot * 100, 3),
    cagr252: num((Math.pow(1 + tot, 252 / L) - 1) * 100, 3),
    cagrCal: num((Math.pow(1 + tot, 1 / calYears) - 1) * 100, 3),
    mddPct: num(mdd * 100, 3)
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
if (require.main === module) {
  const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  const capital = +(arg('--capital') || 500000);
  const eq = arg('--eq') ? +arg('--eq') : 0.35;
  const year = arg('--orders');

  // 回测基准（同参数，无整手/无最低佣金）
  const RC = { enabled: false, R: 0.20 };
  const bench = ENG.runRClause(Object.assign({}, B.P_MAIN_OPT, { eq, rClause: RC, interval: 63 }));

  const r = replay({ capital, eq, w: 0.25, interval: 63, benchmarkNav: bench.nav });

  console.log('=== 实盘执行模拟 ===');
  console.log('资金 ' + capital.toLocaleString() + ' 元 ｜ 权益敞口 ' + (eq * 100).toFixed(0) + '% ｜ 权益内红利 ' + 25 + '% ｜ 季度再平衡');
  console.log('实盘约束：买入 ' + REAL.lotSize + ' 份整数倍、佣金万 ' + (REAL.commissionRate * 10000).toFixed(1) +
    '（每笔最低 ' + REAL.commissionMin + ' 元）、滑点 ' + REAL.slippageBp + 'bp');
  console.log('');
  console.log('--- 初始建仓订单 ---');
  for (const o of r.initOrders) {
    console.log('  ' + o.side.padEnd(4) + ' ' + o.code + ' ' + String(o.shares).padStart(6) + ' 份 @ ' +
      String(o.pxExec).padStart(8) + '  金额 ' + String(o.notional).padStart(11) + '  佣金 ' + o.commission);
  }
  console.log('');
  console.log('--- 全期结果 ---');
  console.log('  再平衡次数 ' + r.rebalCount + ' ｜ 累计成交额 ' + r.totalTurnover.toLocaleString() +
    ' ｜ 累计佣金 ' + r.totalCommission.toLocaleString() + ' 元（占本金 ' + r.commissionPctOfCapital + '%）');
  console.log('  期末：现金 ' + r.final.cash.toLocaleString() + ' ｜ 沪深300 ' + r.final.sharesH + ' 份 ｜ 红利 ' + r.final.sharesD + ' 份 ｜ 净值 ' + r.final.nav.toLocaleString());
  console.log('  整手/现金约束导致缩量 ' + r.buyBlockedTimes + ' 次');
  console.log('');
  console.log('  实盘模拟  ：CAGR(日历年化) ' + r.metrics.cagrCal + '% ｜ MDD ' + r.metrics.mddPct + '% ｜ 累计 ' + r.metrics.totalPct + '%');
  console.log('  回测同参数：CAGR(日历年化) ' + navMetrics(bench.nav).cagrCal + '% ｜ MDD ' + navMetrics(bench.nav).mddPct + '% ｜ 累计 ' + navMetrics(bench.nav).totalPct + '%');
  if (r.vsBacktest) {
    console.log('  最大逐日相对偏离 ' + r.vsBacktest.maxRelDiffPct + '%（' + r.vsBacktest.atDate + '），期末差 ' + r.vsBacktest.finalDiffPct + '%');
  }
  console.log('');
  console.log('--- 资金规模扫描（整手/最低佣金在多大账户上才成为问题） ---');
  console.log('   资金      实盘CAGR   实盘MDD   佣金/本金   最大逐日偏离');
  for (const cap of [30000, 50000, 100000, 200000, 500000, 1000000, 3000000]) {
    const x = replay({ capital: cap, eq, w: 0.25, interval: 63, benchmarkNav: bench.nav });
    const n = x.nav.map(v => v / cap);
    let mx = 0; for (let i = 0; i < n.length; i++) mx = Math.max(mx, Math.abs(n[i] / bench.nav[i] - 1));
    console.log('  ' + String(cap).padStart(9) + String(x.metrics.cagrCal).padStart(10) + '%' +
      String(x.metrics.mddPct).padStart(9) + '%' + String(x.commissionPctOfCapital).padStart(10) + '%' +
      String((mx * 100).toFixed(3)).padStart(12) + '%');
  }

  if (year) {
    console.log('');
    console.log('--- ' + year + ' 年季度订单明细 ---');
    for (const x of r.log.filter(x => x.date.startsWith(year))) {
      console.log(x.date + '  净值 ' + x.navPre.toLocaleString() + '  权益 ' + (x.eqBefore * 100).toFixed(1) + '% → ' + (x.eqAfter * 100).toFixed(1) + '%');
      for (const o of x.orders) {
        console.log('    ' + o.side.padEnd(4) + ' ' + o.code + ' ' + String(o.shares).padStart(6) + ' 份 @ ' +
          String(o.pxExec).padStart(8) + '  金额 ' + String(o.notional).padStart(10) + '  佣金 ' + o.commission);
      }
    }
  }
}

module.exports = { planRebalance, replay, navMetrics, REAL };
