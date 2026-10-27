# Paper trading en la comunidad: diseño

Simulador de swing trading spot para comunidad.criptonautas.co, hecho con un artifact de Discourse
y flujos de n8n. Mismo sustrato que los quizzes del curso (`discourse-nautas-quizz`): el usuario
escribe sólo sus propias claves, el usuario `system` publica datos que todos leen, n8n es el único
que actúa como `system`.

## Decisiones tomadas

- Cada uno opera solo contra precios reales, con saldo ficticio. No hay intercambio entre usuarios.
- Spot en largo: comprar y vender. Cada compra lleva take-profit y stop-loss opcionales y apalancamiento 1x o 2x.
  Sin cortos. Con 2x el monto puesto es el margen, la posición vale el doble y se liquida si el precio toca un 45%
  por debajo de la entrada: se pierde el monto puesto, nunca más. Sin intereses ni funding; el artifact lo aclara.
- Velas de 4h. Toda orden se ejecuta al cierre de la vela de 4h en curso. Liquidación, TP y SL se evalúan
  contra el máximo y el mínimo de cada vela y se ejecutan al precio fijado. Si una misma vela toca varios,
  el orden es liquidación, SL, TP (regla conservadora, idéntica en artifact y n8n).
- Activos: BTC, ETH, PAXG, XMR, XNO, TRX, cotizados en USD. Fuente: CoinGecko, plan gratuito.
- Saldo inicial 1.000 USD, cercano a lo que pondría alguien que empieza. Reinicio libre; el ranking muestra
  cuántas veces reinició cada uno.
- Tamaños: el monto se ingresa en USD, mínimo 10, máximo el saldo; el artifact muestra las unidades con
  fracciones y ofrece 2%, 5% y 10% del saldo. Cada compra es una posición independiente con su TP, SL y
  apalancamiento; se cierra a mano de a una.
- Gráfico de velas de 4h por activo, dibujado en SVG dentro del artifact, con rango de una semana, un mes o
  seis meses, y líneas de entrada, TP, SL y liquidación de las posiciones abiertas en ese activo. Sin zoom,
  indicadores ni dibujo libre.
- Privacidad: operaciones privadas. Público sólo el ranking con nombre, rendimiento y reinicios.
- Avisos: el usuario ve sus ejecuciones al abrir el artifact. n8n manda un resumen diario sin nombres
  al mensaje grupal de participantes.
- Ligas y retos con plazo quedan para una segunda etapa. El diseño no las impide: una liga es un
  ranking filtrado por fecha de reinicio.

## Principio de fiabilidad

Nada que escriba el usuario se toma como resultado. Saldo, posiciones y rendimiento se **recalculan**
repasando sus órdenes contra las velas publicadas por `system`. Los dos únicos datos de confianza son:

1. **Las velas**, que sólo escribe `system` (n8n).
2. **La fecha de creación de cada clave**, que pone el servidor de Discourse y el usuario no controla.

Con eso el precio de entrada no lo elige el usuario: es el cierre de la vela de 4h en que el servidor
fechó su orden. La función de repaso es una sola, en JavaScript puro, compartida entre el artifact y el
nodo Code de n8n. Mismo input, mismo número.

## 1. Datos del usuario

Una clave privada por orden, inmutable, nombre `o-<timestamp del cliente>` (sólo para unicidad; la fecha
válida es `created_at` del servidor). Valor JSON:

```
{ "asset": "btc", "side": "buy", "usd": 150, "lev": 2, "tp": 72000, "sl": 61000 }
{ "side": "sell", "of": "o-1761500000" }
```

- `buy`: gasta `usd` del saldo al cierre de vela y abre una posición; `tp`/`sl` opcionales, `lev` 1 o 2.
- `sell`: cierra a mano la posición abierta por la orden `of`, al cierre de vela.
- Reinicio: clave `reset-<timestamp>` con valor `"1"`. El repaso empieza en el último marcador con saldo
  1.000. Al reiniciar el artifact borra las claves de orden anteriores al marcador; los marcadores no
  se borran nunca.
- Límite: 100 claves por usuario y artifact. Marcadores incluidos, quedan unas 95 órdenes entre reinicios.
  El artifact avisa al llegar a 90.

**Repaso** (función `replay(orders, candles, now)`): ordena por `created_at`, parte del último reset,
ejecuta cada orden al cierre de su vela de 4h, y por cada vela posterior revisa liquidación, SL y TP de las
posiciones abiertas, en ese orden. Devuelve saldo en USD, posiciones abiertas con su valor al último cierre, historial de
ejecuciones y rendimiento total. Órdenes inválidas (activo desconocido, `usd` mayor que el saldo,
venta de una posición inexistente o ya cerrada) se ignoran y se marcan en el historial.

**Antitrampa**: borrar una orden perdedora inflaría el resultado. n8n guarda en su Data Table
`paper_trading_keys` cada `(user_id, key, created_at)` que vio. Si en una corrida falta una clave vista
cuyo `created_at` es posterior al último marcador del usuario, ese usuario sale del ranking con la
marca "borró operaciones" hasta su próximo reinicio.

## 2. Datos publicados por `system`

- `candles-<AAAA-Www>-a` y `candles-<AAAA-Www>-b` (dos claves por semana ISO, tres activos cada una):
  velas de 4h. Valor JSON compacto: `{ "t0": <epoch del primer cierre>, "btc": [[h,l,c], ...], ... }`,
  42 velas por activo, precios con cuatro cifras significativas. Unos 2.300 caracteres por clave: una
  sola clave semanal con los seis activos rozaría el límite de 5.000. Se conservan 26 semanas (52
  claves de las 100 que admite `system`); las más viejas se borran.
- `now`: `{ "t": <epoch>, "btc": 67123.4, ... }`, precio de referencia actualizado cada 5 minutos. Sólo
  para mostrar; nunca entra en el repaso.
- `ranking`: `{ "t": <epoch>, "rows": [{ "u": "nombre", "r": 12.3, "resets": 1 }, ...] }`, ordenado por
  rendimiento, actualizado cada hora. Quienes borraron operaciones no aparecen.

Posiciones con órdenes más viejas que las 26 semanas publicadas no se pueden repasar: el artifact lo
dice y propone reiniciar. Caso raro para swing; si aparece, se amplía el historial con velas diarias.

## 3. Flujos n8n

Nombres en inglés y minúsculas con guión, como el resto.

- `paper-trading-prices`, cada 5 minutos: pide a CoinGecko el precio de los seis activos, escribe `now`
  y actualiza la vela de 4h en curso (máximo, mínimo, último) de la clave semanal. Si CoinGecko falla,
  no escribe nada; la vela sigue con los datos anteriores. Una llamada cada 5 minutos está muy por
  debajo del límite gratuito.
- `paper-trading-ranking`, cada hora: pagina las claves de todos los usuarios (`all_users=true`, de a
  100), corre `replay` por usuario, registra las claves vistas, detecta borrados y publica `ranking`.
- `paper-trading-daily`, una vez al día: cuenta ejecuciones de TP, SL y órdenes de las últimas 24h a
  partir del repaso, y manda al mensaje grupal un resumen sin nombres. Si no hubo nada, no escribe.

Credenciales: la misma credencial de administrador que ya usa `curso-totals` para leer claves de
todos y escribir como `system`. Ninguna clave en código.

## 4. Artifact

Una pantalla, estilo de los quizzes (`ESTILO.md`), seamless y altura fija como los demás embeds.
Secciones, de arriba a abajo:

1. Saldo y rendimiento, con la hora del último cierre de vela usado.
2. Gráfico de velas del activo elegido, con rango y líneas de las posiciones abiertas.
3. Posiciones abiertas: activo, entrada, apalancamiento, TP, SL, liquidación, valor de referencia (`now`),
   resultado y botón de cerrar.
4. Nueva orden: activo, monto en USD con botones 2/5/10% del saldo, 1x o 2x, TP y SL opcionales. Texto fijo: "Se
   ejecuta al cierre de la vela de 4h, a las HH:MM". Validación en cliente: monto entre 10 USD y el saldo;
   TP mayor y SL menor que el precio de referencia; con 2x, SL por encima del precio de liquidación.
5. Órdenes pendientes de cierre de vela.
6. Historial de ejecuciones.
7. Ranking, con el puesto propio resaltado.
8. Reiniciar, con confirmación y el conteo de reinicios.

Sin sesión: muestra ranking y velas, no deja operar, con la misma nota que los quizzes.
Un solo artifact para toda la comunidad, embebido en un tema propio del foro.

## Errores

- Sin velas publicadas o JSON roto: el artifact muestra "sin datos de precios" y no deja operar.
- Escritura de clave fallida: aviso y la orden no se da por puesta.
- n8n: cada flujo escribe sólo si su paso anterior salió bien; un fallo deja el dato anterior.
  Errores van al flujo de errores ya existente.

## Pruebas

- `replay` con pruebas en Node, como `test.js` de los quizzes: compra y TP, compra y SL, misma vela toca
  ambos, 2x liquidado, 2x con SL antes de liquidación, dos posiciones del mismo activo y cierre de una,
  venta de posición inexistente, reset en medio, orden fuera del historial.
- El nodo Code de n8n usa el mismo archivo de `replay` inyectado al construir, y se prueba con las
  mismas fixtures (como `test_quizctl.py` hace con `n8n-sumar.js`).
- Vista previa local con velas falsas, igual que `build.py` hace hoy con `stats`.

## Fuera de alcance

Ligas con plazo, órdenes límite de entrada, apalancamiento mayor a 2x, cortos, zoom e indicadores en el
gráfico, notificaciones individuales, más activos.
