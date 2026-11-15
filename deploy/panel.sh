#!/usr/bin/env bash
# Publishes or hides the Dokploy panel at https://panel.miguelddev.com (ADR 0043, docs/despliegue.md). Installed by
# deploy/setup-server.sh as /usr/local/sbin/reforesta-panel; runs as root:
#
#   sudo reforesta-panel status    # is the route installed? how many panel users have 2FA?
#   sudo reforesta-panel public    # install the route (deploy/traefik-panel.yml), only if every panel user has 2FA on
#   sudo reforesta-panel private   # delete the route: the panel is reachable only through the SSH tunnel again
#
# Traefik watches its dynamic directory, so both take effect within seconds, with no restart and no downtime for
# the radar. The SSH tunnel to 127.0.0.1:3000 works in both states. The 2FA check only counts rows in Dokploy's own
# database (`user.two_factor_enabled`, Dokploy v0.31.2 / better-auth); it never reads any of their content.
set -euo pipefail

SRC=${PANEL_ROUTE_SRC:-/opt/reforesta-radar/deploy/traefik-panel.yml}
DEST=/etc/dokploy/traefik/dynamic/reforesta-panel.yml

[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo)." >&2; exit 1; }

# Prints "<users> <users without 2FA>".
count_2fa() {
  local db
  db=$(docker ps -q -f 'name=^dokploy-postgres\.' | head -n 1)
  [ -n "$db" ] || { echo "reforesta-panel: Dokploy's Postgres is not running" >&2; return 1; }
  docker exec "$db" psql -U dokploy -d dokploy -At -F ' ' \
    -c 'select count(*), count(*) filter (where two_factor_enabled is not true) from "user"'
}

case "${1:-}" in
  status)
    if [ -f "$DEST" ]; then echo "panel: public (route in $DEST)"; else echo "panel: private (SSH tunnel only)"; fi
    read -r users without < <(count_2fa)
    echo "panel users: $users, without 2FA: $without"
    ;;
  public)
    read -r users without < <(count_2fa)
    if [ "$users" -lt 1 ] || [ "$without" -ne 0 ]; then
      echo "reforesta-panel: $without of $users panel user(s) without 2FA: not publishing (enable it in Settings -> Profile through the tunnel)." >&2
      exit 1
    fi
    install -m 644 "$SRC" "$DEST"
    echo "panel: public at https://panel.miguelddev.com ($users user(s), all with 2FA)"
    ;;
  private)
    rm -f "$DEST"
    echo "panel: private (SSH tunnel only)"
    ;;
  *)
    echo "usage: $0 status|public|private" >&2
    exit 2
    ;;
esac
