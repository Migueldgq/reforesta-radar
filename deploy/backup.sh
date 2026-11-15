#!/usr/bin/env bash
# Daily Postgres backup of Reforesta Radar (reforesta-radar-backup.timer, as root; deploy/setup-server.sh installs it
# as /usr/local/sbin/reforesta-radar-backup): pg_dump in custom format (compressed) from the `postgres` container of
# the Dokploy compose project to /var/backups/reforesta-radar/radar-<UTC timestamp>.dump, checked with
# pg_restore --list, kept 14 days.
#
# Off-site copy (optional): when BACKUP_PAR_URL is set (in /etc/reforesta-radar/backup.env, root-only, read by the
# systemd unit), each dump is also uploaded with an HTTP PUT to <BACKUP_PAR_URL><file name>: an Oracle Object Storage
# pre-authenticated request that allows object writes. The URL is a credential: it is never printed.
# Exits non-zero on any failure, the upload included (systemd then marks the run as failed). Restore procedure:
# docs/despliegue.md.
set -euo pipefail

CONF=${CONF:-/etc/reforesta-radar/deploy.env}
BACKUP_DIR=${BACKUP_DIR:-/var/backups/reforesta-radar}
KEEP_DAYS=${KEEP_DAYS:-14}
# shellcheck source=/dev/null
[ -n "${RADAR_APP:-}" ] || . "$CONF"
: "${RADAR_APP:?set RADAR_APP (the Dokploy app name) in $CONF}"

pg=$(docker ps -q --filter "label=com.docker.compose.project=$RADAR_APP" --filter label=com.docker.compose.service=postgres)
[ "$(grep -c . <<< "$pg")" = 1 ] || { echo "backup: no single running postgres container in project $RADAR_APP" >&2; exit 1; }

install -d -m 700 "$BACKUP_DIR"
name="radar-$(date -u +%Y%m%dT%H%M%SZ).dump"
file="$BACKUP_DIR/$name"
tmp="$file.partial"
trap 'rm -f "$tmp"' EXIT
umask 077

docker exec "$pg" pg_dump -U radar -d radar --format=custom --compress=6 > "$tmp"
[ -s "$tmp" ] || { echo "backup: empty dump" >&2; exit 1; }
docker exec -i "$pg" pg_restore --list < "$tmp" > /dev/null
mv "$tmp" "$file"
trap - EXIT

find "$BACKUP_DIR" -maxdepth 1 -name 'radar-*.dump' -type f -mmin +$((KEEP_DAYS * 1440)) -delete
echo "backup: $file ($(du -h "$file" | cut -f1)); $(find "$BACKUP_DIR" -maxdepth 1 -name 'radar-*.dump' | wc -l) kept"

if [ -n "${BACKUP_PAR_URL:-}" ]; then
  # The URL goes to curl through a config on stdin, not on its command line (ps) or in any message.
  if printf 'url = "%s%s"\n' "$BACKUP_PAR_URL" "$name" \
    | curl -sS --fail --retry 3 --retry-all-errors --max-time 600 -o /dev/null -T "$file" -K -; then
    echo "backup: uploaded $name off-site"
  else
    echo "backup: OFF-SITE UPLOAD FAILED for $name (the local copy is kept)" >&2
    exit 1
  fi
fi
