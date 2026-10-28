// test/chart.test.js
const assert = require("assert");
const { chartSVG, stochastic } = require("../src/chart.js");
const t0 = Date.UTC(2026, 9, 26) / 1000, H = 14400;
const c = [{ t: t0, h: 10, l: 9, c: 9.5 }, { t: t0 + H, h: 11, l: 9.5, c: 10.5 }, { t: t0 + 6 * H, h: 12, l: 10, c: 11 }];
const svg = chartSVG(c, [{ price: 9.5, label: "entrada", cls: "entry" }, { price: 12.5, label: "TP", cls: "tp" }], { width: 640, height: 260 });
assert.match(svg, /^<svg[^>]*viewBox="0 0 640 260"/);
assert.strictEqual((svg.match(/class="candle up"/g) || []).length, 3); // 9.5 ≥ 9 (primera: open = l), 10.5 ≥ 9.5, 11 ≥ 10.5
assert.strictEqual((svg.match(/class="candle down"/g) || []).length, 0);
assert.match(svg, /class="line tp off"/);
assert.match(svg, />↑ TP 12\.5</); // above the candle range: pinned to the top with an arrow
assert.match(svg, />26\/10</); // marca de día
assert.match(svg, />27\/10</);
assert.strictEqual(chartSVG([], [], { width: 640, height: 260 }), ""); // sin velas, sin gráfico
// 20 candles rising 1 per step
const rise = Array.from({ length: 20 }, (_, i) => ({ t: t0 + i * H, h: 11 + i, l: 9 + i, c: 10 + i }));
const st = stochastic(rise);
assert.strictEqual(st[12], null);
assert.ok(st[13].k > 50 && st[13].k < 100); // close near the top of the window
assert.strictEqual(st[15].d === null, false);
assert.strictEqual(stochastic(rise.slice(0, 5)).every((x) => x === null), true);
// A line far below the candles is pinned to the bottom edge and does not stretch the scale
const pinned = chartSVG(c, [{ price: 1, label: "Liq", cls: "liq" }], { width: 640, height: 260 });
assert.match(pinned, /class="line liq off"/);
assert.match(pinned, />↓ Liq 1</);
assert.match(pinned, /class="axis"[^>]*>8\.88</); // lo = 9 - 4% margin, not near 1
const withStoch = chartSVG(rise.slice(-12), [], { width: 640, height: 260, stoch: stochastic(rise).slice(-12) }); // zoomed: 12 candles, stochastic from the full series
assert.match(withStoch, /viewBox="0 0 640 340"/);
assert.match(withStoch, /class="stoch k"/);
assert.match(withStoch, /class="stoch d"/);
assert.match(withStoch, /class="stoch k" points="[^"]+,/); // not empty when zoomed
const full = chartSVG(rise.slice(-12), [], { width: 640, height: 260, volume: true, stoch: stochastic(rise).slice(-12) });
assert.match(full, /viewBox="0 0 640 400"/); // 260 + 60 + 80
assert.match(chartSVG(c, [], { width: 640, height: 260, volume: true }), /viewBox="0 0 640 320"/);
assert.match(full, /class="vol"/);
assert.match(full, />volumen</);
assert.match(full, />estocástico \(stoch\)</);
const lastSvg = chartSVG(c, [], { width: 640, height: 260, last: 10.5 });
assert.match(lastSvg, /class="line last"/);
assert.match(lastSvg, /class="label last"/);
assert.match(lastSvg, />10\.5</);
const ticks = (chartSVG(c, [], { width: 640, height: 260 }).match(/<text class="axis" x="(?:582)"/g) || []).length;
assert.strictEqual(ticks, 8);
const two = chartSVG(c, [{ price: 1, label: "SL", cls: "sl" }, { price: 0.5, label: "liq", cls: "liq" }], { width: 640, height: 260 });
const ys = [...two.matchAll(/<text class="label (?:sl|liq) off" x="4" y="([\d.]+)"/g)].map((m) => m[1]);
assert.strictEqual(ys.length, 2);
assert.notStrictEqual(ys[0], ys[1]); // stacked, not overlapping
// 60 days of candles: at most 8 day marks
const long = Array.from({ length: 360 }, (_, i) => ({ t: t0 + i * H, h: 11, l: 9, c: 10 }));
assert.ok((chartSVG(long, [], { width: 640, height: 260 }).match(/text-anchor="middle"/g) || []).length <= 8);
// yScale stretches the vertical range around its centre
const axisY = (s) => [...s.matchAll(/<text class="axis" x="582"[^>]*>([\d.]+)</g)].map((m) => +m[1]);
const a0 = axisY(chartSVG(c, [], { width: 640, height: 260 })), a2 = axisY(chartSVG(c, [], { width: 640, height: 260, yScale: { factor: 2, offset: 0 } }));
assert.ok(a2[0] < a0[0] && a2[a2.length - 1] > a0[a0.length - 1]);
for (const z of ["price", "time", "pan"]) assert.match(svg, new RegExp('class="zone ' + z + '"'));
const zoomed = chartSVG(c, [{ price: 12, label: "TP", cls: "tp" }], { width: 640, height: 260, yScale: { factor: 0.2, offset: 0 } });
assert.match(zoomed, /class="line tp off"/); // inside the candle range but outside the visible window
assert.match(zoomed, />↑ TP 12</);
console.log("chart ok");
