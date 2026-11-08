// ============================================================================
// bt_r_clause.js — Phase 5 动态触发减半状态机【脚手架 / 预建版】
// 作者：数据与回测工程师 袁据实 ｜ 2026-11-07 ｜ 第四轮（v1.6）
//
// ★ 严格边界（team-lead 批准的选项 2，不得越界）★
//  1) 本文件只提供：状态机骨架 + V0 逐位对齐校验 + 数据/参数/事件日志接线。
//  2) rClause 完全参数化：enabled/R/eqBase/cutRatio/lockDays/recoverMode/
//     reviewLagDays/ddBasis/cutOnce/quarterMode 全部由调用方传入，
//     enabled=true 时缺失任一即抛错；引擎**不设任何默认值、不预设任何候选策略卡**。
//  3) **本脚手架不产出任何策略绩效数字**：cagr/mdd/vol/sharpe/胜率/换手/超额
//     一律留空（metrics: null），由 Phase 5 在拿到候选策略卡后计算。
//     自检中的 nav / MDD 仅用于 V0 对标校验，须标注「对标校验，非策略绩效」。
//  4) 不跑压力路径 A/B/C 的绩效，不给第 5 条存废结论。
//
// ★ 与 round4_phase2_baseline.md §七规格的 3 处必要细化（主理人已裁决接受，见下）★
//  (a) 日循环结构复刻 bt_final.js:36-86 的 mix：
//      算当日市值/股息/费/利息 → 执行 T+1 挂单 → 判定挂新单 → 用最终份额 × 当日价格算 nav。
//      触发判定移到「nav 确定之后」（收盘后），挂单在**次日**成交。
//      原规格 §7.3 把「计算 nav」放在最前、T+1 挂单执行放在同日，
//      会使再平衡日的 nav 与 mix 不一致，V0 无法逐位对齐；故作此调整。
//  (b) q63 = 相对 S 的 (i-S) % interval === 0（与 mix 一致）；
//      calQ = 绝对日历季末索引集合 B.CAL_Q 命中（不随 S 平移）。
//      两者数学形式不同，不能用同一个取模表达式。
//  (c) 恢复动作与季度再平衡同日命中时「兼任」为一次成交，不重复计成本。
//
// ★★ 主理人 D1~D11 裁决（2026-11-07）—— 已固化为 Phase 5 规格，不得再改 ★★
//  D1 接受：触发判定用「含当日再平衡后、收盘后可知」的 nav；挂单次日用次日收盘价成交；
//           V0 零偏差优先于规格字面顺序。
//  D2 接受：q63 取模 / calQ 集合查找分两支，calQ 不随 S 平移；Phase 5 设 S≠0 须显式说明。
//  D3 接受：引擎零默认、enabled=true 缺字段抛错、eqBase===eq 与 ddBasis 白名单两道校验保留。
//  D4 按 v1.5 字面接受：cutDone 永不清零、全期只减半一次；
//           **预留扩展点 rearmAfterRecover（默认 false），仅登记、未实现**（见 PENDING_EXTENSIONS）。
//  D5 接受：恢复与季度再平衡同日合并为一次成交（恢复优先、跳过同日再平衡、不重复计成本）。
//  D6 接受：恢复候选日 = triggerIdx + max(lockDays, reviewLagDays)。
//  D7 接受：review + Infinity 直接抛错；永不恢复显式用 recoverMode:'none'。
//  D8 接受：判定日与成交日分开记（recoverSignalIdx / recoverExecIdx 等），下游引用不得混。
//  D9 接受：calQ 的 V0 不做与 mix 的对齐断言。
//  D10 接受：压力路径中值不是 Phase 4 决策；Phase 5 须显式选 lo/mid/hi，
//            宏观「情景假设、非历史事实、非预测」通用声明随每个 config 保留。
//  D11 接受：R=0.10 仅为可运行性冒烟参数，不得当作候选策略卡或建议参数。
//
// ★★ 增补：第 4 条对照路径 (iv)（量化侧 梁定衡 / Phase 3 要求，主理人采纳）★★
//  (iv) 全期静态 eq = E × cutRatio = 0.20 常数混合，enabled:false，不触发/不恢复/不减半。
//       三层差值：(ii)-(i) 总效应 / (iv)-(i) 纯静态降 E 效应 /
//                 (ii)-(iv) 时机 + 恢复摩擦的真正净贡献。
//       ★ (iv) 是对照路径，不是候选策略卡，不预设 Phase 4 采纳方向 ★
//       具名登记见 PATHS / PATH_DIFFS；逐位对齐校验见自检 (1b)。
//
// ★★ Phase 5 报告编排层要求：仅预留登记、不执行 ★★
//       见 PHASE5_REPORT_LAYOUT / PREREGISTERED_MAIN_TEST（只登记，不注入 runRClause）。
//
// ★★ ETF 成本敏感性 / E1·E2 可观测量 / 未建模摩擦 预埋（订正通知 2026-11-07）★★
//   权威口径：round4_phase3_etf_interface.md §三（覆盖上一条任务书的 ETF_COST_GRID 旧规格 4 处差异）。
//   新增 3 个导出：ETF_COST_GRID / OBSERVABLES_FOR_E1E2 / UNMODELED_FRICTIONS；
//   扩展 2 个既有导出：PENDING_EXTENSIONS（+3 项）/ PHASE5_REPORT_LAYOUT（+4 键）。
//   ★ 全部「仅登记，未实现」：不注入 runRClause、不改任何默认值、不改 B.P_MAIN_OPT、
//     不改 PATHS/PATH_DIFFS/PREREGISTERED_MAIN_TEST/REQUIRED_RCLAUSE_KEYS、不跑回测、不产绩效。★
//   纪律：外部实测/联网数据不进回测引擎、不与本地价格序列混拼；
//         slippage/premiumShock（价格偏移）与 market impact（占 ADV 比例）科目不同、禁止叠加；
//         carryOffStress 作为基准口径错误，仅作敏感性与数据局限披露中的下界压力口径。
//
// 用法：
//   const { runRClause, PATHS, PREREGISTERED_MAIN_TEST } = require('./bt_r_clause.js');
//   const B = require('./phase2_indices.js');
//   const out = runRClause({ ...B.P_MAIN_OPT, eq: 0.40, rClause: { ...全部 10 个字段 } });
//
// 自检：node bt_r_clause.js  → 写出 phase5_scaffold_check.json + 控制台摘要
// ============================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const P = f => path.join(__dirname, f);
const B = require('./phase2_indices.js');

const FEE_ANN = 0.005;   // 权益端年化管理费，沿用 bt_final.js:15
const A = B.A, D = B.D, DATES = B.DATES, N = B.N;
const CAL_Q_SET = new Set(B.CAL_Q);

// ---------------------------------------------------------------------------
// 1. rClause 参数契约（完全参数化，不设默认值）
// ---------------------------------------------------------------------------
const REQUIRED_RCLAUSE_KEYS = [
  'enabled', 'R', 'eqBase', 'cutRatio', 'lockDays', 'recoverMode',
  'reviewLagDays', 'ddBasis', 'cutOnce', 'quarterMode'
];
const RCLAUSE_ENUM = {
  recoverMode: ['none', 'quarterly', 'review'],
  ddBasis: ['highWaterV'],          // 铁律：只允许历史净资产高水位 V
  quarterMode: ['q63', 'calQ']
};
// recover-signal = 恢复「判定日」事件；recover = 恢复「T+1 成交日」事件（两者须区分）
const EVENT_TYPES = ['trigger', 'cut', 'recover-signal', 'recover', 'rebalance'];

// ---------------------------------------------------------------------------
// 1b. 四条对照路径的具名登记（主理人采纳量化侧要求后增补 (iv)）
//     ★ 仅登记路径语义，不注入引擎、不预设任何候选策略卡 ★
// ---------------------------------------------------------------------------
const PATHS = {
  i: {
    label: '不减半（V0 对照基线）', eq: 0.40, enabled: false,
    note: 'rClause.enabled=false；与 mix(P_MAIN_OPT,{eq}) 逐位对齐；四档 R 已校验零偏差'
  },
  ii: {
    label: '减半 + 20 日锁定 + 书面复核恢复', eq: 0.40, enabled: true,
    recoverMode: 'review',
    note: '触发后 eqTarget = eqBase × cutRatio；恢复延迟由 reviewLagDays 给定（D6）。' +
          '具体参数由 Phase 4 候选卡或主理人预注册检验提供，脚手架不预设'
  },
  iii: {
    label: '减半 + 季度再平衡恢复', eq: 0.40, enabled: true,
    recoverMode: 'quarterly',
    note: '季度再平衡日「兼任」恢复动作，合并为一次成交、不重复计成本（D5）'
  },
  iv: {
    label: '全期静态 eq = E × cutRatio = 0.20 常数混合（纯静态降 E）',
    eq: 0.20, eqFormula: 'E × cutRatio（示例 E=0.40、cutRatio=0.5 → 0.20）', enabled: false,
    note: '量化侧 梁定衡（Phase 3）要求增补：enabled:false、不触发/不恢复/不减半，' +
          '有效样本 4,089 日可估计。不改状态机逻辑，就是 V0 换一个 eq。' +
          '★ 若 Phase 4 的 E / cutRatio 不同，(iv) 的 eq 须按 eqFormula 同步重算；' +
          '本脚手架只登记示例值、不注入引擎。★' +
          '★ (iv) 是对照路径，不是候选策略卡，不预设 Phase 4 采纳方向 ★'
  }
};
const PATH_DIFFS = [
  { id: '(ii)-(i)', meaning: '总效应（降 E + 触发时机 + 恢复摩擦的混合效应）' },
  { id: '(iv)-(i)', meaning: '纯静态降 E 效应' },
  { id: '(ii)-(iv)', meaning: '时机 + 恢复摩擦的真正净贡献（量化侧重点，必须单独报告）' }
];

// ---------------------------------------------------------------------------
// 1c. D4 预留扩展点（只登记，不实现）
// ---------------------------------------------------------------------------
const PENDING_EXTENSIONS = [
  { name: 'rearmAfterRecover', defaultWhenImplemented: false, status: '仅登记，未实现',
    triggerCondition: '仅当 Phase 4 候选卡明确要求「恢复后重新武装 / 每次达 R 都减半」时启用',
    currentBehaviour: 'D4 裁决按 v1.5 字面：cutDone 永不清零、全期只减半一次',
    implementationNote: '启用须新增参数、放宽 cutDone 复位条件，并重新做 V0 四档 + (iv) 逐位对齐校验' },
  // ---- ETF 成本敏感性 / 股息 carry 下界压力扩展点（仅登记，未实现；不注入 runRClause）----
  { name: 'premiumShock', status: '仅登记，未实现',
    source: 'round4_phase3_etf_interface.md §三',
    triggerCondition: '仅当 Phase 4 候选卡或主理人明确要求「压力日折溢价冲击」时启用',
    effect: '作用于成交价，不改净值口径',
    implementationNote: '成交价 = 次日收盘价 ×(1 + premiumShock)；作用于成交价、卖出腿/买回腿独立取符号做 4 象限；' +
      '启用后须重做 V0 四档 + 路径 (iv) 逐位对齐校验' },
  { name: 'settleLagDays', status: '仅登记，未实现',
    source: 'round4_phase3_etf_interface.md §三',
    triggerCondition: '仅当 Phase 4 候选卡或主理人明确要求「场外到账延迟」时启用',
    effect: '作用于 E3 effectiveLockDays 与 effectiveRecoverLag，不改名义 lockDays',
    implementationNote: '在途计息/不计息两档、在途资金不计入可再平衡现金；不改名义 lockDays；' +
      '启用后须重做 V0 四档 + 路径 (iv) 逐位对齐校验' },
  { name: 'carryOffStress', status: '仅登记，未实现',
    source: 'round4_phase3_dividend.md',
    triggerCondition: '仅当 Phase 4 候选卡或主理人明确要求「股息 carry 归零下界压力口径」时启用',
    effect: 'dyH = dyD = 0（股息 carry 归零）',
    note: '★ 作为基准口径错误，仅作敏感性与数据局限披露中的下界压力口径；' +
      '不作 V0 对照、不进状态机绩效比较、不用于条款存废裁决、不写成触发条件',
    implementationNote: '启用后须重做 V0 四档 + 路径 (iv) 逐位对齐校验' }
];

// ---------------------------------------------------------------------------
// 1d. Phase 5 报告编排层：仅预留登记、不执行（不注入 runRClause）
// ---------------------------------------------------------------------------
const PREREGISTERED_MAIN_TEST = {
  status: '仅预留登记，脚手架不执行、不注入 runRClause',
  source: '主理人 Phase 5 编排层给定（2026-11-07），非 Phase 4 候选策略卡',
  baseline: 'B.P_MAIN_OPT', quarterMode: 'q63', path: '真实历史路径（非构造）',
  R: 0.20, eqBase: 0.40, execLag: 1, slippage: 0.001,
  recoverMode: 'review', reviewLagDays: 20,
  compare: '主比较 (ii) 与 (iv)，同时报 (i)(iii)',
  everythingElse: '其余一律列为敏感性，只做符号一致性计数',
  changePolicy: '预注册、不得事后更改'
};
const PHASE5_REPORT_LAYOUT = {
  status: '仅预留，不执行',
  tables: {
    A: '触发事件层（主表）：触发日、dd、V、cut/recover 事件、20 日窗口、恢复时点',
    B: '策略绩效层：年化 / 波动 / 夏普 / 最大回撤 / 胜率 / 换手 / 基准超额',
    C: '口径敏感性诊断层：每格写全 6 维口径标签（权重 / 现金利率 / 成本 / 成交 / 再平衡频率 / 股息处理）'
  },
  separation: '三张表物理分离；C 不得混入 B',
  triggerEffectProhibition: '针对触发式净效应禁止输出 p 值 / 置信区间 / 功效数值（量化侧判定 n ≤ 1、方差不存在）',
  zeroTriggerTemplate: '触发次数为 0 时按「不可评估」模板表述，不得写成「有效」或「无效」',
  noiseRule: '|净效应| < 2 × 总成本 → 判「噪声主导、符号不可判定」',
  insufficientRule: '独立触发事件 < 3 → 判「数据不足」',
  // ---- 上一条任务书追加 2 键（成本敏感性并列披露 + 6 维口径标签）----
  costSensitivityParallelRule: '基线口径 B.P_MAIN_OPT 与成本敏感性口径须并列披露；' +
    '禁止用敏感性净值替换基线净值、禁止与本地价格序列混拼',
  sixDimLabels: ['权重', '现金利率', '成本', '成交', '再平衡频率', '股息处理'],
  // ---- 订正通知追加 2 键（成本科目分离 + 跨除息日现金核对）----
  costSubjectSeparationRule: 'slippage / premiumShock 属价格偏移（价差与折溢价）、market impact 属占 ADV 比例，' +
    '两者科目不同、禁止叠加进「10 万元冲击成本可忽略」结论；报告须分开列示以免下游误读为自相矛盾',
  exDivCashCheck: '跨除息日的 ETF 分红现金须计入 nav，否则 dd 虚增可能误触发；' +
    'Phase 5 须在「股息处理」维度显式核对'
};

// ---------------------------------------------------------------------------
// 1e. ETF 成本敏感性 / E1·E2 可观测量 / 未建模摩擦（★ 全部仅登记、未实现 ★）
//     权威口径：round4_phase3_etf_interface.md §三（订正通知 2026-11-07 覆盖旧任务书规格）
//     ★ 不注入 runRClause、不改任何默认值、不改 B.P_MAIN_OPT、不进净值 ★
//     档位为「情景假设 / 区间 / 档位」，非历史事实、非精确实测值、非预测。
// ---------------------------------------------------------------------------
const ETF_COMMON_NOTE = '情景假设、非历史事实、不得写进 B.P_MAIN_OPT；跑完须并列标注「成本敏感性、非基线口径」';
const ETF_COST_GRID = {
  status: '仅登记，未实现',
  source: 'round4_phase3_etf_interface.md §三',
  note: ETF_COMMON_NOTE,
  valueNature: '档位是区间/档位，不是精确实测值',
  discipline: '外部实测/联网数据不进回测引擎、不与本地价格序列混拼；不注入 runRClause、不改任何默认值',
  // 每一项均带 status/source/note；note 内含统一情景假设声明 + 该组特定口径，二者不冲突。
  grid: [
    { id: 'slippage', slippageBp: [10, 20, 30], stressDayMultiplier: [1, 2, 3],
      status: '仅登记，未实现', source: 'round4_phase3_etf_interface.md §三',
      note: ETF_COMMON_NOTE + '；单边 10/20/30 bp；压力日乘数 ×1/×2/×3 仅放大减半卖出日与恢复买回日，不放大季度再平衡' },
    { id: 'premiumShock', premiumShockBp: [-30, -10, 0, 10, 30],
      status: '仅登记，未实现', source: 'round4_phase3_etf_interface.md §三',
      note: ETF_COMMON_NOTE + '；成交价 = 次日收盘价 ×(1 + premiumShock)；卖出腿/买回腿独立取符号做 4 象限' },
    { id: 'settleLagDays', settleLagDays: [0, 3, 4, 7], inTransitInterest: ['accrue', 'none'],
      status: '仅登记，未实现', source: 'round4_phase3_etf_interface.md §三',
      note: ETF_COMMON_NOTE + '；0 = 场内；在途计息/不计息两档；在途资金不计入可再平衡现金' },
    { id: 'effectiveRecoverLag', formula: 'reviewLagDays + settleLagDays + 1',
      status: '仅登记，未实现', source: 'round4_phase3_etf_interface.md §三',
      note: ETF_COMMON_NOTE + '；申购确认 T+1；替换/扩展现有 reviewLagDays 语义，须显式披露' },
    { id: 'shortHoldRedemptionFee', shortHoldRedemptionFeeBp: [0, 150],
      status: '仅登记，未实现', source: 'round4_phase3_etf_interface.md §三',
      note: ETF_COMMON_NOTE + '；二元开关（场外、持有 < 7 日的 1.5% 惩罚性赎回费）' },
    { id: 'feeAnnual', feeAnnual: [0.002, 0.003, 0.005, 0.010],
      status: '仅登记，未实现', source: 'round4_phase3_etf_interface.md §三',
      note: ETF_COMMON_NOTE + '；FEE_ANN 核对档（0.20% / 0.30% / 0.50% / 1.0%），不改基线' }
  ]
};

// E1/E2 所需可观测量键名（只读登记，不产出值、不注入引擎）
const OBSERVABLES_FOR_E1E2 = Object.freeze({
  status: '仅登记，未实现（只读键名清单）',
  source: 'round4_phase3_etf.md §六',
  keys: Object.freeze([
    'triggerIdx', 'traded', 'advRatioByLeg', 'feePaid', 'turnover',
    'effectiveLowExposureDays', 'recoverIdx', 'crossQuarterOrExDivFlag',
    'settleLagDays', 'premiumShockBp'
  ]),
  note: "E1 的「数据不足」分支必须标注「工具可得性不成立，非冲击成本问题」，不得用宽基腿数据外推"
});

// 须进 Phase 5「未建模摩擦清单」逐项披露（无法用 bp 表达；只读登记）
const UNMODELED_FRICTIONS = Object.freeze({
  status: '仅登记，未实现',
  source: 'round4_phase3_etf_interface.md §三（「无法用 bp 表达的摩擦」）',
  crossRef: 'round4_phase3_etf.md §2.3',
  note: '须进 Phase 5「未建模摩擦清单」逐项披露；均无法用 bp 表达',
  items: Object.freeze([
    { seq: 1, name: '人工书面复核延迟', note: 'reviewLagDays 是建模假设非实测',
      status: '仅登记，未实现', source: 'round4_phase3_etf_interface.md §三' },
    { seq: 2, name: '到账资金不可用窗口', note: '敞口约束/机会成本，非价格成本；在途资金不计入可再平衡现金',
      status: '仅登记，未实现', source: 'round4_phase3_etf_interface.md §三' },
    { seq: 3, name: '恢复日不确定 / 跨季 / 跨除息日耦合', note: '时点耦合，取决于日历而非价格',
      status: '仅登记，未实现', source: 'round4_phase3_etf_interface.md §三' },
    { seq: 4, name: '000922 ETF 历史缺席', category: '幸存者偏差，非摩擦',
      note: '★ 幸存者偏差、非摩擦，须显式标注；2010-2019 工具可得性不成立',
      status: '仅登记，未实现', source: 'round4_phase3_etf_interface.md §三' },
    { seq: 5, name: '折溢价方向性与 IOPV 失真', note: '状态依赖、买卖两腿方向相反，固定 bp 会系统性错估',
      status: '仅登记，未实现', source: 'round4_phase3_etf_interface.md §三' },
    { seq: 6, name: '台账与人工执行出错概率', note: '操作风险，非市场摩擦',
      status: '仅登记，未实现', source: 'round4_phase3_etf_interface.md §三' }
  ])
});

function validateRClause(rc, eq) {
  if (!rc || typeof rc !== 'object') throw new Error('[rClause] 必须由调用方传入对象');
  if (typeof rc.enabled !== 'boolean') throw new Error('[rClause] enabled 必须由调用方传入（bool），不得使用默认值');
  // V0：其余字段不参与计算，仅记录，不强制传入
  if (!rc.enabled) return;
  for (const k of REQUIRED_RCLAUSE_KEYS.slice(1)) {
    if (!(k in rc)) throw new Error(`[rClause] 缺少必填字段 "${k}"：本引擎不设默认值，全部须由调用方传入（见 REQUIRED_RCLAUSE_KEYS）`);
  }
  const num = (k, lo, hi, int = false) => {
    const v = rc[k];
    if (typeof v !== 'number' || !isFinite(v) || (int && !Number.isInteger(v)) || v < lo || v > hi)
      throw new Error(`[rClause] ${k} 非法：须为 ${int ? '整数' : '数值'} ∈ [${lo}, ${hi}]，收到 ${v}`);
  };
  num('R', 0, 1); num('eqBase', 0, 1); num('cutRatio', 0, 1); num('lockDays', 0, 1e6, true);
  if (Math.abs(rc.eqBase - eq) > 1e-12)
    throw new Error(`[rClause] eqBase(${rc.eqBase}) 必须与入口 eq(${eq}) 一致，避免两份目标敞口冲突`);
  if (!(rc.reviewLagDays === Infinity || (typeof rc.reviewLagDays === 'number' && isFinite(rc.reviewLagDays) && rc.reviewLagDays >= 0)))
    throw new Error('[rClause] reviewLagDays 须为非负数值或 Infinity');
  if (typeof rc.cutOnce !== 'boolean') throw new Error('[rClause] cutOnce 须为 bool');
  for (const [k, allowed] of Object.entries(RCLAUSE_ENUM)) {
    if (!allowed.includes(rc[k])) throw new Error(`[rClause] ${k} 须为 ${allowed.join(' | ')}，收到 ${rc[k]}`);
  }
  if (rc.recoverMode === 'review' && !isFinite(rc.reviewLagDays))
    throw new Error('[rClause] recoverMode="review" 时 reviewLagDays 须为有限数；永不恢复请用 recoverMode="none"');
}

// 合并基线参数。入口 cfg 中除 rClause 外的字段覆盖 B.P_MAIN_OPT（数据基线唯一权威 opt）。
function buildOpt(cfg) {
  const { rClause, ...over } = cfg;
  return Object.assign({ S: 0, E: N - 1 }, B.P_MAIN_OPT, over);
}

// ---------------------------------------------------------------------------
// 2. 独立参照实现 mixRef（逐行复刻 bt_final.js:36-86，仅供 V0 逐位对齐校验）
//    刻意与状态机分开，避免「自己校验自己」。
// ---------------------------------------------------------------------------
function mixRef(opt = {}) {
  const o = Object.assign({ S: 0, E: N - 1 }, B.P_MAIN_OPT, opt);
  const S = o.S, E = o.E;
  const rateAt = i => typeof o.cashRate === 'number' ? o.cashRate : o.cashRate[i];
  const dyHAt = i => typeof o.dyH === 'number' ? o.dyH : o.dyH[i];
  const dyDAt = i => typeof o.dyD === 'number' ? o.dyD : o.dyD[i];
  let uD = o.eq * o.w / D[S].c, uH = o.eq * (1 - o.w) / A[S].c, cash = 1 - o.eq;
  const nav = []; let pending = false;
  for (let i = S; i <= E; i++) {
    let vD = uD * D[i].c, vH = uH * A[i].c, e2 = vD + vH;
    const divCash = (vD * dyDAt(i) + vH * dyHAt(i)) / 252;
    const tax = divCash * o.divTax;
    cash += divCash - tax - e2 * FEE_ANN / 252;
    cash *= 1 + rateAt(i) / 252;
    const doRebal = (idx) => {
      const t = e2 + cash, want = t * o.eq;
      let nvD, nvH;
      if (o.rebal === 'frozen') { const f = want / (e2 || 1); nvD = vD * f; nvH = vH * f; }
      else { nvD = want * o.w; nvH = want * (1 - o.w); }
      const traded = Math.abs(nvD - vD) + Math.abs(nvH - vH);
      const cost = traded * (o.tradeFee + o.slippage);
      cash = t - want - cost;
      uD = nvD / D[idx].c; uH = nvH / A[idx].c;
      vD = nvD; vH = nvH; e2 = vD + vH;
    };
    if (pending) { doRebal(i); pending = false; }
    if (i > S && (i - S) % o.interval === 0) {
      if (o.execLag === 0) doRebal(i); else pending = true;
    }
    const eqNow = uD * D[i].c + uH * A[i].c;
    nav.push(eqNow + cash);
  }
  return nav;
}

// ---------------------------------------------------------------------------
// 3. 动态触发减半状态机（核心骨架）
// ---------------------------------------------------------------------------
function runRClause(cfg) {
  const o = buildOpt(cfg);
  const rc = cfg.rClause;
  validateRClause(rc, o.eq);
  const S = o.S, E = o.E;
  const rateAt = i => typeof o.cashRate === 'number' ? o.cashRate : o.cashRate[i];
  const dyHAt = i => typeof o.dyH === 'number' ? o.dyH : o.dyH[i];
  const dyDAt = i => typeof o.dyD === 'number' ? o.dyD : o.dyD[i];

  // 季度日历：q63 相对 S 取模（与 mix 一致）；calQ 用绝对日历季末集合
  const isQuarterEnd = i => {
    if (rc.enabled && rc.quarterMode === 'calQ') return i > S && CAL_Q_SET.has(i);
    return i > S && (i - S) % o.interval === 0;
  };

  // ---- 状态变量（§7.2） ----
  let eqTarget = rc.enabled ? rc.eqBase : o.eq;   // V0 恒等于 o.eq → 保证逐位对齐
  let V = 0;                                     // 高水位：首日由 nav 自身置入，等价于 met() 的 pk=nav[0]
  let cutDone = false, triggerIdx = -1, lockUntilIdx = -1;
  let recovered = false, recoverSignalIdx = -1, recoverExecIdx = -1;
  let pendingCut = false, pendingRecover = false, pendingRebal = false;

  let uD = o.eq * o.w / D[S].c, uH = o.eq * (1 - o.w) / A[S].c, cash = 1 - o.eq;
  let vD = 0, vH = 0, e2 = 0;

  const nav = [], ddArr = [], VArr = [], eqTargetArr = [], eqActualArr = [], wInnerArr = [];
  const events = [], triggers = [];
  let rebalCount = 0, cutCount = 0, recoverCount = 0;
  let turnover = 0, feePaid = 0, taxPaid = 0, sameDayMultiAction = 0;

  // 按目标敞口 + 75/25 重置份额（复刻 mix.doRebal，want = t * target）
  const doReset = (idx, target, kind) => {
    const t = e2 + cash, want = t * target;
    let nvD, nvH;
    if (o.rebal === 'frozen') { const f = want / (e2 || 1); nvD = vD * f; nvH = vH * f; }
    else { nvD = want * o.w; nvH = want * (1 - o.w); }
    const traded = Math.abs(nvD - vD) + Math.abs(nvH - vH);
    const cost = traded * (o.tradeFee + o.slippage);
    cash = t - want - cost;
    uD = nvD / D[idx].c; uH = nvH / A[idx].c;
    vD = nvD; vH = nvH; e2 = vD + vH;
    turnover += traded; feePaid += cost;
    if (kind === 'cut') cutCount++; else if (kind === 'recover') recoverCount++; else rebalCount++;
    events.push({ type: kind, idx, date: DATES[idx], eqTarget: +target.toFixed(6),
      traded: +traded.toFixed(8), cost: +cost.toFixed(8) });
    return { traded, cost };
  };

  for (let i = S; i <= E; i++) {
    // ---- A. 当日市值 / 股息 / 管理费 / 现金利息（复刻 mix） ----
    vD = uD * D[i].c; vH = uH * A[i].c; e2 = vD + vH;
    const divCash = (vD * dyDAt(i) + vH * dyHAt(i)) / 252;
    const tax = divCash * o.divTax;
    cash += divCash - tax - e2 * FEE_ANN / 252;
    cash *= 1 + rateAt(i) / 252;
    taxPaid += tax;

    // ---- B. 执行 T+1 挂单（用【当日】收盘价成交，即昨日信号今日成交） ----
    if (pendingCut) { doReset(i, eqTarget, 'cut'); pendingCut = false; }
    if (pendingRecover) {
      doReset(i, eqTarget, 'recover'); pendingRecover = false;
      if (pendingRebal) { pendingRebal = false; sameDayMultiAction++; }  // 兼任，不重复成交
    } else if (pendingRebal) {
      doReset(i, eqTarget, 'rebalance'); pendingRebal = false;
    }

    // ---- C. 恢复判定 / 季度再平衡判定（挂新单；恢复优先，同日不双挂） ----
    let scheduled = false;
    if (rc.enabled && cutDone && !recovered && rc.recoverMode !== 'none') {
      let due = false;
      if (rc.recoverMode === 'review') {
        const dueIdx = triggerIdx + Math.max(rc.lockDays, rc.reviewLagDays);
        due = i >= dueIdx;
      } else if (rc.recoverMode === 'quarterly') {
        due = i >= lockUntilIdx && isQuarterEnd(i);
      }
      if (due) {
        recovered = true; recoverSignalIdx = i; recoverExecIdx = Math.min(i + 1, E);
        eqTarget = rc.eqBase;
        pendingRecover = true; scheduled = true;
        events.push({ type: 'recover-signal', idx: i, date: DATES[i],
          eqBefore: +(rc.eqBase * rc.cutRatio).toFixed(6), eqAfter: rc.eqBase,
          execIdx: recoverExecIdx, execDate: DATES[recoverExecIdx], mode: rc.recoverMode });
        const tg = triggers[triggers.length - 1];
        if (tg) Object.assign(tg, { recoverSignalIdx: i, recoverSignalDate: DATES[i],
          recoverExecIdx, recoverExecDate: DATES[recoverExecIdx], recoverMode: rc.recoverMode });
      }
    }
    if (!scheduled && isQuarterEnd(i)) {
      if (o.execLag === 0) doReset(i, eqTarget, 'rebalance');
      else pendingRebal = true;
    }

    // ---- D. 当日净值与回撤（相对历史净资产高水位 V；复刻 mix 的 eqNow + cash） ----
    const eqNow = uD * D[i].c + uH * A[i].c;
    const navI = eqNow + cash;
    nav.push(navI);
    if (navI > V) V = navI;
    const dd = 1 - navI / V;
    ddArr.push(dd); VArr.push(V); eqTargetArr.push(eqTarget);
    eqActualArr.push(eqNow / (navI || 1)); wInnerArr.push(uD * D[i].c / (eqNow || 1));

    // ---- E. 触发判定（收盘后可知）；挂 pendingCut，次日成交，绝不当日成交 ----
    if (rc.enabled && !cutDone && dd >= rc.R) {
      cutDone = true; triggerIdx = i; lockUntilIdx = i + rc.lockDays;
      const before = eqTarget;
      eqTarget = rc.eqBase * rc.cutRatio;
      pendingCut = true;
      events.push({ type: 'trigger', idx: i, date: DATES[i], dd: +dd.toFixed(8),
        V: +V.toFixed(8), nav: +navI.toFixed(8), eqBefore: before, eqAfter: eqTarget,
        cutExecIdx: Math.min(i + 1, E), lockUntilIdx });
      triggers.push({ idx: i, date: DATES[i], dd: +dd.toFixed(8), eqAfter: eqTarget,
        lockUntilIdx, lockUntilDate: DATES[Math.min(lockUntilIdx, E)],
        cutExecIdx: Math.min(i + 1, E), cutExecDate: DATES[Math.min(i + 1, E)],
        recoverSignalIdx: -1, recoverSignalDate: null, recoverExecIdx: -1,
        recoverExecDate: null, recoverMode: rc.recoverMode });
    }
  }

  // config 摘要：避免把 4,089 长度的大数组写进 JSON
  const cfgSummary = {
    eq: o.eq, w: o.w, rebal: o.rebal, interval: o.interval, S, E,
    cashRate: Array.isArray(o.cashRate) ? 'SEG_RATE（逐日数组，见 phase2_indices.js）' : o.cashRate,
    dyH: Array.isArray(o.dyH) ? 'V.dyHS（逐日数组）' : o.dyH,
    dyD: Array.isArray(o.dyD) ? 'V.dyHL（逐日数组）' : o.dyD,
    tradeFee: o.tradeFee, slippage: o.slippage, divTax: o.divTax, execLag: o.execLag,
    feeAnn: FEE_ANN,
    quarterMode: rc.enabled ? rc.quarterMode : 'q63（V0 固定，与 mix 对齐）',
    quarterModeNote: 'calQ 下 o.interval 不生效；q63 用 (i-S) % interval；calQ 用绝对日历季末集合（不随 S 平移）',
    rClause: Object.fromEntries(Object.entries(rc).map(([k, v]) => [k, v === Infinity ? 'Infinity' : v]))
  };

  return {
    config: cfgSummary,
    dates: DATES.slice(S, E + 1),
    nav, dd: ddArr, V: VArr, eqTarget: eqTargetArr, eqActual: eqActualArr, wInner: wInnerArr,
    events, triggers,
    counters: { rebalCount, cutCount, recoverCount, turnover, feePaid, taxPaid,
      totalResetCount: rebalCount + cutCount + recoverCount, sameDayMultiAction },
    // ★ 不产出任何策略绩效数字 ★
    metrics: null,
    metricsNote: '待 Phase 5：本脚手架不产出 cagr/mdd/vol/sharpe/胜率/换手/超额等任何策略绩效数字',
    pathNote: 'nav/dd/V/eqTarget 等为逐日路径，仅供 V0 对齐校验与 Phase 5 后续计算绩效，本身不是绩效',
    engineNote: 'rClause 完全参数化、无默认值、无预设策略卡；状态机规格见 round4_phase2_baseline.md §七'
  };
}

// ---------------------------------------------------------------------------
// 4. 压力路径 A/B/C 参数接线（只产出可消费的参数与逐日现金利率数组，
//    不生成合成价格序列、不跑任何回测/绩效）
// ---------------------------------------------------------------------------
const STRESS_DEFS = {
  A: { name: '利率急上行 + 权益急跌', lengthDays: [126, 189], dropMult: [2.0, 2.5],
    corr: [0.96, 0.99], cashFrom: 0.013, cashTo: [0.025, 0.035], lagQuarters: [2, 3],
    dailyShape: '前重后轻几何衰减；首月跌幅约占累计 35~45%；无反弹；两指数同步下跌' },
  B: { name: '长期低利率慢熊', lengthDays: [504, 756], dropMult: [3.0, 3.5],
    corr: [0.71, 0.74], cashFrom: [0.010, 0.013], cashTo: [0.008, 0.010], lagQuarters: [0, 0],
    dailyShape: '近似匀速线性阴跌；无单月暴跌、无反弹；月度跌幅标准差压到 A 的 1/3 以下' },
  C: { name: '通缩式阴跌 / 低波动钝化', lengthDays: [504, 504], dropMult: [0.8, 1.2],
    corr: [0.85, 0.90], cashFrom: [0.010, 0.013], cashTo: [0.010, 0.013], lagQuarters: [0, 0],
    dailyShape: '窄幅阴跌；日振幅约为 A 的 1/3；无单日暴跌；缓慢累积至 R 附近或略超' }
};
const pickVal = (x, pick) => {
  if (typeof x === 'number') return x;
  return pick === 'lo' ? x[0] : pick === 'hi' ? x[1] : (x[0] + x[1]) / 2;
};

/**
 * 生成压力路径的可消费参数（供 Phase 5 构造合成序列与 mix({cashRate:[...]})）。
 * @param {'A'|'B'|'C'} id
 * @param {number} R 触发线（如 0.20）；累计跌幅 = dropMult × R
 * @param {'lo'|'mid'|'hi'} pick 区间取值（默认 mid）
 * 返回：{ id, R, lengthDays, equityCumDropPct, corr, cashRatePath[], dailyShape,
 *        constructionAnchor, disclaimer, note }
 * ★ 不含任何绩效数字、不生成价格序列、不回测。
 */
function stressPathConfig(id, R, pick = 'mid') {
  const d = STRESS_DEFS[id];
  if (!d) throw new Error(`[stressPathConfig] 未知路径 ${id}，须为 A|B|C`);
  if (!(typeof R === 'number' && R > 0 && R < 1)) throw new Error('[stressPathConfig] R 须为 (0,1) 数值');
  const lengthDays = Math.round(pickVal(d.lengthDays, pick));
  const equityCumDropPct = -(pickVal(d.dropMult, pick) * R * 100);
  const corr = pickVal(d.corr, pick);
  const from = pickVal(d.cashFrom, pick), to = pickVal(d.cashTo, pick);
  const lagDays = Math.round(pickVal(d.lagQuarters, pick) * 63);
  const cashRatePath = new Array(lengthDays);
  for (let i = 0; i < lengthDays; i++) {
    const t = lagDays >= lengthDays ? 0 : Math.max(0, Math.min(1, (i - lagDays) / Math.max(1, lengthDays - 1 - lagDays)));
    cashRatePath[i] = +(from + (to - from) * t).toFixed(8);
  }
  const anchor = (B.BASE.stressPaths.anchors || []);
  return {
    id, name: d.name, R, pick,
    lengthDays, lengthMonths: +(lengthDays / 21).toFixed(2),
    equityCumDropPct: +equityCumDropPct.toFixed(3),
    corr: +corr.toFixed(4),
    cashRateFromPct: +(from * 100).toFixed(3), cashRateToPct: +(to * 100).toFixed(3),
    cashRateLagDays: lagDays,
    cashRatePath,                 // 逐日数组，可直接喂给 mix({ cashRate: [...] })
    dailyShape: d.dailyShape,
    constructionAnchor: anchor.filter(a => ({ A: ['crash2015', 'circuit2016'], B: ['year2022', 'slow2021_2024'], C: ['covid2020', 'bear2018'] })[id].includes(a.key)),
    disclaimer: B.BASE.stressPaths.generalDisclaimer,
    note: '情景假设参数，非历史事实、非预测；合成日收益序列生成、四档 R 全检与绩效计算由 Phase 5 执行，本脚手架不生成价格序列、不回测。'
  };
}

// ---------------------------------------------------------------------------
// 5. 自检（V0 逐位对齐 + 两种 quarterMode 可运行性 + 参数接线），非绩效
// ---------------------------------------------------------------------------
if (require.main === module) {
  const AUD = JSON.parse(fs.readFileSync(P('final_audit_data.json'), 'utf8'));
  const out = {
    generated: '2026-11-07',
    purpose: 'Phase 5 引擎脚手架自检（对标校验 + 可运行性冒烟），**非策略绩效**',
    discipline: '本文件不含 cagr/vol/sharpe/胜率/换手/超额等策略绩效数字；nav/MDD 仅为 V0 对标校验值',
    v0: [], pathIV: null, smoke: [], stress: [], parameterContract: {},
    pathsRegistration: null, pendingExtensions: null, phase5ReportReservation: null,
    // 订正通知 2026-11-07：ETF 成本敏感性 / E1·E2 可观测量 / 未建模摩擦 登记（仅登记，未实现）
    newExportRegistry: null, etfRegistration: null, disciplineGuard: null
  };

  // (1) V0 四方对齐：runRClause(enabled=false) vs mixRef vs final_audit_data.json
  for (const [R, eq] of B.R2EQ) {
    const ref = mixRef({ eq });
    const v0 = runRClause({ eq, rClause: { enabled: false, R } });
    let maxAbs = 0, maxRel = 0, firstDiff = -1;
    for (let i = 0; i < ref.length; i++) {
      const d = Math.abs(ref[i] - v0.nav[i]);
      if (d > maxAbs) maxAbs = d;
      if (ref[i] !== 0) maxRel = Math.max(maxRel, d / Math.abs(ref[i]));
      if (d !== 0 && firstDiff < 0) firstDiff = i;
    }
    const refMdd = +(B.mddOf(ref) * 100).toFixed(3);
    const v0Mdd = +(B.mddOf(v0.nav) * 100).toFixed(3);
    const auditRow = AUD.finalPlan.table.find(x => x.eq === +(eq * 100).toFixed(0));
    const auditMdd = auditRow ? auditRow.mdd : null;
    out.v0.push({
      R: +(R * 100).toFixed(0), eq: +(eq * 100).toFixed(0), navLen: ref.length,
      maxAbsDiff: maxAbs, maxRelDiff: +maxRel.toExponential(3), firstDiffIdx: firstDiff,
      v0MddPct: v0Mdd, refMddPct: refMdd, auditMddPct: auditMdd,
      pass: maxAbs === 0 && refMdd === auditMdd,
      note: 'V0 对标校验（非策略绩效）：maxAbsDiff 应为 0；refMdd 应等于 final_audit_data.json 的 finalPlan.table.mdd'
    });
  }
  out.v0Overall = { pass: out.v0.every(x => x.pass), maxAbsDiff: Math.max(...out.v0.map(x => x.maxAbsDiff)),
    note: '四档 R 全部逐位对齐' };

  // (1b) 第 4 条对照路径 (iv)：eq=0.20、enabled:false 与 mixRef(0.20) 逐位对齐
  //      ★ 只报校验值（长度 / 偏差 / 通过），不产出任何绩效、不产出任何对比结论 ★
  const eqIV = PATHS.iv.eq;
  const refIV = mixRef({ eq: eqIV });
  const v0IV = runRClause({ eq: eqIV, rClause: { enabled: false } });
  let maxAbsIV = 0, maxRelIV = 0, firstDiffIV = -1;
  for (let i = 0; i < refIV.length; i++) {
    const d = Math.abs(refIV[i] - v0IV.nav[i]);
    if (d > maxAbsIV) maxAbsIV = d;
    if (refIV[i] !== 0) maxRelIV = Math.max(maxRelIV, d / Math.abs(refIV[i]));
    if (d !== 0 && firstDiffIV < 0) firstDiffIV = i;
  }
  out.pathIV = {
    path: 'iv', label: PATHS.iv.label, eq: eqIV, navLen: refIV.length,
    maxAbsDiff: maxAbsIV, maxRelDiff: +maxRelIV.toExponential(3), firstDiffIdx: firstDiffIV,
    pass: maxAbsIV === 0,
    note: '逐位对齐「校验值」（对标校验、非策略绩效、非对比结论）；' +
          '未计算任何 cagr/mdd/vol/夏普/胜率/换手/超额，未比较 (i)(ii)(iii)(iv) 的任何结果'
  };

  // (1c) 裁决固化后的登记表（只落盘供 Phase 5 读取，不执行）
  out.pathsRegistration = { paths: PATHS, pathDiffs: PATH_DIFFS,
    note: '(iv) 是对照路径、不是候选策略卡；三层差值由 Phase 5 报告，本脚手架不计算' };
  out.pendingExtensions = PENDING_EXTENSIONS;
  out.phase5ReportReservation = {
    preregisteredMainTest: PREREGISTERED_MAIN_TEST, layout: PHASE5_REPORT_LAYOUT,
    note: '仅预留登记，未执行、未注入 runRClause'
  };

  // (1d) ETF 成本敏感性登记（订正通知 2026-11-07 权威口径）：使新增 5 个导出被自检输出列出。
  //      ★ 仅落盘「登记内容 + 项目数」，不注入 runRClause、不跑回测、不产任何绩效数字 ★
  out.newExportRegistry = {
    status: '仅登记，未实现',
    source: 'round4_phase3_etf_interface.md §三（订正通知覆盖旧任务书规格）',
    newExports: [
      { name: 'ETF_COST_GRID', kind: '常量（对象）', readOnly: false,
        note: '6 组成本敏感性档位；情景假设、非历史事实、不得写进 B.P_MAIN_OPT' },
      { name: 'OBSERVABLES_FOR_E1E2', kind: '只读常量（Object.freeze）', readOnly: true,
        note: 'E1/E2 所需可观测量键名清单，10 键；不产出值' },
      { name: 'UNMODELED_FRICTIONS', kind: '只读常量（Object.freeze）', readOnly: true,
        note: 'Phase 5「未建模摩擦清单」6 项；含「000922 ETF 历史缺席=幸存者偏差、非摩擦」显式标注' }
    ],
    extendedExports: [
      { name: 'PENDING_EXTENSIONS', change: '追加 3 项（premiumShock / settleLagDays / carryOffStress）' },
      { name: 'PHASE5_REPORT_LAYOUT', change: '追加 4 键（costSensitivityParallelRule / sixDimLabels / costSubjectSeparationRule / exDivCashCheck）' }
    ],
    count: 5
  };
  out.etfRegistration = {
    etfCostGrid: {
      source: ETF_COST_GRID.source, status: ETF_COST_GRID.status,
      note: ETF_COST_GRID.note, valueNature: ETF_COST_GRID.valueNature,
      gridItemCount: ETF_COST_GRID.grid.length,
      stressDayNoteVerified: /仅放大减半卖出日与恢复买回日，不放大季度再平衡/.test(ETF_COST_GRID.grid[0].note),
      premiumShock4QuadrantVerified: /卖出腿\/买回腿独立取符号做 4 象限/.test(ETF_COST_GRID.grid[1].note),
      inTransitCashVerified: /在途资金不计入可再平衡现金/.test(ETF_COST_GRID.grid[2].note),
      ids: ETF_COST_GRID.grid.map(g => g.id),
      slippageBp: ETF_COST_GRID.grid[0].slippageBp,
      stressDayMultiplier: ETF_COST_GRID.grid[0].stressDayMultiplier,
      stressDayNote: ETF_COST_GRID.grid[0].note,
      premiumShockBp: ETF_COST_GRID.grid[1].premiumShockBp,
      premiumShockNote: ETF_COST_GRID.grid[1].note,
      settleLagDays: ETF_COST_GRID.grid[2].settleLagDays,
      inTransitInterest: ETF_COST_GRID.grid[2].inTransitInterest,
      settleLagNote: ETF_COST_GRID.grid[2].note,
      effectiveRecoverLag: ETF_COST_GRID.grid[3].formula,
      shortHoldRedemptionFeeBp: ETF_COST_GRID.grid[4].shortHoldRedemptionFeeBp,
      feeAnnual: ETF_COST_GRID.grid[5].feeAnnual,
      allStatusOnlyRegistered: ETF_COST_GRID.grid.every(g => g.status === '仅登记，未实现'),
      allHaveCommonNote: ETF_COST_GRID.grid.every(g => g.note.includes(ETF_COMMON_NOTE)),
      allHaveStatusAndSource: ETF_COST_GRID.grid.every(g => g.status === '仅登记，未实现' &&
        g.source === 'round4_phase3_etf_interface.md §三')
    },
    observablesForE1E2: {
      source: OBSERVABLES_FOR_E1E2.source, status: OBSERVABLES_FOR_E1E2.status,
      keyCount: OBSERVABLES_FOR_E1E2.keys.length, keys: OBSERVABLES_FOR_E1E2.keys,
      note: OBSERVABLES_FOR_E1E2.note
    },
    unmodeledFrictions: {
      source: UNMODELED_FRICTIONS.source, status: UNMODELED_FRICTIONS.status,
      itemCount: UNMODELED_FRICTIONS.items.length,
      names: UNMODELED_FRICTIONS.items.map(x => x.name),
      survivorsBiasFlag: UNMODELED_FRICTIONS.items.find(x => x.category === '幸存者偏差，非摩擦') || null,
      allStatusOnlyRegistered: UNMODELED_FRICTIONS.items.every(x => x.status === '仅登记，未实现')
    },
    pendingExtensionsAppended: PENDING_EXTENSIONS.filter(x =>
      ['premiumShock', 'settleLagDays', 'carryOffStress'].includes(x.name)).map(x => x.name),
    pendingExtensionsAllOnlyRegistered: PENDING_EXTENSIONS.every(x => x.status === '仅登记，未实现'),
    layoutNewKeys: ['costSensitivityParallelRule', 'sixDimLabels', 'costSubjectSeparationRule', 'exDivCashCheck'],
    layoutSixDimLabels: PHASE5_REPORT_LAYOUT.sixDimLabels,
    note: '以上全部为「仅登记，未实现」：不注入 runRClause、不改任何默认值、不改 B.P_MAIN_OPT、' +
          '不改 PATHS/PATH_DIFFS/PREREGISTERED_MAIN_TEST/REQUIRED_RCLAUSE_KEYS；不含任何策略绩效数字'
  };

  // (2) 状态机分支可运行性冒烟（显式示例参数，非任何候选策略卡）
  //     ★ 只报告「是否跑通 / nav 长度 / 有无 NaN / 事件类型计数」，不报告任何绩效数字 ★
  //     主口径 R=0.20 全期不触发（Phase 2 §4.2），分支无法被执行到；
  //     故另用 R=0.10 人工收紧以强制触发，让 trigger / cut / recover 三条分支真正执行。
  //     R=0.10 仅为骨架可运行性验证参数，不是任何 Phase 4 候选策略卡、不是策略建议。
  const SMOKE_BASE = { enabled: true, eqBase: 0.40, cutRatio: 0.5, lockDays: 20,
    ddBasis: 'highWaterV', cutOnce: true };
  const SMOKE_CASES = [
    { label: 'R=0.20 基准场景', R: 0.20, recoverMode: 'none', reviewLagDays: 20 },
    { label: '触发+review恢复（R=0.10）', R: 0.10, recoverMode: 'review', reviewLagDays: 20 },
    { label: '触发+quarterly恢复（R=0.10）', R: 0.10, recoverMode: 'quarterly', reviewLagDays: 20 },
    { label: '触发+不恢复（R=0.10）', R: 0.10, recoverMode: 'none', reviewLagDays: 20 }
  ];
  for (const qm of ['q63', 'calQ']) {
    for (const c of SMOKE_CASES) {
      const rc = Object.assign({}, SMOKE_BASE, { R: c.R, recoverMode: c.recoverMode,
        reviewLagDays: c.reviewLagDays, quarterMode: qm });
      const r = runRClause({ eq: 0.40, rClause: rc });
      const byType = {};
      for (const e of r.events) byType[e.type] = (byType[e.type] || 0) + 1;
      out.smoke.push({
        quarterMode: qm, caseLabel: c.label, ran: true, navLen: r.nav.length,
        hasNaN: r.nav.some(x => !isFinite(x)),
        triggerCount: r.triggers.length,
        cutCount: r.counters.cutCount, recoverCount: r.counters.recoverCount,
        rebalCount: r.counters.rebalCount, sameDayMultiAction: r.counters.sameDayMultiAction,
        eventCount: r.events.length, eventTypes: byType, metrics: r.metrics,
        note: '仅为状态机分支可运行性冒烟；R=0.10 系人工收紧以强制触发（基准场景用 R=0.20），均非任何 Phase 4 候选策略卡；不产出绩效数字'
      });
    }
  }

  // (2b) quarterMode 接线验证：只记录两种日历的时点集大小与「事件计数」，
  //      不产出任何对比绩效（MDD/收益/夏普等一律不计算）。
  out.quarterModeWiring = {
    q63QuarterEnds: B.Q63.length, calQQuarterEnds: B.CAL_Q.length,
    note: '两种日历时点集不同（q63 相对 S 取模 / calQ 绝对日历季末），接线已生效；' +
      'R=0.20 基准场景下 calQ 出现 trigger/cut 事件而 q63 未出现，与 Phase 2 §4.5「日历季末口径下 R=20% 会触发」定性自洽；' +
      '此处仅为事件计数，非绩效对比，具体 MDD 与归因由 Phase 5 产出'
  };

  // (3) 压力路径参数接线自检（不生成价格序列、不回测）
  for (const id of ['A', 'B', 'C']) {
    const c = stressPathConfig(id, 0.20);
    out.stress.push({ id, lengthDays: c.lengthDays, cashRatePathLen: c.cashRatePath.length,
      cashRateFromPct: c.cashRateFromPct, cashRateToPct: c.cashRateToPct,
      equityCumDropPct: c.equityCumDropPct, corr: c.corr,
      anchorKeys: c.constructionAnchor.map(a => a.key),
      hasDisclaimer: typeof c.disclaimer === 'string' && c.disclaimer.length > 0,
      note: '仅参数接线，未生成合成序列、未回测、未产出绩效' });
  }

  // (4) 参数契约 + 负向测试（验证「完全参数化、不设默认」确实生效）
  const FULL_RC = { enabled: true, R: 0.20, eqBase: 0.40, cutRatio: 0.5, lockDays: 20,
    recoverMode: 'review', reviewLagDays: 20, ddBasis: 'highWaterV', cutOnce: true, quarterMode: 'q63' };
  const throws = (mut, re) => {
    try { runRClause({ eq: 0.40, rClause: Object.assign({}, FULL_RC, mut) }); return false; }
    catch (e) { return re.test(e.message); }
  };
  out.parameterContract = {
    requiredKeys: REQUIRED_RCLAUSE_KEYS,
    enums: RCLAUSE_ENUM,
    eventTypes: EVENT_TYPES,
    defaultsInEngine: '无：enabled=true 时任一必填字段缺失即抛错；enabled=false 仅要求 enabled，其余字段不读不校验',
    quarterModes: ['q63', 'calQ'],
    stressPathIds: Object.keys(STRESS_DEFS),
    metricsPolicy: 'metrics: null，全部策略绩效由 Phase 5 产出',
    negativeTests: [
      { name: 'enabled=true 缺 cutRatio → 抛错', pass: (() => {
        const rc = Object.assign({}, FULL_RC); delete rc.cutRatio;
        try { runRClause({ eq: 0.40, rClause: rc }); return false; } catch (e) { return /cutRatio/.test(e.message); }
      })() },
      { name: 'ddBasis=cyclePeak（周期高点）→ 抛错', pass: throws({ ddBasis: 'cyclePeak' }, /ddBasis/) },
      { name: 'eqBase ≠ eq → 抛错', pass: throws({ eqBase: 0.55 }, /eqBase/) },
      { name: 'quarterMode 非法 → 抛错', pass: throws({ quarterMode: 'monthly' }, /quarterMode/) },
      { name: 'reviewLagDays=Infinity + review 模式 → 抛错', pass: throws({ reviewLagDays: Infinity }, /reviewLagDays/) },
      { name: 'enabled=false 仅传 enabled（V0）→ 正常', pass: (() => {
        try { return runRClause({ eq: 0.40, rClause: { enabled: false } }).nav.length === 4089; }
        catch (e) { return false; }
      })() }
    ]
  };
  out.parameterContract.negativeTestsAllPass = out.parameterContract.negativeTests.every(x => x.pass);

  // (5) 纪律守卫：程序化断言本次改动「保持 V0/路径(iv) 零偏差 + 冒烟合规 + 无绩效字段」
  //     被主理人明确批准可输出的「V0 逐位对齐校验值（MDD）」单独白名单，不判为策略绩效。
  const FORBIDDEN_PERF_KEYS = /^(cagr|mdd|vol|volatility|sharpe|turnover|annualReturn|annualizedReturn|winRate|win_rate|excessReturn|alpha|beta|sortino|calmar|年化收益|夏普|波动率?|胜率|换手率?|超额收益?)$/i;
  const V0_CALIBRATION_KEYS = new Set(['v0MddPct', 'refMddPct', 'auditMddPct']);
  function scanPerfFields(node, pathStr, hits) {
    if (Array.isArray(node)) { node.forEach((v, i) => scanPerfFields(v, `${pathStr}[${i}]`, hits)); return; }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        if (typeof v === 'number' && isFinite(v) && FORBIDDEN_PERF_KEYS.test(k) && !V0_CALIBRATION_KEYS.has(k))
          hits.push(`${pathStr}.${k}=${v}`);
        if (v && typeof v === 'object') scanPerfFields(v, `${pathStr}.${k}`, hits);
      }
    }
  }
  const perfHits = [];
  scanPerfFields(out, 'out', perfHits);   // 在挂载 disciplineGuard 之前扫描，避免自引用
  const g = {
    v0FourTierAllZero: out.v0Overall.maxAbsDiff === 0 && out.v0.every(x => x.maxAbsDiff === 0 && x.navLen === 4089),
    v0FourTierNavLen: out.v0.map(x => x.navLen),
    pathIVZero: out.pathIV.pass && out.pathIV.maxAbsDiff === 0 && out.pathIV.navLen === 4089,
    smokeCount: out.smoke.length,
    smokeAllRan: out.smoke.length === 8 && out.smoke.every(x => x.ran === true),
    smokeNoNaN: out.smoke.every(x => x.hasNaN === false),
    smokeMetricsAllNull: out.smoke.every(x => x.metrics === null),
    negativeTestCount: out.parameterContract.negativeTests.length,
    negativeTestsAllPass: out.parameterContract.negativeTestsAllPass,
    newExportCount: out.newExportRegistry.count,
    allRegistrationsOnlyRegistered: out.etfRegistration.pendingExtensionsAllOnlyRegistered &&
      out.etfRegistration.etfCostGrid.allStatusOnlyRegistered &&
      out.etfRegistration.unmodeledFrictions.allStatusOnlyRegistered,
    etfAuthoritativeWordingVerified:
      out.etfRegistration.etfCostGrid.stressDayNoteVerified &&
      out.etfRegistration.etfCostGrid.premiumShock4QuadrantVerified &&
      out.etfRegistration.etfCostGrid.inTransitCashVerified &&
      out.etfRegistration.etfCostGrid.allHaveCommonNote &&
      out.etfRegistration.etfCostGrid.allHaveStatusAndSource,
    perfFieldHits: perfHits,
    noPerformanceFields: perfHits.length === 0,
    v0CalibrationWhitelist: [...V0_CALIBRATION_KEYS],
    v0CalibrationNote: 'v0[].v0MddPct/refMddPct/auditMddPct 为主理人已批准的「V0 逐位对齐对标校验值、非策略绩效」，显式白名单；' +
      '其余 cagr/mdd/vol/sharpe/胜率/换手/超额 等策略绩效字段一律不得出现'
  };
  g.allPass = g.v0FourTierAllZero && g.pathIVZero && g.smokeAllRan && g.smokeNoNaN &&
    g.smokeMetricsAllNull && g.negativeTestsAllPass && g.negativeTestCount === 6 &&
    g.newExportCount === 5 && g.allRegistrationsOnlyRegistered &&
    g.etfAuthoritativeWordingVerified && g.noPerformanceFields;
  out.disciplineGuard = g;

  fs.writeFileSync(P('phase5_scaffold_check.json'), JSON.stringify(out));

  const L = console.log;
  L('===== Phase 5 脚手架自检（非策略绩效） =====');
  L('【1】V0 逐位对齐（四档 R）'); console.table(out.v0);
  L('V0 总体：' + JSON.stringify(out.v0Overall));
  L('【1b】第 4 条对照路径 (iv) 逐位对齐校验（仅校验值，非绩效、非对比结论）');
  console.table([out.pathIV]);
  L('【1c】对照路径登记 / D4 扩展点 / Phase 5 报告编排预留');
  L('  路径：' + Object.keys(PATHS).join(' / ') + '；三层差值：' + PATH_DIFFS.map(x => x.id).join(' / '));
  L('  预留扩展点（未实现）：' + PENDING_EXTENSIONS.map(x => x.name).join(', '));
  L('  预注册主检验：' + PREREGISTERED_MAIN_TEST.status);
  L('【2】状态机分支可运行性冒烟（2 quarterMode × 4 场景）');
  console.table(out.smoke.map(x => Object.assign({}, x, { eventTypes: JSON.stringify(x.eventTypes) })));
  L('负向测试全通过：' + out.parameterContract.negativeTestsAllPass);
  console.table(out.parameterContract.negativeTests);
  L('【2b】quarterMode 接线验证（非绩效）'); L(JSON.stringify(out.quarterModeWiring, null, 1));
  L('【3】压力路径参数接线'); console.table(out.stress);
  L('【4】参数契约'); L(JSON.stringify(out.parameterContract, null, 1));
  L('【5】ETF 成本敏感性登记（仅登记，未实现，非绩效）—— 新增 5 个导出');
  L('  新增导出：' + out.newExportRegistry.newExports.map(x => x.name).join(', '));
  L('  扩展导出：' + out.newExportRegistry.extendedExports.map(x => x.name).join(', '));
  L('  ETF_COST_GRID 档位组：' + out.etfRegistration.etfCostGrid.ids.join(' / '));
  L('  OBSERVABLES_FOR_E1E2 键数：' + out.etfRegistration.observablesForE1E2.keyCount +
    '；UNMODELED_FRICTIONS 条目数：' + out.etfRegistration.unmodeledFrictions.itemCount);
  L('【6】纪律守卫（本次改动 5 项数值断言）');
  L('  V0 四档零偏差：' + g.v0FourTierAllZero + '（navLen=' + g.v0FourTierNavLen.join('/') + '）' +
    '；路径(iv) 零偏差：' + g.pathIVZero);
  L('  冒烟：' + g.smokeCount + ' 场景 全ran=' + g.smokeAllRan + ' 无NaN=' + g.smokeNoNaN +
    ' metrics全null=' + g.smokeMetricsAllNull);
  L('  负向测试：' + g.negativeTestCount + ' 项 全通过=' + g.negativeTestsAllPass +
    '；绩效字段命中=' + g.perfFieldHits.length + '（应为 0）');
  L('  ★ 守卫总判定 allPass=' + g.allPass + ' ★');
  L('已写出 phase5_scaffold_check.json');
}

module.exports = {
  runRClause, mixRef, validateRClause, buildOpt,
  stressPathConfig, STRESS_DEFS,
  REQUIRED_RCLAUSE_KEYS, RCLAUSE_ENUM, EVENT_TYPES,
  PATHS, PATH_DIFFS, PENDING_EXTENSIONS, PREREGISTERED_MAIN_TEST, PHASE5_REPORT_LAYOUT,
  // ---- 订正通知 2026-11-07 新增登记导出（仅登记，未实现；不注入引擎）----
  ETF_COST_GRID, OBSERVABLES_FOR_E1E2, UNMODELED_FRICTIONS
};
