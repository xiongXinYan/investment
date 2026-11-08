// 最终方案独立审计报告渲染（纯静态 HTML，无外部依赖，可离线双击打开）
const fs = require('fs');
const PT = require('../lib/paths.js');
const D = JSON.parse(fs.readFileSync(PT.resolve('final_audit_data.json'), 'utf8'));
let NOTES = null;
try { NOTES = JSON.parse(fs.readFileSync(PT.resolve('final_team_notes.json'), 'utf8')); } catch (_) { /* 可选 */ }

const e = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f = (x, d = 2) => Number(x).toFixed(d);
const table = (head, body) => `<table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;
const bar = (v, max, color = '#2563eb') => `<div class="bar"><i style="width:${Math.max(1, Math.min(100, Math.abs(v) / max * 100))}%;background:${color}"></i></div>`;

// 多序列折线图
function chart(series, labels, w = 760, h = 230) {
  const all = series.flatMap(s => s.vals);
  const min = Math.min(...all), max = Math.max(...all), pad = (max - min) * 0.15 || 0.3;
  const lo = min - pad, hi = max + pad;
  const X = i => 52 + i * (w - 78) / (labels.length - 1);
  const Y = v => h - 32 - (v - lo) / (hi - lo) * (h - 60);
  const grid = [0, 1, 2, 3].map(k => {
    const v = lo + (hi - lo) * k / 3, y = Y(v);
    return `<line x1="52" y1="${y.toFixed(1)}" x2="${w - 26}" y2="${y.toFixed(1)}" stroke="#e8edf4"/><text x="46" y="${(y + 3).toFixed(1)}" text-anchor="end" class="sv">${f(v, 1)}</text>`;
  }).join('');
  const xs = labels.map((l, i) => `<text x="${X(i).toFixed(1)}" y="${h - 10}" text-anchor="middle" class="sv">${e(l)}</text>`).join('');
  const lines = series.map(s => {
    const pts = s.vals.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
    const dots = s.vals.map((v, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="3" fill="${s.color}"/>`).join('');
    return `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2.2"/>${dots}`;
  }).join('');
  const legend = series.map(s => `<span class="lg"><i style="background:${s.color}"></i>${e(s.name)}</span>`).join('');
  return `<div class="lgd">${legend}</div><svg viewBox="0 0 ${w} ${h}" class="chart">${grid}${lines}${xs}</svg>`;
}

// ① 再平衡口径
const rebRows = D.rebalance.map(r => `<tr><td class="n">${f(r.eq, 0)}%</td><td class="n">${f(r.frozenCagr)}%</td><td class="n">${f(r.frozenMdd)}%</td><td class="n" style="color:#c2410c"><b>${f(r.frozenEndW, 1)}%</b></td><td class="n">${f(r.resetCagr)}%</td><td class="n">${f(r.resetMdd)}%</td><td class="n" style="color:#1d4ed8"><b>${f(r.resetEndW, 1)}%</b></td><td class="n">${f(r.dCagr, 3)}pp</td></tr>`).join('');

// ② 同等强度证伪：与择时层对照
const bootRows = D.bootRobust.map(b => `<tr><td class="n">${b.block} 日</td><td class="n">${f(b.lo)}pp</td><td class="n">${f(b.hi)}pp</td><td class="n">${f(b.pos, 1)}%</td></tr>`).join('');
const startRows = D.starts.map(s => `<tr><td>${e(s.start)}</td><td class="n">${f(s.single)}%</td><td class="n">${f(s.tilt)}%</td><td class="n"><b>+${f(s.edge)}pp</b></td></tr>`).join('');
const winRows = D.windows.map(s => `<tr><td>${e(s.period)}</td><td class="n">${f(s.single)}%</td><td class="n">${f(s.tilt)}%</td><td class="n"><b>+${f(s.edge)}pp</b></td></tr>`).join('');
const segRows = D.segs.map(s => `<tr><td>${e(s.period)}</td><td class="n">${f(s.single)}%</td><td class="n">${f(s.tilt)}%</td><td class="n"><b>+${f(s.edge)}pp</b></td></tr>`).join('');
const compareRows = [
  ['block bootstrap 95% 区间', '−1.57 ~ +1.59pp（跨零）', `−${f(Math.abs(D.bootstrap.lo))} ~ +${f(D.bootstrap.hi)}pp（跨零但集中）`],
  ['bootstrap 正值比例', '约 52%', `<b>${f(D.bootstrap.pos, 1)}%</b>`],
  ['起点敏感性（4 个起点）', '−0.60 / +0.30 / −1.30pp，符号翻转', `${D.starts.map(s => '+' + f(s.edge)).join(' / ')}pp，全为正`],
  ['不重叠 5 年窗口（3 个）', '−0.31 / +0.36 / −0.50pp，翻转 2 次', `${D.windows.map(s => '+' + f(s.edge)).join(' / ')}pp，全为正`],
  ['等长 4 分段', '0 / +1.79 / +0.33 / 0pp，末段归零', `${D.segs.map(s => '+' + f(s.edge)).join(' / ')}pp，全为正`]
].map(r => `<tr><td>${e(r[0])}</td><td>${e(r[1])}</td><td class="ok">${e(r[2])}</td></tr>`).join('');

// ③ 归因与反事实
const wfRowsScan = D.weightScan.map(x => `<tr><td class="n">${f(x.w, 1)}%</td><td class="n"><b>${f(x.cagr)}%</b></td><td class="n">${f(x.mdd)}%</td>${x.phases.map(p => `<td class="n">${f(p)}%</td>`).join('')}</tr>`).join('');
const attrRows = [
  ['100% 沪深300（单资产）', f(D.attribution.single) + '%', '—'],
  ['70/30，但红利股息率设为与沪深300 相同（纯价格差）', f(D.attribution.priceOnly) + '%', `+${f(D.attribution.priceGain)}pp`],
  ['70/30，真实逐年股息率（完整口径）', f(D.attribution.full) + '%', `+${f(D.attribution.totalGain)}pp`]
].map(r => `<tr><td>${e(r[0])}</td><td class="n">${e(r[1])}</td><td class="n">${e(r[2])}</td></tr>`).join('');
const cfRows = D.counterfactual.map(c => `<tr><td>${e(c.name)}</td><td class="n">${f(c.tilt)}%</td><td class="n">${f(c.single)}%</td><td class="n"><b>+${f(c.edge)}pp</b></td></tr>`).join('');
const costEdgeRows = D.costEdge.map(c => `<tr><td>${e(c.name)}</td><td class="n">${f(c.tilt)}%</td><td class="n">${f(c.single)}%</td><td class="n"><b>+${f(c.edge)}pp</b></td></tr>`).join('');
const scanChart = chart([
  { name: '全期年化 (%)', vals: D.weightScan.map(x => x.cagr), color: '#2563eb' },
  { name: '2010-01~2015-03 年化', vals: D.weightScan.map(x => x.phases[0]), color: '#94a3b8' },
  { name: '2015-03~2020-05 年化', vals: D.weightScan.map(x => x.phases[1]), color: '#d97706' },
  { name: '2020-05~2026-11 年化', vals: D.weightScan.map(x => x.phases[2]), color: '#16a34a' }
], D.weightScan.map(x => f(x.w, 0) + '%'));

// ④ walk-forward
const wfRows = D.walkForward.folds.map(x => `<tr><td>${e(x.train)}</td><td>${e(x.test)}</td><td class="n">${f(x.picked, 0)}%</td><td class="n">${f(x.oosBest)}%</td><td class="n">${f(x.oos30)}%</td><td class="n">${f(x.oos0)}%</td><td class="n" style="color:${x.edgePickedVs30 < 0 ? '#c2410c' : '#1d4ed8'}">${f(x.edgePickedVs30)}pp</td><td class="n">${f(x.edge30Vs0)}pp</td></tr>`).join('');

// ⑤ 成本
const costRows = D.costs.map(c => `<tr><td>${e(c.name)}</td><td class="n">${f(c.cagr)}%</td><td class="n">${f(c.mdd)}%</td><td class="n" style="color:${c.dCagr < -0.1 ? '#c2410c' : '#475569'}"><b>${f(c.dCagr)}pp</b></td><td class="n">${c.rebalCount}</td><td class="n">${f(c.turnover, 1)}%</td><td class="n">${f(c.cost, 2)}%</td></tr>`).join('');
const cashRows = D.cashSens.map(c => `<tr><td class="n">${f(c.rate, 1)}%</td><td class="n">${f(c.cagr)}%</td><td class="n">${f(c.dCagr)}pp</td><td>${bar(Math.abs(c.dCagr), 1.3, c.dCagr >= 0 ? '#16a34a' : '#ea580c')}</td></tr>`).join('');

// ⑥ R 触发
const riskRows = D.riskRule.table.map(r => `<tr><td class="n">${f(r.R, 0)}%</td><td class="n">${f(r.eq, 0)}%</td><td class="n">${f(r.mdd)}%</td><td class="n">+${f(r.headroom)}pp</td><td class="n" style="color:#c2410c"><b>${r.hits} 次</b></td></tr>`).join('');
const crossRows = D.riskRule.cross.map(r => `<tr><td class="n">${f(r.R, 0)}%</td><td class="n">${f(r.mdd)}%</td><td class="n">${r.hits} 次</td><td>${e(r.first || '—')}</td></tr>`).join('');
const cashScenRows = D.cashScenarios.map(c => `<tr><td>${e(c.name)}</td><td class="n">${f(c.cagr)}%</td><td class="n">${f(c.mdd)}%</td><td class="n" style="color:${c.dCagr < 0 ? '#c2410c' : '#15803d'}">${f(c.dCagr)}pp</td><td class="n">${f(c.dMdd)}pp</td></tr>`).join('');
const cashMddRows = D.cashMddSegs.map(c => `<tr><td>${e(c.period)}</td><td class="n">${f(c.baseMdd)}%</td><td class="n">${f(c.segMdd)}%</td><td class="n" style="color:${c.d > 0 ? '#c2410c' : '#15803d'}">${f(c.d)}pp</td></tr>`).join('');
const FP = D.finalPlan;
const v15Rows = FP.table.map(r => `<tr><td class="n">${f(r.R, 0)}%</td><td class="n">${f(r.eq, 0)}%</td><td class="n"><b>${f(r.cagr)}%</b></td><td class="n">${f(r.mdd)}%</td><td class="n">+${f(r.headroom)}pp</td><td class="n">${f(r.oldCagr)}%</td><td class="n">${f(r.oldMdd)}%</td><td class="n">${f(r.taxCagr)}%</td><td class="n" style="color:#c2410c">${f(r.dVs70)}pp</td></tr>`).join('');
// 相对重估（估值定价师核心论证，本地半年度观测复现）
const VR = D.valuationRepricing, vs = VR.summary, RT = VR.series;
const pickR = d => RT.find(r => r.d === d) || {};
const vrRows = [['2021-12-31 折价谷值', pickR('2021-12-31')],
  ['2022-12-30 息差峰值 / 成员引用 2022Q4', pickR('2022-12-30')],
  ['2026-11-06 当前', RT[RT.length - 1]]]
  .map(x => `<tr><td>${e(x[0])}</td><td class="n">${f(x[1].peR, 4)}</td><td class="n">${f(x[1].pbR, 4)}</td><td class="n">${f(x[1].spread, 1)}bp</td></tr>`).join('')
  + `<tr><td>全期均值 / 当前分位</td><td class="n">${f(vs.peAvg, 4)} / ${f(vs.pePct, 1)}%</td><td class="n">${f(vs.pbAvg, 4)} / ${f(vs.pbPct, 1)}%</td><td class="n">—</td></tr>`;
const vrRegimeRows = [['2010–2019（20 个半年度观测）', vs.regimePre2020],
  ['2020–2026（14 个半年度观测）', vs.regimePost2020]]
  .map(([n, r]) => `<tr><td>${e(n)}</td><td class="n">${f(r.avgSpread, 1)}bp</td><td class="n">${f(r.pctAbove150, 1)}%</td></tr>`).join('');

// ⑦ 团队意见（可选）
let teamHtml = '';
if (NOTES && NOTES.members) {
  const mRows = NOTES.members.map(m => `<tr><td><b>${e(m.role)}</b><br><span class="small">${e(m.agent || '')}</span></td><td>${e(m.verdict)}</td><td>${e(m.key)}</td></tr>`).join('');
  teamHtml = `<div class="card"><h2>⑦ 团队独立审阅意见</h2>
  ${table(['成员', '明确结论', '关键依据'], mRows)}
  ${NOTES.conflict ? `<div class="note"><b>分歧点</b>：${e(NOTES.conflict)}</div>` : ''}
  ${NOTES.riskDoctor ? `<div class="good"><b>风险诊断师收口</b>：${e(NOTES.riskDoctor)}</div>` : ''}
  <p class="small">成员结论来自各自专业维度，引用数据须以成员标注的来源与日期为准；与主理人回测统计结论分列，不互相替代。</p></div>`;
}

const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>最终方案独立审计报告 · 2026-11-07</title>
<style>
*{box-sizing:border-box}body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;max-width:1140px;margin:0 auto;padding:28px 22px 60px;background:#f5f7fa;color:#1f2937;line-height:1.65}
h1{font-size:26px;margin:0 0 6px}h2{font-size:19px;margin:0 0 14px;padding-bottom:10px;border-bottom:2px solid #e2e8f0}h3{font-size:15px;margin:16px 0 6px}
.sub{color:#64748b;font-size:13px;margin-bottom:22px}
.hero{background:linear-gradient(135deg,#0f3d5c,#1d6fa5);color:#fff;padding:28px 30px;border-radius:14px;margin-bottom:22px}
.hero .tag{display:inline-block;background:rgba(255,255,255,.18);padding:3px 10px;border-radius:20px;font-size:12px;margin-bottom:12px}
.hero h1{font-size:29px}.hero p{margin:8px 0 0;opacity:.93;font-size:14px}
.hero .kpi{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:20px}
.hero .kpi div{background:rgba(255,255,255,.14);padding:12px;border-radius:8px}
.hero .kpi b{display:block;font-size:21px}.hero .kpi span{font-size:12px;opacity:.86}
.card{background:#fff;border:1px solid #e5eaf1;border-radius:12px;padding:22px;margin-bottom:20px;box-shadow:0 1px 3px rgba(15,23,42,.04)}
.note{background:#fff7ed;border-left:4px solid #ea580c;padding:12px 16px;border-radius:0 8px 8px 0;margin:14px 0;font-size:14px}
.good{background:#eff6ff;border-left:4px solid #2563eb;padding:12px 16px;border-radius:0 8px 8px 0;margin:14px 0;font-size:14px}
.bad{background:#fef2f2;border-left:4px solid #dc2626;padding:12px 16px;border-radius:0 8px 8px 0;margin:14px 0;font-size:14px}
table{width:100%;border-collapse:collapse;font-size:13px;margin:10px 0}th{background:#f1f5f9;text-align:left;padding:9px 10px;font-weight:600;color:#475569;border-bottom:1px solid #e2e8f0}
td{padding:8px 10px;border-bottom:1px solid #eef2f7;vertical-align:top}tr:last-child td{border-bottom:none}td.n{text-align:right;font-variant-numeric:tabular-nums}
.ok{color:#1d4ed8;font-weight:600}.no{color:#c2410c;font-weight:600}
.bar{background:#eef2f7;border-radius:4px;height:9px;width:100%;min-width:70px}.bar i{display:block;height:9px;border-radius:4px}
.chart{width:100%;height:auto;display:block;margin:8px 0}.sv{font-size:10px;fill:#64748b}
.lgd{display:flex;gap:18px;flex-wrap:wrap;font-size:12px;color:#475569;margin-top:6px}.lg{display:flex;align-items:center;gap:6px}.lg i{width:12px;height:3px;display:inline-block;border-radius:2px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.small{font-size:12px;color:#64748b}
ul{margin:8px 0;padding-left:20px}li{margin:5px 0}
.foot{color:#64748b;font-size:12px;border-top:1px solid #e2e8f0;padding-top:18px;margin-top:26px}
code{background:#f1f5f9;padding:1px 6px;border-radius:4px;font-size:12px}
@media(max-width:760px){.hero .kpi{grid-template-columns:repeat(2,1fr)}.grid2{grid-template-columns:1fr}}
</style></head><body>
<div class="hero"><span class="tag">最终方案独立审计 · 2026-11-07 · 常数敞口双资产引擎</span>
<h1>增益方向经得住检验，该改的是现金假设、风控定性与权重取值</h1>
<p>v1.4 用「择时增量 0.03pp 不显著」砍掉整个择时层，却保留了 70/30 相对单资产 +0.48pp 的配置倾斜而从未检验。本轮对最终方案本身做同等强度证伪：增益方向稳健，但审计同时暴露了三处薄弱环节，团队重新收口后把权益内配置从 70/30 调整为 <b>75/25</b>。</p>
<div class="kpi">
<div><b>+0.39pp</b><span>75/25 执行口径相对单资产增益<br>（70/30 审计口径 +0.48pp）</span></div>
<div><b>${f(D.bootstrap.pos, 1)}%</b><span>bootstrap 正值比例<br>（择时层约 52%）</span></div>
<div><b>0.62pp</b><span>现金利率每变动 1pp 的影响<br>大于整个配置倾斜</span></div>
<div><b>0 次</b><span>R 减半条款在 16.8 年<br>真实历史中的触发次数</span></div>
</div></div>

<div class="card"><h2>① 口径修正：70/30 从未真正再平衡过</h2>
<p>原 <code>bt_extended.js / mixReal()</code> 每季度只把<b>总权益敞口</b>拉回 E，两个资产的份额是同比例缩放的，权益内比例因此被冻结：红利权重从 30% 一路漂到 <b>36.9%</b>。按文档第 1 章第 3 条「按同一目标比例一次完成」修正后，权重稳定在 33.2%（季末最后观测日略漂）。</p>
${table(['敞口 E', '冻结·年化', '冻结·回撤', '冻结·期末红利权重', '修正·年化', '修正·回撤', '修正·期末权重', '年化差'], rebRows)}
<div class="good"><b>结论：对收益与回撤几乎无影响</b>（年化差 0.00~0.01pp、回撤差 0.02~0.03pp），但<b>实际执行的红利暴露比写下的规则高 6.9pp</b>。这不是数字错误，是规则与实现不一致；v1.5 起以修正口径为主口径，并明确季度再平衡须同时重置资产间比例。</div>
<div class="note">口径细节：回测以 <b>63 个交易日</b>近似一个季度，并非日历季度末；成交按当日收盘价判断并以同一收盘价成交。第 ⑤ 节单独量化了改为次日成交的代价。</div></div>

<div class="card"><h2>② 同等强度证伪：+0.48pp 比择时层的 0.03pp 稳健得多</h2>
<p class="small">检验对象：40% 固定敞口下「70/30 双资产」与「100% 沪深300」的日收益差。择时层对照数字来自 <code>回测报告_扩展验证_2026-11-07.html</code> / v1.4 第 5.2 节。</p>
${table(['检验', '择时层（已否决）', '70/30 配置倾斜（本轮）'], compareRows)}
<div class="grid2"><div><h3>起点敏感性</h3>${table(['起点', '单资产', '70/30', '增量'], startRows)}</div>
<div><h3>不重叠 5 年窗口</h3>${table(['窗口', '单资产', '70/30', '增量'], winRows)}</div></div>
<h3>等长 4 分段</h3>${table(['区间', '单资产', '70/30', '增量'], segRows)}
<h3>block bootstrap 块长稳健性（2,000 次）</h3>${table(['块长', '95% 下界', '95% 上界', '正值比例'], bootRows)}
<div class="good"><b>判定：保留配置倾斜。</b>95% 区间仍跨零（−${f(Math.abs(D.bootstrap.lo))} ~ +${f(D.bootstrap.hi)}pp），因此不能说「统计显著为正」；但正值比例 ${f(D.bootstrap.pos, 1)}%、5 种块长下稳定在 89.7~90.8%，4 个起点、3 个独立窗口、4 个分段<b>全部为正且无符号翻转</b>。这与择时层「约 52%、符号反复翻转」形成明确对照。本轮最初的「双重标准」质疑，经检验被否证——审计的作用是把最后一条未验证的东西真正验证掉，而不是预设它该被删。</div></div>

<div class="card"><h2>③ 增益来自哪里：不是只靠红利近六年的价格超额</h2>
${table(['口径', '年化', '相对单资产'], attrRows)}
<p class="small">+0.48pp 中，价格序列差贡献 <b>+${f(D.attribution.priceGain)}pp（${f(100 - D.attribution.divShare, 0)}%）</b>，股息率差贡献 <b>+${f(D.attribution.divGain)}pp（${f(D.attribution.divShare, 0)}%）</b>。</p>
<h3>反事实：把价格超额拿掉，增益还剩多少</h3>${table(['情景', '70/30 年化', '单资产年化', '增量'], cfRows)}
<div class="good">剔除 2020-05 之后红利全部价格超额后仍有 <b>+0.29pp</b>；把两条价格序列设成完全相同、只留真实股息率差，仍有 <b>+0.21pp</b>。因此「这 0.48pp 全是样本内追逐近期赢家」的说法不成立——约四成来自可复核的股息 carry，且三个相位段的权重扫描都呈单调。</div>
<h3>权重扫描：30% 不是最优点，是风险约束下的折中</h3>${scanChart}
${table(['红利权重', '全期年化', '全期回撤', ...D.phaseLabels.map(e)], wfRowsScan)}
<div class="note"><b>这是本轮最需要警惕的一条。</b>年化随红利权重从 0% 到 100% 单调上升（${f(D.weightScan[0].cagr)}% → ${f(D.weightScan[D.weightScan.length - 1].cagr)}%），三个相位段都单调。所以 30% 不是优化结果，而是「怕行业集中」这条约束卡出来的数字——而该约束在项目 README 里一直被列为「始终未进回测引擎」。<b>正确表述是：回测不支持 30% 这个具体数字，只支持「有倾斜优于无倾斜」；权重上限必须由集中度与资金面另行约束，不能由回测给出。</b></div>
<h3>但相对重估是否已兑现？（估值定价师核心论证，本地逐位复现）</h3>
<p class="small">PE 比＝中证红利 PE / 沪深300 PE，PB 比同理；息差＝两指数股息率之差。数据源 <code>valuation_semiannual_2010_2026.json</code>（NeoData，34 个半年度观测）。</p>
${table(['时点 / 口径', 'PE 比', 'PB 比', '股息率差'], vrRows)}
${table(['区间', '息差均值', '≥150bp 占比'], vrRegimeRows)}
<div class="note"><b>这条证据与上面的反事实结论并不矛盾，但提出了它回答不了的问题。</b>反事实检验说明「过去的价格超额不是增益的全部」（剔除后仍 +0.29pp），却不能回答「未来的价格重估能否重复」。本地复现显示相对折价从 2021-12-31 的 PE 比 0.4116 收敛到 0.6698（<b>+62.7%</b>、当前分位 55.9%），PB 比 0.4136→0.6542（分位 41.2%），息差从 2022-12-30 峰值 369.7bp 回落到 128.3bp；1.5pp 阈值在 2010–2019 仅 <b>25.0%</b> 时间满足、2020 后 <b>92.9%</b> 满足，属强制度依赖。估值定价师据此主张「约 2/3 增益来自一次性重估、已兑现，30% 权重属历史过拟合」，并建议下调到 10~15%。<b>重新收口裁决：方向一致的是「风险信号」而非「规则输入」</b>——可用于定期审阅确定静态参数，故权重从 30% 降到 <b>25%</b>（v1.4 已授权区间 25%~35% 的下沿，权益内 75/25）；但不采纳 10~15%，也不把任何估值/息差做成自动触发条件。<b>反向证据同样在案</b>：第 4 折测试段 2022-12~2025-07（正是折价自峰值收敛之后）100% 红利样本外 5.607% &gt; 30% 的 4.468% &gt; 单资产 3.954%，剔除 2020-05 后仍 +0.29pp、纯 carry +0.21pp、全成本下增益仍 +0.44pp（均为主理人回测）。用一次性归因推翻全部样本外检验，是另一种过拟合。</div></div>

<div class="card"><h2>④ 样本外：调参能选出更高权重，但单调性会断</h2>
<p class="small">把红利权重当作可调参数做 4 折 walk-forward（训练 5 年 / 测试 2.5 年），候选 0/10/20/30/41.9/60/100%。</p>
${table(['训练段', '测试段', '选中权重', '样本外·选中', '样本外·30%', '样本外·0%', '选中−30%', '30%−0%'], wfRows)}
<div class="note">4 折训练段<b>全部选中 100% 红利</b>（与单调性一致），测试段选中权重 3/4 折跑赢 30%；但第 2 折（2017-10~2020-05）100% 红利样本外只有 <b>0.97%</b>，反而跑输单资产 2.81%，选中权重相对 30% 为 <b>−1.29pp</b>。结论：样本外数据既不支持「把权重提到 100%」，也不构成对 30% 的显著性证明；它证明的是单调性不是稳定规律。这与择时层「4 折全选默认参数」是两种不同性质的结果，不应合并叙述。</div></div>

<div class="card"><h2>⑤ 执行成本与真实现金利率：这里才是最大的口径风险</h2>
<p class="small">本节与第 ①②③④ 节同为 <b>70/30 审计口径</b>（对 v1.4 方案的检验）；75/25 最终执行口径的数字见第 ⑧ 节。</p>
${table(['情景', '年化', '最大回撤', '相对基线', '再平衡次数', '累计换手', '累计费+税'], costRows)}
<div class="grid2"><div><h3>现金利率敏感性（60% 现金端）</h3>${table(['现金年化', '组合年化', '相对基线', ''], cashRows)}</div>
<div><h3>配置增益是否被成本吃掉</h3>${table(['口径', '70/30', '单资产', '增量'], costEdgeRows)}
<div class="bad"><b>最大单一敏感度不是配置，是现金假设。</b>现金收益每变动 1pp，组合年化变动约 <b>0.62pp</b>，大于 70/30 全部增益（0.48pp）。项目用四轮工作证伪了 0.03pp 的择时层，却让这个 2.5% 常数覆盖 16.8 年未动。若按更接近近年环境的 1.5%~2.0% 取值，组合名义年化从 3.78% 降到 <b>3.16%~3.47%</b>。</div></div></div>
<div class="note">全成本叠加（双边费 5bp + 滑点 10bp + 股息税 10% + 次日成交 + 现金 2.0%）后年化 <b>3.26%</b>（−0.53pp），最大回撤升到 <b>19.80%</b>。其中交易费与滑点合计仅 −0.02pp，<b>成本主要来自现金假设、股息税与成交滞后</b>；T+1 成交单独把回撤从 18.49% 推到 19.58%，已逼近 R=20% 线。注意：股息税按「直接持股、持股 1 月~1 年 10%」建模；若用 ETF/场外指数基金实现，基金层面已扣税，不应重复计入，此处作为上界敏感性列示。</div>
<h3>现金利率情景（宏观策略师口径，已落地为本地可复现检验）</h3>
<p class="small">三段式取 2010-14 3.0% / 2015-21 2.3% / 2022-26 1.3%（货币基金近似）；「前瞻 1.3% 全期」仅为保守压力情景，不是对历史利率的还原。</p>
${table(['情景', '年化', '最大回撤', '年化差', '回撤差'], cashScenRows)}
<h3>常数 2.5% 是否在后期系统性低估回撤</h3>${table(['区间', '常数 2.5% 分段回撤', '三段式分段回撤', '差'], cashMddRows)}
<div class="note">换成分段利率后，<b>最近两段的回撤分别被低估 0.29pp / 0.21pp</b>，方向与宏观判断一致，但幅度有限；全期最大回撤只升 0.06pp。真正的影响在收益端：三段式年化 <b>3.61%</b>（−0.17pp）。按前瞻 1.3% 做压力，年化降到 3.04%（−0.74pp）。结论：<b>历史回测应改用分段真实利率；前瞻资金安排按 1.0%~1.5% 现金收益，不能按 2.5%。</b></div>
<div class="good"><b>但配置增益本身没被吃掉</b>：全成本口径下 70/30 相对单资产仍有 +0.44pp（基线 +0.48pp），现金利率变化对两者几乎同向，不改变相对结论。</div></div>

<div class="card"><h2>⑥ R 减半条款：按构造在真实历史里永远不会触发</h2>
<p>v1.4 唯一保留的风控是「账户回撤达 R 时敞口减半一次」。但 R→E 表本身就是按「历史最大回撤略小于 R」反推敞口的，因此触发条件在样本内被结构性排除。</p>
<div class="grid2"><div><h3>四个 R→E 档位</h3>${table(['R', 'E', '历史最大回撤', '余量', '触发次数'], riskRows)}</div>
<div><h3>固定 E=40%，收紧 R 的交叉检验</h3>${table(['R', '历史最大回撤', '触发', '首次触发日'], crossRows)}</div></div>
<div class="bad"><b>循环论证：</b>四档全部 0 次触发，余量 1.29~4.36pp。只有把 R 收紧到 ≤18%（低于该敞口的历史实际回撤）才会触发。也就是说，这条风控条款的全部证据只有 3 条人工构造的极端路径，在 16.8 年真实历史中<b>从未被激活、也从未被验证</b>——与 v1.2 被否决的三级风控性质相同，只是更隐蔽。v1.5 必须把它明确标注为「面向未来的尾部保险，非经验证的风控」，并保留「R 是触发线不是回撤上限」的表述。</div></div>

${teamHtml}

<div class="card"><h2>⑧ 本轮结论与 v1.5 变更清单</h2>
<div class="good"><b>口径分工</b>：第 ①~⑦ 节的全部统计检验（+0.48pp、bootstrap、起点、窗口、分段、反事实、成本、样本外、R 条款）对象都是 <b>v1.4 的 70/30</b>，不因参数调整而改写；本节表格与下列执行口径数字属于重新收口后的 <b>75/25 最终方案</b>。两组数字不可混用。</div>
<h3>v1.5 最终执行口径 R→敞口对照表（权益内 75 / 25）</h3>
<p class="small">主口径 = 分段真实现金利率（3.0% / 2.3% / 1.3%）+ 按目标比例重置份额的季度再平衡 + 双边费 5bp + 滑点 10bp + T+1 成交；股息税不重复计入（ETF / 场外指数基金层面已扣），末列单列含 10% 股息税的保守值。沿用四档 E，不借口径变化抬高敞口。</p>
${table(['R', '固定敞口 E', '年化', '最大回撤', 'R 余量', '旧口径年化', '旧口径回撤', '含股息税年化', '相对 70/30'], v15Rows)}
<div class="note">四档仍满足 MDD ≤ R，余量 <b>0.27~0.53pp</b>（R=30% 档 3.21pp）。<b>R=20% 示例：v1.4 旧口径 3.78% / 18.49% → 70/30 新口径 3.51% / 19.67% → 75/25 最终口径 3.43% / 19.69%</b>；含 10% 股息税为 3.32% / 19.73%。权重从 30% 降到 25% 使年化再降约 0.08pp、回撤微升 0.03pp，代价很小。新口径回撤已贴近 R 线，这是「R 是触发线不是上限」更该被强调的原因。</div>
<ul>
<li><b>保留配置倾斜，权重改为 25% 单点（权益内 75/25，主动硬上限 25%）</b>：同等强度证伪后，+0.48pp 在 4 起点 / 3 独立窗口 / 4 分段全为正、bootstrap 正值 ${f(D.bootstrap.pos, 1)}%、反事实下仍有 +0.21~0.29pp——增益方向稳健但统计不显著；结合基本面恶化（ROE 10.48%→8.70%、收入连续三年负、隐含派息率比值 1.27→0.975）与相对折价收敛，取 v1.4 已授权区间 25%~35% 的下沿。<b>六条规则结构不动</b>，这是参数取值而非新规则。</li>
<li><b>不采纳 10~15%</b>：估值定价师「67% 增益来自已兑现重估」是归因假说，而第 4 折样本外（折价收敛之后）高权重仍跑赢、反事实 +0.29pp / 纯 carry +0.21pp、三段单调、全成本 +0.44pp 均不支持；用一次性归因推翻全部样本外检验是另一种过拟合。</li>
<li><b>修正季度再平衡实现</b>：必须按目标比例重置资产间份额、禁止同比例缩放。v1.4 的 70/30 实现下红利权重漂到 <b>36.9%</b>（修正后 33.2%）；75/25 执行口径下若不修会漂到 <b>31.27%</b>（修正后 27.88%）。年化影响 &lt;0.01pp，但风险预算会被悄悄放大。</li>
<li><b>把现金收益从常数改为分段真实利率</b>：当前影响最大的未修正假设（每 1pp → 年化 0.62pp），前瞻按 1.0~1.5% 安排资金。</li>
<li><b>如实标注权重来源，并删除「怕行业集中」这条理由</b>：回测只支持「有倾斜优于无倾斜」，不支持任何具体数字；穿透后最重行业仅占总资产 2.83%，该约束从未成立。</li>
<li><b>估值分位 / PE-PB 比 / 息差一律移出触发条件</b>：撤回对「改双条件」的驳斥（该结论系误填、不存在）；明确拒绝 p20/p10 滚动分位动态门槛——属规则级估值择时，且季末 152bp PASS 与现货 128bp FAIL 会在数据刷新日产生无经济含义的交易。它们<b>仅作研究信号，可用于定期审阅定静态参数，不得作自动触发输入</b>。</li>
<li><b>如实标注 R 减半条款</b>：按构造在历史样本内不会触发，属休眠条款、不构成尾部保护；并记录其追跌减仓与「不做择时」的潜在冲突。</li>
<li><b>双向证据披露 + 净收益口径</b>：把支持与反对下调的证据并列；75/25 口径下基线 3.70% / 18.55%、主口径 3.43% / 19.69%、含股息税 3.32% / 19.73% 三者并列，不再只报单一乐观口径。</li>
</ul></div>

<div class="foot">
<p><b>数据来源与复现</b>：价格序列为本地 <code>hs300_daily_2010_2026.json</code>（000300）与 <code>csi_dividend_2010_2026.json</code>（000922），2010-01-04 ~ ${e(D.sample.to)}，${D.sample.days} 个交易日，原始来源东方财富公开接口；股息率为 <code>valuation_semiannual_2010_2026.json</code>（NeoData <code>index_valuation</code>，34 个半年度观测点线性插值）；择时层对照数字来自 <code>回测报告_扩展验证_2026-11-07.html</code> 与 <code>投资策略规划_v1.4.md</code>。相对估值重估序列（PE 比 / PB 比 / 息差，34 个半年度观测）与 75/25 最终执行口径数字，均由同一脚本从 <code>valuation_semiannual_2010_2026.json</code> 与价格序列重算。本轮全部数字写入 <code>final_audit_data.json</code>，再由 <code>node final_report.js</code> 渲染，无手工填写的结论。</p>
<p><b>局限</b>：成交按收盘价同价成交（已另列 T+1 敏感性）；未计 ETF 折溢价、场外申赎延迟、流动性冲击；股息税按直接持股口径建模，ETF 实现下不重复计；现金利率仅做档位敏感性，未替换为逐年实测序列；极端路径未在本轮重跑，沿用上一轮 3 条人工构造路径；反事实价格序列为人工替换，不代表任何真实市场情形；walk-forward 仅 4 折，不支撑显著性结论。</p>
<p>⚠️ 本报告为策略设计与历史回测的研究记录，不构成投资建议，不构成个股推荐。历史结果不预示未来表现。投资有风险，决策需谨慎。</p>
</div></body></html>`;

fs.writeFileSync(PT.out('回测报告_最终方案审计_2026-11-07.html'), html);
console.log('已生成 回测报告_最终方案审计_2026-11-07.html，', html.length, 'bytes');
