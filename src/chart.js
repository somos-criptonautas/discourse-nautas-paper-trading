// src/chart.js — 4h candlestick chart as an SVG string. Pure: no DOM.
function fmtPrice(p) {
  return p >= 1000 ? Math.round(p).toLocaleString("es") : p >= 1 ? String(+p.toFixed(2)) : p.toPrecision(3);
}
// shortcut: smoothing averages the values available so far (no warm-up gap), so k/d start one candle after the window fills
function stochastic(candles, n = 14, kS = 3, dS = 3) {
  const mean = (a, i, w) => { const s = a.slice(Math.max(0, i - w + 1), i + 1); return s.reduce((x, y) => x + y, 0) / s.length; };
  const raw = candles.map((k, i) => {
    if (i < n - 1) return null;
    const w = candles.slice(i - n + 1, i + 1), l = Math.min(...w.map((x) => x.l)), h = Math.max(...w.map((x) => x.h));
    return h === l ? 50 : (100 * (k.c - l)) / (h - l);
  });
  const ks = raw.map((v, i) => (v === null ? null : mean(raw.slice(n - 1), i - n + 1, kS)));
  return ks.map((k, i) => (k === null ? null : { k, d: mean(ks.slice(n - 1), i - n + 1, dS) }));
}
function chartSVG(candles, lines, opts) {
  if (!candles.length) return "";
  const W = opts.width, H = opts.height, SH = 80, padR = 64, padB = 22, padT = 8;
  const ys = candles.flatMap((k) => [k.h, k.l]);
  let lo = Math.min(...ys), hi = Math.max(...ys);
  const m = (hi - lo || hi || 1) * 0.04; lo -= m; hi += m;
  const y = (p) => padT + ((hi - p) / (hi - lo)) * (H - padT - padB);
  const cw = (W - padR) / candles.length, bw = Math.max(1, cw * 0.6);
  const esc = (s) => String(s).replace(/[<&>"]/g, (ch) => ({ "<": "&lt;", "&": "&amp;", ">": "&gt;", '"': "&quot;" }[ch]));
  let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H + (opts.stoch ? SH : 0)}" width="100%" role="img" aria-label="velas de 4h">`;
  for (let i = 0; i < 4; i++) {
    const p = lo + ((hi - lo) * i) / 3, yy = y(p);
    out += `<line class="grid" x1="0" x2="${W - padR}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}"/><text class="axis" x="${W - padR + 6}" y="${(yy + 4).toFixed(1)}">${fmtPrice(p)}</text>`;
  }
  let lastDay = "";
  candles.forEach((k, i) => {
    const x = i * cw + cw / 2, open = i ? candles[i - 1].c : k.l;
    const cls = k.c >= open ? "up" : "down";
    const top = y(Math.max(open, k.c)), bot = y(Math.min(open, k.c));
    out += `<g class="candle ${cls}"><line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${y(k.h).toFixed(1)}" y2="${y(k.l).toFixed(1)}"/>`;
    out += `<rect x="${(x - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, bot - top).toFixed(1)}"/></g>`;
    const d = new Date(k.t * 1000), day = String(d.getUTCDate()).padStart(2, "0") + "/" + String(d.getUTCMonth() + 1).padStart(2, "0");
    if (day !== lastDay && d.getUTCHours() === 0) { out += `<text class="axis" x="${x.toFixed(1)}" y="${H - 6}" text-anchor="middle">${day}</text>`; lastDay = day; }
  });
  const cl = candles.flatMap((k) => [k.h, k.l]), cLo = Math.min(...cl), cHi = Math.max(...cl);
  for (const l of lines) {
    // out-of-range lines are pinned to the edge instead of stretching the scale
    const off = l.price < cLo ? "↓ " : l.price > cHi ? "↑ " : "";
    const yy = (off ? (l.price < cLo ? H - padB : padT) : y(l.price)).toFixed(1);
    out += `<line class="line ${esc(l.cls)}${off ? " off" : ""}" x1="0" x2="${W - padR}" y1="${yy}" y2="${yy}"/><text class="label ${esc(l.cls)}${off ? " off" : ""}" x="4" y="${(+yy + (off && l.price > cHi ? 12 : -4)).toFixed(1)}">${off}${esc(l.label)} ${fmtPrice(l.price)}</text>`;
  }
  if (opts.stoch) {
    const sy = (v) => (4 + ((100 - v) / 100) * (SH - 8)).toFixed(1), pts = (key) => opts.stoch.map((s, i) => s && `${(i * cw + cw / 2).toFixed(1)},${sy(s[key])}`).filter(Boolean).join(" ");
    out += `<g transform="translate(0,${H})">`;
    for (const v of [20, 80]) out += `<line class="grid" x1="0" x2="${W - padR}" y1="${sy(v)}" y2="${sy(v)}" stroke-dasharray="3 3"/><text class="axis" x="${W - padR + 6}" y="${(+sy(v) + 4).toFixed(1)}">${v}</text>`;
    out += `<polyline class="stoch k" points="${pts("k")}"/><polyline class="stoch d" points="${pts("d")}"/></g>`;
  }
  return out + "</svg>";
}
if (typeof module !== "undefined") module.exports = { chartSVG, fmtPrice, stochastic }; else if (typeof window !== "undefined") window.Chart = { chartSVG, fmtPrice, stochastic };
