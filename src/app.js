// src/app.js — artifact UI. Reads the store, replays, renders. Writes are in order(), close() and reset().
(function () {
  const R = window.Replay, C = window.Chart;
  const $ = (id) => document.getElementById(id);
  const store = window.discourseArtifact;
  const fmt = (n) => n.toLocaleString("es", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " USD";
  const when = (sec) => new Date(sec * 1000).toLocaleString("es", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const ui = { user: null, candles: null, now: null, ranking: null, mine: [], state: null, asset: "btc", view: { count: 42, end: null, yScale: null } };

  function note(text) { $("note").textContent = text; $("note").hidden = !text; }

  async function pages(params) {
    // index() pagina de a 100; juntamos todas las páginas
    let page = 1, out = [], users = [];
    for (;;) {
      const r = await store.index({ ...params, page, per_page: 100 });
      out = out.concat((r && r.key_values) || []);
      for (const u of (r && r.users) || []) if (!users.some((x) => x.id === u.id)) users.push(u);
      // shortcut: the page > 20 cap silently truncates past ~2000 keys; raise it if the store grows
      if (!r || !r.has_more || page > 20) return { key_values: out, users };
      page++;
    }
  }

  async function load() {
    try {
      const init = await Promise.race([window.discourseArtifactReady, new Promise((r) => setTimeout(() => r(null), 2000))]);
      ui.user = init && init.username;
    } catch (e) {}
    try {
      const sys = await pages({ all_users: true }); // devuelve lo público de todos + lo propio; filtramos por system
      const sysKv = sys.key_values.filter((k) => k.user_id === R.SYSTEM_ID);
      ui.candles = R.mergeCandles({ key_values: sysKv });
      const nowKv = sysKv.find((k) => k.key === "now"), rkKv = sysKv.find((k) => k.key === "ranking");
      ui.now = nowKv ? JSON.parse(nowKv.value) : null;
      ui.ranking = rkKv ? JSON.parse(rkKv.value) : null;
      const me = sys.users.find((u) => u.username === ui.user);
      ui.mine = me ? sys.key_values.filter((k) => k.user_id === me.id) : [];
    } catch (e) {
      note("no pudimos leer los precios. recarga la página en un momento.");
    }
    if (!ui.user) note("inicia sesión en el foro para operar. sin sesión se ven el gráfico y el ranking.");
  }

  function nowSec() { return Math.floor(Date.now() / 1000); }

  function render() {
    const ok = ui.candles && R.ASSETS.some((a) => ui.candles[a].length);
    if (!ok) { $("meta").textContent = "sin datos de precios"; $("submit").disabled = true; return; }
    ui.state = R.replay(ui.mine, ui.candles, nowSec());
    const s = ui.state;
    const lastClose = Math.max(...R.ASSETS.map((a) => { const l = ui.candles[a].filter((k) => k.t + R.CANDLE <= nowSec()); return l.length ? l[l.length - 1].t + R.CANDLE : 0; }));
    $("meta").textContent = "último cierre de vela: " + when(lastClose);
    $("balance").textContent = fmt(s.balance);
    $("equity").textContent = fmt(s.equity);
    $("avail").textContent = "disponible: " + fmt(s.balance);
    $("f-usd").max = Math.floor(s.balance);
    $("perf").textContent = (s.perf >= 0 ? "+" : "") + s.perf + "%";
    $("perf").className = "pt-perf " + (s.perf >= 0 ? "up" : "down");
    renderChart(); prefill(); renderPositions(); renderPending(); renderHistory(); renderRanking();
    $("resets").textContent = s.resets ? "reiniciaste " + s.resets + (s.resets === 1 ? " vez." : " veces.") : "";
    validate(); hint();
    $("reset").disabled = !ui.user;
  }

  const pair = (a) => a.toUpperCase() + "/USDT";
  function closed() { return ui.candles[ui.asset].filter((k) => k.t + R.CANDLE <= nowSec()); }
  // Zoom/pan state: count visible candles, end = index after the last visible one (null = latest)
  function setView(count, end, light) {
    const n = closed().length, v = ui.view;
    v.count = Math.max(Math.min(12, n), Math.min(n, Math.round(count)));
    end = end === null ? null : Math.round(end);
    v.end = end === null || end >= n ? null : Math.max(v.count, end);
    light ? renderChart() : render(); // light: only the chart (used while dragging)
  }
  function zoom(f) { setView(ui.view.count * f, ui.view.end); }

  function renderChart() {
    $("sel-asset").value = ui.asset;
    $("sel-range").value = [42, 180, 1092].includes(ui.view.count) && ui.view.end === null ? ui.view.count : "custom";
    const all = closed(), end = ui.view.end === null ? all.length : ui.view.end;
    const from = Math.max(0, end - ui.view.count), list = all.slice(from, end);
    const lines = ui.state.positions.filter((p) => p.asset === ui.asset).flatMap((p) => [
      { price: p.entry, label: "entrada", cls: "entry" },
      p.tp && { price: p.tp, label: "TP", cls: "tp" }, p.sl && { price: p.sl, label: "SL", cls: "sl" }, p.liq && { price: p.liq, label: "liq", cls: "liq" },
    ].filter(Boolean));
    const last = ui.now && ui.now[ui.asset];
    $("now-price").textContent = last ? "· " + C.fmtPrice(last) : "";
    $("submit").textContent = "comprar " + pair(ui.asset) + " al cierre de vela";
    $("chart").innerHTML = C.chartSVG(list, lines, { width: 640, height: 260, volume: true, last, yScale: ui.view.yScale, stoch: C.stochastic(all).slice(from, end) }) || "<p class='pt-meta'>sin velas en este rango.</p>";
  }

  // TP/SL stay empty (= no TP / no SL); the current price shows as their placeholder
  function prefill() {
    const p = ui.now && ui.now[ui.asset];
    for (const id of ["f-tp", "f-sl"]) if (p) $(id).placeholder = Number(p.toPrecision(5));
  }
  function clearTouched() { for (const id of ["f-tp", "f-sl"]) { delete $(id).dataset.touched; $(id).value = ""; } prefill(); }

  const refPrice = () => ui.now && ui.now[ui.asset];
  function fields() {
    const num = (id) => ($(id).value === "" ? undefined : +$(id).value);
    return { asset: ui.asset, usd: $("f-usd").value === "" ? NaN : +$("f-usd").value, lev: +document.querySelector('input[name=lev]:checked').value, tp: num("f-tp"), sl: num("f-sl") };
  }
  // Live check: message in #err and submit disabled while the order is not valid
  function validate() {
    if (!ui.state) return;
    const ref = refPrice(), f = fields(), msg = R.checkOrder(f, ref, ui.state.balance, ui.mine.length);
    if (Number.isFinite(ref)) { $("f-tp").min = ref; $("f-sl").max = ref; $("f-sl").min = f.lev === 2 ? ref * (1 - R.LIQ_PCT) : ""; }
    $("err").textContent = Number.isNaN(f.usd) ? "" : msg; $("err").hidden = !$("err").textContent;
    $("submit").disabled = !ui.user || !!msg;
  }

  const item = (main, right, small) => { const d = document.createElement("div"); d.className = "item"; d.innerHTML = "<span></span><span></span><small></small>"; d.children[0].textContent = main; d.children[1].textContent = right; d.children[2].textContent = small; return d; };

  function renderPositions() {
    const box = $("positions"); box.innerHTML = "";
    if (!ui.state.positions.length) { box.appendChild(item("sin posiciones abiertas", "", "")); return; }
    for (const p of ui.state.positions) {
      const d = item(pair(p.asset) + " " + p.lev + "x · " + fmt(p.usd), (p.pnl >= 0 ? "+" : "") + fmt(p.pnl),
        "entrada " + C.fmtPrice(p.entry) + (p.tp ? " · TP " + C.fmtPrice(p.tp) : "") + (p.sl ? " · SL " + C.fmtPrice(p.sl) : "") + (p.liq ? " · liq " + C.fmtPrice(p.liq) : "") + " · " + when(p.openedAt + R.CANDLE));
      d.children[1].className = p.pnl >= 0 ? "pt-perf up" : "pt-perf down";
      if (ui.user) { const b = document.createElement("button"); b.type = "button"; b.className = "close"; b.textContent = "cerrar al cierre de vela"; b.onclick = () => { b.disabled = true; close(p); }; d.appendChild(b); }
      box.appendChild(d);
    }
  }

  function renderPending() {
    const box = $("pending"); box.innerHTML = "";
    $("pending-card").hidden = !ui.state.pending.length;
    for (const o of ui.state.pending) box.appendChild(item(o.side === "buy" ? "compra " + pair(o.asset) + " " + o.lev + "x · " + fmt(o.usd) : "cierre de posición", "", "se ejecuta al cierre de la vela, a las " + when(o.fillAt)));
  }

  const KIND = { buy: "compra", sell: "cierre manual", tp: "take-profit", sl: "stop-loss", liq: "liquidación", invalid: "orden no ejecutada", reset: "reinicio" };
  function renderHistory() {
    const box = $("history"); box.innerHTML = "";
    const h = [...ui.state.history].reverse().slice(0, 50);
    if (!h.length) box.appendChild(item("todavía sin operaciones", "", ""));
    for (const e of h) box.appendChild(item(KIND[e.kind] + (e.asset ? " " + pair(e.asset) : ""), e.pnl !== undefined ? (e.pnl >= 0 ? "+" : "") + fmt(e.pnl) : "", when(e.t) + (e.price ? " · " + C.fmtPrice(e.price) : "") + (e.why ? " · " + e.why : "")));
  }

  function renderRanking() {
    const box = $("ranking"); box.innerHTML = "";
    const rows = (ui.ranking && ui.ranking.rows) || [];
    if (!rows.length) { box.appendChild(item("el ranking aparece cuando n8n lo publica, cada hora.", "", "")); return; }
    const shown = ui.rankAll ? rows : rows.slice(0, 10);
    shown.forEach((r, i) => { const d = item((i + 1) + ". " + r.u, (r.r >= 0 ? "+" : "") + r.r + "%", r.resets ? r.resets + (r.resets === 1 ? " reinicio" : " reinicios") : ""); if (r.u === ui.user) d.classList.add("me"); box.appendChild(d); });
    if (rows.length > 10) {
      const b = document.createElement("button"); b.type = "button"; b.className = "pt-more";
      b.textContent = ui.rankAll ? "ver menos" : "ver más (" + (rows.length - 10) + ")";
      b.onclick = () => { ui.rankAll = !ui.rankAll; renderRanking(); };
      box.appendChild(b);
    }
  }

  // Under the form: when the order fills, rough size at the reference price, 2x liquidation note
  function hint() {
    if (!ui.state) return;
    const f = fields(), ref = refPrice();
    const next = (Math.floor(nowSec() / R.CANDLE) + 1) * R.CANDLE;
    let t = "se ejecuta al cierre de la vela de 4h, a las " + when(next) + ".";
    if (ref && f.usd >= R.MIN_USD) t += " unas " + ((f.usd * f.lev) / ref).toPrecision(4) + " " + ui.asset.toUpperCase() + " a precio de referencia " + C.fmtPrice(ref) + ".";
    if (f.lev === 2 && ref) t += " liquidación cerca de " + C.fmtPrice(ref * (1 - R.LIQ_PCT)) + ". sin intereses: es una simplificación.";
    $("hint").textContent = t;
  }

  let busy = false; // one write at a time: state only refreshes after the reload
  async function write(key, value, okText) {
    busy = true; $("submit").disabled = true;
    try {
      try { await store.set(key, JSON.stringify(value)); }
      catch (e) { note("no se pudo guardar. revisa tu conexión e inténtalo de nuevo."); validate(); return false; }
      note(okText);
      await load(); render(); return true;
    } finally { busy = false; }
  }

  async function order(ev) {
    ev.preventDefault();
    if (busy || !ui.state) return;
    const f = fields();
    if (R.checkOrder(f, refPrice(), ui.state.balance, ui.mine.length)) return validate();
    const v = { asset: f.asset, side: "buy", usd: f.usd, lev: f.lev };
    if (f.tp !== undefined) v.tp = f.tp;
    if (f.sl !== undefined) v.sl = f.sl;
    if (await write("o-" + Date.now(), v, "orden guardada. se ejecuta al cierre de la vela.")) { $("order").reset(); clearTouched(); render(); }
  }

  async function close(p) {
    if (busy) return;
    if (ui.state.pending.some((o) => o.of === p.id)) return note("ya hay un cierre pendiente para esa posición.");
    await write("o-" + Date.now(), { side: "sell", of: p.id }, "cierre guardado. se ejecuta al cierre de la vela.");
  }

  async function reset() {
    if (busy || !confirm("reiniciamos con 1.000 USD. las posiciones abiertas se pierden y el ranking mostrará un reinicio más. ¿seguimos?")) return;
    busy = true; $("reset").disabled = true;
    try {
      try { await store.set("reset-" + Date.now(), "1"); } catch (e) { return note("no se pudo reiniciar. inténtalo de nuevo."); }
      await load(); // pick up orders written from another tab
      // Only o-* keys go; markers stay so server timestamps keep the reset honest
      let failed = 0;
      for (const k of ui.mine.filter((k) => /^o-/.test(k.key))) { try { await store.delete(k.key); } catch (e) { failed++; } }
      note(failed ? "reiniciamos, pero quedaron " + failed + " órdenes viejas sin borrar." : "reiniciamos con 1.000 USD.");
      await load(); render();
    } finally { busy = false; $("reset").disabled = !ui.user; }
  }

  const opts = R.ASSETS.map((a) => `<option value="${a}">${pair(a)}</option>`).join("");
  $("sel-asset").innerHTML = opts;
  $("sel-asset").onchange = (e) => { ui.asset = e.target.value; ui.view.yScale = null; clearTouched(); render(); };
  for (const id of ["f-tp", "f-sl"]) $(id).addEventListener("input", () => { $(id).dataset.touched = "1"; });
  // Focusing an empty TP/SL fills it with the placeholder price so the user edits the digits
  for (const id of ["f-tp", "f-sl"]) $(id).addEventListener("focus", () => {
    const el = $(id);
    if (el.value === "" && el.placeholder !== "" && Number.isFinite(+el.placeholder)) { el.value = el.placeholder; el.dataset.touched = "1"; validate(); }
  });
  for (const id of ["f-usd", "f-tp", "f-sl"]) $(id).addEventListener("input", () => { validate(); hint(); });
  for (const r of document.querySelectorAll("input[name=lev]")) r.addEventListener("change", () => { validate(); hint(); });

  // Drag gestures on the chart zones; every move is computed from the values at pointerdown
  let drag = null, lastKind = null, pinch = null; const ptrs = new Map(); // ptrs: active pointers by id, pinch: two-finger zoom gesture
   // pointer capture retargets click/dblclick to #chart, so lastKind remembers the zone from pointerdown
  const chartEl = $("chart");
  chartEl.addEventListener("pointerdown", (e) => {
    lastKind = null;
    const z0 = e.target.closest && e.target.closest(".zone");
    if (e.button === 0 && z0 && !z0.classList.contains("price")) {
      ptrs.set(e.pointerId, e.clientX);
      if (pinch || ptrs.size > 2) return; // a third finger never starts a drag
      if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.abs(a - b) || 1, count: ui.view.count, end: ui.view.end === null ? closed().length : ui.view.end }; drag = null; chartEl.setPointerCapture(e.pointerId); return; }
    }
    const z = e.target.closest && e.target.closest(".zone"), svg = chartEl.querySelector("svg");
    if (e.button !== 0 || !z || !svg) return;
    const n = closed().length, v = ui.view, all = closed(), end = v.end === null ? n : v.end, list = all.slice(Math.max(0, end - v.count), end);
    const k = svg.clientWidth / 640, span = (Math.max(...list.map((c) => c.h)) - Math.min(...list.map((c) => c.l))) * 1.08;
    drag = { kind: z.classList.contains("price") ? "price" : z.classList.contains("time") ? "time" : "pan", x: e.clientX, y: e.clientY, count: v.count, end, factor: v.yScale ? v.yScale.factor : 1, offset: v.yScale ? v.yScale.offset : 0, cwPx: ((640 - 64) / v.count) * k, plotPx: (260 - 30) * k, span };
    lastKind = drag.kind;
    chartEl.setPointerCapture(e.pointerId);
  });
  chartEl.addEventListener("pointermove", (e) => {
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, e.clientX);
    if (pinch && ptrs.size === 2) { const [a, b] = [...ptrs.values()]; setView(pinch.count / ((Math.abs(a - b) || 1) / pinch.d), pinch.end, true); return; }
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y, v = ui.view;
    if (drag.kind === "pan") {
      if (v.yScale) v.yScale = { factor: drag.factor, offset: drag.offset + (dy / drag.plotPx) * drag.span * drag.factor };
      setView(drag.count, drag.end - dx / drag.cwPx, true);
    } else if (drag.kind === "time") setView(drag.count * Math.pow(1.1, -dx / 40), drag.end, true);
    else { v.yScale = { factor: Math.min(20, Math.max(0.1, drag.factor * Math.pow(1.1, dy / 40))), offset: drag.offset }; renderChart(); }
  });
  const endDrag = (e) => { ptrs.delete(e.pointerId); if (pinch) { pinch = null; ptrs.clear(); } drag = null; };
  chartEl.addEventListener("pointerup", endDrag);
  chartEl.addEventListener("pointercancel", endDrag);
  chartEl.addEventListener("lostpointercapture", endDrag);
  chartEl.addEventListener("dblclick", () => {
    if (lastKind === "price") { ui.view.yScale = null; render(); } else if (lastKind === "time") setView(180, null);
  });
  $("sel-range").onchange = (e) => { if (e.target.value) setView(+e.target.value, null); };
  let lastWheel = 0;
  $("chart").addEventListener("wheel", (e) => { e.preventDefault(); if (Math.abs(e.deltaY) < 20 || e.timeStamp - lastWheel < 150) return; lastWheel = e.timeStamp; zoom(e.deltaY > 0 ? 2 : 0.5); }, { passive: false });
  document.querySelector(".pt-chartbar").onclick = (e) => { const b = e.target.closest("button"), z = b && b.dataset.z; if (z === "in") zoom(0.5); else if (z === "out") zoom(2); };
  for (const b of document.querySelectorAll("#order .pt-quick button")) b.onclick = () => {
    if (!ui.state) return;
    $("f-usd").value = Math.max(R.MIN_USD, Math.floor((ui.state.balance * b.dataset.pct) / 100)); validate(); hint();
  };
  $("order").onsubmit = order;
  $("reset").onclick = reset;
  load().then(render);
})();
