#!/usr/bin/env bash
# Forced command of the CI deploy key: the only thing that key can run on the server. Installed in
# ~deploy/.ssh/authorized_keys as
#
#   command="/opt/reforesta-radar/deploy/ci-deploy.sh",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty ssh-ed25519 AAAA… reforesta-radar-ci
#
# The client asks for `deploy <40-hex commit>`; anything else is refused. The commit must exist on origin/main after
# a fetch (never a pull request or a fork). Then it runs deploy/deploy.sh for that commit. Guide: docs/despliegue.md.
set -euo pipefail

APP_DIR=/opt/reforesta-radar
request=${SSH_ORIGINAL_COMMAND:-}

refuse() {
  logger -t reforesta-radar-ci "refused: $1"
  echo "refused: $1" >&2
  exit 2
}

[[ $request =~ ^deploy\ ([0-9a-f]{40})$ ]] || refuse "expected 'deploy <40-hex commit>'"
sha=${BASH_REMATCH[1]}

cd "$APP_DIR"
git fetch --quiet --prune origin
git cat-file -e "$sha^{commit}" 2>/dev/null || refuse "unknown commit $sha"
git merge-base --is-ancestor "$sha" origin/main || refuse "$sha is not on origin/main"

logger -t reforesta-radar-ci "deploying $sha"
exec "$APP_DIR/deploy/deploy.sh" "$sha"
