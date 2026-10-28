// n8n/ranking.js — Code node of paper-trading-ranking. Paste dist/n8n-ranking.js into the node.
// epoch ms from an ISO string, a Date, or a number (seconds if < 1e12, else ms); NaN if unparseable
function ts(x) {
  if (x instanceof Date) return x.getTime();
  if (typeof x === "number") return x < 1e12 ? x * 1000 : x;
  return typeof x === "string" ? Date.parse(x) : NaN;
}
function rankAll(keyValues, candles, now, seen) {
  const byUser = new Map();
  for (const kv of keyValues) { if (!byUser.has(kv.user_id)) byUser.set(kv.user_id, { name: kv.user && kv.user.username, kvs: [] }); byUser.get(kv.user_id).kvs.push(kv); }
  const flagged = [];
  for (const row of seen) {
    const u = byUser.get(row.user_id);
    const present = u && u.kvs.some((k) => k.key === row.key && ts(k.created_at) === ts(row.created_at));
    if (present) continue;
    const lastReset = u ? Math.max(0, ...u.kvs.filter((k) => /^reset-/.test(k.key)).map((k) => ts(k.created_at)).filter((t) => !isNaN(t))) : 0;
    const rt = ts(row.created_at); // unparseable → flag (fail closed)
    if ((isNaN(rt) || rt > lastReset) && !flagged.includes(row.user_id)) flagged.push(row.user_id);
  }
  // Discourse keeps created_at when a key is overwritten: a moved (or unparseable) updated_at after the last reset is an edited order
  for (const [uid, u] of byUser) {
    const lastReset = Math.max(0, ...u.kvs.filter((k) => /^reset-/.test(k.key)).map((k) => ts(k.created_at)).filter((t) => !isNaN(t)));
    const edited = u.kvs.some((k) => /^(o|reset)-\d+$/.test(k.key) && k.updated_at != null && ts(k.created_at) > lastReset && ts(k.updated_at) !== ts(k.created_at));
    if (edited && !flagged.includes(uid)) flagged.push(uid);
  }
  const rows = [];
  for (const [uid, u] of byUser) {
    if (flagged.includes(uid) || !u.name) continue;
    const st = replay(u.kvs, candles, now);
    if (!st.history.some((h) => h.kind === "buy")) continue;
    rows.push({ u: u.name, r: st.perf, resets: st.resets });
  }
  rows.sort((a, b) => b.r - a.r || a.u.localeCompare(b.u));
  const seenNow = keyValues.filter((k) => /^(o|reset)-\d+$/.test(k.key)).map((k) => ({ user_id: k.user_id, key: k.key, created_at: k.created_at }));
  return { ranking: { t: now, rows }, seenNow, flagged };
}
if (typeof module !== "undefined") module.exports = { rankAll, ts };
