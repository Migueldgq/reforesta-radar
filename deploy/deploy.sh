#!/usr/bin/env bash
# Deploys one version of Reforesta Radar on the server, as the deploy user:
#
#   sudo -u deploy /opt/reforesta-radar/deploy/deploy.sh [ref]     # default: origin/main
#
# Fetches, checks out the exact commit (detached), builds images tagged with it, applies migrations (alembic upgrade
# head, never anything else on the database), starts the stack, waits for the health checks and checks the site
# through Caddy. If the new version does not come up healthy, it switches back to the previous commit and its images
# (kept on disk) and exits 1. Migrations are not undone: they are written to be backwards compatible.
# Guide: docs/despliegue.md.
set -euo pipefail

APP_DIR=${APP_DIR:-$(cd "$(dirname "$0")/.." && pwd)}
REF=${1:-origin/main}
cd "$APP_DIR"
exec < /dev/null # nothing here reads input (and `docker compose run` would swallow a piped script)

log() { printf '\n== %s\n' "$*"; }
compose() { docker compose -f docker-compose.yml -f docker-compose.prod.yml "$@"; }
env_value() { sed -n "s/^$1=//p" .env | tail -n 1; }
set_tag() {
  if grep -q '^RADAR_IMAGE_TAG=' .env; then sed -i "s/^RADAR_IMAGE_TAG=.*/RADAR_IMAGE_TAG=$1/" .env
  else printf '# Images of the deployed commit (written by deploy/deploy.sh)\nRADAR_IMAGE_TAG=%s\n' "$1" >> .env; fi
}

[ -f .env ] || { echo "Missing $APP_DIR/.env (run deploy/setup-server.sh first)." >&2; exit 1; }
domain=$(env_value RADAR_DOMAIN)
[ -n "$domain" ] || { echo "RADAR_DOMAIN is not set in .env." >&2; exit 1; }

# Only one deploy at a time (CI and a person could start one together).
exec 9> /run/lock/reforesta-radar-deploy.lock
flock -n 9 || { echo "Another deploy is running." >&2; exit 1; }

# Requests through Caddy on this machine, so it works before the DNS or the certificate are ready (-k).
site_ok() {
  local path code
  for path in /login /.well-known/oauth-authorization-server; do
    code=$(curl -ks -o /dev/null -w '%{http_code}' --max-time 10 --resolve "$domain:443:127.0.0.1" "https://$domain$path") || code=000
    [ "$code" = 200 ] || { echo "  https://$domain$path -> $code"; return 1; }
  done
}
healthy() {
  local i
  compose up -d --wait --wait-timeout 300 --remove-orphans || return 1
  for i in $(seq 1 12); do site_ok && return 0; sleep 5; done
  return 1
}

log "Fetch $REF"
git fetch --prune --quiet origin
sha=$(git rev-parse --verify --quiet "$REF^{commit}") || { echo "Unknown ref: $REF" >&2; exit 1; }
prev_sha=$(git rev-parse HEAD)
prev_tag=$(env_value RADAR_IMAGE_TAG)
tag=${sha:0:12}
echo "deploying $sha (running: ${prev_tag:-nothing yet})"

git checkout --quiet --detach "$sha"

log "Build"
t0=$SECONDS
RADAR_IMAGE_TAG=$tag compose build --quiet
echo "built in $((SECONDS - t0)) s"

log "Migrate"
compose up -d --wait postgres
RADAR_IMAGE_TAG=$tag compose run --rm --no-deps -T api alembic upgrade head

log "Start"
set_tag "$tag"
if healthy; then
  echo "healthy: https://$domain"
else
  echo "The new version is not healthy." >&2
  compose ps -a >&2 || true
  if [ -n "$prev_tag" ] && [ "$prev_tag" != "$tag" ] && docker image inspect "reforesta-radar-web:$prev_tag" >/dev/null 2>&1; then
    log "Rolling back to $prev_sha ($prev_tag)"
    git checkout --quiet --detach "$prev_sha"
    set_tag "$prev_tag"
    if healthy; then echo "rolled back; still running $prev_tag" >&2; else echo "ROLLBACK ALSO UNHEALTHY: look at the logs" >&2; fi
  else
    echo "No previous version to roll back to." >&2
  fi
  exit 1
fi

log "Clean up old images (keeping $tag and ${prev_tag:-none})"
docker image ls --format '{{.Repository}}:{{.Tag}}' \
  | grep -E '^reforesta-radar-(backend|web):' \
  | grep -v -E ":($tag|${prev_tag:-$tag})$" \
  | xargs -r docker image rm >/dev/null || true
docker image prune -f >/dev/null
docker builder prune -f --filter until=168h >/dev/null

log "Running"
git log -1 --format='commit %H (%cd) %s' --date=iso
compose ps --format 'table {{.Service}}\t{{.Image}}\t{{.Status}}'
docker image ls --format 'table {{.Repository}}:{{.Tag}}\t{{.Size}}' | grep -E 'reforesta-radar|caddy|postgres' || true
