// n8n/ranking.js — Code node of paper-trading-ranking. Paste dist/n8n-ranking.js into the node.
function rankAll(keyValues, candles, now, seen) {
  const byUser = new Map();
  for (const kv of keyValues) { if (!byUser.has(kv.user_id)) byUser.set(kv.user_id, { name: kv.user && kv.user.username, kvs: [] }); byUser.get(kv.user_id).kvs.push(kv); }
  const flagged = [];
  for (const row of seen) {
    const u = byUser.get(row.user_id);
    const present = u && u.kvs.some((k) => k.key === row.key);
    if (present) continue;
    const lastReset = u ? Math.max(0, ...u.kvs.filter((k) => /^reset-/.test(k.key)).map((k) => Date.parse(k.created_at))) : 0;
    if (Date.parse(row.created_at) > lastReset && !flagged.includes(row.user_id)) flagged.push(row.user_id);
  }
  const rows = [];
  for (const [uid, u] of byUser) {
    if (flagged.includes(uid) || !u.name) continue;
    const st = replay(u.kvs, candles, now);
    if (!st.history.some((h) => h.kind === "buy")) continue;
    rows.push({ u: u.name, r: st.perf, resets: st.resets });
  }
  rows.sort((a, b) => b.r - a.r);
  const seenNow = keyValues.filter((k) => /^(o|reset)-\d+$/.test(k.key)).map((k) => ({ user_id: k.user_id, key: k.key, created_at: k.created_at }));
  return { ranking: { t: now, rows }, seenNow, flagged };
}
if (typeof module !== "undefined") module.exports = { rankAll };
