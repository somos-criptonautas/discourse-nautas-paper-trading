# Agents

- Engine, UI and n8n scripts share `src/replay.js`. Change the trading rules there only, then run `npm test`.
- `python3 build.py` writes `dist/`; `python3 paperctl.py publish` sends it to the n8n webhook.
- Seasons (4-month UTC blocks, Jan 1 / May 1 / Sep 1) live in `replay.js` (`seasonStart`, `seasonEnd`): keys older than the season start are ignored by every consumer.
- UI copy is Spanish, lowercase, first person plural ("operamos"); tickers, pairs and USD stay uppercase.
- Secrets live in `.env` (webhook token, `CURSO_WEBHOOK_TOKEN`) and in n8n credentials. Never in code.
- A change is ready when `npm test` passes, `python3 build.py` builds, and `dist/preview.html` renders at 375 and 1100px in both color schemes with no console errors.
