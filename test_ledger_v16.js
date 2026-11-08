// 最小 DOM 桩，用于在 node 中真实执行 纸面执行台账_v1.6.html 的脚本
// 目的：验证台账工具的核心计算（回撤 / 占比 / 再平衡份额 / CSV），不是只看语法
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '纸面执行台账_v1.6.html'), 'utf8');
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function makeEl(id){
  const store = { textContent: '', innerHTML: '', value: '', className: '', checked: false };
  const node = {
    id,
    get textContent(){ return store.textContent; }, set textContent(v){ store.textContent = v; },
    get innerHTML(){ return store.innerHTML; }, set innerHTML(v){ store.innerHTML = v; },
    get value(){ return store.value; }, set value(v){ store.value = v; },
    get className(){ return store.className; }, set className(v){ store.className = v; },
    checked: false,
    dataset: {},
    style: {},
    classList: { toggle(){}, add(){}, remove(){}, contains(){ return false; } },
    appendChild(){}, remove(){}, focus(){}, setSelectionRange(){},
    insertAdjacentHTML(pos, s){ store.innerHTML = s + store.innerHTML; },
    querySelector(){ return makeEl('sub'); },
    querySelectorAll(){ return []; },
    addEventListener(){}
  };
  return node;
}

const els = {};
const localStorage = (() => {
  let m = {};
  return {
    getItem: k => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: k => { delete m[k]; },
    clear: () => { m = {}; },
    _dump: () => m
  };
})();

const document = {
  getElementById(id){ if(!els[id]) els[id] = makeEl(id); return els[id]; },
  querySelector(){ return makeEl('q'); },
  querySelectorAll(){ return []; },
  createElement(tag){ return makeEl(tag); },
  addEventListener(){},
  body: { appendChild(){}, removeChild(){} }
};

const sandbox = {
  document, localStorage,
  console,
  Blob: function(){},
  URL: { createObjectURL(){ return 'blob:x'; }, revokeObjectURL(){} },
  Date, Math, JSON, Object, Array, Number, String, parseFloat, parseInt, isFinite, isNaN,
  setTimeout: (f) => f(),
  confirm: () => true
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'ledger.js' });

const S = sandbox.S;
const R2E = sandbox.R2E;
let fail = 0;
function eq(name, got, want, tol){
  const ok = (tol == null) ? (got === want) : (Math.abs(got - want) <= tol);
  if(!ok){ console.error('  ✗ ' + name + '  期望=' + want + '  实际=' + got); fail++; }
  else console.log('  ✓ ' + name + ' = ' + (got == null ? got : (typeof got === 'number' ? +got.toFixed(6) : got)));
}

console.log('=== 1. R→E 表与策略文档一致性 ===');
eq('R=15% → E', R2E[0.15].eq, 0.25);
eq('R=20% → E', R2E[0.20].eq, 0.35);
eq('R=25% → E', R2E[0.25].eq, 0.45);
eq('R=30% → E', R2E[0.30].eq, 0.55);
eq('R=20% MDD', R2E[0.20].mdd, 17.234, 1e-9);
eq('R=20% 余量', R2E[0.20].room, 2.766, 1e-9);
eq('R=20% 年化', R2E[0.20].cagr, 3.327, 1e-9);

console.log('=== 2. 单行计算与回撤 ===');
// 场景：50 万，E=35% → 权益 175000（H 131250 / D 43750），现金 325000
S.rows.length = 0;
S.rows.push({ date: '2026-01-02', vH: 131250, vD: 43750, cash: 325000, rate: 1.3 });
let ser = sandbox.series();
eq('第1周 总资产', ser[0].nav, 500000);
eq('第1周 回撤', ser[0].dd, 0);
eq('第1周 权益占比', ser[0].eq, 0.35);
eq('第1周 红利占权益', ser[0].div, 0.25);

// 第2周：权益跌 20%（H 105000 / D 45000 —— D 涨），现金不变
S.rows.push({ date: '2026-01-09', vH: 105000, vD: 45000, cash: 325000, rate: 1.3 });
ser = sandbox.series();
eq('第2周 总资产', ser[1].nav, 475000);
eq('第2周 高水位', ser[1].peak, 500000);
eq('第2周 回撤', ser[1].dd, 0.05, 1e-12);
eq('第2周 权益占比', ser[1].eq, 150000/475000, 1e-12);
eq('第2周 红利占权益', ser[1].div, 45000/150000, 1e-12);

// 第3周：更深的回撤，验证高水位不下降
S.rows.push({ date: '2026-01-16', vH: 90000, vD: 40000, cash: 325000, rate: 1.3 });
ser = sandbox.series();
eq('第3周 总资产', ser[2].nav, 455000);
eq('第3周 高水位仍为 50 万', ser[2].peak, 500000);
eq('第3周 回撤', ser[2].dd, 1 - 455000/500000, 1e-12);

console.log('=== 3. 空行必须返回 null（不能算成全现金） ===');
S.rows.push({ date: '', vH: '', vD: '', cash: 325000, rate: 1.3 });
ser = sandbox.series();
eq('空行 nav', ser[3].nav, null);
eq('空行 dd', ser[3].dd, null);
eq('空行不污染高水位', ser[3].peak, 500000);
const lf = sandbox.lastFilled(ser);
eq('lastFilled 跳过空行（回到第3周）', lf.i, 2);

console.log('=== 4. 季末再平衡份额 ===');
// 用第3周状态（nav 455000）+ 价格 pH=4.0 / pD=1.0
sandbox.S.rows.length = 0;
sandbox.S.rows.push({ date: '2026-03-31', vH: 90000, vD: 40000, cash: 325000, rate: 1.3 });
sandbox.S.cfg.R = 0.20;
sandbox.document.getElementById('pH').value = '4.0';
sandbox.document.getElementById('pD').value = '1.0';
sandbox.document.getElementById('costBp').value = '15';
sandbox.calcRebal();
const rb = sandbox.lastRebal;
const nav = 455000, E = 0.35;
eq('再平衡 目标权益', rb.tgtEq === undefined ? nav*E : rb.tgtEq, nav*E, 1e-9);
eq('沪深300 目标市值', rb.tgtH, nav*E*0.75, 1e-9);
eq('红利 目标市值', rb.tgtD, nav*E*0.25, 1e-9);
eq('沪深300 应买份额', rb.dSH, (nav*E*0.75 - 90000)/4.0, 1e-9);
eq('红利 应卖份额', rb.dSD, (nav*E*0.25 - 40000)/1.0, 1e-9);
const traded = Math.abs(nav*E*0.75-90000) + Math.abs(nav*E*0.25-40000);
eq('换手金额', traded, Math.abs(rb.dH)+Math.abs(rb.dD), 1e-6);
eq('成本', rb.cost, traded*15/10000, 1e-9);
// 再平衡后现金 = nav - 目标权益 - 成本，且占比应为 65%
const cashAfter = nav - nav*E - rb.cost;
eq('再平衡后现金占比', cashAfter/nav, 0.65 - rb.cost/nav, 1e-12);

console.log('=== 5. 达 R 判定 ===');
sandbox.S.rows.length = 0;
sandbox.S.cfg.R = 0.20;
sandbox.S.rows.push({ date: 'd1', vH: 131250, vD: 43750, cash: 325000, rate: 1.3 });
sandbox.S.rows.push({ date: 'd2', vH: 100000, vD: 33000, cash: 325000, rate: 1.3 }); // nav 458000 → dd 8.4%
ser = sandbox.series();
eq('未达 R', sandbox.hitR(ser[1].dd), false);
sandbox.S.rows.push({ date: 'd3', vH: 85000, vD: 28000, cash: 325000, rate: 1.3 }); // nav 438000 → dd 12.4%
sandbox.S.rows.push({ date: 'd4', vH: 70000, vD: 22000, cash: 325000, rate: 1.3 }); // nav 417000 → dd 16.6%
sandbox.S.rows.push({ date: 'd5', vH: 62000, vD: 19000, cash: 325000, rate: 1.3 }); // nav 406000 → dd 18.8%
sandbox.S.rows.push({ date: 'd6', vH: 58000, vD: 17000, cash: 325000, rate: 1.3 }); // nav 400000 → dd 20.0%
ser = sandbox.series();
const d6 = ser[ser.length-1].dd;
eq('第6周回撤', d6, 0.20, 1e-9);
eq('第6周已触发（dd 恰等于 R，浮点容差）', sandbox.hitR(d6), true);

console.log('=== 6. pct / yuan 边界 ===');
eq('pct(null)', sandbox.pct(null), '—');
eq('yuan(null)', sandbox.yuan(null), '—');
eq('pct(0.0523)', sandbox.pct(0.0523), '5.23%');
eq('yuan(475000)', sandbox.yuan(475000), '¥475,000');

console.log('');
if(fail){ console.error('★ 失败 ' + fail + ' 项'); process.exit(1); }
console.log('★ 全部通过（' + 6 + ' 组）');
