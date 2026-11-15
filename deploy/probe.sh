#!/usr/bin/env bash
# Availability probe for a deploy (ADR 0044, docs/despliegue.md): asks the public site for /landing, /login and
# /api/public/oportunidades every half second until it is stopped (Ctrl+C or SIGTERM), then prints how many answers
# each path got per status code and the longest outage per path, and exits 1 if any answer was not 2xx/3xx.
#
#   deploy/probe.sh https://radar.example.org [log file]
#
# .github/workflows/deploy.yml runs it during every deploy and turns any failed answer into a warning on the run.
# Read-only (three GETs that need no session), about 6 requests a second. On the server itself, through Traefik:
#   PROBE_RESOLVE=radar.example.org:443:127.0.0.1 deploy/probe.sh https://radar.example.org
# Log: one line per answer, `<epoch> <path> <status> <seconds> <curl exit code>` (000 = no HTTP answer).
set -uo pipefail

URL=${1:-}
URL=${URL%/}
[[ $URL =~ ^https?://[a-z0-9.:-]+$ ]] || { echo "usage: $0 https://<domain> [log file]" >&2; exit 2; }
log=${2:-$(mktemp)}
: > "$log"
INTERVAL=${PROBE_INTERVAL:-0.5}
resolve=()
[ -z "${PROBE_RESOLVE:-}" ] || resolve=(--resolve "$PROBE_RESOLVE")

summary() {
  local errors
  kill "${pids[@]}" 2>/dev/null
  wait 2>/dev/null
  awk '{ c[$2" "$3]++; n++; p = $2
         if ($3 !~ /^[23]/) { nbad++; if (!(p in since)) since[p] = $1; last[p] = $1 }
         else if (p in since) { g = $1 - since[p]; if (g > maxg[p]) maxg[p] = g; delete since[p] } }
       END { for (p in since) { g = last[p] - since[p]; if (g > maxg[p]) maxg[p] = g }
             for (k in c) { split(k, a, " "); printf "  %-27s %s  %d\n", a[1], a[2], c[k] | "sort" }; close("sort")
             for (p in maxg) printf "  longest outage on %s: %.1f s\n", p, maxg[p]
             printf "%d requests, %d failed\n", n, nbad }' "$log"
  errors=$(awk '$3 !~ /^[23]/' "$log" | wc -l | tr -d ' ')
  if [ "$errors" -gt 0 ]; then
    [ -n "${GITHUB_ACTIONS:-}" ] && printf '::warning title=Requests failed during the deploy::%s of %s requests to %s were not 2xx/3xx (deploy/probe.sh)\n' \
      "$errors" "$(wc -l < "$log" | tr -d ' ')" "$URL"
    exit 1
  fi
  exit 0
}
trap summary TERM INT
# Sub-second timestamps: bash 5's EPOCHREALTIME, else GNU date (macOS's bash 3.2 + BSD date: whole seconds).
now() { if [ -n "${EPOCHREALTIME:-}" ]; then echo "${EPOCHREALTIME/,/.}"; else date +%s.%N | sed 's/\.N$//'; fi; }

# One loop per path, so a slow answer on one path does not thin out the others.
probe_path() {
  local out rc
  trap - TERM INT
  while :; do
    out=$(curl -s -o /dev/null -w '%{http_code} %{time_total}' --max-time 10 ${resolve[@]+"${resolve[@]}"} "$URL$1")
    rc=$?
    printf '%s %s %s %s\n' "$(now)" "$1" "${out:-000 0}" "$rc" >> "$log"
    sleep "$INTERVAL"
  done
}

echo "Probing $URL every ${INTERVAL}s (log: $log). Stop with Ctrl+C."
pids=()
for path in /landing /login /api/public/oportunidades; do
  probe_path "$path" &
  pids+=($!)
done
wait
