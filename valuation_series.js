// 估值/股息率序列模块（2026-11-07）
// 数据源：NeoData index_valuation，半年度采样（34 个时点），线性插值到交易日。
// 产出：真实逐年股息率序列、四维估值分（doc 含前视 / exp 无前视）、分位明细。
// 这是 v1.2 第三关「估值数据可得性」的落地实现；市场广度 B 无历史序列，本模块不提供。
const fs = require('fs');

const RAW = JSON.parse(fs.readFileSync('valuation_semiannual_2010_2026.json', 'utf8'));
const PXDATES = JSON.parse(fs.readFileSync('hs300_daily_2010_2026.json', 'utf8')).data.klines
  .map(s => s.split(',')[0]);          // 'YYYY-MM-DD'
const N = PXDATES.length;
const iso = d => d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8);

// 把每个观测日映射到最后一个 <= 它的交易日索引
const obs = RAW.rows.map(([d, hs, hl]) => {
  const dt = iso(d);
  let idx = -1;
  for (let i = 0; i < N; i++) { if (PXDATES[i] <= dt) idx = i; else break; }
  return { d: dt, idx, hs, hl };
}).filter(o => o.idx >= 0);

// 线性插值（观测区间外取端点值）
function interp(col, asset) {
  const out = new Array(N);
  let k = 0;
  for (let i = 0; i < N; i++) {
    while (k < obs.length - 2 && obs[k + 1].idx <= i) k++;
    const a = obs[k], b = obs[Math.min(k + 1, obs.length - 1)];
    const t = b.idx > a.idx ? Math.max(0, Math.min(1, (i - a.idx) / (b.idx - a.idx))) : 0;
    out[i] = a[asset][col] + (b[asset][col] - a[asset][col]) * t;
  }
  return out;
}

const C = { PE: 0, PB: 1, DY: 2, ERP: 3, ERPDIV: 4 };
const series = (col, asset) => interp(col, asset);

// 股息率：百分数 -> 小数
const dyHS = series(C.DY, 'hs').map(x => x / 100);
const dyHL = series(C.DY, 'hl').map(x => x / 100);
const peHS = series(C.PE, 'hs'), pbHS = series(C.PB, 'hs');
const erpHS = series(C.ERP, 'hs'), erpDivHS = series(C.ERPDIV, 'hs');

// 四维估值分：① PE 分位<=50 ② PB 分位<=50 ③ ERP 分位>=50 ④ 股息溢价>0
// doc = 全样本分位（v1.2 固定窗口，含前视）；exp = 仅用截至当日已发生的观测（无前视）
function pctRank(v, arr) {
  if (!arr.length) return 0.5;
  return arr.filter(x => x <= v).length / arr.length;
}
function buildScores(mode) {
  const out = new Array(N), detail = new Array(N);
  for (let i = 0; i < N; i++) {
    const hist = mode === 'doc' ? obs : obs.filter(o => o.idx <= i);
    const peArr = hist.map(o => o.hs[C.PE]), pbArr = hist.map(o => o.hs[C.PB]),
      erpArr = hist.map(o => o.hs[C.ERP]);
    const qPE = pctRank(peHS[i], peArr), qPB = pctRank(pbHS[i], pbArr), qERP = pctRank(erpHS[i], erpArr);
    const s = (qPE <= 0.5 ? 1 : 0) + (qPB <= 0.5 ? 1 : 0) + (qERP >= 0.5 ? 1 : 0) + (erpDivHS[i] > 0 ? 1 : 0);
    out[i] = s;
    detail[i] = { qPE, qPB, qERP, erpDiv: erpDivHS[i], s };
  }
  return { out, detail };
}
const doc = buildScores('doc'), exp = buildScores('exp');

// 逐年平均股息率
const byYear = {};
for (let i = 0; i < N; i++) {
  const y = PXDATES[i].slice(0, 4);
  (byYear[y] ||= { hs: 0, hl: 0, n: 0 });
  byYear[y].hs += dyHS[i]; byYear[y].hl += dyHL[i]; byYear[y].n++;
}
const annual = Object.keys(byYear).sort().map(y => ({
  y, hs: +(byYear[y].hs / byYear[y].n * 100).toFixed(2), hl: +(byYear[y].hl / byYear[y].n * 100).toFixed(2)
}));

const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
const stats = {
  hs: { min: +(Math.min(...dyHS) * 100).toFixed(2), max: +(Math.max(...dyHS) * 100).toFixed(2), avg: +(avg(dyHS) * 100).toFixed(2) },
  hl: { min: +(Math.min(...dyHL) * 100).toFixed(2), max: +(Math.max(...dyHL) * 100).toFixed(2), avg: +(avg(dyHL) * 100).toFixed(2) }
};

module.exports = {
  N, PXDATES, obs, dyHS, dyHL, peHS, pbHS, erpHS, erpDivHS,
  vDoc: doc.out, vExp: exp.out, detailDoc: doc.detail, detailExp: exp.detail,
  annual, stats, RAW
};

if (require.main === module) {
  console.log('观测点', obs.length, '交易日', N, '区间', PXDATES[0], '~', PXDATES[N - 1]);
  console.log('真实股息率(%, min/avg/max): HS300', stats.hs, '中证红利', stats.hl);
  console.log('年度均值:'); console.table(annual);
  const hist = a => { const o = {}; a.forEach(x => o[x] = (o[x] || 0) + 1); return o; };
  console.log('估值分分布 doc(含前视)', JSON.stringify(hist(doc.out)));
  console.log('估值分分布 exp(无前视)', JSON.stringify(hist(exp.out)));
  const latest = N - 1;
  console.log('最新', PXDATES[latest], 'PE', peHS[latest].toFixed(2), 'PB', pbHS[latest].toFixed(2),
    '股息率HS', (dyHS[latest] * 100).toFixed(2) + '%', '红利', (dyHL[latest] * 100).toFixed(2) + '%',
    'ERP', erpHS[latest].toFixed(2), '估值分doc', doc.out[latest], 'exp', exp.out[latest]);
  console.log('最新分位 doc', JSON.stringify(doc.detail[latest]));
}
