[English version](README.md)

Simulador educativo. Nada de esto es asesoramiento financiero.

# discourse-nautas-paper-trading

Artefacto de paper trading de swing trading para comunidad.criptonautas.co. Los miembros operan 1.000 USD ficticios sobre velas reales de 4h (BTC, ETH, PAXG, XMR, XNO, TRX). Las órdenes se ejecutan al cierre de la vela de 4h; el take-profit, el stop-loss y la liquidación a 2x se evalúan vela a vela. Los saldos nunca se guardan: se recalculan a partir de claves de orden inmutables sobre las velas publicadas por n8n, así que el ranking público no puede inflarse. El gráfico tiene zoom y desplazamiento, un panel de estocástico (14, 3, 3) y las líneas de TP, SL y liquidación se pegan al borde cuando quedan fuera de rango.

- `src/` artefacto (sin scripts externos), `n8n/` scripts de nodos Code y notas del flujo de trabajo, `build.py`, `paperctl.py`.
- `npm test` ejecuta las pruebas del motor, del gráfico y de los scripts de n8n. `python3 build.py` genera `dist/` y un `preview.html` local.

Código: MIT. Texto: CC BY-NC-SA 4.0.
