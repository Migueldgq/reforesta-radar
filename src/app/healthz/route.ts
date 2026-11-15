import { existsSync } from "node:fs";
import { connection } from "next/server";

/**
 * Traefik's health check of each `web` container (docker-compose.prod.yml, ADR 0044). Answers 503 once the
 * container is being replaced: scripts/web-start.sh creates the file on SIGTERM, Traefik stops sending this
 * container requests within a second, and only then does Next shut down. Says nothing about the API.
 */
export async function GET() {
  await connection(); // at request time, never prerendered
  const draining = existsSync("/tmp/radar-draining");
  return new Response(draining ? "draining\n" : "ok\n", {
    status: draining ? 503 : 200,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
