#!/bin/sh
# Entry point of the web image: runs the Next.js server. On SIGTERM (docker stop, or Compose removing the previous
# container during a deploy) it drains for RADAR_DRAIN_SECONDS before passing the signal on (ADR 0044,
# docs/despliegue.md):
#  - first half: keeps serving, so Traefik has time to add the new container (it only routes to healthy ones);
#  - then creates /tmp/radar-draining: /healthz answers 503 and Traefik's health check (every second) stops sending
#    requests here, so none is cut and Traefik never dials this address once the container is gone;
#  - second half: lets the requests in flight finish. Next then closes the idle connections and exits.
# Default 0: local runs stop at once.
term() {
  drain=${RADAR_DRAIN_SECONDS:-0}
  sleep $((drain / 2))
  touch /tmp/radar-draining
  sleep $((drain - drain / 2))
  kill -TERM "$pid" 2>/dev/null
  wait "$pid"
  exit $?
}
trap term TERM INT
rm -f /tmp/radar-draining
node server.js &
pid=$!
wait "$pid"
