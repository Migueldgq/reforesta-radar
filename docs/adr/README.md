# Registro de decisiones de arquitectura (ADR)

Un ADR deja por escrito una decisión que ya se ha tomado: qué se decidió, por qué, qué se gana y qué se pierde. Sirve
para que quien llegue después (una persona o un agente) no deshaga una decisión sin saber por qué se tomó, ni la
vuelva a discutir desde cero.

Formato breve (estilo Michael Nygard): media página, sin relleno. Las fechas son las del commit o PR que introdujo
la decisión. Si un motivo no consta en el repositorio ni lo dio el responsable del proyecto, se escribe «motivo no
registrado» en vez de inventarlo.

## Cuándo escribir uno

Toda decisión que cambie alguna de estas cosas lleva un ADR **en el mismo PR** que la aplica:

- la arquitectura (servicios, capas, dónde vive cada responsabilidad);
- las fuentes de datos (añadir, quitar o cambiar cómo se lee una);
- el comportamiento de la puntuación (reglas, topes, niveles, señales nuevas);
- el modelo de seguridad (cuentas, sesiones, permisos, datos personales, descargas externas);
- las dependencias importantes (frameworks, bases de datos, servicios externos);
- el alojamiento o el despliegue.

Un ADR aceptado no se reescribe. Si la decisión cambia, se escribe uno nuevo que la sustituye, y en el antiguo solo se
cambia el estado a «Sustituida por NNNN». Las correcciones de erratas o de datos sí se pueden hacer en el sitio.

Estados: **Propuesta** (en estudio, aún no aplicada), **Aceptada**, **Sustituida por NNNN**.

## Plantilla

Copiar en `docs/adr/NNNN-titulo-en-kebab-case.md` (siguiente número libre) y añadir la fila al índice.

```markdown
# NNNN. Título corto en forma de decisión

- Estado: Propuesta | Aceptada | Sustituida por NNNN
- Fecha: AAAA-MM-DD (commit o PR: abc1234 / #NN)

## Contexto
Qué problema o situación obliga a decidir. Hechos, no opiniones.

## Decisión
Qué se hace, en presente («La ingesta se ejecuta…»). Identificadores de código tal cual.

## Consecuencias
Lo bueno y lo malo, con honestidad. Qué queda más difícil o pendiente.

## Alternativas consideradas
Una línea por alternativa y por qué no se eligió (o «motivo no registrado»).
```

## Índice

| Nº | Título | Estado | Fecha |
|---|---|---|---|
| [0001](0001-encontrar-y-priorizar-no-redactar.md) | Encontrar y priorizar convocatorias, no redactar propuestas | Aceptada | 2026-11-14 |
| [0002](0002-solo-las-siete-fuentes-del-reto.md) | Solo las siete fuentes que propone el reto | Aceptada | 2026-11-15 |
| [0003](0003-backend-python-fastapi-postgres-docker.md) | Backend en Python (FastAPI) y Postgres, todo en Docker | Aceptada | 2026-11-15 |
| [0004](0004-nextjs-solo-frontend.md) | Next.js solo como frontend que reenvía `/api/*` | Aceptada | 2026-11-15 |
| [0005](0005-puntuacion-por-reglas-explicable.md) | Puntuación por reglas, explicada punto por punto | Aceptada | 2026-11-14 |
| [0006](0006-sin-llm-en-el-encaje.md) | Sin LLM en el encaje, por ahora | Aceptada | 2026-11-14 |
| [0007](0007-ajustes-de-territorio-y-tipo-al-leer.md) | Ajustes de territorio y tipo al leer, con topes | Aceptada | 2026-11-14 |
| [0008](0008-conservar-cerradas-como-proxima-edicion.md) | Conservar las convocatorias cerradas como próxima edición | Aceptada | 2026-11-14 |
| [0009](0009-bdns-ficha-completa-de-cada-candidata.md) | BDNS: leer la ficha completa de cada candidata | Aceptada | 2026-11-15 |
| [0010](0010-bdns-descartar-sin-tema.md) | BDNS: descartar las convocatorias sin tema ambiental | Aceptada | 2026-11-15 |
| [0011](0011-ingesta-diaria-sin-boton-de-recarga.md) | Ingesta diaria a las 9:00, sin botón de recarga | Aceptada | 2026-11-15 |
| [0012](0012-puntuar-por-ganadores-de-ediciones-anteriores.md) | Puntuar por quién ganó ediciones anteriores (BDNS) | Aceptada | 2026-11-15 |
| [0013](0013-programas-de-empresas-lista-comprobada.md) | Programas de empresas: lista comprobada a mano | Aceptada | 2026-11-15 |
| [0014](0014-inicio-abre-en-proximas-ediciones.md) | Inicio abre en «Próximas ediciones» si nada abierto encaja bien | Aceptada | 2026-11-15 |
| [0015](0015-filtro-de-organismos.md) | Filtro de organismos en lugar de «fuera de tus 4 fuentes» | Aceptada | 2026-11-15 |
| [0016](0016-cuentas-propias-por-invitacion.md) | Cuentas propias por invitación, sin framework de autenticación | Aceptada | 2026-11-15 |
| [0017](0017-estado-del-equipo-en-la-base-de-datos.md) | Estado del equipo en la base de datos | Aceptada | 2026-11-15 |
| [0018](0018-votos-sirve-no-sirve.md) | Votos «sirve / no sirve» para ajustar la puntuación | Aceptada | 2026-11-15 |
| [0019](0019-analizador-pdf-por-reglas-con-proteccion-ssrf.md) | Analizador de PDF por reglas, con protección SSRF | Aceptada | 2026-11-15 |
| [0020](0020-paridad-congelada-con-la-version-typescript.md) | Paridad congelada con la versión TypeScript | Aceptada | 2026-11-15 |
| [0021](0021-cache-de-descargas-con-caducidad.md) | Caché de descargas con caducidad en `fetch_cache` | Aceptada | 2026-11-14 |
| [0022](0022-video-de-demo-generado-en-local.md) | Vídeo de demo generado en local desde la app real | Aceptada | 2026-11-14 |
| [0023](0023-flujo-de-git.md) | Flujo de git: Conventional Commits y PR por tanda | Aceptada | 2026-11-15 |
| [0024](0024-alojamiento.md) | Alojamiento: VPS pequeño con Dokploy u Oracle Always Free | Propuesta | 2026-11-15 |
| [0025](0025-servidor-mcp-de-solo-lectura.md) | Servidor MCP de solo lectura para el asistente del equipo | Sustituida por 0026 | 2026-11-15 |
| [0026](0026-servidor-mcp-de-solo-lectura-con-dos-niveles.md) | Servidor MCP de solo lectura en `/mcp`, con acceso público y de equipo | Sustituida por 0035 | 2026-11-15 |
| [0027](0027-tokens-personales-para-el-mcp.md) | Tokens personales de acceso para el servidor MCP | Aceptada | 2026-11-15 |
| [0028](0028-plazo-estimado-de-las-convocatorias-sin-fecha.md) | Plazo estimado de las convocatorias BDNS sin fecha de cierre | Sustituida por 0029 | 2026-11-15 |
| [0029](0029-plazo-estimado-guardado-y-marcado.md) | Plazo estimado: se guarda como fecha de cierre, marcado como estimado | Aceptada | 2026-11-15 |
| [0030](0030-nombres-de-organismos-normalizados.md) | Nombres de organismos normalizados al ingestar | Aceptada | 2026-11-15 |
| [0031](0031-programas-de-empresas-territorio-y-caducidad.md) | Programas de empresas: su territorio, su etiqueta y aviso de lista caducada | Aceptada | 2026-11-15 |
| [0032](0032-reglas-de-sector-leader-y-licitaciones-de-instalaciones.md) | Asociaciones del sector, grupos LEADER y licitaciones de instalaciones | Aceptada | 2026-11-15 |
| [0033](0033-analizar-pdf-con-la-nota-del-radar.md) | Analizar PDF: la nota del radar cuando el PDF es de una convocatoria suya | Aceptada | 2026-11-15 |
| [0034](0034-desactivar-fuentes-por-configuracion.md) | Desactivar fuentes por configuración | Aceptada | 2026-11-15 |
| [0035](0035-iniciar-sesion-desde-el-asistente-oauth.md) | Iniciar sesión desde el asistente (OAuth 2.1) en una segunda dirección, `/mcp/equipo` | Aceptada | 2026-11-15 |
