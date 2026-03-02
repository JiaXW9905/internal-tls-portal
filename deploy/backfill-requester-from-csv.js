#!/usr/bin/env node
/**
 * 按 VID 从 CSV 回填 requester_name/requester_email 到 requests 表。
 *
 * 用法:
 *   node deploy/backfill-requester-from-csv.js /path/to/data.csv
 *   node deploy/backfill-requester-from-csv.js /path/to/data.csv --dry-run
 *
 * 说明:
 * - 仅更新 requests 中 requester_name/requester_email 为空的记录
 * - 仅当 CSV 行存在 vid 且至少一个 requester 字段非空时才参与回填
 * - 支持常见表头别名（中英文）
 */

const fs = require("fs");
const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");

const dataDir = path.join(__dirname, "..", "data");
const dbPath = path.join(dataDir, "app.db");

const args = process.argv.slice(2);
const csvPath = args[0];
const dryRun = args.includes("--dry-run");

if (!csvPath) {
  console.error("Usage: node deploy/backfill-requester-from-csv.js <csv-path> [--dry-run]");
  process.exit(1);
}

if (!fs.existsSync(csvPath)) {
  console.error(`CSV not found: ${csvPath}`);
  process.exit(1);
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

function normalizeHeader(h) {
  return String(h || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function pickField(row, headers, aliases) {
  for (const alias of aliases) {
    const idx = headers.indexOf(alias);
    if (idx >= 0) return row[idx] || "";
  }
  return "";
}

function readCsvRows(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);
  if (!lines.length) return [];

  const headers = parseCsvLine(lines[0]).map(normalizeHeader);
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const row = parseCsvLine(lines[i]);
    rows.push({ headers, row, line: i + 1 });
  }
  return rows;
}

function compact(v) {
  return String(v || "").trim();
}

async function main() {
  const csvRows = readCsvRows(csvPath);
  if (!csvRows.length) {
    console.log("CSV is empty. Nothing to backfill.");
    return;
  }

  const byVid = new Map();
  for (const item of csvRows) {
    const vid = compact(
      pickField(item.row, item.headers, ["vid", "证书vid", "证书_vid", "cert_vid"])
    );
    const requesterName = compact(
      pickField(item.row, item.headers, ["requester_name", "requestername", "申请人", "申请人姓名"])
    );
    const requesterEmail = compact(
      pickField(item.row, item.headers, ["requester_email", "requesteremail", "申请人邮箱", "申请邮箱"])
    );

    if (!vid || (!requesterName && !requesterEmail)) continue;

    const existing = byVid.get(vid) || { requesterName: "", requesterEmail: "" };
    byVid.set(vid, {
      requesterName: requesterName || existing.requesterName,
      requesterEmail: requesterEmail || existing.requesterEmail
    });
  }

  if (!byVid.size) {
    console.log("No usable (vid, requester) pairs found in CSV.");
    return;
  }

  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  let touchedRows = 0;
  let touchedVid = 0;

  if (!dryRun) {
    await db.run("BEGIN");
  }

  try {
    for (const [vid, info] of byVid.entries()) {
      const rows = await db.all(
        `SELECT id, requester_name, requester_email
         FROM requests
         WHERE vid = ?`,
        [vid]
      );
      if (!rows.length) continue;

      let vidChanged = false;
      for (const r of rows) {
        const curName = compact(r.requester_name);
        const curEmail = compact(r.requester_email);
        const nextName = curName || info.requesterName;
        const nextEmail = curEmail || info.requesterEmail;

        if (nextName === curName && nextEmail === curEmail) continue;
        if (!nextName && !nextEmail) continue;

        if (dryRun) {
          console.log(
            `[DRY-RUN] id=${r.id}, vid=${vid}, name: "${curName}" -> "${nextName}", email: "${curEmail}" -> "${nextEmail}"`
          );
        } else {
          await db.run(
            `UPDATE requests
             SET requester_name = ?, requester_email = ?
             WHERE id = ?`,
            [nextName, nextEmail, r.id]
          );
        }
        touchedRows += 1;
        vidChanged = true;
      }

      if (vidChanged) touchedVid += 1;
    }

    if (!dryRun) {
      await db.run("COMMIT");
    }
  } catch (err) {
    if (!dryRun) await db.run("ROLLBACK");
    throw err;
  } finally {
    await db.close();
  }

  console.log(
    `${dryRun ? "[DRY-RUN] " : ""}Backfill finished. Updated rows: ${touchedRows}, affected vids: ${touchedVid}.`
  );
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});

