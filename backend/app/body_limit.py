"""Request body cap for /api/, /mcp and /oauth/, applied before routing (so before the session check and before any
parsing): 16 MiB for /api/analyze-pdf (15 MB PDF + multipart overhead), 16 KiB for the OAuth endpoints (form posts
and registrations are small), 1 MiB elsewhere. A larger `Content-Length` is
answered 413 at once; a chunked body is counted while it streams and cut off at the cap."""

import json

from starlette.types import ASGIApp, Message, Receive, Scope, Send

DEFAULT_LIMIT = 1024 * 1024
LIMITS = {"/api/analyze-pdf": 16 * 1024 * 1024}
TOO_LARGE = json.dumps({"detail": "La petición es demasiado grande."}, ensure_ascii=False).encode()


OAUTH_LIMIT = 16 * 1024
PREFIXES = ("/api/", "/mcp", "/oauth/")


def limit_for(path: str) -> int:
    if path.startswith("/oauth/"):
        return OAUTH_LIMIT
    return LIMITS.get(path.rstrip("/"), DEFAULT_LIMIT)


class BodyLimitMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not scope["path"].startswith(PREFIXES):
            await self.app(scope, receive, send)
            return
        limit = limit_for(scope["path"])
        length = dict(scope["headers"]).get(b"content-length")
        if length is not None and (not length.isdigit() or int(length) > limit):
            await _reject(send)
            return

        received = 0
        rejected = False
        started = False

        async def limited_receive() -> Message:
            nonlocal received, rejected
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    rejected = True
                    if not started:
                        await _reject(send)
                    return {"type": "http.disconnect"}
            return message

        async def guarded_send(message: Message) -> None:
            nonlocal started
            if rejected:
                return  # our 413 already went out; drop whatever the app answers to the disconnect
            started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, guarded_send)
        except Exception:
            if not rejected:  # the app failed on the cut-off body (client disconnect): already answered 413
                raise


async def _reject(send: Send) -> None:
    headers = [(b"content-type", b"application/json"), (b"content-length", str(len(TOO_LARGE)).encode())]
    await send({"type": "http.response.start", "status": 413, "headers": headers})
    await send({"type": "http.response.body", "body": TOO_LARGE})
