"""Account commands (never exposed on the web):

    python -m app.users create-admin <email> [--name NAME] [--generate]

Inside compose: `docker compose run --rm api python -m app.users create-admin ana@example.org`. Asks for the
password twice on a terminal; with --generate (or without a terminal) generates one and prints it once.
"""

import argparse
import asyncio
import getpass
import secrets
import sys

from sqlalchemy.exc import IntegrityError, ProgrammingError

from app.auth.accounts import create_user, find_user_id, normalize_email, valid_email
from app.auth.passwords import password_problem
from app.db.session import make_engine


def _ask_password() -> str:
    while True:
        pw = getpass.getpass("Password (min. 10 characters): ")
        if problem := password_problem(pw):
            print(problem, file=sys.stderr)
            continue
        if getpass.getpass("Repeat it: ") != pw:
            print("They do not match.", file=sys.stderr)
            continue
        return pw


async def create_admin(email: str, name: str, password: str) -> int:
    engine = make_engine()
    try:
        async with engine.begin() as conn:
            if await find_user_id(conn, email) is not None:
                raise SystemExit(f"There is already an account for {email}; nothing changed.")
            return await create_user(conn, email, name, "admin", password)
    finally:
        await engine.dispose()


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m app.users", description="Reforesta Radar accounts.")
    sub = p.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("create-admin", help="create an admin account")
    c.add_argument("email")
    c.add_argument("--name", default="")
    c.add_argument("--generate", action="store_true", help="generate the password and print it once")
    args = p.parse_args(argv)

    email = normalize_email(args.email)
    if not valid_email(email):
        print("That e-mail does not look valid.", file=sys.stderr)
        return 1
    generated = args.generate or not sys.stdin.isatty()
    password = secrets.token_urlsafe(15) if generated else _ask_password()
    try:
        user_id = asyncio.run(create_admin(email, args.name, password))
    except ProgrammingError:
        print("The users table does not exist yet: start the API once (it applies the migrations).", file=sys.stderr)
        return 1
    except IntegrityError:
        print(f"There is already an account for {email}; nothing changed.", file=sys.stderr)
        return 1
    print(f"Admin created (user {user_id}): {email}")
    if generated:
        print(f"Password (shown only now; change it after logging in): {password}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
