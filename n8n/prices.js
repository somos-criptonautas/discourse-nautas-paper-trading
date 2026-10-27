// n8n/prices.js — Code node of paper-trading-prices. Paste dist/n8n-prices.js (engine + this) into the node.
const KRAKEN_PAIRS = { btc: "XBTUSD", eth: "ETHUSD", paxg: "PAXGUSD", xmr: "XMRUSD", xno: "NANOUSD", trx: "TRXUSD" };
const sig4 = (x) => Number(Number(x).toPrecision(4));

function weeklyKeys(ohlc, now, backfill) {
  const weeks = new Set(backfill ? [] : [weekStart(now), weekStart(now - 7 * 86400)]);
  if (backfill) for (const a of ASSETS) for (const r of ohlc[a] || []) weeks.add(weekStart(+r[0]));
  const out = [];
  for (const t0 of [...weeks].sort((p, q) => p - q)) {
    for (const g of Object.keys(GROUPS)) {
      const v = { t0 };
      for (const a of GROUPS[g]) {
        const rows = [];
        for (const r of ohlc[a] || []) {
          const i = Math.floor((+r[0] - t0) / CANDLE);
          if (i < 0 || i >= 42) continue;
          while (rows.length < i) { const c = rows.length ? rows[rows.length - 1][2] : sig4(r[4]); rows.push([c, c, c, 0]); } // gap: flat candle at last close
          rows[i] = [sig4(r[2]), sig4(r[3]), sig4(r[4]), sig4(r[6])];
        }
        v[a] = rows;
      }
      out.push({ key: weekKey(t0, g), value: JSON.stringify(v) });
    }
  }
  return out;
}

function nowFrom(ohlc, now) {
  const n = { t: now };
  for (const a of ASSETS) { const rows = ohlc[a] || []; if (rows.length) n[a] = sig4(rows[rows.length - 1][4]); }
  return n;
}
if (typeof module !== "undefined") module.exports = { KRAKEN_PAIRS, weeklyKeys, nowFrom };
