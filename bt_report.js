// 历史报告渲染器：固定读取 v1.1 口径的归档数据，输出 2026-11-06 的原版报告。
// 修正后的 v1.2 口径报告请用 node opt_report.js 生成。
const fs = require('fs');
const D = JSON.parse(fs.readFileSync('bt_data_v1.1_archive.json', 'utf8'));
const M = D.metrics;
const p = (x, d = 2) => (x * 100).toFixed(d) + '%';

const v = (o, k) => o.variants.find(x => x.n.startsWith(k));
const base = v(D, '不修改'), noTime = v(D, '取消时间退出'), noTP = v(D, '取消固定止盈'),
      noTrail = v(D, '取消移动退出'), noSell = v(D, '取消全部卖出'), tp15 = v(D, '止盈档改为'),
      lastBuy = v(D, '入场仍锚定');

const hs = D.assetComp[0], hl = D.assetComp[1];
const beatsBH = D.roll.filter(r => r.d > 0).length / D.roll.length;
const avgExcess = D.roll.reduce((a, r) => a + r.d, 0) / D.roll.length;

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>v1.1 完整回测：卖出规则与择时有效性</title>
<script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script>
<style>
  :root{
    --ink:#1a2332; --ink2:#3d4a5c; --mute:#8492a6; --line:#e4e7ec;
    --bg:#fbfbf9; --card:#ffffff; --up:#c0392b; --down:#1e8449;
    --s1:#c9a227; --s2:#d97706; --s3:#b91c1c;
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
  .lead{color:var(--ink2);font-size:14px;margin:0 0 20px;max-width:78ch}
  .cards{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--line);
    border:1px solid var(--line);margin:30px 0 8px}
  .card{background:var(--card);padding:20px 18px}
  .card .v{font-size:29px;font-weight:700;letter-spacing:-.02em;line-height:1.1}
  .card .v small{font-size:15px;font-weight:600;color:var(--ink2)}
  .card .k{font-size:12px;color:var(--mute);margin-top:7px;letter-spacing:.02em}
  .chart{background:var(--card);border:1px solid var(--line);padding:8px 4px 4px;margin:22px 0 6px}
  .chart .hd{font-size:13px;font-weight:600;padding:12px 18px 0;color:var(--ink2)}
  #c1{height:440px} #c2{height:270px} #c3{height:300px} #c4{height:290px}
  table{width:100%;border-collapse:collapse;font-size:13.2px;margin:18px 0 6px;background:var(--card)}
  th,td{padding:10px 12px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}
  th{background:#f4f5f7;font-size:11.5px;font-weight:600;color:var(--ink2);letter-spacing:.04em;
     text-transform:uppercase;border-bottom:1px solid #d5d9e0}
  td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  .dim{color:var(--mute);font-size:11.8px}
  .good{color:var(--down);font-weight:600}
  .bad{color:var(--up);font-weight:600}
  .note{background:#fff9e8;border-left:3px solid var(--s1);padding:16px 20px;margin:24px 0;
    font-size:13.6px;color:var(--ink2);line-height:1.7}
  .note b{color:var(--ink)}
  .warn{background:#fdf0ef;border-left:3px solid var(--s3)}
  .ok{background:#eff8f2;border-left:3px solid var(--down)}
  ul{padding-left:20px;margin:14px 0}
  li{margin:7px 0;color:var(--ink2);font-size:14px}
  li b{color:var(--ink)}
  .src{font-size:11.8px;color:var(--mute);margin:8px 0 0;line-height:1.65}
  .kv{display:grid;grid-template-columns:180px 1fr;gap:0 20px;font-size:13.5px;margin:16px 0}
  .kv div{padding:8px 0;border-bottom:1px solid var(--line);color:var(--ink2)}
  .kv div:nth-child(odd){color:var(--mute);font-size:12.5px}
  footer{margin-top:60px;padding-top:22px;border-top:1px solid var(--line);font-size:12px;color:var(--mute);line-height:1.8}
</style>
</head>
<body>
<div class="wrap">

<header>
  <div class="kicker">策略验证报告 · 第二关</div>
  <h1>把卖出规则接进回测之后<br>择时到底值多少钱</h1>
  <p class="sub">标的：沪深300（价格指数）　区间：<b>${D.period[0]} → ${D.period[1]}</b>　共 16.8 年 / 4,089 个交易日　
  含分红 2.5%、持有费 0.5%、现金 2.5%、单边费用 0.05%</p>
</header>

<div class="cards">
  <div class="card"><div class="v">${p(M.strat.cagr)}</div><div class="k">策略年化（含全部卖出规则）</div></div>
  <div class="card"><div class="v">${p(M.match.cagr)}</div><div class="k">同敞口常数混合（${Math.round(D.avgExp*100)}%，季再平衡）</div></div>
  <div class="card"><div class="v">${p(M.strat.mdd, 1)}</div><div class="k">策略最大回撤（同敞口 ${p(M.match.mdd, 1)}）</div></div>
  <div class="card"><div class="v">${((M.strat.cagr - M.match.cagr) * 100).toFixed(2)}<small>pp</small></div><div class="k">择时层相对同敞口的年化增量</div></div>
</div>

<h2><span class="no">01</span>先说结论</h2>
<p class="lead">这次回测把一个此前没有答案的问题算清楚了：<b>买入规则和卖出规则合起来，到底有没有创造价值。</b>答案是——没有可测量的价值，也没有可测量的伤害。</p>

<table>
<thead><tr><th>对照</th><th class="n">年化</th><th class="n">最大回撤</th><th class="n">Calmar</th><th class="n">平均敞口</th></tr></thead>
<tbody>
<tr><td>v1.1 策略（买 + 全部卖出规则）</td><td class="n"><b>${p(M.strat.cagr)}</b></td><td class="n">${p(M.strat.mdd,1)}</td><td class="n">${M.strat.calmar.toFixed(2)}</td><td class="n">${p(D.avgExp,1)}</td></tr>
<tr><td>同敞口常数混合（同样 ${Math.round(D.avgExp*100)}%，只做季度再平衡）</td><td class="n">${p(M.match.cagr)}</td><td class="n">${p(M.match.mdd,1)}</td><td class="n">${M.match.calmar.toFixed(2)}</td><td class="n">${p(D.avgExp,1)}</td></tr>
<tr><td>60/40 季再平衡</td><td class="n">${p(M.s60.cagr)}</td><td class="n">${p(M.s60.mdd,1)}</td><td class="n">${M.s60.calmar.toFixed(2)}</td><td class="n">60.0%</td></tr>
<tr><td>22% 核心仓恒定（季再平衡）</td><td class="n">${p(M.core.cagr)}</td><td class="n">${p(M.core.mdd,1)}</td><td class="n">${M.core.calmar.toFixed(2)}</td><td class="n">22.0%</td></tr>
<tr><td>沪深300 满仓买入持有</td><td class="n">${p(M.bh.cagr)}</td><td class="n">${p(M.bh.mdd,1)}</td><td class="n">${M.bh.calmar.toFixed(2)}</td><td class="n">100%</td></tr>
<tr><td>全现金</td><td class="n">${p(0.0253)}</td><td class="n">0.0%</td><td class="n">—</td><td class="n">0%</td></tr>
</tbody>
</table>

<div class="note"><b>把话说透：</b>策略年化 ${p(M.strat.cagr)}，一个“持有 ${Math.round(D.avgExp*100)}% 权益、每季度调回一次”的傻瓜组合拿到 ${p(M.match.cagr)}。差 ${((M.strat.cagr-M.match.cagr)*100).toFixed(2)} 个百分点，而两者的最大回撤是 ${p(M.strat.mdd,1)} 对 ${p(M.match.mdd,1)}。<b>也就是说，v1.1 那套四维打分、预算池、分批买入、三档止盈、两段移动退出、时间退出，加起来相当于每季度做一次再平衡。</b></div>

<h2><span class="no">02</span>全期表现</h2>
<p class="lead">下面这张图是五个方案的净值走势（对数刻度）。值得注意的是策略线非常平滑——它的波动率只有 ${p(M.strat.vol,1)}，是满仓的 ${(M.strat.vol/M.bh.vol*100).toFixed(0)}%。</p>

<div class="chart"><div class="hd">净值走势（2010-01-04 = 1.00，对数刻度）</div><div id="c1"></div></div>
<div class="src">注：策略曲线在 2015 年上半年几乎水平——那是它在 2015-01 因指数创新高而结束上一轮、之后半年没有信号、完全空仓的时期，正逢指数从 3549 涨到 5354。</div>

<h2><span class="no">03</span>择时层贡献了多少</h2>
<p class="lead">要回答这个问题，必须先把“多持有权益”和“择时”分开。策略平均敞口 ${p(D.avgExp,1)}，如果只是把这 ${Math.round(D.avgExp*100)}% 一直拿着、每季调平，结果就是第二行。两者之差才是择时的真实贡献。</p>

<table>
<thead><tr><th>权益端假设收益（分红−费用）</th><th class="n">策略</th><th class="n">同敞口常数</th><th class="n">择时增量</th><th class="n">满仓</th><th class="n">60/40</th></tr></thead>
<tbody>
${D.sens.map(s => `<tr><td>${p(s.carry,1)}</td><td class="n">${p(s.strat)}</td><td class="n">${p(s.match)}</td><td class="n ${s.strat>s.match?'good':'bad'}">${((s.strat-s.match)*100).toFixed(2)}pp</td><td class="n">${p(s.full)}</td><td class="n">${p(s.s60)}</td></tr>`).join('\n')}
</tbody>
</table>
<div class="src">做法：固定价格路径，只改变权益端的持有收益（相当于改变股权风险溢价），观察择时增量是否随环境变化。四次测算的增量都在 −0.09 到 +0.12 个百分点之间，且方向不一致——<b>它不随环境变好而变好，说明这不是一个稳定收益源。</b></div>

<div class="note warn"><b>为什么择时在这里失效？</b>因为“越跌越买”和“季度再平衡”在数学上是同一件事的两种写法。常数混合在指数下跌时自动把权重调回 ${Math.round(D.avgExp*100)}%，等于下跌中持续买入；策略做的是同一件事，只是用了更复杂的规则、更低的频率、并在上涨时提前卖出。<b>规则越复杂，越容易在“卖出后不能及时回补”上吃亏。</b></div>

<h2><span class="no">04</span>标的选择的影响是规则的 20 倍</h2>
<p class="lead">同一套规则，只把标的从沪深300 换成中证红利，年化从 ${p(hs.strat)} 变成 ${p(hl.strat)}。而把规则从“复杂择时”换成“傻瓜再平衡”，年化只变动 0.1 个百分点。</p>

<table>
<thead><tr><th>标的</th><th class="n">策略</th><th class="n">同敞口常数</th><th class="n">60/40</th><th class="n">满仓</th><th class="n">策略回撤</th></tr></thead>
<tbody>
<tr><td>沪深300（股息 2.5%）</td><td class="n">${p(hs.strat)}</td><td class="n">${p(hs.match)}</td><td class="n">${p(hs.s60)}</td><td class="n">${p(hs.bh)}</td><td class="n">${p(hs.ddS,1)}</td></tr>
<tr><td>中证红利（股息 4.5%）</td><td class="n">${p(hl.strat)}</td><td class="n">${p(hl.match)}</td><td class="n">${p(hl.s60)}</td><td class="n">${p(hl.bh)}</td><td class="n">${p(hl.ddS,1)}</td></tr>
<tr><td><b>差值</b></td><td class="n good"><b>+${((hl.strat-hs.strat)*100).toFixed(2)}pp</b></td><td class="n good">+${((hl.match-hs.match)*100).toFixed(2)}pp</td><td class="n good">+${((hl.s60-hs.s60)*100).toFixed(2)}pp</td><td class="n good">+${((hl.bh-hs.bh)*100).toFixed(2)}pp</td><td class="n">—</td></tr>
</tbody>
</table>

<div class="note"><b>这是整份报告最该记住的一句：</b>换标的能带来 2–3 个百分点，改规则只能带来 0.1 个百分点。你在 3.1 节把红利放在 12%、沪深300 放在 10%，方向是对的；但把 40% 的机动预算主要配给中证500增强和科创50，是把回报押在了最不稳定的那一端。</div>

<h2><span class="no">05</span>三个周期，两次错过</h2>
<p class="lead">全期只有三个可执行周期。策略在其中表现分化极大：跌的周期赢，涨的周期输。</p>

<div class="chart"><div class="hd">逐周期：策略收益 vs 同区间指数收益</div><div id="c3"></div></div>

<table>
<thead><tr><th>周期</th><th>区间</th><th class="n">历时</th><th class="n">H</th><th class="n">最深回撤</th><th class="n">买入次数</th><th class="n">策略</th><th class="n">指数</th><th class="n">差</th></tr></thead>
<tbody>
${D.cyc.map((c, i) => `<tr><td>#${i+1}</td><td>${c.start} → ${c.end || '进行中'}</td><td class="n">${c.yrs.toFixed(1)} 年</td><td class="n">${c.H}</td><td class="n">${p(c.dd,1)}</td><td class="n">${c.bu}</td><td class="n">${p(c.str,1)}</td><td class="n">${p(c.idx,1)}</td><td class="n ${c.str>c.idx?'good':'bad'}">${c.str>c.idx?'+':''}${((c.str-c.idx)*100).toFixed(1)}pp</td></tr>`).join('\n')}
</tbody>
</table>

<p class="lead">第 1 个周期的亏损不是买错了，是<b>卖早了</b>。策略在 2011–2013 从 2954 一路买到 2098，成本极低；但固定止盈在 12% 就开始减，到 2014 年底已经清空，而指数随后从 2400 涨到 3549。<b>最便宜的一批筹码，卖在了主升浪之前。</b></p>

<div class="note warn"><b>结构性缺陷：卖出后没有回补通道。</b>同一年（2014-11 至 2015-06），策略手上是现金，因为上一轮已结束、新一轮要等指数从新高回落 15%。它完整错过了 1500 点。<br><br>这只是“止盈阶梯”的必然后果：<b>12%/20%/28% 的阶梯限制了单批最大收益，而 A 股一轮反弹的幅度常常是 50% 以上。</b>你锁定了胜率，付出的是赔率。</div>

<h2><span class="no">06</span>卖出规则逐条拆解</h2>
<p class="lead">把每条卖出规则单独关掉，看结果怎么变。如果某条规则真的有用，关掉它应该明显变差。</p>

<table>
<thead><tr><th>版本</th><th class="n">年化</th><th class="n">最大回撤</th><th class="n">Calmar</th><th class="n">平均敞口</th><th class="n">买入次数</th></tr></thead>
<tbody>
${D.variants.map(x => `<tr><td>${x.n}</td><td class="n">${p(x.cagr)}</td><td class="n">${p(x.mdd,1)}</td><td class="n">${x.calmar.toFixed(2)}</td><td class="n">${p(x.exp,0)}</td><td class="n">${x.buys}</td></tr>`).join('\n')}
</tbody>
</table>

<div class="note"><b>读这张表的正确方式：看排序是否稳定，而不是看谁最高。</b>取消时间退出更高（${p(noTime.cagr)}），取消固定止盈也更高（${p(noTP.cagr)}），但把止盈档从 12/20/28 改成 15/25/40 反而更低（${p(tp15.cagr)}）——“放宽止盈”和“取消止盈”给出相反结论，这本身就说明差异在噪声区间。<b>不要根据这 16 年去微调止盈档位，那是过拟合。</b></div>

<div class="kv">
  <div>完成批次</div><div>${D.lotCount} 笔，胜率 ${p(D.lotWin,0)}，平均单批收益 +7.2%</div>
  <div>买入次数</div><div>${D.buys} 次（16.8 年，约每年 4.5 次）</div>
  <div>平仓原因分布</div><div>${Object.entries(D.byEx).map(([k, n]) => `${k} ${n} 笔`).join('　')}</div>
  <div>风控 30% 减仓线</div><div>${D.riskHit ? '触发于 ' + D.riskHit : '全期未触发（最大回撤 ' + p(M.strat.mdd,1) + ' < 30%）'}</div>
</div>

<h2><span class="no">07</span>滚动五年：28% 的窗口跑赢满仓</h2>
<p class="lead">全期年化跑赢满仓，可能只是因为起点选在 2010 年的高位。把起点逐月往后挪，做 ${D.roll.length} 个五年窗口：</p>

<div class="chart"><div class="hd">滚动五年：策略年化 − 沪深300 满仓年化（百分点）</div><div id="c4"></div></div>

<div class="note warn"><b>${D.roll.length} 个窗口里只有 ${(beatsBH*100).toFixed(0)}% 跑赢满仓，平均超额 ${(avgExcess*100).toFixed(1)} 个百分点。</b>全期那个 +0.8pp 的优势，主要来自 2010–2015 那一段下跌窗口。一旦五年窗口整体落在牛市里（2016–2021 起点的那些），策略稳定落后 3–6 个百分点。<br><br>这不是策略“错了”，这是它的设计目标：<b>用牛市的一部分收益，换熊市的保护。</b>但如果你的资金期限是 5 年而不是 17 年，你有 72% 的概率站在输的那一边。</div>

<h2><span class="no">08</span>年度表现</h2>
<table>
<thead><tr><th>年份</th><th class="n">策略</th><th class="n">沪深300</th><th class="n">60/40</th><th class="n">平均敞口</th></tr></thead>
<tbody>
${D.ann.map(a => `<tr><td>${a.y}</td><td class="n ${a.str>=0?'good':'bad'}">${p(a.str,1)}</td><td class="n ${a.idx>=0?'good':'bad'}">${p(a.idx,1)}</td><td class="n ${a.s60>=0?'good':'bad'}">${p(a.s60,1)}</td><td class="n">${p(a.exp,0)}</td></tr>`).join('\n')}
</tbody>
</table>
<div class="src">2010 年为首年（从 1 月 4 日起算），2026 年为不完整年度（截至 11 月 6 日）。</div>

<h2><span class="no">09</span>文档里必须补的一条规则</h2>
<p class="lead">5.2 节写“第二三笔必须比上一笔买价再跌至少 5%”。这条在<b>加仓时</b>成立，但一旦某批卖出，字面执行会出事。</p>

<table>
<thead><tr><th>入场锚点</th><th class="n">年化</th><th class="n">回撤</th><th class="n">平均敞口</th><th class="n">买入次数</th></tr></thead>
<tbody>
<tr><td>字面：始终锚定“上一笔<b>买入</b>价”</td><td class="n">${p(lastBuy.cagr)}</td><td class="n">${p(lastBuy.mdd,1)}</td><td class="n">${p(lastBuy.exp,1)}</td><td class="n">${lastBuy.buys}</td></tr>
<tr><td>修正：锚定“最近一次<b>成交</b>价（含卖出）”</td><td class="n"><b>${p(base.cagr)}</b></td><td class="n">${p(base.mdd,1)}</td><td class="n">${p(base.exp,1)}</td><td class="n">${base.buys}</td></tr>
</tbody>
</table>

<div class="note warn"><b>差 0.96 个百分点，原因很具体：</b>2018 年市场从 4400 跌到 3000，策略本该回补，但上一笔买入价是 2941，规则要求跌到 2794 才能买——<b>永远等不到</b>。2024 年同样：上一笔买在 3180，2024-09 反弹后回落到 3300 也不够低，再也没上车。<br><br><b>修法：</b>把 5.2 节的“上一笔买价”改成“最近一次成交价”，即卖出也重置基准。逻辑上这才对——你手上有现金、没有仓位，比较对象当然是最近一次实际交易的价位。</div>

<h2><span class="no">10</span>v1.2 该改什么</h2>
<table>
<thead><tr><th>优先级</th><th>改动</th><th>依据</th></tr></thead>
<tbody>
<tr><td><b>必改</b></td><td>5.2 节入场锚点改为“最近一次成交价”，卖出后重置</td><td>字面执行会锁死 2018、2024 两次回补，−0.96pp/年</td></tr>
<tr><td><b>建议</b></td><td>6.6 时间退出：3 年硬清仓改为“收益 ≤ −15% 才清”，否则延至 5 年</td><td>2014、2019 两次都在底部割肉；取消后 +${((noTime.cagr-base.cagr)*100).toFixed(2)}pp</td></tr>
<tr><td><b>建议</b></td><td>明确“卖出后回补”条款：同一周期内，价格回落到最近成交价 −5%、阶段有效、仓位于上限内，可回补</td><td>v1.1 缺这一条，导致止盈后资金在周期内闲置</td></tr>
<tr><td>观察</td><td>固定止盈 12/20/28 保留原样，不做微调</td><td>拆解结果互相矛盾，差异在噪声内；改它等于过拟合</td></tr>
<tr><td>结构</td><td>提高红利类资产比重，降低中证500增强/科创50 的机动配比</td><td>换标的 +${((hl.strat-hs.strat)*100).toFixed(1)}pp，改规则 +0.1pp</td></tr>
</tbody>
</table>

<div class="note ok"><b>一个可以立刻用的替代方案：</b>如果你能接受“每季度花五分钟调一次仓”，把 ${Math.round(D.avgExp*100)}% 权益（红利 60% ＋ 沪深300 40%）做成常数混合，每季度末调回，年化 ${p(M.match.cagr)}、回撤 ${p(M.match.mdd,1)}。它和 v1.1 的差别在统计上不可分辨，但执行成本低一个数量级。<b>v1.1 剩下的价值，是它给了你“在暴跌时敢下手”的书面授权——那是行为价值，不是收益价值。</b></div>

<h2><span class="no">11</span>这份回测不能证明什么</h2>
<ul>
<li><b>只用了沪深300 一个价格序列。</b>策略实际持有 5 类资产，红利、中证500增强、科创50 的走势差异很大；用一个指数代替全部权益，会低估分散效果，也会错配各资产的买卖点。</li>
<li><b>没有估值条件。</b>4.2 节的四维打分、4.3 节的 B≤25% 广度条件都没有数据，没有计入。真实触发会比这里更晚、更少。</li>
<li><b>没有 6.5 高估减仓。</b>需要估值分位序列，未模拟。</li>
<li><b>三个周期，样本极小。</b>所有“哪个参数更好”的结论都建立在 3 次独立事件上，不具统计显著性。这也是我建议不要微调止盈档位的原因。</li>
<li><b>起点在 2010 年高位。</b>沪深300 这 16.8 年价格只涨了 14.8%，是一个股权风险溢价接近于零甚至为负的窗口。结论对起点高度敏感——第 07 节的滚动窗口就是为此而做。</li>
<li><b>没有考虑税、申赎限制、大额赎回冲击。</b></li>
</ul>

<div class="note warn"><b>最重要的一条：</b>这份回测能证明的是“规则之间没有显著优劣”，<b>不能证明“这套策略未来能赚钱”</b>。它唯一站得住的结论是——决定你长期结果的是<b>平均持有多少权益、持有什么</b>，而不是那套买卖规则的细节。把精力从“优化规则”转到“决定敞口和标的”，收益会大得多。</div>

<footer>
数据来源：东方财富公开行情接口，沪深300（000300）与中证红利（000922）日收盘价，2010-01-04 至 2026-11-06，共 4,089 个交易日。<br>
模型假设：权益端年化分红 2.5%（红利 4.5%）减持有费 0.5%；现金年化 2.5%；单边交易成本 0.05%；季度再平衡按 63 个交易日。<br>
本报告为历史数据回测与策略验证材料，仅供参考，不构成投资建议。回测存在前视偏差、样本内过拟合、幸存者偏差与数据局限，历史结果不预示未来表现。投资有风险，决策需结合自身情况独立判断。
</footer>

</div>
<script>
const DATA = __DATA__;
const fmt = (x, d) => (x * 100).toFixed(d === undefined ? 1 : d) + '%';
const axis = { axisLine:{lineStyle:{color:'#d5d9e0'}}, axisLabel:{color:'#8492a6',fontSize:11},
  splitLine:{lineStyle:{color:'#eef0f3'}} };

// 1 净值
const c1 = echarts.init(document.getElementById('c1'));
c1.setOption({
  grid:{left:58,right:26,top:44,bottom:52},
  tooltip:{trigger:'axis', valueFormatter:v=>v.toFixed(2)},
  legend:{data:['v1.1 策略','沪深300 满仓','60/40','22% 核心','指数点位'],top:8,textStyle:{fontSize:11.5,color:'#3d4a5c'},itemWidth:16,itemHeight:2},
  xAxis:{type:'category',data:DATA.ser.d,boundaryGap:false,...axis,axisLabel:{...axis.axisLabel,formatter:v=>v.slice(0,4)}},
  yAxis:[{type:'log',min:0.6,max:2.4,...axis,axisLabel:{...axis.axisLabel,formatter:v=>v.toFixed(1)}},
         {type:'value',...axis,splitLine:{show:false},axisLabel:{...axis.axisLabel,formatter:v=>v.toFixed(0)}}],
  series:[
    {name:'v1.1 策略',type:'line',data:DATA.ser.s,symbol:'none',lineStyle:{width:2.4,color:'#b91c1c'},z:5},
    {name:'22% 核心',type:'line',data:DATA.ser.k,symbol:'none',lineStyle:{width:1.4,color:'#1e8449',type:'dashed'}},
    {name:'60/40',type:'line',data:DATA.ser.c,symbol:'none',lineStyle:{width:1.4,color:'#c9a227'}},
    {name:'沪深300 满仓',type:'line',data:DATA.ser.b,symbol:'none',lineStyle:{width:1.4,color:'#8492a6'}},
    {name:'指数点位',type:'line',yAxisIndex:1,data:DATA.ser.x,symbol:'none',lineStyle:{width:0.8,color:'#cfd6e0',type:'dotted'}}
  ]
});

// 3 逐周期
const c3 = echarts.init(document.getElementById('c3'));
c3.setOption({
  grid:{left:56,right:26,top:40,bottom:40},
  tooltip:{trigger:'axis',valueFormatter:v=>v.toFixed(1)+'%'},
  legend:{data:['策略','同区间指数'],top:6,textStyle:{fontSize:11.5,color:'#3d4a5c'},itemWidth:12,itemHeight:8},
  xAxis:{type:'category',data:DATA.cyc.map((c,i)=>'#'+(i+1)+'  '+c.start.slice(0,7)+(c.end?'':'起')),...axis},
  yAxis:{type:'value',...axis,axisLabel:{...axis.axisLabel,formatter:v=>v+'%'}},
  series:[
    {name:'策略',type:'bar',data:DATA.cyc.map(c=>+(c.str*100).toFixed(1)),barWidth:'26%',
     itemStyle:{color:p=>p.value>=0?'#1e8449':'#c0392b'}},
    {name:'同区间指数',type:'bar',data:DATA.cyc.map(c=>+(c.idx*100).toFixed(1)),barWidth:'26%',
     itemStyle:{color:'#cfd6e0'}}
  ]
});

// 4 滚动窗口
const c4 = echarts.init(document.getElementById('c4'));
c4.setOption({
  grid:{left:56,right:26,top:34,bottom:40},
  tooltip:{trigger:'axis',valueFormatter:v=>v.toFixed(1)+'pp'},
  xAxis:{type:'category',data:DATA.roll.map(r=>r.s.slice(0,7)),...axis,axisLabel:{...axis.axisLabel,interval:40}},
  yAxis:{type:'value',...axis,axisLabel:{...axis.axisLabel,formatter:v=>v+'pp'}},
  series:[{type:'bar',data:DATA.roll.map(r=>+(r.d*100).toFixed(1)),barWidth:'80%',
    itemStyle:{color:p=>p.value>=0?'#1e8449':'#c0392b'}},
    {type:'line',data:DATA.roll.map(()=>0),symbol:'none',lineStyle:{color:'#1a2332',width:1}}]
});

window.addEventListener('resize',()=>{c1.resize();c3.resize();c4.resize();});
</script>
</body>
</html>`;

const finalHtml = html.replace('__DATA__', JSON.stringify(D));
fs.writeFileSync('回测报告_卖出规则_2026-11-06.html', finalHtml);
console.log('written', (finalHtml.length / 1024).toFixed(0) + 'KB');
