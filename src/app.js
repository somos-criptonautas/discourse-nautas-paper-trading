// src/app.js — artifact UI. Reads the store, replays, renders. Writes are in order(), close() and reset().
(function () {
  const R = window.Replay, C = window.Chart;
  const $ = (id) => document.getElementById(id);
  const store = window.discourseArtifact;
  const fmt = (n) => n.toLocaleString("es", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " USD";
  const when = (sec) => new Date(sec * 1000).toLocaleString("es", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const ui = { user: null, candles: null, now: null, ranking: null, mine: [], state: null, asset: "btc", range: 4 };

  function note(text) { $("note").textContent = text; $("note").hidden = !text; }

  async function pages(params) {
    // index() pagina de a 100; juntamos todas las páginas
    let page = 1, out = [];
    for (;;) {
      const r = await store.index({ ...params, page, per_page: 100 });
      out = out.concat((r && r.key_values) || []);
      if (!r || !r.has_more || page > 20) return { key_values: out };
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
      ui.mine = sys.key_values.filter((k) => ui.user && k.user_id !== R.SYSTEM_ID && k.user && k.user.username === ui.user);
    } catch (e) {
      note("No pudimos leer los precios. Recarga la página en un momento.");
    }
    if (!ui.user) note("Inicia sesión en el foro para operar. Sin sesión se ven el gráfico y el ranking.");
  }

  function nowSec() { return Math.floor(Date.now() / 1000); }

  function render() {
    const ok = ui.candles && R.ASSETS.some((a) => ui.candles[a].length);
    if (!ok) { $("meta").textContent = "Sin datos de precios"; $("submit").disabled = true; return; }
    ui.state = R.replay(ui.mine, ui.candles, nowSec());
    const s = ui.state;
    const lastClose = Math.max(...R.ASSETS.map((a) => { const l = ui.candles[a].filter((k) => k.t + R.CANDLE <= nowSec()); return l.length ? l[l.length - 1].t + R.CANDLE : 0; }));
    $("meta").textContent = "Último cierre de vela: " + when(lastClose);
    $("balance").textContent = fmt(s.balance);
    $("equity").textContent = fmt(s.equity);
    $("perf").textContent = (s.perf >= 0 ? "+" : "") + s.perf + "%";
    $("perf").className = "pt-perf " + (s.perf >= 0 ? "up" : "down");
    renderChart(); renderPositions(); renderPending(); renderHistory(); renderRanking();
    $("resets").textContent = s.resets ? "Reiniciaste " + s.resets + (s.resets === 1 ? " vez." : " veces.") : "";
    $("submit").disabled = !ui.user;
    $("reset").disabled = !ui.user;
  }

  function renderChart() {
    const tabs = $("assets"); tabs.innerHTML = "";
    R.ASSETS.forEach((a) => {
      const b = document.createElement("button"); b.type = "button"; b.role = "tab"; b.textContent = a.toUpperCase();
      b.setAttribute("aria-selected", String(a === ui.asset)); b.onclick = () => { ui.asset = a; $("f-asset").value = a; render(); };
      tabs.appendChild(b);
    });
    [...$("ranges").children].forEach((b) => { b.setAttribute("aria-pressed", String(+b.dataset.range === ui.range)); b.onclick = () => { ui.range = +b.dataset.range; render(); }; });
    const from = nowSec() - ui.range * 7 * 86400;
    const list = ui.candles[ui.asset].filter((k) => k.t >= from && k.t + R.CANDLE <= nowSec());
    const lines = ui.state.positions.filter((p) => p.asset === ui.asset).flatMap((p) => [
      { price: p.entry, label: "Entrada", cls: "entry" },
      p.tp && { price: p.tp, label: "TP", cls: "tp" }, p.sl && { price: p.sl, label: "SL", cls: "sl" }, p.liq && { price: p.liq, label: "Liq", cls: "liq" },
    ].filter(Boolean));
    $("chart").innerHTML = C.chartSVG(list, lines, { width: 640, height: 260 }) || "<p class='pt-meta'>Sin velas en este rango.</p>";
  }

  const item = (main, right, small) => { const d = document.createElement("div"); d.className = "item"; d.innerHTML = "<span></span><span></span><small></small>"; d.children[0].textContent = main; d.children[1].textContent = right; d.children[2].textContent = small; return d; };

  function renderPositions() {
    const box = $("positions"); box.innerHTML = "";
    if (!ui.state.positions.length) { box.appendChild(item("Sin posiciones abiertas", "", "")); return; }
    for (const p of ui.state.positions) {
      const d = item(p.asset.toUpperCase() + " " + p.lev + "x · " + fmt(p.usd), (p.pnl >= 0 ? "+" : "") + fmt(p.pnl),
        "Entrada " + C.fmtPrice(p.entry) + (p.tp ? " · TP " + C.fmtPrice(p.tp) : "") + (p.sl ? " · SL " + C.fmtPrice(p.sl) : "") + (p.liq ? " · Liq " + C.fmtPrice(p.liq) : "") + " · " + when(p.openedAt + R.CANDLE));
      d.children[1].className = p.pnl >= 0 ? "pt-perf up" : "pt-perf down";
      if (ui.user) { const b = document.createElement("button"); b.type = "button"; b.className = "close"; b.textContent = "Cerrar al cierre de vela"; b.onclick = () => close(p); d.appendChild(b); }
      box.appendChild(d);
    }
  }

  function renderPending() {
    const box = $("pending"); box.innerHTML = "";
    $("pending-card").hidden = !ui.state.pending.length;
    for (const o of ui.state.pending) box.appendChild(item(o.side === "buy" ? "Compra " + o.asset.toUpperCase() + " " + o.lev + "x · " + fmt(o.usd) : "Cierre de posición", "", "Se ejecuta al cierre de la vela, a las " + when(o.fillAt)));
  }

  const KIND = { buy: "Compra", sell: "Cierre manual", tp: "Take-profit", sl: "Stop-loss", liq: "Liquidación", invalid: "Orden no ejecutada", reset: "Reinicio" };
  function renderHistory() {
    const box = $("history"); box.innerHTML = "";
    const h = [...ui.state.history].reverse().slice(0, 50);
    if (!h.length) box.appendChild(item("Todavía sin operaciones", "", ""));
    for (const e of h) box.appendChild(item(KIND[e.kind] + (e.asset ? " " + e.asset.toUpperCase() : ""), e.pnl !== undefined ? (e.pnl >= 0 ? "+" : "") + fmt(e.pnl) : "", when(e.t) + (e.price ? " · " + C.fmtPrice(e.price) : "") + (e.why ? " · " + e.why : "")));
  }

  function renderRanking() {
    const box = $("ranking"); box.innerHTML = "";
    const rows = (ui.ranking && ui.ranking.rows) || [];
    if (!rows.length) { box.appendChild(item("El ranking aparece cuando n8n lo publica, cada hora.", "", "")); return; }
    rows.forEach((r, i) => { const d = item((i + 1) + ". " + r.u, (r.r >= 0 ? "+" : "") + r.r + "%", r.resets ? r.resets + (r.resets === 1 ? " reinicio" : " reinicios") : ""); if (r.u === ui.user) d.classList.add("me"); box.appendChild(d); });
  }

  async function close(p) { /* Task 6 */ }
  async function order(ev) { ev.preventDefault(); /* Task 6 */ }
  async function reset() { /* Task 6 */ }

  $("f-asset").innerHTML = R.ASSETS.map((a) => `<option value="${a}">${a.toUpperCase()}</option>`).join("");
  $("order").onsubmit = order;
  $("reset").onclick = reset;
  load().then(render);
})();
