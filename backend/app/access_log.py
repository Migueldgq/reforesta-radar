"""uvicorn's access log without query strings. The proxy in front logs nothing (docs/despliegue.md), so this is the
only per-request log: it keeps method, path, status and client IP, and drops everything after `?` (the OAuth
`state` and PKCE challenge of /oauth/authorize, search terms)."""

import logging


class DropQueryString(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        # uvicorn logs '%s - "%s %s HTTP/%s" %d' with (client, method, path with query, http version, status).
        args = record.args
        if isinstance(args, tuple) and len(args) >= 3 and isinstance(args[2], str) and "?" in args[2]:
            record.args = (*args[:2], args[2].split("?", 1)[0], *args[3:])
        return True


def install() -> None:
    logging.getLogger("uvicorn.access").addFilter(DropQueryString())
