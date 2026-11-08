#!/usr/bin/env node
// ============================================================================
// tools/migration/apply_v1.js — 阶段一目录迁移执行器
// 2026-11-08 ｜ 第七轮（工程骨架）
//
// ★ 设计原则 ★
//   1) 默认干跑。不加 --apply 只打印计划，不动任何文件。
//   2) 只做机械搬运，不碰任何计算逻辑。唯一允许的代码改动是路径与 require：
//        - lib/paths.js 的 LAYOUT 登记表（由本表生成，不手写）
//        - src/*.js 的 require('./lib/…') → require('../lib/…')
//        - tests/*.js 的 require 指向 ../src 与 ../lib
//        - run_all.js 的步骤路径、package.json 的 scripts
//   3) 迁移后立刻跑 run_all --full，并对比 phase5 / phase6 的【内容哈希】。
//      哈希不相等 = 有数字变了 = 立刻回滚（git reset --hard ORIG_HEAD）。
//
//   为什么必须先做这一步、不能直接 mv：
//     - 脚本用 require('./lib/paths.js') 相对【模块目录】解析，搬家即断；
//     - JSON 的 require('./x.json') 同理（已在正式代码里改成路径登记表）；
//     - 输出文件写在自己所在目录，搬家后 JSON 会散落在 src/ 里。
//
// 用法：
//   node tools/migration/apply_v1.js              # 干跑，打印计划
//   node tools/migration/apply_v1.js --apply      # 执行
//   node tools/migration/apply_v1.js --apply --no-verify   # 执行但不跑闸门（不推荐）
//   git reset --hard ORIG_HEAD                    # 回滚
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const APPLY = process.argv.includes('--apply');
const VERIFY = !process.argv.includes('--no-verify');
const MAP = JSON.parse(fs.readFileSync(path.join(__dirname, 'map_v1.json'), 'utf8'));
const C = require(path.join(ROOT, 'lib', 'canonical.js'));

const L = console.log;
const ok = s => L('  ✓ ' + s);
const warn = s => L('  ! ' + s);

// ---------------------------------------------------------------------------
// 0. 迁移前指纹
// ---------------------------------------------------------------------------
function contentHash(name, strip) {
  const p = path.join(ROOT, name);
  if (!fs.existsSync(p)) return null;
  try { return C.contentHash(p, strip || []); } catch (e) { return C.hashFile(p); }
}
const BEFORE = {
  p5: contentHash('phase5_backtest_data.json', []),
  p6: contentHash('phase6_stress_v16.json', ['meta.generated'])
};

// ---------------------------------------------------------------------------
// 1. 打印计划
// ---------------------------------------------------------------------------
L('');
L('=== 阶段一目录迁移 ' + (APPLY ? '（执行）' : '（干跑，不动文件）') + ' ===');
L('');
const groups = {};
MAP.entries.forEach(e => {
  const d = path.posix.dirname(e.to);
  (groups[d] = groups[d] || []).push(e);
});
Object.keys(groups).sort().forEach(d => {
  L('  ' + d + '/  (' + groups[d].length + ' 个)');
  groups[d].forEach(e => L('     ' + e.from.padEnd(44) + ' → ' + e.to));
});
L('');
L('  留在根目录：' + MAP.stay.map(s => s.path).join('、'));

if (!APPLY) {
  L('');
  L('  干跑结束。加 --apply 执行。');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 2. 移动（优先 git mv，保留历史）
// ---------------------------------------------------------------------------
const hasGit = fs.existsSync(path.join(ROOT, '.git'));
let moved = 0, skipped = 0;
MAP.entries.forEach(e => {
  const from = path.join(ROOT, e.from);
  const to = path.join(ROOT, e.to);
  if (!fs.existsSync(from)) { skipped++; return; }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (hasGit) {
    try { execFileSync('git', ['mv', e.from, e.to], { cwd: ROOT, stdio: 'ignore' }); moved++; return; }
    catch (_) { /* 未跟踪文件退回 rename */ }
  }
  fs.renameSync(from, to);
  moved++;
});
L('');
ok('已移动 ' + moved + ' 个文件' + (skipped ? '（跳过 ' + skipped + ' 个不存在的）' : ''));

// 清理空目录
['deliverables/a-share', 'deliverables'].forEach(d => {
  const p = path.join(ROOT, d);
  if (fs.existsSync(p) && fs.readdirSync(p).length === 0) fs.rmdirSync(p);
});

// ---------------------------------------------------------------------------
// 3. 填 LAYOUT（由迁移表生成，不手写）
// ---------------------------------------------------------------------------
const pathsFile = path.join(ROOT, 'lib', 'paths.js');
let src = fs.readFileSync(pathsFile, 'utf8');
if (/const LAYOUT = \{\s*\/\/ '文件名': '目录',\s*\};/.test(src)) {
  const lines = MAP.entries
    .filter(e => !e.to.startsWith('src/') && !e.to.startsWith('tests/'))
    .map(e => "  '" + path.posix.basename(e.to) + "': '" + path.posix.dirname(e.to) + "',")
    .sort()
    .join('\n');
  src = src.replace(/const LAYOUT = \{\s*\/\/ '文件名': '目录',\s*\};/,
    'const LAYOUT = {\n' + lines + '\n};');
  fs.writeFileSync(pathsFile, src, 'utf8');
  ok('已写入 LAYOUT 登记（' + lines.split('\n').length + ' 条）');
} else {
  warn('LAYOUT 非空或格式已变，跳过自动填写（请人工核对 lib/paths.js）');
}

// ---------------------------------------------------------------------------
// 4. 修 require 与入口路径
// ---------------------------------------------------------------------------
function patch(file, pairs) {
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) return 0;
  let s = fs.readFileSync(p, 'utf8'), n = 0;
  pairs.forEach(([a, b]) => { if (s.includes(a)) { s = s.split(a).join(b); n++; } });
  if (n) fs.writeFileSync(p, s, 'utf8');
  return n;
}

let reqFixed = 0;
fs.readdirSync(path.join(ROOT, 'src')).filter(f => f.endsWith('.js')).forEach(f => {
  reqFixed += patch('src/' + f, [["require('./lib/", "require('../lib/"]]);
});
ok('src/ 内 require 已指向 ../lib（' + reqFixed + ' 个文件）');

// ---------------------------------------------------------------------------
// 4b. 历史脚本的 cwd 相对路径 → 路径登记表
//     这些脚本（bt_data / bt_report / *_report / phase2_baseline …）读的是
//     fs.readFileSync('hs300_daily_2010_2026.json')，基准是「运行时 cwd」。
//     数据一搬进 data/raw，它们全部 ENOENT，而且报错信息不会提到路径基准。
//     只改路径解析，不改任何计算。
// ---------------------------------------------------------------------------
const BARE = /fs\.(readFileSync|writeFileSync|existsSync)\('([^'\/\\]+\.(?:json|txt|html|md))'/g;
function ensurePT(s) {
  if (s.includes("require('../lib/paths.js')")) return s;
  const m = s.match(/^const fs = require\('fs'\);[ \t]*$/m);
  if (m) return s.replace(m[0], m[0] + "\nconst PT = require('../lib/paths.js');");
  const m2 = s.match(/^const .*require\(.*\);[ \t]*$/m);
  if (m2) return s.replace(m2[0], m2[0] + "\nconst PT = require('../lib/paths.js');");
  return s;
}

let cwdFixed = 0, jsonReqFixed = 0;
fs.readdirSync(path.join(ROOT, 'src')).filter(f => f.endsWith('.js')).forEach(f => {
  const p = path.join(ROOT, 'src', f);
  let s = fs.readFileSync(p, 'utf8');
  const before = s;
  s = s.replace(BARE, (mm, fn, name) => {
    cwdFixed++;
    const inner = 'PT.' + (fn === 'writeFileSync' ? 'out' : 'resolve') + "('" + name + "')";
    return 'fs.' + fn + '(' + inner;
  });
  s = s.replace(/require\('\.\/([^']+\.json)'\)/g, (mm, name) => {
    jsonReqFixed++;
    return "JSON.parse(fs.readFileSync(PT.resolve('" + name + "'), 'utf8'))";
  });
  // 还有一类藏得更深：加载器写成 const kl = f => JSON.parse(fs.readFileSync(f, 'utf8'))，
  // 文件名是【调用时】才传进来的，正则看不到字面量。只能改加载器内部的基准。
  s = s.replace(/fs\.readFileSync\(f, 'utf8'\)/g, () => {
    cwdFixed++;
    return "fs.readFileSync(PT.resolve(f), 'utf8')";
  });
  if (s !== before) {
    s = ensurePT(s);
    fs.writeFileSync(p, s, 'utf8');
  }
});
ok('历史脚本 cwd 相对路径已改为路径登记（读取 ' + cwdFixed + ' 处，JSON require ' + jsonReqFixed + ' 处）');

let tFixed = 0;
fs.readdirSync(path.join(ROOT, 'tests')).filter(f => f.endsWith('.js')).forEach(f => {
  tFixed += patch('tests/' + f, [
    ["require('./lib/paths.js')", "require('../lib/paths.js')"],
    ["require('./phase2_indices.js')", "require('../src/phase2_indices.js')"],
    ["require('./bt_r_clause.js')", "require('../src/bt_r_clause.js')"],
    ["path.join(__dirname, '纸面执行台账_v1.6.html')", "require('../lib/paths.js').resolve('纸面执行台账_v1.6.html')"]
  ]);
});
ok('tests/ 内 require 已指向 ../src 与 ../lib（' + tFixed + ' 处）');

// run_all 的步骤路径
const stepMap = {
  'data_audit.js': 'src/data_audit.js',
  'metrics_v16.js': 'src/metrics_v16.js',
  'manifest.js': 'src/manifest.js',
  'phase5_run.js': 'src/phase5_run.js',
  'phase5_sensitivity.js': 'src/phase5_sensitivity.js',
  'phase6_stress_v16.js': 'src/phase6_stress_v16.js',
  'test_report_consistency.js': 'tests/test_report_consistency.js',
  'test_regression.js': 'tests/test_regression.js',
  'test_ledger_v16.js': 'tests/test_ledger_v16.js'
};
let ra = fs.readFileSync(path.join(ROOT, 'run_all.js'), 'utf8');
Object.keys(stepMap).forEach(k => {
  ra = ra.split("file: '" + k + "'").join("file: '" + stepMap[k] + "'");
});
fs.writeFileSync(path.join(ROOT, 'run_all.js'), ra, 'utf8');
ok('run_all.js 步骤路径已更新');

// package.json scripts
const pkgFile = path.join(ROOT, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
Object.keys(pkg.scripts).forEach(k => {
  let v = pkg.scripts[k];
  Object.keys(stepMap).forEach(f => { v = v.split('node ' + f).join('node ' + stepMap[f]); });
  pkg.scripts[k] = v;
});
fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
ok('package.json scripts 已更新');

// ---------------------------------------------------------------------------
// 5. 验证：闸门 + 内容哈希
// ---------------------------------------------------------------------------
if (!VERIFY) {
  L('');
  warn('已跳过验证（--no-verify）。请在提交前手动执行 node run_all.js --full。');
  process.exit(0);
}

L('');
L('--- 跑 run_all.js --full ---');
let verifyOk = true, out = '';
try {
  out = execFileSync('node', [path.join(ROOT, 'run_all.js'), '--full'], { cwd: ROOT, encoding: 'utf8' });
} catch (e) {
  verifyOk = false;
  out = (e.stdout || '') + (e.stderr || '');
}
L(out.split('\n').filter(l => /✓|✗|通过|失败/.test(l)).join('\n'));

const AFTER = {
  p5: contentHash('data/processed/phase5_backtest_data.json', []),
  p6: contentHash('data/derived/phase6_stress_v16.json', ['meta.generated'])
};
const same = k => BEFORE[k] && AFTER[k] && BEFORE[k] === AFTER[k];

L('');
L('--- 数字是否变化（内容哈希对比）---');
[['p5', 'phase5_backtest_data.json'], ['p6', 'phase6_stress_v16.json']].forEach(([k, name]) => {
  L('  ' + name.padEnd(30) + (same(k) ? '✓ 逐位相同' : '✗ 变了：' + String(BEFORE[k]).slice(0, 16) + ' → ' + String(AFTER[k]).slice(0, 16)));
});

// ---------------------------------------------------------------------------
// 6. 历史脚本复现校验
//    仅「当前链路没过坏事」还不够：这批脚本生成的是历史报告，它们的数字是
//    已经写进文档的证据。搬完必须证明「同一个脚本、同一份数据、同样的字节」。
// ---------------------------------------------------------------------------
const LB = JSON.parse(fs.readFileSync(path.join(__dirname, 'legacy_baseline.json'), 'utf8'));
const PT = require(path.join(ROOT, 'lib', 'paths.js'));
let legacyBad = [];

L('');
L('--- 历史脚本复现（' + LB.scripts.length + ' 个，输出须逐字节相同）---');
LB.scripts.forEach(s => {
  const p = path.join(ROOT, 'src', s);
  if (!fs.existsSync(p)) { L('  ✗ ' + s.padEnd(22) + ' 文件不存在'); legacyBad.push(s); return; }
  try {
    execFileSync('node', [p], { cwd: ROOT, stdio: 'ignore', timeout: 300000 });
    L('  ✓ ' + s.padEnd(22) + ' 运行成功');
  } catch (e) {
    L('  ✗ ' + s.padEnd(22) + ' 运行失败');
    legacyBad.push(s);
  }
});

Object.keys(LB.outputs).forEach(name => {
  const p = PT.resolve(name);
  const h = fs.existsSync(p) ? C.hashFile(p) : null;
  const okH = h === LB.outputs[name];
  L('  ' + (okH ? '✓' : '✗') + ' ' + name.padEnd(38) + (okH ? '字节相同' : '不一致'));
  if (!okH) legacyBad.push(name);
});

L('');
if (verifyOk && same('p5') && same('p6') && legacyBad.length === 0) {
  L('✓ 迁移完成：闸门 ' + (verifyOk ? '11/11' : '有失败') + '，主链路数字零变化，历史产物逐字节复现。');
  L('  下一步：git add -A && git commit -m "重构：阶段一目录治理（平移，数字零变化）"');
  process.exit(0);
}
if (legacyBad.length) L('  历史脚本/产物未复现：' + legacyBad.join('、'));
L('✗ 迁移未通过。回滚：git reset --hard ORIG_HEAD');
process.exit(1);
