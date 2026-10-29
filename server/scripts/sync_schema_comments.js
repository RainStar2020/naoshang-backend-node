/**
 * 脑商AI · 把中文注释回写到 sql/schema.sql
 *
 * 作用：把 sql/comments.js 字典里的中文说明补进权威 SQLite DDL 的列定义行尾，
 *       使 schema.sql 与 MySQL 库（naoshang）的注释保持一致。
 *
 * 原则：
 *   · 已有行内注释的列不改写（schema.sql 的原文优先）
 *   · 缺失注释的列才追加
 *   · 只在 CREATE TABLE 块内处理，不动视图与索引
 *
 * 用法：node scripts/sync_schema_comments.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'sql', 'schema.sql');
const COMMENTS = require(path.join(ROOT, 'sql', 'comments.js'));

const lines = fs.readFileSync(SRC, 'utf8').split(/\r?\n/);
const out = [];
let curTable = null;
let inCreate = false;
let added = 0;
let skipped = 0;

/** 取行尾 -- 注释（跳过引号内） */
function trailingComment(s) {
  let inS = false, inD = false;
  for (let k = 0; k < s.length - 1; k++) {
    const c = s[k];
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS) inD = !inD;
    else if (c === '-' && s[k + 1] === '-' && !inS && !inD) return s.slice(k + 2).trim();
  }
  return null;
}

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];

  const cm = line.match(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?([A-Za-z_][A-Za-z0-9_]*)["`]?\s*\(/i);
  if (cm) {
    curTable = cm[1];
    inCreate = true;
    out.push(line);
    continue;
  }

  if (inCreate) {
    // 块结束
    if (/^\s*\)\s*;?\s*$/.test(line) || /^\)\s*;/.test(line)) {
      inCreate = false;
      curTable = null;
      out.push(line);
      continue;
    }

    const s = line.trim();
    if (!s || s.startsWith('--')) { out.push(line); continue; }
    if (/^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)\b/i.test(s)) { out.push(line); continue; }

    const colMatch = s.match(/^["`]?([A-Za-z_][A-Za-z0-9_]*)["`]?/);
    if (!colMatch) { out.push(line); continue; }

    const colName = colMatch[1];
    const cmt = COMMENTS[curTable] && COMMENTS[curTable].columns[colName];

    if (!cmt) {
      out.push(line);
      continue;
    }

    const existing = trailingComment(s);
    if (existing !== null) {
      skipped++;                       // 已有注释，保持原样
      out.push(line);
      continue;
    }

    // 补注释：保留原缩进与行尾逗号（逗号必须在注释之前，否则 SQL 语法被破坏）
    const indent = line.match(/^\s*/)[0];
    const hasComma = /,\s*$/.test(s);
    const body = hasComma ? s.replace(/,\s*$/, '') : s;
    out.push(indent + body + (hasComma ? ',' : '') + '  -- ' + cmt);
    added++;
    continue;
  }

  out.push(line);
}

fs.writeFileSync(SRC, out.join('\n'), 'utf8');
console.log('已回写 ' + SRC);
console.log('  新增列注释: ' + added + ' 处');
console.log('  原有注释保留: ' + skipped + ' 处');
