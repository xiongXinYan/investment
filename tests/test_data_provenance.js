// ============================================================================
// test_data_provenance.js — 数据溯源校验
// 2026-11-08 ｜ 第七轮（工程可靠性）
//
// ★ 存在理由（审计 D7 / 外部审阅「数据可追溯性」）★
//   仓库有三份原始数据，此前只有 sha256 快照。sha256 只能证明「文件没变」，
//   不能回答：这是谁给的？是不是全收益指数？含不含分红？有没有被后续修订？
//   而「是否含分红」直接决定股息 carry 会不会被重复计入——这是唯一一个
//   能把全部年化数字整体推翻的输入假设。
//
//   本文件做两件事：
//     1. 强制每份原始数据都有元信息（缺一份就失败，不能有「忘了写」的漏网）
//     2. 强制元信息与文件本身、data_manifest.json、metrics_v16.json 三方一致
//   并且**不允许**用「看起来像真的」来源填空：source 未知必须写 unverified
//   并附说明，否则校验不通过。宁可留下空白，不要留下假证据。
//
// 用法：
//   node tests/test_data_provenance.js
//   node tests/test_data_provenance.js --verbose
// ============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PT = require('../lib/paths.js');

const VERBOSE = process.argv.slice(2).includes('--verbose');
const RAW_DIR = PT.resolve('data/raw');
const META = JSON.parse(fs.readFileSync(PT.resolve('data/metadata/datasets.json'), 'utf8'));

const rows = [];
const add = (ok, id, label, detail) => rows.push({ ok, id, label, detail: detail === undefined ? '' : String(detail) });
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const day = s => {
  // valuation 用 20100630 这种紧凑日期，行情用 2010-01-04
  if (/^\d{8}$/.test(s)) return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
  return s;
};

// 读取器：按文件形态解析出「行数 + 首末日」，用于核对元信息没有说谎
const READERS = {
  klines: j => {
    const k = j.data.klines.map(l => l.split(','));
    return { rows: k.length, startDate: day(k[0][0]), endDate: day(k[k.length - 1][0]) };
  },
  valuation: j => {
    const r = j.rows;
    return { rows: r.length, startDate: day(r[0][0]), endDate: day(r[r.length - 1][0]) };
  }
};

const MANIFEST = JSON.parse(fs.readFileSync(PT.resolve('data_manifest.json'), 'utf8')).files;
const MANIFEST_BY_FILE = {};
Object.keys(MANIFEST).forEach(k => { MANIFEST_BY_FILE[MANIFEST[k].file] = MANIFEST[k]; });

const METRICS = JSON.parse(fs.readFileSync(PT.resolve('metrics_v16.json'), 'utf8'));
const METRICS_SHA = {};
(METRICS.meta.sources || []).forEach(s => { METRICS_SHA[s.file] = s.sha256; });

// ---------------------------------------------------------------------------
// 1. 覆盖面：raw 目录与元信息必须双向一一对应
// ---------------------------------------------------------------------------
const rawFiles = fs.readdirSync(RAW_DIR).filter(f => !f.startsWith('.')).sort();
const declared = META.datasets.map(d => d.file).sort();

add(JSON.stringify(rawFiles) === JSON.stringify(declared), 'P1',
  'data/raw 每份文件都有元信息，且元信息不指向不存在的文件',
  JSON.stringify(rawFiles) === JSON.stringify(declared)
    ? `${rawFiles.length} 份`
    : `raw=[${rawFiles}] 声明=[${declared}]`);

// ---------------------------------------------------------------------------
// 2. 逐份核对
// ---------------------------------------------------------------------------
const REQUIRED = ['file', 'dataset', 'symbol', 'frequency', 'rows', 'startDate', 'endDate',
  'source', 'adjustment', 'dividendIncluded', 'currency', 'sha256', 'version'];

META.datasets.forEach(d => {
  const tag = d.dataset;
  const fp = path.join(RAW_DIR, d.file);

  // 2.1 必填字段
  const missing = REQUIRED.filter(k => d[k] === undefined || d[k] === null || d[k] === '');
  add(missing.length === 0, 'P2', `[${tag}] 必填字段齐全`, missing.length ? '缺：' + missing.join(',') : REQUIRED.length + ' 项');

  // 2.2 sha256 三方一致（元信息 / 实际文件 / data_manifest / metrics）
  const actual = sha(fp);
  add(d.sha256 === actual, 'P3', `[${tag}] 元信息 sha256 = 文件实际哈希`,
    d.sha256 === actual ? actual.slice(0, 16) + '…' : `元信息 ${String(d.sha256).slice(0, 16)} 实际 ${actual.slice(0, 16)}`);

  const mf = MANIFEST_BY_FILE[d.file];
  add(!!mf && mf.sha256 === actual, 'P4', `[${tag}] 与 data_manifest.json 一致`,
    mf ? (mf.sha256 === actual ? 'ok' : 'manifest 已过期，先跑 node src/data_audit.js') : 'manifest 中无此文件');

  const ms = METRICS_SHA[d.file];
  add(ms === undefined || ms === actual, 'P5', `[${tag}] 与 metrics_v16.json 的输入快照一致`,
    ms === undefined ? '（该文件不直接进 metrics，跳过）' : (ms === actual ? 'ok' : 'metrics 是用另一份数据算的'));

  // 2.3 行数与区间：元信息不能凭记忆写
  const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const reader = j.data && j.data.klines ? READERS.klines : (j.rows ? READERS.valuation : null);
  if (!reader) {
    add(false, 'P6', `[${tag}] 无法识别的文件形态`, '需要为本格式补一个读取器');
  } else {
    const real = reader(j);
    const same = real.rows === d.rows && real.startDate === d.startDate && real.endDate === d.endDate;
    add(same, 'P6', `[${tag}] 行数与起止日期与文件一致`,
      same ? `${real.rows} 行 ${real.startDate}~${real.endDate}`
        : `元信息 ${d.rows} 行 ${d.startDate}~${d.endDate} / 实际 ${real.rows} 行 ${real.startDate}~${real.endDate}`);
  }

  // 2.4 分红口径必须显式声明（重复计入是唯一能整体推翻年化的错误）
  const divOk = typeof d.dividendIncluded === 'boolean'
    && (d.dividendIncluded === true || (d.dividendIncludedBasis && d.dividendIncludedBasis.length > 0));
  add(divOk, 'P7', `[${tag}] dividendIncluded 显式声明且带依据`,
    `dividendIncluded=${d.dividendIncluded} / ${d.dividendIncludedBasis || '缺依据'}`);

  // 2.5 来源必须带证据等级。file-field（文件自带）/ internal-record（项目记录自述）/
  //     none（无据 → 必须写 unverified 并说明）。不区分等级，就会把「我记得是某接口」
  //     和「文件里白纸黑字写着 source」当成同一件事。
  const EVIDENCE = ['file-field', 'internal-record', 'none'];
  const ev = d.sourceEvidence;
  let srcOk, srcDetail;
  if (!EVIDENCE.includes(ev)) {
    srcOk = false; srcDetail = `sourceEvidence 非法：${ev}`;
  } else if (ev === 'none') {
    srcOk = d.source === 'unverified' && typeof d.sourceNote === 'string' && d.sourceNote.length >= 20;
    srcDetail = `none → ${d.source}：${(d.sourceNote || '').slice(0, 24)}…`;
  } else {
    srcOk = typeof d.source === 'string' && d.source.length >= 3 && d.source !== 'unverified'
      && typeof d.sourceRef === 'string' && d.sourceRef.length >= 10;
    srcDetail = `${ev}：${d.source} ← ${(d.sourceRef || '缺 sourceRef').slice(0, 30)}…`;
  }
  add(srcOk, 'P8', `[${tag}] 来源分证据等级（file-field / internal-record / none）`, srcDetail);

  // 2.5b 声称有来源，就必须知道什么时候取的、依据写在哪。
  // 文本里的来源名无法自动证伪，但「有来源却没有抓取时间」一定是编的或记不清了。
  if (d.sourceEvidence !== 'none') {
    const ok = /^\d{4}-\d{2}-\d{2}$/.test(String(d.fetched || ''));
    add(ok, 'P8b', `[${tag}] 声称有来源则必须记录抓取日期`, ok ? d.fetched : `fetched=${d.fetched}`);
  }

  // 2.6 币种
  add(d.currency === 'CNY', 'P9', `[${tag}] 币种为 CNY`, d.currency);
});

// ---------------------------------------------------------------------------
// 3. 未解决项必须登记（不能把「不知道」藏在字段里）
// ---------------------------------------------------------------------------
const unresolved = META.unresolved || [];
// 「不自证」= 不是文件自带来源。这类数据必须在 unresolved 里登记影响与处置，
// 否则「我记得是某接口」就变成了一条无法追问的隐性假设。
const notSelfEvident = META.datasets.filter(d => d.sourceEvidence !== 'file-field');
add(notSelfEvident.length === 0 || unresolved.length > 0, 'P10',
  '非文件自证的数据都在 unresolved 里登记了影响与处置',
  notSelfEvident.length === 0 ? '全部文件自证'
    : `${notSelfEvident.length} 份非自证（${notSelfEvident.map(d => d.dataset).join(',')}）/ ${unresolved.length} 条登记`);

// ---------------------------------------------------------------------------
// 输出
// ---------------------------------------------------------------------------
const bad = rows.filter(r => !r.ok);
console.log('─'.repeat(72));
console.log('数据溯源校验 ｜ 未确认的来源必须标记 unverified，不允许编造');
console.log('─'.repeat(72));
rows.forEach(r => {
  if (!r.ok || VERBOSE) console.log(`  ${r.ok ? '✓' : '✗'} ${r.id.padEnd(4)} ${r.label}  → ${r.detail}`);
});
console.log('─'.repeat(72));
if (bad.length === 0) {
  console.log(`✓ 通过 ${rows.length}/${rows.length} 项`);
  process.exit(0);
}
console.log(`✗ ${bad.length} 项失败`);
process.exit(1);
