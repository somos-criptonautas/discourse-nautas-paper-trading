// n8n/daily.js — Code node of paper-trading-daily. Paste dist/n8n-daily.js into the node.
function dailySummary(keyValues, candles, now) {
  const byUser = new Map();
  for (const kv of keyValues) { if (!byUser.has(kv.user_id)) byUser.set(kv.user_id, []); byUser.get(kv.user_id).push(kv); }
  const n = { buy: 0, sell: 0, tp: 0, sl: 0, liq: 0 }, users = new Set();
  for (const [uid, kvs] of byUser) {
    for (const h of replay(kvs, candles, now).history) {
      if (h.t <= now - 86400 || h.t > now || !(h.kind in n)) continue;
      n[h.kind]++; users.add(uid);
    }
  }
  if (!users.size) return "";
  const part = (k, one, many) => (n[k] ? n[k] + " " + (n[k] === 1 ? one : many) : "");
  const items = [part("buy", "compra", "compras"), part("sell", "cierre manual", "cierres manuales"), part("tp", "take-profit", "take-profits"), part("sl", "stop-loss", "stop-loss"), part("liq", "liquidación", "liquidaciones")].filter(Boolean);
  return "**paper trading, últimas 24h:** " + items.join(", ") + ". operaron " + users.size + (users.size === 1 ? " participante" : " participantes") + ". sin nombres: cada quien ve lo suyo en el artifact.";
}
if (typeof module !== "undefined") module.exports = { dailySummary };
