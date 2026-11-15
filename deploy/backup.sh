#!/usr/bin/env bash
# Daily Postgres backup of Reforesta Radar (run by the reforesta-radar-backup.timer systemd unit, as root):
# pg_dump in custom format (compressed) to /var/backups/reforesta-radar/radar-<UTC timestamp>.dump, checked with
# pg_restore --list, kept 14 days. Exits non-zero on any failure (systemd then marks the run as failed).
# Restore procedure: docs/despliegue.md.
set -euo pipefail

APP_DIR=${APP_DIR:-$(cd "$(dirname "$0")/.." && pwd)}
BACKUP_DIR=${BACKUP_DIR:-/var/backups/reforesta-radar}
KEEP_DAYS=${KEEP_DAYS:-14}

cd "$APP_DIR"
compose() { docker compose -f docker-compose.yml -f docker-compose.prod.yml "$@"; }

install -d -m 700 "$BACKUP_DIR"
file="$BACKUP_DIR/radar-$(date -u +%Y%m%dT%H%M%SZ).dump"
tmp="$file.partial"
trap 'rm -f "$tmp"' EXIT
umask 077

compose exec -T postgres pg_dump -U radar -d radar --format=custom --compress=6 > "$tmp"
[ -s "$tmp" ] || { echo "backup: empty dump" >&2; exit 1; }
compose exec -T postgres pg_restore --list < "$tmp" > /dev/null
mv "$tmp" "$file"
trap - EXIT

find "$BACKUP_DIR" -maxdepth 1 -name 'radar-*.dump' -type f -mmin +$((KEEP_DAYS * 1440)) -delete
echo "backup: $file ($(du -h "$file" | cut -f1)); $(find "$BACKUP_DIR" -maxdepth 1 -name 'radar-*.dump' | wc -l) kept"
