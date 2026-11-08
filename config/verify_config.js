// ============================================================================
// verify_config.js — 配置登记与代码是否一致
// 2026-11-08 ｜ 第七轮（工程骨架）
//
// ★ 存在理由（外部审阅问题：策略参数散落在多个 JS 文件）★
//   config/strategy/v1.6.json 目前是【登记】，不是【注入】。登记最容易撒的谎是
//   「写得漂漂亮亮，但和代码里真正跑的数不一样」。所以本文件逐项断言：
//   配置里的每个数，必须能从代码/数据里读出来并且相等；读不出来的字段不登记。
//
//   为什么不用「让引擎读配置」一次性解决：
//     v1.6 已发布数字全部建立在现有参数入口上。改注入是结构变更，必须与
//     目录迁移分开做、单独验证（见 docs/engineering/迁移清单_v1.0.md 阶段三）。
//     先让「登记 → 断言」跑起来，比直接改引擎安全得多。
//
// 用法：node config/verify_config.js        不一致则 exit 1
// ============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PT = require('../lib/paths.js');
const ROOT = PT.ROOT;
const P = PT.resolve;

const CFG = JSON.parse(fs.readFileSync(path.join(__dirname, 'strategy/v1.6.json'), 'utf8'));
const B = require(P('phase2_indices.js'));
const M = JSON.parse(fs.readFileSync(P('metrics_v16.json'), 'utf8'));

let pass = 0;
const fails = [];
function eq(label, actual, expected, tol) {
  const ok = tol == null ? actual === expected : Math.abs(actual - expected) <= tol;
  if (ok) pass++;
  else fails.push(`${label}：代码/数据 = ${JSON.stringify(actual)}，配置登记 = ${JSON.stringify(expected)}`);
}

// ---------------------------------------------------------------------------
// 1. 权益内部权重 / 再平衡 / 成本：直接读 P_MAIN_OPT
// ---------------------------------------------------------------------------
const o = B.P_MAIN_OPT;
eq('withinEquity.dividend（引擎 w）', o.w, CFG.allocation.withinEquity.dividend, 1e-12);
eq('rebalancing.mode', o.rebal, CFG.rebalancing.mode);
eq('rebalancing.intervalTradingDays', o.interval, CFG.rebalancing.intervalTradingDays);
eq('rebalancing.threshold（应为 null）', CFG.rebalancing.threshold, null);
eq('costs.tradeFee', o.tradeFee, CFG.costs.tradeFee, 1e-12);
eq('costs.slippage', o.slippage, CFG.costs.slippage, 1e-12);
eq('costs.divTax', o.divTax, CFG.costs.divTax, 1e-12);
eq('costs.execLag', o.execLag, CFG.costs.execLag);
eq('execution.execLagDays', o.execLag, CFG.execution.execLagDays);
eq('execution.feeBps', Math.round(o.tradeFee * 10000), CFG.execution.feeBps);
eq('execution.slippageBps', Math.round(o.slippage * 10000), CFG.execution.slippageBps);

// ---------------------------------------------------------------------------
// 2. 现金利率分段：必须与 SEG_RATE 的实际分段一致（不是只看第一条）
// ---------------------------------------------------------------------------
const segs = CFG.cashRateSegments;
const probe = ['2012-06-29', '2018-06-29', '2024-06-28'].map(d => {
  let idx = B.DATES.findIndex(x => x >= d);
  if (idx < 0) idx = B.N - 1;
  return B.SEG_RATE[idx];
});
segs.forEach((s, i) => eq(`cashRateSegments[${i}].rate（实际序列取值）`, probe[i], s.rate, 1e-12));

// ---------------------------------------------------------------------------
// 3. R→E 四档：必须与 metrics_v16.json（引擎实跑结果）逐档一致
// ---------------------------------------------------------------------------
CFG.riskTable.mapping.forEach((m, i) => {
  eq(`riskTable.mapping[${i}].R_pct`, M.r2e[i].R_pct, m.R_pct, 1e-9);
  eq(`riskTable.mapping[${i}].E_pct`, M.r2e[i].E_pct, m.E_pct, 1e-9);
});
eq('riskTable.marginRulePP', M.marginRulePP, CFG.riskTable.marginRulePP, 1e-12);
eq('riskTable.marginRuleBasis', M.mainCaliber.key, CFG.riskTable.marginRuleBasis);

// 当前配置的 E 必须真的通过余量规则（防止「登记了一个不合规的档」）
const cur = M.r2e.find(r => Math.abs(r.E_pct - CFG.allocation.equityWeightOfBook * 100) < 1e-9);
if (cur) {
  eq('allocation.equityWeightOfBook 对应档的余量', cur.marginPP, CFG.riskTable.mapping.find(m => m.E_pct === cur.E_pct).R_pct - cur.mddPct, 0.0015);
  if (cur.marginPP < CFG.riskTable.marginRulePP - 1e-9) {
    fails.push(`allocation.equityWeightOfBook：E=${cur.E_pct}% 余量 ${cur.marginPP}pp 低于规则 ${CFG.riskTable.marginRulePP}pp`);
  } else pass++;
} else {
  fails.push(`allocation.equityWeightOfBook：${CFG.allocation.equityWeightOfBook} 不在四档映射内`);
}

// ---------------------------------------------------------------------------
// 4. 版本一致性：配置版本 = 指标版本；R 条款必须关闭
// ---------------------------------------------------------------------------
eq('version（配置 vs metrics_v16.json）', M.meta.strategyVersion.replace(/^v/, ''), CFG.version);
eq('riskControl.rClause.enabled', CFG.riskControl.rClause.enabled, false);

// ---------------------------------------------------------------------------
// 5. 来源指纹：配置里指向的文件必须存在
// ---------------------------------------------------------------------------
Object.keys(CFG.provenance).forEach(k => {
  const f = CFG.provenance[k];
  if (fs.existsSync(P(f))) pass++;
  else fails.push(`provenance.${k}：文件不存在 ${f}`);
});

// ---------------------------------------------------------------------------
const cfgHash = crypto.createHash('sha256').update(JSON.stringify(CFG)).digest('hex');

console.log('=== config/strategy/v1.6.json 与代码一致性 ===');
console.log('  断言 ' + (pass + fails.length) + ' 项，通过 ' + pass + ' 项');
console.log('  配置内容哈希 ' + cfgHash.slice(0, 16) + '…');

if (fails.length) {
  console.log('');
  fails.forEach(f => console.log('  ✗ ' + f));
  console.log('');
  console.log('✗ 配置登记与代码不一致。要么改配置，要么改代码，但不允许两者长期不同步。');
  process.exit(1);
}
console.log('✓ 全部一致。配置是可信的登记。');
