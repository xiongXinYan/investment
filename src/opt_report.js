// 生成「回测修正版」报告（2026-11-07）
// 读取 bt_data.json（v1.2 现行规则口径），输出纯静态 HTML，不依赖外部 CDN，可离线打开。
const fs = require('fs');
const PT = require('../lib/paths.js');
const D = JSON.parse(fs.readFileSync(PT.resolve('bt_data.json'), 'utf8'));
const M = D.metrics;
const f = (x, d = 2) => Number(x).toFixed(d);
const pc = (x, d = 2) => f(x * 100, d) + '%';          // 小数 -> 百分比
const pcN = (x, d = 2) => f(x, d) + '%';               // 已经是百分数
const pp = (x, d = 2) => (x >= 0 ? '+' : '') + f(x, d) + 'pp';

const metricRows = [
  ['v1.2 策略（现行规则）', M.strat],
  ['同敞口常数混合（季再平衡）', M.match],
  ['40% 常数混合（推荐基准）', null],
  ['沪深300 满仓', M.bh],
  ['60/40 季再平衡', M.s60],
  ['22% 核心仓', M.core]
];
const m40 = (() => { const e = D.benchSens.find(x => Math.abs(x.eq - 40) < 0.1); return e || null; })();

// 净值曲线（每 10 个采样点取一个）
const S = D.ser, idx = [];
for (let i = 0; i < S.d.length; i += 10) idx.push(i);
if (idx[idx.length - 1] !== S.d.length - 1) idx.push(S.d.length - 1);
const series = [
  { name: 'v1.2 策略', key: 's', color: '#b91c1c', w: 2.2 },
  { name: '60/40', key: 'c', color: '#c9a227', w: 1.3 },
  { name: '22% 核心', key: 'k', color: '#1e8449', w: 1.3 },
  { name: '沪深300 满仓', key: 'b', color: '#8492a6', w: 1.3 }
];
const allV = series.flatMap(q => idx.map(i => S[q.key][i]));
const lo = Math.min(...allV) * 0.98, hi = Math.max(...allV) * 1.02;
const X0 = 52, X1 = 1000, Y0 = 16, Y1 = 250;
const xAt = k => X0 + (X1 - X0) * k / (idx.length - 1);
const yAt = v => Y1 - (Y1 - Y0) * (v - lo) / (hi - lo);
const paths = series.map(q => `<polyline fill="none" stroke="${q.color}" stroke-width="${q.w}" points="${idx.map((i, k) => xAt(k).toFixed(1) + ',' + yAt(S[q.key][i]).toFixed(1)).join(' ')}"/>`).join('');
const gridLines = [0.8, 1.0, 1.2, 1.4, 1.6].filter(v => v > lo && v < hi).map(v =>
  `<line x1="${X0}" y1="${yAt(v).toFixed(1)}" x2="${X1}" y2="${yAt(v).toFixed(1)}" stroke="#e9ecf0" stroke-width="1"/><text x="${X0 - 8}" y="${(yAt(v) + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#8492a6">${v.toFixed(1)}</text>`).join('');
const yearTicks = idx.map((i, k) => ({ k, d: S.d[i] })).filter((o, k, a) => k === 0 || (o.d.slice(0, 4) !== a[k - 1].d.slice(0, 4) && Number(o.d.slice(0, 4)) % 3 === 0)).map(o =>
  `<text x="${xAt(o.k).toFixed(1)}" y="270" text-anchor="middle" font-size="10" fill="#8492a6">${o.d.slice(0, 4)}</text>`).join('');

// 归因堆叠条
const at = D.attribution, total = at.total;
const wA = 520 * at.fromAssumption / total, wP = 520 * at.fromPrice / total, wI = 520 * at.interaction / total;

const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>投资策略回测修正版 · v1.2 现行规则 · 2026-11-07</title>
<style>
:root{--ink:#1a2332;--ink2:#3d4a5c;--mute:#8492a6;--line:#e4e7ec;--bg:#fbfbf9;--card:#fff;
--up:#c0392b;--down:#1e8449;--warn:#b91c1c;--amber:#c9a227}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);
font:15px/1.75 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:1080px;margin:0 auto;padding:56px 40px 90px}
header{border-bottom:2px solid var(--ink);padding-bottom:26px;margin-bottom:34px}
.kicker{font-size:12px;letter-spacing:.16em;color:var(--mute);text-transform:uppercase;margin-bottom:14px}
h1{font-size:31px;line-height:1.32;margin:0 0 14px;font-weight:700;letter-spacing:-.01em}
.sub{color:var(--ink2);font-size:14.5px;margin:0}
h2{font-size:19px;margin:52px 0 8px;font-weight:700}h2 .no{color:var(--mute);font-weight:500;margin-right:9px}
h3{font-size:15px;margin:28px 0 6px;font-weight:700;color:var(--ink2)}
.lead{color:var(--ink2);font-size:14px;margin:0 0 20px;max-width:82ch}
.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--line);border:1px solid var(--line);margin:28px 0 8px}
.card{background:var(--card);padding:20px 18px}.card .v{font-size:27px;font-weight:700;letter-spacing:-.02em;line-height:1.1}
.card .v small{font-size:14px;font-weight:600;color:var(--ink2)}.card .k{font-size:12px;color:var(--mute);margin-top:7px}
table{width:100%;border-collapse:collapse;font-size:13.2px;margin:18px 0 6px;background:var(--card)}
th,td{padding:10px 12px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}
th{background:#f4f5f7;font-size:11.5px;font-weight:600;color:var(--ink2);letter-spacing:.04em}
td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.good{color:var(--down);font-weight:600}.bad{color:var(--up);font-weight:600}.dim{color:var(--mute);font-size:11.8px}
.note{background:#fff9e8;border-left:3px solid var(--amber);padding:16px 20px;margin:24px 0;font-size:13.6px;color:var(--ink2);line-height:1.7}
.note b{color:var(--ink)}.warn{background:#fdf0ef;border-left:3px solid var(--warn)}.ok{background:#eff8f2;border-left:3px solid var(--down)}
.chart{background:var(--card);border:1px solid var(--line);padding:14px 18px;margin:22px 0 6px}
.chart .hd{font-size:13px;font-weight:600;color:var(--ink2);margin-bottom:8px}
.legend{display:flex;flex-wrap:wrap;gap:18px;font-size:12px;color:var(--ink2);margin-top:8px}
.legend i{display:inline-block;width:16px;height:3px;vertical-align:middle;margin-right:6px}
ul{padding-left:20px;margin:14px 0}li{margin:7px 0;color:var(--ink2);font-size:14px}li b{color:var(--ink)}
.src{font-size:11.8px;color:var(--mute);margin:8px 0 0;line-height:1.65}
footer{margin-top:60px;padding-top:22px;border-top:1px solid var(--line);font-size:12px;color:var(--mute);line-height:1.8}
code{background:#f1f2f4;padding:2px 5px;border-radius:3px;font-size:12px}
</style></head><body><div class="wrap">
<header><div class="kicker">回测修正版 · 研究记录</div>
<h1>把回测引擎同步到现行规则之后，<br>择时层的增量是 0.00 个百分点</h1>
<p class="sub">口径：v1.2 现行规则（756 日条件清 + 1260 日硬清） · 样本 ${D.period[0]} → ${D.period[1]} · 4,089 个交易日 · 生成于 2026-11-07</p></header>

<div class="cards">
<div class="card"><div class="v">${pc(M.strat.cagr)}</div><div class="k">v1.2 策略年化</div></div>
<div class="card"><div class="v">${pc(M.match.cagr)}</div><div class="k">同敞口常数混合</div></div>
<div class="card"><div class="v">${pp((M.strat.cagr - M.match.cagr) * 100)}</div><div class="k">择时增量</div></div>
<div class="card"><div class="v">${pc(M.strat.mdd, 1)}</div><div class="k">最大回撤</div></div>
</div>

<div class="note warn"><b>需要先更正上一版的两个数字。</b>2026-11-06 的报告写的是「年化 3.53%、择时增量 +0.12pp」，那组数字来自仍在跑 <b>v1.1 旧规则</b>（756 交易日无条件强清）的引擎，而 v1.2 已把这条改成「756 日亏损 ≥15% 才清 + 1260 日硬边界」。按现行规则精确重跑是 <b>${pc(M.strat.cagr)}</b>，与同敞口常数混合完全相等。上一版评估报告中「按 v1.2 近似重跑约 3.69–3.80%」也是用参数近似估的，<b>以本次精确重跑为准</b>：近似没有实现 756 日条件清，高估了约 0.3pp。</div>

<h2><span class="no">01</span>主结果：复杂规则与季度再平衡，在收益上不可分辨</h2>
<p class="lead">同敞口基准用策略全期平均敞口 ${pc(D.avgExp)} 构造，每季度调回一次；这是归因基准（含事后信息），不是可事前复制的组合。</p>
<table><thead><tr><th>组合</th><th class="n">年化</th><th class="n">最大回撤</th><th class="n">Calmar</th><th class="n">说明</th></tr></thead><tbody>
<tr><td><b>v1.2 策略</b></td><td class="n"><b>${pc(M.strat.cagr)}</b></td><td class="n">${pc(M.strat.mdd, 1)}</td><td class="n">${f(M.strat.calmar)}</td><td>71 次买入、57 个平仓批次、批次胜率 ${pc(D.lotWin, 0)}</td></tr>
<tr><td>同敞口常数混合</td><td class="n">${pc(M.match.cagr)}</td><td class="n">${pc(M.match.mdd, 1)}</td><td class="n">${f(M.match.calmar)}</td><td>敞口 ${pc(D.avgExp)}，季度再平衡</td></tr>
<tr><td>40% 常数混合</td><td class="n">${pcN(m40.cagr)}</td><td class="n">${pcN(m40.mdd, 1)}</td><td class="n">${f(m40.cagr / m40.mdd)}</td><td>少 0.03pp 年化，少 1.8pp 回撤</td></tr>
<tr><td>60/40 季再平衡</td><td class="n">${pc(M.s60.cagr)}</td><td class="n">${pc(M.s60.mdd, 1)}</td><td class="n">${f(M.s60.calmar)}</td><td>敞口更高，回撤更大</td></tr>
<tr><td>沪深300 满仓</td><td class="n">${pc(M.bh.cagr)}</td><td class="n">${pc(M.bh.mdd, 1)}</td><td class="n">${f(M.bh.calmar)}</td><td>价格收益 + 股息 2.5% − 费 0.5%</td></tr>
</tbody></table>
<div class="note"><b>block bootstrap（20 日块，1,000 次重抽）</b>：策略减同敞口常数的年化差均值 ${pp(D.boot.mean)}，95% 区间 <b>${pp(D.boot.lo)} ~ ${pp(D.boot.hi)}</b>，重抽中为正的比例 ${D.boot.posRate}%。区间宽达 3.4pp 且跨零，<b>没有统计证据表明择时层创造了超额</b>。</div>

<div class="chart"><div class="hd">净值走势（起点归一，纵轴倍数）</div>
<svg viewBox="0 0 1020 285" width="100%" role="img"><title>净值曲线对比</title>${gridLines}${paths}${yearTicks}</svg>
<div class="legend">${series.map(q => `<span><i style="background:${q.color}"></i>${q.name}</span>`).join('')}</div>
<p class="src">数据：bt_data.json / ser，每 5 个交易日采样后每 10 点取 1；含股息、费用与现金利息，未含滑点与税。</p></div>

<h2><span class="no">02</span>规则版本差异：改一条时间退出，收益少 0.12pp</h2>
<table><thead><tr><th>口径</th><th class="n">年化</th><th class="n">回撤</th><th class="n">敞口</th><th class="n">同敞口</th><th class="n">增量</th><th class="n">买入</th></tr></thead><tbody>
${D.ruleDiff.map(r => `<tr><td>${r.n}</td><td class="n">${pcN(r.cagr)}</td><td class="n">${pcN(r.mdd, 1)}</td><td class="n">${pcN(r.exp, 1)}</td><td class="n">${pcN(r.match)}</td><td class="n ${r.edge > 0 ? 'good' : 'bad'}">${pp(r.edge)}</td><td class="n">${r.buys}</td></tr>`).join('')}
</tbody></table>
<p class="src">v1.1 旧口径用于复现 2026-11-06 报告；文档 8.2 周期口径＝机动仓全部退出才关闭周期、候选 H 随新高上调；费用 ×3＝单边交易费 0.15%。</p>

<h2><span class="no">03</span>收益归因：换标的的提升，${at.assumptionShare}% 来自假设</h2>
<p class="lead">v1.2 把红利占权益从 25% 提到 41.9%，依据是「换标的后年化 +1.32pp」。但切换标的时同时把股息率假设从 2.5% 调到 4.5%，原报告没有分离两者。</p>
<div class="chart"><div class="hd">${pp(at.total)} 提升的构成</div>
<svg viewBox="0 0 560 62" width="100%" role="img"><title>收益归因分解</title>
<rect x="0" y="8" width="${wA.toFixed(1)}" height="30" fill="#EF9F27"/><rect x="${wA.toFixed(1)}" y="8" width="${wP.toFixed(1)}" height="30" fill="#1D9E75"/><rect x="${(wA + wP).toFixed(1)}" y="8" width="${wI.toFixed(1)}" height="30" fill="#B4B2A9"/>
<text x="${(wA / 2).toFixed(1)}" y="28" text-anchor="middle" font-size="12" font-weight="600" fill="#fff">假设 ${pp(at.fromAssumption)}</text>
<text x="${(wA + wP / 2).toFixed(1)}" y="28" text-anchor="middle" font-size="12" font-weight="600" fill="#fff">价格 ${pp(at.fromPrice)}</text>
<text x="0" y="55" font-size="11" fill="#8492a6">股息率假设 2.5%→4.5%（未逐年实测） · 真实价格序列差异 · 交互项 ${pp(at.interaction)}</text></svg></div>
<table><thead><tr><th>组合</th><th class="n">年化</th><th class="n">回撤</th><th class="n">同敞口常数</th><th class="n">择时增量</th></tr></thead><tbody>
${at.cells.map(c => `<tr><td>${c.name}</td><td class="n">${pcN(c.cagr)}</td><td class="n">${pcN(c.mdd, 1)}</td><td class="n">${pcN(c.match)}</td><td class="n ${c.edge > 0 ? 'good' : 'bad'}">${pp(c.edge)}</td></tr>`).join('')}
</tbody></table>
<div class="note warn"><b>两个连带事实。</b>其一，${at.assumptionShare}% 的提升来自一个覆盖 16.8 年的常数假设，不是数据实证；两条指数日收益相关系数 0.8775、年化波动 21.51% 对 20.78%，压力假设里「红利只跌 25%」缺乏依据。其二，<b>在真实红利价格序列下，策略相对同敞口常数是负贡献</b>——被加仓的那一端恰是择时层表现最差的一端。红利价格超额还高度集中在 2020-05 之后（+36.3% 对沪深300 +3.1%），属于在因子跑赢后加仓。</div>

<h2><span class="no">04</span>决定结果的是敞口，不是规则</h2>
<table><thead><tr><th>固定权益敞口</th><th class="n">年化</th><th class="n">最大回撤</th></tr></thead><tbody>
${D.benchSens.map(b => `<tr${Math.abs(b.eq - D.avgExp * 100) < 0.1 ? ' style="background:#fffdf5"' : ''}><td>${pcN(b.eq, 1)}${Math.abs(b.eq - D.avgExp * 100) < 0.1 ? ' <span class="dim">（策略平均敞口）</span>' : ''}</td><td class="n">${pcN(b.cagr)}</td><td class="n">${pcN(b.mdd, 1)}</td></tr>`).join('')}
</tbody></table>
<p class="lead">敞口从 35% 到 55%，年化只变动 0.13pp，回撤却从 16.3% 扩到 25.9%。<b>风险预算应当通过直接设定常数敞口实现</b>，而不是靠一整套动态规则间接实现——后者增加了执行成本，却没有改变风险来源。基准敞口设定本身的不确定性与 0.00pp 的择时增量同量级。</p>

<h2><span class="no">05</span>稳健性：增量随起点与区间翻转</h2>
<h3>不同起点（策略 − 同敞口常数）</h3>
<table><thead><tr><th>起点</th><th class="n">策略年化</th><th class="n">常数年化</th><th class="n">增量</th><th class="n">策略回撤</th></tr></thead><tbody>
${D.starts.map(s => `<tr><td>${s.start}</td><td class="n">${pcN(s.cagr)}</td><td class="n">${pcN(s.match)}</td><td class="n ${s.edge > 0 ? 'good' : 'bad'}">${pp(s.edge)}</td><td class="n">${pcN(s.mdd, 1)}</td></tr>`).join('')}
</tbody></table>
<h3>不重叠的 5 年窗口（真正独立的样本只有 3 个）</h3>
<table><thead><tr><th>区间</th><th class="n">策略</th><th class="n">同敞口常数</th><th class="n">增量</th><th class="n">满仓</th></tr></thead><tbody>
${D.indep.map(s => `<tr><td>${s.s} → ${s.e}</td><td class="n">${pcN(s.cagr)}</td><td class="n">${pcN(s.match)}</td><td class="n ${s.edge > 0 ? 'good' : 'bad'}">${pp(s.edge)}</td><td class="n">${pcN(s.bh)}</td></tr>`).join('')}
</tbody></table>
<div class="note">上一版报告用 ${D.roll.length} 个滚动 5 年窗口得出「29% 跑赢满仓」。这些窗口每 10 个交易日滑一次、长度 1,260 天，<b>重叠率超过 99%</b>，统计上约等于 3 个样本；而且对比对象是满仓，低仓位在上涨段跑输是同义反复。本版改用不重叠窗口与同敞口基准，增量在 3 个样本里翻转两次。</div>

<h2><span class="no">06</span>参数 ±30% 敏感性（补上上一版声称做过、实际没有的检验）</h2>
<table><thead><tr><th>参数</th><th class="n">0.7×</th><th class="n">1.0×</th><th class="n">1.3×</th><th class="n">年化极差</th></tr></thead><tbody>
${D.paramGrid.map(g => { const v = g.vals.map(x => x.cagr), rg = Math.max(...v) - Math.min(...v); return `<tr><td>${g.name}</td>${v.map(x => `<td class="n">${pcN(x)}</td>`).join('')}<td class="n ${rg > 0.5 ? 'bad' : ''}">${f(rg)}pp</td></tr>`; }).join('')}
</tbody></table>
<p class="lead"><b>最敏感的是入场回撤阈值（±30% → 年化变动 1.00pp）</b>，而它恰恰是唯一没有任何数据约束、纯设定出来的参数；四维估值打分与市场广度从未接入回测，S1/S2/S3 的触发条件本身还没有被检验过。其次是时间退出（0.52pp）——也就是本次修正的那条规则。相对地，止盈档、移动退出、每笔规模的 ±30% 都在 0.4pp 以内。</p>

<h2><span class="no">07</span>成本与周期口径</h2>
<table><thead><tr><th>交易费用倍数</th>${D.costSens.map(c => `<th class="n">×${c.k}</th>`).join('')}</tr></thead><tbody>
<tr><td>年化</td>${D.costSens.map(c => `<td class="n">${pcN(c.cagr)}</td>`).join('')}</tr>
<tr><td>最大回撤</td>${D.costSens.map(c => `<td class="n">${pcN(c.mdd, 1)}</td>`).join('')}</tr></tbody></table>
<p class="src">费用放大到 5 倍，年化只降 0.07pp。交易成本不是这套策略的主要矛盾——因为换手本来就不高；真正的成本是每周记账与数据维护的时间。</p>
<table><thead><tr><th>周期结束口径</th><th class="n">年化</th><th class="n">回撤</th><th class="n">周期数</th><th class="n">买入次数</th></tr></thead><tbody>
${D.cycleCompare.map(c => `<tr><td>${c.name}</td><td class="n">${pcN(c.cagr)}</td><td class="n">${pcN(c.mdd, 1)}</td><td class="n">${c.cycles}</td><td class="n">${c.buys}</td></tr>`).join('')}
</tbody></table>
<p class="src">旧引擎在价格创新高（p &gt; H）时结束周期，文档 8.2 的定义是机动仓全部退出。两种口径差 ${pp(D.cycleCompare[1].cagr - D.cycleCompare[0].cagr)}，说明实现差异确实会影响结果，但方向不改变主结论。</p>

<h2><span class="no">08</span>风控层：已修实现，但样本内仍无法验证</h2>
<div class="note warn"><b>全期最大回撤 ${pcN(D.risk.maxDD, 1)}，低于 25.5% 的第一条检查线，三级风控（25.5% 停止新增 / 30% 减至核心仓 / 34.5% 权益降至 10%）一次都没有触发，触发次数 ${D.risk.events.length}。</b>本次已修掉引擎里的三处缺陷：风控只能触发一次（<code>!riskHit</code>）、清仓后没有冷却会立刻买回、34.5% 档没有实现。但<b>修好实现不等于验证有效</b>——历史样本里它从未被激活，需要用构造的极端路径单独检验。</div>
<h3>全部退出事件（57 个平仓批次，共 ${Object.values(D.allExits).reduce((a, b) => a + b, 0)} 次）</h3>
<table><thead><tr><th>退出原因</th><th class="n">次数</th></tr></thead><tbody>
${Object.entries(D.allExits).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td>${k}</td><td class="n">${v}</td></tr>`).join('')}
</tbody></table>

<h2><span class="no">09</span>仍然没有验证的东西（诚实清单）</h2>
<ul>
<li><b>四维估值打分、市场广度 B、高估减仓、4.4 倾斜规则</b>：回测只按回撤 D 触发，这些是策略定义的必要条件，却没有任何历史序列。所谓「3 个周期」只是上界。</li>
<li><b>五类资产组合、穿透集中度约束、核心仓周期边界再平衡</b>：引擎是单价格序列 + 单股息率，中证500、科创50、行业 ETF 按沪深300 等价处理。</li>
<li><b>成交时点</b>：当日收盘价判断并以同一收盘价成交，文档 10.1 写的是「收盘确认、下一可交易时段处理」；未计隔夜跳空、滑点、ETF 折溢价、场外申赎延迟、红利税。</li>
<li><b>股息率与现金收益</b>：2.5% / 4.5% / 2.5% 是覆盖 16.8 年的常数，未随利率环境变化，也无逐年实测。</li>
<li><b>样本外与纸面执行</b>：全部结论来自同一段样本内数据；第三关 12 周纸面执行尚未开始。</li>
<li><b>回撤口径</b>：7.2 的压力路径回撤相对周期高点，7.4 的实时回撤相对历史净值高水位，新周期开启时两者不一致，30% 减仓线可能提前触发。</li>
</ul>

<h2><span class="no">10</span>结论</h2>
<div class="note ok"><b>优化方向不是继续调规则，而是做减法。</b>证据显示：收益由平均权益敞口与资产选择决定；择时与卖出规则层的增量为 0.00pp 且置信区间跨零；最敏感的参数恰恰最没有数据支撑；配置倾斜的主要依据是常数假设与最近六年的因子表现。因此 v1.3 把<b>常数敞口 + 定期再平衡设为主方案</b>，把 v1.2 的完整规则降级为可选的行为约束模块，并保留风险预算、压力测试与资金分层。详见 <code>投资策略规划_v1.3.md</code>。</div>

<footer>
数据：hs300_daily_2010_2026.json（000300）、csi_dividend_2010_2026.json（000922），东方财富公开接口，4,089 条，日期完全对齐。<br>
复现：<code>node bt_engine.js</code> → <code>node bt_data.js</code> → <code>node opt_report.js</code>。v1.1 口径历史报告由 <code>bt_report.js</code> 读取 <code>bt_data_v1.1_archive.json</code> 生成。<br>
本报告为策略设计与历史回测的研究记录，不构成投资建议。回测存在样本内过拟合、数据局限与前视风险，历史结果不预示未来表现。投资有风险，决策需谨慎。
</footer></div></body></html>`;

fs.writeFileSync(PT.out('回测报告_修正版_2026-11-07.html'), html);
console.log('OK 回测报告_修正版_2026-11-07.html', html.length, 'bytes');
