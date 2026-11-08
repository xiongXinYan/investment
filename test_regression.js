// ============================================================================
// 回测回归测试 v1（2026-11-08）
//
// 解决什么问题：这个仓库出过「引擎没同步策略版本」「不同报告用不同口径」的事故，
// 每次都要人工复查一遍。本脚本把已发布的关键净值序列锁进 regression_baseline.json，
// 任何代码改动跑一次就知道有没有动到历史数字。
//
// 用法：
//   node test_regression.js            # 校验（不一致即 exit 1）
//   node test_regression.js --update   # 重新生成基线（仅在确认改动合理时使用）
//
// 锁定粒度：不只比期末值，比整条净值序列（每 63 个交易日一个采样点 + 全序列和）。
// 只比期末值会漏掉「中途路径变了但终点撞上」的情况，而 MDD 是路径泛函。
// ============================================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const P = f => path.join(__dirname, f);
const B = require('./phase2_indices.js');
const ENG = require('./bt_r_clause.js');

const BASELINE = P('regression_baseline.json');
const TOL_NAV = 1e-9;      // 净值绝对容差
const TOL_METRIC = 1e-6;   // 绩效指标准确到小数点后 6 位

const RC = (o = {}) => Object.assign({
  enabled: true, R: 0.20, eqBase: 0.40, cutRatio: 0.5, lockDays: 20,
  recoverMode: 'review', reviewLagDays: 20, ddBasis: 'highWaterV',
  cutOnce: true, quarterMode: 'q63'
}, o);
const OFF = (R = 0.20) => ({ enabled: false, R });

// ---------------------------------------------------------------------------
// 固定用例：覆盖「历史基线 / v1.6 推荐四档 / 三条主检验路径 / 口径变体」
// 每一项都必须能逐位复现，否则说明引擎或数据被动过。
// ---------------------------------------------------------------------------
const CASES = [
  { id: 'v0.R15.eq30', note: 'V0 对齐 R=15%/E=30%（v1.5 旧表）', cfg: { eq: 0.30, rc: OFF(0.15) } },
  { id: 'v0.R20.eq40', note: 'V0 对齐 R=20%/E=40%（v1.5 主口径）', cfg: { eq: 0.40, rc: OFF(0.20) } },
  { id: 'v0.R25.eq50', note: 'V0 对齐 R=25%/E=50%', cfg: { eq: 0.50, rc: OFF(0.25) } },
  { id: 'v0.R30.eq55', note: 'V0 对齐 R=30%/E=55%', cfg: { eq: 0.55, rc: OFF(0.30) } },
  { id: 'path.i.eq40', note: '路径 (i) 不减半', cfg: { eq: 0.40, rc: OFF(0.20) } },
  { id: 'path.ii.eq40', note: '路径 (ii) 减半+20日锁定+书面复核恢复', cfg: { eq: 0.40, rc: RC() } },
  { id: 'path.iii.eq40', note: '路径 (iii) 季度恢复', cfg: { eq: 0.40, rc: RC({ recoverMode: 'quarterly' }) } },
  { id: 'path.iv.eq20', note: '路径 (iv) 全期静态 eq=0.20', cfg: { eq: 0.20, rc: OFF(0.20) } },
  { id: 'v16.E25.R15', note: 'v1.6 推荐档 R=15%/E=25%', cfg: { eq: 0.25, rc: RC({ R: 0.15, eqBase: 0.25 }) } },
  { id: 'v16.E35.R20', note: 'v1.6 推荐档 R=20%/E=35%（主推荐）', cfg: { eq: 0.35, rc: RC({ eqBase: 0.35 }) } },
  { id: 'v16.E45.R25', note: 'v1.6 推荐档 R=25%/E=45%', cfg: { eq: 0.45, rc: RC({ R: 0.25, eqBase: 0.45 }) } },
  { id: 'v16.E55.R30', note: 'v1.6 推荐档 R=30%/E=55%', cfg: { eq: 0.55, rc: RC({ R: 0.30, eqBase: 0.55 }) } },
  { id: 'rebal.126', note: '口径变体：半年度再平衡', cfg: { eq: 0.35, rc: OFF(0.20), over: { interval: 126 } } },
  { id: 'rebal.252', note: '口径变体：年度再平衡', cfg: { eq: 0.35, rc: OFF(0.20), over: { interval: 252 } } },
  { id: 'equity.w0', note: '口径变体：100% 沪深300 纯权益', cfg: { eq: 1.0, rc: OFF(0.20), over: { w: 0 } } },
  { id: 'equity.w100', note: '口径变体：100% 中证红利 纯权益', cfg: { eq: 1.0, rc: OFF(0.20), over: { w: 1.0 } } },
  { id: 'div.nolookahead', note: '口径变体：股息率无前视（阶梯插值）', cfg: { eq: 0.35, rc: RC({ eqBase: 0.35 }), over: { dyH: B.V.dyHS_nl, dyD: B.V.dyHL_nl } } }
];

// ---------------------------------------------------------------------------
// 绩效：与 phase5_run.js 的 met() 完全一致，额外给出日历年化（审计 9）
// ---------------------------------------------------------------------------
const calYears = (new Date(B.DATES[B.N - 1]) - new Date(B.DATES[0])) / 31557600000;
function metrics(nav) {
  const L = nav.length;
  const tot = nav[L - 1] / nav[0] - 1;
  let pk = nav[0], mdd = 0;
  for (const v of nav) { if (v > pk) pk = v; const d = 1 - v / pk; if (d > mdd) mdd = d; }
  return {
    total: +(tot * 100).toFixed(6),
    mdd: +(mdd * 100).toFixed(6),
    cagr252: +((Math.pow(1 + tot, 252 / L) - 1) * 100).toFixed(6),   // 历史口径
    cagrCal: +((Math.pow(1 + tot, 1 / calYears) - 1) * 100).toFixed(6) // 日历年化
  };
}

const sample = nav => {
  const out = [];
  for (let i = 0; i < nav.length; i += 63) out.push(+nav[i].toFixed(10));
  out.push(+nav[nav.length - 1].toFixed(10));
  return out;
};
const digest = arr => crypto.createHash('sha1').update(arr.map(x => x.toFixed(9)).join(',')).digest('hex').slice(0, 16);

function runAll() {
  return CASES.map(c => {
    const opt = Object.assign({}, B.P_MAIN_OPT, c.cfg.over || {}, { eq: c.cfg.eq, rClause: c.cfg.rc });
    const out = ENG.runRClause(opt);
    const m = metrics(out.nav);
    return {
      id: c.id, note: c.note, navLen: out.nav.length,
      total: m.total, mdd: m.mdd, cagr252: m.cagr252, cagrCal: m.cagrCal,
      navSum: +out.nav.reduce((a, b) => a + b, 0).toFixed(9),
      sample: sample(out.nav), sampleDigest: digest(sample(out.nav)),
      counters: {
        rebalCount: out.counters.rebalCount, cutCount: out.counters.cutCount,
        recoverCount: out.counters.recoverCount,
        turnover: +out.counters.turnover.toFixed(8), feePaid: +out.counters.feePaid.toFixed(8)
      }
    };
  });
}

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------
function compare(base, now) {
  const fails = [], warns = [];
  for (let i = 0; i < now.length; i++) {
    const b = base.items.find(x => x.id === now[i].id);
    const n = now[i];
    if (!b) { fails.push({ id: n.id, why: '基线中无此用例（新增用例需 --update）' }); continue; }
    if (b.navLen !== n.navLen) { fails.push({ id: n.id, why: '净值长度 ' + b.navLen + ' → ' + n.navLen }); continue; }
    if (b.sample.length !== n.sample.length) { fails.push({ id: n.id, why: '采样点数不一致' }); continue; }
    let maxAbs = 0, at = -1;
    for (let k = 0; k < n.sample.length; k++) {
      const d = Math.abs(n.sample[k] - b.sample[k]);
      if (d > maxAbs) { maxAbs = d; at = k; }
    }
    if (maxAbs > TOL_NAV) {
      fails.push({ id: n.id, why: '净值序列偏离 ' + maxAbs.toExponential(3) + '（第 ' + at + ' 个采样点），超过容差 ' + TOL_NAV });
    }
    for (const key of ['mdd', 'cagr252', 'cagrCal', 'total']) {
      if (Math.abs(b[key] - n[key]) > TOL_METRIC) {
        fails.push({ id: n.id, why: key + ' ' + b[key] + ' → ' + n[key] });
      }
    }
    if (b.counters.rebalCount !== n.counters.rebalCount)
      fails.push({ id: n.id, why: '再平衡次数 ' + b.counters.rebalCount + ' → ' + n.counters.rebalCount });
    if (b.counters.cutCount !== n.counters.cutCount)
      warns.push({ id: n.id, why: '减半次数 ' + b.counters.cutCount + ' → ' + n.counters.cutCount });
  }
  return { fails, warns };
}

if (require.main === module) {
  const update = process.argv.includes('--update');
  const now = runAll();

  if (update || !fs.existsSync(BASELINE)) {
    const manifest = fs.existsSync(P('data_manifest.json')) ? JSON.parse(fs.readFileSync(P('data_manifest.json'), 'utf8')) : null;
    const base = {
      note: '回测回归基线。修改引擎/数据后必须先跑 node test_regression.js；改动导致基线变化时，只有在确认新结果正确后才允许 --update。',
      generatedAt: new Date().toISOString(),
      dataManifest: manifest ? manifest.files : null,
      tolerance: { nav: TOL_NAV, metric: TOL_METRIC },
      sampleStride: 63,
      metricsNote: 'cagr252 = nav.length/252 年化（历史口径，全部已发布报告使用）；cagrCal = 日历年化（审计建议的正式口径）',
      items: now
    };
    fs.writeFileSync(BASELINE, JSON.stringify(base, null, 1), 'utf8');
    console.log('已写入 regression_baseline.json，锁定 ' + now.length + ' 个用例');
    console.log('数据快照 sha256:');
    Object.values(manifest ? manifest.files : {}).forEach(f =>
      console.log('  ' + String(f.file).padEnd(42) + String(f.sha256).slice(0, 16) + '…'));
  } else {
    const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
    const { fails, warns } = compare(base, now);
    console.log('=== 回归测试 ===');
    console.log('基线生成于 ' + base.generatedAt + '，共 ' + base.items.length + ' 个用例');
    console.log('');
    if (fails.length === 0) {
      console.log('[PASS] ' + now.length + ' 个用例全部通过');
      console.log('  净值容差 ' + TOL_NAV + '，绩效容差 ' + TOL_METRIC);
      const worst = now.map(n => {
        const b = base.items.find(x => x.id === n.id);
        let m = 0; for (let k = 0; k < n.sample.length; k++) m = Math.max(m, Math.abs(n.sample[k] - b.sample[k]));
        return { id: n.id, d: m };
      }).sort((a, b) => b.d - a.d);
      console.log('  最大偏离：' + worst[0].id + ' = ' + worst[0].d.toExponential(2));
    } else {
      console.log('[FAIL] ' + fails.length + ' 项不一致');
      fails.forEach(f => console.log('  ✗ ' + f.id.padEnd(18) + f.why));
      console.log('');
      console.log('排查顺序：① node data_audit.js 看数据是否被替换（比 sha256）');
      console.log('          ② git diff 看引擎最近改了什么');
      console.log('          ③ 确认改动正确后 node test_regression.js --update');
      process.exit(1);
    }
    if (warns.length) { console.log(''); warns.forEach(w => console.log('  [warn] ' + w.id + ' ' + w.why)); }

    // 数据快照一致性
    if (base.dataManifest && fs.existsSync(P('data_manifest.json'))) {
      const cur = JSON.parse(fs.readFileSync(P('data_manifest.json'), 'utf8')).files;
      const changed = Object.keys(cur).filter(k => !base.dataManifest[k] || base.dataManifest[k].sha256 !== cur[k].sha256);
      console.log('');
      console.log(changed.length === 0 ? '[PASS] 数据快照未变（3 份输入文件 sha256 一致）'
        : '[FAIL] 数据文件已变：' + changed.join(', ') + '。净值基线可能不再适用。');
      if (changed.length) process.exit(1);
    }
  }
}

module.exports = { CASES, runAll, metrics, compare };
