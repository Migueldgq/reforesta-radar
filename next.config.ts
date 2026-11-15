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
    return [
      { source: "/invitacion/:token*", headers: noReferrer },
      { source: "/restablecer/:token*", headers: noReferrer },
    ];
  },
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API_URL}/api/:path*` },
      // The read-only MCP server (docs/mcp.md), so assistants can use the web origin's URL.
      { source: "/mcp", destination: `${API_URL}/mcp` },
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
