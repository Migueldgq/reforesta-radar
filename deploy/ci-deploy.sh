#!/usr/bin/env bash
# Forced command of the CI deploy key: the only thing that key can run on the server. deploy/setup-server.sh installs
# it as /usr/local/sbin/reforesta-radar-ci-deploy (root-owned) and points ~deploy/.ssh/authorized_keys at it:
#
#   command="/usr/local/sbin/reforesta-radar-ci-deploy",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty ssh-ed25519 AAAA… reforesta-radar-ci
#
# The client asks for `deploy <40-hex commit>`; anything else is refused. The `deploy` user has no shell access, no
# docker group and one sudo rule: running reforesta-radar-deploy (deploy/deploy.sh), which checks again that the
# commit is on main and deploys it through Dokploy. Guide: docs/despliegue.md.
set -euo pipefail

request=${SSH_ORIGINAL_COMMAND:-}

refuse() {
  logger -t reforesta-radar-ci "refused: $1"
  echo "refused: $1" >&2
  exit 2
}

[[ $request =~ ^deploy\ ([0-9a-f]{40})$ ]] || refuse "expected 'deploy <40-hex commit>'"
sha=${BASH_REMATCH[1]}

logger -t reforesta-radar-ci "deploy requested: $sha"
exec sudo -n /usr/local/sbin/reforesta-radar-deploy "$sha"
