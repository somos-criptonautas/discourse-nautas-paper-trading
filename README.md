[Versión en español](README.es.md)

Educational simulator. Nothing here is financial advice.

# discourse-nautas-paper-trading

Swing trading paper-trading artifact for comunidad.criptonautas.co. Members trade a fictional 1,000 USD on real 4h candles (BTC, ETH, PAXG, XMR, XNO, TRX). Orders fill at the close of the 4h candle; take-profit, stop-loss and 2x liquidation are evaluated per candle. Balances are never stored: they are replayed from immutable order keys against candles published by n8n, so the public ranking cannot be inflated.

- `src/` artifact (no external scripts), `n8n/` Code node scripts and workflow notes, `build.py`, `paperctl.py`.
- `npm test` runs the engine, chart and n8n script tests. `python3 build.py` builds `dist/` and a local `preview.html`.

Code: MIT. Text: CC BY-NC-SA 4.0.
