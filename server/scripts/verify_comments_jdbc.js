/**
 * 脑商AI · JDBC 层中文注释验证
 *
 * 目的：确认 IDEA 用同一套 JDBC 连接（MySQL Connector/J）能读到中文注释，
 *       且中文无乱码 —— 这就是 IDEA 数据源面板里实际展示的内容。
 *
 * 用法：
 *   set NAOSHANG_DB_PASSWORD=xxx && node scripts/verify_comments_jdbc.js
 *   （密码从环境变量读，避免明文落在脚本里）
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = path.join(ROOT, 'tmp');

// IDEA 已安装的 MySQL 驱动（与数据源配置用同一套）
const DRIVER_CANDIDATES = [
  path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
    'JetBrains', 'IntelliJIdea2026.2', 'drivers', 'mysql-connector-j-8.4.0.jar'),
  path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
    'JetBrains', 'IntelliJIdea2026.2', 'jdbc-drivers', 'MySQL ConnectorJ', '9.7.0',
    'com', 'mysql', 'mysql-connector-j', '9.7.0', 'mysql-connector-j-9.7.0.jar'),
];

const JDBC_URL = 'jdbc:mysql://127.0.0.1:3307/naoshang'
  + '?useUnicode=true&characterEncoding=utf8&useSSL=false'
  + '&allowPublicKeyRetrieval=true&serverTimezone=Asia/Shanghai';

const USER = 'naoshang';
const PASS = process.env.NAOSHANG_DB_PASSWORD || '';

const driver = DRIVER_CANDIDATES.find((p) => p && fs.existsSync(p));
if (!driver) { console.error('✘ 未找到 MySQL 驱动 jar'); process.exit(1); }
if (!PASS) { console.error('✘ 请通过环境变量 NAOSHANG_DB_PASSWORD 提供数据库密码'); process.exit(1); }

// Java 源文件（运行时生成，用完删除）
const javaSrc = path.join(TMP, 'JdbcCommentCheck.java');
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(javaSrc, `import java.sql.*;
public class JdbcCommentCheck {
  public static void main(String[] a) throws Exception {
    try (Connection c = DriverManager.getConnection(a[0], a[1], a[2])) {
      int tTotal=0,tWith=0,cTotal=0,cWith=0,cn=0;
      StringBuilder ts=new StringBuilder(), cs=new StringBuilder();
      try (Statement s=c.createStatement();
           ResultSet r=s.executeQuery("SELECT table_name,table_comment FROM information_schema.tables WHERE table_schema='naoshang' AND table_type='BASE TABLE' ORDER BY table_name")) {
        while(r.next()){ tTotal++; String cm=r.getString(2)==null?"":r.getString(2).trim();
          if(!cm.isEmpty()){tWith++; if(tWith<=5) ts.append("  ").append(r.getString(1)).append(" | ").append(cm).append("\\n");} }
      }
      try (Statement s=c.createStatement();
           ResultSet r=s.executeQuery("SELECT table_name,column_name,column_comment FROM information_schema.columns WHERE table_schema='naoshang' ORDER BY table_name,ordinal_position")) {
        while(r.next()){ cTotal++; String cm=r.getString(3)==null?"":r.getString(3).trim();
          if(!cm.isEmpty()){cWith++; if(cWith<=8) cs.append("  ").append(r.getString(1)).append(".").append(r.getString(2)).append(" | ").append(cm).append("\\n");} }
      }
      try (Statement s=c.createStatement();
           ResultSet r=s.executeQuery("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='naoshang' AND column_comment REGEXP '[^\\\\x00-\\\\x7F]'")) {
        r.next(); cn=r.getInt(1); }
      System.out.println("__JSON__"+tTotal+","+tWith+","+cTotal+","+cWith+","+cn);
      System.out.print("__T__\\n"+ts);
      System.out.print("__C__\\n"+cs);
    }
  }
}
`, 'utf8');

let stdout = '';
try {
  stdout = execFileSync('java', ['-Dfile.encoding=UTF-8', '-Dstdout.encoding=UTF-8',
    '-cp', driver, javaSrc, JDBC_URL, USER, PASS], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
} catch (e) {
  console.error('✘ JDBC 验证执行失败:');
  console.error((e.stderr || e.stdout || String(e)).split('\n').slice(0, 12).join('\n'));
  process.exit(1);
} finally {
  try { fs.unlinkSync(javaSrc); } catch (_) {}
}

const m = stdout.match(/__JSON__(\d+),(\d+),(\d+),(\d+),(\d+)/);
if (!m) {
  console.error('✘ 未取得验证结果');
  console.error(stdout.split('\n').slice(0, 20).join('\n'));
  process.exit(1);
}

const [tTotal, tWith, cTotal, cWith, cn] = m.slice(1).map(Number);
const tSec = (stdout.match(/__T__\n([\s\S]*?)__C__/) || [, ''])[1];
const cSec = (stdout.match(/__C__\n([\s\S]*)$/) || [, ''])[1];

console.log('═══ JDBC 层中文注释验证 ═══');
console.log('驱动: ' + driver);
console.log('');
console.log('  表注释: ' + tWith + ' / ' + tTotal);
console.log('  列注释: ' + cWith + ' / ' + cTotal);
console.log('  含中文的列注释: ' + cn + ' 条');
console.log('');
console.log('表注释样例:');
process.stdout.write(tSec);
console.log('列注释样例:');
process.stdout.write(cSec);
console.log('');

const ok = tWith === tTotal && cWith === cTotal && cn > 0;
console.log(ok ? '✔ JDBC 读取中文注释正常（IDEA 面板可见，无乱码）' : '✘ 存在缺口');
process.exit(ok ? 0 : 1);
