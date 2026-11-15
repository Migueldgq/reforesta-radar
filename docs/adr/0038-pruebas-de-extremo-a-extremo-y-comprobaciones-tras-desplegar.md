# 0038. Pruebas de extremo a extremo con Playwright y comprobaciones tras desplegar

- Estado: Aceptada
- Fecha: 2026-11-15 (rama `test/e2e`)

## Contexto
El backend tiene 227 tests de pytest; la web, ninguno, y nada probaba la app entera en un navegador. Un fallo real
bloqueó producción: abrir una tarjeta del tablero cuya convocatoria ya no estaba en las fuentes metía a
`Drawer.tsx` en un bucle de renderizado (corregido en 49e3e6b), algo que ningún test del backend podía ver. CI
(`ci.yml`) solo compilaba la web, y el despliegue (`deploy.yml`) solo comprobaba `/login` y el emisor OAuth. Las
fuentes oficiales cambian cada día, así que unas pruebas que las leyeran no serían repetibles.

## Decisión
- **Playwright** (`@playwright/test`, solo Chromium) en `e2e/`, contra la app entera (web + API + Postgres) con datos
  fijos. Unas 20 pruebas de los recorridos que importan: entrar y salir, Inicio, seguimiento compartido, Equipo,
  inicio de sesión desde un agente (OAuth hasta `/mcp/equipo`) y una pasada de axe-core.
- **Datos:** `backend/tests/e2e_seed.py` vacía la base (solo con `RADAR_E2E=1`) y carga convocatorias construidas con
  el código real de la ingesta a partir de las fichas grabadas en `backend/tests/fixtures/`, con fechas relativas al
  día. Sin red.
- **Cuentas:** la primera con el comando real (`python -m app.users create-admin --generate`) y las demás por
  invitación a través de la API; contraseñas generadas en cada ejecución, nunca en el repositorio.
- **En local**, una pila de compose aparte (`radar-e2e`, puertos 3090/8090/5490, sin `ingest-scheduler`) que no toca la
  de desarrollo: `npm run e2e`. **En CI**, un trabajo «End-to-end (Playwright)» sin imágenes de Docker (Postgres como
  servicio, API con `uv`, web con `next build` y su servidor `standalone`), porque las cachés de uv, npm, Next y del
  navegador lo hacen más rápido que construir las dos imágenes en cada ejecución. Un reintento en CI, ninguno en
  local. Como `deploy.yml` solo despliega cuando CI entero sale en verde, las pruebas de extremo a extremo también
  bloquean el despliegue.
- **Tras desplegar**, `deploy/smoke.sh <URL pública>` hace desde fuera comprobaciones de solo lectura (página de
  entrada, 401 sin sesión, datos públicos, MCP público y de equipo, emisor OAuth, http → https, HSTS). No depende de
  cómo se despliega: solo necesita la URL.

## Consecuencias
- Un fallo de la web que rompe un recorrido (como el del panel de detalle) para el PR antes de llegar a `main`.
- CI tarda más (el trabajo nuevo, unos 4-5 minutos, corre en paralelo con los otros dos) y hay que mantener los
  selectores: se usan roles, etiquetas y textos en castellano, así que cambiar un texto visible puede exigir cambiar
  una prueba.
- CI no prueba las imágenes de Docker; la pila local de pruebas sí las usa.
- Las comprobaciones tras desplegar corren después de la vuelta atrás automática de `deploy.sh`: si fallan, el
  workflow sale en rojo pero **no** vuelve a la versión anterior; hay que hacerlo a mano (docs/despliegue.md).
- Los datos fijos no cubren lo que solo pasa con datos reales de las fuentes; eso sigue en los tests del backend.

## Alternativas consideradas
- Tests unitarios de la lógica de la web con Vitest (filtros, `model.ts`, `store.tsx`): útiles, pero no habrían visto
  el bucle de `Drawer.tsx`, que solo aparece con la app montada y datos del tablero. Aplazados, no descartados.
- Ejecutar la pila de compose también en CI: misma configuración que en local, pero construir las dos imágenes en cada
  ejecución es más lento y la caché de capas de Docker en GitHub Actions añade piezas.
- Pruebas contra datos de una ingesta real: no repetibles y dependen de webs ajenas.
- Comprobaciones tras desplegar que entran con una cuenta: crearían sesiones y datos en producción.
