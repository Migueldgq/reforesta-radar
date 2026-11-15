#!/usr/bin/env bash
# Deploys one commit of Reforesta Radar through Dokploy. Runs as root; deploy/setup-server.sh installs it as
# /usr/local/sbin/reforesta-radar-deploy, and the CI key reaches it only through deploy/ci-deploy.sh + a sudoers rule.
#
#   sudo reforesta-radar-deploy <40-hex commit>
#
# Dokploy's own "Deploy" clones the head of a branch, so it cannot deploy an exact commit. This script:
#  1. checks that the commit is on RADAR_DEPLOY_BRANCH (main) of the GitHub repository, in a root-owned mirror;
#  2. checks it out in Dokploy's checkout of the compose app (/etc/dokploy/compose/<app>/code);
#  3. asks Dokploy, over its API on localhost (key in a root-only file), to "redeploy" the app: rebuild and restart
#     from that checkout, without cloning. The API applies `alembic upgrade head` when it starts;
#  4. waits for the Dokploy deployment, every container's health check, and /login + the OAuth issuer through Traefik.
# If 3 or 4 fails it checks the previous commit out again, redeploys it the same way and exits 1. Migrations are not
# undone (they are written to be backwards compatible). Guide: docs/despliegue.md.
set -euo pipefail

CONF=${CONF:-/etc/reforesta-radar/deploy.env}
KEY_FILE=/etc/reforesta-radar/dokploy-api-key
MIRROR=/var/lib/reforesta-radar/repo.git
REPO_URL=https://github.com/Migueldgq/reforesta-radar.git
API=http://127.0.0.1:3000/api

sha=${1:-}
[[ $sha =~ ^[0-9a-f]{40}$ ]] || { echo "usage: $0 <40-hex commit>" >&2; exit 2; }
[ "$(id -u)" -eq 0 ] || { echo "Run as root." >&2; exit 1; }
exec < /dev/null
# RADAR_APP (Dokploy app name = compose project), RADAR_COMPOSE_ID, RADAR_DOMAIN, RADAR_DEPLOY_BRANCH
# shellcheck source=/dev/null
. "$CONF"
: "${RADAR_APP:?}" "${RADAR_COMPOSE_ID:?}" "${RADAR_DOMAIN:?}" "${RADAR_DEPLOY_BRANCH:=main}"
code=/etc/dokploy/compose/$RADAR_APP/code

# /run, not /run/lock: that one is sticky and world-writable, and root cannot reopen another user's file there.
exec 9> /run/reforesta-radar-deploy.lock
flock -n 9 || { echo "Another deploy is running." >&2; exit 1; }

log() { printf '\n== %s\n' "$*"; }
refuse() { logger -t reforesta-radar-deploy "refused: $1"; echo "refused: $1" >&2; exit 2; }
# The key goes to curl through a file descriptor, never on a command line (visible in ps).
api_get() { curl -fsS --max-time 30 -H @<(printf 'x-api-key: %s\n' "$(cat "$KEY_FILE")") "$API/$1?$2"; }
api_post() {
  curl -fsS --max-time 30 -H @<(printf 'x-api-key: %s\n' "$(cat "$KEY_FILE")") \
    -H 'content-type: application/json' -d "$2" "$API/$1"
}

log "Check $sha"
[ -d "$MIRROR" ] || { install -d -m 700 "$(dirname "$MIRROR")"; git clone --quiet --bare "$REPO_URL" "$MIRROR"; }
git -C "$MIRROR" config uploadpack.allowAnySHA1InWant true # the Dokploy checkout fetches single commits from it
git -C "$MIRROR" fetch --quiet --prune "$REPO_URL" '+refs/heads/*:refs/heads/*'
git -C "$MIRROR" cat-file -e "$sha^{commit}" 2>/dev/null || refuse "unknown commit $sha"
git -C "$MIRROR" merge-base --is-ancestor "$sha" "refs/heads/$RADAR_DEPLOY_BRANCH" \
  || refuse "$sha is not on $RADAR_DEPLOY_BRANCH"
# Commits from before the Dokploy layout would start Caddy on ports Traefik holds.
git -C "$MIRROR" show "$sha:docker-compose.prod.yml" | grep -q reforesta-radar-edge \
  || refuse "$sha predates the Dokploy layout (ADR 0039)"
[ -d "$code/.git" ] || { echo "No Dokploy checkout at $code: deploy the app once from the panel." >&2; exit 1; }

checkout() {
  git -C "$code" fetch --quiet --depth 1 "$MIRROR" "$1"
  # --force: Dokploy rewrites docker-compose.yml (its labels) on every deploy.
  git -C "$code" checkout --quiet --force --detach "$1"
}

# Asks Dokploy to rebuild and restart from the checkout and waits for that deployment to finish.
redeploy() {
  local before row status i
  before=$(api_get deployment.allByCompose "composeId=$RADAR_COMPOSE_ID" | jq -c '[.[].deploymentId]')
  api_post compose.redeploy "$(jq -nc --arg id "$RADAR_COMPOSE_ID" --arg t "Commit ${1:0:12}" '{composeId: $id, title: $t}')" > /dev/null
  for i in $(seq 1 180); do
    sleep 5
    row=$(api_get deployment.allByCompose "composeId=$RADAR_COMPOSE_ID" \
      | jq -c --argjson before "$before" '[.[] | select(.deploymentId as $d | $before | index($d) | not)] | sort_by(.createdAt) | last // empty')
    status=$(jq -r '.status // empty' <<< "$row")
    case $status in
      done) echo "Dokploy deployment done after $((i * 5)) s"; return 0 ;;
      error | cancelled)
        echo "Dokploy deployment $status. End of its log:" >&2
        tail -n 30 "$(jq -r .logPath <<< "$row")" >&2 || true
        return 1 ;;
    esac
  done
  echo "Dokploy deployment still not finished after 15 min." >&2
  return 1
}

# Every container of the project up and healthy (all four long-running services have a health check), then the site.
healthy() {
  local i lines res path c issuer
  for i in $(seq 1 60); do
    lines=$(docker ps -a --filter "label=com.docker.compose.project=$RADAR_APP" --filter label=com.docker.compose.oneoff=False \
      --format '{{.Names}} {{.Status}}')
    if [ "$(grep -c . <<< "$lines")" -ge 4 ] && ! grep -v '(healthy)' <<< "$lines" > /dev/null; then break; fi
    if grep -q '(unhealthy)' <<< "$lines"; then echo "Unhealthy:" >&2; grep '(unhealthy)' <<< "$lines" >&2; return 1; fi
    [ "$i" -lt 60 ] || { echo "Containers not healthy after 5 min:" >&2; echo "$lines" >&2; return 1; }
    sleep 5
  done
  for i in $(seq 1 12); do
    res=ok
    for path in /login /.well-known/oauth-authorization-server; do
      c=$(curl -ks -o /dev/null -w '%{http_code}' --max-time 10 --resolve "$RADAR_DOMAIN:443:127.0.0.1" "https://$RADAR_DOMAIN$path") || c=000
      [ "$c" = 200 ] || { res="https://$RADAR_DOMAIN$path -> $c"; break; }
    done
    if [ "$res" = ok ]; then
      issuer=$(curl -ks --max-time 10 --resolve "$RADAR_DOMAIN:443:127.0.0.1" "https://$RADAR_DOMAIN/.well-known/oauth-authorization-server" | jq -r .issuer)
      [ "$issuer" = "https://$RADAR_DOMAIN" ] && return 0
      res="OAuth issuer is '$issuer'"
    fi
    sleep 5
  done
  echo "  $res" >&2
  return 1
}

prev=$(git -C "$code" rev-parse HEAD)
log "Deploy $sha (running: $prev)"
logger -t reforesta-radar-deploy "deploying $sha (running $prev)"
checkout "$sha"
if redeploy "$sha" && healthy; then
  logger -t reforesta-radar-deploy "deployed $sha"
else
  echo "The new version is not healthy." >&2
  if [ "$prev" != "$sha" ]; then
    log "Rolling back to $prev"
    logger -t reforesta-radar-deploy "rolling back to $prev"
    checkout "$prev"
    if redeploy "$prev" && healthy; then echo "Rolled back; running $prev again." >&2
    else echo "ROLLBACK ALSO UNHEALTHY: look at the Dokploy deployment log and docker ps." >&2; fi
  fi
  exit 1
fi

log "Clean up"
docker image prune -f > /dev/null
docker builder prune -f --filter until=168h > /dev/null

log "Running"
git -C "$code" log -1 --format='commit %H (%cd) %s' --date=iso
docker ps --filter "label=com.docker.compose.project=$RADAR_APP" --format 'table {{.Names}}\t{{.Status}}'
