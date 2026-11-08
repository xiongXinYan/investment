// 扩展验证报告渲染（纯静态 HTML，无外部依赖，可离线双击打开）
const fs = require('fs');
const PT = require('../lib/paths.js');
const D = JSON.parse(fs.readFileSync(PT.resolve('extended_data.json'), 'utf8'));
const e = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f = (x, d = 2) => Number(x).toFixed(d);
const bar = (v, max, color = '#2563eb') => `<div class="bar"><i style="width:${Math.max(1, Math.min(100, v / max * 100))}%;background:${color}"></i></div>`;

function spark(vals, labels, w = 560, h = 170, color = '#2563eb') {
  const min = Math.min(...vals), max = Math.max(...vals), pad = (max - min) * 0.18 || 0.4;
  const lo = min - pad, hi = max + pad;
  const X = i => 44 + i * (w - 66) / (vals.length - 1), Y = v => h - 28 - (v - lo) / (hi - lo) * (h - 52);
  const pts = vals.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
  const dots = vals.map((v, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="3.5" fill="${color}"/><text x="${X(i).toFixed(1)}" y="${(Y(v) - 9).toFixed(1)}" text-anchor="middle" class="sv">${v}</text>`).join('');
  const xl = labels.map((l, i) => `<text x="${X(i).toFixed(1)}" y="${h - 8}" text-anchor="middle" class="sv">${e(l)}</text>`).join('');
  return `<svg viewBox="0 0 ${w} ${h}" class="chart"><line x1="44" y1="${h - 28}" x2="${w - 22}" y2="${h - 28}" stroke="#d7dee8"/><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.2"/>${dots}${xl}</svg>`;
}
const table = (head, body) => `<table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;

// 1 真实股息率
const dyRows = D.dividend.map(r => `<tr><td>${e(r.name)}</td><td class="n">${f(r.strat)}%</td><td class="n">${f(r.mdd)}%</td><td class="n">${f(r.match)}%</td><td class="n">${f(r.edge)}pp</td><td class="n">${f(r.c40)}%</td><td class="n">${f(r.m40)}%</td></tr>`).join('');
const annRows = D.dividendAnnual.map(r => `<tr><td>${r.y}</td><td class="n">${f(r.hs)}%</td><td>${bar(r.hs, 7, '#2563eb')}</td><td class="n">${f(r.hl)}%</td><td>${bar(r.hl, 7, '#d97706')}</td></tr>`).join('');
const allocRows = D.allocCompare.map(r => `<tr><td>${e(r.name)}</td><td class="n">${f(r.w25)}%</td><td class="n">${f(r.w30)}%</td><td class="n">${f(r.w419)}%</td><td class="n">${f(r.w100)}%</td><td class="n"><b>${f(r.gain25to419)}pp</b></td><td>${bar(r.gain25to419, 0.6, r.gain25to419 < 0.3 ? '#94a3b8' : '#2563eb')}</td></tr>`).join('');

// 2 估值证伪
const V = D.valuation;
const gridVals = V.threshGrid.map(g => g.cagr), gridLabels = V.threshGrid.map(g => '×' + g.k);
const gridRows = V.threshGrid.map(g => `<tr><td>×${f(g.k, 1)}</td><td class="n">${f(g.cagr)}%</td><td class="n">${f(g.mdd)}%</td><td class="n">${f(g.exp)}%</td><td class="n">${f(g.edge)}pp</td><td class="n">${g.buys}</td></tr>`).join('');
const segRows = V.segs.map(s => `<tr><td>${e(s.period)}</td><td class="n">${f(s.base)}%</td><td class="n">${f(s.val)}%</td><td class="n"><b>${f(s.diff)}pp</b></td><td class="n">${f(s.edgeBase)}pp</td><td class="n">${f(s.edgeVal)}pp</td></tr>`).join('');
const distRows = [0, 1, 2, 3, 4].map(k => `<tr><td>${k} 分</td><td class="n">${V.scoreDist.doc[k] || 0}</td><td class="n">${V.scoreDist.exp[k] || 0}</td><td class="n">${f((V.scoreDist.doc[k] || 0) / 4089 * 100, 0)}% / ${f((V.scoreDist.exp[k] || 0) / 4089 * 100, 0)}%</td></tr>`).join('');

// 3 极端路径
const stressRows = D.stress.map(s => `<tr><td>${e(s.name)}</td><td class="n">−${f(s.pxDrop)}%</td><td class="n">${f(s.v12.cagr)}%</td><td class="n">${f(s.v12.mdd)}%</td><td class="n">${s.v12.riskEvents} 次 / L${s.v12.maxLevel}</td><td class="n">${s.v12.rebuys.length ? s.v12.rebuys.map(x => x.buysIn20d).join(',') : '—'}</td><td class="n">${f(s.trackA.mdd)}%</td><td class="n" style="color:#c2410c"><b>${f(s.trackB.mdd)}%</b></td></tr>`).join('');
const stressBars = D.stress.map(s => `<div class="bl"><span>${e(s.name)}</span><div class="bwrap"><div class="bseg" style="width:${s.trackA.mdd / 36 * 100}%;background:#2563eb">A ${f(s.trackA.mdd)}%</div><div class="bseg" style="width:${Math.max(0, s.trackB.mdd - s.trackA.mdd) / 36 * 100}%;background:#ea580c">+${f(s.trackB.mdd - s.trackA.mdd, 1)}</div></div></div>`).join('');

// 4 walk-forward
const wfRows = D.walkForward.folds.map(x => `<tr><td>${e(x.train)}</td><td>${e(x.test)}</td><td>${e(x.picked)}</td><td class="n">${f(x.oosBest)}%</td><td class="n">${f(x.oosDefault)}%</td><td class="n">${f(x.oosConst40)}%</td><td class="n" style="color:${x.edgeBestVsMatch < 0 ? '#c2410c' : '#1d4ed8'}">${f(x.edgeBestVsMatch)}pp</td><td>${x.vsDefault}</td><td>${x.vsConst40}</td></tr>`).join('');

// 5 文档核对
const docRows = D.docCheck.items.map(x => `<tr><td>${e(x.k)}</td><td class="n">${e(x.doc)}</td><td class="n">${e(x.real)}</td><td class="${x.ok ? 'ok' : 'no'}">${x.ok ? '一致' : '不一致 / 不可复核'}</td></tr>`).join('');

const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>策略扩展验证报告 · 2026-11-07</title>
<style>
*{box-sizing:border-box}body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;max-width:1120px;margin:0 auto;padding:28px 22px 60px;background:#f5f7fa;color:#1f2937;line-height:1.65}
h1{font-size:26px;margin:0 0 6px}h2{font-size:19px;margin:0 0 14px;padding-bottom:10px;border-bottom:2px solid #e2e8f0}
.sub{color:#64748b;font-size:13px;margin-bottom:22px}
.hero{background:linear-gradient(135deg,#1e3a8a,#2563eb);color:#fff;padding:28px 30px;border-radius:14px;margin-bottom:22px}
.hero .tag{display:inline-block;background:rgba(255,255,255,.18);padding:3px 10px;border-radius:20px;font-size:12px;margin-bottom:12px}
.hero h1{font-size:30px}.hero p{margin:8px 0 0;opacity:.92;font-size:14px}
.hero .kpi{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:20px}
.hero .kpi div{background:rgba(255,255,255,.14);padding:12px;border-radius:8px}
.hero .kpi b{display:block;font-size:21px}.hero .kpi span{font-size:12px;opacity:.85}
.card{background:#fff;border:1px solid #e5eaf1;border-radius:12px;padding:22px;margin-bottom:20px;box-shadow:0 1px 3px rgba(15,23,42,.04)}
.note{background:#fff7ed;border-left:4px solid #ea580c;padding:12px 16px;border-radius:0 8px 8px 0;margin:14px 0;font-size:14px}
.good{background:#eff6ff;border-left:4px solid #2563eb;padding:12px 16px;border-radius:0 8px 8px 0;margin:14px 0;font-size:14px}
table{width:100%;border-collapse:collapse;font-size:13px;margin:10px 0}th{background:#f1f5f9;text-align:left;padding:9px 10px;font-weight:600;color:#475569;border-bottom:1px solid #e2e8f0}
td{padding:8px 10px;border-bottom:1px solid #eef2f7}tr:last-child td{border-bottom:none}td.n{text-align:right;font-variant-numeric:tabular-nums}
.ok{color:#1d4ed8;font-weight:600}.no{color:#c2410c;font-weight:600}
.bar{background:#eef2f7;border-radius:4px;height:9px;width:100%;min-width:70px}.bar i{display:block;height:9px;border-radius:4px}
.chart{width:100%;height:auto;display:block;margin:8px 0}.sv{font-size:10px;fill:#64748b}
.bl{display:flex;align-items:center;gap:12px;margin:10px 0;font-size:13px}.bl>span{width:230px;flex:none;color:#475569}
.bwrap{display:flex;height:22px;flex:1;background:#f1f5f9;border-radius:4px;overflow:hidden}
.bseg{color:#fff;font-size:11px;line-height:22px;text-align:center;white-space:nowrap}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.small{font-size:12px;color:#64748b}
ul{margin:8px 0;padding-left:20px}li{margin:5px 0}
.foot{color:#64748b;font-size:12px;border-top:1px solid #e2e8f0;padding-top:18px;margin-top:26px}
code{background:#f1f5f9;padding:1px 6px;border-radius:4px;font-size:12px}
@media(max-width:760px){.hero .kpi{grid-template-columns:repeat(2,1fr)}.grid2{grid-template-columns:1fr}.bl>span{width:150px}}
</style></head><body>
<div class="hero"><span class="tag">扩展验证 · 2026-11-07 · 引擎 v5</span>
<h1>结论：继续做减法，取消双轨制</h1>
<p>本轮补齐了 v1.3 列出的三处空白——真实股息率、估值/广度数据可得性、样本外与极端路径验证。四项证据一致指向：复杂规则既无稳健收益增量，其风控层在极端路径下也基本失效。</p>
<div class="kpi">
<div><b>3.35%</b><span>真实股息率口径下 v1.2 策略年化<br>（常数口径 3.41%）</span></div>
<div><b>0.00pp</b><span>估值分增量可被「阈值 ×1.2」完全复现</span></div>
<div><b>0 / 3</b><span>三级风控未触发的极端路径条数<br>（仅慢熊触发到 L2）</span></div>
<div><b>4 折全平</b><span>样本外选参始终选中默认参数<br>相对同敞口增量符号翻转</span></div>
</div></div>

<div class="card"><h2>① 常数股息率换成真实逐年序列：结论不变</h2>
<p class="small">数据源：NeoData <code>index_valuation</code>，2010-2026 半年度采样（34 个观测点）线性插值到交易日。沪深300 真实股息率区间 ${f(D.dividendStats.hs.min)}%~${f(D.dividendStats.hs.max)}%（均值 ${f(D.dividendStats.hs.avg)}%），中证红利 ${f(D.dividendStats.hl.min)}%~${f(D.dividendStats.hl.max)}%（均值 ${f(D.dividendStats.hl.avg)}%）。<b>回测固定用的 4.5% 对红利高估了 ${f(4.5 - D.dividendStats.hl.avg)}pp。</b></p>
${table(['口径', '策略年化', '策略回撤', '同敞口常数', '择时增量', '40% 常数', '40% 回撤'], dyRows)}
<div class="good"><b>主结论不变</b>：常数口径 3.41% / 增量 0.00pp，真实序列口径 3.35% / 增量 0.03pp，差异 0.06pp，低于基准设定误差量级。全部定性结论无需改写，但此后应以真实序列为主口径。</div>
<div class="grid2"><div><h3 style="font-size:15px">逐年股息率（%）</h3>${table(['年份', '沪深300', '', '中证红利', ''], annRows)}</div>
<div><h3 style="font-size:15px">配置倾斜重算（62% 权益口径）</h3>${table(['股息率口径', '25%', '30%', '41.9%', '100%', '25→41.9 增益', ''], allocRows)}
<div class="note">真实股息率下，把红利权重从 25% 提到 41.9% 的增益是 <b>${f(D.allocCompare[1].gain25to419)}pp</b>（旧假设 ${f(D.allocCompare[0].gain25to419)}pp）；若把红利股息率设成与沪深300 相同，纯价格差异只剩 <b>${f(D.allocCompare[2].gain25to419)}pp</b>。即约一半增益来自股息率差这一假设，且该假设现已换成实测值。<b>v1.3「维持 25%~35%、不追到 42%」的结论得到加强。</b></div></div></div></div>

<div class="card"><h2>② 四维估值分：看似 +1pp，实为变相调参</h2>
<p class="small">按 v1.2 第 4.2 节实现：PE 分位≤50%、PB 分位≤50%、ERP 分位≥50%、股息溢价&gt;0，各 1 分；S1/S2/S3 分别要求 ≥2/≥3/≥3 分。市场广度 B 因无历史序列显式跳过（按文档「数据缺失折算」）。区分「文档全样本固定窗口（含前视）」与「扩展窗口（仅用当时可得数据，无前视）」。</p>
${table(['口径', '年化', '回撤', '平均敞口', '买入', '相对同敞口增量', '估值阻止次数'], [
  `<tr><td>无估值门槛（v1.3 现口径）</td><td class="n">${f(V.base.cagr)}%</td><td class="n">${f(V.base.mdd)}%</td><td class="n">${f(V.base.exp)}%</td><td class="n">${V.base.buys}</td><td class="n">${f(V.base.edge)}pp</td><td class="n">0</td></tr>`,
  `<tr><td>估值分 · 无前视</td><td class="n"><b>${f(V.exp.cagr)}%</b></td><td class="n">${f(V.exp.mdd)}%</td><td class="n">${f(V.exp.exp)}%</td><td class="n">${V.exp.buys}</td><td class="n"><b>${f(V.exp.edge)}pp</b></td><td class="n">${V.exp.blocks}</td></tr>`,
  `<tr><td>估值分 · 含前视</td><td class="n">${f(V.doc.cagr)}%</td><td class="n">${f(V.doc.mdd)}%</td><td class="n">${f(V.doc.exp)}%</td><td class="n">${V.doc.buys}</td><td class="n">${f(V.doc.edge)}pp</td><td class="n">${V.doc.blocks}</td></tr>`
].join(''))}
<div class="grid2"><div><h3 style="font-size:15px">单独调入场回撤阈值（不用任何估值数据）</h3>${spark(gridVals, gridLabels)}${table(['阈值倍数', '年化', '回撤', '敞口', '增量', '买入'], gridRows)}</div>
<div><h3 style="font-size:15px">证伪检验</h3>
<ul>
<li><b>等效性</b>：阈值 ×1.2（15%→18%）得到 <b>${f(V.threshGrid.find(g => g.k === 1.2).cagr)}% / +${f(V.threshGrid.find(g => g.k === 1.2).edge)}pp</b>，与估值分无前视口径完全相同。四维打分的信息量可被一个单参数替代。</li>
<li><b>时序确有信息</b>：循环移位 40 次，真实对齐值处 <b>${V.shift.percentileOfReal}%</b> 分位；随机打乱 120 次，真实值超过 <b>${V.shuffle.percentileOfReal}%</b> 的样本。说明「低估值时买」不是纯噪声。</li>
<li><b>但不稳健</b>：bootstrap 95% 区间 <b>${f(V.bootVal.lo)} ~ ${f(V.bootVal.hi)}pp</b> 仍跨零（正值比例 ${V.bootVal.pos}%）；分段增量 ${V.segs.map(s => f(s.diff) + 'pp').join(' / ')}，集中在 2014–2018，<b>最近一段为 0</b>。</li>
<li><b>前视偏差</b>：文档「固定 2010 起全样本分位」用未来数据算历史分位。换成无前视后估值分分布显著改变（0 分占比 ${f((V.scoreDist.doc[0] || 0) / 4089 * 100, 0)}% → ${f((V.scoreDist.exp[0] || 0) / 4089 * 100, 0)}%）。</li>
</ul>
${table(['估值分', '含前视天数', '无前视天数', '占比'], distRows)}</div></div>
${table(['区间', '无估值年化', '有估值年化', '年化差', '无估值增量', '有估值增量'], segRows)}
<div class="note"><b>不要为了这 1pp 引入估值数据体系。</b>它等价于一个样本内调出来的阈值，且与价格高度内生；每周取 PE/PB/ERP/国债并维护台账的成本，换不来样本外稳定的增量。</div></div>

<div class="card"><h2>③ 极端路径：风控层形同虚设，轨道 B 放大回撤</h2>
<p class="small">构造三条 1,600 交易日的人造路径叠加确定性噪声，检验 v1.2 三级风控（25.5% / 30% / 34.5%）、v1.3 轨道 A（常数 40% + 达 R 敞口减半一次）与轨道 B（轨道 A + 回撤≥25% 一次性额外 10%）。</p>
${table(['路径', '指数跌幅', 'v1.2 年化', 'v1.2 回撤', '风控触发', 'L2 清仓后 20 日买回', '轨道A 回撤', '轨道B 回撤'], stressRows)}
<h3 style="font-size:15px">轨道 A / B 最大回撤对比（%）</h3>${stressBars}
<div class="note"><b>三条关键发现：</b>
<ul>
<li><b>三级风控在 2/3 条极端路径上完全不触发</b>（指数跌 45%~48%，账户净值回撤仅 ${f(D.stress[1].v12.mdd)}% / ${f(D.stress[2].v12.mdd)}%）。原因是初始权益敞口只有 22%，账户净值回撤很难够到 25.5% 检查线。风控线与实际风险敞口不匹配。</li>
<li>只有 2008 式慢熊触发到 L2（减机动仓，未到 L3）；清仓后 20 个交易日买入 <b>0 次</b>，说明 v5 引擎的冷却修复生效，v1.1 的「清仓后立刻买回」缺陷已消除。</li>
<li>同一慢熊下 v1.2 完整规则年化 <b>${f(D.stress[0].v12.cagr)}% / 回撤 ${f(D.stress[0].v12.mdd)}%</b>，而轨道 A 是 <b>${f(D.stress[0].trackA.cagr)}% / ${f(D.stress[0].trackA.mdd)}%</b>。复杂规则在尾部更差，进一步支持做减法。</li>
<li><b>轨道 B 的代价明确</b>：慢熊下把最大回撤从 ${f(D.stress[0].trackA.mdd)}% 推到 ${f(D.stress[0].trackB.mdd)}%（<b>+${f(D.stress[0].trackB.mdd - D.stress[0].trackA.mdd)}pp</b>），年化从 ${f(D.stress[0].trackA.cagr)}% 降到 ${f(D.stress[0].trackB.cagr)}%。更讽刺的是，在「长期阴跌」路径下轨道 B <b>一次都没触发</b>——回撤相对 252 日高点计算，慢熊中高点在同步下移，最需要纪律的场景反而不给授权。</li>
</ul></div>
<div class="good">R=20% 时轨道 A 在 −70% 路径下回撤仍达 ${f(D.stress[0].trackA.mdd)}%，说明 <b>R 是触发线而非回撤上限保证</b>；这一条必须写进执行卡，避免把「减半」误解为「锁住 20%」。</div></div>

<div class="card"><h2>④ 样本外 walk-forward：调参没有任何收益</h2>
<p class="small">训练 5 年（1,260 交易日）→ 测试 2.5 年（630 交易日），按 630 日滚动，共 ${D.walkForward.summary.n} 折。训练段在 9 组参数（入场阈值、止盈、移动退出、估值门槛）中按年化最大选参，测试段比较「选中参数 / 默认参数 / 固定 40% 常数」。</p>
${table(['训练区间', '测试区间', '选中参数', '样本外 选中', '样本外 默认', '样本外 40%常数', '相对同敞口增量', 'vs 默认', 'vs 常数'], wfRows)}
<div class="note"><b>${D.walkForward.summary.n} 折全部选中「默认参数」</b>（${D.walkForward.summary.tiesDefault} 折持平、${D.walkForward.summary.beatsDefault} 折跑赢），即样本内调参没有产生任何可迁移的改进。选中参数跑赢固定 40% 常数 ${D.walkForward.summary.beatsConst40}/${D.walkForward.summary.n} 折，但这是用更高平均敞口（约 44.6% 对 40%）换来的；相对<b>同敞口</b>常数的增量为 ${D.walkForward.folds.map(x => f(x.edgeBestVsMatch) + 'pp').join(' / ')}，符号翻转。样本外平均：策略 ${f(D.walkForward.summary.avgOOSBest)}%、常数 40% ${f(D.walkForward.summary.avgOOSConst40)}%。<b>4 折样本太少，不能支撑显著性结论，但可以否证「调参能稳定增效」。</b></div></div>

<div class="card"><h2>⑤ 数据可得性与 v1.2 第 9.3 节数字复核</h2>
<div class="grid2"><div><h3 style="font-size:15px">第三关：数据可得性</h3>
<ul><li><b>估值：可得。</b>${e(D.docCheck.availability.valuation)}</li>
<li><b>广度：不可得。</b>${e(D.docCheck.availability.breadth)}</li>
<li><b>推论：</b>${e(D.docCheck.availability.implication)}</li></ul>
<p class="small">因此 v1.2 完整规则永远无法被完整回测；S3 的「B≤25%」是一个既无法历史验证、也无法在实盘稳定取得的条件。这构成不启用 v1.2 完整规则的独立理由。</p></div>
<div><h3 style="font-size:15px">文档记录值 vs 实测（${e(D.docCheck.date)}）</h3>${table(['项目', 'v1.2 9.3 记录', '实测', '判定'], docRows)}
<p class="small">四维估值分 3/4 的最终结论一致，但 4 个分项数字有偏差（PB 分位、ERP 分位与水平、红利股息率），广度 B 无法复核。文档中的「当前估值状态」不应作为下单依据。</p></div></div></div>

<div class="card"><h2>⑥ 本轮对策略的处置</h2>
${table(['项目', 'v1.3', 'v1.4（本轮）', '依据'], [
  `<tr><td>双轨制</td><td>轨道 A 默认 + 轨道 B 可选</td><td><b>取消双轨，只保留单一方案</b></td><td>轨道 B 在慢熊放大回撤 ${f(D.stress[0].trackB.mdd - D.stress[0].trackA.mdd)}pp，且在阴跌路径不触发</td></tr>`,
  `<tr><td>估值 / 广度</td><td>轨道 B 不接入，列为待验证</td><td><b>明确不接入</b>；广度判定为永久不可得</td><td>估值增量可被单参数复现；S3 无历史数据</td></tr>`,
  `<tr><td>股息率假设</td><td>常数 2.5% / 4.5%，每季度复核</td><td><b>改用逐年实测序列</b>（沪深300 均值 ${f(D.dividendStats.hs.avg)}%、红利 ${f(D.dividendStats.hl.avg)}%）</td><td>NeoData 日度序列可得</td></tr>`,
  `<tr><td>回撤预算 R</td><td>达 R 时敞口减半一次</td><td>保留，但明确 <b>R 是触发线而非上限</b></td><td>−70% 路径下 R=20% 仍出现 ${f(D.stress[0].trackA.mdd)}% 回撤</td></tr>`,
  `<tr><td>验证协议</td><td>第三关未开始</td><td>数据可得性已完成；样本外与极端路径已完成；<b>仅剩 12 周纸面执行</b></td><td>本轮四项检验</td></tr>`
].join(''))}
<div class="good"><b>优化方向仍是减法</b>：v1.3 把复杂规则降为可选，v1.4 把「可选」也去掉。剩下的方案只有：由 R 查表定常数敞口、权益内 70/30、季度再平衡、账户回撤达 R 时敞口减半一次。</div></div>

<div class="foot"><b>复现方式</b>：<code>node valuation_series.js</code> → <code>node probe_valuation.js</code> → <code>node bt_extended.js</code> → <code>node ext_report.js</code>。数据文件：<code>valuation_semiannual_2010_2026.json</code>、<code>extended_data.json</code>。价格序列来自本地 2010–2026 日线文件；估值与股息率来自 NeoData <code>index_valuation</code>（半年度采样，线性插值，属近似口径）。引擎 v5 默认开关全关，v1.1 / v1.2 历史口径逐位可复现。
<br><br>⚠️ 本文为策略设计与历史回测的研究记录，不构成投资建议，不构成个股推荐。极端路径为人工构造，不代表任何真实市场情形；半年度估值采样、线性插值、人造路径与样本内检验均存在局限，历史结果不预示未来表现。行情与估值数据存在延迟，投资有风险，决策需谨慎。</div>
</body></html>`;
fs.writeFileSync(PT.out('回测报告_扩展验证_2026-11-07.html'), html);
console.log('written 回测报告_扩展验证_2026-11-07.html', (Buffer.byteLength(html) / 1024).toFixed(0) + 'KB');
