#!/usr/bin/env bash
# Read-only checks of a deployed Reforesta Radar from outside, through the public URL (docs/despliegue.md):
#
#   deploy/smoke.sh https://radar.example.org
#
# Run by .github/workflows/deploy.yml after deploy/deploy.sh, and by hand whenever. It only reads: no account, no
# OAuth client, no session, nothing written (the MCP server is stateless). Waits up to a minute for the site, then
# runs every check and exits 1 if any failed, listing each one.
set -uo pipefail

URL=${1:-${RADAR_PUBLIC_URL:-}}
URL=${URL%/}
[[ $URL =~ ^https://[a-z0-9.-]+$ ]] || { echo "usage: $0 https://<domain> (no path)" >&2; exit 2; }
HOST=${URL#https://}

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
failed=0
ok() { printf 'ok    %s\n' "$1"; }
fail() {
  printf 'FAIL  %s\n' "$1"
  [ -n "${GITHUB_ACTIONS:-}" ] && printf '::error title=Smoke check failed::%s\n' "$1"
  failed=$((failed + 1))
}

# curl to the site: body in $tmp/body, headers in $tmp/headers, prints the status code (000 when unreachable).
fetch() {
  curl -sS -o "$tmp/body" -D "$tmp/headers" -w '%{http_code}' --max-time 20 "$@" 2>"$tmp/err" || echo 000
}
header() { grep -i "^$1:" "$tmp/headers" | tail -n 1 | cut -d: -f2- | tr -d '\r' | sed 's/^ *//'; }

# The site may still be settling right after a deploy.
for _ in $(seq 1 6); do
  [ "$(fetch "$URL/login")" = 200 ] && break
  sleep 10
done

code=$(fetch "$URL/login")
if [ "$code" = 200 ] && grep -q "Reforesta Radar" "$tmp/body"; then ok "/login 200 with the app name"; else fail "/login -> $code (or no 'Reforesta Radar' in the page)"; fi

hsts=$(header Strict-Transport-Security)
if [[ $hsts == *max-age=* ]]; then ok "HSTS: $hsts"; else fail "no Strict-Transport-Security header on /login"; fi

code=$(fetch "http://$HOST/login")
loc=$(header Location)
if [[ $code =~ ^30[1278]$ && $loc == "https://$HOST/login" ]]; then ok "http -> https ($code)"; else fail "http://$HOST/login -> $code, Location '$loc'"; fi

code=$(fetch "$URL/api/board")
if [ "$code" = 401 ]; then ok "/api/board without a session -> 401"; else fail "/api/board without a session -> $code (expected 401)"; fi

code=$(fetch "$URL/api/public/oportunidades")
count=$(jq -r '.items | length' "$tmp/body" 2>/dev/null || echo 0)
if [ "$code" = 200 ] && [ "${count:-0}" -gt 0 ] 2>/dev/null; then ok "/api/public/oportunidades -> $count opportunities"; else fail "/api/public/oportunidades -> $code, ${count:-?} items"; fi

mcp_headers=(-H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream')
init='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"radar-smoke","version":"1"}}}'
code=$(fetch -X POST "${mcp_headers[@]}" --data "$init" "$URL/mcp")
server=$(jq -r '.result.serverInfo.name // empty' "$tmp/body" 2>/dev/null)
if [ "$code" = 200 ] && [ -n "$server" ]; then ok "POST /mcp initialize (public) -> 200, server '$server'"; else fail "POST /mcp initialize -> $code"; fi

code=$(fetch -X POST "${mcp_headers[@]}" --data "$init" "$URL/mcp/equipo")
www=$(header WWW-Authenticate)
if [ "$code" = 401 ] && [[ $www == *resource_metadata=* ]]; then ok "POST /mcp/equipo without a token -> 401 with resource_metadata"; else fail "POST /mcp/equipo -> $code, WWW-Authenticate '$www'"; fi

code=$(fetch "$URL/.well-known/oauth-authorization-server")
issuer=$(jq -r '.issuer // empty' "$tmp/body" 2>/dev/null)
if [ "$code" = 200 ] && [ "$issuer" = "$URL" ]; then ok "OAuth issuer is $issuer"; else fail "/.well-known/oauth-authorization-server -> $code, issuer '$issuer' (expected '$URL')"; fi

# The Dokploy panel answers only on its own domain (ADR 0042), never for the default host Dokploy routes.
code=$(fetch -H 'Host: dokploy.docker.localhost' "http://$HOST/")
if [ "$code" = 404 ]; then ok "Host: dokploy.docker.localhost -> 404 (panel not reachable)"; else fail "Host: dokploy.docker.localhost -> $code (expected 404)"; fi

# Only when the panel is public: PANEL_URL=https://panel.example.org deploy/smoke.sh https://<domain>
if [ -n "${PANEL_URL:-}" ]; then
  code=$(fetch "$PANEL_URL/")
  hsts=$(header Strict-Transport-Security)
  if [ "$code" = 200 ] && grep -q Dokploy "$tmp/body" && [[ $hsts == *max-age=* ]]; then ok "panel $PANEL_URL -> 200 with HSTS"; else fail "panel $PANEL_URL -> $code, HSTS '$hsts'"; fi
fi

if [ "$failed" -gt 0 ]; then
  echo "$failed smoke check(s) failed against $URL" >&2
  exit 1
fi
echo "All smoke checks passed: $URL"
