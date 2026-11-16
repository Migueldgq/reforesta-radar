# 0045. Revisión de PR con Crysk, solo consultiva y fijada por commit

- Estado: Aceptada
- Fecha: 2026-11-16 (rama `ci/crysk-review`)

## Contexto
Los PR pasan por CI (ruff, pytest, tsc, lint, build, Playwright), que no revisa el código en sí. El responsable del
proyecto quiere además una revisión automática por IA en cada PR. Crysk
(<https://github.com/cryskai/crysk>, Apache-2.0) es una acción de GitHub de código abierto que revisa el diff con
varios agentes de Claude y publica los hallazgos como comentarios del PR. Es un proyecto joven (versiones 0.x, con
cambios incompatibles entre versiones menores) y de un solo mantenedor, y la acción recibe una credencial de Claude.

## Decisión
- `.github/workflows/crysk.yml` ejecuta `cryskai/crysk` en cada PR (`pull_request`: `opened`, `synchronize`,
  `reopened`), solo de ramas de este repositorio. Nunca `pull_request_target`: GitHub no da secretos a un PR desde
  un fork.
- **Consultiva** (`mode: advisory`): el estado `crysk` sale en verde en toda revisión terminada, encuentre lo que
  encuentre, y no es un check obligatorio en la protección de rama. Un fallo del propio trabajo (credencial, caída de
  Crysk) lo pone en rojo, pero tampoco bloquea. No es el workflow `CI`, así que no lanza ni frena un despliegue
  (`deploy.yml` solo escucha a `CI`, ADR 0039).
- **Fijada por commit**: `uses: cryskai/crysk@<SHA completo> # vX.Y.Z` (hoy v0.7.0), no la etiqueta móvil `@v0`, para
  que una versión nueva no reciba la credencial sin que alguien la haya leído. Subir de versión es un PR que cambia el
  SHA tras leer su `CHANGELOG.md`.
- **Credencial**: el secreto `CRYSK_CLAUDE_OAUTH_TOKEN` (token de `claude setup-token` de la suscripción del
  responsable), pasado solo por la entrada `crysk-secrets`. Ninguna otra credencial se pasa.
- **Dónde va el diff**: el runner de GitHub ejecuta la CLI de Claude, que llama directamente a Anthropic. Según la
  documentación de Crysk, el modo «plataforma» (que habla con `api.crysk.dev`) solo se activa con un
  `workflow_dispatch` con `dispatch-id` y permiso `id-token: write`; este workflow no tiene ninguno de los dos. El
  directorio de la revisión (diff, instrucciones, hallazgos) se sube como artefacto del run 7 días; el repositorio es
  público, así que cualquiera puede descargarlo, pero solo contiene el diff, que ya es público.
- **Coste**: cuota de la suscripción de Claude del responsable; sin factura por tokens. Con suscripción Crysk no aplica
  tope de tamaño ni de gasto.
- **Comentario `/crysk review`** (repetir la revisión a mano): solo para el dueño del repositorio. El `if` del trabajo
  exige `author_association == 'OWNER'`, y la acción además rechaza a quien no tenga permiso de escritura. Motivo: el
  repositorio es público y cada ejecución gasta la cuota del responsable.
- Permisos del workflow: `contents: read`, `pull-requests: write`, `issues: write`, `statuses: write`,
  `checks: write`, los que pide la documentación de Crysk. Sin `id-token` (solo para el modo plataforma) ni
  `actions: read` (en un repositorio público no hace falta).
- `REVIEW.md` en la raíz da al revisor las invariantes del proyecto; `.cryskignore` deja fuera `uv.lock` y el audio
  del vídeo de demo.

## Consecuencias
- Cada PR recibe comentarios de una IA que pueden equivocarse; son una opinión, no una puerta. CI sigue siendo lo que
  decide.
- Cada push a un PR gasta cuota de la suscripción; si se agota, la revisión falla en rojo sin bloquear nada.
- La credencial de Claude pasa a una acción de terceros y a lo que esta instala (Bun, la CLI de Claude en su última
  versión, `actions/upload-artifact@v4` y `oven-sh/setup-bun@v2` por etiqueta). Fijar el SHA protege de una versión
  nueva de Crysk, no de esas dependencias.
- El token de `claude setup-token` caduca a ~1 año: hay que renovarlo y volver a guardar el secreto.
- El comentario `/crysk review` solo funciona cuando este workflow está en `main`.
- Quitarlo: borrar `.github/workflows/crysk.yml`, `REVIEW.md` y `.cryskignore`, y el secreto
  `CRYSK_CLAUDE_OAUTH_TOKEN` en Settings → Secrets and variables → Actions. Nada más depende de él.

## Alternativas consideradas
- `mode: gate` y check obligatorio: un proyecto joven no debe poder bloquear una fusión.
- `uses: cryskai/crysk@v0`: movería la credencial a cada versión nueva sin revisión.
- Clave de API de Anthropic (`CRYSK_CLAUDE_API_KEY`): factura por tokens; el responsable eligió su suscripción.
- Comentario abierto a cualquier colaborador con escritura: cada ejecución gasta la cuota del responsable.
