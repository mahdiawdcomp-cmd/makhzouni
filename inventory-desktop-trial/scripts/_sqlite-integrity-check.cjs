// Helper for verify-backup.ps1 — runs PRAGMA integrity_check on a SQLite file
// using Node's built-in node:sqlite (Node >= 22). Read-only. Prints one line:
//   INTEGRITY:ok            (or the actual result)
//   ENGINE_UNAVAILABLE:...  (node:sqlite missing or file unreadable)
// Usage: node _sqlite-integrity-check.cjs <path-to-db>
try {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(process.argv[2], { readOnly: true });
  const r = db.prepare('PRAGMA integrity_check').all();
  db.close();
  console.log('INTEGRITY:' + r.map((x) => x.integrity_check).join(','));
} catch (e) {
  console.log('ENGINE_UNAVAILABLE:' + (e.code || e.message));
}
