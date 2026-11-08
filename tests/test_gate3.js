// ============================================================================
// test_gate3.js — 第三关记录工具（tools/paper-ledger/gate3.js）的计算闸门
//
// 为什么单独测：这 12 周的全部数字都由它算，含份额取整、成本、现金计提、
// 季末再平衡、回撤。它算错一次，12 周记录就整体作废（且不可重建）。
// 最后一段还会把 export 出的备份喂给台账 HTML 的 validateBackup，
// 确保「仓库里的记录」与「给人看的台账」不会各说一套。
// ============================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const g3 = require('../tools/paper-ledger/gate3.js');

let fail = 0, pass = 0;
function eq(name, got, want, tol) {
  const ok = (tol == null) ? (got === want) : (Math.abs(got - want) <= tol);
  if (!ok) { console.error('  ✗ ' + name + '  期望=' + want + '  实际=' + got); fail++; }
  else { pass++; console.log('  ✓ ' + name + ' = ' + (got == null ? got : (typeof got === 'number' ? +got.toFixed(6) : got))); }
}
function ok(name, cond) {
  if (!cond) { console.error('  ✗ ' + name); fail++; }
  else { pass++; console.log('  ✓ ' + name); }
}

const CFG = {
  R: 0.20, E: 0.35, cap: 500000, start: '2026-11-09', costBp: 15, rateDefault: 1.30,
  codeH: '510300', idxH: '000300.SH', codeD: '515080', idxD: '000922.CSI'
};
const PH = 4.124, PD = 1.563;

function makeState(cfg) {
  const c = cfg || CFG;
  const al = g3.allocate(c, PH, PD);
  return {
    format: 'v16_gate3_state', strategyVersion: 'v1.6', cfg: c,
    positions: { sharesH: al.sharesH, sharesD: al.sharesD, lot: 100 },
    baseline: { date: '2026-11-06', ph: PH, pd: PD, cost: al.cost },
    rows: [{ date: '2026-11-06', vH: al.amtH, vD: al.amtD, cash: al.cash, rate: 1.30, tag: '建仓基准' }],
    reviews: [], rebal: [],
    final: { answers: {}, verdict: '', sign: '', note: '' },
    meta: { createdAt: '2026-11-08T00:00:00Z', updatedAt: '2026-11-08T00:00:00Z' }
  };
}

console.log('=== 1. 建仓：整手取整、成本、现金必须对上本金 ===');
const al = g3.allocate(CFG, PH, PD);
eq('510300 份额（整手）', al.sharesH, 31800);
eq('515080 份额（整手）', al.sharesD, 27900);
eq('份额是 100 的整数倍', al.sharesH % 100 === 0 && al.sharesD % 100 === 0, true);
eq('510300 成交额', al.amtH, 131143.20, 1e-9);
eq('515080 成交额', al.amtD, 43607.70, 1e-9);
eq('建仓成本', al.cost, 262.12, 1e-9);
eq('剩余现金', al.cash, 324986.98, 1e-9);
eq('四者相加 = 本金（不凭空多钱也不少钱）', al.amtH + al.amtD + al.cost + al.cash, CFG.cap, 0.005);
ok('未超目标市值（只能向下取整）', al.amtH <= CFG.cap * CFG.E * 0.75 && al.amtD <= CFG.cap * CFG.E * 0.25);
eq('成本 ≈ 成交额 × 15bp（逐腿取整，误差 ≤1 分）',
  Math.abs(al.cost - (al.amtH + al.amtD) * 15 / 1e4) <= 0.01, true);
const nav0 = al.amtH + al.amtD + al.cash;
eq('建仓即产生成本拖累', CFG.cap - nav0, 262.12, 1e-9);
eq('权益占比（目标 35%）', (al.amtH + al.amtD) / nav0, 0.35, 5e-4);
eq('红利占权益（目标 25%）', al.amtD / (al.amtH + al.amtD), 0.25, 2e-3);

console.log('=== 2. 周记：市值、现金计提、回撤基准 ===');
let st = makeState();
const base = st.rows[0];
const w1 = g3.markRow(base, st.positions, { date: '2026-11-13', ph: PH, pd: PD, rate: 1.30 });
eq('计提天数', w1._days, 7);
eq('一周利息（1.30% 年化 × 7/365）', w1._interest, 81.02, 0.01);
eq('现金 = 上期现金 + 利息', w1.cash, 325068.00, 0.01);
eq('510300 市值 = 份额 × 收盘价', w1.vH, 131143.20, 1e-9);
st.rows.push({ date: w1.date, vH: w1.vH, vD: w1.vD, cash: w1.cash, rate: w1.rate });
let ser = g3.seriesOf(st.rows);
eq('总资产', ser[1].nav, 499818.90, 0.01);
eq('价格不变 + 利息 → 回撤为 0', ser[1].dd, 0, 1e-12);
eq('高水位被抬高到含利息的净值', ser[1].peak, ser[1].nav, 1e-12);

console.log('--- 2a. 首周就下跌：回撤必须从建仓基准算，而不是从第一周算 ---');
let st2 = makeState();
const d1 = g3.markRow(st2.rows[0], st2.positions, { date: '2026-11-13', ph: 3.800, pd: 1.450, rate: 1.30 });
st2.rows.push({ date: d1.date, vH: d1.vH, vD: d1.vD, cash: d1.cash, rate: d1.rate });
const ser2 = g3.seriesOf(st2.rows);
eq('高水位是建仓基准的净值', ser2[1].peak, ser2[0].nav, 1e-12);
eq('回撤按建仓基准计', ser2[1].dd, 1 - ser2[1].nav / ser2[0].nav, 1e-12);
ok('若错用第一周做基准，回撤会显示为 0——这里必须 > 0', ser2[1].dd > 0.02);

console.log('=== 3. 守卫：脏输入必须被拦住，且不写入任何东西 ===');
const good = { date: '2026-11-20', ph: 4.15, pd: 1.57, rate: 1.30, cashAdd: 0 };
eq('合法周记放行', g3.checkMark(st, good), null);
eq('同日重复记录被拒', /已记录/.test(g3.checkMark(st, Object.assign({}, good, { date: st.rows[st.rows.length - 1].date }))), true);
eq('倒序日期被拒', /晚于上一条/.test(g3.checkMark(st, Object.assign({}, good, { date: '2026-11-10' }))), true);
eq('早于起始日被拒', /早于纸面执行起始日/.test(g3.checkMark(st, Object.assign({}, good, { date: '2026-11-08' }))), true);
eq('价格为 0 被拒', /正数/.test(g3.checkMark(st, Object.assign({}, good, { ph: 0 }))), true);
eq('价格为 NaN 被拒', /正数/.test(g3.checkMark(st, Object.assign({}, good, { pd: NaN }))), true);
eq('利率 25% 被拒', /0~20/.test(g3.checkMark(st, Object.assign({}, good, { rate: 25 }))), true);
eq('日期格式错被拒', /YYYY-MM-DD/.test(g3.checkMark(st, Object.assign({}, good, { date: '2026/11/13' }))), true);

console.log('--- 3a. 价格量级：小数点错位是这一关最容易发生、也最不容易被发现的录入事故 ---');
const mark = extra => g3.checkMark(st, Object.assign({ date: '2026-11-20', ph: 4.15, pd: 1.57, rate: 1.30, cashAdd: 0 }, extra));
eq('整十倍价格被拒（4.15 → 41.5）', /小数点错位/.test(mark({ ph: 41.5 })), true);
eq('缩十倍价格被拒（1.57 → 0.157）', /小数点错位/.test(mark({ pd: 0.157 })), true);
eq('拒错信息带原价与新价，便于核对', /41\.500/.test(mark({ ph: 41.5 })), true);
eq('显式 --confirm-outlier 后放行', mark({ ph: 41.5, confirmOutlier: true }), null);
eq('真实极端周（+8.6%）不被误拦', mark({ ph: 4.48, pd: 1.66 }), null);
eq('正好 25% 以内仍放行（阈值不误伤边界）', mark({ ph: 5.15 }), null);
eq('超过 25% 即拦（5.20）', /小数点错位/.test(mark({ ph: 5.20 })), true);

console.log('--- 3b. 季末识别（12-31 那一周的周五是元旦休市，靠代码而不是靠提醒）---');
eq('起始 2026-11-09 → 2026-12-31', g3.nextQuarterEnd('2026-11-09'), '2026-12-31');
eq('起始恰为季末日 → 当日', g3.nextQuarterEnd('2026-12-31'), '2026-12-31');
eq('跨年 → 2027-03-31', g3.nextQuarterEnd('2027-01-05'), '2027-03-31');

console.log('=== 4. 季末再平衡：75/25 重置、成本、现金不为负 ===');
let st3 = makeState();
// 造一个已经偏离的场景：权益涨到 40%，红利被稀释
st3.positions.sharesH = 31800; st3.positions.sharesD = 27900;
st3.rows.push({ date: '2026-12-31', vH: 31800 * 4.60, vD: 27900 * 1.50, cash: 324986.98, rate: 1.30 });
const before = g3.seriesOf(st3.rows).pop();
const rb = g3.rebalance(st3, { date: '2026-12-31', ph: 4.60, pd: 1.50 });
const after = g3.seriesOf(st3.rows).pop();
eq('再平衡前总资产', rb.nav, before.nav, 1e-9);
eq('新份额仍为整手', rb.newH % 100 === 0 && rb.newD % 100 === 0, true);
eq('总资产只下降「成本」那么多', before.nav - after.nav, rb.cost, 0.011);
eq('再平衡后权益占比回到 35%（允许整手取整的缺口）',
  Math.abs(after.eq - 0.35) <= (4.60 * 100 + 1.50 * 100) / after.nav, true);
eq('红利占权益回到 25%', after.div, 0.25, 3e-3);
eq('再平衡后现金不为负', after.nav - (after.eq * after.nav) >= 0, true);
eq('份额已写回状态', st3.positions.sharesH === rb.newH && st3.positions.sharesD === rb.newD, true);
eq('再平衡台帐记了一笔', st3.rebal.length, 1);
eq('成本按换手额 15bp 计', rb.cost, Math.round(rb.traded * 15 / 1e4 * 100) / 100, 0.011);
let threw = false;
try { g3.rebalance(makeState(), { date: '2026-12-31', ph: 4.6, pd: 1.5 }); } catch (e) { threw = true; }
eq('再平衡日与最后观测不同日 → 拒绝', threw, true);

console.log('=== 5. 周数：建仓基准不是一周 ===');
let st4 = makeState();
eq('只有建仓基准时 0 周', g3.weeksDone(st4), 0);
for (let i = 1; i <= 12; i++) {
  const d = new Date(Date.parse('2026-11-13T00:00:00Z') + (i - 1) * 7 * 86400000).toISOString().slice(0, 10);
  st4.rows.push({ date: d, vH: 131143.2, vD: 43607.7, cash: 325000, rate: 1.30 });
}
eq('记满 12 周（共 13 行）', g3.weeksDone(st4), 12);
eq('行数比周数多 1（基准行）', st4.rows.length - g3.weeksDone(st4), 1);

console.log('=== 6. 达 R 判定带浮点容差 ===');
eq('dd=0.19999999999999996 视为已达 R', g3.hitR(0.19999999999999996, 0.20), true);
eq('dd=0.1950 未达 R', g3.hitR(0.1950, 0.20), false);
eq('dd=null 不触发', g3.hitR(null, 0.20), false);

console.log('=== 7. 季末日期 ===');
eq('起始 2026-11-09 的下一个季末', g3.nextQuarterEnd('2026-11-09'), '2026-12-31');
eq('起始 2027-01-05 的下一个季末', g3.nextQuarterEnd('2027-01-05'), '2027-03-31');
eq('起始正好在季末当天', g3.nextQuarterEnd('2026-12-31'), '2026-12-31');

console.log('=== 8. 导出的备份必须能被台账导入（跨工具一致性） ===');
const html = fs.readFileSync(path.join(__dirname, '..', 'tools', 'paper-ledger', '纸面执行台账_v1.6.html'), 'utf8');
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];

// 最小 DOM 桩：台账脚本加载时会 renderAll()，所以桩必须够用（与 test_ledger_v16.js 同款）
function makeEl(id) {
  const store = { textContent: '', innerHTML: '', value: '', className: '', checked: false };
  return {
    id,
    get textContent() { return store.textContent; }, set textContent(v) { store.textContent = v; },
    get innerHTML() { return store.innerHTML; }, set innerHTML(v) { store.innerHTML = v; },
    get value() { return store.value; }, set value(v) { store.value = v; },
    get className() { return store.className; }, set className(v) { store.className = v; },
    checked: false, dataset: {}, style: {},
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    appendChild() {}, remove() {}, focus() {}, setSelectionRange() {},
    insertAdjacentHTML(pos, s) { store.innerHTML = s + store.innerHTML; },
    querySelector() { return makeEl('sub'); },
    querySelectorAll() { return []; },
    addEventListener() {}
  };
}
const els = {};
const store = {};
const sandbox = {
  document: {
    getElementById(id) { if (!els[id]) els[id] = makeEl(id); return els[id]; },
    querySelector() { return makeEl('q'); },
    querySelectorAll() { return []; },
    createElement(tag) { return makeEl(tag); },
    addEventListener() {},
    body: { appendChild() {}, removeChild() {} }
  },
  localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; }, clear: () => { Object.keys(store).forEach(k => delete store[k]); } },
  console, Blob: function () {}, URL: { createObjectURL() { return 'blob:x'; }, revokeObjectURL() {} },
  Date, Math, JSON, Object, Array, Number, String, parseFloat, parseInt, isFinite, isNaN,
  setTimeout: f => f(), confirm: () => true
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'ledger.js' });

const bk = g3.toBackup(st4);
eq('备份格式标记', bk.format, 'v16_paper_ledger_backup');
eq('备份 R 在台账允许档位内', sandbox.VALID_R.indexOf(bk.data.cfg.R) >= 0, true);
eq('备份策略版本', bk.meta.strategyVersion, 'v1.6');
eq('备份工具版本与台账一致', bk.meta.appVersion, sandbox.APP_VERSION);
eq('备份行数 = 状态行数', bk.data.rows.length, st4.rows.length);
eq('备份只保留台账认识的字段', Object.keys(bk.data.rows[0]).sort().join(','), 'cash,date,rate,vD,vH');
const v = sandbox.validateBackup(JSON.parse(JSON.stringify(bk)));
eq('台账校验通过', v.ok, true);
eq('校验无错误', v.errs.length, 0);
eq('校验无警告', v.warns.length, 0);
eq('校验出的周数与备份一致', v.summary.weeks, st4.rows.length);
eq('校验出的最后回撤与状态一致', +v.summary.lastDd.toFixed(9), +g3.seriesOf(st4.rows).pop().dd.toFixed(9), 1e-9);

console.log('--- 8a. 台账的周数计数必须与 gate3 一致（否则判定会提前一周） ---');
sandbox.replaceState(JSON.parse(JSON.stringify(bk.data)));
eq('台账 weeksDone 与 gate3 一致', sandbox.weeksDone(sandbox.S.rows), g3.weeksDone(st4));
const st5 = JSON.parse(JSON.stringify(bk.data));
st5.rows = st5.rows.slice(0, 12);   // 基准 + 11 周
sandbox.replaceState(st5);
eq('基准 + 11 周仍算 11 周（不会误判为满 12 周）', sandbox.weeksDone(sandbox.S.rows), 11);

console.log('');
console.log('通过 ' + pass + ' 项' + (fail ? '，失败 ' + fail + ' 项' : ''));
if (fail) { console.error('★ 失败 ' + fail + ' 项'); process.exit(1); }
console.log('★ 全部通过（8 组）');
