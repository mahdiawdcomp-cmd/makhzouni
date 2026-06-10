#!/usr/bin/env node
/**
 * مولّد مفاتيح الترخيص — مخزوني
 * ─────────────────────────────────
 * الاستخدام:
 *   node scripts/generate-license.js --client "شركة الأمانة" --months 12
 *   node scripts/generate-license.js --client "Company Name" --months 6 --id "custom-uuid"
 *
 * يتطلب: ملف LICENSE_PRIVATE_KEY.pem في نفس المجلد (غير محفوظ في Git)
 */

const fs   = require("fs");
const path = require("path");
// Resolve jsonwebtoken from backend node_modules
const jwt  = require(path.join(__dirname, "../inventory-backend/node_modules/jsonwebtoken"));
const { randomUUID } = require("crypto");

// ── Parse CLI args ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function arg(flag) {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
}

const clientName = arg("--client");
const months     = parseInt(arg("--months") || "12", 10);
const clientId   = arg("--id") || randomUUID();

if (!clientName) {
  console.error("❌  الاستخدام: node scripts/generate-license.js --client \"اسم الشركة\" --months 12");
  process.exit(1);
}

// ── Load private key ──────────────────────────────────────────────────────────
const keyPath = path.join(__dirname, "LICENSE_PRIVATE_KEY.pem");
if (!fs.existsSync(keyPath)) {
  console.error(`❌  لم يُعثر على المفتاح الخاص: ${keyPath}`);
  console.error("    أنشئ الملف وضع فيه المفتاح الخاص (PKCS#8 PEM).");
  process.exit(1);
}
const privateKey = fs.readFileSync(keyPath, "utf-8");

// ── Generate JWT ──────────────────────────────────────────────────────────────
const now     = Math.floor(Date.now() / 1000);
const expSecs = now + months * 30 * 24 * 3600;

const token = jwt.sign(
  { sub: clientId, name: clientName },
  privateKey,
  { algorithm: "RS256", expiresIn: `${months * 30}d`, issuer: "makhzouni" }
);

const expiresAt = new Date(expSecs * 1000).toISOString().slice(0, 10);

console.log("\n✅  تم إنشاء مفتاح الترخيص\n");
console.log(`   العميل  : ${clientName}`);
console.log(`   المعرّف : ${clientId}`);
console.log(`   الصلاحية: ${months} شهر (حتى ${expiresAt})\n`);
console.log("── LICENSE_KEY ─────────────────────────────────────────────────────────────");
console.log(token);
console.log("────────────────────────────────────────────────────────────────────────────\n");
console.log("📋  انسخ المفتاح أعلاه واضبطه كمتغير بيئي في Railway:");
console.log("    LICENSE_KEY=<المفتاح أعلاه>\n");
