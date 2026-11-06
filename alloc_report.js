const fs = require('fs');
const D = fs.readFileSync('alloc_data.json', 'utf8');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>v1.2 配置调整：为什么只改构成，不改规则</title>
<script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script>
<style>
  :root{
    --ink:#1a2332; --ink2:#3d4a5c; --mute:#8492a6; --line:#e4e7ec;
    --bg:#fbfbf9; --card:#ffffff; --up:#c0392b; --down:#1e8449;
    --s1:#c9a227; --s2:#d97706; --s3:#b91c1c; --div:#8c6a1f;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
    font:15px/1.75 -apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
    -webkit-font-smoothing:antialiased}
  .wrap{max-width:1080px;margin:0 auto;padding:56px 40px 90px}
  header{border-bottom:2px solid var(--ink);padding-bottom:26px;margin-bottom:34px}
  .kicker{font-size:12px;letter-spacing:.16em;color:var(--mute);text-transform:uppercase;margin-bottom:14px}
  h1{font-size:31px;line-height:1.32;margin:0 0 14px;font-weight:700;letter-spacing:-.01em}
  .sub{color:var(--ink2);font-size:14.5px;margin:0}
  .sub b{color:var(--ink)}
  h2{font-size:19px;margin:52px 0 8px;font-weight:700;letter-spacing:-.005em}
  h2 .no{color:var(--mute);font-weight:500;margin-right:9px;font-variant-numeric:tabular-nums}
  h3{font-size:15px;margin:28px 0 6px;font-weight:700;color:var(--ink2)}
  .lead{color:var(--ink2);font-size:14px;margin:0 0 20px;max-width:78ch}
  .cards{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--line);
    border:1px solid var(--line);margin:30px 0 8px}
  .card{background:var(--card);padding:20px 18px}
  .card .v{font-size:29px;font-weight:700;letter-spacing:-.02em;line-height:1.1}
  .card .v small{font-size:15px;font-weight:600;color:var(--ink2)}
  .card .k{font-size:12px;color:var(--mute);margin-top:7px;letter-spacing:.02em}
  .chart{background:var(--card);border:1px solid var(--line);padding:8px 4px 4px;margin:22px 0 6px}
  .chart .hd{font-size:13px;font-weight:600;padding:12px 18px 0;color:var(--ink2)}
  #c1{height:400px} #c2{height:330px} #c3{height:340px} #c4{height:320px}
  table{width:100%;border-collapse:collapse;font-size:13.2px;margin:18px 0 6px;background:var(--card)}
  th,td{padding:10px 12px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}
  th{background:#f4f5f7;font-size:11.5px;font-weight:600;color:var(--ink2);letter-spacing:.04em;
     text-transform:uppercase;border-bottom:1px solid #d5d9e0}
  td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  .dim{color:var(--mute);font-size:11.8px}
  .good{color:var(--down);font-weight:600}
  .bad{color:var(--up);font-weight:600}
  .hl{background:#fffdf5}
  .note{background:#fff9e8;border-left:3px solid var(--s1);padding:16px 20px;margin:24px 0;
    font-size:13.6px;color:var(--ink2);line-height:1.7}
  .note b{color:var(--ink)}
  .warn{background:#fdf0ef;border-left:3px solid var(--s3)}
  .ok{background:#eff8f2;border-left:3px solid var(--down)}
  ul{padding-left:20px;margin:14px 0}
  li{margin:7px 0;color:var(--ink2);font-size:14px}
  li b{color:var(--ink)}
  .src{font-size:11.8px;color:var(--mute);margin:8px 0 0;line-height:1.65}
  footer{margin-top:60px;padding-top:22px;border-top:1px solid var(--line);font-size:12px;color:var(--mute);line-height:1.8}
</style>
</head>
<body>
<div class="wrap">

<header>
  <div class="kicker">配置调整报告 · v1.1 → v1.2</div>
  <h1>只换买什么，不动什么时候买<br>回撤降了 1.7 个点，年化升了 0.44 个点</h1>
  <p class="sub">权益内部构成调整　标的：沪深300 与中证红利（均为价格指数）　区间：<b>2010-01-04 → 2026-11-06</b>　
  含分红（红利 4.5% / 沪深300 2.5%）、持有费 0.5%、现金 2.5%</p>
</header>

<div class="cards">
  <div class="card"><div class="v">4.56<small>%</small></div><div class="k">62% 权益年化（v1.1 为 4.12%）</div></div>
  <div class="card"><div class="v">27.1<small>%</small></div><div class="k">最坏路径回撤（v1.1 为 28.8%）</div></div>
  <div class="card"><div class="v">41.9<small>%</small></div><div class="k">底部红利占权益（v1.1 为 25.0%）</div></div>
  <div class="card"><div class="v">0.00<small>pp</small></div><div class="k">规则改动带来的增量（一个字没动）</div></div>
</div>

<h2><span class="no">01</span>先说结论</h2>
<p class="lead">上一份回测把一件事算清楚了：这套策略里所有买卖规则的收益增量是 <b>0.12 个百分点</b>，和"每季度调回一次"的常数混合分不出高下。同一份数据里，只把标的从中证500 换成中证红利，年化差了 <b>1.32 个百分点</b>。</p>
<p class="lead">所以这一版没有改任何规则——阶段阈值、买入节奏、三档止盈、移动退出、时间退出、风控线，一个字没动。改的只有 3.1 节那张表的权重：<b>把红利从占权益 25% 提到 42%，把中证500增强加科创50 从 28% 压到 13%。</b></p>

<div class="note ok">
<b>净效果：同样 62% 权益上限，年化 +0.44pp，最坏路径回撤 −1.7pp。</b>这是一个没有取舍的改进——但收益的绝对量不大，因为真正决定结果的"权益总量"没有变（仍是 62%），变的只是这 62% 内部怎么分。
</div>

<h2><span class="no">02</span>红利权重与收益近似单调</h2>
<p class="lead">把 62% 权益全部放在"红利／沪深300"两种资产上，只改两者的比例，季度再平衡，跑 16.8 年：</p>

<div class="chart"><div class="hd">62% 权益 · 红利占比 0→100% · 年化与最大回撤</div><div id="c1"></div></div>

<table>
<thead><tr><th>红利占权益</th><th class="n">年化</th><th class="n">最大回撤</th><th class="n">Sharpe</th><th class="n">Calmar</th><th class="n">16.8 年累计</th></tr></thead>
<tbody id="t-scan"></tbody>
</table>
<p class="src">说明：红利按 4.5% 股息率、沪深300 按 2.5% 计入分红，两者均扣 0.5% 持有费；现金 2.5%。股息率取长期中枢，不是逐年实测值，这是本表最主要的简化。</p>

<div class="note warn">
<b>这张表不能线性外推。</b>它单调向上，但 100% 红利的结论不能采纳，有三个具体理由：
<ul style="margin:8px 0 0">
<li><b>单一因子、单一市场。</b>红利溢价在 2011–2014 的低估值期和 2023–2025 的分红政策推动下被显著放大，这两段不能保证重演。</li>
<li><b>行业集中。</b>中证红利里银行约 25%、煤炭与公用事业合计约 20%。100% 红利等于把一半账户压在这三个行业上，直接违反 3.4 节的穿透约束。</li>
<li><b>回撤并未改善。</b>0% 到 100% 红利的最大回撤只从 29.2% 降到 28.1%，收益涨了但风险没降——这说明红利提供的是<b>收益</b>，不是<b>缓冲</b>。</li>
</ul>
</div>

<h2><span class="no">03</span>压力路径：同样的 62%，不同的结局</h2>
<p class="lead">按 7.2 的假设（红利 −25%、沪深300 −30%、中证500 −35%、科创50 与行业ETF −40%）走一遍最坏路径：指数从高水位 H 跌到 −35% 触发 S3，再按加权幅度继续跌，然后看账户净值落在哪里。</p>

<div class="chart"><div class="hd">最坏路径期末净值分解（初始 100）</div><div id="c2"></div></div>

<table>
<thead><tr><th>项目</th><th class="n">v1.1</th><th class="n">v1.2</th><th class="n">变化</th></tr></thead>
<tbody id="t-stress"></tbody>
</table>

<div class="note">
<b>回撤减少的 1.7pp 从哪来？</b>全部来自两个数字：加权再跌从 <b>33.9%</b> 降到 <b>30.8%</b>，最终底部从 <b>H×0.429</b> 抬到 <b>H×0.450</b>。指数跌得浅了 2 个多点，账户里每一笔买入的浮亏就同步少 2 个多点。规则一个没改。
</div>

<h2><span class="no">04</span>新配置表</h2>
<p class="lead">账户净值占比，k＝1（R＝30%）。机动列为<b>该档累计持仓</b>，不是增量。</p>

<table>
<thead><tr><th>资产</th><th class="n">核心仓</th><th class="n">S1</th><th class="n">S2</th><th class="n">S3</th><th class="n">占权益（S3）</th></tr></thead>
<tbody id="t-alloc"></tbody>
</table>

<h3>50 万元对应金额</h3>
<table>
<thead><tr><th>资产</th><th class="n">核心仓</th><th class="n">S1</th><th class="n">S2</th><th class="n">S3</th></tr></thead>
<tbody id="t-money"></tbody>
</table>
<p class="src">单笔买入上限 6% ＝ 3 万元，与单周新增上限天然对齐。科创50 在 S1 只有 0.25 万元，是故意的小——它的定位是"小比例弹性"，不是资产配置的一部分。</p>

<h2><span class="no">05</span>各档内部构成</h2>
<div class="chart"><div class="hd">各档权益构成（占账户净值 %）· 上：v1.1　下：v1.2</div><div id="c3"></div></div>

<p class="lead">v1.1 的问题在左半边：核心仓确实偏红利（54.5%），但 40% 的机动仓里红利只占 8.75%，中证500增强加科创50 却占了 43.75%。<b>结果是在最需要稳的地方——底部满仓 62% 时——红利只占 25%，高波动品种占了 28%。</b>配置的方向在最关键的位置被反向稀释了。</p>

<div class="note">
<b>为什么机动仓也要放红利？</b>因为"越跌越买"的对象不该是波动最大的品种。红利在压力假设下只跌 25%，中证500 跌 35%、科创50 跌 40%——同样的钱买跌幅 40% 的品种，等于在底部加杠杆。真正需要弹性的部分，由 4.4 的倾斜规则在特定时点单独放大（中证500 比沪深300 多跌 10pp 时，额度上调 50%），而不是常年重仓。
</div>

<h2><span class="no">06</span>每一档的风险都低了</h2>
<p class="lead">如果行情在某一档就直接见底，账户的回撤：</p>
<div class="chart"><div class="hd">各档直接见底时的账户回撤</div><div id="c4"></div></div>

<table>
<thead><tr><th>停在</th><th class="n">权益</th><th class="n">v1.1 回撤</th><th class="n">v1.2 回撤</th><th class="n">改善</th><th class="n">边际回撤（v1.2）</th></tr></thead>
<tbody id="t-step"></tbody>
</table>
<p class="src">边际回撤＝该档相对上一档新增的风险。v1.2 是 7.1 / 6.0 / 3.1 个百分点——越往后加仓，每多投一笔增加的风险越小，因为买点离底部更近。这是分批加仓的数学依据。</p>

<h2><span class="no">07</span>为什么不把权益加到 65% 或 78%</h2>
<p class="lead">改构成后加权跌幅下降，同样的 30% 预算理论上能承载更多权益。两套方法给出的边界并不一致，差额本身就是最重要的信息：</p>

<table>
<thead><tr><th>算法</th><th class="n">系数</th><th class="n">R＝30% 的权益上限</th><th>含义</th></tr></thead>
<tbody>
<tr><td>路径法（v1.2 新构成）</td><td class="n">43.7%</td><td class="n">78.6%</td><td class="dim">依赖"红利只跌 25%"这个假设</td></tr>
<tr><td>历史回撤法（实测常数混合）</td><td class="n">45.9%</td><td class="n">65.3%</td><td class="dim">依赖 2010–2026 真实发生过的最坏情形</td></tr>
<tr class="hl"><td><b>本版采用</b></td><td class="n"><b>46.5%</b></td><td class="n"><b>64.5%</b></td><td class="dim">取两者更保守的一侧</td></tr>
<tr><td>实际执行</td><td class="n">—</td><td class="n"><b>62.0%</b></td><td class="dim">再往下留 2.5pp 余量</td></tr>
</tbody>
</table>

<div class="note warn">
<b>差额是信息，不是误差。</b>2015 年那种流动性冲击里，红利的跌幅和沪深300 几乎一样（62% 权益下实测 28.5% vs 28.7%）——<b>红利在崩盘时并不提供假设里的那层缓冲。</b>用参数法的 78.6% 去加仓，等于把安全边际建立在"这次红利会抗跌"的信念上。取 62%，保留 2.5 个点给"假设本身可能是错的"。
</div>

<h2><span class="no">08</span>这份分析证明不了什么</h2>
<ul>
<li><b>只有两种资产有数据。</b>中证500、科创50、行业ETF 在回测里没有对应的价格序列，本文把它们当作与沪深300 等价处理。这意味着 0.44pp 的改善是<b>保守估计</b>——如果这三项真如假设那样跌得更多，改善会更大。</li>
<li><b>股息率是假设值。</b>红利 4.5%、沪深300 2.5% 取的是长期中枢，不是逐年实测。股息率每变动 1pp，年化同向变动约 0.4pp。</li>
<li><b>样本只有 16.8 年、三个周期。</b>红利因子在这段样本里处于有利期，这个结论不能外推到"红利永远更好"。</li>
<li><b>没有考虑税费与申赎限制。</b>红利ETF 的分红税务处理、场内流动性、大额赎回限制均未建模。</li>
</ul>

<div class="note">
<b>一句话总结：</b>这套策略的收益来自"持有什么"和"持多少"，纪律只决定你能不能拿到它。v1.2 把配置往现金流那一端挪了一步，这是目前唯一还能被数据支持的改善方向。<b>再往前的路要么是加权益（超预算），要么是加杠杆（不可接受），都不该走。</b>
</div>

<footer>
数据来源：东方财富公开行情接口，沪深300（000300）与中证红利（000922）日收盘价，2010-01-04 至 2026-11-06，各 4,089 个交易日。<br>
计算方法：两资产＋现金的季度再平衡组合；分红按日计提；未计交易费用以外的税费。<br>
<b>免责声明</b>：以上为历史数据回测与策略验证材料，仅供参考，不构成投资建议。回测存在前视偏差、样本内过拟合与数据局限，历史结果不预示未来表现。投资有风险，决策需结合自身情况独立判断。
</footer>

</div>

<script>
const DATA = ${D};

// ---------- 表 1 ----------
document.getElementById('t-scan').innerHTML = DATA.scan.map(s => {
  const hi = s.w === 40 || s.w === 20;
  return \`<tr\${hi ? ' class="hl"' : ''}><td>\${s.w}%\${s.w === 20 ? ' <span class="dim">（v1.1）</span>' : s.w === 40 ? ' <span class="dim">（v1.2 附近）</span>' : ''}</td>
  <td class="n">\${s.cagr.toFixed(2)}%</td><td class="n">\${s.mdd.toFixed(1)}%</td>
  <td class="n">\${s.sharpe.toFixed(2)}</td><td class="n">\${s.calmar.toFixed(2)}</td>
  <td class="n">\${s.total}%</td></tr>\`;
}).join('');

// ---------- 表 2 ----------
const so = DATA.stress.old, sn = DATA.stress.neu;
const rows2 = [
  ['核心仓期末市值', so.coreEnd, sn.coreEnd],
  ['S1 期末（买在 H×0.85）', so.lots[0].v, sn.lots[0].v],
  ['S2 期末（买在 H×0.75）', so.lots[1].v, sn.lots[1].v],
  ['S3 期末（买在 H×0.65）', so.lots[2].v, sn.lots[2].v],
  ['现金', 38, 38],
  ['合计净值', so.nav, sn.nav],
  ['累计回撤', so.dd, sn.dd, true]
];
document.getElementById('t-stress').innerHTML = rows2.map(([k, a, b, isDD]) => {
  const d = b - a, cls = isDD ? (d < 0 ? 'good' : 'bad') : (d > 0 ? 'good' : '');
  const fmt = isDD ? v => v.toFixed(1) + '%' : v => v.toFixed(2);
  const dfmt = (d > 0 ? '+' : '') + (isDD ? d.toFixed(1) + 'pp' : d.toFixed(2));
  return \`<tr\${isDD ? ' class="hl"' : ''}><td>\${k}</td><td class="n">\${fmt(a)}</td><td class="n">\${fmt(b)}</td>
    <td class="n \${isDD ? cls : ''}">\${dfmt}</td></tr>\`;
}).join('') + \`<tr><td class="dim">加权再跌幅度 s</td><td class="n dim">\${so.s}%</td><td class="n dim">\${sn.s}%</td><td class="n dim">\${(sn.s - so.s).toFixed(1)}pp</td></tr>
<tr><td class="dim">最终底部（相对 H）</td><td class="n dim">H×\${so.bottom}</td><td class="n dim">H×\${sn.bottom}</td><td class="n dim">跌得更浅</td></tr>\`;

// ---------- 表 3 / 4 ----------
const AL = [
  ['红利资产', [14, 18, 22, 26], 41.9],
  ['沪深300', [8, 15, 20, 24], 38.7],
  ['中证500增强', [0, 2, 4.5, 6], 9.7],
  ['科创50', [0, 0.5, 1.5, 2], 3.2],
  ['单个行业ETF', [0, 1.5, 4, 4], 6.5]
];
document.getElementById('t-alloc').innerHTML = AL.map(([n, v, sh]) =>
  \`<tr><td>\${n}</td>\${v.map(x => \`<td class="n">\${x === 0 ? '—' : x.toFixed(1) + '%'}</td>\`).join('')}<td class="n">\${sh.toFixed(1)}%</td></tr>\`
).join('') + \`<tr class="hl"><td><b>权益合计</b></td><td class="n"><b>22.0%</b></td><td class="n"><b>37.0%</b></td><td class="n"><b>52.0%</b></td><td class="n"><b>62.0%</b></td><td class="n">100%</td></tr>
<tr><td class="dim">现金</td><td class="n dim">78.0%</td><td class="n dim">63.0%</td><td class="n dim">48.0%</td><td class="n dim">38.0%</td><td class="n dim">—</td></tr>\`;

document.getElementById('t-money').innerHTML = AL.map(([n, v]) =>
  \`<tr><td>\${n}</td>\${v.map(x => \`<td class="n">\${x === 0 ? '—' : (x * 0.5).toFixed(2) + ' 万'}</td>\`).join('')}</tr>\`
).join('') + \`<tr class="hl"><td><b>权益合计</b></td><td class="n"><b>11.0 万</b></td><td class="n"><b>18.5 万</b></td><td class="n"><b>26.0 万</b></td><td class="n"><b>31.0 万</b></td></tr>
<tr><td class="dim">现金</td><td class="n dim">39.0 万</td><td class="n dim">31.5 万</td><td class="n dim">24.0 万</td><td class="n dim">19.0 万</td></tr>\`;

// ---------- 表 5 ----------
const st = ['S0', 'S1', 'S2', 'S3'], eq = [22, 37, 52, 62];
document.getElementById('t-step').innerHTML = st.map((s, i) => {
  const a = DATA.stepOld[i], b = DATA.stepNew[i], m = i === 0 ? null : (DATA.stepNew[i] - DATA.stepNew[i - 1]);
  return \`<tr\${i === 3 ? ' class="hl"' : ''}><td>\${s}</td><td class="n">\${eq[i]}%</td>
    <td class="n">\${a.toFixed(1)}%</td><td class="n">\${b.toFixed(1)}%</td>
    <td class="n good">\${(b - a).toFixed(1)}pp</td><td class="n">\${m === null ? '—' : m.toFixed(1) + 'pp'}</td></tr>\`;
}).join('');

// ---------- 图 1 ----------
const c1 = echarts.init(document.getElementById('c1'));
c1.setOption({
  grid: { left: 52, right: 56, top: 44, bottom: 46 },
  tooltip: { trigger: 'axis', valueFormatter: v => v + '%' },
  legend: { data: ['年化收益', '最大回撤'], top: 8, textStyle: { fontSize: 12, color: '#3d4a5c' } },
  xAxis: {
    type: 'category', data: DATA.scan.map(s => s.w + '%'),
    name: '红利占权益', nameLocation: 'middle', nameGap: 28,
    axisLine: { lineStyle: { color: '#d5d9e0' } }, axisLabel: { fontSize: 11, color: '#8492a6' },
    nameTextStyle: { color: '#8492a6', fontSize: 11 }
  },
  yAxis: [
    { type: 'value', name: '年化', min: 3, max: 6.5, axisLabel: { formatter: '{value}%', fontSize: 11, color: '#8492a6' }, splitLine: { lineStyle: { color: '#eef0f3' } } },
    { type: 'value', name: '回撤', min: 27, max: 30, axisLabel: { formatter: '{value}%', fontSize: 11, color: '#8492a6' }, splitLine: { show: false } }
  ],
  series: [
    {
      name: '年化收益', type: 'line', smooth: true, symbolSize: 6,
      data: DATA.scan.map(s => s.cagr),
      lineStyle: { width: 2.5, color: '#1a2332' }, itemStyle: { color: '#1a2332' },
      areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(26,35,50,.10)' }, { offset: 1, color: 'rgba(26,35,50,0)' }]) },
      markLine: {
        silent: true, symbol: 'none', label: { fontSize: 11, color: '#8492a6' },
        data: [{ xAxis: '20%', label: { formatter: 'v1.1\\n25%' }, lineStyle: { color: '#c9a227', type: 'dashed' } },
               { xAxis: '40%', label: { formatter: 'v1.2\\n42%' }, lineStyle: { color: '#1e8449', type: 'dashed' } }]
      }
    },
    {
      name: '最大回撤', type: 'line', yAxisIndex: 1, smooth: true, symbolSize: 5,
      data: DATA.scan.map(s => s.mdd),
      lineStyle: { width: 1.8, color: '#b91c1c' }, itemStyle: { color: '#b91c1c' }
    }
  ]
});

// ---------- 图 2 ----------
const c2 = echarts.init(document.getElementById('c2'));
const cats = ['核心仓', 'S1 批', 'S2 批', 'S3 批', '现金'];
const vo = [so.coreEnd, so.lots[0].v, so.lots[1].v, so.lots[2].v, 38];
const vn = [sn.coreEnd, sn.lots[0].v, sn.lots[1].v, sn.lots[2].v, 38];
c2.setOption({
  grid: { left: 52, right: 30, top: 44, bottom: 40 },
  tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: v => v.toFixed(2) },
  legend: { data: ['v1.1 构成的期末市值', 'v1.2 构成的期末市值'], top: 8, textStyle: { fontSize: 12, color: '#3d4a5c' } },
  xAxis: { type: 'category', data: cats, axisLine: { lineStyle: { color: '#d5d9e0' } }, axisLabel: { fontSize: 12, color: '#3d4a5c' } },
  yAxis: { type: 'value', name: '期末市值', max: 42, axisLabel: { fontSize: 11, color: '#8492a6' }, splitLine: { lineStyle: { color: '#eef0f3' } } },
  series: [
    { name: 'v1.1 构成的期末市值', type: 'bar', data: vo, barWidth: '32%', itemStyle: { color: '#c9c4b8' }, barGap: '10%' },
    { name: 'v1.2 构成的期末市值', type: 'bar', data: vn, barWidth: '32%', itemStyle: { color: '#8c6a1f' },
      label: { show: true, position: 'top', fontSize: 11, color: '#3d4a5c', formatter: p => p.value.toFixed(2) } }
  ]
});

// ---------- 图 3 ----------
const c3 = echarts.init(document.getElementById('c3'));
const zs = ['S0 平时', 'S1 回撤15%', 'S2 回撤25%', 'S3 回撤35%'];
const names = ['红利', '沪深300', '中证500增强', '科创50', '行业ETF'];
const colors = ['#8c6a1f', '#3d6b8f', '#7a8fa6', '#c9a227', '#b91c1c'];
function stack(mode) {
  const v = DATA.comp[mode].vals; // 4 stages x 5 assets
  return names.map((n, ai) => ({
    name: n, type: 'bar', stack: mode, barWidth: '42%',
    itemStyle: { color: colors[ai] },
    label: { show: false },
    data: v.map(r => r[ai]),
    ...(ai === 4 ? { label: { show: true, position: 'top', fontSize: 11, color: '#1a2332', formatter: p => { const t = v[p.dataIndex].reduce((a, b) => a + b, 0); return t.toFixed(0) + '%'; } } } : {})
  }));
}
c3.setOption({
  grid: [{ left: 56, right: 30, top: 56, height: 108 }, { left: 56, right: 30, top: 214, height: 108 }],
  tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: v => v.toFixed(1) + '%' },
  legend: { data: names, top: 4, textStyle: { fontSize: 11.5, color: '#3d4a5c' }, itemGap: 14 },
  title: [
    { text: 'v1.1', left: 8, top: 34, textStyle: { fontSize: 12, color: '#8492a6', fontWeight: 600 } },
    { text: 'v1.2', left: 8, top: 192, textStyle: { fontSize: 12, color: '#8c6a1f', fontWeight: 600 } }
  ],
  xAxis: [
    { type: 'category', gridIndex: 0, data: zs, axisLine: { lineStyle: { color: '#d5d9e0' } }, axisLabel: { fontSize: 11, color: '#8492a6' } },
    { type: 'category', gridIndex: 1, data: zs, axisLine: { lineStyle: { color: '#d5d9e0' } }, axisLabel: { fontSize: 11, color: '#3d4a5c' } }
  ],
  yAxis: [
    { type: 'value', gridIndex: 0, max: 70, axisLabel: { formatter: '{value}%', fontSize: 10, color: '#8492a6' }, splitLine: { lineStyle: { color: '#eef0f3' } } },
    { type: 'value', gridIndex: 1, max: 70, axisLabel: { formatter: '{value}%', fontSize: 10, color: '#8492a6' }, splitLine: { lineStyle: { color: '#eef0f3' } } }
  ],
  series: [
    ...stack('old').map(s => ({ ...s, xAxisIndex: 0, yAxisIndex: 0 })),
    ...stack('neu').map(s => ({ ...s, xAxisIndex: 1, yAxisIndex: 1 }))
  ]
});

// ---------- 图 4 ----------
const c4 = echarts.init(document.getElementById('c4'));
c4.setOption({
  grid: { left: 52, right: 40, top: 44, bottom: 40 },
  tooltip: { trigger: 'axis', valueFormatter: v => v.toFixed(1) + '%' },
  legend: { data: ['v1.1', 'v1.2', 'R 预算 30%'], top: 8, textStyle: { fontSize: 12, color: '#3d4a5c' } },
  xAxis: { type: 'category', data: DATA.stepNew.map((_, i) => ['S0 平时', 'S1', 'S2', 'S3'][i]), boundaryGap: false, axisLine: { lineStyle: { color: '#d5d9e0' } }, axisLabel: { fontSize: 12, color: '#3d4a5c' } },
  yAxis: { type: 'value', name: '账户回撤', max: 34, axisLabel: { formatter: '{value}%', fontSize: 11, color: '#8492a6' }, splitLine: { lineStyle: { color: '#eef0f3' } } },
  series: [
    { name: 'v1.1', type: 'line', data: DATA.stepOld, symbolSize: 7, lineStyle: { width: 2, color: '#c9c4b8', type: 'dashed' }, itemStyle: { color: '#c9c4b8' } },
    { name: 'v1.2', type: 'line', data: DATA.stepNew, symbolSize: 8, lineStyle: { width: 2.5, color: '#8c6a1f' }, itemStyle: { color: '#8c6a1f' },
      areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(140,106,31,.18)' }, { offset: 1, color: 'rgba(140,106,31,0)' }]) },
      label: { show: true, position: 'top', fontSize: 11, color: '#8c6a1f', formatter: p => p.value.toFixed(1) + '%' } },
    { name: 'R 预算 30%', type: 'line', data: [30, 30, 30, 30], symbol: 'none', lineStyle: { color: '#b91c1c', type: 'dashed', width: 1.5 }, itemStyle: { color: '#b91c1c' } }
  ]
});

window.addEventListener('resize', () => { [c1, c2, c3, c4].forEach(c => c.resize()); });
</script>
</body>
</html>`;

fs.writeFileSync('配置调整报告_v1.2.html', html);
console.log('written', (html.length / 1024).toFixed(1), 'KB');
