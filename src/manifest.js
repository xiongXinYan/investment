// ============================================================================
// manifest.js — 回测指纹（复现凭证）
// 2026-11-08 ｜ 第七轮（工程骨架）
//
// ★ 存在理由（外部审阅建议 3：回测结果指纹）★
//   一年后回看「3.327% 的年化」，必须能回答三件事：
//     用的哪份数据？哪版引擎？哪套配置？
//   没有指纹时，唯一的答案叫「大概是那时候的代码」，等于没有答案。
//
// ★ 纪律 ★
//   1) 不编造语义版本号。引擎版本用【内容哈希】，因为没有任何变更历史支撑
//      「engineVersion 1.0.0」这种说法——编出来的版本号会暗示一个不存在的发布流程。
//   2) 数据用文件哈希（原始输入不变才叫可复现），数值产物用内容哈希（排除时间戳）。
//   3) manifest.json 自身含 generatedAt，因此【它的文件哈希每次都会变】——
//      禁止拿 manifest 的文件哈希做对账，要对比就对比 manifest 内部字段。
//
// 用法：node manifest.js            写 manifest.json
//       node manifest.js --check    只打印，不写盘
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const C = require('../lib/canonical.js');

const PT = require('../lib/paths.js');
const ROOT = PT.ROOT;
const P = PT.resolve;
const CHECK = process.argv.includes('--check');

function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (e) { return null; }
}

// ---------------------------------------------------------------------------
// 1. 输入：配置 / 数据 / 代码
// ---------------------------------------------------------------------------
const cfgFile = 'config/strategy/v1.6.json';
if (!fs.existsSync(P(cfgFile))) {
  console.error('✗ 找不到 ' + cfgFile + '，无法生成指纹。');
  process.exit(1);
}
const CFG = JSON.parse(fs.readFileSync(P(cfgFile), 'utf8'));

// 数据 = 三个原始输入。这是「结果是否可比」的唯一判据。
const DATA = [
  { file: 'hs300_daily_2010_2026.json', role: 'raw:沪深300日线' },
  { file: 'csi_dividend_2010_2026.json', role: 'raw:中证红利日线' },
  { file: 'valuation_semiannual_2010_2026.json', role: 'raw:半年度股息率' }
].map(d => Object.assign({}, d, { bytes: fs.statSync(P(d.file)).size, sha256: C.hashFile(P(d.file)) }));

// 引擎 = 参与计算规则的文件；pipeline = 产出数字的脚本。分开登记，因为
// 「换了报告生成器」和「换了计算规则」的后果完全不同。
const ENGINE_FILES = ['phase2_indices.js', 'bt_r_clause.js', 'valuation_series.js'];
const PIPELINE_FILES = ['phase5_run.js', 'phase5_sensitivity.js', 'phase6_stress_v16.js', 'metrics_v16.js'];

// ---------------------------------------------------------------------------
// 2. 输出产物
// ---------------------------------------------------------------------------
const outs = [];
function addOut(file, opts) {
  if (!fs.existsSync(P(file))) { outs.push({ file, missing: true }); return; }
  const o = { file, bytes: fs.statSync(P(file)).size, sha256: C.hashFile(P(file)) };
  if (opts && opts.contentHash) {
    o.contentHash = C.contentHash(P(file), opts.strip || []);
    o.contentHashExclude = opts.strip || [];
    o.note = '内容哈希排除时间戳字段，是数值是否变化的唯一判据';
  }
  outs.push(o);
}
addOut('phase5_backtest_data.json', { contentHash: true, strip: [] });
addOut('phase6_stress_v16.json', { contentHash: true, strip: ['meta.generated'] });
addOut('metrics_v16.json', { contentHash: true, strip: ['meta.generatedAt'] });
addOut('regression_baseline.json');

// ---------------------------------------------------------------------------
// 3. 组装
// ---------------------------------------------------------------------------
const commit = git(['rev-parse', 'HEAD']);
// ★ 必须带 `--`。旧写法 ['status','porcelain'] 实际执行的是 `git status porcelain`，
// Git 会把它当成 pathspec 并输出人类可读摘要（working tree clean），
// 导致工作区明明是脏的，指纹却长期写 dirty:false。这是「可复现凭证」的根级失效。
// core.quotepath=false：否则中文路径会被输出成 "\350\277..." 的八进制转义，
// 人能看出「有改动」，但看不出改的是哪份文档。
const dirtyRaw = git(['-c', 'core.quotepath=false', 'status', '--porcelain']);
// 生成产物不算「工作区不干净」：它们每次跑闸门都会被重写（只差时间戳）。
// 若计入，dirty 永远为 true，这个标志就失去了判据作用。
// 真正要盯的是【输入】是否变了：代码、配置、文档、原始数据。
const GENERATED = new Set([
  'manifest.json', 'data_audit_report.json', 'data_manifest.json', 'metrics_v16.json',
  'phase5_backtest_data.json', 'phase6_stress_v16.json', 'regression_baseline.json'
]);
// 只接受 porcelain 的「两字符状态 + 空格」行。若格式变化或误用了人类可读输出，
// 解析结果会为空——此时宁可失败，也不能把「解析不到」写成「工作区干净」。
const dirtyAll = dirtyRaw ? dirtyRaw.split('\n')
  .filter(l => /^[ MADRCU?!]{2}\s/.test(l)).map(l => l.slice(3)) : [];
if (dirtyRaw && dirtyRaw.trim() && dirtyAll.length === 0) {
  console.error('✗ git status --porcelain 有输出但无法解析为文件状态，拒绝把未知状态写成 clean：');
  console.error(dirtyRaw.slice(0, 200));
  process.exit(1);
}
const dirtyFiles = dirtyAll.filter(f => !GENERATED.has(path.basename(f)));
const dirtyGenerated = dirtyAll.filter(f => GENERATED.has(path.basename(f)));

const manifest = {
  schema: 'backtest-manifest/v1',
  strategyVersion: CFG.version,
  reportVersion: '1.6',
  status: CFG.status,
  config: {
    file: cfgFile,
    sha256: C.hashFile(P(cfgFile)),
    canonicalHash: C.hashJson(CFG),
    note: 'canonicalHash 与书写顺序/缩进无关；sha256 是文件字节指纹。两者都记，避免「只改了空格也算变更」的误判。'
  },
  engine: { files: ENGINE_FILES, hash: C.hashFileSet(ENGINE_FILES.map(P)) },
  pipeline: { files: PIPELINE_FILES, hash: C.hashFileSet(PIPELINE_FILES.map(P)) },
  data: { files: DATA, hash: C.hashFileSet(DATA.map(d => P(d.file))) },
  outputs: outs,
  git: {
    commit,
    commitShort: commit ? commit.slice(0, 7) : null,
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    dirty: dirtyFiles.length > 0,
    dirtyFiles,
    dirtyGenerated,
    dirtyNote: 'dirty 只看输入（代码/配置/文档/数据）；dirtyGenerated 是重跑闸门产生的时间戳差异，不影响可复现性'
  },
  reproduce: 'node run_all.js --full',
  generatedAt: new Date().toISOString(),
  honesty: 'git.dirty=true 时本指纹只描述「工作区当前状态」，不是任何已发布版本。发布前必须 commit 后重跑。'
};

// ---------------------------------------------------------------------------
// 4. 输出
// ---------------------------------------------------------------------------
const L = console.log;
L('=== 回测指纹 ===');
L('策略版本  v' + manifest.strategyVersion + '   报告版本  ' + manifest.reportVersion);
L('配置      ' + manifest.config.canonicalHash.slice(0, 16) + '…');
L('引擎      ' + manifest.engine.hash.slice(0, 16) + '…   (' + ENGINE_FILES.length + ' 个文件)');
L('数据      ' + manifest.data.hash.slice(0, 16) + '…');
DATA.forEach(d => L('          ' + d.file.padEnd(42) + (d.bytes / 1024).toFixed(0).padStart(5) + ' KB'));
L('提交      ' + (manifest.git.commitShort || '（非 git 仓库）') + (manifest.git.dirty ? '  ⚠ 工作区有未提交改动 ' + dirtyFiles.length + ' 项' : '  干净'));
L('');
outs.forEach(o => {
  if (o.missing) { L('  ✗ ' + o.file + ' 缺失'); return; }
  L('  ✓ ' + o.file.padEnd(30) + (o.contentHash || o.sha256).slice(0, 16) + '…' + (o.contentHash ? '  (内容)' : ''));
});

if (CHECK) {
  L('');
  L('--check 模式：未写盘。');
} else {
  fs.writeFileSync(PT.out('manifest.json'), JSON.stringify(manifest, null, 1), 'utf8');
  L('');
  L('✓ 已写入 manifest.json');
  if (manifest.git.dirty) L('  ⚠ 工作区不干净，这份指纹不绑定任何已发布版本。');
}
