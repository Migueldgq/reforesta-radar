# Pruebas de extremo a extremo (Playwright)

Prueban la app entera (web + API + Postgres) en Chromium, con datos fijos: nunca leen las fuentes oficiales. Decisión
y contrapartidas en [ADR 0038](../docs/adr/0038-pruebas-de-extremo-a-extremo-y-comprobaciones-tras-desplegar.md).

## Ejecutar en local

Hace falta Docker y Node (`npm ci`). La primera vez, el navegador: `npx playwright install chromium`.

```bash
npm run e2e          # levanta la pila de pruebas, ejecuta todo y la borra (volumen incluido)
```

O por partes, para repetir las pruebas sin reconstruir:

```bash
npm run e2e:up       # construye y arranca la pila de pruebas (unos 70 s la primera vez)
npm run e2e:test     # cada ejecución vuelve a sembrar la base y crea cuentas nuevas
npx playwright test seguimiento --headed   # un fichero, viendo el navegador
npx playwright show-report                 # informe HTML (trazas y capturas de los fallos)
npm run e2e:down     # para y borra la pila de pruebas y su volumen
```

La pila de pruebas es otro proyecto de compose (`radar-e2e`) con sus propias imágenes, volumen y puertos: web
<http://localhost:3090>, API `:8090`, Postgres `:5490`. No toca la pila de desarrollo (`:3010`, `:8010`, `:5440`) ni
el `.env` de la raíz: usa [`e2e/e2e.env`](e2e.env) y [`e2e/docker-compose.e2e.yml`](docker-compose.e2e.yml), que
no arranca `ingest-scheduler`.

## Datos y cuentas

Antes de cada ejecución, [`global-setup.ts`](global-setup.ts):

1. Ejecuta [`backend/tests/e2e_seed.py`](../backend/tests/e2e_seed.py) dentro del contenedor `api`: vacía la base
   (solo si `RADAR_E2E=1`, que solo tiene la pila de pruebas) y carga, con el mismo código que la ingesta, 7
   convocatorias BDNS hechas a partir de las fichas grabadas en `backend/tests/fixtures/` (tres de ellas abiertas,
   con fechas relativas a hoy), el historial de la BDNS 904719 (Reforesta la ganó en 2025, 2024 y 2022), los 6
   programas de empresas y una tarjeta del tablero cuya convocatoria ya no está en las fuentes.
2. Crea la cuenta de administración con el comando real (`python -m app.users create-admin --generate`).
3. Esa cuenta invita al resto por la API y cada persona acepta su invitación con una contraseña generada en ese
   momento. Correos `e2e-<cuenta>-<id de la ejecución>@example.org`.

Contraseñas y sesiones se guardan solo en `e2e/.auth/` (en `.gitignore`). Cada fichero de pruebas usa sus propias
cuentas y solo cambia sus propios datos, así que se ejecutan en paralelo.

| Fichero | Qué prueba |
|---|---|
| `auth.spec.ts` | Sin sesión, `/` → portada (`/landing`) y su botón a `/login`; cookie caducada en `/` → `/login`; otra página sin sesión → `/login` y vuelta; contraseña mala con el error en castellano; entrar y salir; sesión caducada a mitad de uso. |
| `inicio.spec.ts` | La lista carga; un filtro y el buscador la acotan; el panel de detalle con nota, motivos y avisos; «Ya la ganasteis» con sus ediciones; enlace `?c=<id>`. |
| `seguimiento.spec.ts` | Estado, responsable, nota y voto desde el panel, y otra persona lo ve igual; una tarjeta cuya convocatoria ya no está en las fuentes se abre sin romper la app (el fallo de `Drawer.tsx`). |
| `equipo.spec.ts` | Invitar → enlace de un solo uso en otro navegador → contraseña → entrar; un miembro no puede abrir Equipo. |
| `paginas.spec.ts` | Empresas, Fuentes, Perfil y Analizar PDF (un PDF real de `data/samples/` y el aviso de «no es un PDF»). |
| `agente.spec.ts` | Inicio de sesión desde un agente (OAuth): registro, PKCE, «Permitir» → código e `iss` al puerto local → token → `/mcp/equipo`; «No permitir» a una web desconocida se queda en el radar. |
| `accesibilidad.spec.ts` | axe-core en entrar, Inicio con el panel abierto y la página de permiso: ningún fallo grave ni crítico. |

## En CI

El trabajo «End-to-end (Playwright)» de `.github/workflows/ci.yml` ejecuta la misma suite sin Docker: Postgres como
servicio, la API con `uv` y la web con `next build` y su servidor `standalone`. `E2E_BACKEND=uv run --directory backend`
le dice a `global-setup.ts` cómo ejecutar los comandos del backend. Un reintento por prueba; si algo falla, el informe,
las trazas y los logs de la API y la web quedan como artefacto `playwright-report`.
