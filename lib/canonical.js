// ============================================================================
// lib/canonical.js — 哈希工具（配置哈希 / 文件哈希 / 内容哈希）
// 2026-11-08 ｜ 第七轮（工程骨架）
//
// ★ 为什么需要「内容哈希」★
//   phase6_stress_v16.json 的 meta.generated 每次运行都变。用文件哈希做快照，
//   每次跑都显示「数据变了」，而实际上一个数字都没变——可复现就变成了空话。
//   所以：数值产物用【内容哈希】（排除时间戳字段），数据输入用【文件哈希】。
// ============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 递归按键名排序，保证同一对象的哈希与书写顺序无关
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    const out = {};
    Object.keys(v).sort().forEach(k => { out[k] = canon(v[k]); });
    return out;
  }
  return v;
}

const hashJson = obj => crypto.createHash('sha256').update(JSON.stringify(canon(obj))).digest('hex');

const hashFile = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

// 一组文件 → 一个聚合哈希。带文件名，避免「两个文件互换了内容但集合哈希不变」。
function hashFileSet(files) {
  const lines = files.map(f => path.basename(f) + ':' + hashFile(f)).sort();
  return crypto.createHash('sha256').update(lines.join('\n')).digest('hex');
}

// 内容哈希：读 JSON，删掉指定路径上的易变字段，再按规范顺序哈希
function contentHash(file, stripPaths) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  (stripPaths || []).forEach(p => {
    const parts = p.split('.');
    let cur = j;
    for (let i = 0; i < parts.length - 1; i++) cur = cur && cur[parts[i]];
    if (cur && typeof cur === 'object') delete cur[parts[parts.length - 1]];
  });
  return crypto.createHash('sha256').update(JSON.stringify(canon(j))).digest('hex');
}

module.exports = { canon, hashJson, hashFile, hashFileSet, contentHash };
