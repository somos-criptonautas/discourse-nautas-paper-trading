// test/chart.test.js
const assert = require("assert");
const { chartSVG } = require("../src/chart.js");
const t0 = Date.UTC(2026, 9, 26) / 1000, H = 14400;
const c = [{ t: t0, h: 10, l: 9, c: 9.5 }, { t: t0 + H, h: 11, l: 9.5, c: 10.5 }, { t: t0 + 6 * H, h: 12, l: 10, c: 11 }];
const svg = chartSVG(c, [{ price: 9.5, label: "Entrada", cls: "entry" }, { price: 12.5, label: "TP", cls: "tp" }], { width: 640, height: 260 });
assert.match(svg, /^<svg[^>]*viewBox="0 0 640 260"/);
assert.strictEqual((svg.match(/class="candle up"/g) || []).length, 3); // 9.5 ≥ 9 (primera: open = l), 10.5 ≥ 9.5, 11 ≥ 10.5
assert.strictEqual((svg.match(/class="candle down"/g) || []).length, 0);
assert.match(svg, /class="line tp"/);
assert.match(svg, />TP 12\.5</); // la etiqueta incluye el precio
assert.match(svg, />26\/10</); // marca de día
assert.match(svg, />27\/10</);
assert.strictEqual(chartSVG([], [], { width: 640, height: 260 }), ""); // sin velas, sin gráfico
console.log("chart ok");
