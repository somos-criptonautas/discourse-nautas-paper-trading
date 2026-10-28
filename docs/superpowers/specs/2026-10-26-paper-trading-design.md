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
  gana el nivel de abajo más cercano a la entrada: SL antes que liquidación (el precio cae y toca primero el
  SL, que siempre está por encima), y cualquiera de los dos antes que TP (regla conservadora, idéntica en
  artifact y n8n).
- Activos: BTC, ETH, PAXG, XMR, XNO, TRX, cotizados en USD. Fuente: velas de 4h del endpoint público de Kraken
  (`/0/public/OHLC`, `interval=240`, sin clave), pares XBTUSD, ETHUSD, PAXGUSD, XMRUSD, NANOUSD (XNO), TRXUSD.
  Trae 720 velas por llamada, unos cuatro meses, con volumen por vela.
- Saldo inicial 1.000 USD, cercano a lo que pondría alguien que empieza. Reinicio libre; el ranking muestra
  cuántas veces reinició cada uno.
- Tamaños: el monto se ingresa en USD, mínimo 10, máximo el saldo; el artifact muestra las unidades con
  fracciones y ofrece 2%, 5% y 10% del saldo. Cada compra es una posición independiente con su TP, SL y
  apalancamiento; se cierra a mano de a una.
- Gráfico de velas de 4h por par, dibujado en SVG dentro del artifact: rango de una semana, un mes o seis
  meses, zoom y desplazamiento, precio actual marcado en el eje, líneas de entrada, TP, SL y liquidación de
  las posiciones abiertas en ese par (las que caen fuera de la escala van pegadas al borde). Debajo, barras de
  volumen y un estocástico 14,3,3 rotulado "estocástico (stoch)". Sin dibujo libre ni más indicadores.
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
- Límite: 100 claves por usuario y artifact, marcadores incluidos. Las compras se bloquean desde 95 claves
  con el aviso "llegamos al límite de claves guardadas"; las 5 restantes quedan para cerrar posiciones.
  El cierre se bloquea recién en 100, con el mismo aviso.

**Repaso** (función `replay(orders, candles, now)`): ordena por `created_at`, parte del último reset,
ejecuta cada orden al cierre de su vela de 4h, y por cada vela posterior revisa liquidación, SL y TP de las
posiciones abiertas, en ese orden. Devuelve saldo en USD, posiciones abiertas valuadas al cierre de la última vela cerrada (no al precio `now`), historial de
ejecuciones y rendimiento total. Órdenes inválidas (activo desconocido, `usd` mayor que el saldo,
venta de una posición inexistente o ya cerrada) se ignoran y se marcan en el historial.

**Antitrampa**: borrar una orden perdedora inflaría el resultado. n8n guarda en su Data Table
`paper_trading_keys` cada `(user_id, key, created_at)` que vio. Si en una corrida falta una clave vista
cuyo `created_at` es posterior al último marcador del usuario, ese usuario sale del ranking con la
marca "borró operaciones" hasta su próximo reinicio. Sobrescribir una clave también cuenta: Discourse
conserva `created_at` y solo mueve `updated_at`, así que una clave `o-*` o `reset-*` posterior al último
marcador con `updated_at` distinto de `created_at` saca al usuario del ranking, y el repaso marca esa orden
como no ejecutada ("orden modificada después de enviarla").

## 2. Datos publicados por `system`

- `candles-<AAAA-Www>-a` y `candles-<AAAA-Www>-b` (dos claves por semana ISO, tres activos cada una):
  velas de 4h. Valor JSON compacto: `{ "t0": <epoch del primer cierre>, "btc": [[h,l,c,v], ...], ... }`,
  42 velas por activo, precios y volumen (en unidades del activo) con cuatro cifras significativas. Unos
  3.000 caracteres por clave: una sola clave semanal con los seis activos superaría el límite de 5.000. Se conservan 26 semanas (52
  claves de las 100 que admite `system`); las más viejas se borran.
- `now`: `{ "t": <epoch>, "btc": 67123.4, ... }`, último precio (cierre de la vela en curso de Kraken),
  actualizado cada 5 minutos. Sólo para mostrar y precargar TP/SL; nunca entra en el repaso.
- `ranking`: `{ "t": <epoch>, "rows": [{ "u": "nombre", "r": 12.3, "resets": 1 }, ...] }`, ordenado por
  rendimiento, actualizado cada hora. Quienes borraron operaciones no aparecen.

Posiciones con órdenes más viejas que las 26 semanas publicadas no se pueden repasar: el artifact lo
dice y propone reiniciar. Caso raro para swing; si aparece, se amplía el historial con velas diarias.

## 3. Flujos n8n

Nombres en inglés y minúsculas con guión, como el resto.

- `paper-trading-prices`, cada 5 minutos: pide a Kraken las velas de 4h de los seis pares (seis llamadas),
  escribe `now` y reescribe las claves de la semana en curso y la anterior con las velas tal cual vienen,
  incluida la vela abierta. Una corrida manual con `backfill=true` escribe todas las semanas de la respuesta
  (unos cuatro meses). Si Kraken falla para un par, ese par no se toca. Seis llamadas cada 5 minutos están
  muy por debajo del límite público de Kraken.
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
4. Nueva orden para el par elegido en el gráfico: monto en USD con botones 2/5/10% del saldo y el saldo
   disponible a la vista, 1x o 2x, TP y SL opcionales precargados con el precio actual para editarlos. Texto
   fijo: "se ejecuta al cierre de la vela de 4h, a las HH:MM". Validación en cliente: monto entre 10 USD y el
   saldo; TP mayor y SL menor que el precio de referencia; con 2x, SL por encima del precio de liquidación.
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

Ligas con plazo, órdenes límite de entrada, apalancamiento mayor a 2x, cortos, otros indicadores y dibujo
libre en el gráfico, notificaciones individuales, más activos.
