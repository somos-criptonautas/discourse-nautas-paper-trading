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
assert.deepStrictEqual(merged.btc, [{ t: mon, h: 10, l: 9, c: 9.5 }, { t: mon + R.CANDLE, h: 11, l: 9.5, c: 10.5 }]);
assert.deepStrictEqual(merged.xmr, []); // la clave de un usuario cualquiera se ignora
assert.strictEqual(R.candleAt(merged.btc, mon + 5000), 0);
assert.strictEqual(R.candleAt(merged.btc, mon + R.CANDLE), 1);
assert.strictEqual(R.candleAt(merged.btc, mon - 1), -1);
assert.strictEqual(R.candleAt(merged.btc, mon + 3 * R.CANDLE), -1);
console.log("replay ok");
