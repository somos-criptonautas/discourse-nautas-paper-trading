[Versión en español](README.es.md)

Educational simulator. Nothing here is financial advice.

# discourse-nautas-paper-trading

Swing trading paper-trading artifact for comunidad.criptonautas.co. Members trade a fictional 1,000 USD on real 4h candles (BTC, ETH, PAXG, XMR, XNO, TRX). Orders fill at the close of the 4h candle; take-profit, stop-loss and 2x liquidation are evaluated per candle. Balances are never stored: they are replayed from immutable order keys against candles published by n8n, so the public ranking cannot be inflated. The chart has zoom and pan, a volume panel, a stochastic (14, 3, 3) panel, the last price on the axis, and TP/SL/liquidation lines pinned to the edge when out of range. Chart: drag to pan, drag the axes to scale, pinch or wheel to zoom, magnifier buttons. Seasons: every four months (UTC blocks starting Jan 1, May 1, Sep 1) everyone restarts at 1,000 USD and the ranking only counts the current season; the artifact deletes your keys from past seasons on load.

- `src/` artifact (no external scripts), `n8n/` Code node scripts and workflow notes, `build.py`, `paperctl.py`.
- `npm test` runs the engine, chart and n8n script tests. `python3 build.py` builds `dist/` and a local `preview.html`.

Code: MIT. Text: CC BY-NC-SA 4.0.
