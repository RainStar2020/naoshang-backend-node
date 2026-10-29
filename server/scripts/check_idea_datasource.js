/**
 * IDEA 数据源配置自检
 *
 * 检查 .idea/ 下的数据源配置是否完整、格式是否与 IDEA 2026.2 一致，
 * 并用 IDEA 自带的 MySQL Connector/J 实测 JDBC 连接与元数据读取。
 *
 * 用法：
 *   node scripts/check_idea_datasource.js
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PROJECT_DIR = path.join(__dirname, '..', '..');
const IDEA_DIR = path.join(PROJECT_DIR, '.idea');
const DS_DIR = path.join(IDEA_DIR, 'dataSources');

const IDEA_HOME = 'D:\\IDEA';

// 在 IDEA 的 drivers 目录里找 MySQL 驱动（版本号会变，做 glob 匹配）
function findDriver() {
  const base = path.join(
    process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming'),
    'JetBrains'
  );
  if (!fs.existsSync(base)) return null;
  for (const ver of fs.readdirSync(base)) {
    const dir = path.join(base, ver, 'drivers');
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (/^mysql-connector.*\.jar$/i.test(f)) return path.join(dir, f);
    }
  }
  return null;
}
const DRIVER_JAR = findDriver();

let pass = 0;
let fail = 0;
const ok = (m) => { pass++; console.log('  ✔ ' + m); };
const bad = (m) => { fail++; console.log('  ✘ ' + m); };

function read(p) {
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

console.log('═══ 1. 配置文件存在性 ═══');
const dsXml = read(path.join(IDEA_DIR, 'dataSources.xml'));
const localXml = read(path.join(IDEA_DIR, 'dataSources.local.xml'));
const histXml = read(path.join(DS_DIR, 'data_sources_history.xml'));

dsXml ? ok('dataSources.xml 存在') : bad('dataSources.xml 不存在');
localXml ? ok('dataSources.local.xml 存在') : bad('dataSources.local.xml 不存在');
histXml ? ok('data_sources_history.xml 存在') : bad('data_sources_history.xml 不存在');

if (!dsXml || !localXml) {
  console.log('\n配置缺失，请运行: node scripts/fix_idea_datasource.js');
  process.exit(1);
}

console.log('\n═══ 2. 结构是否符合 IDEA 2026.2 格式 ═══');
dsXml.includes('DataSourceManagerImpl') ? ok('dataSources.xml 使用 DataSourceManagerImpl') : bad('dataSources.xml 缺少 DataSourceManagerImpl');
localXml.includes('dataSourceStorageLocal') ? ok('dataSources.local.xml 使用 dataSourceStorageLocal') : bad('dataSources.local.xml 缺少 dataSourceStorageLocal');

console.log('\n═══ 3. 数据源定义 ═══');
const nameMatch = dsXml.match(/name="([^"]+)" uuid="([^"]+)"/);
if (nameMatch) {
  ok('数据源名称: ' + nameMatch[1]);
  ok('UUID: ' + nameMatch[2]);
} else {
  bad('未解析到数据源');
}

const urlMatch = dsXml.match(/<jdbc-url>([^<]+)<\/jdbc-url>/);
const userMatch = localXml.match(/<user-name>([^<]+)<\/user-name>/);
// IDEA 2026 把密码存进 Password Safe（KDBX），不再明文写在 XML 里，
// 因此这里从 server/mysql/.env.local 读取同一份密码做连通性验证。
const envFile = path.join(PROJECT_DIR, 'server', 'mysql', '.env.local');
let dbPass = '';
if (fs.existsSync(envFile)) {
  const m = fs.readFileSync(envFile, 'utf8').match(/^PASSWORD=(.*)$/m);
  if (m) dbPass = m[1].trim();
}
if (!dbPass) dbPass = 'naoshang' + '@2026';

urlMatch ? ok('JDBC URL: ' + urlMatch[1].replace(/&amp;/g, '&')) : bad('未找到 jdbc-url');
userMatch ? ok('账号: ' + userMatch[1]) : bad('未找到 user-name');

console.log('\n═══ 4. 演示服务器是否已清除 ═══');
const DEMO_UUID = '2df42c35-b288-4c7e-8add-a705c2cf2cd1';
!dsXml.includes(DEMO_UUID) ? ok('dataSources.xml 已移除演示服务器') : bad('dataSources.xml 仍含演示服务器');
!localXml.includes(DEMO_UUID) ? ok('dataSources.local.xml 已移除演示服务器') : bad('local.xml 仍含演示服务器');
if (histXml) {
  !histXml.includes(DEMO_UUID) ? ok('history 已移除演示服务器') : bad('history 仍含演示服务器');
}

console.log('\n═══ 5. 内省范围（决定面板能否列出表）═══');
localXml.includes('qname="naoshang"') ? ok('introspection-scope 含 naoshang schema') : bad('introspection-scope 缺少 naoshang');

console.log('\n═══ 6. JDBC 实测（用 IDEA 自带驱动）═══');
if (!DRIVER_JAR) {
  bad('未找到 MySQL 驱动（扫描 JetBrains/*/drivers/mysql-connector*.jar）');
} else {
  ok('驱动: ' + DRIVER_JAR);
  const javaExe = path.join(IDEA_HOME, 'jbr', 'bin', 'java.exe');
  const src = path.join(__dirname, 'tmp', 'DatasourceProbe.java');
  fs.mkdirSync(path.dirname(src), { recursive: true });
  fs.writeFileSync(src, `
import java.sql.*;
public class DatasourceProbe {
  public static void main(String[] a) throws Exception {
    try (Connection c = DriverManager.getConnection(a[0], a[1], a[2])) {
      DatabaseMetaData md = c.getMetaData();
      System.out.println("SERVER=" + md.getDatabaseProductVersion());
      int t=0, cmt=0;
      try (Statement st=c.createStatement();
           ResultSet r=st.executeQuery("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='naoshang' AND table_type='BASE TABLE'")) {
        r.next(); t=r.getInt(1);
      }
      try (Statement st=c.createStatement();
           ResultSet r=st.executeQuery("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='naoshang' AND column_comment<>''")) {
        r.next(); cmt=r.getInt(1);
      }
      System.out.println("TABLES=" + t);
      System.out.println("COLCOMMENTS=" + cmt);
    }
  }
}
`, 'utf8');

  try {
    const out = execFileSync(javaExe, [
      '-Dfile.encoding=UTF-8', '-cp', DRIVER_JAR, src,
      urlMatch[1].replace(/&amp;/g, '&'), userMatch[1], dbPass,
    ], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    const server = (out.match(/SERVER=(.+)/) || [])[1];
    const tables = (out.match(/TABLES=(\d+)/) || [])[1];
    const cmt = (out.match(/COLCOMMENTS=(\d+)/) || [])[1];
    ok('连接成功, MySQL ' + (server || '?').trim());
    ok('库内表数: ' + tables);
    ok('带中文注释的字段数: ' + cmt);
  } catch (e) {
    bad('JDBC 连接失败: ' + (e.stderr || e.message).toString().split('\n')[0]);
  } finally {
    fs.rmSync(src, { force: true });
  }
}

console.log('\n═══ 7. MySQL 服务状态 ═══');
try {
  const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8' });
  out.includes(':3307') ? ok('3307 端口在监听') : bad('3307 未监听，MySQL 服务可能未启动');
} catch {
  bad('无法检测端口');
}

console.log('\n' + '─'.repeat(46));
console.log(fail === 0 ? `全部通过：${pass} 项 ✔` : `${pass} 项通过 / ${fail} 项失败 ✘`);
console.log('\n若 IDEA 面板还没显示表，点 Database 面板右上角的 ⟳ 刷新按钮即可。');
console.log('（IDEA 的元数据同步必须由用户手动触发，无法通过脚本自动完成）');
