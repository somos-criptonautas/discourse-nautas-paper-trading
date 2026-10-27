const assert = require("assert");
const fs = require("fs"), vm = require("vm");
const R = require("../src/replay.js");
// Each n8n script defines functions only; load it into a sandbox together with the engine
function load(name) { const ctx = { module: {}, console }; vm.createContext(ctx); vm.runInContext(fs.readFileSync("src/replay.js", "utf8") + "\n" + fs.readFileSync(`n8n/${name}.js`, "utf8"), ctx); return ctx; }
const P = load("prices");
const plain = (x) => JSON.parse(JSON.stringify(x)); // vm arrays have another realm prototype; deepStrictEqual rejects them
const mon = Date.UTC(2026, 9, 26) / 1000, H = R.CANDLE;
const row = (t, h, l, c, v) => [t, "0", String(h), String(l), String(c), "0", String(v), 1];
const ohlc = { btc: [row(mon, 10, 9, 9.5, 100), row(mon + H, 11, 9.5, 10.5, 50), row(mon + 3 * H, 12, 10, 11, 25)], eth: [row(mon, 2, 1, 1.5, 7)] };
let out = P.weeklyKeys(ohlc, mon + 3 * H + 60, false);
assert.deepStrictEqual(plain(out.map((o) => o.key)), ["candles-2026-W43-a", "candles-2026-W43-b", "candles-2026-W44-a", "candles-2026-W44-b"]);
const a = JSON.parse(out[2].value);
assert.strictEqual(a.t0, mon);
assert.deepStrictEqual(a.btc, [[10, 9, 9.5, 100], [11, 9.5, 10.5, 50], [10.5, 10.5, 10.5, 0], [12, 10, 11, 25]]); // gap at index 2 filled flat
assert.deepStrictEqual(a.eth, [[2, 1, 1.5, 7]]);
assert.deepStrictEqual(a.paxg, []); // missing asset → empty list
assert.deepStrictEqual(JSON.parse(out[0].value).btc, []); // previous week has no candles in this response
// Four significant digits
out = P.weeklyKeys({ trx: [row(mon, 0.123456, 0.1, 0.11111, 1828483.4)] }, mon, false);
assert.deepStrictEqual(JSON.parse(out.filter((o) => o.key.endsWith("-b")).pop().value).trx[0], [0.1235, 0.1, 0.1111, 1828000]);
// Backfill writes every week present
const old = mon - 3 * 7 * 86400;
out = P.weeklyKeys({ btc: [row(old, 1, 1, 1, 1), row(mon, 2, 2, 2, 2)] }, mon, true);
assert.deepStrictEqual(plain(out.map((o) => o.key)), ["candles-2026-W41-a", "candles-2026-W41-b", "candles-2026-W44-a", "candles-2026-W44-b"]);
assert.ok(out.every((o) => o.value.length < 5000));
assert.deepStrictEqual(plain(P.nowFrom(ohlc, mon + 4 * H)), { t: mon + 4 * H, btc: 11, eth: 1.5 });
console.log("n8n prices ok");
