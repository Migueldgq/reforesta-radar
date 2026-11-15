"""Opaque random tokens (sessions, invitations, password resets). Only their sha256 is stored: a database leak does
not yield usable tokens. 32 random bytes, so a fast hash (no salt, no stretching) is enough."""

import hashlib
import secrets

TOKEN_BYTES = 32


def new_token() -> tuple[str, str]:
    """(token for the client, hash for the database)."""
    token = secrets.token_urlsafe(TOKEN_BYTES)
    return token, hash_token(token)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()
