"""Publishes dist/ through the n8n workflow "Curso: publicar artifact" and writes embed.md.
  python3 paperctl.py publish
Reuses env() and post() from ../discourse-nautas-quizz/quizctl.py; the webhook token comes from that folder's .env
(CURSO_WEBHOOK_TOKEN) unless a local .env overrides it."""
import json, pathlib, sys

ROOT = pathlib.Path(__file__).parent
sys.path.insert(0, str(ROOT.parent / "discourse-nautas-quizz"))
import quizctl

POST_ID = 362214  # first post of "prueba paper trading" (topic 7161): the artifact hangs off this post
HEIGHT = 1920  # shortcut: max measured + 16 rounded up to the next 10; measured in preview.html with two positions, one pending order, history and ranking folded: 1895px at 650px, 1749px at 375px; re-measure after UI changes
IDS = ROOT / "artifact.json"


def env(name, default=None):
    f = ROOT / ".env"
    for line in f.read_text().splitlines() if f.exists() else []:
        k, _, v = line.partition("=")
        if k.strip() == name:
            return v.strip().strip('"')
    return quizctl.env(name, default)


def publish():
    d = ROOT / "dist"
    body = {"key": "paper-trading", "kind": "paper", "title": "paper trading", "post_id": POST_ID, "shape": "",
            "artifact": {"name": "paper trading · swing en 4h", "html": (d / "paper.html").read_text(),
                         "css": (d / "paper.css").read_text(), "js": (d / "paper.js").read_text()}}
    res = quizctl.post(env("CURSO_WEBHOOK_URL", "https://api.criptonautas.co/webhook/curso-artifacts"), body,
                       {"X-Curso-Token": env("CURSO_WEBHOOK_TOKEN")})
    IDS.write_text(json.dumps(res))
    (ROOT / "embed.md").write_text(
        f'<div class="ai-artifact" data-ai-artifact-id="{res["artifact_id"]}" data-ai-artifact-height="{HEIGHT}" data-ai-artifact-seamless="true"></div>\n')
    print("ok artifact", res["artifact_id"], "→ embed.md")


if __name__ == "__main__":
    publish() if sys.argv[1:] == ["publish"] else sys.exit(__doc__)
