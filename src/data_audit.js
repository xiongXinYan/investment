// ============================================================================
// 数据质量审计层 v1（2026-11-08）
//
// 目的：把「数据是不是对的」从人工检查变成每次回测前的强制闸门。
// 设计原则：只报事实，不修复数据；发现硬错误即 exit 1，拒绝出数。
//
// 用法：
//   node data_audit.js              # 审计 + 生成 data_audit_report.json / data_manifest.json
//   node data_audit.js --quiet      # 仅输出结论行（供其他脚本调用）
//
// 被 phase5_run.js / phase6_stress_v16.js 等 require 时导出 runAudit()，可编程校验。
// ============================================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PT = require('../lib/paths.js');
const ROOT = PT.ROOT;
const P = PT.resolve;

const FILES = {
  hs300: 'hs300_daily_2010_2026.json',
  dividend: 'csi_dividend_2010_2026.json',
  valuation: 'valuation_semiannual_2010_2026.json'
};

const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
const r2 = (x, n = 4) => +Number(x).toFixed(n);

// ---------------------------------------------------------------------------
// 检查项注册：每条返回 { id, level, pass, detail, metrics }
// level: 'hard' 不通过即拒绝出数 | 'warn' 记录但放行 | 'info' 仅披露
// ---------------------------------------------------------------------------
function runAudit(opt = {}) {
  const checks = [];
  const add = (id, level, pass, detail, metrics) => checks.push({ id, level, pass, detail, metrics: metrics || null });

  // ---- 0. 读取与哈希 ----
  const raw = {}, parsed = {};
  for (const [k, f] of Object.entries(FILES)) {
    const fp = P(f);
    if (!fs.existsSync(fp)) { add('0.file.' + k, 'hard', false, '文件不存在：' + f); continue; }
    const buf = fs.readFileSync(fp);
    raw[k] = { file: f, bytes: buf.length, sha256: sha256(buf) };
    try { parsed[k] = JSON.parse(buf.toString('utf8')); }
    catch (e) { add('0.parse.' + k, 'hard', false, 'JSON 解析失败：' + e.message); }
  }
  if (checks.some(c => !c.pass)) return finalize(checks, raw, null);

  const kl = j => (j.data && j.data.klines || []).map(s => { const [d, c] = s.split(','); return { d, c: +c }; });
  const A = kl(parsed.hs300), D = kl(parsed.dividend);
  const N = A.length;

  // ---- 1. 行数与日期对齐 ----
  add('1.rows.length', 'hard', A.length === D.length,
    '沪深300 ' + A.length + ' 行 / 中证红利 ' + D.length + ' 行', { hs300: A.length, dividend: D.length });

  let misalign = 0, misEx = [];
  for (let i = 0; i < Math.min(A.length, D.length); i++) {
    if (A[i].d !== D[i].d) { misalign++; if (misEx.length < 3) misEx.push({ i, hs300: A[i].d, dividend: D[i].d }); }
  }
  add('1.rows.align', 'hard', misalign === 0,
    misalign === 0 ? '两指数日期逐一相等（按索引对齐的前提成立）' : misalign + ' 行日期不一致，禁止按索引对齐',
    { mismatch: misalign, examples: misEx });

  // ---- 2. 日期单调与重复 ----
  let dup = 0, nonmono = 0;
  for (let i = 1; i < N; i++) { if (A[i].d === A[i - 1].d) dup++; if (A[i].d < A[i - 1].d) nonmono++; }
  add('2.date.unique', 'hard', dup === 0, '重复日期 ' + dup + ' 个', { duplicate: dup });
  add('2.date.monotonic', 'hard', nonmono === 0, '逆序日期 ' + nonmono + ' 个', { nonMonotonic: nonmono });

  // ---- 3. 交易日间隔（识别异常缺口） ----
  const gaps = {};
  for (let i = 1; i < N; i++) {
    const g = Math.round((new Date(A[i].d) - new Date(A[i - 1].d)) / 864e5);
    gaps[g] = (gaps[g] || 0) + 1;
  }
  const maxGap = Math.max(...Object.keys(gaps).map(Number));
  const longGaps = [];
  for (let i = 1; i < N; i++) {
    const g = Math.round((new Date(A[i].d) - new Date(A[i - 1].d)) / 864e5);
    if (g >= 12) longGaps.push({ from: A[i - 1].d, to: A[i].d, days: g });
  }
  add('3.gap.max', 'warn', longGaps.length === 0,
    longGaps.length === 0
      ? '最大间隔 ' + maxGap + ' 个自然日（春节/国庆长假量级，无缺失交易日迹象）'
      : longGaps.length + ' 处 ≥12 日间隔，需人工确认是否为数据缺失',
    { maxGapDays: maxGap, distribution: gaps, suspicious: longGaps });

  // ---- 4. 价格有效性 ----
  let badPx = 0;
  for (const s of [A, D]) for (const x of s) if (!isFinite(x.c) || x.c <= 0) badPx++;
  add('4.price.valid', 'hard', badPx === 0, '非正/非有限价格 ' + badPx + ' 个', { invalid: badPx });

  // ---- 5. 单日异常收益 ----
  const THRESH = 0.09;
  const jumps = [];
  for (let i = 1; i < N; i++) {
    const rh = A[i].c / A[i - 1].c - 1, rd = D[i].c / D[i - 1].c - 1;
    if (Math.abs(rh) > THRESH) jumps.push({ idx: i, date: A[i].d, series: 'hs300', ret: r2(rh * 100, 3) });
    if (Math.abs(rd) > THRESH) jumps.push({ idx: i, date: D[i].d, series: 'dividend', ret: r2(rd * 100, 3) });
  }
  add('5.return.jump', 'warn', jumps.length === 0,
    jumps.length === 0 ? '无 |单日涨跌| > ' + (THRESH * 100) + '% 的记录（指数级别正常）'
      : jumps.length + ' 处异常跳变，需核对是否除权/停牌复牌/数据错录',
    { threshold: THRESH, count: jumps.length, examples: jumps.slice(0, 5) });

  // ---- 6. 两序列独立性（防止误把同一文件复制成两份） ----
  const rh = [], rd = [];
  for (let i = 1; i < N; i++) { rh.push(A[i].c / A[i - 1].c - 1); rd.push(D[i].c / D[i - 1].c - 1); }
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  const mh = mean(rh), md = mean(rd);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < rh.length; i++) { const a = rh[i] - mh, b = rd[i] - md; sxy += a * b; sxx += a * a; syy += b * b; }
  const corr = sxy / Math.sqrt(sxx * syy);
  const identical = rh.filter((x, i) => x === rd[i]).length;
  add('6.series.independent', 'hard', identical < rh.length * 0.5 && corr < 0.99,
    '两指数日收益相关系数 ' + r2(corr, 4) + '，逐日完全相同 ' + identical + ' 天 / ' + rh.length +
    '（独立序列，非复制）', { corr: r2(corr, 4), identicalDays: identical });

  // ---- 7. 股息率序列（回归前置：这是权益端 carry 的唯一输入） ----
  let V = null;
  try { V = require('./valuation_series.js'); } catch (e) { /* 下面报错 */ }
  if (!V) {
    add('7.dy.load', 'hard', false, 'valuation_series.js 无法加载：股息率序列不可得');
  } else {
    const dyH = V.dyHS, dyL = V.dyHL;
    const bad = dyH.filter(x => !isFinite(x) || x < 0).length + dyL.filter(x => !isFinite(x) || x < 0).length;
    const mn = Math.min(...dyH, ...dyL), mx = Math.max(...dyH, ...dyL);
    add('7.dy.range', 'hard', bad === 0 && mx < 0.15,
      '股息率范围 ' + r2(mn * 100, 2) + '% ~ ' + r2(mx * 100, 2) + '%，非有限或负值 ' + bad + ' 个',
      { min: r2(mn * 100, 2), max: r2(mx * 100, 2), invalid: bad, lenH: dyH.length, lenL: dyL.length });

    // 观测点覆盖与外推比例
    const obs = V.obs;
    const firstIdx = obs[0].idx, lastIdx = obs[obs.length - 1].idx;
    const outExtrap = firstIdx + (N - 1 - lastIdx);
    add('7.dy.observation', 'warn', outExtrap / N < 0.05,
      '估值观测 ' + obs.length + ' 个点，区间内覆盖 ' + firstIdx + '~' + lastIdx +
      '，区间外推 ' + outExtrap + ' 个交易日（占 ' + r2(outExtrap / N * 100, 2) + '%）',
      { observations: obs.length, firstIdx, lastIdx, extrapolatedDays: outExtrap });

    // 前视检测：插值是否使用「未来」观测点
    // 判据：对区间内任一日 i，若存在 obs[k].idx > i 且该观测值影响 out[i]，即为前视。
    // 这里用结构性检测：比较线性插值与「仅用已发生观测」的阶梯序列之差。
    let lookaheadDays = 0, maxDev = 0;
    const DY_COL = 2;                                  // rows = [date, hs[], hl[]]，DY 在资产数组第 2 位
    const stepOf = assetKey => {
      const o = new Array(N); let k = 0;
      for (let i = 0; i < N; i++) { while (k < obs.length - 1 && obs[k + 1].idx <= i) k++; o[i] = obs[k][assetKey][DY_COL] / 100; }
      return o;
    };
    const stH = stepOf('hs'), stL = stepOf('hl');
    for (let i = 0; i < N; i++) {
      if (obs.some(o => o.idx > i)) lookaheadDays++;
      maxDev = Math.max(maxDev, Math.abs(V.dyHS[i] - stH[i]), Math.abs(V.dyHL[i] - stL[i]));
    }
    add('7.dy.lookahead', 'warn', lookaheadDays === 0,
      '当前 dy 序列为「半年度观测线性插值」，在区间内每一日都用到下一个观测点（未来信息）；' +
      '受影响交易日 ' + lookaheadDays + '，与「仅用已发生观测」的最大偏离 ' + r2(maxDev * 100, 3) + 'pp。' +
      '已提供无前视开关（V.noLookahead），影响量级见审计报告。',
      { lookaheadDays, maxDeviationPP: r2(maxDev * 100, 3), noLookaheadAvailable: typeof V.dyHS_noLookahead !== 'undefined' });
  }

  // ---- 8. 复权口径（无法从数据自证，只能要求声明） ----
  const vm = parsed.valuation || {};
  const decl = k => (parsed[k].source || parsed[k].meta) || null;
  add('8.caliber.declared', 'warn', false,
    '两个价格文件（' + FILES.hs300 + ' / ' + FILES.dividend + '）无 source / fetched / 复权口径 字段；' +
    '代码注释声明为「价格指数（不含股息）」，需人工确认后写入 data_manifest。' +
    '估值文件 source=' + JSON.stringify(vm.source || '(无)') + '，fetched=' + JSON.stringify(vm.fetched || '(无)'),
    { hs300Meta: decl('hs300'), dividendMeta: decl('dividend'), valuationSource: vm.source || null, valuationFetched: vm.fetched || null });

  // ---- 9. 年化口径（不是数据问题，但决定所有收益读数的正确性） ----
  const calYears = (new Date(A[N - 1].d) - new Date(A[0].d)) / 31557600000;
  const dpy = N / calYears;
  add('9.annualization', 'warn', Math.abs(dpy - 252) < 1,
    '每年交易日实测 ' + r2(dpy, 2) + '（跨度 ' + r2(calYears, 2) + ' 年 / ' + N + ' 个交易日）。' +
    '用 252 做年化分母会把年化收益高估约 ' + r2((252 / dpy - 1) * 100, 2) + '%。' +
    '本仓库历史报告均为 252 口径，须并列披露日历年化值。',
    { tradingDays: N, calendarYears: r2(calYears, 4), daysPerYear: r2(dpy, 2), overstatementPct: r2((252 / dpy - 1) * 100, 2) });

  // ---- 10. 样本充分性 ----
  add('10.sample', 'info', calYears >= 10,
    '样本跨度 ' + r2(calYears, 1) + ' 年，含 ' + countEps(A) + ' 个 ≥15% 的回撤区间',
    { years: r2(calYears, 1), drawdownEpisodes: countEps(A) });

  return finalize(checks, raw, { N, calYears: r2(calYears, 4), daysPerYear: r2(dpy, 2), start: A[0].d, end: A[N - 1].d });
}

function countEps(A) {
  let pk = A[0].c, inDd = false, n = 0;
  for (const x of A) {
    if (x.c > pk) { pk = x.c; inDd = false; }
    const dd = 1 - x.c / pk;
    if (dd >= 0.15 && !inDd) { inDd = true; n++; }
  }
  return n;
}

function finalize(checks, raw, span) {
  const hardFail = checks.filter(c => c.level === 'hard' && !c.pass);
  const warns = checks.filter(c => c.level === 'warn' && !c.pass);
  return {
    generatedAt: new Date().toISOString(),
    verdict: hardFail.length ? 'FAIL' : (warns.length ? 'PASS_WITH_WARNINGS' : 'PASS'),
    hardFailCount: hardFail.length,
    warnCount: warns.length,
    span,
    checks,
    files: raw
  };
}

module.exports = { runAudit, FILES };

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
if (require.main === module) {
  const quiet = process.argv.includes('--quiet');
  const rep = runAudit();
  fs.writeFileSync(PT.out('data_audit_report.json'), JSON.stringify(rep, null, 1), 'utf8');

  // 数据清单：把哈希锁进版本记录，任何数据被动过都能发现
  const manifest = {
    note: '数据快照清单。任何一份输入文件变动都会改变 sha256，回测结果必须重新出数。',
    generatedAt: rep.generatedAt,
    verdict: rep.verdict,
    span: rep.span,
    files: rep.files
  };
  fs.writeFileSync(PT.out('data_manifest.json'), JSON.stringify(manifest, null, 1), 'utf8');

  if (!quiet) {
    console.log('=== 数据质量审计 ===');
    console.log('结论:', rep.verdict, '｜ hard fail', rep.hardFailCount, '｜ warn', rep.warnCount);
    if (rep.span) console.log('区间:', rep.span.start, '~', rep.span.end, '｜', rep.span.tradingDays || rep.span.N, '个交易日 ｜', rep.span.calYears, '年 ｜', rep.span.daysPerYear, '交易日/年');
    console.log('');
    for (const c of rep.checks) {
      const tag = c.pass ? (c.level === 'info' ? 'info' : ' ok ') : (c.level === 'hard' ? 'FAIL' : 'WARN');
      console.log('[' + tag + '] ' + c.id.padEnd(22) + ' ' + c.detail);
    }
    console.log('');
    console.log('→ 已写入 data_audit_report.json / data_manifest.json');
  } else {
    console.log('[data_audit] ' + rep.verdict + ' (hard=' + rep.hardFailCount + ', warn=' + rep.warnCount + ')');
  }
  if (rep.hardFailCount > 0) process.exit(1);
}
