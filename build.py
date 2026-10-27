"""Builds dist/ from src/: the artifact parts, a local preview with a fake store, and the n8n Code node scripts.
Usage: python3 build.py"""
import json, pathlib, random, time

ROOT = pathlib.Path(__file__).parent
SRC, DIST, N8N = ROOT / "src", ROOT / "dist", ROOT / "n8n"
LIMIT = 64 * 1024  # Discourse limit per artifact part
DIST.mkdir(exist_ok=True)

html = (SRC / "paper.html").read_text()
css = (SRC / "paper.css").read_text()
js = "\n".join((SRC / f).read_text() for f in ("replay.js", "chart.js", "app.js"))
for name, body in (("paper.html", html), ("paper.css", css), ("paper.js", js)):
    assert len(body.encode()) < LIMIT, f"{name} > 64 KB"
    (DIST / name).write_text(body)

# n8n Code nodes: engine + script in one file, pasted into the node
for name in ("ranking", "daily", "prices"):
    f = N8N / f"{name}.js"
    if f.exists():
        (DIST / f"n8n-{name}.js").write_text((SRC / "replay.js").read_text() + "\n" + f.read_text())

# Preview: six months of fake 4h candles as weekly system keys, two fake orders, a fake ranking
rnd = random.Random(1)
CANDLE = 4 * 3600
now = int(time.time())
start = now - 26 * 7 * 86400
start -= (start - 4 * 86400) % (7 * 86400)  # Monday 00:00 UTC (epoch 0 was a Thursday)
base = {"btc": 67000, "eth": 3400, "paxg": 2400, "xmr": 160, "xno": 1.2, "trx": 0.12}
keys = []
for w in range(27):
    t0 = start + w * 7 * 86400
    for group, assets in (("a", ("btc", "eth", "paxg")), ("b", ("xmr", "xno", "trx"))):
        v = {"t0": t0}
        for a in assets:
            rows = []
            for i in range(42):
                if t0 + i * CANDLE > now:
                    break
                c = base[a] * (1 + rnd.uniform(-0.02, 0.02))
                h, l = max(base[a], c) * (1 + rnd.uniform(0, 0.01)), min(base[a], c) * (1 - rnd.uniform(0, 0.01))
                rows.append([float(f"{h:.4g}"), float(f"{l:.4g}"), float(f"{c:.4g}")])
                base[a] = c
            v[a] = rows
        d = time.gmtime(t0 + 3 * 86400)
        keys.append({"key": f"candles-{d.tm_year}-W{int(time.strftime('%V', d)):02d}-{group}", "user_id": -1, "value": json.dumps(v, separators=(",", ":"))})
assert all(len(k["value"]) < 5000 for k in keys), max(len(k["value"]) for k in keys)
keys.append({"key": "now", "user_id": -1, "value": json.dumps({"t": now, **base})})
keys.append({"key": "ranking", "user_id": -1, "value": json.dumps({"t": now, "rows": [{"u": "satoshi", "r": 12.5, "resets": 0}, {"u": "preview", "r": -3.1, "resets": 1}]})})
iso = lambda s: time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(s))
mine = [
    {"key": f"o-{(now - 5 * 86400) * 1000}", "user_id": 7, "user": {"username": "preview"}, "created_at": iso(now - 5 * 86400), "value": json.dumps({"asset": "btc", "side": "buy", "usd": 100, "lev": 2, "sl": base["btc"] * 0.8})},
    {"key": f"o-{(now - 2 * 86400) * 1000}", "user_id": 7, "user": {"username": "preview"}, "created_at": iso(now - 2 * 86400), "value": json.dumps({"asset": "eth", "side": "buy", "usd": 50, "lev": 1, "tp": base["eth"] * 1.1})},
]
mock = f"""<script>
window.discourseArtifactReady = Promise.resolve({{ username: "preview" }});
const _sys = {json.dumps(keys)}; const _mine = {json.dumps(mine)};
window.discourseArtifact = {{
  get: async (k) => {{ const x = _mine.find((m) => m.key === k); return x ? x.value : null; }},
  set: async (k, v) => {{ _mine.push({{ key: k, user_id: 7, user: {{ username: "preview" }}, created_at: new Date().toISOString(), value: v }}); console.log("set", k, v); return {{}}; }},
  delete: async (k) => {{ const i = _mine.findIndex((m) => m.key === k); if (i >= 0) _mine.splice(i, 1); console.log("delete", k); return {{}}; }},
  index: async (p) => {{ const all = (p && p.all_users ? _sys : []).concat(_mine); const per = (p && p.per_page) || 100, pg = (p && p.page) || 1;
    return {{ key_values: all.slice((pg - 1) * per, pg * per), has_more: all.length > pg * per }}; }},
}};
</script>"""
(DIST / "preview.html").write_text(
    f"<!doctype html><html lang=es><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
    f"<title>Paper trading preview</title><style>{css}</style>{mock}</head><body>{html}<script>{js}</script></body></html>"
)
print("dist/ ok")
