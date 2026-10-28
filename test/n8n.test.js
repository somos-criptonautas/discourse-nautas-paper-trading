const assert = require("assert");
const fs = require("fs"), vm = require("vm");
const R = require("../src/replay.js");
// Each n8n script defines functions only; load it into a sandbox together with the engine
function load(name) { const ctx = { module: {}, console }; vm.createContext(ctx); vm.runInContext(fs.readFileSync("src/replay.js", "utf8") + "\n" + fs.readFileSync(`n8n/${name}.js`, "utf8"), ctx); return ctx; }
const P = load("prices");
const plain = (x) => JSON.parse(JSON.stringify(x)); // vm arrays have another realm prototype; deepStrictEqual rejects them
const mon = Date.UTC(2026, 9, 26) / 1000, H = R.CANDLE;
const row = (t, h, l, c, v) => [t, "0", String(h), String(l), String(c), "0", String(v), 1];
const ohlc = { btc: [row(mon, 10, 9, 9.5, 100), row(mon + H, 11, 9.5, 10.5, 50), row(mon + 3 * H, 12, 10, 11, 25)], eth: [row(mon, 2, 1, 1.5, 7)], paxg: [row(mon, 3, 3, 3, 1)], xmr: [row(mon, 4, 4, 4, 1)], xno: [] };
let out = P.weeklyKeys(ohlc, mon + 3 * H + 60, false);
// group b misses trx (and xno is empty): its key is skipped, never overwritten with empty lists
assert.deepStrictEqual(plain(out.map((o) => o.key)), ["candles-2026-W43-a", "candles-2026-W44-a"]);
const a = JSON.parse(out[1].value);
assert.strictEqual(a.t0, mon);
assert.deepStrictEqual(a.btc, [[10, 9, 9.5, 100], [11, 9.5, 10.5, 50], [10.5, 10.5, 10.5, 0], [12, 10, 11, 25]]); // gap at index 2 filled flat
assert.deepStrictEqual(a.eth, [[2, 1, 1.5, 7]]);
assert.deepStrictEqual(a.paxg, [[3, 3, 3, 1]]);
assert.deepStrictEqual(JSON.parse(out[0].value).btc, []); // previous week has no candles in this response
// Four significant digits
out = P.weeklyKeys({ xmr: [row(mon, 1, 1, 1, 1)], xno: [row(mon, 1, 1, 1, 1)], trx: [row(mon, 0.123456, 0.1, 0.11111, 1828483.4)] }, mon, false);
assert.deepStrictEqual(JSON.parse(out.filter((o) => o.key.endsWith("-b")).pop().value).trx[0], [0.1235, 0.1, 0.1111, 1828000]);
// Backfill writes every week present
const old = mon - 3 * 7 * 86400;
out = P.weeklyKeys({ btc: [row(old, 1, 1, 1, 1), row(mon, 2, 2, 2, 2)], eth: [row(mon, 1, 1, 1, 1)], paxg: [row(mon, 1, 1, 1, 1)] }, mon, true);
assert.deepStrictEqual(plain(out.map((o) => o.key)), ["candles-2026-W41-a", "candles-2026-W44-a"]);
assert.ok(out.every((o) => o.value.length < 5000));
assert.deepStrictEqual(plain(P.nowFrom(ohlc, mon + 4 * H)), { t: mon + 4 * H, btc: 11, eth: 1.5, paxg: 3, xmr: 4 });
console.log("n8n prices ok");

// --- ranking ---
const K = load("ranking");
const T0 = mon, NOW = T0 + 10 * R.CANDLE;
const cnd = { ...Object.fromEntries(R.ASSETS.map((x) => [x, []])), btc: [[10, 9, 10], [13, 9.5, 12]].map((x, i) => ({ t: T0 + i * R.CANDLE, h: x[0], l: x[1], c: x[2] })) };
const kv = (uid, u, key, value, sec) => ({ user_id: uid, user: { username: u }, key, value, created_at: new Date(sec * 1000).toISOString() });
const ana = kv(1, "ana", "o-1", JSON.stringify({ asset: "btc", side: "buy", usd: 100, lev: 1 }), T0 + 60);      // +20 USD → +2%
const bob = kv(2, "bob", "o-2", JSON.stringify({ asset: "btc", side: "buy", usd: 100, lev: 2, sl: 9.8 }), T0 + 60); // SL → -4 USD → -0.4%
const cat = kv(3, "cat", "reset-1", "1", T0 + 60); // never traded: not ranked
let r = K.rankAll([ana, bob, cat], cnd, NOW, []);
assert.deepStrictEqual(plain(r.ranking.rows), [{ u: "ana", r: 2, resets: 0 }, { u: "bob", r: -0.4, resets: 0 }]);
assert.strictEqual(r.ranking.t, NOW);
assert.deepStrictEqual(plain(r.seenNow.map((s) => s.key).sort()), ["o-1", "o-2", "reset-1"]);
// bob deleted a losing order seen before → flagged and out
r = K.rankAll([ana], cnd, NOW, [{ user_id: 2, key: "o-2", created_at: bob.created_at }, { user_id: 1, key: "o-1", created_at: ana.created_at }]);
assert.deepStrictEqual(plain(r.ranking.rows.map((x) => x.u)), ["ana"]);
assert.deepStrictEqual(plain(r.flagged), [2]);
// A key older than the user's last reset may vanish: that is a legit reset
const bobReset = kv(2, "bob", "reset-9", "1", T0 + 5 * R.CANDLE);
r = K.rankAll([ana, bobReset], cnd, NOW, [{ user_id: 2, key: "o-2", created_at: bob.created_at }]);
assert.deepStrictEqual(plain(r.flagged), []);
// fail-closed cases
const gone = (uid, key, sec) => ({ user_id: uid, key, created_at: new Date(sec * 1000).toISOString() });
// (a) vanished key newer than a present reset marker
r = K.rankAll([ana, bobReset], cnd, NOW, [gone(2, "o-3", T0 + 6 * R.CANDLE)]);
assert.deepStrictEqual(plain(r.flagged), [2]);
// (b) vanished reset marker with no later marker
r = K.rankAll([ana, bob], cnd, NOW, [gone(2, "reset-5", T0 + 60)]);
assert.deepStrictEqual(plain(r.flagged), [2]);
// (c) numeric ms created_at equal to the key's time is present
r = K.rankAll([ana, bob], cnd, NOW, [{ user_id: 2, key: "o-2", created_at: (T0 + 60) * 1000 }]);
assert.deepStrictEqual(plain(r.flagged), []);
// (d) garbage created_at flags
r = K.rankAll([ana, bob], cnd, NOW, [{ user_id: 2, key: "o-9", created_at: "garbage" }]);
assert.deepStrictEqual(plain(r.flagged), [2]);
// (e) same key name, different created_at (deleted and re-created) flags
r = K.rankAll([ana, bob], cnd, NOW, [gone(2, "o-2", T0 + 30)]);
assert.deepStrictEqual(plain(r.flagged), [2]);
// (f) an order overwritten after the last reset (updated_at moved) flags; equal updated_at does not
const edited = (k, sec) => ({ ...k, updated_at: new Date(sec * 1000).toISOString() });
r = K.rankAll([edited(ana, T0 + 60), edited(bob, T0 + 600)], cnd, NOW, []);
assert.deepStrictEqual(plain(r.flagged), [2]);
assert.deepStrictEqual(plain(r.ranking.rows.map((x) => x.u)), ["ana"]);
// (g) unparseable updated_at flags
r = K.rankAll([ana, { ...bob, updated_at: "garbage" }], cnd, NOW, []);
assert.deepStrictEqual(plain(r.flagged), [2]);
// (h) an edit before the last reset no longer counts
r = K.rankAll([ana, edited(bob, T0 + 600), bobReset], cnd, NOW, []);
assert.deepStrictEqual(plain(r.flagged), []);
// (i) seasons: a vanished or edited key from the previous season does not flag; one from this season does
const S0 = Date.UTC(2026, 8, 1) / 1000;
r = K.rankAll([ana, bob], cnd, NOW, [gone(2, "o-8", S0 - 86400)]);
assert.deepStrictEqual(plain(r.flagged), []);
r = K.rankAll([ana, bob], cnd, NOW, [gone(2, "o-8", S0 + 86400)]);
assert.deepStrictEqual(plain(r.flagged), [2]);
r = K.rankAll([ana, edited({ ...bob, created_at: new Date((S0 - 86400) * 1000).toISOString() }, T0 + 600)], cnd, NOW, []);
assert.deepStrictEqual(plain(r.flagged), []);
assert.deepStrictEqual(plain(r.ranking.season), { start: S0, end: Date.UTC(2027, 0, 1) / 1000 });
console.log("n8n ranking ok");

// --- daily ---
const D = load("daily");
assert.strictEqual(D.dailySummary([], cnd, NOW), "");
// Fewer than 3 traders in the window: no summary, a count of one or two would point at people
assert.strictEqual(D.dailySummary([ana, bob], cnd, T0 + 2 * R.CANDLE + 10), "");
const eve = kv(5, "eve", "o-5", JSON.stringify({ asset: "btc", side: "buy", usd: 50, lev: 1 }), T0 + 90);
let txt = D.dailySummary([ana, bob, eve], cnd, T0 + 2 * R.CANDLE + 10); // candle 1 is closed by now: three buys and bob's SL fall within the last 24h
assert.match(txt, /3 compras/); assert.match(txt, /1 stop-loss/); assert.match(txt, /3 participantes/);
assert.match(txt, /^\*\*paper trading, últimas 24h:\*\*/);
assert.doesNotMatch(txt, /ana|bob|eve/);
assert.strictEqual(D.dailySummary([ana, bob], cnd, T0 + 3 * 86400), ""); // nothing in the last 24h
console.log("n8n daily ok");
