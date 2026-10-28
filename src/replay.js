// src/replay.js — pure engine shared by the artifact and the n8n Code nodes. No DOM, no fetch.
const ASSETS = ["btc", "eth", "paxg", "xmr", "xno", "trx"];
const GROUPS = { a: ["btc", "eth", "paxg"], b: ["xmr", "xno", "trx"] };
const CANDLE = 4 * 3600;
const START_USD = 1000, MIN_USD = 10, LIQ_PCT = 0.45, SYSTEM_ID = -1;
const MODIFIED = "orden modificada después de enviarla";
const KEYS_FULL = "llegamos al límite de claves guardadas: reiniciamos para seguir operando.";

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
        if (Array.isArray(x) && (x.length === 3 || x.length === 4) && x.every(Number.isFinite)) out[a].push({ t: v.t0 + i * CANDLE, h: x[0], l: x[1], c: x[2], v: x[3] || 0 });
      });
    }
  }
  for (const a of ASSETS) out[a].sort((p, q) => p.t - q.t);
  return out;
}
function candleAt(list, sec) {
  return list.findIndex((k) => sec >= k.t && sec < k.t + CANDLE);
}

function parseOrder(kv) {
  const created = Math.floor(Date.parse(kv.created_at) / 1000);
  if (!Number.isFinite(created)) return null;
  if (/^reset-\d+$/.test(kv.key)) return { id: kv.key, created, reset: true };
  if (!/^o-\d+$/.test(kv.key)) return null;
  // Discourse keeps created_at on overwrite and bumps updated_at; an unparseable updated_at counts as modified
  const modified = kv.updated_at != null && Date.parse(kv.updated_at) !== Date.parse(kv.created_at);
  let v; try { v = JSON.parse(kv.value); } catch (e) { return null; }
  if (!v || typeof v !== "object") return null;
  const num = (x) => (x === undefined || x === null ? undefined : Number.isFinite(x) && x > 0 ? x : NaN);
  if (v.side === "sell") return typeof v.of === "string" ? { id: kv.key, created, side: "sell", of: v.of, modified } : null;
  if (v.side !== "buy" || !ASSETS.includes(v.asset)) return null;
  const usd = num(v.usd), lev = v.lev === undefined ? 1 : v.lev, tp = num(v.tp), sl = num(v.sl);
  if (!(usd >= MIN_USD) || (lev !== 1 && lev !== 2) || Number.isNaN(tp) || Number.isNaN(sl)) return null;
  return { id: kv.key, created, side: "buy", asset: v.asset, usd, lev, tp, sl, modified };
}

// Replays every order against the candles. Fills (liq, sl, tp) happen inside a candle; orders fill at its close.
function replay(keyValues, candles, now) {
  const all = keyValues.map(parseOrder).filter(Boolean).sort((a, b) => a.created - b.created || (a.id < b.id ? -1 : 1));
  const resets = all.filter((o) => o.reset);
  const last = resets[resets.length - 1];
  const orders = all.filter((o) => !o.reset && (!last || o.created > last.created));
  const st = { balance: START_USD, equity: START_USD, perf: 0, resets: resets.length, positions: [], pending: [], history: [] };
  if (last) st.history.push({ t: last.created, kind: "reset", id: last.id });
  const closed = (k) => k.t + CANDLE <= now;
  const closePos = (p, kind, price, t) => {
    const pnl = p.qty * (price - p.entry);
    const back = kind === "liq" ? 0 : Math.max(0, p.usd + pnl);
    st.balance += back;
    st.positions.splice(st.positions.indexOf(p), 1);
    st.history.push({ t, kind, asset: p.asset, price, usd: back, pnl: kind === "liq" ? -p.usd : pnl, id: p.id });
  };
  const times = [...new Set(ASSETS.flatMap((a) => candles[a].map((k) => k.t)))].sort((a, b) => a - b);
  let qi = 0;
  for (const t of times) {
    const byAsset = Object.fromEntries(ASSETS.map((a) => [a, candles[a].find((k) => k.t === t)]));
    if (!closed({ t })) break;
    for (const p of [...st.positions]) {
      const k = byAsset[p.asset];
      if (!k || k.t <= p.openedAt) continue;
      // Falling price reaches the higher level first: an SL above the liquidation price wins
      if (p.sl && k.l <= p.sl && !(p.liq && p.sl < p.liq && k.l <= p.liq)) closePos(p, "sl", Math.min(p.sl, k.h), t);
      else if (p.liq && k.l <= p.liq) closePos(p, "liq", Math.min(p.liq, k.h), t);
      else if (p.tp && k.h >= p.tp) closePos(p, "tp", Math.max(p.tp, k.l), t);
    }
    // Orders created inside this candle fill at its close
    for (; qi < orders.length && orders[qi].created < t + CANDLE; qi++) {
      const o = orders[qi];
      const tc = t + CANDLE;
      if (o.created < t) { st.history.push({ t: o.created, kind: "invalid", id: o.id, why: "Sin velas publicadas para esa fecha" }); continue; }
      if (o.modified) { st.history.push({ t: tc, kind: "invalid", id: o.id, why: MODIFIED }); continue; }
      if (o.side === "sell") {
        const p = st.positions.find((x) => x.id === o.of);
        if (!p) { st.history.push({ t: tc, kind: "invalid", id: o.id, why: "La posición ya estaba cerrada" }); continue; }
        if (!byAsset[p.asset]) { st.history.push({ t: tc, kind: "invalid", id: o.id, why: "Sin vela de " + p.asset.toUpperCase() }); continue; }
        closePos(p, "sell", byAsset[p.asset].c, tc);
        continue;
      }
      const k = byAsset[o.asset];
      if (!k) { st.history.push({ t: tc, kind: "invalid", id: o.id, why: "Sin vela de " + o.asset.toUpperCase() }); continue; }
      if (o.usd > st.balance + 1e-9) { st.history.push({ t: tc, kind: "invalid", id: o.id, why: "Saldo insuficiente" }); continue; }
      if ((o.sl && o.sl >= k.c) || (o.tp && o.tp <= k.c)) { st.history.push({ t: tc, kind: "invalid", id: o.id, why: "SL o TP del lado equivocado del precio de entrada" }); continue; }
      st.balance -= o.usd;
      const entry = k.c, qty = (o.usd * o.lev) / entry;
      st.positions.push({ id: o.id, asset: o.asset, lev: o.lev, usd: o.usd, qty, entry, tp: o.tp, sl: o.sl, liq: o.lev === 2 ? entry * (1 - LIQ_PCT) : undefined, openedAt: t, value: o.usd, pnl: 0 });
      st.history.push({ t: tc, kind: "buy", asset: o.asset, price: entry, usd: o.usd, id: o.id });
    }
  }
  for (; qi < orders.length; qi++) {
    const o = orders[qi];
    const lastT = times.length ? times[times.length - 1] : null;
    if (lastT === null || o.created < lastT) { st.history.push({ t: o.created, kind: "invalid", id: o.id, why: "Sin velas publicadas para esa fecha" }); continue; }
    if (o.modified) { st.history.push({ t: o.created, kind: "invalid", id: o.id, why: MODIFIED }); continue; }
    st.pending.push({ ...o, fillAt: Math.floor(o.created / CANDLE) * CANDLE + CANDLE });
  }
  for (const p of st.positions) {
    const list = candles[p.asset].filter(closed);
    const c = list.length ? list[list.length - 1].c : p.entry;
    p.pnl = p.qty * (c - p.entry);
    p.value = Math.max(0, p.usd + p.pnl);
  }
  st.equity = st.balance + st.positions.reduce((a, p) => a + p.value, 0);
  st.perf = Math.round(((st.equity / START_USD) - 1) * 10000) / 100;
  return st;
}

// Validates a buy before writing it. Messages are what the form shows; equality with ref is rejected.
function checkOrder(o, ref, balance, keyCount) {
  if (keyCount >= 95) return KEYS_FULL; // the last 5 of the 100 keys stay free for closing positions
  if (!Number.isFinite(ref) || ref <= 0) return "sin precio de referencia todavía.";
  if (!(o.usd >= MIN_USD)) return "el monto mínimo es 10 USD.";
  if (o.usd > balance) return "el monto supera el saldo disponible.";
  if (o.tp !== undefined && !(o.tp > ref)) return "el take-profit va por encima del precio actual.";
  if (o.sl !== undefined && !(o.sl < ref)) return "el stop-loss va por debajo del precio actual.";
  if (o.lev === 2 && o.sl !== undefined && o.sl <= ref * (1 - LIQ_PCT)) return "con 2x el stop-loss va por encima del precio de liquidación.";
  return "";
}

const api = { checkOrder, KEYS_FULL, ASSETS, GROUPS, CANDLE, START_USD, MIN_USD, LIQ_PCT, SYSTEM_ID, weekStart, weekKey, mergeCandles, candleAt, parseOrder, replay };
if (typeof module !== "undefined") module.exports = api; else if (typeof window !== "undefined") window.Replay = api;
