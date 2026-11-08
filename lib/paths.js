// ============================================================================
// lib/paths.js — 全仓库唯一的路径解析器
// 2026-11-08 ｜ 第七轮（工程骨架，目录迁移前置）
//
// ★ 存在理由 ★
//   现在每个脚本写的是 `P = f => path.join(__dirname, f)`：读和写都以【脚本所在目录】
//   为基准。这在扁平仓库里没问题，一旦把 phase5_run.js 挪进 src/pipeline/，
//   phase5_backtest_data.json 就会被写到 src/pipeline/ 下面，而 metrics_v16.js
//   还在别的目录找它 —— 搬家当天，所有数字静默对不上。
//
//   本模块把「哪个文件住在哪个目录」变成一张登记表（LAYOUT）。脚本只说文件名，
//   不说目录。迁移时只改这张表，二十个脚本一行不用动。
//
// ★ 当前状态 ★
//   LAYOUT 全部为空 = 所有文件都在仓库根。行为与迁移前逐位一致。
//   执行 docs/engineering/迁移清单_v1.0.md 阶段一后，把表填上即可。
//
// ★ 用法 ★
//   const PT = require('./lib/paths.js');
//   PT.resolve('hs300_daily_2010_2026.json')   // 读：按登记表定位，找不到时回退根目录
//   PT.out('metrics_v16.json')                 // 写：永远写到登记目录（不存在则创建）
//   PT.NO_LAYOUT_YET                           // true 表示尚未迁移
// ============================================================================

const fs = require('fs');
const path = require('path');

// 仓库根：从本文件所在目录向上找 package.json。
// 不写死 '../'，是因为本文件迟早要从 lib/ 搬到 src/lib/（迁移清单阶段一）——
// 写死层数的话，搬完 ROOT 就指到了 src/，所有数据路径集体错位，而且不报错。
function findRoot(start) {
  let d = start;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(d, 'package.json'))) return d;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return path.join(start, '..');
}

const ROOT = findRoot(__dirname);

// ---------------------------------------------------------------------------
// 目录登记表：文件名 → 相对目录
// 现在全部为 ''（仓库根）。迁移时按清单填写，例如：
//   'hs300_daily_2010_2026.json': 'data/raw',
//   'phase5_backtest_data.json':  'data/processed',
//   'metrics_v16.json':           'data/derived',
//   '回测报告_v1.6_2026-11-08.html': 'reports/current',
//   '纸面执行台账_v1.6.html':        'tools/paper-ledger',
//   '投资策略规划_v1.6.md':          'docs/strategy',
// ---------------------------------------------------------------------------
const LAYOUT = {
  'ENGINES.md': 'docs/methodology',
  'P0审计报告_2026-11-08.md': 'docs/methodology',
  'alloc_data.json': 'data/derived',
  'bt_data.json': 'data/derived',
  'bt_data_v1.1_archive.json': 'data/derived',
  'csi_dividend_2010_2026.json': 'data/raw',
  'data_audit_report.json': 'data/derived',
  'data_manifest.json': 'data/derived',
  'extended_data.json': 'data/derived',
  'final_audit_data.json': 'data/derived',
  'final_team_notes.json': 'data/derived',
  'hs300_daily_2010_2026.json': 'data/raw',
  'metrics_v16.json': 'data/derived',
  'phase2_baseline_data.json': 'data/processed',
  'phase2_probe_stdout.txt': 'research/logs',
  'phase5_backtest_data.json': 'data/processed',
  'phase5_backtest_stdout.txt': 'research/logs',
  'phase5_scaffold_check.json': 'data/derived',
  'phase5_scaffold_stdout.txt': 'research/logs',
  'phase6_stress_stdout.txt': 'research/logs',
  'phase6_stress_v16.json': 'data/derived',
  'portfolio-health-final-plan-2026-11-07.md': 'docs/decisions',
  'regression_baseline.json': 'data/derived',
  'round4_lead_rulings.md': 'docs/decisions',
  'round4_phase1_notes.md': 'docs/decisions',
  'round4_phase2_baseline.md': 'docs/decisions',
  'round4_phase3_dividend.md': 'docs/decisions',
  'round4_phase3_etf.md': 'docs/decisions',
  'round4_phase3_etf_interface.md': 'docs/decisions',
  'round4_phase3_quant.md': 'docs/decisions',
  'round4_phase4_candidates.md': 'docs/decisions',
  'round4_phase5_backtest.md': 'docs/decisions',
  'valuation_semiannual_2010_2026.json': 'data/raw',
  '回测报告_2010-2026.html': 'reports/archive',
  '回测报告_v1.6_2026-11-08.html': 'reports/current',
  '回测报告_修正版_2026-11-07.html': 'reports/archive',
  '回测报告_卖出规则_2026-11-06.html': 'reports/archive',
  '回测报告_卖出规则_2026-11-06_v1.1口径.html': 'reports/archive',
  '回测报告_扩展验证_2026-11-07.html': 'reports/archive',
  '回测报告_最终方案审计_2026-11-07.html': 'reports/archive',
  '投资策略规划_v1.0.md': 'docs/strategy/archive',
  '投资策略规划_v1.1.md': 'docs/strategy/archive',
  '投资策略规划_v1.2.md': 'docs/strategy/archive',
  '投资策略规划_v1.3.md': 'docs/strategy/archive',
  '投资策略规划_v1.4.md': 'docs/strategy/archive',
  '投资策略规划_v1.5.md': 'docs/strategy/archive',
  '投资策略规划_v1.6.md': 'docs/strategy',
  '策略审计报告_v1.0_20261106.html': 'reports/archive',
  '策略评估报告_2026-11-07.md': 'docs/methodology',
  '纸面执行台账_v1.6.html': 'tools/paper-ledger',
  'gate3.js': 'tools/paper-ledger',
  'gate3_state.json': 'tools/paper-ledger',
  'gate3_backup.json': 'tools/paper-ledger',
  '第三关_周记.md': 'tools/paper-ledger',
  '配置调整报告_v1.2.html': 'reports/archive',
};

// 回退搜索顺序：只在登记表没覆盖、或文件尚未搬到位时使用。
// 顺序 = 从最具体到最泛，避免「根目录的老副本」压过「新目录的正式文件」。
const SEARCH = [
  'data/raw', 'data/processed', 'data/derived', 'data/metadata',
  'reports/current', 'reports/archive', 'reports/releases',
  'docs/strategy', 'docs/methodology', 'docs/decisions',
  'tools/paper-ledger', 'research/logs', 'research/experiments',
  'src', 'src/engine', 'src/data', 'src/pipeline', 'src/report', 'src/lib', 'tests',
  ''
];

const NO_LAYOUT_YET = Object.keys(LAYOUT).length === 0;

function dirOf(name) { return LAYOUT[name] || ''; }

// 读：登记目录优先，其次按 SEARCH 找一个真实存在的，最后回到根目录（让报错信息更直白）
function resolve(name) {
  if (path.isAbsolute(name)) return name;
  const first = path.join(ROOT, dirOf(name), name);
  if (fs.existsSync(first)) return first;
  for (const d of SEARCH) {
    const p = path.join(ROOT, d, name);
    if (fs.existsSync(p)) return p;
  }
  return first;
}

// 写：不搜索，只写登记目录。写盘路径必须唯一，否则会出现「两份 JSON，谁是真的」。
function out(name) {
  const p = path.join(ROOT, dirOf(name), name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  return p;
}

// 相对路径显示（日志里不要打印绝对路径，换台机器就变成噪音）
const rel = p => path.relative(ROOT, p).split(path.sep).join('/');

module.exports = { ROOT, LAYOUT, NO_LAYOUT_YET, dirOf, resolve, out, rel, exists: n => fs.existsSync(resolve(n)) };
