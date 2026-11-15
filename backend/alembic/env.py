"""Alembic environment (async engine; URL from DATABASE_URL)."""

import asyncio
from logging.config import fileConfig

from sqlalchemy.engine import Connection

from alembic import context
from app.db.session import make_engine
from app.db.tables import metadata

if context.config.config_file_name:
    fileConfig(context.config.config_file_name)


def run(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=metadata)
    with context.begin_transaction():
        context.run_migrations()


async def main() -> None:
    engine = make_engine()
    async with engine.connect() as conn:
        await conn.run_sync(run)
    await engine.dispose()


if context.is_offline_mode():
    raise SystemExit("offline mode is not supported; run against a database")
asyncio.run(main())
