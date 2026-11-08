// ============================================================================
// test_report_consistency.js — 报告一致性测试
// 2026-11-08 ｜ 第五轮（工程闭环）
//
// ★ 存在理由（外部审阅问题 1）★
//   v1.6 修正了「口径极差 1.301pp」，但只改了 Markdown，HTML 报告里 8 处旧数字
//   继续对外发布。这不是粗心，是结构问题：同一个结论在两份文件里各写一遍，
//   任何一次修正都只可能改到一半。
//
//   本测试把「改到一半」变成硬失败：metrics_v16.json 是唯一数据源，
//   三份文档都必须与它逐位一致，且不得再把已撤销的措辞当成主张。
//
// ★ 设计纪律 ★
//   负向自测必须复用【同一份】检查逻辑（buildResults），不能另写一个简化版——
//   否则验证的是那个简化版，不是真实测试。第一版就是这么错的：它只查 HTML 的
//   MDD，漏查 Markdown 的数字，于是「把 2.766pp 改坏」居然通过。
//
// 用法：
//   node test_report_consistency.js            正常校验
//   node test_report_consistency.js --negative 负向自测（证明测试真的能抓到错）
// ============================================================================

const fs = require('fs');
const path = require('path');

// 一律基于 __dirname 解析：从仓库根、子目录或 npm script 调用，结果一致。
const P = require('../lib/paths.js').resolve;

const DOCS = {
  md: '投资策略规划_v1.6.md',
  html: '回测报告_v1.6_2026-11-08.html',
  readme: 'README.md'
};

// 台账里也写死了一份 R→E 表（供离线工具自查），同样是「第四份带数字的文档」
const LEDGER = '纸面执行台账_v1.6.html';

// 每份文档必须出现哪些指标（不是所有文档都需要所有列，但需要的必须一字不差）
const REQ = {
  md: { r2e: ['mddPct', 'marginPP', 'ann252Pct', 'annCalPct'], caliber: 'all' },
  html: { r2e: ['mddPct', 'marginPP', 'ann252Pct'], caliber: 'all' },
  readme: { r2e: ['mddPct', 'ann252Pct'], caliber: ['single_main', 'grid160_cal'] }
};

// 已撤销的措辞。允许出现在「披露它为什么错」的句子里——用标记词豁免。
const BANNED = [
  { phrase: '4.21 倍', why: '1.301pp ÷ 0.309pp 的旧倍数，分母已判错' },
  { phrase: '2.13 倍', why: '2.766pp ÷ 1.301pp 的旧倍数' },
  { phrase: '2.13×', why: '2.766pp ÷ 1.301pp 的旧倍数' },
  { phrase: '2.17×', why: '2.827pp ÷ 1.301pp 的旧倍数' },
  { phrase: '2.23×', why: '2.898pp ÷ 1.301pp 的旧倍数' },
  { phrase: '2.47×', why: '3.208pp ÷ 1.301pp 的旧倍数' },
  { phrase: '≈ 2 倍口径极差', why: '已撤销的安全垫表述' },
  { phrase: '约 2 倍口径极差', why: '已撤销的安全垫表述' },
  { phrase: '1.3~1.5 倍', why: '那是 E=40% 的数，被错挂到 E=55%' }
];

// 出现这些词的句子，说明是在「披露错误」而不是「主张错误」，予以豁免
const DISCLOSURE_MARKERS = ['初稿', '不得再写', '撤销', '已更正', '误用', '分母错', '应改写', '不成立',
  '不匹配', '勘误', '修订记录'];

const f3 = x => x.toFixed(3);
const REAL = {};
Object.keys(DOCS).forEach(k => { REAL[k] = fs.readFileSync(P(DOCS[k]), 'utf8'); });
const M = JSON.parse(fs.readFileSync(P('metrics_v16.json'), 'utf8'));

// ---------------------------------------------------------------------------
// 数据源自身完整性（与文档无关，只需跑一次）
// ---------------------------------------------------------------------------
function sourceResults() {
  const r = [];
  const add = (ok, label, detail) => r.push({ ok, cat: 'SRC', label, detail });
  add(M.meta && M.meta.strategyVersion === 'v1.6', 'metrics 策略版本为 v1.6', M.meta && M.meta.strategyVersion);
  add(Array.isArray(M.r2e) && M.r2e.length === 4, 'R→E 为四档', M.r2e && M.r2e.length);
  add(Array.isArray(M.caliber) && M.caliber.length === 6, '口径极差为六种算法', M.caliber && M.caliber.length);
  add(Array.isArray(M.meta.sources) && M.meta.sources.every(s => /^[0-9a-f]{64}$/.test(s.sha256)),
    '五份输入数据均有 sha256 快照', (M.meta.sources || []).length + ' 份');
  add(M.stress && M.stress.totalCells === 36 && M.stress.invalid === 1,
    '压力路径 36 单元 / 1 个越界', M.stress ? M.stress.totalCells + '/' + M.stress.invalid : 'n/a');
  return r;
}

// ---------------------------------------------------------------------------
// 文档检查：同一份逻辑，正反两用
// ---------------------------------------------------------------------------
function buildResults(docs) {
  const r = [];
  const add = (ok, cat, label, detail) => r.push({ ok, cat, label, detail });

  // ---- 数值一致性 ----
  const mustContain = (docKey, token, label) => {
    const hit = (docs[docKey] || '').includes(token);
    add(hit, 'NUM', `[${docKey}] ${label} = ${token}`, hit ? '' : '文档中未找到该数值，或写法不一致');
  };
  Object.keys(REQ).forEach(docKey => {
    M.r2e.forEach(row => {
      REQ[docKey].r2e.forEach(field => {
        const suffix = field === 'marginPP' ? 'pp' : '%';
        mustContain(docKey, f3(row[field]) + suffix, `${field}（R=${row.R_pct}% / E=${row.E_pct}%）`);
      });
    });
    M.caliber.forEach(c => {
      const want = REQ[docKey].caliber === 'all' || REQ[docKey].caliber.includes(c.key);
      if (want) mustContain(docKey, f3(c.rangePP) + 'pp', `口径极差 ${c.key}`);
    });
  });

  // ---- 反措辞 ----
  Object.keys(DOCS).forEach(docKey => {
    const lines = (docs[docKey] || '').split('\n');
    BANNED.forEach(b => {
      let bad = 0, disclosed = 0;
      lines.forEach(ln => {
        if (!ln.includes(b.phrase)) return;
        if (DISCLOSURE_MARKERS.some(m => ln.includes(m))) disclosed++;
        else bad++;
      });
      add(bad === 0, 'BAN', `[${docKey}] 不得主张「${b.phrase}」`,
        bad === 0 ? (disclosed ? `已作为「已撤销」披露 ${disclosed} 处` : '')
          : `${bad} 处未加披露标记的引用 → ${b.why}`);
    });
  });

  // ---- 结构性 ----
  const html = docs.html || '';
  const h2 = (html.match(/<h2[ >]/g) || []).length;
  const tbl = (html.match(/<table[ >]/g) || []).length;
  add(h2 === 9, 'STRUCT', 'HTML 为 9 节', h2 + ' 节');
  add(tbl >= 12, 'STRUCT', 'HTML 表格数不少于 12', tbl + ' 张');
  add(html.includes('口径极差有六种算法'), 'STRUCT', 'HTML §4 含六种算法表', '');
  add((docs.md || '').includes('口径极差的四种算法'), 'STRUCT', 'MD §4.2 口径极差表存在', '');

  // ---- 撤销留痕：正文须出现「修订后的正确表述」，不能只删错误不写对 ----
  M.withdrawnClaims.forEach(w => {
    (w.mustAppear || []).forEach(tok => {
      add((docs.md || '').includes(tok), 'WITHDRAW', `[md] 撤销「${w.claim.slice(0, 14)}」后须出现 ${tok}`, '');
      add(html.includes(tok), 'WITHDRAW', `[html] 撤销「${w.claim.slice(0, 14)}」后须出现 ${tok}`, '');
    });
  });

  // ---- 台账内嵌 R→E 表必须与数据源一致 ----
  // 台账是离线单文件、不能 require JSON，所以它写死了一份表。
  // 「写死」正是最容易被忘记同步的地方，必须由测试盯着。
  let ledger = '';
  try { ledger = fs.readFileSync(P(LEDGER), 'utf8'); } catch (e) { ledger = ''; }
  add(ledger.length > 0, 'LEDGER', '台账文件可读', LEDGER);
  if (ledger) {
    const blocks = {};
    const re = /(0\.\d+)\s*:\s*\{([^}]*)\}/g;
    let m;
    while ((m = re.exec(ledger)) !== null) {
      const body = m[2];
      const grab = k => {
        const mm = body.match(new RegExp(k + '\\s*:\\s*(-?[0-9.]+)'));
        return mm ? parseFloat(mm[1]) : null;
      };
      blocks[Math.round(parseFloat(m[1]) * 100)] = { eq: grab('eq'), mdd: grab('mdd'), room: grab('room'), cagr: grab('cagr') };
    }
    M.r2e.forEach(row => {
      const b = blocks[Math.round(row.R_pct)];
      if (!b) { add(false, 'LEDGER', `台账含 R=${row.R_pct}% 档`, '缺该档'); return; }
      add(Math.abs(b.eq * 100 - row.E_pct) < 1e-9, 'LEDGER', `台账 R=${row.R_pct}% → E`, `台账 ${b.eq * 100}% vs 数据源 ${row.E_pct}%`);
      add(Math.abs(b.mdd - row.mddPct) < 1e-9, 'LEDGER', `台账 R=${row.R_pct}% → MDD`, `台账 ${b.mdd} vs 数据源 ${row.mddPct}`);
      add(Math.abs(b.room - row.marginPP) < 1e-9, 'LEDGER', `台账 R=${row.R_pct}% → 余量`, `台账 ${b.room} vs 数据源 ${row.marginPP}`);
      add(Math.abs(b.cagr - row.ann252Pct) < 1e-9, 'LEDGER', `台账 R=${row.R_pct}% → 年化`, `台账 ${b.cagr} vs 数据源 ${row.ann252Pct}`);
    });
  }

  // ---- 关卡状态：谁说「纸面执行开始了没有」 ----
  // HTML 报告写「未开始」，README 与策略文档写「进行中」——数字全对、状态相反，
  // 读者没法判断这份报告是不是已经过期。这与本文件开头那个问题同源：
  // 同一件事写两遍，任何一次状态变化都只改得到一半。
  // 状态只有一个来源：gate3_state.json。文档只能转述，不能各自记忆。
  let g3 = null;
  try { g3 = JSON.parse(fs.readFileSync(P('gate3_state.json'), 'utf8')); } catch (e) { g3 = null; }
  const g3Started = !!(g3 && g3.cfg && g3.cfg.start && Array.isArray(g3.rows) && g3.rows.length > 0);
  add(!!g3, 'STATE', '第三关状态文件可读（gate3_state.json）',
    g3Started ? '已启动，起始 ' + g3.cfg.start + '，观测 ' + g3.rows.length + ' 条' : '缺失或未启动');
  if (g3Started) {
    const stale = /纸面执行[^。；\n]{0,14}(未开始|尚未开始)/;
    Object.keys(DOCS).forEach(docKey => {
      const bad = (docs[docKey] || '').split('\n')
        .filter(ln => stale.test(ln) && !DISCLOSURE_MARKERS.some(m => ln.includes(m)));
      add(bad.length === 0, 'STATE', `[${docKey}] 已有记录，不得再写「纸面执行未开始」`,
        bad.length ? '→ ' + bad[0].trim().slice(0, 80) : '');
    });
    // 反向：不能因为删掉旧句子就算对齐，正向叙述必须出现
    add((docs.readme || '').includes('进行中'), 'STATE', '[readme] 关卡表标注「进行中」', '');
    add((docs.md || '').includes('进行中'), 'STATE', '[md] 正文标注「进行中」', '');
  }

  return r;
}

function summarize(list, title, quiet) {
  const fails = list.filter(x => !x.ok);
  const modes = {};
  list.forEach(x => { modes[x.cat] = modes[x.cat] || [0, 0]; modes[x.cat][1]++; if (x.ok) modes[x.cat][0]++; });
  if (title) console.log(title);
  Object.keys(modes).forEach(c => {
    const [p, t] = modes[c];
    console.log((p === t ? '  ✓ ' : '  ✗ ') + c.padEnd(9) + p + '/' + t);
  });
  if (!quiet && fails.length) {
    console.log('');
    fails.forEach(x => console.log('  ✗ ' + x.label + (x.detail ? '\n      ' + x.detail : '')));
  }
  return fails;
}

// ---------------------------------------------------------------------------
// 负向自测
// ---------------------------------------------------------------------------
if (process.argv.includes('--negative')) {
  console.log('=== 负向自测（复用同一份检查逻辑）===');
  const base = sourceResults().concat(buildResults(REAL));
  const baseFails = summarize(base, '① 原样校验', true);
  console.log('   → ' + (baseFails.length === 0 ? 'PASS（0 失败）' : `FAIL（${baseFails.length} 失败：现状本身就不一致）`));

  const mutate = (fn) => {
    const copy = Object.assign({}, REAL);
    fn(copy);
    const fails = buildResults(copy).filter(x => !x.ok);
    return fails;
  };
  const show = (label, fails) =>
    console.log(label + ' → ' + (fails.length ? `抓到（${fails[0].cat} ${fails[0].label}）` : '漏了！'));

  // 用 replaceAll 语义，避免「只换掉第一处、其余仍在，于是检查仍通过」的假阴性
  const repAll = (s, a, b) => s.split(a).join(b);

  const t1 = mutate(c => { c.html = repAll(c.html, '17.234%', '17.234'); });
  show('② HTML 删掉全部 17.234% 的百分号', t1);

  const t2 = mutate(c => { c.html = c.html.replace('</body>', '<p>余量为口径极差的 2.13 倍</p></body>'); });
  show('③ HTML 重新写入旧倍数「2.13 倍」', t2);

  const t3 = mutate(c => { c.md = repAll(c.md, '2.766pp', '2.766 pp'); });
  show('④ MD 把 2.766pp 改成 2.766 pp', t3);

  const t4 = mutate(c => { c.readme = repAll(c.readme, '17.234%', '17.234 %'); });
  show('⑤ README 把 17.234% 改成 17.234 %', t4);

  const t5 = mutate(c => { c.html = repAll(c.html, '2.692', '2.691'); });
  show('⑥ HTML 把全网格极差 2.692 改成 2.691', t5);

  const t6 = mutate(c => { c.html = repAll(c.html, '</body>', '<p>12 周纸面执行（未开始）。</p></body>'); });
  show('⑦ HTML 把已启动的纸面执行写回「未开始」', t6);

  const caught = [t1, t2, t3, t4, t5, t6].every(x => x.length > 0);
  console.log('');
  if (caught && baseFails.length === 0) {
    console.log('✓ 负向自测通过：6 种改坏方式全部被抓到，且原样校验 0 失败');
    process.exit(0);
  }
  console.log('✗ 负向自测失败');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 正常模式
// ---------------------------------------------------------------------------
console.log('=== 报告一致性测试（数据源：metrics_v16.json）===');
const fails = summarize(sourceResults().concat(buildResults(REAL)), '');
console.log('');
if (fails.length) {
  console.log(`✗ ${fails.length} 项不一致 — Markdown / HTML / README 与数据源已偏离`);
  process.exit(1);
}
console.log('✓ 全部一致：三份文档与 metrics_v16.json 逐位相符，且无已撤销措辞');
