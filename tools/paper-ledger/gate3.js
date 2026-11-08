#!/usr/bin/env node
// ============================================================================
// gate3.js — 第三关：12 周纸面执行 的记录与计算
// 2026-11-09 起
//
// ★ 存在理由 ★
//   台账 HTML 把状态存在浏览器 localStorage：清缓存、换电脑、换浏览器就没了，
//   而这一关要连续跑 12 周，每周一个观测，丢一次就不可重建。
//   本文件把观测序列落到仓库里（gate3_state.json，可 diff、可 review、可提交），
//   台账仍是给人看/打印的视图：export 出的备份可直接在台账里「从备份恢复」。
//
// ★ 口径（与《投资策略规划 v1.6》§8.2 一致，不得在此处改）★
//   · 权益总敞口 E 由 R 查表（R=20% → E=35%），权益内部 75/25（沪深300 / 中证红利）
//   · 建仓与再平衡按 100 股整手成交，单边成本 15bp（费 5bp + 滑点 10bp）
//   · 市值 = 份额 × 当日收盘价（不复权）；现金按实际到账年利率逐日计提
//   · 回撤以账户高水位计，建仓基准即第一个观测点（不是 1.0000 净值）
//   · 达 R 只做书面复核，不改 E、不改份额、不改 75/25、不暂停季度再平衡
//
// 用法：
//   node tools/paper-ledger/gate3.js init  --date 2026-11-06 --ph 4.124 --pd 1.563
//   node tools/paper-ledger/gate3.js week  --date 2026-11-13 --ph 4.150 --pd 1.570
//          [--confirm-outlier]   单周价格变动超过 25% 时必须显式确认，防小数点错位
//   node tools/paper-ledger/gate3.js rebal --date 2026-12-31 --ph 4.080 --pd 1.540
//   node tools/paper-ledger/gate3.js status [--json]
//   node tools/paper-ledger/gate3.js export
//   node tools/paper-ledger/gate3.js final --q1 no --q2 no --q3 no --q4 no --q5 no \
//          --verdict pass --sign "姓名 2027-01-29"
//
// 退出码：0 成功；1 参数/状态非法（此时不写任何文件）。
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DIR = __dirname;
const STATE_PATH = path.join(DIR, 'gate3_state.json');
const BACKUP_PATH = path.join(DIR, 'gate3_backup.json');
const LOG_PATH = path.join(DIR, '第三关_周记.md');

const STRATEGY_VERSION = 'v1.6';
const APP_VERSION = '1.6.1';          // 与台账 HTML 的 APP_VERSION 对齐
const BACKUP_FORMAT = 'v16_paper_ledger_backup';
const LOT = 100;
const TOL = 1e-9;
// 单周价格变动的合理上限。510300 历史上最差的单周也没到 20%，
// 取 25% 是为了拦住「4.124 录成 41.24 / 0.4124」这类量级错误，而不是拦真实行情；
// 真遇到极端周，用 --confirm-outlier 显式放行。
const OUTLIER = 0.25;

// v1.6 R→E 表（写死；与台账 HTML 的 R2E 完全一致）
const R2E = {
  0.15: { eq: 0.25, mdd: 12.173, room: 2.827, cagr: 3.079, vol: 5.153 },
  0.20: { eq: 0.35, mdd: 17.234, room: 2.766, cagr: 3.327, vol: 7.212 },
  0.25: { eq: 0.45, mdd: 22.102, room: 2.898, cagr: 3.527, vol: 9.273 },
  0.30: { eq: 0.55, mdd: 26.792, room: 3.208, cagr: 3.677, vol: 11.341 }
};

/* ---------------------------------------------------------------- 小工具 */
const r2 = x => Math.round(x * 100) / 100;
const num = v => (v === '' || v == null) ? NaN : parseFloat(v);
const pct = x => (x == null || !isFinite(x)) ? '—' : (x * 100).toFixed(2) + '%';
const pp = x => (x == null || !isFinite(x)) ? '—' : (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(2) + 'pp';
const money = x => (x == null || !isFinite(x)) ? '—' : '¥' + x.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dayDiff = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && isFinite(Date.parse(s + 'T00:00:00Z'));

function fail(msg) {
  console.error('✗ ' + msg);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.slice(0, 2) === '--') {
      const k = a.slice(2);
      const v = (argv[i + 1] != null && argv[i + 1].slice(0, 2) !== '--') ? argv[++i] : true;
      out[k] = v;
    } else out._.push(a);
  }
  return out;
}

/* ------------------------------------------------------------ 核心计算 */
// 建仓：按目标市值向下取整到 100 股整手，剩余全部留现金
// 调用方负责校验价格；本函数是纯计算，供测试直接调用
function allocate(cfg, ph, pd) {
  const eq = cfg.cap * cfg.E;
  const tgtH = eq * 0.75, tgtD = eq * 0.25;
  const sharesH = Math.floor(tgtH / (ph * LOT)) * LOT;
  const sharesD = Math.floor(tgtD / (pd * LOT)) * LOT;
  const amtH = r2(sharesH * ph), amtD = r2(sharesD * pd);
  const costH = r2(amtH * cfg.costBp / 1e4), costD = r2(amtD * cfg.costBp / 1e4);
  const cash = r2(cfg.cap - amtH - amtD - costH - costD);
  return { sharesH, sharesD, amtH, amtD, costH, costD, cost: r2(costH + costD), cash };
}

// 每周观测：市值由份额×收盘价得出，现金按实际天数计提利息
function markRow(prev, positions, o) {
  const d = dayDiff(prev.date, o.date);
  const interest = r2(prev.cash * (o.rate / 100) * d / 365);
  const cash = r2(prev.cash + interest + (o.cashAdd || 0));
  return {
    date: o.date,
    vH: r2(positions.sharesH * o.ph),
    vD: r2(positions.sharesD * o.pd),
    cash: cash,
    rate: o.rate,
    _days: d,
    _interest: interest
  };
}

// 与台账 seriesOf() 完全同构：nav / 高水位 / 回撤 / 权益占比 / 红利占权益
function seriesOf(rows) {
  let peak = -Infinity;
  return (rows || []).map(r => {
    const vH = num(r.vH), vD = num(r.vD), c = num(r.cash);
    if (!isFinite(vH) || !isFinite(vD) || !isFinite(c)) return { date: r.date, nav: null, eq: null, div: null, dd: null, peak: null };
    const nav = vH + vD + c;
    if (nav > peak) peak = nav;
    const eqBase = vH + vD;
    return {
      date: r.date, nav: nav, peak: peak,
      dd: peak > 0 ? 1 - nav / peak : 0,
      eq: nav > 0 ? eqBase / nav : null,
      div: eqBase > 0 ? vD / eqBase : null
    };
  });
}

const hitR = (dd, R) => dd != null && dd >= R - TOL;

// 已完成的周数：只数起始日（含）之后的观测，建仓基准不算一周
function weeksDone(state) {
  const st = state.cfg.start;
  return (state.rows || []).filter(r => r.date && (!st || r.date >= st)).length;
}

// 一次周记的准入校验。返回错误字符串或 null——做成纯函数，
// 是为了让「重复日期 / 倒序日期 / 价格为 0」这些守卫能被测试直接打。
function checkMark(state, o) {
  if (!isDate(o.date)) return '日期必须是 YYYY-MM-DD';
  const last = state.rows[state.rows.length - 1];
  if (!last) return '还没有建仓基准，先跑 init';
  if (o.date === last.date) return '该日期已记录（' + o.date + '），不重复写入';
  if (o.date < state.cfg.start) return '该日期早于纸面执行起始日 ' + state.cfg.start;
  if (o.date < last.date) return '日期必须晚于上一条观测 ' + last.date + '（倒序记录会让回撤算错）';
  if (!(o.ph > 0) || !(o.pd > 0)) return '价格必须为正数';
  if (!(o.rate >= 0 && o.rate <= 20)) return '现金年利率须在 0~20 之间（单位 %）';
  if (o.cashAdd != null && !isFinite(o.cashAdd)) return '现金调整必须是数值';

  // 价格量级守卫：手工录入最常见的事故不是「记晚了一天」，而是小数点错位
  // （4.124 → 41.24 / 0.4124）。它会同时改掉总资产与回撤，而回撤正是这一关
  // 唯一要衡量的东西；一旦写进去，后面所有周的高水位都被污染，且看起来一切正常。
  // 上一条观测的隐含价格可以由 vH ÷ 当前份额反推：份额只在再平衡时变动，
  // 而再平衡会同时改写那一条观测，所以两者始终自洽。
  if (!o.confirmOutlier) {
    const jump = (label, now, prev) => {
      if (!(prev > 0)) return null;
      const mv = now / prev - 1;
      if (Math.abs(mv) <= OUTLIER) return null;
      return label + ' 由 ' + prev.toFixed(3) + ' 变到 ' + now.toFixed(3) +
        '（' + (mv > 0 ? '+' : '') + (mv * 100).toFixed(1) + '%），超过单周 ' + (OUTLIER * 100) +
        '% 阈值。若行情确如此，加 --confirm-outlier 重跑；否则多半是小数点错位。';
    };
    const e1 = jump(state.cfg.codeH, o.ph, num(last.vH) / state.positions.sharesH);
    if (e1) return e1;
    const e2 = jump(state.cfg.codeD, o.pd, num(last.vD) / state.positions.sharesD);
    if (e2) return e2;
  }
  return null;
}

// 季末再平衡：把权益重置回 E，内部 75/25；差额按整手成交并计成本
function rebalance(state, o) {
  const last = state.rows[state.rows.length - 1];
  if (!last) throw new Error('还没有任何观测，无法再平衡');
  if (last.date !== o.date) throw new Error('再平衡日必须与最后一条观测同日（先 week 记录 ' + o.date + ' 收盘，再 rebal）');
  if (!(o.ph > 0) || !(o.pd > 0)) throw new Error('成交价必须为正数');

  const nav = num(last.vH) + num(last.vD) + num(last.cash);
  const target = nav * state.cfg.E;
  const tgtH = target * 0.75, tgtD = target * 0.25;
  const newH = Math.floor(tgtH / (o.ph * LOT)) * LOT;
  const newD = Math.floor(tgtD / (o.pd * LOT)) * LOT;
  const oldH = state.positions.sharesH, oldD = state.positions.sharesD;
  const dAmtH = r2((newH - oldH) * o.ph);
  const dAmtD = r2((newD - oldD) * o.pd);
  const traded = r2(Math.abs(dAmtH) + Math.abs(dAmtD));
  const cost = r2(traded * state.cfg.costBp / 1e4);
  const cashAfter = r2(num(last.cash) - dAmtH - dAmtD - cost);
  if (cashAfter < 0) throw new Error('再平衡后现金为负（' + cashAfter + '），检查成交价或份额');

  // 回写当日观测：成交后份额与现金，成本从现金里扣，净值下降=成本
  last.vH = r2(newH * o.ph);
  last.vD = r2(newD * o.pd);
  last.cash = cashAfter;
  last.rebal = true;

  state.positions.sharesH = newH;
  state.positions.sharesD = newD;
  state.rebal.push({
    date: o.date, nav: r2(nav), ph: o.ph, pd: o.pd,
    sharesH: [oldH, newH], sharesD: [oldD, newD],
    amountH: dAmtH, amountD: dAmtD, traded: traded, cost: cost, cashAfter: cashAfter
  });
  return { nav, tgtH, tgtD, newH, newD, oldH, oldD, dAmtH, dAmtD, traded, cost, cashAfter, costDrag: cost / nav };
}

/* ------------------------------------------------------------ 状态读写 */
function loadState() {
  if (!fs.existsSync(STATE_PATH)) fail('找不到 ' + path.relative(process.cwd(), STATE_PATH) + '，先跑 init');
  const s = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  if (s.format !== 'v16_gate3_state') fail('状态文件格式标记异常：' + s.format);
  return s;
}

function saveState(state) {
  state.meta.updatedAt = new Date().toISOString();
  const tmp = STATE_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, STATE_PATH);   // 原子替换：中途崩溃不会留下半个文件
}
function toBackup(state) {
  const ser = seriesOf(state.rows);
  const last = ser[ser.length - 1] || {};
  // 「已填周数」= 有总资产的观测数（含建仓基准，与台账同名口径一致）
  const filled = ser.filter(x => x.nav != null).length;
  const m = R2E[state.cfg.R];
  return {
    format: BACKUP_FORMAT,
    meta: {
      appVersion: APP_VERSION,
      strategyVersion: STRATEGY_VERSION,
      // 用状态最后变更时间，而不是「此刻」：否则同样的状态每次导出都产生不同字节，
      // 版本控制里永远是脏文件，指纹的 dirty 判据也就失效了。
      exportedAt: state.meta.updatedAt,
      generator: 'tools/paper-ledger/gate3.js',
      counts: {
        weeks: state.rows.length,
        filledWeeks: filled,
        reviews: (state.reviews || []).length,
        rebal: state.rebal.length
      },
      lastNav: last.nav == null ? null : r2(last.nav),
      lastDd: last.dd == null ? null : Math.round(last.dd * 1e6) / 1e6,
      cfgSnapshot: {
        R: state.cfg.R, cap: state.cfg.cap, start: state.cfg.start,
        codeH: state.cfg.codeH, idxH: state.cfg.idxH,
        codeD: state.cfg.codeD, idxD: state.cfg.idxD
      },
      r2eRow: { R: state.cfg.R, E: m.eq, mdd: m.mdd, room: m.room }
    },
    data: {
      cfg: {
        R: state.cfg.R, cap: state.cfg.cap, start: state.cfg.start,
        codeH: state.cfg.codeH, idxH: state.cfg.idxH,
        codeD: state.cfg.codeD, idxD: state.cfg.idxD
      },
      rows: state.rows.map(r => ({ date: r.date, vH: r.vH, vD: r.vD, cash: r.cash, rate: r.rate })),
      reviews: state.reviews || [],
      rebal: state.rebal || [],
      final: state.final || { answers: {}, verdict: '', sign: '', note: '' }
    }
  };
}

/* ---------------------------------------------------------------- 输出 */
function statusText(state) {
  const ser = seriesOf(state.rows);
  const last = ser[ser.length - 1];
  const m = R2E[state.cfg.R];
  const done = weeksDone(state);
  const left = Math.max(0, 12 - done);
  const nxt = new Date(Date.parse(last.date + 'T00:00:00Z') + 7 * 86400000).toISOString().slice(0, 10);
  const lines = [];

  lines.push('=== 第三关 · 12 周纸面执行 ===');
  lines.push('策略 ' + STRATEGY_VERSION + ' ｜ R=' + pct(state.cfg.R) + ' → E=' + pct(m.eq) +
    ' ｜ 本金 ' + money(state.cfg.cap) + ' ｜ 起始 ' + state.cfg.start);
  lines.push('工具 ' + state.cfg.codeH + '（跟踪 ' + state.cfg.idxH + '） / ' +
    state.cfg.codeD + '（跟踪 ' + state.cfg.idxD + '）  成本 ' + state.cfg.costBp + 'bp/边');
  lines.push('');
  lines.push('进度  第 ' + Math.min(done, 12) + ' / 12 周' + (left ? '，还需 ' + left + ' 周' : '，已满 12 周'));
  lines.push('份额  ' + state.cfg.codeH + ' ' + state.positions.sharesH.toLocaleString('zh-CN') + ' 份 ｜ ' +
    state.cfg.codeD + ' ' + state.positions.sharesD.toLocaleString('zh-CN') + ' 份');
  if (last) {
    const dev = last.eq == null ? null : last.eq - m.eq;
    lines.push('最新  ' + last.date + '  总资产 ' + money(last.nav) + '  高水位 ' + money(last.peak) +
      '  回撤 ' + pct(last.dd) + '  距 R ' + pp(state.cfg.R - last.dd));
    lines.push('权重  权益 ' + pct(last.eq) + ' / 目标 ' + pct(m.eq) + '（偏离 ' + pp(dev) + '）' +
      ' ｜ 红利占权益 ' + pct(last.div) + ' / 目标 25.00%');
    lines.push('现金  ' + money(num(state.rows[state.rows.length - 1].cash)) +
      '  到账利率 ' + num(state.rows[state.rows.length - 1].rate).toFixed(2) + '%');
  }
  lines.push('');
  lines.push('下一条  ' + nxt + '（该周最后一个交易日收盘后）');

  // 待办与告警
  const todo = [];
  if (last && hitR(last.dd, state.cfg.R)) {
    todo.push('⚠ 回撤已达 R：执行 §8.2 第 5 条四项书面复核（台账 ④ 页），不改任何持仓');
  }
  if (last && last.eq != null && Math.abs(last.eq - m.eq) > 0.05) {
    todo.push('⚠ 权益占比偏离超 ±5pp：按护栏①暂停自动再平衡、人工核对份额');
  }
  const rate = num(state.rows[state.rows.length - 1].rate);
  if (rate < 1.0) todo.push('⚠ 现金到账利率 ' + rate.toFixed(2) + '% < 1.0%：连续两季须按实际重算 R 余量');
  const qe = nextQuarterEnd(state.cfg.start);
  if (qe && done < 12) {
    // 周号按「起始日起第 N 个 7 日窗口」算，不能用已有观测数+1：
    // 建仓基准不属于任何一周，用它推周号会把 12-31 说成「第 1 周」。
    const wkN = Math.ceil(dayDiff(state.cfg.start, qe) / 7);
    todo.push('季末再平衡 ' + qe + '（第 ' + wkN + ' 周内）');
    if (state.rows[state.rows.length - 1].date >= qe && !state.rebal.some(x => x.date >= qe)) {
      todo.push('⚠ 已过季末 ' + qe + ' 但仍无再平衡记录，补录或说明未执行');
    }
  }
  if (todo.length) { lines.push(''); todo.forEach(t => lines.push('  ' + t)); }
  if (left === 0) {
    lines.push('');
    lines.push('  12 周已满：到台账 ⑤ 页回答五问并签字；任一为「是」→ 不进入实盘。');
  }
  return lines.join('\n');
}

function nextQuarterEnd(start) {
  const d = new Date(start + 'T00:00:00Z');
  const y = d.getUTCFullYear();
  for (const mm of ['03-31', '06-30', '09-30', '12-31']) {
    const s = y + '-' + mm;
    if (s >= start) return s;
  }
  return (y + 1) + '-03-31';
}

function renderLog(state) {
  const ser = seriesOf(state.rows);
  const m = R2E[state.cfg.R];
  const L = [];
  L.push('# 第三关 · 12 周纸面执行 周记');
  L.push('');
  L.push('> 本文件由 `tools/paper-ledger/gate3.js` 自动生成，**请勿手改**（下次运行会覆盖）。');
  L.push('> 状态源：`gate3_state.json`（可 diff）｜给人看的视图：`纸面执行台账_v1.6.html`，导入 `gate3_backup.json`。');
  L.push('');
  L.push('## 参数');
  L.push('');
  L.push('| 项 | 值 |');
  L.push('| :-- | :-- |');
  L.push('| 策略版本 | ' + STRATEGY_VERSION + ' |');
  L.push('| R → E | ' + pct(state.cfg.R) + ' → ' + pct(m.eq) + '（历史 MDD ' + m.mdd.toFixed(3) + '%，余量 ' + m.room.toFixed(3) + 'pp） |');
  L.push('| 本金 | ' + money(state.cfg.cap) + ' |');
  L.push('| 起始日 | ' + state.cfg.start + ' |');
  L.push('| 工具 | ' + state.cfg.codeH + '（' + state.cfg.idxH + '） / ' + state.cfg.codeD + '（' + state.cfg.idxD + '） |');
  L.push('| 成本 | ' + state.cfg.costBp + 'bp / 单边，100 股整手 |');
  L.push('');
  L.push('## 观测');
  L.push('');
  L.push('| 日期 | ' + state.cfg.codeH + ' 市值 | ' + state.cfg.codeD + ' 市值 | 现金 | 现金利率 | 总资产 | 回撤 | 权益占比 | 红利占权益 | 状态 |');
  L.push('| :-- | --: | --: | --: | --: | --: | --: | --: | --: | :-- |');
  ser.forEach((s, i) => {
    const r = state.rows[i];
    const tag = i === 0 ? '建仓基准'
      : hitR(s.dd, state.cfg.R) ? '**达 R**'
      : (s.eq != null && Math.abs(s.eq - m.eq) > 0.05) ? '偏离'
      : r.rebal ? '再平衡' : '正常';
    L.push('| ' + s.date + ' | ' + money(num(r.vH)) + ' | ' + money(num(r.vD)) + ' | ' + money(num(r.cash)) +
      ' | ' + num(r.rate).toFixed(2) + '% | ' + money(s.nav) + ' | ' + pct(s.dd) + ' | ' + pct(s.eq) +
      ' | ' + pct(s.div) + ' | ' + tag + ' |');
  });
  const done = weeksDone(state);
  L.push('');
  L.push('**进度：' + Math.min(done, 12) + ' / 12 周**' + (done >= 12 ? '（已满）' : '，还需 ' + (12 - done) + ' 周。'));
  if (state.rebal.length) {
    L.push('');
    L.push('## 季末再平衡');
    L.push('');
    L.push('| 日期 | 再平衡前总资产 | 换手金额 | 成本 | 成本拖累 | 份额变化 |');
    L.push('| :-- | --: | --: | --: | --: | :-- |');
    state.rebal.forEach(x => {
      L.push('| ' + x.date + ' | ' + money(x.nav) + ' | ' + money(x.traded) + ' | ' + money(x.cost) +
        ' | ' + (x.cost / x.nav * 1e4).toFixed(1) + 'bp | ' +
        state.cfg.codeH + ' ' + x.sharesH[0] + '→' + x.sharesH[1] + '；' +
        state.cfg.codeD + ' ' + x.sharesD[0] + '→' + x.sharesD[1] + ' |');
    });
  }
  if (state.reviews && state.reviews.length) {
    L.push('');
    L.push('## 达 R 书面复核');
    L.push('');
    state.reviews.forEach(x => L.push('- ' + x.date + '：' + (x.summary || '(见台账 ④ 页)')));
  }
  L.push('');
  L.push('## 12 周判定（五问）');
  L.push('');
  L.push('任一为「是」→ 不进入实盘。');
  L.push('');
  const qs = state.final && state.final.answers ? state.final.answers : {};
  FINAL_QS.forEach((q, i) => {
    const v = qs[i] || qs[String(i)] || '';
    L.push((i + 1) + '. ' + q + ' —— **' + (v === 'yes' ? '是' : v === 'no' ? '否' : '未回答') + '**');
  });
  L.push('');
  L.push('判定：' + ((state.final && state.final.verdict) || '未判定') +
    ' ｜ 签字：' + ((state.final && state.final.sign) || '（待签）'));
  L.push('');
  L.push('> 若 12 周内回撤从未达到 R，第 5 条复核栏为空是正常且诚实的。**空栏本身也是数据。**');
  L.push('');
  fs.writeFileSync(LOG_PATH, L.join('\n'), 'utf8');
  fs.writeFileSync(BACKUP_PATH, JSON.stringify(toBackup(state), null, 2) + '\n', 'utf8');
}

const FINAL_QS = [
  '纸面执行期间，我是否在下跌中重新解释了规则（例如给自己找理由改 E、改比例、暂停再平衡）？',
  '我是否产生过加仓或减仓的冲动，并差点执行？',
  '我是否仍然觉得「这个方案有风控 / 有保护」？',
  '我是否因为回撤而失眠、频繁看盘、或影响了正常工作生活？',
  '若这是真金白银，我能否在同样的回撤下重复同样的动作？'
];

/* ---------------------------------------------------------------- 命令 */
function cmdInit(a) {
  if (fs.existsSync(STATE_PATH) && !a.force) {
    fail('状态文件已存在：' + STATE_PATH + '\n  重建会覆盖既有观测，确认要重建请加 --force');
  }
  const date = a.date;
  if (!isDate(date)) fail('--date 必须是 YYYY-MM-DD（建仓基准日）');
  const ph = num(a.ph), pd = num(a.pd);
  if (!(ph > 0) || !(pd > 0)) fail('--ph / --pd 必须是正数（建仓日收盘价）');

  const R = a.R == null ? 0.20 : parseFloat(a.R);
  if (!R2E[R]) fail('--R 只能是 0.15 / 0.20 / 0.25 / 0.30');
  const cap = a.cap == null ? 500000 : parseFloat(a.cap);
  if (!(cap > 0)) fail('--cap 必须为正数');
  const costBp = a.costBp == null ? 15 : parseFloat(a.costBp);
  if (!(costBp >= 0)) fail('--costBp 不能为负');
  const start = a.start || '2026-11-09';
  if (!isDate(start)) fail('--start 必须是 YYYY-MM-DD');
  if (start <= date) fail('--start 必须晚于建仓基准日（基准日在起始日之前）');
  const rate = a.rate == null ? 1.30 : parseFloat(a.rate);
  if (!(rate >= 0 && rate <= 20)) fail('--rate 现金年利率须在 0~20 之间（单位 %）');

  const cfg = {
    R, E: R2E[R].eq, cap, start, costBp, rateDefault: rate,
    codeH: a.codeH || '510300', idxH: a.idxH || '000300.SH',
    // 中证红利是【中证指数公司】的指数，行情代码后缀是 .CSI；写成 .SH 在取数时直接查不到，
    // 而这个字段正是给「以后按它去补数据」的人看的，写错等于埋一个假线索。
    codeD: a.codeD || '515080', idxD: a.idxD || '000922.CSI'
  };
  const al = allocate(cfg, ph, pd);
  const state = {
    format: 'v16_gate3_state',
    strategyVersion: STRATEGY_VERSION,
    cfg: cfg,
    positions: { sharesH: al.sharesH, sharesD: al.sharesD, lot: LOT },
    baseline: { date: date, ph: ph, pd: pd, cost: al.cost },
    rows: [{ date: date, vH: al.amtH, vD: al.amtD, cash: al.cash, rate: rate, tag: '建仓基准' }],
    reviews: [],
    rebal: [],
    final: { answers: {}, verdict: '', sign: '', note: '' },
    meta: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), priceSource: '收盘价（不复权）' }
  };

  saveState(state);
  renderLog(state);
  const nav = al.amtH + al.amtD + al.cash;
  console.log('✓ 建仓基准已记录（' + date + ' 收盘价）');
  console.log('  权益目标 ' + money(cfg.cap * cfg.E) + '（' + pct(cfg.E) + ' × ' + money(cfg.cap) + '）：' +
    state.cfg.codeH + ' ' + al.sharesH + ' 份 / ' + state.cfg.codeD + ' ' + al.sharesD + ' 份');
  console.log('  成交金额 ' + money(al.amtH) + ' + ' + money(al.amtD) + '，建仓成本 ' + money(al.cost) +
    '（占本金 ' + (al.cost / cfg.cap * 1e4).toFixed(1) + 'bp）');
  console.log('  剩余现金 ' + money(al.cash) + '，账户总资产 ' + money(nav) +
    '（成本拖累 ' + ((cfg.cap - nav) / cfg.cap * 100).toFixed(3) + '%）');
  console.log('');
  console.log(statusText(state));
}

function cmdWeek(a) {
  const state = loadState();
  const date = a.date;
  const last = state.rows[state.rows.length - 1];
  const rate = a.rate == null ? num(last.rate) : parseFloat(a.rate);
  const cashAdd = a['cash-add'] == null ? 0 : parseFloat(a['cash-add']);
  const ph = num(a.ph), pd = num(a.pd);

  const bad = checkMark(state, { date, ph, pd, rate, cashAdd, confirmOutlier: !!a['confirm-outlier'] });
  if (bad) fail(bad);

  const row = markRow(last, state.positions, { date, ph, pd, rate, cashAdd });
  if (row._days > 14) console.log('  ⚠ 距上一条观测 ' + row._days + ' 天（超过两周），该周可能漏记；仍按实际天数计提利息');
  if (row.cash < 0) fail('现金为负（' + row.cash + '），检查 --cash-add');

  state.rows.push({ date: row.date, vH: row.vH, vD: row.vD, cash: row.cash, rate: row.rate });
  const ser = seriesOf(state.rows);
  const cur = ser[ser.length - 1];
  const m = R2E[state.cfg.R];

  if (a['dry-run']) {
    console.log('[dry-run] 未写入。' + JSON.stringify({ date, vH: row.vH, vD: row.vD, cash: row.cash, rate }, null, 1));
    console.log('  总资产 ' + money(cur.nav) + ' 回撤 ' + pct(cur.dd) + ' 权益 ' + pct(cur.eq));
    return;
  }

  saveState(state);
  renderLog(state);
  console.log('✓ 第 ' + weeksDone(state) + ' / 12 周已记录 ' + date);
  console.log('  总资产 ' + money(cur.nav) + '（利息 ' + money(row._interest) + '）  回撤 ' + pct(cur.dd) +
    '  距 R ' + pp(state.cfg.R - cur.dd));
  console.log('  权益 ' + pct(cur.eq) + ' / 目标 ' + pct(m.eq) + '（偏离 ' + pp(cur.eq - m.eq) + '）' +
    '  红利占权益 ' + pct(cur.div));
  if (hitR(cur.dd, state.cfg.R)) {
    console.log('');
    console.log('⚠ 回撤已达 R=' + pct(state.cfg.R) + '：按第 5 条做一次书面复核，**不改 E、不改份额、不改 75/25、不暂停季末再平衡**。');
    console.log('  复核留痕：台账 ④ 页，或 gate3.js review 记录。');
  }
  if (cur.eq != null && Math.abs(cur.eq - m.eq) > 0.05) {
    console.log('⚠ 权益占比偏离目标 ' + pp(cur.eq - m.eq) + '（超 ±5pp）：按护栏① 暂停自动再平衡，人工核对份额与台账。');
  }

  // 季末再平衡提醒：写在【代码】里，而不是写在某个自动任务的提示词里。
  // 提示词哪天被改掉、换个人跑、或者手动执行，都还在。
  // 2026-12-31 那一周的周五是元旦休市，周记会落在 12-31 本身，
  // 若只靠「周五提醒」很容易整季漏做 —— 漏做本身就是最该被记录的执行偏差。
  const qe = nextQuarterEnd(state.cfg.start);
  if (date >= qe && !state.rebal.some(x => x.date >= qe)) {
    console.log('');
    console.log('⚠ 本期已跨过季末 ' + qe + '，但还没有再平衡记录。规则要求每个季末把权益重置回 ' + pct(m.eq) + '、内部 75/25（补做只能记在本次观测日，不能倒填）：');
    console.log('  node tools/paper-ledger/gate3.js rebal --date ' + date + ' --ph ' + ph + ' --pd ' + pd);
    console.log('  若这一季确实不执行，请在周记里写明原因；「漏做」本身就是要留下痕迹的执行偏差。');
  }
}

function cmdRebal(a) {
  const state = loadState();
  if (!isDate(a.date)) fail('--date 必须是 YYYY-MM-DD');
  const ph = num(a.ph), pd = num(a.pd);
  if (!(ph > 0) || !(pd > 0)) fail('--ph / --pd 必须是正数');
  let r;
  try { r = rebalance(state, { date: a.date, ph, pd }); }
  catch (e) { fail(e.message); }
  const ser = seriesOf(state.rows);
  const cur = ser[ser.length - 1];
  if (a['dry-run']) {
    console.log('[dry-run] 未写入。目标 ' + money(r.tgtH) + ' / ' + money(r.tgtD) +
      '，换手 ' + money(r.traded) + '，成本 ' + money(r.cost));
    return;
  }
  saveState(state);
  renderLog(state);
  console.log('✓ 季末再平衡已记录 ' + a.date);
  console.log('  再平衡前总资产 ' + money(r.nav) + ' → 权益目标 ' + money(r.nav * state.cfg.E));
  console.log('  ' + state.cfg.codeH + ' ' + r.oldH + ' → ' + r.newH + ' 份（' + (r.dAmtH >= 0 ? '买入 ' : '卖出 ') + money(Math.abs(r.dAmtH)) + '）');
  console.log('  ' + state.cfg.codeD + ' ' + r.oldD + ' → ' + r.newD + ' 份（' + (r.dAmtD >= 0 ? '买入 ' : '卖出 ') + money(Math.abs(r.dAmtD)) + '）');
  console.log('  换手 ' + money(r.traded) + '，成本 ' + money(r.cost) + '（拖累 ' + (r.costDrag * 1e4).toFixed(1) + 'bp），剩余现金 ' + money(r.cashAfter));
  console.log('  回撤 ' + pct(cur.dd) + '  权益 ' + pct(cur.eq) + '  红利占权益 ' + pct(cur.div));
}

function cmdStatus(a) {
  const state = loadState();
  if (a.json) {
    const ser = seriesOf(state.rows);
    const last = ser[ser.length - 1];
    console.log(JSON.stringify({
      start: state.cfg.start, R: state.cfg.R, E: state.cfg.E,
      weeksDone: weeksDone(state), weeksLeft: Math.max(0, 12 - weeksDone(state)),
      rows: state.rows.length, last: last || null,
      sharesH: state.positions.sharesH, sharesD: state.positions.sharesD,
      rebalCount: state.rebal.length, nextQuarterEnd: nextQuarterEnd(state.cfg.start)
    }, null, 2));
    return;
  }
  console.log(statusText(state));
}

function cmdExport() {
  const state = loadState();
  renderLog(state);
  console.log('✓ 已写出 ' + path.relative(process.cwd(), BACKUP_PATH) + '（在台账「从备份恢复」里导入）');
  console.log('✓ 已重写 ' + path.relative(process.cwd(), LOG_PATH));
}

function cmdReview(a) {
  const state = loadState();
  if (!isDate(a.date)) fail('--date 必须是 YYYY-MM-DD');
  ['q1', 'q2', 'q3', 'q4'].forEach(k => {
    if (a[k] == null) fail('缺少 --' + k + '（四项复核必须写全，空着等于没做）');
  });
  state.reviews.push({
    date: a.date,
    items: { a: a.q1, b: a.q2, c: a.q3, d: a.q4 },
    summary: a.summary || ''
  });
  saveState(state);
  renderLog(state);
  console.log('✓ 书面复核已记录 ' + a.date + '（不改任何持仓，这是本关唯一允许的动作）');
}

function cmdFinal(a) {
  const state = loadState();
  const ans = {};
  ['q1', 'q2', 'q3', 'q4', 'q5'].forEach((k, i) => {
    if (a[k] != null) {
      if (a[k] !== 'yes' && a[k] !== 'no') fail('--' + k + ' 只能是 yes / no');
      ans[i] = a[k];
    }
  });
  const done = weeksDone(state);
  if (done < 12) console.log('  ⚠ 只记录了 ' + done + ' / 12 周，此时判定只能算「提前停跑」，不能算通过');
  state.final.answers = ans;
  state.final.verdict = a.verdict != null ? String(a.verdict) : state.final.verdict;
  state.final.sign = a.sign != null ? String(a.sign) : state.final.sign;
  state.final.note = a.note != null ? String(a.note) : state.final.note;
  saveState(state);
  renderLog(state);
  const yes = Object.keys(ans).filter(k => ans[k] === 'yes');
  console.log('✓ 12 周判定已记录：' + (yes.length ? yes.length + ' 项为「是」→ 不进入实盘' : '五问均为「否」'));
}

/* ---------------------------------------------------------------- 入口 */
function main() {
  const argv = process.argv.slice(2);
  const a = parseArgs(argv);
  const cmd = a._[0];
  const table = { init: cmdInit, week: cmdWeek, rebal: cmdRebal, status: cmdStatus, export: cmdExport, review: cmdReview, final: cmdFinal };
  if (!cmd || !table[cmd]) {
    console.log('用法：node tools/paper-ledger/gate3.js <init|week|rebal|status|export|review|final> [--参数]');
    process.exit(cmd ? 1 : 0);
  }
  table[cmd](a);
}

if (require.main === module) main();

module.exports = { allocate, markRow, seriesOf, weeksDone, rebalance, checkMark, toBackup, parseArgs, hitR, nextQuarterEnd, R2E };
