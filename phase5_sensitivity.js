// ============================================================================
// phase5_sensitivity.js — 第四轮 Phase 5【正式回测 · C 表口径敏感性诊断层 + 稳健性】
// 作者：数据与回测工程师 袁据实 ｜ 2026-11-07 ｜ 第四轮（v1.6）
//
// ★ 依赖：须先运行 node phase5_run.js 生成 phase5_backtest_data.json（本脚本读回并追加）★
//
// 边界与铁律（与主回测一致）：
//  1) 单一数据源：真实历史口径网格只读本地价格/估值/现金利率；宏观读数/联网行业权重不进引擎。
//  2) 不改主引擎：runRClause / mixRef 只读复用；凡需「合成价格 / DPS 与价格分离 / 成交价冲击 /
//     到账延迟」等扩展语义，一律在本脚本内自建 runSynth 实现，绝不修改 bt_r_clause.js（主理人放行条件）。
//  3) C 表是「口径敏感性诊断层」，与 B 表（策略绩效层）物理分离；C 表差异是系统性规则差异，
//     不是抽样误差 / 置信区间，禁止写成「MDD 19.63%~20.93%」「±0.65pp」「平均约 20.3%」。
//  4) 压力路径 A/B/C 全部为情景假设、非历史事实、非预测；Cholesky + 固定种子、显式 lo/mid/hi、
//     DPS 与价格分离；单独标注「人工构造」，不得用于选参数 / 写进主结论 / 称样本外验证。
//  5) 针对触发式净效应禁止 p 值 / 置信区间 / 功效数值 / 状态机 block bootstrap 显著性推断；
//     预注册主检验之外只做符号一致性计数（≥80% / 50~80% / <50%）。
//  6) 全矩阵按维度分层报完整分布，禁止只报最优单元；每格 6 维口径标签。
//
// 输出：读回 phase5_backtest_data.json，追加 tables.C / sensitivity / propositions，
//       并把控制台摘要 append 到 phase5_backtest_stdout.txt（由 shell 重定向）。
// 复现：cd E:/Desktop/investment && node phase5_run.js && node phase5_sensitivity.js
// ============================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const P = f => path.join(__dirname, f);
const B = require('./phase2_indices.js');
const ENG = require('./bt_r_clause.js');
const DATA = JSON.parse(fs.readFileSync(P('phase5_backtest_data.json'), 'utf8'));

const pct = x => +(x * 100).toFixed(3);
const round = (x, n = 3) => +Number(x).toFixed(n);
const FEE_ANN = 0.005;
const CAL_Q_SET = new Set(B.CAL_Q);
const maxAbs = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
function met(nav) {
  // 防御性守卫：nav 含 NaN/Infinity 时，MDD 循环因 nav[i]>pk 恒 false 会静默返回 0（假象值）。
  // 按「绝不拟合虚假精度」纪律，直接抛错暴露问题，不产出任何绩效数字。
  if (!nav.length || nav.some(v => !Number.isFinite(v)))
    throw new Error('[met] nav 为空或含非有限值，拒绝产出绩效数字（防止 NaN 静默退化为 MDD=0 的假象值）');
  const y = nav.length / 252;
  const cagr = (nav[nav.length - 1] / nav[0]) ** (1 / y) - 1;
  let pk = nav[0], mdd = 0; const r = [];
  for (let i = 0; i < nav.length; i++) { if (nav[i] > pk) pk = nav[i]; const d = 1 - nav[i] / pk; if (d > mdd) mdd = d; if (i) r.push(nav[i] / nav[i - 1] - 1); }
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  const sd = Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / r.length) * Math.sqrt(252);
  return { cagr: pct(cagr), mdd: pct(mdd), vol: pct(sd), total: pct(nav[nav.length - 1] / nav[0] - 1) };
}
// dd 事后扫描（相对历史净资产高水位 V；rHits 类，固定 E 的 nav 路径诊断，不是状态机模拟）
function ddScan(nav, R) {
  let pk = nav[0], mdd = 0, hit = 0, first = -1, peak = 0;
  for (let i = 0; i < nav.length; i++) {
    if (nav[i] > pk) pk = nav[i];
    const d = 1 - nav[i] / pk;
    if (d > mdd) mdd = d;
    if (d >= R) { hit++; if (first < 0) first = i; }
    if (d > peak) peak = d;
  }
  return { mddPct: pct(mdd), headroomPP: round(R * 100 - pct(mdd), 3), hitDays: hit,
    firstHitIdx: first, firstHitDate: first >= 0 ? B.DATES[first] : null, peakDdPct: pct(peak) };
}

// ---------------------------------------------------------------------------
// 1. mixVar：参数化 6 维口径的固定 E 常数混合（复刻 mix 日循环，逐位对齐 mixRef）
//    支持：w / cashRate(数值或数组) / dyH,dyD(数值或数组) / tradeFee / slippage /
//          divTax / execLag / interval / calMode('q63'|'calQ'|'daily') / eq / S / E
// ---------------------------------------------------------------------------
function mixVar(opt = {}) {
  const o = Object.assign({ S: 0, E: B.N - 1 }, B.P_MAIN_OPT, opt);
  const S = o.S, Ee = o.E, calMode = opt.calMode || 'q63';
  const rateAt = i => typeof o.cashRate === 'number' ? o.cashRate : o.cashRate[i];
  const dyHAt = i => typeof o.dyH === 'number' ? o.dyH : o.dyH[i];
  const dyDAt = i => typeof o.dyD === 'number' ? o.dyD : o.dyD[i];
  const isQ = i => {
    if (i <= S) return false;
    if (calMode === 'calQ') return CAL_Q_SET.has(i);
    if (calMode === 'daily') return true;
    return (i - S) % o.interval === 0;
  };
  let uD = o.eq * o.w / B.D[S].c, uH = o.eq * (1 - o.w) / B.A[S].c, cash = 1 - o.eq;
  const nav = []; let pending = false;
  for (let i = S; i <= Ee; i++) {
    let vD = uD * B.D[i].c, vH = uH * B.A[i].c, e2 = vD + vH;
    const divCash = (vD * dyDAt(i) + vH * dyHAt(i)) / 252;
    const tax = divCash * o.divTax;
    cash += divCash - tax - e2 * FEE_ANN / 252;
    cash *= 1 + rateAt(i) / 252;
    const doRebal = idx => {
      const t = e2 + cash, want = t * o.eq; let nvD, nvH;
      if (o.rebal === 'frozen') { const f = want / (e2 || 1); nvD = vD * f; nvH = vH * f; }
      else { nvD = want * o.w; nvH = want * (1 - o.w); }
      const traded = Math.abs(nvD - vD) + Math.abs(nvH - vH);
      const cost = traded * (o.tradeFee + o.slippage);
      cash = t - want - cost; uD = nvD / B.D[idx].c; uH = nvH / B.A[idx].c;
      vD = nvD; vH = nvH; e2 = vD + vH;
    };
    if (pending) { doRebal(i); pending = false; }
    if (isQ(i)) { if (o.execLag === 0) doRebal(i); else pending = true; }
    const eqNow = uD * B.D[i].c + uH * B.A[i].c;
    nav.push(eqNow + cash);
  }
  return nav;
}
// V0 断言：主口径 mixVar 与 mixRef 逐位一致（整批 C 表有效前提）
const V0_ASSERT = maxAbs(mixVar({ eq: 0.40 }), ENG.mixRef({ eq: 0.40 }));
if (V0_ASSERT !== 0) throw new Error('[Phase5 sensitivity] mixVar 与 mixRef 未逐位对齐，C 表作废重跑');

// ---------------------------------------------------------------------------
// 2. 真实历史口径网格（C 表主体）：6 维变体 × 4 档 R，逐格 6 维标签
//    口径诊断层：说明「按构造不触发」对口径假设的脆弱性，不说明减半条款的收益/回撤改善幅度
// ---------------------------------------------------------------------------
const SIX_DIMS = ['权重', '现金利率', '成本', '成交', '再平衡频率', '股息处理'];
const W_DIM = [{ id: '75/25', w: 0.25 }, { id: '70/30', w: 0.30 }];
const CASH_DIM = [
  { id: '分段 3.0/2.3/1.3%', cashRate: B.SEG_RATE },
  { id: '常数 2.5%', cashRate: 0.025 },
  { id: '分段 +1pp', cashRate: B.SEG_UP },
  { id: '分段 -1pp', cashRate: B.SEG_DN },
  { id: '全期 1.3% 前瞻', cashRate: 0.013 }
];
// 成本维与成交维联动（COST 里已含 execLag）；6 维标签分别标注「成本」与「成交」
const COST_DIM = [
  { id: '无成本', cost: '无成本', exec: 'T+0', over: B.COST0 },
  { id: '费5bp+滑点10bp', cost: '费5bp+滑点10bp', exec: 'T+0', over: B.COST_T0 },
  { id: '费5bp+滑点10bp', cost: '费5bp+滑点10bp', exec: 'T+1', over: B.COST_T1 },
  { id: '费+滑点+T+1+10%股息税', cost: '费+滑点+10%股息税', exec: 'T+1', over: B.COST_T1_TAX }
];
const REBAL_DIM = [{ id: 'q63', calMode: 'q63' }, { id: '每日1日', calMode: 'daily' }];
const DIV_DIM = [
  { id: 'carry 计入', over: {}, divTaxIn: 0 },
  { id: 'carry 归零(下界压力)', over: { dyH: 0, dyD: 0 }, divTaxIn: 0 }
];
const cellLabel = (w, c, co, rb, dv) =>
  `[权重 ${w.id} | 现金 ${c.id} | 成本 ${co.cost} | 成交 ${co.exec} | 再平衡 ${rb.id} | 股息 ${dv.id}]`;

// 全网格逐单元（口径诊断，固定 E nav 事后扫 dd）
const gridCells = [];
for (const w of W_DIM) for (const c of CASH_DIM) for (const co of COST_DIM)
  for (const rb of REBAL_DIM) for (const dv of DIV_DIM) {
    const base = Object.assign({ w: w.w, cashRate: c.cashRate, calMode: rb.calMode }, co.over, dv.over);
    const perR = [];
    for (const [R, eq] of B.R2EQ) {
      const nav = mixVar(Object.assign({}, base, { eq }));
      const s = ddScan(nav, R);
      perR.push({ R: pct(R), eq: pct(eq), mddPct: s.mddPct, headroomPP: s.headroomPP,
        hitDays: s.hitDays, firstHitDate: s.firstHitDate });
    }
    gridCells.push({ dims: { w: w.id, cash: c.id, cost: co.id, exec: co.exec, rebal: rb.id, div: dv.id },
      label6: cellLabel(w, c, co, rb, dv), perR });
  }
// 按维度分层报「完整分布」（min/median/max MDD、触发变体数、薄余量数），禁止只报最优单元
function dimDistribution(dimKey, pickId) {
  const out = [];
  const ids = pickId();
  for (const id of ids) {
    const cells = gridCells.filter(g => g.dims[dimKey] === id);
    // 主口径 R=20% 一行 + 全 4 档
    const mddR20 = cells.map(g => g.perR[1].mddPct).sort((a, b) => a - b);
    const hitRows = cells.flatMap(g => g.perR.filter(x => x.hitDays > 0));
    const thinRows = cells.flatMap(g => g.perR.filter(x => x.headroomPP < 0.5));
    out.push({ value: id, cellCount: cells.length,
      R20_mddMin: mddR20[0], R20_mddMedian: mddR20[Math.floor(mddR20.length / 2)], R20_mddMax: mddR20[mddR20.length - 1],
      R20_mddRange: round(mddR20[mddR20.length - 1] - mddR20[0], 3),
      triggeredCells_anyR: cells.filter(g => g.perR.some(x => x.hitDays > 0)).length,
      hitRows_anyR: hitRows.length, thinRows_anyR: thinRows.length });
  }
  return out;
}
const byDimension = {
  '权重': dimDistribution('w', () => W_DIM.map(x => x.id)),
  '现金利率': dimDistribution('cash', () => CASH_DIM.map(x => x.id)),
  '成本': dimDistribution('cost', () => [...new Set(COST_DIM.map(x => x.id))]),
  '成交': dimDistribution('exec', () => [...new Set(COST_DIM.map(x => x.exec))]),
  '再平衡频率': dimDistribution('rebal', () => REBAL_DIM.map(x => x.id)),
  '股息处理': dimDistribution('div', () => DIV_DIM.map(x => x.id))
};
// 单变量扰动（以主口径 C 为基准，只动 1 维）——逐位呼应 P2 §4.4，用 mixVar 独立复算
const MAIN_MDD_R20 = met(mixVar({ eq: 0.40 })).mdd;   // 19.691
const singleVar = [
  { name: '基准：主口径', over: {} },
  { name: 'w 75/25→70/30', over: { w: 0.30 } },
  { name: '现金 分段→常数2.5%', over: { cashRate: 0.025 } },
  { name: '现金 分段→分段+1pp', over: { cashRate: B.SEG_UP } },
  { name: '现金 分段→分段-1pp', over: { cashRate: B.SEG_DN } },
  { name: '现金 分段→全期1.3%前瞻', over: { cashRate: 0.013 } },
  { name: '成本→无成本/T+0', over: B.COST0 },
  { name: '成本→费+滑点/T+0(仅去T+1)', over: B.COST_T0 },
  { name: '成本→+10%股息税', over: B.COST_T1_TAX },
  { name: '再平衡 季度63→每日1日', over: { calMode: 'daily' } },
  { name: '股息 计入→carry归零', over: { dyH: 0, dyD: 0 } }
].map(x => {
  const nav = mixVar(Object.assign({ eq: 0.40 }, x.over));
  const s = ddScan(nav, 0.20);
  return { name: x.name, mddPct: s.mddPct, headroomPP: s.headroomPP, hitDays: s.hitDays, firstHitDate: s.firstHitDate };
});

// q63 vs calQ 并列（单列 C 表，物理分离；主口径 R=20%）
const calQ_A = mixVar({ eq: 0.40, calMode: 'q63' });
const calQ_B = mixVar({ eq: 0.40, calMode: 'calQ' });
const calQParallel = {
  label: 'q63（默认）vs calQ（敏感性）—— 同一主口径 6 维，仅日历维不同',
  q63: { resetPoints: B.Q63.length, mddPct: met(calQ_A).mdd, hitR20: ddScan(calQ_A, 0.20).hitDays,
    firstHitR20: ddScan(calQ_A, 0.20).firstHitDate },
  calQ: { resetPoints: B.CAL_Q.length, mddPct: met(calQ_B).mdd, hitR20: ddScan(calQ_B, 0.20).hitDays,
    firstHitR20: ddScan(calQ_B, 0.20).firstHitDate },
  note: '两者是「同一策略族下两个不同确定性实现规则」的点估计，MDD 是路径泛函、不存在抽样分布；禁止写成「MDD 19.63%~20.93%」「20.28% ±0.65pp」「平均约 20.3%」「两套口径结论一致/差异可忽略」。',
  accountLayerSimplified: '「20.928%」属账户层简化口径（现金不计息/无成本/不含股息），与主口径 19.691% 不可相减或并列成区间；本表两行均为统一 6 维主口径，仅日历维不同。',
  bothDisclosed: true, notOptionalParamTable: true
};
// 股息三分法
const dividendTrichotomy = [
  { id: '① carry 计入（主口径）', status: '唯一可作 V0 对照 / 状态机绩效比较的基准',
    mddR20: met(mixVar({ eq: 0.40 })).mdd },
  { id: '② carry 归零（下界压力口径）', status: '不作 V0、不进绩效比较、不用于存废、不写触发条件；只出现在敏感性网格与数据局限披露',
    mddR20: met(mixVar({ eq: 0.40, dyH: 0, dyD: 0 })).mdd,
    note: '与价格指数不含股息叠加会双重遗漏权益回报，仅作敏感性下界；基准口径错误、仅作下界压力口径' },
  { id: '③ 季节性 DPS 路径（第三口径）', status: '数据不足、本轮未检验',
    note: '逐日除息日历「数据待更新」；统一基线下无法构造，不估算、严禁用外部核对数据混拼补齐' }
];
const realHistoryGrid = {
  design: '6 维口径变体 2(权重)×5(现金)×4(成本/成交)×2(再平衡)×2(股息)=160 变体 × 4 档 R = 640 单元（联动 B.R2EQ）；逐格写全 6 维标签',
  sixDimLabels: SIX_DIMS,
  totalCells: gridCells.length,
  v0Assertion: { mixVar_vs_mixRef_maxAbsDiff: V0_ASSERT, pass: V0_ASSERT === 0,
    note: 'mixVar 与 mixRef 主口径逐位对齐，C 表数字与 B 表同源、可复现' },
  byDimension,
  singleVariable: { note: '以主口径 C 为基准每次只动 1 维（R=20%/E=40%）；基准 MDD=' + MAIN_MDD_R20 + '%', rows: singleVar },
  calQParallel,
  dividendTrichotomy,
  separationStatement: 'C 表是诊断工具，说明「按构造不触发」对口径假设的脆弱性，不说明减半条款的收益/回撤改善幅度；C 表数字不得混入 B 表绩效列；C 表差异是系统性规则差异，不是抽样误差、不是置信区间。',
  coreVariantNote: '保留 Phase 2 的「核心合理变体」划分（季度 63 日的 80 个），不在 Phase 5 事后重划或扩编；每日 1 日再平衡仅作极值边界参照。'
};

// ---------------------------------------------------------------------------
// 3. 触发式净效应「符号一致性计数」（预注册之外只做符号计数，不做显著性）
//    用 runRClause 状态机，逐单元 (ii)-(i) 净效应；触发 0 次 ⇒ 符号 0（恒等/不可评估）
// ---------------------------------------------------------------------------
const RC = (o = {}) => Object.assign({
  enabled: true, R: 0.20, eqBase: 0.40, cutRatio: 0.5, lockDays: 20,
  recoverMode: 'review', reviewLagDays: 20, ddBasis: 'highWaterV',
  cutOnce: true, quarterMode: 'q63'
}, o);
const runRC = (eq, rc, over = {}) => ENG.runRClause(Object.assign({}, over, { eq, rClause: rc }));
function netEffectSign(eq, R, over = {}, rcOver = {}) {
  const baseI = runRC(eq, { enabled: false, R }, over);
  const stII = runRC(eq, RC(Object.assign({ R, eqBase: eq }, rcOver)), over);
  const dCagr = round(met(stII.nav).cagr - met(baseI.nav).cagr, 6);
  const dMdd = round(met(stII.nav).mdd - met(baseI.nav).mdd, 6);
  const trig = stII.triggers.length;
  const sign = trig === 0 ? 0 : (dMdd < 0 ? 1 : dMdd > 0 ? -1 : 0); // 1=MDD 改善(正效应), -1=恶化, 0=恒等/不可评估
  return { trig, dCagr, dMdd, sign, costPaid: round(stII.counters.feePaid, 6) };
}
// 符号计数维度：成本4 / reviewLag4 / 日历2 / 4档R / 8锚点口径(现金/股息/权重) 的真实历史方向
const signCells = [];
const COST_FOR_SIGN = [
  { id: '无成本T+0', over: B.COST0 }, { id: '费+滑点T+0', over: B.COST_T0 },
  { id: '费+滑点+T+1', over: B.COST_T1 }, { id: '+10%股息税', over: B.COST_T1_TAX }
];
const REVIEW_LAGS = [20, 40, 60];  // ∞ 等价 recoverMode:'none'，单列
const CAL_FOR_SIGN = ['q63', 'calQ'];
for (const cost of COST_FOR_SIGN) for (const rlag of REVIEW_LAGS) for (const cal of CAL_FOR_SIGN)
  for (const [R, eq] of B.R2EQ) {
    const ne = netEffectSign(eq, R, cost.over, { reviewLagDays: rlag, quarterMode: cal });
    signCells.push({ cost: cost.id, reviewLag: rlag, cal, R: pct(R), eq: pct(eq),
      triggers: ne.trig, dMddPP: ne.dMdd, dCagrPP: ne.dCagr, sign: ne.sign,
      label6: `[权重 75/25 | 现金 分段3.0/2.3/1.3% | 成本 ${cost.id} | 成交 ${cost.over.execLag === 1 ? 'T+1' : 'T+0'} | 再平衡 ${cal} | 股息 carry计入]` });
  }
// 8 锚点/扰动口径方向（现金-1pp / 全期1.3% / carry归零 / w70/30 / 每日 / +1pp / 去T+1 / calQ 单列）
const ANCHOR_DIRS = [
  { id: '主口径', over: {} }, { id: '现金-1pp', over: { cashRate: B.SEG_DN } },
  { id: '全期1.3%前瞻', over: { cashRate: 0.013 } }, { id: 'carry归零(下界压力)', over: { dyH: 0, dyD: 0 } },
  { id: '权重70/30', over: { w: 0.30 } }, { id: '现金+1pp', over: { cashRate: B.SEG_UP } },
  { id: '无成本T+0', over: B.COST0 }, { id: '去T+1', over: B.COST_T0 }
];
const anchorSigns = ANCHOR_DIRS.map(d => {
  const ne = netEffectSign(0.40, 0.20, d.over, { quarterMode: 'q63' });
  return { dir: d.id, triggers: ne.trig, dMddPP: ne.dMdd, sign: ne.sign };
});
function signCount(cells) {
  const pos = cells.filter(c => c.sign === 1).length;
  const neg = cells.filter(c => c.sign === -1).length;
  const zero = cells.filter(c => c.sign === 0).length;
  const triggered = cells.filter(c => c.triggers > 0).length;
  return { total: cells.length, positive: pos, negative: neg, zero, triggeredCells: triggered,
    zeroTriggerCells: cells.length - triggered,
    ratio: triggered > 0 ? round(pos / (pos + neg || 1) * 100, 1) : null };
}
const signConsistency = {
  scope: '预注册主检验（q63+R=0.20/eqBase=0.40+review20+真实历史+费5bp+滑点10bp+T+1）之外，全部只做符号一致性计数；不做 p 值/CI/功效、不对状态机做 block bootstrap 显著性推断',
  signDefinition: 'sign=1 表示 (ii)-(i) 使 MDD 改善(减半有效方向)；-1 表示恶化；0 表示触发 0 次导致 (ii)≡(i) 恒等/不可评估。净效应判据以 MDD 为主；CAGR 差仅并列记录',
  matrix: { dims: '成本4 × reviewLag3 × 日历2 × 4档R = 96 单元（真实历史）；另有锚点 8 方向 + 压力路径单列',
    cells: signCells.length, count: signCount(signCells), byCal: {
      q63: signCount(signCells.filter(c => c.cal === 'q63')),
      calQ: signCount(signCells.filter(c => c.cal === 'calQ'))
    } },
  anchors: { note: '8 锚点口径方向（真实历史 R=20%/E=40%），逐方向报触发次数与符号，不平均', rows: anchorSigns, count: signCount(anchorSigns) },
  verdict: '主口径及绝大多数合理口径触发 0 次 ⇒ (ii)≡(i)、净效应符号 0、不可评估；calQ / 现金-1pp / 全期1.3% / carry归零 等边界口径各有 1 次触发，但独立事件 <3、cutOnce 下处理事件 ≤1，方差不存在，符号计数不构成「有效/无效/显著」认定。禁止 p 值 / 置信区间 / 功效数值。',
  noiseRule: '|净效应| < 2×总成本 判「噪声主导、符号不可判定」；独立触发事件 <3 判「数据不足」'
};

// ---------------------------------------------------------------------------
// 4. 压力路径 A/B/C（人工构造，仅机制检验）—— 自建 runSynth：Cholesky + 固定种子 + DPS/价格分离
//    显式 lo/mid/hi、四档 R 全检；标「人工构造、非历史事实、非预测」；不得进主结论/选参数/称样本外验证
// ---------------------------------------------------------------------------
// 固定种子 LCG（与 bt_final.js 同族，另设并显式记录）
const SEED_BASE = 20261108;
function lcg(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
function gauss(rnd) { // Box-Muller
  let u = 0, v = 0; while (u === 0) u = rnd(); while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
// 2×2 Cholesky：相关矩阵 [[1,ρ],[ρ,1]] → L=[[1,0],[ρ,√(1-ρ²)]]
function synthSeries(id, R, pick) {
  const cfg = ENG.stressPathConfig(id, R, pick);   // 权威情景参数（脚手架只读复用）
  // 物理越界守卫：equityCumDropPct = -(dropMult × R × 100)。当 dropMult×R > 1（如 B/hi×R=30% → -105%），
  // ln(1+drop) 无实数解 → 全链 NaN → nav 崩溃。该「人工构造」情景组合本身不成立，
  // 按纪律判「不可评估」并留空：不截断到 -95%、不外推、不伪造 MDD=0 的假象值。
  if (cfg.equityCumDropPct <= -100) {
    return { cfg, invalid: true,
      invalidReason: '名义累计跌幅 ' + cfg.equityCumDropPct + '%（dropMult × R 线性外推）越过权益 -100% 物理下限，ln(1+drop) 无实数解，构造不成立',
      A: null, D: null, dates: null, rho: null, targetCumDropPct: cfg.equityCumDropPct };
  }
  const n = cfg.lengthDays, rho = cfg.corr;
  const L21 = rho, L22 = Math.sqrt(Math.max(1e-12, 1 - rho * rho));
  const rnd = lcg(SEED_BASE + ({ A: 101, B: 202, C: 303 })[id] * 1000 + ({ lo: 1, mid: 2, hi: 3 })[pick] * 10 + Math.round(R * 100));
  // 形状权重（前重后轻几何衰减 / 匀速 / 窄幅）；累计对数收益精确达标
  const targetLog = cfg.equityCumDropPct / 100;   // 负数跌幅的小数（如 -0.5）→ 用 ln(1+drop)
  const targetLn = Math.log(1 + targetLog);
  const w = [];
  for (let i = 0; i < n; i++) {
    if (id === 'A') w.push(Math.pow(0.985, i));             // 前重后轻几何衰减
    else if (id === 'B') w.push(1);                          // 匀速线性阴跌
    else w.push(1);                                          // C 窄幅（振幅另按 1/3 缩放）
  }
  const wSum = w.reduce((a, b) => a + b, 0);
  const sigma = id === 'A' ? 0.006 : id === 'B' ? 0.003 : 0.002;  // 日噪声幅度（C≈A/3）
  const eH = [], eD = [];
  for (let i = 0; i < n; i++) {
    const z1 = gauss(rnd), z2 = gauss(rnd);
    eH.push(z1); eD.push(L21 * z1 + L22 * z2);              // 相关 ρ
  }
  const meanH = eH.reduce((a, b) => a + b, 0) / n, meanD = eD.reduce((a, b) => a + b, 0) / n;
  const lnH = [], lnD = [];
  for (let i = 0; i < n; i++) {
    lnH.push(targetLn * w[i] / wSum + sigma * (eH[i] - meanH));
    lnD.push(targetLn * w[i] / wSum + sigma * (eD[i] - meanD));
  }
  // 价格序列（起点用本轮固定末点快照 4056.71 / 5531.01，量级合理；不含股息）
  let pH = 4056.71, pD = 5531.01; const A = [], D = [], dates = [];
  for (let i = 0; i < n; i++) {
    pH *= Math.exp(lnH[i]); pD *= Math.exp(lnD[i]);
    A.push({ c: pH }); D.push({ c: pD }); dates.push('SYN-' + i);
  }
  return { cfg, A, D, dates, rho, targetCumDropPct: cfg.equityCumDropPct };
}
// DPS/价格分离：起始 DPS_0 = dy_0 × P_0（恒等式 v·dy = u·DPS）；dy_0 用本地 34 点插值全期均值（单一数据源内）
const dyH0 = B.V.dyHS.reduce((a, b) => a + b, 0) / B.V.dyHS.length;
const dyD0 = B.V.dyHL.reduce((a, b) => a + b, 0) / B.V.dyHL.length;
// runSynth：复刻状态机日循环，参数化价格/现金利率/股息( DPS分离 )/成交价冲击/到账延迟
function runSynth(prices, cfg, opt = {}) {
  const A = prices.A, D = prices.D, n = A.length;
  const eq = opt.eq ?? 0.40, R = opt.R ?? 0.20, w = 0.25;
  const tradeFee = 0.0005, slippage = opt.slippage ?? 0.001, execLag = 1;
  const interval = 63, cashRatePath = cfg.cashRatePath;
  const divMode = opt.divMode || 'dpsFixed';       // 'dpsFixed'(b正确) | 'mktValueDy'(a错误) | 'dpsKappa'
  const kappa = opt.kappa ?? 0, lagDays = opt.lagDays ?? 0;
  const rc = opt.rClause || RC({ R, eqBase: eq });
  const enabled = rc.enabled, recoverMode = rc.recoverMode, reviewLagDays = rc.reviewLagDays,
    lockDays = rc.lockDays, cutRatio = rc.cutRatio, quarterMode = rc.quarterMode || 'q63';
  // 起始 DPS（每股股息）：DPS = dy_0 × P_0
  const DPS_H = dyH0 * A[0].c, DPS_D = dyD0 * D[0].c;
  const rateAt = i => i < cashRatePath.length ? cashRatePath[i] : cashRatePath[cashRatePath.length - 1];
  const isQ = i => i > 0 && (quarterMode === 'calQ' ? CAL_Q_SET.has(Math.min(i, B.N - 1)) : (i % interval === 0));
  let uD = eq * w / D[0].c, uH = eq * (1 - w) / A[0].c, cash = 1 - eq;
  let eqTarget = enabled ? rc.eqBase : eq;
  let V = 0, cutDone = false, triggerIdx = -1, lockUntilIdx = -1, recovered = false;
  let pendingCut = false, pendingRecover = false, pendingRebal = false;
  let vD = 0, vH = 0, e2 = 0;
  const nav = [], ddArr = [], events = [], triggers = [];
  let cumDivCash = 0, cutCount = 0, recoverCount = 0, rebalCount = 0, turnover = 0, feePaid = 0;
  const doReset = (idx, target, kind) => {
    const t = e2 + cash, want = t * target;
    const nvD = want * w, nvH = want * (1 - w);
    const traded = Math.abs(nvD - vD) + Math.abs(nvH - vH);
    const cost = traded * (tradeFee + slippage);
    cash = t - want - cost; uD = nvD / D[idx].c; uH = nvH / A[idx].c;
    vD = nvD; vH = nvH; e2 = vD + vH;
    turnover += traded; feePaid += cost;
    if (kind === 'cut') cutCount++; else if (kind === 'recover') recoverCount++; else rebalCount++;
    events.push({ type: kind, idx });
  };
  for (let i = 0; i < n; i++) {
    vD = uD * D[i].c; vH = uH * A[i].c; e2 = vD + vH;
    // DPS/价格分离的 divCash（恒等式 u·DPS；禁止 v^syn·dy^hist）
    let DPS_Hi = DPS_H, DPS_Di = DPS_D;
    if (divMode === 'dpsKappa' && i > lagDays) {
      const yrs = (i - lagDays) / 252;
      const f = Math.pow(1 + kappa, yrs);       // κ<0 逐年复利削减
      DPS_Hi *= f; DPS_Di *= f;
    }
    let divCash;
    if (divMode === 'mktValueDy') divCash = (vD * dyD0 + vH * dyH0) / 252;  // 错误口径 a：随合成市值缩水
    else divCash = (uD * DPS_Di + uH * DPS_Hi) / 252;                        // 正确口径 b：份额×固定DPS
    cumDivCash += divCash;
    cash += divCash - e2 * FEE_ANN / 252;
    cash *= 1 + rateAt(i) / 252;
    if (pendingCut) { doReset(i, eqTarget, 'cut'); pendingCut = false; }
    if (pendingRecover) { doReset(i, eqTarget, 'recover'); pendingRecover = false; if (pendingRebal) pendingRebal = false; }
    else if (pendingRebal) { doReset(i, eqTarget, 'rebalance'); pendingRebal = false; }
    let scheduled = false;
    if (enabled && cutDone && !recovered && recoverMode !== 'none') {
      let due = false;
      if (recoverMode === 'review') due = i >= triggerIdx + Math.max(lockDays, reviewLagDays);
      else if (recoverMode === 'quarterly') due = i >= lockUntilIdx && isQ(i);
      if (due) { recovered = true; eqTarget = rc.eqBase; pendingRecover = true; scheduled = true;
        events.push({ type: 'recover-signal', idx: i });
        const tg = triggers[triggers.length - 1]; if (tg) tg.recoverSignalIdx = i; }
    }
    if (!scheduled && isQ(i)) pendingRebal = true;
    const eqNow = uD * D[i].c + uH * A[i].c;
    const navI = eqNow + cash; nav.push(navI);
    if (navI > V) V = navI;
    const dd = 1 - navI / V; ddArr.push(dd);
    if (enabled && !cutDone && dd >= R) {
      cutDone = true; triggerIdx = i; lockUntilIdx = i + lockDays;
      eqTarget = rc.eqBase * cutRatio; pendingCut = true;
      events.push({ type: 'trigger', idx: i, dd: +dd.toFixed(6) });
      triggers.push({ idx: i, dd: +dd.toFixed(6), cutExecIdx: Math.min(i + 1, n - 1) });
    }
  }
  return { nav, dd: ddArr, events, triggers,
    counters: { cutCount, recoverCount, rebalCount, turnover, feePaid, cumDivCash },
    metrics: met(nav) };
}
// A/B/C × lo/mid/hi × 四档 R：状态机(ii) + 常数混合(i)；只报触发/符号/机制，不进主结论
const stressResults = [];
for (const id of ['A', 'B', 'C']) for (const pick of ['lo', 'mid', 'hi']) {
  const byR = [];
  for (const [R, eq] of B.R2EQ) {
    const s = synthSeries(id, R, pick);
    if (s.invalid) {
      // 人工构造情景物理越界 → 不可评估，绩效/触发/符号字段一律留空（null）
      byR.push({ R: pct(R), eq: pct(eq), equityCumDropPct: s.cfg.equityCumDropPct,
        status: '不可评估（人工构造情景物理越界）', invalidReason: s.invalidReason,
        triggerCount: null, cutCount: null, recoverCount: null,
        ii_mdd: null, i_mdd: null, dMddPP: null, firstTriggerIdx: null });
      continue;
    }
    const II = runSynth(s, s.cfg, { eq, R, divMode: 'dpsFixed', rClause: RC({ R, eqBase: eq }) });
    const I  = runSynth(s, s.cfg, { eq, R, divMode: 'dpsFixed', rClause: { enabled: false, R } });
    byR.push({ R: pct(R), eq: pct(eq), equityCumDropPct: s.cfg.equityCumDropPct,
      status: '已评估（人工构造、非历史事实、非预测；仅机制/符号计数）',
      triggerCount: II.triggers.length,
      cutCount: II.counters.cutCount, recoverCount: II.counters.recoverCount,
      ii_mdd: II.metrics.mdd, i_mdd: I.metrics.mdd,
      dMddPP: round(II.metrics.mdd - I.metrics.mdd, 3),
      firstTriggerIdx: II.triggers.length ? II.triggers[0].idx : null });
  }
  const s0 = synthSeries(id, 0.20, pick);
  stressResults.push({ id, name: s0.cfg.name, pick, lengthDays: s0.cfg.lengthDays,
    equityCumDropPct: s0.cfg.equityCumDropPct, corr: s0.cfg.corr,
    cashRateFromPct: s0.cfg.cashRateFromPct, cashRateToPct: s0.cfg.cashRateToPct,
    seed: SEED_BASE + ({ A: 101, B: 202, C: 303 })[id] * 1000 + ({ lo: 1, mid: 2, hi: 3 })[pick] * 10 + 20,
    byR });
}
// D1 命题对照：A 路径（跌幅 40~50%）「份额×固定DPS」vs「市值×历史dy」累计 divCash 分离
const d1 = [];
for (const pick of ['lo', 'mid', 'hi']) {
  const s = synthSeries('A', 0.20, pick);
  const correct = runSynth(s, s.cfg, { eq: 0.40, R: 0.20, divMode: 'dpsFixed', rClause: { enabled: false, R: 0.20 } });
  const wrong = runSynth(s, s.cfg, { eq: 0.40, R: 0.20, divMode: 'mktValueDy', rClause: { enabled: false, R: 0.20 } });
  const c = correct.counters.cumDivCash, w = wrong.counters.cumDivCash;
  d1.push({ pick, equityCumDropPct: s.cfg.equityCumDropPct,
    cumDivCash_dpsFixed: round(c, 6), cumDivCash_mktValueDy: round(w, 6),
    separationPct: round((c - w) / (w || 1) * 100, 2),
    note: 'dpsFixed(份额×固定DPS)不随价格缩水 > mktValueDy(市值×历史dy)随市值缩水' });
}
// κ 网格方向（A/B/C 分红削减，纯假设、无本轮数据标定）
const kappaDirs = [];
for (const [id, ks] of [['A', [0, -0.05, -0.10]], ['B', [0, -0.03, -0.08]], ['C', [0, -0.03, -0.08]]]) {
  const s = synthSeries(id, 0.20, 'mid');
  for (const k of ks) {
    const o = runSynth(s, s.cfg, { eq: 0.40, R: 0.20, divMode: 'dpsKappa', kappa: k, lagDays: 3 * 63,
      rClause: RC({ R: 0.20, eqBase: 0.40 }) });
    kappaDirs.push({ id, kappa: k, triggerCount: o.triggers.length, mdd: o.metrics.mdd,
      cumDivCash: round(o.counters.cumDivCash, 6) });
  }
}
const stressPaths = {
  status: '仅作「构造压力检验 / 机制检验」；全部为情景假设、非历史事实、非预测；不得用于选参数、不得写进主结论、不得称样本外验证',
  disclaimer: B.BASE.stressPaths.generalDisclaimer,
  construction: 'Cholesky 2×2 分解（相关矩阵 [[1,ρ],[ρ,1]]，L21=ρ、L22=√(1-ρ²)）+ 固定种子 LCG（SEED_BASE=' + SEED_BASE + '，逐 路径/pick/R 确定性派生）+ 前重后轻几何衰减(A)/匀速(B)/窄幅(C) 形状权重 + 累计对数收益精确达标 + 每日去均值噪声（保证相关与无反弹）',
  dpsSeparation: {
    rule: 'divCash = u·DPS（份额×每股股息），禁止 v^syn·dy^hist；DPS_0 = dy_0 × P_0（dy_0 用本地 34 点插值全期均值，单一数据源内）；κ 网格滞后 3 季度、按年复利',
    dyH0Pct: pct(dyH0), dyD0Pct: pct(dyD0),
    d1: { note: 'A 路径下「份额×固定DPS」与「市值×历史dy」累计 divCash 分离（前者不缩水、后者随市值缩水）；分离幅度与跌幅单调相关', rows: d1 },
    kappa: { note: 'κ 网格纯假设、无本轮数据标定；A（余量略增、触发更不易）与 B（含削减则余量略减）方向相反须分路径报告、不平均；C 不可预判单列口径不确定', rows: kappaDirs },
    hardConstraint: 'P1 建模约束：压力路径不得沿用 v^syn·dy^hist；已通过 runSynth 的 divMode 实现 DPS 与价格分离'
  },
  cellDisclosure: {
    totalCells: stressResults.length * 4,
    evaluatedCells: stressResults.reduce((a, s) => a + s.byR.filter(r => r.status.indexOf('已评估') === 0).length, 0),
    invalidCells: stressResults.reduce((acc, s) => acc.concat(
      s.byR.filter(r => r.status.indexOf('不可评估') === 0).map(r => ({
        id: s.id, pick: s.pick, R: r.R, eq: r.eq,
        equityCumDropPct: r.equityCumDropPct, reason: r.invalidReason }))), []),
    rule: '名义累计跌幅 ≤ -100% 的人工构造组合判「不可评估」：绩效/触发/符号字段全部留空（null），不截断到 -95%、不外推、不伪造 MDD=0 的假象值；该单元不参与任何符号一致性计数或均值；合法单元照常只做机制/符号计数',
    topLevelFieldNote: '每组 stressResults[].equityCumDropPct 是 R=0.20 基准展示值；每个 byR 单元的实际累计跌幅见 byR[].equityCumDropPct（= -(dropMult × 该档 R × 100)），二者不可混用'
  },
  results: stressResults,
  fourRFullCheck: true, d10ExplicitPick: 'lo/mid/hi 全部显式跑出，未用默认 mid 代替决策',
  limits: [
    '幅度 / 相关性 / 利率路径 / 现金到账利率全部是主观情景假设参数，非历史事实、非预测',
    '合成序列由 Cholesky + 固定种子生成，是模型输出而非真实数据，单独标注「人工构造、非历史事实」，严禁与真实价格序列混拼命名',
    'A/B 明确「无反弹」，结构性偏向「减半保护」方向，对「反弹踏空 / 20 日锁定机会成本」不公平',
    '构造锚来自同一份历史序列，与真实样本不独立，不是真正的样本外',
    '结论只对假设成立，不得用来选参数、不得宣称显著性、不得写进主结论',
    '36 个合成单元中 1 个（B/hi × R=30%，dropMult 3.5 × 0.30 → 名义累计跌幅 -105%）越过权益 -100% 物理下限，判「不可评估」并留空；其 MDD 字段为 null，不得读作 0 或「无改善」'
  ]
};

// ---------------------------------------------------------------------------
// 5. ETF 6 组成本档位（扩展语义在新增脚本实现，不改主引擎）+ 成本科目分离 + 未建模摩擦
// ---------------------------------------------------------------------------
const etfGrid = ENG.ETF_COST_GRID;   // 权威口径只读复用
// 在强制触发场景（calQ R=20% 真实历史，有 1 次 cut + 1 次 recover）下验证扩展语义可运行 + 符号计数
// 主口径触发 0 次 ⇒ premiumShock/shortHoldRedemptionFee/settleLagDays 无成交事件 ⇒ 不可评估（给档位不给点估计）
function costSensitivitySign(eq, over, rcOver = {}) {
  const baseI = runRC(eq, { enabled: false, R: 0.20 }, over);
  const st = runRC(eq, RC(Object.assign({ R: 0.20, eqBase: eq, quarterMode: 'calQ' }, rcOver)), over);
  return { triggers: st.triggers.length, cutCount: st.counters.cutCount,
    recoverCount: st.counters.recoverCount, feePaid: round(st.counters.feePaid, 6),
    dMddPP: round(met(st.nav).mdd - met(baseI.nav).mdd, 3),
    sign: st.triggers.length === 0 ? 0 : (met(st.nav).mdd < met(baseI.nav).mdd ? 1 : -1) };
}
const costSensCells = [];
for (const sBp of [0.001, 0.002, 0.003]) for (const mult of [1, 2, 3])
  for (const fee of [0.002, 0.003, 0.005, 0.010]) {
    // 注意：主引擎 FEE_ANN 固定 0.005，feeAnnual 档位仅登记不注入（不改默认值）；此处 slippage 档位可注入
    const ne = costSensitivitySign(0.40, { slippage: sBp * mult });
    costSensCells.push({ slippageBp: sBp * 1000, stressDayMultiplier: mult,
      feeAnnualRegisteredOnly: fee, triggers: ne.triggers, sign: ne.sign, dMddPP: ne.dMddPP,
      label6: `[权重 75/25 | 现金 分段3.0/2.3/1.3% | 成本 slippage${round(sBp * 1000, 1)}bp×${mult}(成本敏感性) | 成交 T+1 | 再平衡 calQ | 股息 carry计入]` });
  }
const etfCostSensitivity = {
  status: '成本敏感性、非基线口径；主口径触发 0 次 ⇒ 减半卖出/恢复买回成交事件 = 0 ⇒ premiumShock / shortHoldRedemptionFee / settleLagDays / effectiveRecoverLag 在真实历史主口径下无作用对象，判「数据不足、不可评估」，只给档位不给点估计',
  authoritySource: 'round4_phase3_etf_interface.md §三（主理人 §3.7 裁决为唯一权威口径）',
  registry: etfGrid.grid.map(g => ({ id: g.id, status: g.status, source: g.source,
    note: g.note, params: Object.fromEntries(Object.entries(g).filter(([k]) => /Bp$|Days$|Multiplier$|Interest$|Fee$|Annual$|formula|Range$/.test(k))) })),
  implementedIn: 'phase5_sensitivity.js（本脚本）：slippage / premiumShock（成交价）/ settleLagDays（到账语义）/ feeAnnual 等扩展语义一律在此实现，不注入 runRClause、不改任何默认值（主理人放行条件）',
  parallelDisclosure: '基线口径 B.P_MAIN_OPT 与成本敏感性口径并列披露；禁止用敏感性净值替换基线净值、禁止与本地价格序列混拼',
  costSubjectSeparation: 'slippage / premiumShock 属价格偏移（价差与折溢价），market impact 属占 ADV 比例，两者科目不同；禁止把前者叠加进「10 万元冲击成本可忽略」结论（后者只对占 ADV 比例这一科目成立）；报告分开列示以免下游误读为自相矛盾',
  wordingDiscipline: '行业侧 §3.2「10 万元冲击成本可忽略」改写为「基本成立，但须补两条限定」：① 2010~2019 无 000922 场内 ETF，工具可得性不成立（幸存者偏差、非摩擦）；② 冲击成本 ≠ 全部执行摩擦（折溢价/价差/资金在途/人工复核另计）；不得简写「执行成本可忽略」',
  forcedTriggerSignCount: {
    note: '仅在「calQ + R=20% 真实历史」强制触发场景（1 次 cut + 1 次 recover）验证 slippage 档位可运行性与符号一致性；feeAnnual 仅登记不注入（FEE_ANN 固定 0.005，不改默认值）',
    cells: costSensCells.length, count: signCount(costSensCells),
    sample: costSensCells.slice(0, 4)
  },
  caliberNote: 'stressDayMultiplier 仅放大减半卖出日与恢复买回日、不放大季度再平衡；本脚本主口径下这两类成交事件为 0，故乘数无实际作用对象，仅登记其口径'
};
// 未建模摩擦 6 项（只读复用 UNMODELED_FRICTIONS，逐项定性披露）
const unmodeledFrictions = ENG.UNMODELED_FRICTIONS.items.map(x => ({
  seq: x.seq, name: x.name, category: x.category || '摩擦', note: x.note,
  disclosure: '逐项定性披露，不汇总成成本数字、不给点估计；不进 B.P_MAIN_OPT、不进状态机绩效比较、不用于第 5 条存废裁决',
  c0Applicable: true,
  c1c2Applicable: [1, 4, 5, 6].includes(x.seq) ? '季度再平衡口径仍适用（恢复/复核相关项在净值层不适用）' : '净值层不适用'
}));

// ---------------------------------------------------------------------------
// 6. 命题清单三段判据汇总（成立 / 失效 / 数据不足 / 不适用）
//    仅用已核对事实（P1/P2/P3 原文 + 本轮回测确定性结果），不编造新数值
// ---------------------------------------------------------------------------
const prop = (id, verdict, basis) => ({ id, verdict, basis });
const propositions = {
  industry: {
    title: '行业侧 A1~A4 / 命题 1~4',
    note: '急性段缓冲 0.01~0.49pp 为「回撤幅度 pp」；+0.48pp/纯carry 0.21pp 为「CAGR pp/年」；两套量纲不可相减/互证。2020 段 2.68pp 接近失效边界须逐段报告、不得平均',
    seg2020: '2020-03 疫情段权重自由度 2.68pp 接近「任一段权重调整 >2pp 改善」的失效边界；逐段：2015/2016 极差 0.08~0.26pp、2020 为 2.68pp、corr 0.9637~0.9851；慢性段 2022/2021-2024 分开报告、不与急性段平均',
    rows: [
      prop('A1/命题1', '成立（方向）', '急性段 corr>0.9、账户层缓冲<0.4pp、E 减半改善≥3pp；但 2020 段 2.68pp 接近失效边界，逐段报告、不平均'),
      prop('A2/命题2', '成立', '剔除 2015 段后 corr 0.8524>0.7、2018/2020 corr>0.9、缓冲<1pp，不翻转（P2 §5.3 逐位确认）'),
      prop('A3/命题3', '数据不足', '净效应符号需真实触发事件；主口径触发 0 次 ⇒ (ii)≡(i)、不可评估；原「MDD改善>1pp且年化损失<0.3pp」判据被口径噪声淹没、不具判别力'),
      prop('A4/命题4', '成立（已裁定）', '160 变体网格核心合理变体 R=15/20/25% 触发 20/22/8 个；单变量现金-1pp/全期1.3%/carry归零各自独立使 R=20% 触发；改写「边界敏感、非结构性免疫」')
    ]
  },
  quant: {
    title: '量化 Q1~Q3 / A-1~A-9',
    rows: [
      prop('Q1', '成立（结构性判定）', '主口径四档触发 0 次、cutOnce 处理事件≤1、独立事件(gap63)=0、4 折仅 1 折含信息、n<2 ⇒ 方差/CI/t 检验不存在；净效应不可估计'),
      prop('Q2', '成立（已满足）', '现金-1pp/全期1.3%/carry归零各自独立使 R=20% 触发 1 次；去T+1 余量 +1.055pp；q63→calQ 19.627%→20.928% 触发翻转；口径极差 1.301pp = 余量 0.309pp 的 4.21 倍'),
      prop('Q3', '前半成立/后半不适用', '前半：(iv)-(i) 在 4,089 日可估计、MDD 随 E′ 下降单调、成本后符号不变；后半「达 R 才降 E 时机正确性」不可证伪（反事实需更早=择时/更晚=同一规则），属治理/偏好判断'),
      prop('A-1', '数据不足', '主口径触发次数=0 ⇒ 不可评估（用零触发模板）'),
      prop('A-2', '数据不足', '独立事件(gap63)=0 <3，集中于无事件；不得做显著性/CI'),
      prop('A-3', '数据不足', '无触发事件 ⇒ 无 20 日锁定窗口/水下期触发占比；全期水下 96.55% 属固定 E 路径结构诊断、非状态机'),
      prop('A-4', '数据不足', 'reviewLag∈{20,40,60,∞} 主口径全部触发 0 次、4 档符号恒等；∞ 等价 recoverMode: none，单列'),
      prop('A-5', '数据不足', '四条路径同时给事件窗口与全期差值：主口径 (ii)≡(i)、(ii)-(iv) 退化为 (i)-(iv) 镜像，不含触发信息'),
      prop('A-6', '部分可报', 'cost/换手 counters 已输出（cutCount=0/recoverCount=0/rebalCount=64）；净效应绝对值=0，2×成本判据不进入（触发 0 次先落不可评估）'),
      prop('A-7', '数据不足', '符号一致性计数见 signConsistency：绝大多数单元符号 0、独立事件<3，不构成有效/无效认定'),
      prop('A-8', '成立', 'C 表 4 档 R × 6 维口径 MDD/余量/触发次数已按维度分层报完整分布；q63/calQ 并列；「边界敏感、非结构性免疫」标注'),
      prop('A-9', '成立（机制检验）', '压力路径 A/B/C 共 36 个合成单元，35 个已给触发/符号（强制触发、机制是否可能/符号是否翻转）；1 个 B/hi×R=30% 因名义跌幅 -105% 越过物理下限判「不可评估」并留空；附宏观通用声明、不得进主结论/选参数')
    ]
  },
  dividend: {
    title: '红利 D1~D3',
    rows: [
      prop('D1', '成立（建模约束）', 'A 路径 dpsFixed 与 mktValueDy 累计 divCash 方向稳定分离（前者不随价格缩水、后者随市值缩水），分离幅度与跌幅单调相关；DPS 与价格分离已由 runSynth.divMode 实现；κ/payout 均标注主观情景参数、无 DPS 绝对额序列不得标定为事实'),
      prop('D2', '成立（口径定性）', 'carry 归零仅出现在敏感性网格与数据局限披露两处；R=20% 触发差异 +0.309pp→-0.082pp 归因于股息建模敏感性、非条款结构性触发；第三口径逐日除息日历数据不足、本轮未检验'),
      prop('D3', '数据不足', '状态机实测 carry 缺口：主口径触发 0 次、cutCount=0、recoverCount=0 ⇒ 无减半/恢复动作、缺口恒为 0（非「量级同一数量级」的证据）；ETF 实测分红频率/权益登记日/申赎到账周期缺失 ⇒ 税务影响只能定性披露、不得定量、不得进绩效表')
    ]
  },
  etf: {
    title: 'ETF E1 / E2 / E3',
    rows: [
      prop('E1', '数据不足', '2015-08 / 2016-01 触发日无 000922 场内 ETF（最早 2019-11-26）⇒ 工具可得性不成立、非冲击成本问题；急性日 IOPV 折溢价日频序列缺失；不得用宽基腿数据外推'),
      prop('E2', '分情形', '场内+平静日「成立」（5bp+10bp+execLag=1 足够且偏保守）；场外路径/压力日小容量红利 ETF/人工复核延迟「失效」（bp 参数不足以表达，只能给档位+定性披露）；无点估计'),
      prop('E3', '条件成立', '仅当运维写死「执行工具仅限场内 ETF」时名义 20 日≈有效；场外 settleLagDays∈{3,4,7} ⇒ 有效锁定约 24~28+ 交易日；本账户 SLA 未取到 ⇒ 只能给档位、不能给单一数值')
    ]
  },
  cards: {
    title: '策略卡 C0-P1~P3 / C1-P1~P3 / C2-P1~P3（详见 phase5_backtest_data.json → cards）',
    rows: [
      prop('C0-P1', '数据不足', DATA.cards.C0.propositions['C0-P1']),
      prop('C0-P2', '成立', DATA.cards.C0.propositions['C0-P2']),
      prop('C0-P3', '数据不足', DATA.cards.C0.propositions['C0-P3']),
      prop('C1-P1', '成立（仅实现正确）', DATA.cards['C1/C1prime'].propositions['C1-P1']),
      prop('C1-P2', '数据不足', DATA.cards['C1/C1prime'].propositions['C1-P2']),
      prop('C1-P3', '不适用', DATA.cards['C1/C1prime'].propositions['C1-P3']),
      prop('C2-P1', '成立', DATA.cards.C2.propositions['C2-P1']),
      prop('C2-P2', '不适用', DATA.cards.C2.propositions['C2-P2']),
      prop('C2-P3', '成立', DATA.cards.C2.propositions['C2-P3'])
    ]
  }
};

// ---------------------------------------------------------------------------
// 7. 组装：写回 phase5_backtest_data.json（追加 tables.C / sensitivity / propositions）
// ---------------------------------------------------------------------------
const tableC = {
  title: 'C. 口径敏感性诊断层（与 B 表物理分离）',
  separation: 'C 表回答「换一个同样合理的口径，结论会不会翻转」；差异是系统性规则差异，不是抽样误差/置信区间，不能写成「MDD 19.63%~20.93%」或「±0.65pp」；C 表数字不得混入 B 表绩效列',
  sixDimLabels: SIX_DIMS,
  realHistoryGrid,
  signConsistency,
  stressPaths,
  etfCostSensitivity,
  unmodeledFrictions,
  exDivCashCheck: DATA.tables.A.exDivCashCheck,
  costSubjectSeparationRule: ENG.PHASE5_REPORT_LAYOUT.costSubjectSeparationRule,
  note: '本表全部数字来自本地单一数据源的确定性计算或「仅登记」的权威口径，未引入宏观读数/联网行业权重/ETF 实测数据进净值'
};
DATA.tables.C = tableC;
DATA.sensitivity = {
  status: 'completed',
  realHistoryGridCells: gridCells.length,
  signMatrixCells: signCells.length,
  stressPathCombos: stressResults.length * 4,
  stressPathEvaluated: stressPaths.cellDisclosure.evaluatedCells,
  stressPathInvalid: stressPaths.cellDisclosure.invalidCells.length,
  etfCostSensCells: costSensCells.length,
  dpsSeparationImplemented: true,
  calQParallelDisclosed: true,
  dividendTrichotomy: 3,
  unmodeledFrictionItems: unmodeledFrictions.length,
  note: '全矩阵按维度分层报完整分布，禁止只报最优单元；预注册之外只做符号一致性计数；压力路径与成本敏感性不进主结论、不用于选参数'
};
DATA.propositions = propositions;
DATA.robustness = {
  title: '四、稳健性检验',
  rows: [
    { item: '样本外 / 4 折 walk-forward', result: '仅 1/4 折测试段含触发信息、3 折零信息；折间训练段重叠、非独立；V 折首重置口径；不构成样本外验证', note: '量化 §2.3(b)/§3.7；不得称「样本外验证」' },
    { item: '起点敏感性', result: '起点 2010/2013/2016/2019 分层报告、不平均', note: DATA.tables.B.sampleSplit.startSensitivity.rows.map(r => r.start + ': i_mdd=' + r.i_mdd + '%').join(' / ') },
    { item: '滚动 252 日窗口', result: 'MDD min=' + DATA.tables.B.sampleSplit.rollingWindow.mddMin + '% / median=' + DATA.tables.B.sampleSplit.rollingWindow.mddMedian + '% / max=' + DATA.tables.B.sampleSplit.rollingWindow.mddMax + '%（' + DATA.tables.B.sampleSplit.rollingWindow.windows + ' 窗）', note: '固定 E 常数混合事后路径诊断、非状态机绩效' },
    { item: '参数敏感度（成本/reviewLag/日历/4档R）', result: '96 真实历史单元 + 8 锚点方向符号计数；绝大多数触发 0 次、符号 0', note: '见 C 表 signConsistency；禁止 p 值/CI/功效' },
    { item: '成本敏感性（前后 / ETF 6 组档位）', result: '成本前后 B 表并列；ETF 6 组档位仅登记+强制触发场景符号计数，主口径触发 0 次 ⇒ 无成交事件 ⇒ 数据不足', note: '成本敏感性、非基线口径；禁止替换基线净值' },
    { item: '分市场状态（急性/慢性段）', result: '急性段 2015/2016/2018/2020 与慢性段 2022/2021-2024 分开报告、不平均；2020 段 2.68pp 接近失效边界', note: 'P1 行业侧；本轮回测不重算其量级，仅引用已核对事实' },
    { item: '压力路径 A/B/C（构造）', result: '强制触发下状态机按预期执行 trigger/cut/recover；符号一致性计数；非样本外验证', note: '人工构造、非历史事实、非预测；不得进主结论/选参数' },
    { item: 'V0 逐位对齐（整批前提）', result: '通过（四档 + (iv) maxAbsDiff=0；mixVar 与 mixRef 逐位对齐）', note: '未对齐则整批作废重跑' }
  ]
};

fs.writeFileSync(P('phase5_backtest_data.json'), JSON.stringify(DATA, null, 1));

// ---------------------------------------------------------------------------
// 8. 控制台摘要（append 到 phase5_backtest_stdout.txt）
// ---------------------------------------------------------------------------
const L = console.log;
L('');
L('===== Phase 5 敏感性诊断（C 表 / 稳健性 / 命题判据）=====');
L('【V0 断言】mixVar vs mixRef maxAbsDiff=' + V0_ASSERT + '（应为 0）');
L('【C 表真实历史口径网格】6 维标签=' + SIX_DIMS.join('/') + '；单元数=' + gridCells.length + '（160 变体 × 4 档 R）');
L('  单变量扰动 R=20% 基准 MDD=' + MAIN_MDD_R20 + '%；现金-1pp MDD=' + singleVar[4].mddPct + '% 触发=' + singleVar[4].hitDays +
  '；carry归零 MDD=' + singleVar[10].mddPct + '% 触发=' + singleVar[10].hitDays);
L('  q63 MDD=' + calQParallel.q63.mddPct + '% / calQ MDD=' + calQParallel.calQ.mddPct + '%（并列披露、不并列为可选参数、不相减成区间）');
L('  股息三分法：①carry计入 ' + dividendTrichotomy[0].mddR20 + '% / ②carry归零(下界压力) ' + dividendTrichotomy[1].mddR20 + '% / ③季节性DPS 数据不足本轮未检验');
L('【符号一致性计数】真实历史矩阵 ' + signCells.length + ' 单元：' + JSON.stringify(signConsistency.matrix.count));
L('  q63: ' + JSON.stringify(signConsistency.matrix.byCal.q63) + ' | calQ: ' + JSON.stringify(signConsistency.matrix.byCal.calQ));
L('  8 锚点方向触发次数=' + anchorSigns.map(a => a.dir + ':' + a.triggers).join(' '));
L('【压力路径 A/B/C】lo/mid/hi × 四档 R，Cholesky+固定种子(SEED_BASE=' + SEED_BASE + ')，DPS/价格分离；' + stressResults.length + ' 组 × 4 档 = ' + stressPaths.cellDisclosure.totalCells + ' 单元，已评估 ' + stressPaths.cellDisclosure.evaluatedCells);
L('  【越界披露】不可评估 ' + stressPaths.cellDisclosure.invalidCells.length + ' 单元：' + stressPaths.cellDisclosure.invalidCells.map(x => x.id + '/' + x.pick + '×R=' + x.R + '(' + x.equityCumDropPct + '%)').join('、') + '；名义跌幅越过 -100% 物理下限，绩效字段留空(null)，不截断/不外推/不伪造 MDD=0');
L('  A 路径 D1 分离(份额×固定DPS - 市值×历史dy)：' + d1.map(x => x.pick + ':' + x.separationPct + '%').join(' / ') + '（随跌幅单调）');
L('  全部标注「人工构造、非历史事实、非预测」；不得进主结论/选参数/称样本外验证');
L('【ETF 6 组档位】权威口径 ' + etfGrid.grid.length + ' 组仅登记；强制触发符号计数 ' + costSensCells.length + ' 单元；主口径触发 0 次 ⇒ 无成交事件 ⇒ 数据不足、不给点估计');
L('【未建模摩擦】' + unmodeledFrictions.length + ' 项逐项定性披露（④000922 ETF 历史缺席=幸存者偏差、非摩擦）；成本科目分离（价格偏移 vs 占ADV比例）');
L('【命题三段判据】行业 A1~A4 / 量化 Q1~Q3+A-1~A-9 / 红利 D1~D3 / ETF E1~E3 / 三卡 9 命题，全部汇总入 propositions');
L('  2020 段 2.68pp 接近失效边界逐段报告、不平均；E1 数据不足分支标注「工具可得性不成立、非冲击成本问题」');
L('已写回 phase5_backtest_data.json（tables.C / sensitivity / propositions / robustness）');
L('本内容为研究分析，不构成投资建议。');
