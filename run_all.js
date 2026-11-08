// ============================================================================
// run_all.js — 单一验证入口
// 2026-11-08 ｜ 第五轮（工程闭环）
//
// ★ 存在理由（外部审阅问题 2）★
//   仓库里有 20+ 个脚本，没人能记住「改完要先跑哪几个」。结果就是漏跑，
//   然后一份文档静默地与引擎脱钩——上一轮 HTML 报告里 8 处旧口径就是这么来的。
//
//   本文件把「提交前必须做的事」收成一条命令。
//
// 用法：
//   node run_all.js            只跑闸门（快，约 20 秒）
//   node run_all.js --full     闸门 + 重跑主回测 + 压力补跑 + 指标（慢，但完整）
//   node run_all.js --verbose  打印每道闸门的完整输出
//
// 退出码：全部通过 0，任一失败 1。
// ============================================================================

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// 绝对路径执行：任何子脚本都从本文件所在目录解析（__dirname），
// 因此在仓库根、子目录、或 npm script 里调用，行为一致。
// 这是目录迁移的前置条件——否则一搬家就「找不到数据文件」。
const ROOT = __dirname;
const P = f => path.join(ROOT, f);
const PT = require('./lib/paths.js');   // 目录登记表：文件搬家后这里不用改

const ARGS = process.argv.slice(2);
const FULL = ARGS.includes('--full');
const VERBOSE = ARGS.includes('--verbose');

const t0 = Date.now();

function run(step) {
  const started = Date.now();
  process.stdout.write('  … ' + step.label.padEnd(42));
  let ok = true, out = '';
  try {
    out = execFileSync('node', [P(step.file)].concat(step.args || []), {
      cwd: ROOT,
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: step.timeout || 300000
    });
  } catch (e) {
    ok = false;
    out = (e.stdout || '') + (e.stderr || '');
  }
  const ms = Date.now() - started;
  console.log((ok ? '✓' : '✗') + '  ' + (ms / 1000).toFixed(1) + 's' + (ok ? '' : '   ← 失败'));
  if (!ok || VERBOSE) {
    out.split('\n').filter(Boolean).forEach(l => console.log('      ' + l));
  }
  return { ok, out, ms };
}

// ---------------------------------------------------------------------------
// 闸门：每次都跑
// ---------------------------------------------------------------------------
const GATES = [
  { label: '数据审计（11 项，硬错误拒绝出数）', file: 'src/data_audit.js', args: ['--quiet'] },
  { label: '配置登记（config 与代码 34 项一致）', file: 'config/verify_config.js' },
  { label: '指标源生成（四档 R→E + 六种极差）', file: 'src/metrics_v16.js' },
  { label: '引擎不变量（46 项，含 T+1 / 无负现金）', file: 'tests/test_engine_invariants.js', args: ['--negative'] },
  { label: '数据溯源（27 项，来源/口径/哈希三方一致）', file: 'tests/test_data_provenance.js' },
  { label: '报告一致性（MD / HTML / README）', file: 'tests/test_report_consistency.js' },
  { label: '回归基线（17 用例整条净值序列）', file: 'tests/test_regression.js' },
  { label: '台账逻辑（浮点边界 / 空行守卫）', file: 'tests/test_ledger_v16.js' },
  { label: '回测指纹（config / data / 引擎 / 产物）', file: 'src/manifest.js' }
];

// ---------------------------------------------------------------------------
// 完整模式额外跑：真正重算
// ---------------------------------------------------------------------------
const RECOMPUTE = [
  { label: '主回测 phase5_run.js', file: 'src/phase5_run.js', timeout: 600000 },
  { label: 'C 表敏感性 phase5_sensitivity.js', file: 'src/phase5_sensitivity.js', timeout: 600000 },
  { label: '压力补跑 phase6_stress_v16.js', file: 'src/phase6_stress_v16.js', timeout: 600000 }
];

// 数据快照：跑完打印，便于与上一份报告对账
function snapshot() {
  const files = ['manifest.json', 'metrics_v16.json', 'phase5_backtest_data.json', 'phase6_stress_v16.json', 'regression_baseline.json'];
  return files.map(f => {
    const fp = PT.resolve(f);
    if (!fs.existsSync(fp)) return { f, ok: false };
    const st = fs.statSync(fp);
    return { f, ok: true, kb: (st.size / 1024).toFixed(0), at: new Date(st.mtime).toISOString().slice(0, 19).replace('T', ' ') };
  });
}

// ---------------------------------------------------------------------------
console.log('');
console.log('=== run_all  ' + (FULL ? '（完整：含重算）' : '（仅闸门）') + '  ' + new Date().toISOString().slice(0, 19).replace('T', ' ') + ' ===');
console.log('');

const steps = FULL ? GATES.concat(RECOMPUTE) : GATES;
const results = [];
for (const s of steps) {
  const r = run(s);
  results.push(Object.assign({ label: s.label }, r));
  if (!r.ok && s === steps[0]) {
    console.log('');
    console.log('✗ 第一道闸门就失败了 —— 数据层有问题时不继续，避免用坏数据产出「看起来正常」的数字。');
    process.exit(1);
  }
}

// 完整模式下，重算完必须再跑一次一致性（引擎变了，文档必须仍对齐）
if (FULL) {
  const again = run({ label: '重算后再校验一致性', file: 'tests/test_report_consistency.js' });
  results.push(Object.assign({ label: '重算后再校验一致性' }, again));
}

const fails = results.filter(r => !r.ok);
console.log('');
console.log('--- 数据快照 ---');
snapshot().forEach(s => console.log('  ' + (s.ok ? '✓' : '✗') + ' ' + s.f.padEnd(30) + (s.ok ? s.kb + ' KB   ' + s.at : '缺失')));

console.log('');
console.log('--- 小结 ---');
console.log('  通过 ' + (results.length - fails.length) + '/' + results.length +
  '   用时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');

if (fails.length) {
  console.log('');
  fails.forEach(f => console.log('  ✗ ' + f.label));
  console.log('');
  console.log('✗ 有闸门未通过。不要在这个状态下对外发布任何数字。');
  process.exit(1);
}

console.log('');
console.log('✓ 全部通过。可以提交。');
if (!FULL) console.log('  （要连引擎一起重算，加 --full）');
