"""Publishes dist/ through the n8n workflow "curso-publish-artifact" and writes embed.md.
  python3 paperctl.py publish
Needs CURSO_WEBHOOK_TOKEN in the environment or in .env (git-ignored); CURSO_WEBHOOK_URL is optional."""
import json, os, pathlib, sys, urllib.error, urllib.request

ROOT = pathlib.Path(__file__).parent

POST_ID = 362214  # first post of "prueba paper trading" (topic 7161): the artifact hangs off this post
HEIGHT = 1920  # shortcut: max measured + 16 rounded up to the next 10; measured in preview.html with two positions, one pending order, history and ranking folded: 1895px at 650px, 1749px at 375px; re-measure after UI changes
IDS = ROOT / "artifact.json"


def env(name, default=None):
    if name in os.environ:
        return os.environ[name]
    f = ROOT / ".env"
    for line in f.read_text().splitlines() if f.exists() else []:
        k, _, v = line.partition("=")
        if k.strip() == name:
            return v.strip().strip('"')
    if default is None:
        sys.exit(f"Missing {name} in .env")
    return default


def post(url, body, headers):
    req = urllib.request.Request(url, method="POST", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json", "User-Agent": "criptonautas-paperctl/1.0", **headers})
    for attempt in (1, 2, 3):  # retrying is safe: the workflow updates the artifact instead of duplicating it
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read() or "null")
        except urllib.error.HTTPError:
            raise
        except OSError as e:  # timeout or dropped connection
            if attempt == 3:
                raise
            print("  retry", url, type(e).__name__)


def publish():
    d = ROOT / "dist"
    body = {"key": "paper-trading", "kind": "paper", "title": "paper trading", "post_id": POST_ID, "shape": "",
            "artifact": {"name": "paper trading · swing en 4h", "html": (d / "paper.html").read_text(),
                         "css": (d / "paper.css").read_text(), "js": (d / "paper.js").read_text()}}
    res = post(env("CURSO_WEBHOOK_URL", "https://api.criptonautas.co/webhook/curso-artifacts"), body,
                       {"X-Curso-Token": env("CURSO_WEBHOOK_TOKEN")})
    IDS.write_text(json.dumps(res))
    # [wrap=full-screen] is the hook the theme widens the topic on (Horizon Mods Nautas, scss/topic.scss)
    (ROOT / "embed.md").write_text(
        "[wrap=full-screen]\n"
        f'<div class="ai-artifact" data-ai-artifact-id="{res["artifact_id"]}" data-ai-artifact-height="{HEIGHT}" data-ai-artifact-seamless="true"></div>\n'
        "[/wrap]\n")
    print("ok artifact", res["artifact_id"], "→ embed.md")


if __name__ == "__main__":
    publish() if sys.argv[1:] == ["publish"] else sys.exit(__doc__)
