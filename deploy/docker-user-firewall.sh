#!/usr/bin/env bash
# Host firewall for container ports (docker-user-firewall.service, after Docker starts; deploy/setup-server.sh
# installs it as /usr/local/sbin/docker-user-firewall). Ports published by Docker (Traefik's 80/443, Dokploy's panel on
# 3000, anything a future project publishes) skip the INPUT chain: they go through FORWARD, where Docker sends them to
# the DOCKER-USER chain first. Here only new connections to 80 and 443 from the public interface pass; replies to
# connections the containers opened still do. The panel (3000) is then reachable only from the machine itself, i.e.
# through an SSH tunnel. Traffic between containers (bridge interfaces) is not touched. Idempotent.
set -euo pipefail

IFACE=${IFACE:-$(ip -o -4 route show to default | awk '{ print $5; exit }')}
[ -n "$IFACE" ] || { echo "docker-user-firewall: no default route interface" >&2; exit 1; }

iptables -N DOCKER-USER 2>/dev/null || true
iptables -F DOCKER-USER
iptables -A DOCKER-USER -i "$IFACE" -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN
# After Docker's DNAT the destination is the container's port; --ctorigdstport is the port the client asked for.
iptables -A DOCKER-USER -i "$IFACE" -p tcp -m conntrack --ctorigdstport 80 -j RETURN
iptables -A DOCKER-USER -i "$IFACE" -p tcp -m conntrack --ctorigdstport 443 -j RETURN
iptables -A DOCKER-USER -i "$IFACE" -j DROP
iptables -A DOCKER-USER -j RETURN
echo "docker-user-firewall: only 80/443 reach containers from $IFACE"
