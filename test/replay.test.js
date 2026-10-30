// test/replay.test.js
const assert = require("assert");
const R = require("../src/replay.js");

// 2026-10-26 es lunes; 2026-10-28 12:00 UTC cae en la semana ISO 44
const mon = Date.UTC(2026, 9, 26) / 1000, wed = Date.UTC(2026, 9, 28, 12, 30) / 1000;
assert.strictEqual(R.weekStart(wed), mon);
assert.strictEqual(R.weekKey(wed, "a"), "candles-2026-W44-a");
assert.strictEqual(R.weekKey(Date.UTC(2027, 0, 1) / 1000, "b"), "candles-2026-W53-b"); // el 1/1/2027 pertenece a la W53 de 2026

const wk = (t0, group, candles) => ({ user_id: -1, key: R.weekKey(t0, group), value: JSON.stringify({ t0, ...Object.fromEntries(R.GROUPS[group].map((a) => [a, candles])) }) });
const flat = [[10, 9, 9.5], [11, 9.5, 10.5]];
const merged = R.mergeCandles({ key_values: [wk(mon, "a", flat), { user_id: 7, key: R.weekKey(mon, "b"), value: "{}" }, { user_id: -1, key: "now", value: "{}" }] });
assert.deepStrictEqual(merged.btc, [{ t: mon, h: 10, l: 9, c: 9.5, v: 0 }, { t: mon + R.CANDLE, h: 11, l: 9.5, c: 10.5, v: 0 }]);
const vol = R.mergeCandles({ key_values: [wk(mon, "a", [[10, 9, 9.5, 123], [1, 2, 3, 4, 5], [1, 2, 3, "x"]])] });
assert.deepStrictEqual(vol.btc, [{ t: mon, h: 10, l: 9, c: 9.5, v: 123 }]); // 4 elements keep v; 5 or a non-numeric v is ignored
assert.deepStrictEqual(merged.xmr, []); // la clave de un usuario cualquiera se ignora
assert.strictEqual(R.candleAt(merged.btc, mon + 5000), 0);
assert.strictEqual(R.candleAt(merged.btc, mon + R.CANDLE), 1);
assert.strictEqual(R.candleAt(merged.btc, mon - 1), -1);
assert.strictEqual(R.candleAt(merged.btc, mon + 3 * R.CANDLE), -1);
// --- replay ---
const T0 = mon; // la semana empieza en mon; velas i = 0..41
const kvs = (orders) => orders.map(([ms, value]) => ({ key: (value === "1" ? "reset-" : "o-") + ms, value, created_at: new Date(ms).toISOString() }));
const at = (i, plus = 60) => (T0 + i * R.CANDLE + plus) * 1000; // ms dentro de la vela i
const candles = (btc) => ({ ...Object.fromEntries(R.ASSETS.map((a) => [a, []])), btc: btc.map((x, i) => ({ t: T0 + i * R.CANDLE, h: x[0], l: x[1], c: x[2] })) });
const buy = (usd, extra = {}) => JSON.stringify({ asset: "btc", side: "buy", usd, lev: 1, ...extra });
const NOW = T0 + 10 * R.CANDLE; // 10 velas cerradas

// parseOrder
assert.deepStrictEqual(R.parseOrder({ key: "reset-5", value: "1", created_at: "1970-01-01T00:00:05.000Z" }), { id: "reset-5", created: 5, reset: true });
assert.strictEqual(R.parseOrder({ key: "o-1", value: "{roto", created_at: "1970-01-01T00:00:01.000Z" }), null);
assert.strictEqual(R.parseOrder({ key: "o-1", value: buy(5), created_at: "1970-01-01T00:00:01.000Z" }), null); // menos del mínimo
assert.strictEqual(R.parseOrder({ key: "o-1", value: JSON.stringify({ asset: "doge", side: "buy", usd: 50, lev: 1 }), created_at: "1970-01-01T00:00:01.000Z" }), null);
assert.strictEqual(R.parseOrder({ key: "o-1", value: buy(50, { lev: 3 }), created_at: "1970-01-01T00:00:01.000Z" }), null);
assert.strictEqual(R.parseOrder({ key: "r", value: "{}", created_at: "1970-01-01T00:00:01.000Z" }), null); // otra clave cualquiera

// Sin órdenes: saldo inicial
let s = R.replay([], candles([[10, 9, 10]]), NOW);
assert.deepStrictEqual([s.balance, s.equity, s.perf, s.resets, s.positions.length], [1000, 1000, 0, 0, 0]);

// Compra en la vela 0 (cierra a 10) y TP en la vela 2 (máximo 13 ≥ tp 12)
s = R.replay(kvs([[at(0), buy(100, { tp: 12, sl: 8 })]]), candles([[10, 9, 10], [11, 9.5, 11], [13, 10, 12.5]]), NOW);
assert.strictEqual(s.positions.length, 0);
assert.deepStrictEqual(s.history.map((h) => h.kind), ["buy", "tp"]);
assert.strictEqual(s.history[1].price, 12);
assert.strictEqual(Math.round(s.balance * 100) / 100, 1020); // 100 USD → 10 unidades → vendidas a 12 = 120

// SL: mínimo 7 ≤ sl 8 → sale a 8
s = R.replay(kvs([[at(0), buy(100, { tp: 12, sl: 8 })]]), candles([[10, 9, 10], [11, 7, 9]]), NOW);
assert.deepStrictEqual(s.history.map((h) => h.kind), ["buy", "sl"]);
assert.strictEqual(s.balance, 980);

// Misma vela toca SL y TP: gana el SL
s = R.replay(kvs([[at(0), buy(100, { tp: 12, sl: 8 })]]), candles([[10, 9, 10], [13, 7, 10]]), NOW);
assert.strictEqual(s.history[1].kind, "sl");

// 2x: 100 de margen, posición 200, 20 unidades, liq = 5.5. Mínimo 5 → liquidada, se pierde el margen
s = R.replay(kvs([[at(0), buy(100, { lev: 2 })]]), candles([[10, 9, 10], [10, 5, 6]]), NOW);
assert.strictEqual(s.history[1].kind, "liq");
assert.strictEqual(s.balance, 900);
// 2x con SL 7 por encima de la liquidación: sale por SL, pierde 20*(10-7)=60
s = R.replay(kvs([[at(0), buy(100, { lev: 2, sl: 7 })]]), candles([[10, 9, 10], [10, 5, 6]]), NOW);
assert.strictEqual(s.history[1].kind, "sl");
assert.strictEqual(s.balance, 940);
// 2x sin tocar nada: posición abierta valuada al último cierre 11 → pnl 20
s = R.replay(kvs([[at(0), buy(100, { lev: 2 })]]), candles([[10, 9, 10], [11.5, 9.8, 11]]), NOW);
assert.deepStrictEqual([s.positions[0].qty, s.positions[0].liq, s.positions[0].pnl, s.balance, s.equity], [20, 5.5, 20, 900, 1020]);

// Dos posiciones del mismo activo; cerrar una a mano al cierre de la vela 2 (12)
s = R.replay(kvs([[at(0), buy(100)], [at(0, 120), buy(50)], [at(2), JSON.stringify({ side: "sell", of: "o-" + at(0) })]]),
  candles([[10, 9, 10], [11, 9.5, 11], [12.5, 10, 12]]), NOW);
assert.strictEqual(s.positions.length, 1);
assert.strictEqual(s.positions[0].usd, 50);
assert.strictEqual(s.history.filter((h) => h.kind === "sell").length, 1);
assert.strictEqual(s.balance, 850 + 120); // 1000 - 150 + 10 unidades * 12

// Venta de una posición inexistente o ya cerrada → invalid
s = R.replay(kvs([[at(0), JSON.stringify({ side: "sell", of: "o-999" })]]), candles([[10, 9, 10]]), NOW);
assert.strictEqual(s.history[0].kind, "invalid");
// Compra mayor que el saldo disponible al momento de ejecutar → invalid
s = R.replay(kvs([[at(0), buy(900)], [at(0, 120), buy(200)]]), candles([[10, 9, 10]]), NOW);
assert.deepStrictEqual(s.history.map((h) => h.kind), ["buy", "invalid"]);

// Reset en medio: lo anterior se ignora, saldo vuelve a 1000, resets = 1
s = R.replay(kvs([[at(0), buy(500)], [at(1), "1"], [at(2), buy(100)]]), candles([[10, 9, 10], [10, 9, 10], [10, 9, 10]]), NOW);
assert.deepStrictEqual([s.resets, s.balance, s.positions.length, s.history[0].kind], [1, 900, 1, "reset"]);

// Orden en la vela aún abierta → pendiente, con hora de ejecución
s = R.replay(kvs([[at(10), buy(100)]]), candles([[10, 9, 10]]), NOW + 100);
assert.strictEqual(s.pending.length, 1);
assert.strictEqual(s.pending[0].fillAt, T0 + 11 * R.CANDLE);
// Orden anterior a todo el historial de velas → invalid con motivo
s = R.replay(kvs([[(T0 - 10 * R.CANDLE) * 1000, buy(100)]]), candles([[10, 9, 10]]), NOW);
assert.strictEqual(s.history[0].kind, "invalid");
assert.match(s.history[0].why, /velas/);

// Wrong-side levels never open a position
s = R.replay(kvs([[at(0), buy(100, { sl: 12 })]]), candles([[10, 9, 10], [11, 9, 10]]), NOW);
assert.deepStrictEqual([s.history.map((h) => h.kind), s.balance, s.positions.length], [["invalid"], 1000, 0]);
s = R.replay(kvs([[at(0), buy(100, { tp: 5 })]]), candles([[10, 9, 10], [11, 9, 10]]), NOW);
assert.deepStrictEqual([s.history.map((h) => h.kind), s.balance], [["invalid"], 1000]);
// Gap exit clamps to the candle range: sl 8 but the candle only traded 6-7
s = R.replay(kvs([[at(0), buy(100, { sl: 8 })]]), candles([[10, 9, 10], [7, 6, 6.5]]), NOW);
assert.deepStrictEqual([s.history[1].kind, s.history[1].price, s.balance], ["sl", 7, 970]);
// Sell while the asset has no candle (other assets do) is invalid, not a crash
{
  const c = candles([[10, 9, 10], [10, 9, 10]]);
  c.eth = [0, 1, 2].map((i) => ({ t: T0 + i * R.CANDLE, h: 5, l: 5, c: 5 }));
  s = R.replay(kvs([[at(0), buy(100)], [at(2), JSON.stringify({ side: "sell", of: "o-" + at(0) })]]), c, NOW);
  assert.deepStrictEqual(s.history.map((h) => h.kind), ["buy", "invalid"]);
  assert.strictEqual(s.positions.length, 1);
}

// An order overwritten after sending (updated_at moved) never executes; equal or absent updated_at is fine
{
  const [o] = kvs([[at(0), buy(900)]]);
  s = R.replay([{ ...o, updated_at: new Date(at(1)).toISOString() }], candles([[10, 9, 10], [10, 9, 10]]), NOW);
  assert.deepStrictEqual([s.history.map((h) => h.kind), s.history[0].why, s.balance], [["invalid"], "orden modificada después de enviarla", 1000]);
  s = R.replay([{ ...o, updated_at: "garbage" }], candles([[10, 9, 10]]), NOW);
  assert.deepStrictEqual(s.history.map((h) => h.kind), ["invalid"]);
  s = R.replay([{ ...o, updated_at: o.created_at }], candles([[10, 9, 10]]), NOW);
  assert.deepStrictEqual(s.history.map((h) => h.kind), ["buy"]);
  const [late] = kvs([[at(10), buy(100)]]); // still pending when modified: invalid too, not pending
  s = R.replay([{ ...late, updated_at: new Date(at(10, 600)).toISOString() }], candles([[10, 9, 10]]), NOW + 100);
  assert.deepStrictEqual([s.pending.length, s.history.map((h) => h.kind)], [0, ["invalid"]]);
}

// checkOrder: live form validation (equality with the reference price is rejected)
assert.strictEqual(R.checkOrder({ asset: "btc", usd: 100, lev: 1 }, 10, 1000, 3), "");
assert.match(R.checkOrder({ asset: "btc", usd: 5, lev: 1 }, 10, 1000, 3), /10 USD/);
assert.match(R.checkOrder({ asset: "btc", usd: 1001, lev: 1 }, 10, 1000, 3), /saldo/);
assert.match(R.checkOrder({ asset: "btc", usd: 100, lev: 1, tp: 9 }, 10, 1000, 3), /take-profit/);
assert.match(R.checkOrder({ asset: "btc", usd: 100, lev: 1, sl: 11 }, 10, 1000, 3), /stop-loss/);
assert.match(R.checkOrder({ asset: "btc", usd: 100, lev: 2, sl: 5 }, 10, 1000, 3), /liquidación/); // liq = 5.5
assert.match(R.checkOrder({ asset: "btc", usd: 100, lev: 1 }, 10, 1000, 95), /claves/); // buys stop at 95 so a sell always fits
assert.strictEqual(R.checkOrder({ asset: "btc", usd: 100, lev: 1 }, 10, 1000, 94), "");
assert.match(R.KEYS_FULL, /claves/);
assert.match(R.checkOrder({ asset: "btc", usd: 100, lev: 1 }, null, 1000, 3), /precio/);
assert.match(R.checkOrder({ asset: "btc", usd: 100, lev: 1, tp: 10 }, 10, 1000, 3), /take-profit/);
assert.match(R.checkOrder({ asset: "btc", usd: 100, lev: 1, sl: 10 }, 10, 1000, 3), /stop-loss/);

console.log("replay ok");

// --- seasons ---
const u = (y, m, d, h = 0, mi = 0, s = 0) => Date.UTC(y, m, d, h, mi, s) / 1000;
assert.strictEqual(R.seasonStart(u(2026, 9, 28)), u(2026, 8, 1));
assert.strictEqual(R.seasonEnd(u(2026, 9, 28)), u(2027, 0, 1));
assert.strictEqual(R.seasonStart(u(2027, 0, 1)), u(2027, 0, 1));
assert.strictEqual(R.seasonStart(u(2026, 11, 31, 23, 59, 59)), u(2026, 8, 1));
assert.strictEqual(R.seasonStart(u(2027, 3, 30)), u(2027, 0, 1));
assert.strictEqual(R.seasonEnd(u(2027, 3, 30)), u(2027, 4, 1));
assert.strictEqual(R.seasonStart(u(2027, 4, 1)), u(2027, 4, 1));
{
  const S = u(2026, 8, 1), sNow = T0 + 10 * R.CANDLE; // T0 sits inside the Sep-Dec 2026 season
  const old = (ms, v) => ({ key: (v === "1" ? "reset-" : "o-") + ms, value: v, created_at: new Date(ms).toISOString() });
  const prev = old((S - 86400) * 1000, buy(500)), prevReset = old((S - 86400) * 1000 + 1, "1");
  let s = R.replay([prev, prevReset, ...kvs([[at(1), buy(100)]])], candles([[10, 9, 10], [13, 9.5, 12], [13, 9.5, 12]]), sNow);
  assert.strictEqual(s.resets, 0);
  assert.strictEqual(s.history.filter((h) => h.kind === "invalid" || h.kind === "reset").length, 0);
  assert.strictEqual(s.history.filter((h) => h.kind === "buy").length, 1);
  assert.deepStrictEqual(s.season, { start: S, end: u(2027, 0, 1) });
  s = R.replay([prev], candles([[10, 9, 10]]), sNow);
  assert.strictEqual(s.balance, 1000); assert.strictEqual(s.history.length, 0);
}
// From LEAD_FROM, an order from the last hour of a candle fills at the next close, so the hourly ranking sees it first
{
  const L0 = Date.UTC(2026, 10, 2) / 1000, inL = (i, plus) => (L0 + i * R.CANDLE + plus) * 1000;
  const lc = (rows) => ({ ...Object.fromEntries(R.ASSETS.map((a) => [a, []])), btc: rows.map((x, i) => ({ t: L0 + i * R.CANDLE, h: x[0], l: x[1], c: x[2] })) });
  const rows = [[10, 9, 10], [20, 19, 20], [30, 29, 30]], lNow = L0 + 3 * R.CANDLE;
  assert.strictEqual(R.fillCandle(L0 - 60), Math.floor((L0 - 60) / R.CANDLE) * R.CANDLE); // older orders keep the old rule
  let s = R.replay(kvs([[inL(0, R.CANDLE - 3601), buy(100)]]), lc(rows), lNow);
  assert.strictEqual(s.positions[0].entry, 10); // more than an hour before the close: fills at this close
  s = R.replay(kvs([[inL(0, R.CANDLE - 600), buy(100)]]), lc(rows), lNow);
  assert.strictEqual(s.positions[0].entry, 20); // last hour: fills at the next close
  s = R.replay(kvs([[inL(2, R.CANDLE - 600), buy(100)]]), lc(rows), lNow);
  assert.strictEqual(s.pending[0].fillAt, L0 + 4 * R.CANDLE);
}
