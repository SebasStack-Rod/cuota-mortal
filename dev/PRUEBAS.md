# Pruebas a mano con `dev/net-test.html`

Abrí la página desde GitHub Pages (o un servidor local) en **dos pestañas** o en pestaña + celular.
La primera pestaña es el **anfitrión** (la que toca "Crear sala"). Todas las pruebas usan el juego de prueba "dummy".
Orden importante: **"Día de 10 s" se toca en el lobby, ANTES de "Iniciar partida"**.

## 1. Entrar a una sala
1. Pestaña A: nombre "Ana" → **Crear sala**. Copiá el código de 4 letras.
2. Pestaña B: nombre "Bea", pegá el código → **Unirse**.
3. Tiene que verse a las dos en la tabla de jugadores, las dos con 🟢.

## 2. Apuesta simultánea con banco de $1
1. Con A y B en la sala: **Día de 10 s** → **Iniciar partida**. En las dos: **Sentarse en "dummy"**.
2. En A: **Dejar el banco en $1 (prueba)**. El banco tiene que mostrar **$1**.
3. En A y B, tocá casi a la vez **Apostar $1 a cara** (o "$1 × 5 de golpe" en las dos).
4. Resultado esperado: una apuesta se acepta (`ok`) y las demás reciben `ERROR sin_fondos`. El banco nunca baja de $0.
   (Si la apuesta que se acepta gana, el banco sube y se aceptan más: es normal.)

## 3. Recarga dentro de los 60 segundos
1. Con la partida en curso (o en el lobby), recargá la pestaña B (F5).
2. Rápido, tocá **Unirse** con el mismo código (el nombre se recuerda solo en esa pestaña).
3. Esperado: Bea recupera su lugar (mismo nombre, mismo color, mismas estadísticas). En A se la ve 🔴 un momento y luego 🟢.
4. Si tardás más de 60 segundos, Bea desaparece de la lista (en el lobby podés volver a entrar como nueva).

## 4. Día acelerado: cobro con banco suficiente y con banco insuficiente
- **Suficiente:** sala nueva → **Día de 10 s** → **Iniciar** → esperá 10 s. Esperado: "Cobrando la cuota", banco $2.000 → $1.000; luego Tienda (60 s) y Día 2 con cuota $1.400.
- **Insuficiente:** sentate, tocá **Dejar el banco en $1 (prueba)** y esperá el fin del día. Esperado: "IMPAGA", después **GAME OVER**. Después, **Revancha** (anfitrión) vuelve al lobby con los mismos jugadores.

## 5. Compra por votación (con 1 jugador, con 3 jugadores y con empate)
Todavía no se puede probar: la tienda y la votación son la **Fase 4**.

## 6. Se cierra el anfitrión
1. Con A (anfitrión) y B en la sala, cerrá la pestaña A o tocá **Salir** en A.
2. Esperado en B, a los pocos segundos: el aviso `[warn] El anfitrión se desconectó` y la conexión pasa a `offline`.

## 7. Orden de las cuotas del día 1 al 7
Abrí `dev/base-test.html`: la línea "Cuotas de los 7 días" tiene que mostrar `1000, 1400, 1960, 2744, 3842, 5378, 7530` con ✅.

## 8. Estadísticas, títulos e historial (fase 3)
1. Con dos jugadores sentados, apostá varias veces con **Apostar $1 a cara**. En la tabla mirá: *Apostó*, *Neto* (verde si ganó, rojo si perdió), *Racha*, *Mejor* y *Peor*.
2. Tiene que aparecer 🏆 **Mayor ganador** (el de mayor neto positivo) y 🐑 **Oveja negra** (el de menor neto negativo). Si todos están en cero, aparecen con "—".
3. Al terminar el día, el resumen dice cuánto cambió el banco jugando ese día y quién ganó o perdió más.
4. **Historial:** al terminar la partida (GAME OVER), esperá unos segundos y tocá **Ver rankings**. En el registro tienen que aparecer los nombres con su neto, y la partida en `bestRuns`. También se ve en Supabase → Table Editor → `runs` (con resultado y días) y `events` (apuestas, cobros, cuotas).
