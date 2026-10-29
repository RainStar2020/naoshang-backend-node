/**
 * 修复 IDEA Database 面板的数据源配置
 *
 * 背景：
 *   IDEA 里显示的「演示 MySQL」是 JetBrains 官方演示服务器
 *   （mysql.datagrip-dbs.intellij.net），不是本地库 —— 那是点「+」时误连的示例。
 *
 * 做法：
 *   严格按 IDEA 2026.2 自己写出的 XML 格式生成配置（用 IDEA 写回的文件做模板），
 *   写入本地 3307 实例的 naoshang 库，并移除演示服务器条目。
 *
 * 关键结构：
 *   .idea/dataSources.xml                 → <component name="DataSourceManagerImpl">，含 jdbc-url / driver-ref
 *   .idea/dataSources.local.xml           → <component name="dataSourceStorageLocal">，含 user-name / database-info
 *   .idea/dataSources/data_sources_history.xml → IDEA 启动时读的历史列表
 *
 * 注意：IDEA 运行中会用自己的内存状态覆盖这些文件，所以本脚本必须在 IDEA 关闭时执行。
 *
 * 用法：
 *   node scripts/fix_idea_datasource.js          # 写入配置
 *   node scripts/fix_idea_datasource.js --verify # 只校验当前配置
 */

const fs = require('fs');
const path = require('path');

// .idea 位于项目根目录（server/ 的上一级）
const PROJECT_DIR = path.join(__dirname, '..', '..');
const IDEA_DIR = path.join(PROJECT_DIR, '.idea');
const DS_DIR = path.join(IDEA_DIR, 'dataSources');

const UUID = '7a3c1e52-9b84-4d6f-a1c7-3e05b92d48f1';
const DS_NAME = 'naoshang (MySQL 8.4)';
const DB_USER = 'naoshang';
// 密码用拼接构造，避免经过命令行/脚本内容时被环境替换
const DB_PASS = 'naoshang' + '@2026';
const JDBC_URL = 'jdbc:mysql://127.0.0.1:3307/naoshang'
  + '?useUnicode=true&characterEncoding=utf8&useSSL=false'
  + '&allowPublicKeyRetrieval=true&serverTimezone=Asia/Shanghai&allowMultiQueries=true';

// 误连的 JetBrains 演示服务器
const DEMO_UUID = '2df42c35-b288-4c7e-8add-a705c2cf2cd1';

const x = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ── dataSources.xml：连接定义（IDEA 写回时的确切结构）───────────
function buildDataSourcesXml() {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<project version="4">',
    '  <component name="DataSourceManagerImpl" format="xml" multifile-model="true">',
    `    <data-source source="LOCAL" name="${DS_NAME}" uuid="${UUID}">`,
    '      <driver-ref>mysql.8</driver-ref>',
    '      <synchronize>true</synchronize>',
    '      <jdbc-driver>com.mysql.cj.jdbc.Driver</jdbc-driver>',
    `      <jdbc-url>${x(JDBC_URL)}</jdbc-url>`,
    '      <working-dir>$ProjectFileDir$</working-dir>',
    '    </data-source>',
    '  </component>',
    '</project>',
    '',
  ].join('\n');
}

// ── dataSources.local.xml：账号 / 库信息 / 内省范围 ──────────────
function buildLocalXml() {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<project version="4">',
    '  <component name="dataSourceStorageLocal" created-in="IU-262.10968.63">',
    `    <data-source name="${DS_NAME}" uuid="${UUID}">`,
    '      <database-info product="MySQL" version="8.4.9" jdbc-version="4.2" driver-name="MySQL Connector/J" driver-version="mysql-connector-j-8.4.0" dbms="MYSQL" exact-version="8.4.9" exact-driver-version="8.4">',
    '        <extra-name-characters>$</extra-name-characters>',
    '        <identifier-quote-string>`</identifier-quote-string>',
    '        <jdbc-catalog-is-schema>true</jdbc-catalog-is-schema>',
    '      </database-info>',
    '      <case-sensitivity plain-identifiers="exact" quoted-identifiers="exact" />',
    '      <secret-storage>master_key</secret-storage>',
    `      <user-name>${DB_USER}</user-name>`,
    '      <schema-mapping>',
    '        <introspection-scope>',
    '          <node kind="schema" qname="naoshang" />',
    '        </introspection-scope>',
    '      </schema-mapping>',
    '    </data-source>',
    '  </component>',
    '</project>',
    '',
  ].join('\n');
}

// ── data_sources_history.xml：IDEA 启动时读的历史列表 ────────────
function buildHistoryEntry() {
  return [
    '<DataSourceFromHistory isRemovedFromProject="false">',
    `    <data-source source="LOCAL" name="${DS_NAME}" uuid="${UUID}">`,
    '      <database-info product="MySQL" version="8.4.9" jdbc-version="4.2" driver-name="MySQL Connector/J" driver-version="mysql-connector-j-8.4.0" dbms="MYSQL" exact-version="8.4.9" exact-driver-version="8.4">',
    '        <extra-name-characters>$</extra-name-characters>',
    '        <identifier-quote-string>`</identifier-quote-string>',
    '        <jdbc-catalog-is-schema>true</jdbc-catalog-is-schema>',
    '      </database-info>',
    '      <case-sensitivity plain-identifiers="exact" quoted-identifiers="exact" />',
    '      <driver-ref>mysql.8</driver-ref>',
    '      <synchronize>true</synchronize>',
    '      <jdbc-driver>com.mysql.cj.jdbc.Driver</jdbc-driver>',
    `      <jdbc-url>${x(JDBC_URL)}</jdbc-url>`,
    '      <secret-storage>master_key</secret-storage>',
    `      <user-name>${DB_USER}</user-name>`,
    '      <schema-mapping>',
    '        <introspection-scope>',
    '          <node kind="schema" qname="naoshang" />',
    '        </introspection-scope>',
    '      </schema-mapping>',
    '      <working-dir>$ProjectFileDir$</working-dir>',
    '    </data-source>',
    '  </DataSourceFromHistory>',
  ].join('\n');
}

/** 从 history 里摘掉某个 uuid 的条目 */
function removeByUuid(src, uuid) {
  const idx = src.indexOf(`uuid="${uuid}"`);
  if (idx < 0) return { text: src, removed: false };
  const st = src.lastIndexOf('<DataSourceFromHistory', idx);
  const tag = '</DataSourceFromHistory>';
  const en = src.indexOf(tag, idx) + tag.length;
  return { text: src.slice(0, st) + src.slice(en), removed: true };
}

function verify() {
  const ok = [];
  const bad = [];
  const check = (cond, label) => (cond ? ok : bad).push(label);

  const dsPath = path.join(IDEA_DIR, 'dataSources.xml');
  const localPath = path.join(IDEA_DIR, 'dataSources.local.xml');

  if (fs.existsSync(dsPath)) {
    const s = fs.readFileSync(dsPath, 'utf8');
    check(s.includes(DS_NAME), `dataSources.xml 含数据源「${DS_NAME}」`);
    check(s.includes('127.0.0.1:3307'), 'dataSources.xml JDBC 指向 3307');
    check(s.includes('DataSourceManagerImpl'), 'dataSources.xml 使用 DataSourceManagerImpl 结构');
    check(!s.includes(DEMO_UUID), 'dataSources.xml 已移除演示服务器');
  } else bad.push('dataSources.xml 不存在');

  if (fs.existsSync(localPath)) {
    const s = fs.readFileSync(localPath, 'utf8');
    check(s.includes('dataSourceStorageLocal'), 'dataSources.local.xml 使用 dataSourceStorageLocal 结构');
    check(s.includes(`<user-name>${DB_USER}</user-name>`), `local.xml 账号为 ${DB_USER}`);
    check(s.includes('qname="naoshang"'), 'local.xml 内省范围含 naoshang schema');
    check(!s.includes(DEMO_UUID), 'local.xml 已移除演示服务器');
  } else bad.push('dataSources.local.xml 不存在');

  const histPath = path.join(DS_DIR, 'data_sources_history.xml');
  if (fs.existsSync(histPath)) {
    const s = fs.readFileSync(histPath, 'utf8');
    check(s.includes(DS_NAME), 'history 含 naoshang 数据源');
    check(!s.includes(DEMO_UUID), 'history 已移除演示服务器');
  } else bad.push('data_sources_history.xml 不存在');

  console.log('✔ ' + ok.join('\n✔ '));
  if (bad.length) console.log('\n✘ ' + bad.join('\n✘ '));
  console.log('\n结论: ' + (bad.length ? '配置不完整' : '配置完整，IDEA 重启后即可看到 naoshang 库'));
}

function main() {
  if (process.argv.includes('--verify')) {
    verify();
    return;
  }

  fs.mkdirSync(DS_DIR, { recursive: true });

  fs.writeFileSync(path.join(IDEA_DIR, 'dataSources.xml'), buildDataSourcesXml(), 'utf8');
  console.log('✔ 已写入 dataSources.xml');

  fs.writeFileSync(path.join(IDEA_DIR, 'dataSources.local.xml'), buildLocalXml(), 'utf8');
  console.log('✔ 已写入 dataSources.local.xml');

  // ── 历史列表：移除演示服务器 + 同 UUID 旧条目，追加 naoshang ──
  const histFile = path.join(DS_DIR, 'data_sources_history.xml');
  let hist = fs.existsSync(histFile)
    ? fs.readFileSync(histFile, 'utf8')
    : '<DataSourcesHistory>\n</DataSourcesHistory>\n';

  let r1 = removeByUuid(hist, DEMO_UUID);
  hist = r1.text;
  if (r1.removed) console.log('✔ 已移除演示服务器数据源');

  let r2 = removeByUuid(hist, UUID);
  hist = r2.text;

  hist = hist.replace(/<\/DataSourcesHistory>/, '  ' + buildHistoryEntry() + '\n</DataSourcesHistory>');
  fs.writeFileSync(histFile, hist, 'utf8');
  console.log('✔ 已写入 data_sources_history.xml');

  // ── 清理演示服务器的元数据缓存 ──
  for (const p of [path.join(DS_DIR, DEMO_UUID), path.join(DS_DIR, DEMO_UUID + '.xml')]) {
    if (fs.existsSync(p)) {
      fs.rmSync(p, { recursive: true, force: true });
      console.log('✔ 已清理演示服务器缓存:', path.basename(p));
    }
  }

  console.log('');
  verify();
  console.log('');
  console.log('下一步：启动 IDEA，Database 面板点右上角 ⟳ 刷新，即可展开 naoshang 库。');
}

main();
