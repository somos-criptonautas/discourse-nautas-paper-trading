# Agents

- Engine, UI and n8n scripts share `src/replay.js`. Change the trading rules there only, then run `npm test`.
- `python3 build.py` writes `dist/`; `python3 paperctl.py publish` sends it to the n8n webhook.
- UI copy is Spanish, first person plural ("operamos"), see `../discourse-nautas-quizz/ESTILO.md`.
- Secrets live in `.env` (webhook token) and in n8n credentials. Never in code.
