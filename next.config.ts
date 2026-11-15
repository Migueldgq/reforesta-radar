import type { NextConfig } from "next";

// The Python API (backend/). The browser only ever calls same-origin /api/*; Next proxies it here.
// Read at build time: `next build` serializes the rewrites, so the Docker image is built with the
// compose-internal URL (see Dockerfile / docker-compose.yml).
const API_URL = (process.env.API_URL ?? "http://localhost:8010").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  /* config options here */
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // Proxied request bodies are buffered up to this size (default 10 MB). The API caps PDFs at 15 MB and
    // answers 413 itself past that, so leave room for the file plus multipart overhead.
    proxyClientMaxBodySize: "16mb",
  },
  async headers() {
    // Invitation and reset links carry a one-time token in the path: keep it out of any Referer.
    const noReferrer = [{ key: "Referrer-Policy", value: "no-referrer" }];
    // The assistant's permission page: never inside a frame (clickjacking) and its request id never in a Referer.
    const consent = [
      ...noReferrer,
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
      { key: "Cache-Control", value: "no-store" },
    ];
    return [
      { source: "/invitacion/:token*", headers: noReferrer },
      { source: "/restablecer/:token*", headers: noReferrer },
      { source: "/autorizar", headers: consent },
    ];
  },
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API_URL}/api/:path*` },
      // The read-only MCP server (docs/mcp.md), so assistants can use the web origin's URL.
      { source: "/mcp", destination: `${API_URL}/mcp` },
      { source: "/mcp/equipo", destination: `${API_URL}/mcp/equipo` },
      // Sign-in from the assistant (ADR 0035): discovery documents and the OAuth endpoints live on the API.
      { source: "/.well-known/oauth-protected-resource", destination: `${API_URL}/.well-known/oauth-protected-resource` },
      { source: "/.well-known/oauth-protected-resource/:path*", destination: `${API_URL}/.well-known/oauth-protected-resource/:path*` },
      { source: "/.well-known/oauth-authorization-server", destination: `${API_URL}/.well-known/oauth-authorization-server` },
      { source: "/oauth/:path*", destination: `${API_URL}/oauth/:path*` },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
