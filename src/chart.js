// src/chart.js — 4h candlestick chart as an SVG string. Pure: no DOM.
function fmtPrice(p) {
  return p >= 1000 ? Math.round(p).toLocaleString("es") : p >= 1 ? String(+p.toFixed(2)) : p.toPrecision(3);
}
function chartSVG(candles, lines, opts) {
  if (!candles.length) return "";
  const W = opts.width, H = opts.height, padR = 64, padB = 22, padT = 8;
  const ys = candles.flatMap((k) => [k.h, k.l]).concat(lines.map((l) => l.price));
  let lo = Math.min(...ys), hi = Math.max(...ys);
  const m = (hi - lo || hi || 1) * 0.04; lo -= m; hi += m;
  const y = (p) => padT + ((hi - p) / (hi - lo)) * (H - padT - padB);
  const cw = (W - padR) / candles.length, bw = Math.max(1, cw * 0.6);
  const esc = (s) => String(s).replace(/[<&>"]/g, (ch) => ({ "<": "&lt;", "&": "&amp;", ">": "&gt;", '"': "&quot;" }[ch]));
  let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Velas de 4h">`;
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
  for (const l of lines) {
    const yy = y(l.price).toFixed(1);
    out += `<line class="line ${esc(l.cls)}" x1="0" x2="${W - padR}" y1="${yy}" y2="${yy}"/><text class="label ${esc(l.cls)}" x="4" y="${(+yy - 4).toFixed(1)}">${esc(l.label)} ${fmtPrice(l.price)}</text>`;
  }
  return out + "</svg>";
}
if (typeof module !== "undefined") module.exports = { chartSVG, fmtPrice }; else if (typeof window !== "undefined") window.Chart = { chartSVG, fmtPrice };
