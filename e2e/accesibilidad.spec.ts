import AxeBuilder from "@axe-core/playwright";
import { createHash, randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import { drawer, expect, test } from "./fixtures";

/** axe-core on three key screens: no serious or critical WCAG 2.x A/AA violations. Account `admin`, read-only. */

async function expectNoSeriousViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const serious = violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ id: v.id, impact: v.impact, help: v.help, targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")) }));
  expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
}

test("login page", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
  await expectNoSeriousViolations(page);
});

test("Inicio with the detail drawer open", async ({ as, run }) => {
  const page = await as("admin");
  await page.goto(`/?c=${encodeURIComponent(run.seed.won)}`);
  await expect(drawer(page).getByRole("region", { name: "Ediciones anteriores" })).toBeVisible();
  await expectNoSeriousViolations(page);
});

test("the agent consent page", async ({ as, run, baseURL, playwright }) => {
  const http = await playwright.request.newContext({ baseURL });
  const redirect = "http://127.0.0.1:53683/callback";
  const reg = await http.post("/oauth/register", {
    data: { client_name: `Claude Code a11y ${run.runId}`, redirect_uris: [redirect], token_endpoint_auth_method: "none", grant_types: ["authorization_code"], response_types: ["code"] },
  });
  expect(reg.status()).toBe(201);
  const clientId = (await reg.json()).client_id;
  await http.dispose();
  const challenge = createHash("sha256").update(randomBytes(48).toString("base64url")).digest("base64url");
  const q = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: "S256", scope: "radar:leer", resource: `${baseURL}/mcp/equipo` });

  const page = await as("admin");
  await page.goto(`/oauth/authorize?${q}`);
  await expect(page.getByRole("button", { name: "Permitir", exact: true })).toBeVisible();
  await expectNoSeriousViolations(page);
});
