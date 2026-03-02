#!/usr/bin/env node
/**
 * 清除所有证书数据（保留用户和系统设置）
 * 用于清理测试数据，准备导入正式数据
 * 
 * 用法: node deploy/clear-all-certificates.js
 */

const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");

const dataDir = path.join(__dirname, "..", "data");
const dbPath = path.join(dataDir, "app.db");

async function clearAllCertificates() {
  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  console.log("========================================");
  console.log("清除所有证书数据");
  console.log("========================================");
  
  // 查询现有数据量
  const requestCount = await db.get("SELECT COUNT(*) as count FROM requests");
  const certCount = await db.get("SELECT COUNT(*) as count FROM request_certificates");
  
  console.log(`\n当前数据量:`);
  console.log(`  - 申请记录: ${requestCount.count} 条`);
  console.log(`  - 证书记录: ${certCount.count} 条`);
  
  if (requestCount.count === 0 && certCount.count === 0) {
    console.log("\n✓ 系统中已无证书数据，无需清理");
    await db.close();
    return;
  }

  console.log("\n⚠️  警告: 此操作将删除所有证书申请数据！");
  console.log("   保留数据: 用户账号、系统设置、权限配置");
  console.log("   删除数据: 所有申请记录、证书记录、关联文件\n");
  
  await db.run("BEGIN");
  
  try {
    // 1. 删除所有证书记录
    const deleteCerts = await db.run("DELETE FROM request_certificates");
    console.log(`✓ 已删除 ${deleteCerts.changes} 条证书记录`);
    
    // 2. 删除所有申请记录
    const deleteRequests = await db.run("DELETE FROM requests");
    console.log(`✓ 已删除 ${deleteRequests.changes} 条申请记录`);
    
    await db.run("COMMIT");
    
    console.log("\n========================================");
    console.log("✅ 证书数据清理完成！");
    console.log("========================================");
    console.log("\n现在可以导入新的CSV数据：");
    console.log("  bash deploy/import-csv-only.sh your-data.csv");
    
  } catch (err) {
    await db.run("ROLLBACK");
    console.error("\n❌ 清理失败，已回滚:", err.message);
    throw err;
  } finally {
    await db.close();
  }
}

// 执行
clearAllCertificates().catch(err => {
  console.error(err);
  process.exit(1);
});
