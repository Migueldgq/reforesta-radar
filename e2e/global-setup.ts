import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { request, type FullConfig } from "@playwright/test";
import { ACCOUNTS, AUTH_DIR, statePath, type AccountKey, type Run } from "./fixtures";

/**
 * Before every run: fresh data and fresh accounts, nothing reused from an earlier run.
 * 1. backend/tests/e2e_seed.py empties the e2e database and loads the fixed opportunities (no network).
 * 2. The first admin is created with the real CLI (`python -m app.users create-admin --generate`).
 * 3. Everyone else is invited by that admin through the API and accepts the invitation, like a person would.
 * Passwords are generated here, per run, and only written to e2e/.auth/ (gitignored).
 *
 * E2E_BACKEND: how to run a command in the backend's environment. Default: inside the `api` container of the e2e
 * compose project. CI runs the API with uv instead and sets `uv run --directory backend`.
 */
const COMPOSE = "docker compose -p radar-e2e --env-file e2e/e2e.env -f docker-compose.yml -f e2e/docker-compose.e2e.yml";
const BACKEND = process.env.E2E_BACKEND ?? `${COMPOSE} exec -T api`;

function backend(cmd: string): string {
  return execSync(`${BACKEND} ${cmd}`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, RADAR_E2E: "1" } });
}

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL!;
  const runId = randomBytes(3).toString("hex");
  const email = (key: AccountKey) => `e2e-${key}-${runId}@example.org`;

  const seed = JSON.parse(backend("python -m tests.e2e_seed").trim().split("\n").pop()!) as Run["seed"];

  const adminEmail = email("admin");
  const out = backend(`python -m app.users create-admin ${adminEmail} --name "${ACCOUNTS.admin.name}" --generate`);
  const adminPassword = out.match(/Contraseña[^:]*: (\S+)/)?.[1];
  if (!adminPassword) throw new Error("create-admin did not print a generated password");

  mkdirSync(AUTH_DIR, { recursive: true });
  const run: Run = { runId, seed, accounts: {} as Run["accounts"] };
  const headers = { "X-Radar-CSRF": "1" };

  const admin = await request.newContext({ baseURL, extraHTTPHeaders: headers });
  const login = await admin.post("/api/auth/login", { data: { email: adminEmail, password: adminPassword } });
  if (!login.ok()) throw new Error(`admin login: ${login.status()} ${await login.text()}`);
  await admin.storageState({ path: statePath("admin") });
  run.accounts.admin = { email: adminEmail, password: adminPassword, name: ACCOUNTS.admin.name };

  for (const key of Object.keys(ACCOUNTS) as AccountKey[]) {
    if (key === "admin") continue;
    const { name, role } = ACCOUNTS[key];
    const inv = await admin.post("/api/team/invitations", { data: { email: email(key), name, role } });
    if (!inv.ok()) throw new Error(`invite ${key}: ${inv.status()} ${await inv.text()}`);
    const token = decodeURIComponent(new URL((await inv.json()).link).pathname.split("/").pop()!);
    const password = randomBytes(18).toString("base64url");
    const person = await request.newContext({ baseURL, extraHTTPHeaders: headers });
    const acc = await person.post("/api/auth/invitation/accept", { data: { token, name, password } });
    if (!acc.ok()) throw new Error(`accept ${key}: ${acc.status()} ${await acc.text()}`);
    await person.storageState({ path: statePath(key) });
    await person.dispose();
    run.accounts[key] = { email: email(key), password, name };
  }
  await admin.dispose();
  writeFileSync(path.join(AUTH_DIR, "run.json"), JSON.stringify(run, null, 2));
}
