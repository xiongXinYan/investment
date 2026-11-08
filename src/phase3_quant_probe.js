// ============================================================================
// Phase 3 · 量化分析师 梁定衡 · 触发事件结构诊断探针
// 目的：为「休眠条款统计功效 / block bootstrap 适用性 / 样本切分」提供可复现的结构量。
// 纪律：只输出 dd 路径的事件结构与解析量，【不产出任何策略绩效】
//       （年化/波动/夏普/MDD改善/胜率/换手均不计算、不输出）。
// 口径：mix 逐行复用 bt_final.js:36-86；参数取 phase2_indices.js 的 P_MAIN_OPT。
// 复现：node phase3_quant_probe.js   （工作目录 E:/Desktop/investment）
// ============================================================================
const fs = require('fs');
const B = require('./phase2_indices.js');
const V = B.V;
const A = B.A, D = B.D, N = B.N, DATES = B.DATES;
const FEE_ANN = 0.005;
const P3 = x => +(x * 100).toFixed(3);
const P2 = x => +(x * 100).toFixed(2);

// ---- mix：与 bt_final.js:36-86 逐行一致（仅去掉绩效/计数，行为不变） ----
function mix(opt = {}) {
  const o = Object.assign({
    eq: 0.40, w: 0.25, rebal: 'reset', interval: 63,
    cashRate: B.SEG_RATE, dyH: V.dyHS, dyD: V.dyHL,
    tradeFee: 0.0005, slippage: 0.001, divTax: 0, execLag: 1, S: 0, E: N - 1
  }, opt);
  const S = o.S, E = o.E;
  const rateAt = i => typeof o.cashRate === 'number' ? o.cashRate : o.cashRate[i];
  const dyHAt = i => typeof o.dyH === 'number' ? o.dyH : o.dyH[i];
  const dyDAt = i => typeof o.dyD === 'number' ? o.dyD : o.dyD[i];
  let uD = o.eq * o.w / D[S].c, uH = o.eq * (1 - o.w) / A[S].c, cash = 1 - o.eq;
  const nav = [];
  let pending = false;
  for (let i = S; i <= E; i++) {
    let vD = uD * D[i].c, vH = uH * A[i].c, e2 = vD + vH;
    const divCash = (vD * dyDAt(i) + vH * dyHAt(i)) / 252;
    const tax = divCash * o.divTax;
    cash += divCash - tax - e2 * FEE_ANN / 252;
    cash *= 1 + rateAt(i) / 252;
    const doRebal = (idx) => {
      const t = e2 + cash, want = t * o.eq;
      const nvD = want * o.w, nvH = want * (1 - o.w);
      const traded = Math.abs(nvD - vD) + Math.abs(nvH - vH);
      const cost = traded * (o.tradeFee + o.slippage);
      cash = t - want - cost;
      uD = nvD / D[idx].c; uH = nvH / A[idx].c;
      vD = nvD; vH = nvH; e2 = vD + vH;
    };
    if (pending) { doRebal(i); pending = false; }
    if (i > S && (i - S) % o.interval === 0) { if (o.execLag === 0) doRebal(i); else pending = true; }
    nav.push(uD * D[i].c + uH * A[i].c + cash);
  }
  return { nav };
}

// ---- dd 序列：相对历史净资产高水位 V（份额法，V 不因操作重置） ----
function ddOf(nav) {
  let pk = nav[0]; const dd = [];
  for (let i = 0; i < nav.length; i++) { if (nav[i] > pk) pk = nav[i]; dd.push(1 - nav[i] / pk); }
  return dd;
}
// ---- 连续段聚类：把间隔 < gap 个交易日的触发段合并为「同一独立事件」 ----
function clusters(dd, R, gap = 0) {
  const raw = []; let cur = null;
  for (let i = 0; i < dd.length; i++) {
    if (dd[i] >= R) {
      if (!cur) cur = { s: i, e: i, peak: dd[i], peakIdx: i };
      else { cur.e = i; if (dd[i] > cur.peak) { cur.peak = dd[i]; cur.peakIdx = i; } }
    } else if (cur) { raw.push(cur); cur = null; }
  }
  if (cur) raw.push(cur);
  if (gap <= 0) return raw;
  const merged = [];
  for (const s of raw) {
    const last = merged[merged.length - 1];
    if (last && s.s - last.e <= gap) {
      last.e = s.e;
      if (s.peak > last.peak) { last.peak = s.peak; last.peakIdx = s.peakIdx; }
    } else merged.push({ ...s });
  }
  return merged;
}
// ---- 水下段：dd>0（nav < V）的连续区间 ----
function underwater(dd, eps = 1e-9) {
  const segs = []; let cur = null;
  for (let i = 0; i < dd.length; i++) {
    if (dd[i] > eps) {
      if (!cur) cur = { s: i, e: i, peak: dd[i], peakIdx: i };
      else { cur.e = i; if (dd[i] > cur.peak) { cur.peak = dd[i]; cur.peakIdx = i; } }
    } else if (cur) { segs.push(cur); cur = null; }
  }
  if (cur) segs.push(cur);
  return segs;
}

const OPT = Object.assign({}, B.P_MAIN_OPT, { eq: 0.40 });
if (V.dyHS.length !== N || V.dyHL.length !== N) throw new Error('估值插值序列长度 != N');
const { nav } = mix(OPT);
const dd = ddOf(nav);
const mdd = Math.max(...dd);
const mddIdx = dd.indexOf(mdd);

const out = {
  meta: {
    note: '事后 dd 路径结构诊断（固定 E 的 nav，非状态机、非绩效）',
    sample: [DATES[0], DATES[N - 1]], N, returns: N - 1,
    opt: 'B.P_MAIN_OPT（75/25 + 分段利率 + 费5bp + 滑点10bp + T+1 + reset/63 + 股息计入）',
    eq: 0.40, ddBasis: '历史净资产高水位 V（份额法，不重置）',
    source: 'hs300_daily_2010_2026.json / csi_dividend_2010_2026.json / valuation_series.js',
    computed: '2026-11-07（本地 Node v22.22.2）'
  },
  alignCheck: {
    mddPct: P3(mdd), mddDate: DATES[mddIdx], mddIdx,
    phase2MainMddPct: 19.691,
    aligned: Math.abs(P3(mdd) - 19.691) < 0.002
  },
  // 触发阈值事件结构
  thresholdEvents: [0.10, 0.12, 0.15, 0.18, 0.19691, 0.20].map(R => {
    const c0 = clusters(dd, R, 0);
    const c20 = clusters(dd, R, 20);
    const c63 = clusters(dd, R, 63);
    const hitDays = dd.filter(x => x >= R).length;
    return {
      R: P2(R), hitDays,
      rawSegments: c0.length,
      independentEvents_gap20: c20.length,
      independentEvents_gap63: c63.length,
      segments: c20.map(s => ({
        from: DATES[s.s], to: DATES[s.e], fromIdx: s.s, toIdx: s.e,
        lenDays: s.e - s.s + 1, peakDdPct: P3(s.peak), peakDate: DATES[s.peakIdx]
      }))
    };
  }),
  // 水下时间（dd>0）结构
  underwater: (() => {
    const segs = underwater(dd);
    const total = dd.filter(x => x > 1e-9).length;
    const longest = segs.reduce((a, b) => (b.e - b.s) > (a.e - a.s) ? b : a, segs[0]);
    return {
      underwaterDays: total, underwaterSharePct: P2(total / N),
      nSegments: segs.length,
      longest: { from: DATES[longest.s], to: DATES[longest.e], lenDays: longest.e - longest.s + 1, peakDdPct: P3(longest.peak) },
      top5: segs.sort((a, b) => (b.e - b.s) - (a.e - a.s)).slice(0, 5).map(s => ({
        from: DATES[s.s], to: DATES[s.e], lenDays: s.e - s.s + 1, peakDdPct: P3(s.peak)
      }))
    };
  })(),
  // 4 折等分 walk-forward：触发事件落在哪一折
  walkForward4Fold: (() => {
    const f = Math.ceil(N / 4);
    const anchors = [
      { label: 'R10首次触发', idx: 116 }, { label: 'R12首次触发', idx: 474 },
      { label: 'R15首次触发', idx: 1369 }, { label: 'R18首次触发', idx: 1370 },
      { label: 'calQ口径R20首次触发', idx: 1472 }, { label: '主口径全期MDD日', idx: 1474 }
    ];
    const folds = [];
    for (let k = 0; k < 4; k++) {
      const s = k * f, e = Math.min(N - 1, (k + 1) * f - 1);
      const sub = dd.slice(s, e + 1);
      folds.push({
        fold: k + 1, fromIdx: s, toIdx: e, from: DATES[s], to: DATES[e], days: e - s + 1,
        maxDdPct: P3(Math.max(...sub)),
        daysDdGe15: sub.filter(x => x >= 0.15).length,
        daysDdGe1969: sub.filter(x => x >= 0.19691).length,
        anchorsInside: anchors.filter(a => a.idx >= s && a.idx <= e).map(a => a.label + '@' + DATES[a.idx])
      });
    }
    return { foldSize: f, folds, anchorFoldMap: anchors.map(a => ({ label: a.label, date: DATES[a.idx], fold: Math.floor(a.idx / f) + 1 })) };
  })(),
  // 63 交易日「独立机会窗口」计数（供 rule of three 的分母参照）
  opportunityWindows63: (() => {
    const w = [];
    for (let s = 0; s < N; s += 63) {
      const e = Math.min(N - 1, s + 62);
      w.push({ from: DATES[s], to: DATES[e], maxDdPct: P3(Math.max(...dd.slice(s, e + 1))) });
    }
    return {
      nWindows: w.length,
      windowsWithDdGe15: w.filter(x => x.maxDdPct >= 15).length,
      windowsWithDdGe18: w.filter(x => x.maxDdPct >= 18).length,
      windowsWithDdGe1969: w.filter(x => x.maxDdPct >= 19.691).length,
      windowsWithDdGe20: w.filter(x => x.maxDdPct >= 20).length
    };
  })()
};

// ---- 解析量（非回测、非功效点估计，仅供文字引用的量级） ----
const nEff = out.thresholdEvents.find(x => x.R === 20).independentEvents_gap20;
out.analytic = {
  note: '解析推导，非回测绩效、非功效点估计；nEff 取「R=20% 的独立触发事件数」',
  cutOnceMaxEvents: 1,
  mainFourRHitCount: 0,
  nEffAtR20: nEff,
  ruleOfThree_upper95_on_nEff: nEff > 0 ? P2(3 / nEff) : null,
  ruleOfThree_note: nEff === 0
    ? '主口径 R=20% 触发 0 次 → 在 n 个独立机会中观察到 0 次事件时，p 的 95% 上界≈3/n；但此处 n 为「口径已把触发结构性排除」的循环论证结果，不能用此式反推市场概率。'
    : '见 note',
  binomialCompatibility: '若单次独立机会真实触发概率 p=0.5，观察到 0 次触发的概率 = 0.5；n=1 时「0 次触发」与 p 从 0.05 到 0.95 几乎全部相容。',
  sampleVarianceNote: 'cutOnce=true 时全期处理事件数 ≤1；样本方差需 n≥2 才可估计 → 净效应的标准差/置信区间/t 检验在数学上不可计算（不是「区间很宽」，是「不存在」）。'
};

console.log(JSON.stringify(out, null, 1));
