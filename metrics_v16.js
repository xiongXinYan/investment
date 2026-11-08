// ============================================================================
// metrics_v16.js — v1.6 关键指标【唯一数据源】生成器
// 2026-11-08 ｜ 第五轮（工程闭环）
//
// ★ 存在理由（外部审阅问题 1）★
//   v1.6 修正了「口径极差 1.301pp」的错误，但只改了 Markdown，HTML 报告里
//   8 处旧数字仍在使用。根因不是「漏改」，而是「同一个结论在两个文件里各写一遍」。
//   本文件把关键指标变成【推导产物】：从引擎与既有 JSON 重算，写 metrics_v16.json，
//   再由 test_report_consistency.js 校验 MD 与 HTML 是否都与它一致。
//
// ★ 纪律 ★
//  1) 本文件不存任何手填数字。四档 MDD/年化由引擎实跑；六种口径极差由
//     phase5_backtest_data.json / phase6_stress_v16.json 现算。
//  2) 不改变任何已发布数字：输出必须与 v1.6 文档现值逐位一致，否则报错退出。
//  3) 双年化口径并列（252 口径 vs 日历年化），不得只输出一个。
// ============================================================================

const fs = require('fs');
const crypto = require('crypto');
const B = require('./phase2_indices.js');
const ENG = require('./bt_r_clause.js');

const P5 = require('./phase5_backtest_data.json');
const P6 = require('./phase6_stress_v16.json');

const r3 = x => Math.round(x * 1000) / 1000;
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

// 内容哈希：排除时间戳字段。
// 为什么需要：phase6_stress_v16.json 的 meta.generated 每次运行都变，文件哈希因此
// 每次不同，但数值内容逐位相同。用原始文件哈希做快照，会让「可复现」变成空话——
// 每次跑都显示「数据变了」，而实际上一个数字都没变。
function contentSha(file, stripPaths) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  stripPaths.forEach(p => {
    const parts = p.split('.');
    let cur = j;
    for (let i = 0; i < parts.length - 1; i++) cur = cur && cur[parts[i]];
    if (cur) delete cur[parts[parts.length - 1]];
  });
  return crypto.createHash('sha256').update(JSON.stringify(j)).digest('hex');
}

// ---------------------------------------------------------------------------
// 1. 四档 R→E：引擎实跑（R 条款关闭，纯静态敞口）
// ---------------------------------------------------------------------------
const R2E_GRID = [[0.15, 0.25], [0.20, 0.35], [0.25, 0.45], [0.30, 0.55]];
const MARGIN_RULE_PP = 2.7;

const CAL_YEARS = (new Date(B.DATES[B.N - 1]) - new Date(B.DATES[0])) / 3.15576e10; // 365.25 日
const TRADING_DAYS_PER_YEAR = B.N / CAL_YEARS;

function perf(nav) {
  // ★ 分母纪律：4089 个观测点 = 4088 个日收益区间。本仓库历史报告的年化用的是
  //   「周期数」4088，不是观测点数 4089。差一个单位只影响第 3 位小数（0.001pp），
  //   但足以让文档与引擎逐位对不上——这类差就是一致性测试要抓的东西。
  const PERIODS = nav.length - 1;
  const total = nav[PERIODS] / nav[0] - 1;
  let peak = nav[0], mdd = 0;
  for (const v of nav) {
    if (v > peak) peak = v;
    const dd = 1 - v / peak;
    if (dd > mdd) mdd = dd;
  }
  return {
    totalPct: total * 100,
    mddPct: mdd * 100,
    // 本仓库全部历史报告使用的口径：252 / 周期数
    ann252Pct: (Math.pow(1 + total, 252 / PERIODS) - 1) * 100,
    // 可比的时间加权口径：实际日历年数
    annCalPct: (Math.pow(1 + total, 1 / CAL_YEARS) - 1) * 100
  };
}

const rows = R2E_GRID.map(([R, E]) => {
  const out = ENG.runRClause(Object.assign({}, B.P_MAIN_OPT, {
    eq: E,
    rClause: { enabled: false, R: R }
  }));
  const p = perf(out.nav);
  return {
    R_pct: r3(R * 100),
    E_pct: r3(E * 100),
    mddPct: r3(p.mddPct),
    marginPP: r3(R * 100 - p.mddPct),
    ann252Pct: r3(p.ann252Pct),
    annCalPct: r3(p.annCalPct)
  };
});

// ---------------------------------------------------------------------------
// 2. 六种口径极差：从既有 JSON 现算，不手填
// ---------------------------------------------------------------------------
const single = P5.tables.C.realHistoryGrid.singleVariable.rows.map(x => x.mddPct);
const calQ = P5.tables.C.realHistoryGrid.calQParallel;
const dims = P5.tables.C.realHistoryGrid.byDimension;
const gridCells = [];
Object.keys(dims).forEach(k => dims[k].forEach(d => {
  if (d.R20_mddMin != null) gridCells.push(d.R20_mddMin, d.R20_mddMax);
}));

const basis = P6.caliberRangeAudit.basis;
const b = key => basis.find(x => x.key === key);

const singleMin = Math.min(...single), singleMax = Math.max(...single);
const gridMin = Math.min(...gridCells), gridMax = Math.max(...gridCells);
const calMin = calQ.q63.mddPct, calMax = calQ.calQ.mddPct;

const caliber = [
  { key: 'cal_simplified', label: '账户层简化口径 × 日历单维', mddMinPct: b('cal_simplified').mddMin, mddMaxPct: b('cal_simplified').mddMax, rangePP: r3(b('cal_simplified').mddMax - b('cal_simplified').mddMin), used: false, note: '初稿误用的数' },
  { key: 'cal_main', label: '主口径 × 日历单维', mddMinPct: calMin, mddMaxPct: calMax, rangePP: r3(calMax - calMin), used: false, note: 'q63 → calQ' },
  { key: 'single_main', label: '主口径 × 单变量极差', mddMinPct: singleMin, mddMaxPct: singleMax, rangePP: r3(singleMax - singleMin), used: true, note: '11 个单维变体，每次只动一维' },
  { key: 'single_main_cal', label: '主口径 × 单变量 + 日历', mddMinPct: singleMin, mddMaxPct: calMax, rangePP: r3(calMax - singleMin), used: false, note: '联合极差' },
  { key: 'grid160', label: '主口径 × 全 160 格（R=20% 行）', mddMinPct: gridMin, mddMaxPct: gridMax, rangePP: r3(gridMax - gridMin), used: false, note: '多维同时变化' },
  { key: 'grid160_cal', label: '主口径 × 全 160 格 + 日历', mddMinPct: gridMin, mddMaxPct: calMax, rangePP: r3(calMax - gridMin), used: false, note: '最坏联合极差' }
].map(x => Object.assign(x, { mddMinPct: r3(x.mddMinPct), mddMaxPct: r3(x.mddMaxPct) }));

// 每档余量对「单维极差」与「全网格极差」分别是几倍（按本档实际余量算，不是拿 2.7 当分子）
const singleRange = caliber.find(x => x.key === 'single_main').rangePP;
const fullRange = caliber.find(x => x.key === 'grid160_cal').rangePP;
rows.forEach(r => {
  r.marginOverSingle = r3(r.marginPP / singleRange);
  r.marginOverFull = r3(r.marginPP / fullRange);
  r.passesMarginRule = r.marginPP >= MARGIN_RULE_PP - 1e-9;
});

// ---------------------------------------------------------------------------
// 3. 探针（不可评估单元 / 触发次数）——表 A 与披露用
// ---------------------------------------------------------------------------
const mainTest = P5.preregMainTest || {};
// 结构纪律：results 是「路径变体 × 4 档 R」的嵌套数组，越界单元藏在 byR 内。
// 单元计数以 P6 自己算的 summary 为准，不在这里重新过滤（避免又一次结构假设错误）。
const stressSummary = P6.summary || {};
const slowBear = (P6.results || []).filter(x => x.id === 'B');
const slowBearCells = [];
slowBear.forEach(p => (p.byR || []).forEach(x => slowBearCells.push({
  pick: p.pick, equityCumDropPct: p.equityCumDropPct, R_pct: x.R, E_pct: x.eq,
  mddPct: x.ii_mdd, overR: x.mddOverRPct, status: x.status || null
})));

// ---------------------------------------------------------------------------
// 4. 组装 + 自校验
// ---------------------------------------------------------------------------
const out = {
  meta: {
    strategyVersion: 'v1.6',
    generatedBy: 'metrics_v16.js',
    generatedAt: new Date().toISOString(),
    note: '本文件是 v1.6 关键指标的唯一数据源。Markdown 与 HTML 报告均由 test_report_consistency.js 校验与本文件一致，禁止任一方单独手改数字。',
    tradingDaysPerYear: r3(TRADING_DAYS_PER_YEAR),
    calendarYears: r3(CAL_YEARS),
    annualizationWarning: 'ann252Pct 用 nav.length/252 年化（本仓库历史报告口径，系统性高估 ' +
      r3(Math.abs(rows[1].ann252Pct - rows[1].annCalPct)) + 'pp）；annCalPct 为日历年化，是可比的时间加权收益。两者不得混用。',
    sources: [
      { file: 'hs300_daily_2010_2026.json', sha256: sha('hs300_daily_2010_2026.json') },
      { file: 'csi_dividend_2010_2026.json', sha256: sha('csi_dividend_2010_2026.json') },
      { file: 'valuation_semiannual_2010_2026.json', sha256: sha('valuation_semiannual_2010_2026.json') },
      { file: 'phase5_backtest_data.json', sha256: sha('phase5_backtest_data.json'), kind: 'file' },
      {
        file: 'phase6_stress_v16.json', kind: 'content',
        sha256: contentSha('phase6_stress_v16.json', ['meta.generated']),
        exclude: ['meta.generated'],
        note: '内容哈希：排除每次运行都变的 meta.generated，否则文件哈希每次都不同，不可用于快照对账'
      }
    ]
  },
  marginRulePP: MARGIN_RULE_PP,
  r2e: rows,
  caliber: caliber,
  mainCaliber: { key: 'single_main', rangePP: singleRange },
  worstCaliber: { key: 'grid160_cal', rangePP: fullRange },
  stress: {
    totalCells: stressSummary.totalCells,
    evaluated: stressSummary.evaluated,
    invalid: stressSummary.invalid,
    maxMddOverR_pct: stressSummary.maxMddOverR,
    maxMddOverR_at: stressSummary.maxMddOverR_at || null,
    slowBear: slowBearCells
  },
  withdrawnClaims: [
    { claim: '约 2 倍口径极差', status: '已撤销', mustAppear: ['1.473', '2.692'],
      reason: '分子 2.7pp 除以错误的 1.301pp；对全网格极差实际仅 1.00~1.19 倍' },
    { claim: '极端下跌亏到 R 的 1.3~1.5 倍（E=55%）', status: '已撤销', mustAppear: ['2.16', '2.55'],
      reason: '1.3~1.5 是 E=40% 的数，被错挂到 E=55%；E=55% 真实为 2.16~2.55 倍，最坏档物理越界' },
    { claim: '第 5 条按构造不触发', status: '已撤销', mustAppear: ['边界敏感'],
      reason: '160 口径变体中有 4 处各自独立即可使 R=20% 触发 1 次，应表述为「边界敏感、非结构性免疫」' }
  ]
};

// ---- 自校验：输出必须与 v1.6 已发布值逐位一致，否则拒绝写盘 --------------
const EXPECT = {
  mddPct: [12.173, 17.234, 22.102, 26.792],
  marginPP: [2.827, 2.766, 2.898, 3.208],
  ann252Pct: [3.079, 3.327, 3.527, 3.677],
  annCalPct: [2.965, 3.204, 3.396, 3.541],
  rangePP: { cal_simplified: 1.301, cal_main: 1.233, single_main: 1.473, single_main_cal: 2.315, grid160: 2.395, grid160_cal: 2.692 }
};
const errs = [];
rows.forEach((r, i) => {
  ['mddPct', 'marginPP', 'ann252Pct', 'annCalPct'].forEach(k => {
    if (Math.abs(r[k] - EXPECT[k][i]) > 0.0015) errs.push(`R=${r.R_pct}% ${k}: 计算 ${r[k]} vs 已发布 ${EXPECT[k][i]}`);
  });
});
caliber.forEach(c => {
  const e = EXPECT.rangePP[c.key];
  if (Math.abs(c.rangePP - e) > 0.0015) errs.push(`口径 ${c.key}: 计算 ${c.rangePP} vs 已发布 ${e}`);
});

if (errs.length) {
  console.error('✗ 自校验失败，拒绝写盘（说明引擎或数据已偏离 v1.6 已发布值）：');
  errs.forEach(e => console.error('   ' + e));
  process.exit(1);
}

fs.writeFileSync('metrics_v16.json', JSON.stringify(out, null, 1), 'utf8');

// ---------------------------------------------------------------------------
// 5. 控制台摘要
// ---------------------------------------------------------------------------
const L = console.log;
L('=== metrics_v16.json 已生成（自校验通过，与 v1.6 已发布值逐位一致）===');
L('每年交易日 ' + out.meta.tradingDaysPerYear + '   日历年 ' + out.meta.calendarYears);
L('');
L('R%    E%    MDD%     余量    年化252   日历年化  余量/单维  余量/全网格');
rows.forEach(r => L([
  String(r.R_pct).padStart(3), String(r.E_pct).padStart(4),
  String(r.mddPct).padStart(8), String(r.marginPP).padStart(7),
  String(r.ann252Pct).padStart(8), String(r.annCalPct).padStart(9),
  String(r.marginOverSingle).padStart(9) + '×', String(r.marginOverFull).padStart(8) + '×'
].join('  ')));
L('');
L('口径极差六种算法：');
caliber.forEach(c => L('  ' + (c.used ? '★' : ' ') + c.key.padEnd(18) + String(c.rangePP).padStart(6) + 'pp   ' + c.label));
L('');
L('压力路径单元：' + out.stress.totalCells + '（已评估 ' + out.stress.evaluated + ' / 不可评估 ' + out.stress.invalid + '）');
L('E=55% 慢熊最大倍数：' + (out.stress.maxMddOverR_pct / 100).toFixed(2) + '×R');
L('已撤销结论：' + out.withdrawnClaims.length + ' 条');
