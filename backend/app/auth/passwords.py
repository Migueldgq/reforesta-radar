"""Password hashing: Argon2id (argon2-cffi defaults, RFC 9106 low-memory profile: t=3, m=64 MiB, p=4).

Hashing and verifying are CPU-bound (~50 ms): the async wrappers run them in the thread pool. Passwords are never
logged. Length rule only (no composition rules): MIN_LENGTH..MAX_LENGTH characters.
"""

from functools import cache

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi.concurrency import run_in_threadpool

MIN_LENGTH = 10
MAX_LENGTH = 256  # bounds the hashing cost of a hostile request

_ph = PasswordHasher()


def password_problem(password: str) -> str | None:
    """A Spanish message when the password is not acceptable, else None."""
    if len(password) < MIN_LENGTH:
        return f"La contraseña debe tener al menos {MIN_LENGTH} caracteres."
    if len(password) > MAX_LENGTH:
        return f"La contraseña no puede superar {MAX_LENGTH} caracteres."
    return None


def hash_password(password: str) -> str:
    return _ph.hash(password)


@cache
def _dummy_hash() -> str:
    return _ph.hash("not a real password, only spends the same time")


def verify_password(stored_hash: str | None, password: str) -> bool:
    """Constant-time check (argon2's own comparison). With no hash (unknown or inactive account) a dummy hash is
    verified anyway, so the answer takes the same time whether the account exists or not."""
    try:
        return _ph.verify(stored_hash or _dummy_hash(), password[:MAX_LENGTH]) and stored_hash is not None
    except (VerificationError, InvalidHashError):
        return False


def needs_rehash(stored_hash: str) -> bool:
    return _ph.check_needs_rehash(stored_hash)


async def hash_password_async(password: str) -> str:
    return await run_in_threadpool(hash_password, password)


async def verify_password_async(stored_hash: str | None, password: str) -> bool:
    return await run_in_threadpool(verify_password, stored_hash, password)
