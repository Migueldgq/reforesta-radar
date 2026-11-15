# 0016. Cuentas propias por invitación, sin framework de autenticación

- Estado: Aceptada
- Fecha: 2026-11-15 (d999cde, 1ef0583; rama `feat/fase-2-usuarios`)

## Contexto
Para compartir el tablero (0017) hace falta saber quién es quién. El equipo es una sola organización de 6 o 7
personas. El plan anterior (versión Supabase) era autenticación con enlace mágico de Supabase, que desapareció con
0003. No hay servidor de correo.

## Decisión
Implementación propia y pequeña en `backend/app/auth/`, sin framework de autenticación, JWT ni OAuth:

- solo por invitación; correo y contraseña con Argon2id (mínimo 10 caracteres);
- sesión opaca guardada en el servidor, en la cookie `radar_session` `HttpOnly`, `SameSite=Lax`, caducidad
  deslizante de 30 días; se revoca al cerrar sesión, cambiar contraseña o rol, o desactivar la cuenta; en la base
  solo hay hashes de los tokens;
- CSRF: toda petición que cambia datos lleva `X-Radar-CSRF: 1` y se rechaza si `Sec-Fetch-Site` dice que viene de
  otro sitio;
- inicio de sesión limitado por cuenta y por IP, con errores genéricos;
- una organización, roles `admin` y `member`; el primer admin se crea por comando (`python -m app.users
  create-admin`), nunca desde la web;
- **sin envío de correo**: un admin copia los enlaces de un solo uso (invitación 7 días, restablecer 24 h) y los
  envía él. SMTP es opcional por configuración (`SMTP_HOST`, `SMTP_FROM`).

Contrato completo en `docs/api-auth.md`.

## Consecuencias
- Pocas piezas, sin servicios externos, revocación inmediata.
- El código de seguridad es nuestro: hay que mantenerlo y revisarlo.
- El límite por IP no es fiable sin un proxy que fije `X-Forwarded-For` (ver 0004).
- El limitador vive en memoria del proceso: vale para una sola instancia de la API.
- Si se pierden todos los admins, solo queda el comando.

## Alternativas consideradas
- Enlace mágico de Supabase: desaparece con 0003.
- Framework de autenticación, JWT u OAuth: motivo no registrado.
