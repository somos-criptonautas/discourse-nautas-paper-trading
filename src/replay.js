// src/replay.js — pure engine shared by the artifact and the n8n Code nodes. No DOM, no fetch.
const ASSETS = ["btc", "eth", "paxg", "xmr", "xno", "trx"];
const GROUPS = { a: ["btc", "eth", "paxg"], b: ["xmr", "xno", "trx"] };
const CANDLE = 4 * 3600;
const START_USD = 1000, MIN_USD = 10, LIQ_PCT = 0.45, SYSTEM_ID = -1;

function weekStart(sec) {
  const d = new Date(sec * 1000);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow) / 1000;
}
function weekKey(sec, group) {
  const thu = new Date((weekStart(sec) + 3 * 86400) * 1000); // ISO year is the Thursday's year
  const y = thu.getUTCFullYear();
  const week = Math.floor((weekStart(sec) - weekStart(Date.UTC(y, 0, 4) / 1000)) / (7 * 86400)) + 1;
  return "candles-" + y + "-W" + String(week).padStart(2, "0") + "-" + group;
}
function mergeCandles(res) {
  const out = Object.fromEntries(ASSETS.map((a) => [a, []]));
  for (const kv of (res && res.key_values) || []) {
    if (kv.user_id !== SYSTEM_ID || !/^candles-/.test(kv.key)) continue;
    let v; try { v = JSON.parse(kv.value); } catch (e) { continue; }
    if (!v || !Number.isFinite(v.t0)) continue;
    for (const a of ASSETS) {
      (v[a] || []).forEach((x, i) => {
        if (Array.isArray(x) && x.length === 3 && x.every(Number.isFinite)) out[a].push({ t: v.t0 + i * CANDLE, h: x[0], l: x[1], c: x[2] });
      });
    }
  }
  for (const a of ASSETS) out[a].sort((p, q) => p.t - q.t);
  return out;
}
function candleAt(list, sec) {
  return list.findIndex((k) => sec >= k.t && sec < k.t + CANDLE);
}

const api = { ASSETS, GROUPS, CANDLE, START_USD, MIN_USD, LIQ_PCT, SYSTEM_ID, weekStart, weekKey, mergeCandles, candleAt };
if (typeof module !== "undefined") module.exports = api; else window.Replay = api;
