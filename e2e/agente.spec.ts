import { createHash, randomBytes } from "node:crypto";
import { request, type APIRequestContext, type Page } from "@playwright/test";
import { expect, expectNoCrash, test } from "./fixtures";

/**
 * Sign-in from an AI agent (OAuth 2.1, ADR 0035), driven like a real client: dynamic registration, an authorize URL
 * with PKCE, the person's decision on /autorizar, the code exchange and one call to the team MCP server.
 * Account `agente`; every test registers its own client.
 */

const LOOPBACK = "http://127.0.0.1:53682/callback";

function pkce() {
  const verifier = randomBytes(48).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

/** An HTTP client like an agent's: no cookies, no CSRF header. */
async function agentHttp(baseURL: string): Promise<APIRequestContext> {
  return request.newContext({ baseURL });
}

async function register(http: APIRequestContext, name: string, redirect: string): Promise<string> {
  const res = await http.post("/oauth/register", {
    data: { client_name: name, redirect_uris: [redirect], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).client_id;
}

async function startAuthorization(page: Page, baseURL: string, clientId: string, redirect: string, challenge: string) {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirect,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "estado-e2e",
    scope: "radar:leer",
    resource: `${baseURL}/mcp/equipo`,
  });
  await page.goto(`/oauth/authorize?${q}`);
  await expect(page).toHaveURL(/\/autorizar\?solicitud=/);
}

test("«Permitir» sends a code back to a local agent, and its token reads the team MCP server", async ({ as, run, baseURL }) => {
  const http = await agentHttp(baseURL!);
  const name = `Claude Code e2e ${run.runId}`;
  const clientId = await register(http, name, LOOPBACK);
  const { verifier, challenge } = pkce();

  const page = await as("agente");
  // Nothing listens on the loopback port: answer the redirect here and keep the URL the agent would receive.
  await page.route("http://127.0.0.1:53682/**", (route) => route.fulfill({ status: 200, contentType: "text/plain", body: "ok" }));
  await startAuthorization(page, baseURL!, clientId, LOOPBACK, challenge);

  await expect(page.getByRole("heading", { level: 1 })).toContainText(`${name} quiere leer el radar de Reforesta con tu cuenta`);
  await expect(page.getByText(run.accounts.agente.email)).toBeVisible();
  await expect(page.getByText("Continúa solo si tú mismo acabas de pulsar «Conectar» en tu propio agente.", { exact: false })).toBeVisible();

  const [callback] = await Promise.all([page.waitForRequest((r) => r.url().startsWith(LOOPBACK)), page.getByRole("button", { name: "Permitir", exact: true }).click()]);
  const back = new URL(callback.url());
  const code = back.searchParams.get("code");
  expect(code).toBeTruthy();
  expect(back.searchParams.get("iss")).toBe(baseURL);
  expect(back.searchParams.get("state")).toBe("estado-e2e");

  const token = await http.post("/oauth/token", {
    form: { grant_type: "authorization_code", code: code!, client_id: clientId, code_verifier: verifier, redirect_uri: LOOPBACK, resource: `${baseURL}/mcp/equipo` },
  });
  expect(token.status(), await token.text()).toBe(200);
  const { access_token: accessToken } = await token.json();

  const mcp = await http.post("/mcp/equipo", {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25" },
    data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "tablero_equipo", arguments: {} } },
  });
  expect(mcp.status(), await mcp.text()).toBe(200);
  const body = await mcp.json();
  expect(body.result.isError ?? false).toBe(false);
  expect(JSON.stringify(body.result.structuredContent)).toContain(run.seed.titles[run.seed.gone]); // the team's board

  // Without the token, the same address asks for one.
  const anon = await http.post("/mcp/equipo", { headers: { Accept: "application/json, text/event-stream" }, data: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
  expect(anon.status()).toBe(401);
  expect(anon.headers()["www-authenticate"]).toContain("resource_metadata=");
  await http.dispose();
});

test("«No permitir» for an unrecognised web client stays on the radar", async ({ as, run, baseURL }) => {
  const http = await agentHttp(baseURL!);
  const redirect = "https://agente-desconocido.example.org/callback";
  const clientId = await register(http, `Agente raro ${run.runId}`, redirect);
  await http.dispose();
  const { challenge } = pkce();

  const page = await as("agente");
  const visited: string[] = [];
  await page.route("https://agente-desconocido.example.org/**", (route) => {
    visited.push(route.request().url());
    return route.abort();
  });
  await startAuthorization(page, baseURL!, clientId, redirect, challenge);
  await expect(page.getByText("No reconocemos este agente")).toBeVisible();
  await expect(page.getByText("agente-desconocido.example.org").first()).toBeVisible();

  await page.getByRole("button", { name: "No permitir" }).click();
  await expect(page.getByRole("status")).toHaveText("No permitido. Ese agente no tendrá acceso.");
  await expect(page).toHaveURL(/\/autorizar\?/);
  expect(visited).toEqual([]);
  await expectNoCrash(page);
});
