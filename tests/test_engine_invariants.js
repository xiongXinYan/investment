// ============================================================================
// test_engine_invariants.js — 引擎不变量测试
// 2026-11-08 ｜ 第七轮（工程可靠性）
//
// ★ 存在理由 ★
//   已有三道测试都不检查「引擎内部是否自洽」：
//     test_regression.js        锁的是【输出数字】——数字变了就报错，但不知道错在哪
//     test_report_consistency.js 锁的是【文档与数据源一致】——引擎算错时它一起错
//     test_ledger_v16.js        查的是台账（另一个程序）
//   三者都是「外部比对」。如果引擎某天把现金算成负数、把减仓放到同一天成交、
//   把高水位维护错，只要重算基线（--update）就会全部「通过」。
//
//   本文件补的是**不依赖任何历史基线**的检查：用会计恒等式与时序规则
//   直接判定路径是否合法。基线可以被人为更新，恒等式不能。
//
// ★ 一个容易搞错的命名 ★
//   引擎 opt.w 是【红利权重】，不是沪深300权重。
//   证据：uD = eq*w/D，而 D 是分红序列、dyD 作用于 vD。
//   配置里 withinEquity.hs300 = 0.75 → 引擎必须传 w = 0.25。
//   传反了不会报错，只会让 75/25 静默变成 25/75。本文件 I7 专门盯这一条。
//
// 用法：
//   node tests/test_engine_invariants.js              正常校验
//   node tests/test_engine_invariants.js --negative   负向自测：故意破坏 4 种路径，证明检查真的会失败
//   node tests/test_engine_invariants.js --verbose    打印每组明细
// ============================================================================

const fs = require('fs');
const PT = require('../lib/paths.js');
const B = require('../src/phase2_indices.js');
const ENG = require('../src/bt_r_clause.js');

const ARGS = process.argv.slice(2);
const VERBOSE = ARGS.includes('--verbose');
const NEGATIVE = ARGS.includes('--negative');

const CFG = JSON.parse(fs.readFileSync(PT.resolve('config/strategy/v1.6.json'), 'utf8'));
const EQ = CFG.allocation.equityWeightOfBook;                  // 0.35
const W_DIVIDEND = 1 - CFG.allocation.withinEquity.hs300;      // 0.25（引擎的 w 是红利权重）
const INTERVAL = CFG.rebalancing.intervalTradingDays;          // 63
const FEE = CFG.execution.feeBps / 10000;                      // 0.0005
const SLIP = CFG.execution.slippageBps / 10000;                // 0.001

// R 条款：v1.6 之后不再改变敞口，但状态机仍在代码里（备查）。
// 这里用 R=20% 复现主口径（历史上触发 0 次），另用 R=10% 强制触发一次，
// 否则「T+1 成交」「锁定 20 日」这些时序断言在主口径下永远跑不到。
const RC = (o = {}) => Object.assign({
  enabled: true, R: 0.20, eqBase: EQ, cutRatio: 0.5, lockDays: 20,
  recoverMode: 'review', reviewLagDays: 20, ddBasis: 'highWaterV',
  cutOnce: true, quarterMode: 'q63'
}, o);

const run = (o = {}) => ENG.runRClause(Object.assign({}, o, {
  eq: o.eq === undefined ? EQ : o.eq,
  rClause: o.rClause === undefined ? RC() : o.rClause
}));

// ---------------------------------------------------------------------------
// 检查器：吃一个 result 对象，吐检查行。
// 负向自测复用同一函数 —— 被破坏的数据必须喂进真实检查，而不是另写简化版。
// ---------------------------------------------------------------------------
const EPS = 1e-12;

function check(res, expect) {
  const rows = [];
  const add = (ok, id, label, detail) => rows.push({ ok, id, label, detail: detail === undefined ? '' : String(detail) });
  const n = res.nav.length;
  const N = B.N;

  // ---- I1 长度自洽 ----
  const lens = {
    dates: res.dates.length, nav: n, dd: res.dd.length, V: res.V.length,
    eqTarget: res.eqTarget.length, eqActual: res.eqActual.length, wInner: res.wInner.length
  };
  const lenOk = Object.keys(lens).every(k => lens[k] === N);
  add(lenOk, 'I1', '七条逐日序列长度一致且等于 N=4089',
    lenOk ? N : JSON.stringify(lens));

  // ---- I2 净值有限且为正 ----
  let bad = n > 0 ? -1 : 0, nonFinite = 0;
  for (let i = 0; i < n; i++) {
    if (!isFinite(res.nav[i])) { nonFinite++; if (bad < 0) bad = i; continue; }
    if (res.nav[i] <= 0 && bad < 0) bad = i;
  }
  add(bad < 0, 'I2', '净值全程有限且 > 0（NaN/0 会让后续指标静默变 0）',
    bad < 0 ? `min=${Math.min(...res.nav).toFixed(6)}` : `首个异常 idx=${bad} 非有限数 ${nonFinite} 个`);

  // ---- I3 高水位 = 历史净值最大值 ----
  let peak = -Infinity, vBad = -1;
  for (let i = 0; i < n; i++) {
    peak = Math.max(peak, res.nav[i]);
    if (Math.abs(res.V[i] - peak) > EPS) { vBad = i; break; }
  }
  add(vBad < 0, 'I3', '高水位 V 是净值的严格滚动最大值',
    vBad < 0 ? '' : `idx=${vBad} V=${res.V[vBad]} 应为 ${peak}`);

  // ---- I4 回撤 = 1 − nav/V，且 ∈ [0,1) ----
  let dBad = -1, dNeg = -1, dOne = -1;
  for (let i = 0; i < n; i++) {
    const want = 1 - res.nav[i] / res.V[i];
    if (Math.abs(res.dd[i] - want) > 1e-12 && dBad < 0) dBad = i;
    if (res.dd[i] < 0 && dNeg < 0) dNeg = i;
    if (res.dd[i] >= 1 && dOne < 0) dOne = i;
  }
  add(dBad < 0 && dNeg < 0 && dOne < 0, 'I4', '回撤 = 1 − nav/V，且全程 ∈ [0,1)',
    dBad < 0 && dNeg < 0 && dOne < 0
      ? `max=${Math.max(...res.dd).toFixed(6)}`
      : `不一致 idx=${dBad} / 负值 idx=${dNeg} / ≥1 idx=${dOne}`);

  // ---- I5 现金不为负（用权益占比 ≤ 1 判定，引擎不直接吐 cash） ----
  let eBad = -1;
  for (let i = 0; i < n; i++) {
    if (res.eqActual[i] < -EPS || res.eqActual[i] > 1 + EPS) { eBad = i; break; }
  }
  add(eBad < 0, 'I5', '权益占比 ∈ [0,1] ⇒ 现金余额不为负（不允许借钱买）',
    eBad < 0 ? `范围 ${Math.min(...res.eqActual).toFixed(6)}~${Math.max(...res.eqActual).toFixed(6)}`
      : `idx=${eBad} eqActual=${res.eqActual[eBad]}`);

  // ---- I6 目标敞口只能取约定值 ----
  const allowed = expect.enabled
    ? [expect.eqBase, expect.eqBase * expect.cutRatio]
    : [expect.eqBase];
  let tBad = -1;
  for (let i = 0; i < n; i++) {
    if (!allowed.some(a => Math.abs(res.eqTarget[i] - a) < EPS)) { tBad = i; break; }
  }
  add(tBad < 0, 'I6', `目标敞口只能取 {${allowed.map(x => x.toFixed(4)).join(', ')}}`,
    tBad < 0 ? '' : `idx=${tBad} eqTarget=${res.eqTarget[tBad]}`);

  // ---- I7 权益内部权重：75/25，且在每次重置日精确回到 25% 红利 ----
  // wInner 是【红利】占权益的比。传反 w 不会报错，只会让 75/25 变成 25/75。
  let wRange = -1;
  for (let i = 0; i < n; i++) {
    if (!(res.wInner[i] > 0 && res.wInner[i] < 1)) { wRange = i; break; }
  }
  add(wRange < 0, 'I7a', '权益内部红利占比 ∈ (0,1)（不是 0 或 1 的单腿）',
    wRange < 0 ? `漂移范围 ${Math.min(...res.wInner).toFixed(6)}~${Math.max(...res.wInner).toFixed(6)}`
      : `idx=${wRange}`);

  let wDev = 0, wDevIdx = -1;
  res.events.filter(e => e.traded !== undefined).forEach(e => {
    const d = Math.abs(res.wInner[e.idx] - W_DIVIDEND);
    if (d > wDev) { wDev = d; wDevIdx = e.idx; }
  });
  add(wDev <= 1e-9, 'I7b', '每个重置日红利权重精确回到 25%（传反 w 会在这里暴露）',
    wDev <= 1e-9 ? `最大偏差 ${wDev.toExponential(2)}` : `idx=${wDevIdx} 偏差 ${wDev.toFixed(6)}`);

  // ---- I8 季度再平衡次数 = floor((N−1)/63) ----
  const wantRebal = Math.floor((N - 1) / INTERVAL);
  add(res.counters.rebalCount === wantRebal, 'I8', `季度再平衡 ${wantRebal} 次（63 交易日整表重置）`,
    res.counters.rebalCount);

  // ---- I9 重置日：权益占比立即回到目标（差额仅剩交易成本） ----
  let rDev = 0, rDevIdx = -1;
  res.events.filter(e => e.traded !== undefined).forEach(e => {
    const d = Math.abs(res.eqActual[e.idx] - res.eqTarget[e.idx]);
    if (d > rDev) { rDev = d; rDevIdx = e.idx; }
  });
  add(rDev <= 1e-3, 'I9', '重置日权益占比 = 目标敞口（差额 ≤ 成本量级 1e-3）',
    rDev <= 1e-3 ? `最大偏差 ${rDev.toExponential(2)}` : `idx=${rDevIdx} 偏差 ${rDev.toFixed(6)}`);

  // ---- I10 T+1：信号日与成交日必须差 1 天，绝不当天成交 ----
  const tmap = new Map();
  res.events.forEach((e, i) => { if (!tmap.has(e.type)) tmap.set(e.type, []); tmap.get(e.type).push(e); });
  const triggers = tmap.get('trigger') || [];
  const cuts = tmap.get('cut') || [];
  const recSignals = tmap.get('recover-signal') || [];
  const recovers = tmap.get('recover') || [];
  add(triggers.length === cuts.length, 'I10a', '每次触发信号恰好对应一次减仓成交',
    `${triggers.length} 信号 / ${cuts.length} 成交`);
  let lagBad = '';
  triggers.forEach(tg => {
    const cut = cuts.find(c => c.idx === tg.idx + 1);
    if (!cut) lagBad += ` idx=${tg.idx} 无次日成交`;
  });
  recSignals.forEach(rs => {
    const rc2 = recovers.find(c => c.idx === rs.idx + 1);
    if (!rc2) lagBad += ` 恢复 idx=${rs.idx} 无次日成交`;
  });
  add(lagBad === '' && triggers.length === (expect.forceTrigger ? 1 : 0), 'I10b',
    expect.forceTrigger ? '强制触发档：信号次日成交（R=10% 恰好 1 次）' : '主口径下触发 0 次（v1.6 已删触发式减仓）',
    lagBad || `触发 ${triggers.length} 次`);

  // ---- I11 锁定期：恢复不得早于 lockDays ----
  // 恢复时点记在 res.triggers[]（触发记录）里，不在 events[]（事件流）里。
  // 拿 events 里的 trigger 读 recoverSignalIdx 会得到 undefined → NaN，
  // 而 `NaN >= 0` 为 false 若只写成「不满足则报错」会静默漏判，所以这里显式判有限数。
  const trigRecs = res.triggers || [];
  let lockBad = '';
  trigRecs.forEach(tg => {
    if (!(tg.recoverSignalIdx >= 0)) { lockBad += ` idx=${tg.idx} 无恢复记录`; return; }
    const gap = tg.recoverSignalIdx - tg.idx;
    if (!(gap >= expect.lockDays)) lockBad += ` idx=${tg.idx} 恢复过早(${gap}日)`;
  });
  add(lockBad === '' && trigRecs.length === triggers.length, 'I11',
    `锁定期 ≥ ${expect.lockDays} 交易日，且 review 模式下必然恢复`,
    lockBad || trigRecs.map(t => `${t.recoverSignalIdx - t.idx}日`).join(','));

  // ---- I12 成交与成本记账闭合 ----
  const sumTraded = res.events.reduce((s, e) => s + (e.traded || 0), 0);
  const sumCost = res.events.reduce((s, e) => s + (e.cost || 0), 0);
  const tol = 1e-6 * (1 + res.counters.turnover);
  add(Math.abs(sumTraded - res.counters.turnover) <= tol && Math.abs(sumCost - res.counters.feePaid) <= tol,
    'I12', '逐笔成交与成本之和 = 汇总计数器',
    `traded ${sumTraded.toFixed(8)} vs ${res.counters.turnover.toFixed(8)} / cost ${sumCost.toFixed(8)} vs ${res.counters.feePaid.toFixed(8)}`);

  return rows;
}

// ---------------------------------------------------------------------------
// 三组路径
// ---------------------------------------------------------------------------
const CASES = [
  { name: '主口径 R=20%/E=35%（真实历史，触发 0 次）', res: run(), expect: {
    enabled: true, eqBase: EQ, cutRatio: 0.5, lockDays: 20, forceTrigger: false } },
  { name: '强制触发档 R=10%（为跑通 T+1 与锁定期断言）', res: run({ rClause: RC({ R: 0.10 }) }), expect: {
    enabled: true, eqBase: EQ, cutRatio: 0.5, lockDays: 20, forceTrigger: true } },
  { name: 'V0 常数敞口（无 R 条款）', res: run({ rClause: { enabled: false, R: 0.20 } }), expect: {
    enabled: false, eqBase: EQ, cutRatio: 0.5, lockDays: 20, forceTrigger: false } }
];

const results = CASES.map(c => ({ ...c, rows: check(c.res, c.expect) }));

// ---------------------------------------------------------------------------
// 跨路径检查：确定性、成本单调性、与 metrics 数据源互证、V0 与独立参照逐位对齐
// ---------------------------------------------------------------------------
const cross = [];
const addCross = (ok, id, label, detail) => cross.push({ ok, id, label, detail: String(detail) });

const big = CASES[0].res;
const again = run();
addCross(JSON.stringify(big.nav) === JSON.stringify(again.nav) && JSON.stringify(big.events) === JSON.stringify(again.events),
  'X1', '同一输入重跑两遍，净值与事件逐位相同（无隐藏状态）',
  JSON.stringify(big.nav) === JSON.stringify(again.nav) ? 'identical' : 'DIFFERENT');

const endNav = (fee, slip) => run({ tradeFee: fee, slippage: slip }).nav.slice(-1)[0];
const n0 = endNav(0, 0), n1 = endNav(FEE, SLIP), n3 = endNav(FEE * 3, SLIP * 3);
addCross(n0 > n1 && n1 > n3, 'X2', '成本单调：费用越高终值越低（成本确实被扣，不是记账装饰）',
  `0 成本 ${n0.toFixed(6)} > 5+10bp ${n1.toFixed(6)} > 3 倍成本 ${n3.toFixed(6)}`);

// V0 与独立参照实现（mixRef，逐行复刻 bt_final.js）必须逐位相等
let maxDiff = 0;
const ref = ENG.mixRef({ eq: EQ });
CASES[2].res.nav.forEach((v, i) => { maxDiff = Math.max(maxDiff, Math.abs(v - ref[i])); });
addCross(maxDiff === 0, 'X3', 'V0 净值与独立参照 mixRef 逐位相等（不是自己校验自己）',
  `maxAbsDiff=${maxDiff}`);

// 与 metrics_v16.json 互证：主口径最大回撤必须等于已发布值（round(mdd*100,3) = 17.234）
const M = JSON.parse(fs.readFileSync(PT.resolve('metrics_v16.json'), 'utf8'));
const row20 = M.r2e.find(r => r.R_pct === 20);
const mddPct = Math.max(...big.dd) * 100;
addCross(row20 && Math.abs(mddPct - row20.mddPct) <= 5e-4, 'X4',
  '主口径 MDD 与 metrics_v16.json 的 R=20% 行一致（引擎 → 数据源同源）',
  `${mddPct.toFixed(4)}% vs ${row20 && row20.mddPct}%`);

// ---------------------------------------------------------------------------
// 负向自测：破坏数据，必须被同一套检查抓到
// ---------------------------------------------------------------------------
function negative() {
  const clone = o => JSON.parse(JSON.stringify(o));
  const expect = CASES[0].expect;
  const probes = [
    // 必须动【首个新高点】：抬高中途某一天的净值不会破坏「V = 滚动最大值」，
    // 只会让 dd 与 nav/V 对不上（那是 I4 的职责）。第一次写这个探针时正是这么写错的。
    { id: 'I3', why: '首日净值被压低 10%，但 V[0] 未跟着变', mutate: r => { r.nav[0] *= 0.9; } },
    { id: 'I4', why: '回撤数组被手工加 1pp，与 nav/V 脱钩', mutate: r => { r.dd[200] += 0.01; } },
    { id: 'I5', why: '权益占比 1.2（等于现金为负）', mutate: r => { r.eqActual[50] = 1.2; } },
    { id: 'I10b', why: '减仓成交挪到信号当日（T+0，事后可见）', mutate: r => {
      const t = r.events.findIndex(e => e.type === 'trigger');
      if (t < 0) throw new Error('负向自测需要一次触发事件，但主口径触发 0 次——请用 R=10% 的结果');
      const cut = r.events.findIndex(e => e.type === 'cut');
      r.events[cut].idx = r.events[t].idx;
    } },
    { id: 'I8', why: '再平衡次数被改成 63（少一次）', mutate: r => { r.counters.rebalCount = 63; } }
  ];
  const rows = [];
  probes.forEach(p => {
    // 第 3 个探针需要含触发的路径
    const base = p.id === 'I10b' ? CASES[1].res : CASES[0].res;
    const exp = p.id === 'I10b' ? CASES[1].expect : expect;
    const r = clone(base);
    p.mutate(r);
    const caught = check(r, exp).filter(x => x.id === p.id && !x.ok);
    rows.push({ ok: caught.length > 0, id: p.id, label: p.why,
      detail: caught.length ? '已抓到' : '★ 未被抓到 —— 该检查是空转' });
  });
  return rows;
}

// ---------------------------------------------------------------------------
// 输出
// ---------------------------------------------------------------------------
const line = '─'.repeat(72);
console.log(line);
console.log('引擎不变量测试 ｜ 不依赖历史基线，只用会计恒等式与时序规则判路径是否合法');
console.log(line);

let fail = 0;
results.forEach(c => {
  console.log(`\n▸ ${c.name}`);
  c.rows.forEach(r => {
    if (!r.ok) fail++;
    if (!r.ok || VERBOSE) console.log(`  ${r.ok ? '✓' : '✗'} ${r.id.padEnd(6)} ${r.label}${r.detail ? '  → ' + r.detail : ''}`);
  });
  const bad = c.rows.filter(r => !r.ok).length;
  console.log(`  ${bad === 0 ? '通过' : '失败'} ${c.rows.length - bad}/${c.rows.length}`);
});

console.log(`\n▸ 跨路径`);
cross.forEach(r => {
  if (!r.ok) fail++;
  if (!r.ok || VERBOSE) console.log(`  ${r.ok ? '✓' : '✗'} ${r.id.padEnd(6)} ${r.label}  → ${r.detail}`);
});
const crossBad = cross.filter(r => !r.ok).length;
console.log(`  ${crossBad === 0 ? '通过' : '失败'} ${cross.length - crossBad}/${cross.length}`);

if (NEGATIVE) {
  console.log(`\n▸ 负向自测（证明检查不是空转）`);
  const neg = negative();
  neg.forEach(r => {
    if (!r.ok) fail++;
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.id.padEnd(6)} ${r.label}  → ${r.detail}`);
  });
}

const total = results.reduce((s, c) => s + c.rows.length, 0) + cross.length;
console.log('\n' + line);
if (fail === 0) {
  console.log(`✓ 通过 ${total}/${total} 项不变量${NEGATIVE ? '（含负向自测）' : ''}`);
  process.exit(0);
}
console.log(`✗ ${fail} 项失败 —— 引擎路径不自洽，不要引用任何绩效数字`);
process.exit(1);
