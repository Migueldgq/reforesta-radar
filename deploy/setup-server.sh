#!/usr/bin/env bash
# Prepares an Ubuntu 24.04 server (Oracle Cloud Always Free, ARM) for Reforesta Radar. Safe to re-run: every step
# checks before it changes anything. Runs as root:
#
#   sudo RADAR_DOMAIN=130-61-182-106.sslip.io /opt/reforesta-radar/deploy/setup-server.sh
#
# Installs Docker Engine + the compose plugin from Docker's apt repository, keeps unattended security upgrades on,
# opens 80/443 in the host firewall (Oracle's image ships its own iptables rules), adds a swap file, clones the repo
# to /opt/reforesta-radar, generates /opt/reforesta-radar/.env (secrets, mode 600) and installs the daily backup
# timer. Leaves the time zone alone (UTC). Guide: docs/despliegue.md.
set -euo pipefail

APP_DIR=${APP_DIR:-/opt/reforesta-radar}
REPO_URL=${REPO_URL:-https://github.com/Migueldgq/reforesta-radar.git}
# Owns the checkout and runs the stack; no password, no sudo. The admin (who ran sudo) also gets the docker group.
DEPLOY_USER=${DEPLOY_USER:-deploy}
ADMIN_USER=${ADMIN_USER:-${SUDO_USER:-}}
SWAP_SIZE=${SWAP_SIZE:-2G}
BACKUP_DIR=${BACKUP_DIR:-/var/backups/reforesta-radar}

log() { printf '\n== %s\n' "$*"; }
[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo)." >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive

log "Base packages"
apt-get update -q
apt-get install -y -q ca-certificates curl git openssl unattended-upgrades iptables-persistent

log "Docker Engine (official apt repository)"
if [ ! -f /etc/apt/sources.list.d/docker.sources ]; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  # shellcheck disable=SC1091
  codename=$(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
  cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${codename}
Components: stable
Signed-By: /etc/apt/keyrings/docker.asc
EOF
  apt-get update -q
fi
apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
# Default log rotation for every container (the compose files also set it per service).
if [ ! -f /etc/docker/daemon.json ]; then
  printf '{\n  "log-driver": "json-file",\n  "log-opts": { "max-size": "10m", "max-file": "3" }\n}\n' > /etc/docker/daemon.json
  systemctl restart docker
fi
systemctl enable --now docker containerd
log "Deploy user $DEPLOY_USER"
# Members of the docker group are root-equivalent on this machine (they can mount / in a container): the deploy
# user has no sudo, but whoever controls it controls the server. That is why its SSH key is limited to one command
# (deploy/ci-deploy.sh, see docs/despliegue.md).
id "$DEPLOY_USER" >/dev/null 2>&1 || adduser --system --group --shell /bin/bash --home "/home/$DEPLOY_USER" "$DEPLOY_USER"
usermod -aG docker "$DEPLOY_USER"
[ -z "$ADMIN_USER" ] || usermod -aG docker "$ADMIN_USER"

log "Unattended security upgrades"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
systemctl enable --now unattended-upgrades

log "Host firewall: allow 80 and 443"
# Oracle's Ubuntu image ends INPUT with a REJECT rule (and keeps it in /etc/iptables/rules.v4). Insert the accept
# rules before it, live and in the saved file. Never `netfilter-persistent save` here: it would also save Docker's
# own chains, which Docker recreates at start. Docker's published ports go through FORWARD, where Docker puts its
# chains ahead of Oracle's REJECT, so these INPUT rules are for the host itself (and are harmless for Docker).
for port in 80 443; do
  rule=(-p tcp -m state --state NEW -m tcp --dport "$port" -j ACCEPT)
  if ! iptables -C INPUT "${rule[@]}" 2>/dev/null; then
    pos=$(iptables -L INPUT --line-numbers -n | awk '$2 == "REJECT" { print $1; exit }')
    if [ -n "$pos" ]; then iptables -I INPUT "$pos" "${rule[@]}"; else iptables -A INPUT "${rule[@]}"; fi
  fi
  line="-A INPUT -p tcp -m state --state NEW -m tcp --dport $port -j ACCEPT"
  if [ -f /etc/iptables/rules.v4 ] && ! grep -qxF -- "$line" /etc/iptables/rules.v4; then
    if grep -q '^-A INPUT -j REJECT' /etc/iptables/rules.v4; then
      sed -i "0,/^-A INPUT -j REJECT/s//${line//\//\\/}\n&/" /etc/iptables/rules.v4
    else
      echo "rules.v4 has no INPUT REJECT line; add '$line' by hand." >&2
    fi
  fi
done
iptables -L INPUT -n --line-numbers

log "Swap file ($SWAP_SIZE)"
if ! swapon --show=NAME --noheadings | grep -qx /swapfile; then
  [ -f /swapfile ] || { fallocate -l "$SWAP_SIZE" /swapfile; chmod 600 /swapfile; mkswap /swapfile; }
  swapon /swapfile
fi
grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
echo 'vm.swappiness=10' > /etc/sysctl.d/90-reforesta-swap.conf
sysctl -q -p /etc/sysctl.d/90-reforesta-swap.conf

log "Repository at $APP_DIR"
if [ ! -d "$APP_DIR/.git" ]; then
  git clone "$REPO_URL" "$APP_DIR"
fi
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR"

log "Secrets in $APP_DIR/.env"
if [ ! -f "$APP_DIR/.env" ]; then
  [ -n "${RADAR_DOMAIN:-}" ] || { echo "First run: pass RADAR_DOMAIN=<hostname> (e.g. 130-61-182-106.sslip.io)." >&2; exit 1; }
  (
    umask 077
    cat > "$APP_DIR/.env" <<EOF
# Production settings for Reforesta Radar (generated by deploy/setup-server.sh). Never commit or share this file.
# Plain \`docker compose …\` in this folder uses both compose files.
COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml
# Public hostname (DNS must point at this server). Change it here, then run deploy/deploy.sh (docs/despliegue.md).
RADAR_DOMAIN=${RADAR_DOMAIN}
# Only applied when the Postgres volume is created (to change it later see docs/mantenimiento.md).
RADAR_DB_PASSWORD=$(openssl rand -hex 32)
# SMTP stays unset: admins copy invitation and reset links by hand.
EOF
  )
  echo "Created $APP_DIR/.env (values not shown)."
else
  echo "$APP_DIR/.env already exists; left as is."
fi
chown "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR/.env"
chmod 600 "$APP_DIR/.env"

log "Daily backup timer"
install -d -m 700 "$BACKUP_DIR"
install -m 644 "$APP_DIR/deploy/systemd/reforesta-radar-backup.service" /etc/systemd/system/
install -m 644 "$APP_DIR/deploy/systemd/reforesta-radar-backup.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now reforesta-radar-backup.timer

log "Done"
docker --version
docker compose version
echo "Next: sudo -u $DEPLOY_USER $APP_DIR/deploy/deploy.sh"
