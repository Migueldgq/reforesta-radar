"""stdio mode, for local use: `python -m app.mcp` (inside compose: `docker compose run --rm -T api python -m app.mcp`).

Reads the database straight from DATABASE_URL, so whoever runs it already has the data: no token. Public tools
always; the team view (board, notes, votes, team profile) only when RADAR_MCP_USER names an active account.
Logs go to stderr (stdout is the protocol).
"""

import logging
import sys

from app.mcp.server import mcp

if __name__ == "__main__":
    logging.basicConfig(level=logging.WARNING, stream=sys.stderr, force=True)
    mcp.run("stdio")
