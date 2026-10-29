/**
 * 脑商AI · 解析 server/sql/schema.sql，抽取表级/列级中文注释
 *
 * 输出：/server/data/schema_comments.json
 *   { "users": { "table": "用户主表（人）", "columns": { "id": "内部 ID" } } }
 *
 * 解析规则：
 *   1) 表注释：CREATE TABLE 之前最近的一行「── N) [表名] 中文说明 ┈┈」标题
 *      标题里表名可缺席（如「2) 订单 / 销售」），也可出现（如「1) users 用户主表」）
 *   2) 列注释：CREATE TABLE 块内每行列定义尾部的 `-- 中文` 行内注释
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'sql', 'schema.sql');
const OUT = path.join(ROOT, 'data', 'schema_comments.json');

const lines = fs.readFileSync(SRC, 'utf8').split(/\r?\n/);

const result = {};
let pendingTableComment = '';
let plainHeader = '';        // 无序号装饰时，紧邻 CREATE TABLE 上方的普通注释行

// 标题行：允许表名缺席
const TITLE_RE = /^--\s*[-─—]{2,}\s*(\d+)\)\s*(.*)$/;
const NAME_IN_TITLE = /^([A-Za-z_][A-Za-z0-9_]*)\s+(.*)$/;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];

  const tm = line.match(TITLE_RE);
  if (tm) {
    // 去掉行尾的装饰线（┈ / ─）与空白
    let body = tm[2].replace(/[┈─—\s]+$/, '').trim();
    const nm = body.match(NAME_IN_TITLE);
    if (nm) pendingTableComment = nm[2].trim();
    else pendingTableComment = body;
    plainHeader = '';
    continue;
  }

  // 普通注释行：作为「无序号标题」的表注释候选
  const pm = line.match(/^--\s+(.+?)\s*$/);
  if (pm && !/^[-─—=]{3,}/.test(line.trim())) {
    plainHeader = pm[1].trim();
    continue;
  }
  if (line.trim() && !line.trim().startsWith('--')) {
    plainHeader = '';
  }

  const cm = line.match(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?([A-Za-z_][A-Za-z0-9_]*)["`]?\s*\(/i);
  if (!cm) continue;

  const table = cm[1];

  // 收集 CREATE TABLE 块内的所有行（按括号配平）
  const block = [];
  let depth = 1;
  let j = i + 1;
  for (; j < lines.length && depth > 0; j++) {
    const l = lines[j];
    for (const ch of l) {
      if (ch === '(') depth++;
      else if (ch === ')') { depth--; if (depth === 0) break; }
    }
    if (depth === 0) break;
    block.push(l);
  }

  const cols = {};
  for (const raw of block) {
    const s = raw.trim();
    if (!s || s.startsWith('--')) continue;
    if (/^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)\b/i.test(s)) continue;
    const colMatch = s.match(/^["`]?([A-Za-z_][A-Za-z0-9_]*)["`]?/);
    if (!colMatch) continue;
    const cmt = extractTrailingComment(s);
    if (cmt) cols[colMatch[1]] = cmt;
  }

  result[table] = { table: pendingTableComment || plainHeader || '', columns: cols };
  pendingTableComment = '';   // 逐表重置，避免串味
  plainHeader = '';
  i = j - 1;
}

// 提取行尾 -- 注释（跳过引号内的内容）
function extractTrailingComment(s) {
  let inS = false, inD = false;
  for (let k = 0; k < s.length - 1; k++) {
    const c = s[k];
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS) inD = !inD;
    else if (c === '-' && s[k + 1] === '-' && !inS && !inD) {
      return s.slice(k + 2).trim();
    }
  }
  return '';
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8');

let nCols = 0;
for (const t of Object.values(result)) nCols += Object.keys(t.columns).length;
console.log('表 ' + Object.keys(result).length + ' 张，已带注释列 ' + nCols + ' 个');
console.log('--- 表注释 ---');
for (const [k, v] of Object.entries(result)) {
  console.log('  ' + k.padEnd(24) + ' [' + String(Object.keys(v.columns).length).padStart(2) + '列] ' + (v.table || '*** 缺 ***'));
}
console.log('输出: ' + OUT);
