#!/bin/sh
# Entry point of the web image: runs the Next.js server. On SIGTERM (docker stop, or Compose removing the previous
# container during a deploy) it keeps serving for RADAR_DRAIN_SECONDS before passing the signal on: Traefik only drops
# a container when it exits, and needs a moment to start routing to the new one (ADR 0044, docs/despliegue.md). Next
# then stops accepting connections, finishes the requests in flight and exits. Default 0 (local runs stop at once).
term() {
  sleep "${RADAR_DRAIN_SECONDS:-0}"
  kill -TERM "$pid" 2>/dev/null
  wait "$pid"
  exit $?
}
trap term TERM INT
node server.js &
pid=$!
wait "$pid"
