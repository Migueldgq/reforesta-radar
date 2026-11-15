#!/usr/bin/env bash
# Prepares an Ubuntu 24.04 server (Oracle Cloud Always Free, ARM) for Reforesta Radar on Dokploy (ADR 0039). Safe to
# re-run: every step checks before it changes anything. Runs as root, from a clone of the repository:
#
#   sudo git clone https://github.com/Migueldgq/reforesta-radar.git /opt/reforesta-radar
#   sudo /opt/reforesta-radar/deploy/setup-server.sh
#
# Machine: Docker Engine from Docker's apt repository with log rotation, unattended security upgrades, a swap file,
# 80/443 in the host firewall (Oracle's image ships its own iptables rules) and only 80/443 towards containers
# (docker-user-firewall). Dokploy, pinned (installer checked against its SHA-256), with Docker Swarm on an address pool
# that does not overlap Oracle's 10.0.0.0/16, and Traefik's static config from deploy/traefik.yml. Radar: the
# `reforesta-radar-edge` network shared by `web` and Traefik, the deploy scripts in /usr/local/sbin, the CI user
# `deploy` and its sudo rule, the backup timer.
# What it cannot do (needs the panel; docs/despliegue.md, "Preparar un servidor nuevo"): create the panel's admin, its
# API key and the compose app, which then go into /etc/reforesta-radar/.
set -euo pipefail

APP_DIR=$(cd "$(dirname "$0")/.." && pwd)
DOKPLOY_VERSION=v0.31.2
DOKPLOY_INSTALLER_SHA256=792721a30ba788f21fea42ffd7ae54fd158cd366a50121592138068112188f32
SWARM_POOL=${SWARM_POOL:-10.200.0.0/16}
DEPLOY_USER=deploy
SWAP_SIZE=${SWAP_SIZE:-2G}
CONF_DIR=/etc/reforesta-radar

log() { printf '\n== %s\n' "$*"; }
[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo)." >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive

log "Base packages"
apt-get update -q
apt-get install -y -q ca-certificates curl git jq openssl unattended-upgrades iptables-persistent

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
# Default log rotation for every container, Dokploy's included (the radar's compose files also set it per service).
if [ ! -f /etc/docker/daemon.json ]; then
  printf '{\n  "log-driver": "json-file",\n  "log-opts": { "max-size": "10m", "max-file": "3" }\n}\n' > /etc/docker/daemon.json
  systemctl restart docker
fi
systemctl enable --now docker containerd

log "Unattended security upgrades"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
systemctl enable --now unattended-upgrades

log "Host firewall: allow 80 and 443"
# Oracle's Ubuntu image ends INPUT with a REJECT rule (and keeps it in /etc/iptables/rules.v4). Insert the accept
# rules before it, live and in the saved file. Never `netfilter-persistent save` here: it would also save Docker's
# own chains, which Docker recreates at start.
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

log "Firewall for container ports: only 80/443 from outside (the panel's 3000 stays closed)"
# Docker's published ports bypass INPUT; DOCKER-USER is where they can be filtered (deploy/docker-user-firewall.sh).
install -m 755 "$APP_DIR/deploy/docker-user-firewall.sh" /usr/local/sbin/docker-user-firewall
install -m 644 "$APP_DIR/deploy/systemd/docker-user-firewall.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable docker-user-firewall.service
systemctl restart docker-user-firewall.service

log "Swap file ($SWAP_SIZE)"
if ! swapon --show=NAME --noheadings | grep -qx /swapfile; then
  [ -f /swapfile ] || { fallocate -l "$SWAP_SIZE" /swapfile; chmod 600 /swapfile; mkswap /swapfile; }
  swapon /swapfile
fi
grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
echo 'vm.swappiness=10' > /etc/sysctl.d/90-reforesta-swap.conf
sysctl -q -p /etc/sysctl.d/90-reforesta-swap.conf

log "Dokploy $DOKPLOY_VERSION"
if ! docker service inspect dokploy > /dev/null 2>&1; then
  installer=$(mktemp)
  curl -fsSL -o "$installer" "https://github.com/Dokploy/dokploy/releases/download/$DOKPLOY_VERSION/install.sh"
  echo "$DOKPLOY_INSTALLER_SHA256  $installer" | sha256sum -c --quiet - \
    || { echo "Dokploy installer checksum mismatch: not running it." >&2; exit 1; }
  # Needs 80, 443 and 3000 free. Swarm's default pool (10.0.0.0/8) would overlap Oracle's VCN (10.0.0.0/16).
  DOCKER_SWARM_INIT_ARGS="--default-addr-pool $SWARM_POOL --default-addr-pool-mask-length 24" bash "$installer"
  rm -f "$installer"
  echo "Waiting for Dokploy to write its Traefik config"
  for _ in $(seq 1 60); do [ -f /etc/dokploy/traefik/dynamic/middlewares.yml ] && break; sleep 5; done
else
  echo "Dokploy already installed: $(docker service inspect dokploy --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}')"
fi
# Compose apps' checkouts hold their .env (secrets): root only.
install -d -m 700 /etc/dokploy/compose

log "Traefik static config (deploy/traefik.yml)"
if ! cmp -s "$APP_DIR/deploy/traefik.yml" /etc/dokploy/traefik/traefik.yml; then
  [ ! -f /etc/dokploy/traefik/traefik.yml ] || cp /etc/dokploy/traefik/traefik.yml "/etc/dokploy/traefik/traefik.yml.$(date +%Y%m%d%H%M%S)"
  install -m 644 "$APP_DIR/deploy/traefik.yml" /etc/dokploy/traefik/traefik.yml
  docker restart dokploy-traefik > /dev/null
  echo "installed and Traefik restarted"
else
  echo "up to date"
fi

log "Panel not routed by Traefik"
# Dokploy routes its panel on port 80 for `Host: dokploy.docker.localhost`, which anyone on the internet can send.
# Keep the file (Dokploy recreates the route if it is missing) but without routes: the panel is tunnel-only.
panel=/etc/dokploy/traefik/dynamic/dokploy.yml
if [ ! -f "$panel" ] || grep -q 'dokploy.docker.localhost' "$panel"; then
  printf '%s\n' '# No route to the Dokploy panel: reach it through an SSH tunnel to 127.0.0.1:3000 (docs/despliegue.md).' \
    '# Giving the panel a domain in Settings -> Web Server rewrites this file (read ADR 0039 first).' 'http: {}' > "$panel"
  echo "removed the dokploy.docker.localhost route"
fi

log "Network shared by the radar's web and Traefik"
docker network inspect reforesta-radar-edge > /dev/null 2>&1 || docker network create --internal reforesta-radar-edge > /dev/null
docker network inspect reforesta-radar-edge --format '{{range .Containers}}{{.Name}} {{end}}' | grep -qw dokploy-traefik \
  || docker network connect reforesta-radar-edge dokploy-traefik

log "Deploy scripts, CI user, backups"
# Root runs these files: only root may change this checkout.
chown -R root:root "$APP_DIR"
install -m 755 "$APP_DIR/deploy/deploy.sh" /usr/local/sbin/reforesta-radar-deploy
install -m 755 "$APP_DIR/deploy/ci-deploy.sh" /usr/local/sbin/reforesta-radar-ci-deploy
install -m 755 "$APP_DIR/deploy/backup.sh" /usr/local/sbin/reforesta-radar-backup
install -d -m 755 "$CONF_DIR"
# The CI key's user: no password, no docker group, one sudo rule (deploy/ci-deploy.sh explains the chain).
id "$DEPLOY_USER" > /dev/null 2>&1 || adduser --system --group --shell /bin/bash --home "/home/$DEPLOY_USER" "$DEPLOY_USER"
! id -nG "$DEPLOY_USER" | grep -qw docker || gpasswd -d "$DEPLOY_USER" docker
printf '%s ALL=(root) NOPASSWD: /usr/local/sbin/reforesta-radar-deploy\n' "$DEPLOY_USER" > /etc/sudoers.d/reforesta-radar.tmp
visudo -cqf /etc/sudoers.d/reforesta-radar.tmp && install -m 440 /etc/sudoers.d/reforesta-radar.tmp /etc/sudoers.d/reforesta-radar
rm -f /etc/sudoers.d/reforesta-radar.tmp
keys=/home/$DEPLOY_USER/.ssh/authorized_keys
if [ -f "$keys" ] && grep -q 'command="/opt/reforesta-radar/deploy/ci-deploy.sh"' "$keys"; then
  sed -i 's#command="/opt/reforesta-radar/deploy/ci-deploy.sh"#command="/usr/local/sbin/reforesta-radar-ci-deploy"#' "$keys"
  echo "CI key now runs /usr/local/sbin/reforesta-radar-ci-deploy"
fi
install -d -m 700 /var/backups/reforesta-radar
install -m 644 "$APP_DIR/deploy/systemd/reforesta-radar-backup.service" /etc/systemd/system/
install -m 644 "$APP_DIR/deploy/systemd/reforesta-radar-backup.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now reforesta-radar-backup.timer

log "Done"
docker --version
docker service ls --format '{{.Name}} {{.Image}} {{.Replicas}}'
[ -f "$CONF_DIR/deploy.env" ] || echo "Next: the panel steps in docs/despliegue.md, then $CONF_DIR/deploy.env and dokploy-api-key."
